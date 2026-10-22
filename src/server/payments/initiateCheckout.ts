import "server-only";
import { db } from "../db";
import { getClock } from "../clock";
import { CHECKOUT_SESSION_EXPIRY_MINUTES } from "../constants";
import { createHostedPaymentLink } from "./flutterwaveClient";
import { koboToNairaInt } from "./money";
import { writePaymentLog } from "./log";
import {
  calculateProration,
  addOneMonthClamped,
  addOneYearClamped,
} from "./proration";
import {
  CheckoutKind,
  CheckoutStatus,
  PaymentEventType,
  EventSource,
  PaymentOutcome,
  SubscriptionStatus,
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

  const user = await db.user.findUnique({
    where: { email: params.userEmail },
    include: {
      subscription: {
        include: { plan: true },
      },
    },
  });
  const plan = await db.plan.findUnique({
    where: { tier: params.planTier },
  });

  if (!user || !plan) {
    return { ok: false, error: "User or plan not found. Please try again." };
  }

  userId = user.id;

  // PRD §7.5: Expire stale pending sessions
  await db.checkoutSession.updateMany({
    where: {
      userId: user.id,
      status: CheckoutStatus.PENDING,
      expiresAt: { lt: now },
    },
    data: { status: CheckoutStatus.EXPIRED },
  });

  // Check if this is an upgrade from an active MONTHLY plan to YEARLY (FR-4, FR-5)
  let kind: CheckoutKind = CheckoutKind.NEW;
  let prorationCreditMinor: number | null = null;
  let quotedPeriodStart: Date = now;
  let quotedPeriodEnd: Date =
    params.planTier === "YEARLY"
      ? addOneYearClamped(now)
      : addOneMonthClamped(now);
  let sessionExpiresAt = expiresAt;

  const isMonthlyToYearlyUpgrade =
    user.subscription?.status === SubscriptionStatus.ACTIVE &&
    user.subscription.plan.tier === "MONTHLY" &&
    params.planTier === "YEARLY";

  // A user already active (or past_due) on the same plan tier is re-subscribing.
  // The new period must continue from currentPeriodEnd so remaining days are preserved.
  const isSamePlanRenew =
    !isMonthlyToYearlyUpgrade &&
    user.subscription &&
    (user.subscription.status === SubscriptionStatus.ACTIVE ||
      user.subscription.status === SubscriptionStatus.PAST_DUE) &&
    user.subscription.plan.tier === params.planTier;

  if (isMonthlyToYearlyUpgrade && user.subscription) {
    kind = CheckoutKind.UPGRADE;
    const quote = calculateProration({
      currentPeriodStart: user.subscription.currentPeriodStart,
      currentPeriodEnd: user.subscription.currentPeriodEnd,
      lastAmountMinor: user.subscription.lastAmountMinor,
      yearlyPriceKobo: plan.amountMinor,
      quoteDate: now,
    });
    amountMinor = quote.chargeKobo;
    prorationCreditMinor = quote.creditKobo;
    quotedPeriodStart = quote.quotedPeriodStart;
    quotedPeriodEnd = quote.quotedPeriodEnd;
    sessionExpiresAt = quote.expiresAt;
  } else if (isSamePlanRenew && user.subscription) {
    // PRD §7.9: continue the billing cycle from where it left off.
    kind = CheckoutKind.RENEWAL;
    quotedPeriodStart = user.subscription.currentPeriodEnd;
    quotedPeriodEnd =
      params.planTier === "YEARLY"
        ? addOneYearClamped(user.subscription.currentPeriodEnd)
        : addOneMonthClamped(user.subscription.currentPeriodEnd);
    amountMinor = plan.amountMinor;
  } else {
    amountMinor = plan.amountMinor;
  }

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
      kind,
      txRef,
      amountMinor,
      currency,
      prorationCreditMinor,
      quotedPeriodStart,
      quotedPeriodEnd,
      expiresAt: sessionExpiresAt,
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
      tx_ref: txRef,
      amount: amountMinor,
      currency,
      status: "initiated",
    },
  });

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
