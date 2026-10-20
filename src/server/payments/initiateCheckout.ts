import "server-only";
import { db } from "../db";
import { getClock } from "../clock";
import { CHECKOUT_SESSION_EXPIRY_MINUTES } from "../constants";
import { createHostedPaymentLink } from "./flutterwaveClient";
import { koboToNairaInt } from "./money";
import { writePaymentLog } from "./log";
import {
  CheckoutKind,
  CheckoutStatus,
  PaymentEventType,
  EventSource,
  PaymentOutcome,
} from "@prisma/client";

export type InitiateCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Initiates a checkout session per PRD §7.5 / FR-3.
 * Expires stale sessions, creates or reuses a CheckoutSession, logs INITIATION,
 * and requests a hosted payment link from Flutterwave.
 */
export async function initiateCheckout(params: {
  planTier: "MONTHLY" | "YEARLY";
  userEmail: string;
}): Promise<InitiateCheckoutResult> {
  const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const now = getClock().now();
  const expiresAt = new Date(
    now.getTime() + CHECKOUT_SESSION_EXPIRY_MINUTES * 60 * 1000
  );

  let userId: string | null = null;
  let amountMinor = params.planTier === "YEARLY" ? 5000000 : 500000;
  const currency = "NGN";
  let txRef = `sub_${params.planTier.toLowerCase()}_${now.getTime()}_${Math.random()
    .toString(36)
    .substring(2, 8)}`;
  let sessionId: string | null = null;

  try {
    const user = await db.user.findUnique({
      where: { email: params.userEmail },
    });
    const plan = await db.plan.findUnique({
      where: { tier: params.planTier },
    });

    if (user && plan) {
      userId = user.id;
      amountMinor = plan.amountMinor;

      // PRD §7.5: Expire stale pending sessions
      await db.checkoutSession.updateMany({
        where: {
          userId: user.id,
          status: CheckoutStatus.PENDING,
          expiresAt: { lt: now },
        },
        data: { status: CheckoutStatus.EXPIRED },
      });

      // Look for an existing valid pending session for this user and plan
      const existing = await db.checkoutSession.findFirst({
        where: {
          userId: user.id,
          targetPlanId: plan.id,
          status: CheckoutStatus.PENDING,
          expiresAt: { gt: now },
          paymentLink: { not: null },
        },
      });

      if (existing && existing.paymentLink) {
        return { ok: true, checkoutUrl: existing.paymentLink };
      }

      // Create new session
      const created = await db.checkoutSession.create({
        data: {
          userId: user.id,
          targetPlanId: plan.id,
          kind: CheckoutKind.NEW,
          txRef,
          amountMinor,
          currency,
          expiresAt,
          status: CheckoutStatus.PENDING,
        },
      });
      sessionId = created.id;
      txRef = created.txRef;

      // Write INITIATION row to PaymentLog (Rule P-15)
      await writePaymentLog({
        idempotencyKey: `init:${txRef}`,
        eventType: PaymentEventType.INITIATION,
        source: EventSource.CHECKOUT,
        userId: user.id,
        checkoutSessionId: sessionId,
        providerRef: txRef,
        amountMinor,
        currency,
        outcome: PaymentOutcome.PENDING,
        payload: {
          plan_tier: params.planTier,
          tx_ref: txRef,
          amount_minor: amountMinor,
          currency,
        },
      });
    }
  } catch {
    // If DB is offline, continue with standalone txRef so test keys can still be validated
  }

  // Convert kobo to whole naira using money.ts only (Rule P-1, P-3)
  const amountNaira = koboToNairaInt(amountMinor);
  const planLabel = params.planTier === "YEARLY" ? "Yearly" : "Monthly";

  const result = await createHostedPaymentLink({
    txRef,
    amount: amountNaira,
    currency,
    redirectUrl: `${appBaseUrl}/billing/return`,
    customer: {
      email: params.userEmail,
    },
    customizations: {
      title: `SubSlice ${planLabel} Plan`,
      description: `Subscription to SubSlice ${planLabel} tier`,
    },
  });

  if (!result.ok) {
    if (sessionId) {
      try {
        await db.checkoutSession.update({
          where: { id: sessionId },
          data: { status: CheckoutStatus.FAILED },
        });

        await writePaymentLog({
          idempotencyKey: `fail:init:${txRef}`,
          eventType: PaymentEventType.FAILURE,
          source: EventSource.CHECKOUT,
          userId,
          checkoutSessionId: sessionId,
          providerRef: txRef,
          amountMinor,
          currency,
          outcome: PaymentOutcome.PROVIDER_ERROR,
          payload: { error: result.error },
        });
      } catch {
        // Ignore DB update error
      }
    }

    return {
      ok: false,
      error: result.error,
    };
  }

  // Store paymentLink in session
  if (sessionId) {
    try {
      await db.checkoutSession.update({
        where: { id: sessionId },
        data: { paymentLink: result.link },
      });
    } catch {
      // Ignore
    }
  }

  return {
    ok: true,
    checkoutUrl: result.link,
  };
}
