"use server";

import { getCurrentUser } from "@/server/identity/getCurrentUser";
import { cancelSubscription } from "@/server/billing/cancelSubscription";
import { saveCancellationReason } from "@/server/billing/saveCancellationReason";
import { scheduleDowngrade } from "@/server/billing/scheduleDowngrade";
import { keepMyPlan } from "@/server/billing/keepMyPlan";
import { calculateProration } from "@/server/payments/proration";
import { db } from "@/server/db";
import { getClock } from "@/server/clock";
import { decryptCardToken } from "@/server/payments/tokenVault";
import {
  chargeCardToken,
  createHostedPaymentLink,
} from "@/server/payments/flutterwaveClient";
import { koboToNairaInt } from "@/server/payments/money";
import { writePaymentLog } from "@/server/payments/log";
import {
  CancellationReasonCode,
  CheckoutKind,
  CheckoutStatus,
  EventSource,
  PaymentEventType,
  PaymentOutcome,
  PlanTier,
  SubscriptionStatus,
} from "@prisma/client";
import { revalidatePath } from "next/cache";

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Server action to cancel the active subscription at period end (FR-13, FR-14).
 */
export async function cancelSubscriptionAction(
  requestId: string
): Promise<ActionResult<{ endsAt: Date }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  const result = await cancelSubscription({
    userId: user.id,
    requestId,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/billing");
  revalidatePath("/plans");
  return { ok: true, data: { endsAt: result.endsAt } };
}

/**
 * Server action to optionally save cancellation reason (FR-15).
 */
export async function saveCancellationReasonAction(
  code: CancellationReasonCode,
  text?: string,
  requestId?: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  const result = await saveCancellationReason({
    userId: user.id,
    reasonCode: code,
    reasonText: text,
    requestId,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/billing");
  return { ok: true };
}

/**
 * Server action to schedule downgrade from yearly to monthly at period end (FR-16).
 */
export async function scheduleDowngradeAction(
  requestId: string
): Promise<ActionResult<{ effectiveDate: Date }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  const result = await scheduleDowngrade({
    userId: user.id,
    requestId,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/billing");
  revalidatePath("/plans");
  return { ok: true, data: { effectiveDate: result.effectiveDate } };
}

/**
 * Server action to undo scheduled cancellation or downgrade (FR-21).
 */
export async function keepMyPlanAction(requestId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  const result = await keepMyPlan({
    userId: user.id,
    requestId,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/billing");
  revalidatePath("/plans");
  return { ok: true };
}

/**
 * Server action to preview upgrade proration without charging (FR-4).
 */
export async function previewUpgradeAction(): Promise<
  ActionResult<{
    yearlyPriceKobo: number;
    creditKobo: number;
    chargeKobo: number;
    quotedPeriodStart: Date;
    quotedPeriodEnd: Date;
    unusedDays: number;
    totalDays: number;
  }>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  const sub = await db.subscription.findUnique({
    where: { userId: user.id },
    include: { plan: true },
  });

  if (!sub || sub.status !== SubscriptionStatus.ACTIVE || sub.plan.tier !== PlanTier.MONTHLY) {
    return { ok: false, error: "Active monthly subscription required for upgrade." };
  }

  const yearlyPlan = await db.plan.findUnique({
    where: { tier: PlanTier.YEARLY },
  });

  if (!yearlyPlan) {
    return { ok: false, error: "Yearly plan not found." };
  }

  const now = getClock().now();
  const quote = calculateProration({
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    lastAmountMinor: sub.lastAmountMinor,
    yearlyPriceKobo: yearlyPlan.amountMinor,
    quoteDate: now,
  });

  return {
    ok: true,
    data: {
      yearlyPriceKobo: quote.yearlyPriceKobo,
      creditKobo: quote.creditKobo,
      chargeKobo: quote.chargeKobo,
      quotedPeriodStart: quote.quotedPeriodStart,
      quotedPeriodEnd: quote.quotedPeriodEnd,
      unusedDays: quote.unusedDays,
      totalDays: quote.totalDays,
    },
  };
}

/**
 * Server action for Pay now when PAST_DUE (FR-19, T31).
 * Attempts charge on stored token; falls back to hosted checkout link if no token.
 */
export async function payNowAction(): Promise<
  ActionResult<{ type: "TOKEN_CHARGED" | "REDIRECT"; redirectUrl?: string }>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  const sub = await db.subscription.findUnique({
    where: { userId: user.id },
    include: { plan: true },
  });

  if (!sub || sub.status !== SubscriptionStatus.PAST_DUE) {
    return { ok: false, error: "No past due subscription found." };
  }

  const now = getClock().now();
  const periodEndStr = sub.currentPeriodEnd.toISOString().split("T")[0];
  const txRef = `renew:${sub.id}:${periodEndStr}:2`;
  const amountMinor = sub.plan.amountMinor;
  const currency = sub.currency;

  // Create RENEWAL session
  const session = await db.checkoutSession.create({
    data: {
      userId: user.id,
      targetPlanId: sub.planId,
      kind: CheckoutKind.RENEWAL,
      txRef,
      amountMinor,
      currency,
      quotedPeriodStart: now,
      quotedPeriodEnd:
        sub.plan.tier === PlanTier.YEARLY
          ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
          : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      status: CheckoutStatus.PENDING,
    },
  });

  // Write INITIATION row
  await writePaymentLog({
    idempotencyKey: `init:${txRef}`,
    eventType: PaymentEventType.INITIATION,
    source: EventSource.CHECKOUT,
    userId: user.id,
    checkoutSessionId: session.id,
    providerRef: txRef,
    amountMinor,
    currency,
    outcome: PaymentOutcome.PENDING,
    payload: {
      action: "PAY_NOW",
      tx_ref: txRef,
      amount_minor: amountMinor,
    },
  });

  // Try charging stored token first
  if (sub.cardTokenEncrypted) {
    const token = decryptCardToken(sub.cardTokenEncrypted);
    const amountNaira = koboToNairaInt(amountMinor);
    const chargeResult = await chargeCardToken({
      token,
      currency,
      amount: amountNaira,
      email: user.email,
      txRef,
    });

    if (chargeResult.ok) {
      revalidatePath("/billing");
      return { ok: true, data: { type: "TOKEN_CHARGED" } };
    }
  }

  // Fallback to hosted checkout link (FR-19)
  const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const linkResult = await createHostedPaymentLink({
    txRef,
    amount: koboToNairaInt(amountMinor),
    currency,
    redirectUrl: `${appBaseUrl}/billing/return`,
    customer: { email: user.email },
    customizations: {
      title: "Renew Subscription",
      description: `Payment for ${sub.plan.tier} subscription`,
    },
  });

  if (linkResult.ok) {
    await db.checkoutSession.update({
      where: { id: session.id },
      data: { paymentLink: linkResult.link },
    });
    return { ok: true, data: { type: "REDIRECT", redirectUrl: linkResult.link } };
  }

  return { ok: false, error: linkResult.error };
}
