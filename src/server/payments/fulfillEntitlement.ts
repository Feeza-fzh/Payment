import "server-only";
import { db } from "../db";
import { getClock } from "../clock";
import { encryptCardToken } from "./tokenVault";
import { writePaymentLog, writeSubscriptionEvent } from "./log";
import type { VerifiedPayment } from "./verifyTransaction";
import {
  PaymentEventType,
  EventSource,
  PaymentOutcome,
  SubscriptionEventType,
  SubscriptionStatus,
  CheckoutStatus,
} from "@prisma/client";

export type FulfillEntitlementOutcome =
  | "FULFILLED"
  | "ALREADY_FULFILLED"
  | "PAID_EXPIRED_SESSION"
  | "UPGRADE_PERIOD_DRIFT"
  | "DUPLICATE_PAYMENT"
  | "UNMATCHED_REFERENCE";

export interface FulfillResult {
  ok: boolean;
  outcome: FulfillEntitlementOutcome;
  plan?: string;
  error?: string;
}

/**
 * Fulfills paid entitlement for a VerifiedPayment (Rule S-2, PRD §7.8).
 * Accepts ONLY a VerifiedPayment branded object.
 * Runs atomically inside a single DB transaction with SELECT ... FOR UPDATE.
 */
export async function fulfillEntitlement(
  payment: VerifiedPayment,
  source: EventSource
): Promise<FulfillResult> {
  const idempotencyKey = `fulfil:${payment.providerTransactionId}`;

  // Check if already fulfilled (Rule P-13)
  const existingFulfilment = await db.paymentLog.findUnique({
    where: { idempotencyKey },
  });
  if (existingFulfilment) {
    return { ok: true, outcome: "ALREADY_FULFILLED" };
  }

  // Find the associated CheckoutSession
  const session = await db.checkoutSession.findUnique({
    where: { txRef: payment.txRef },
    include: {
      user: true,
      targetPlan: true,
    },
  });

  if (!session) {
    // PRD 7.8 rule (d): Unmatched reference writes FAILURE, grants nothing
    await writePaymentLog({
      idempotencyKey: `fail:fulfil:${payment.providerTransactionId}:unmatched`,
      eventType: PaymentEventType.FAILURE,
      source,
      providerRef: payment.txRef,
      providerTransactionId: payment.providerTransactionId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      outcome: PaymentOutcome.UNMATCHED_REFERENCE,
      payload: payment.rawPayload,
    });
    return {
      ok: false,
      outcome: "UNMATCHED_REFERENCE",
      error: "No matching checkout session found.",
    };
  }

  const now = getClock().now();
  let outcome: PaymentOutcome = PaymentOutcome.SUCCESS;
  let fulfillOutcome: FulfillEntitlementOutcome = "FULFILLED";

  // PRD 7.8 rule (b): Paid expired session is applied with PAID_EXPIRED_SESSION outcome
  if (session.status === CheckoutStatus.EXPIRED || now > session.expiresAt) {
    outcome = PaymentOutcome.PAID_EXPIRED_SESSION;
    fulfillOutcome = "PAID_EXPIRED_SESSION";
  }

  // Calculate new subscription period
  const periodStart = session.quotedPeriodStart ?? now;
  const periodEnd =
    session.quotedPeriodEnd ??
    (session.targetPlan.tier === "YEARLY"
      ? new Date(periodStart.getTime() + 365 * 24 * 60 * 60 * 1000)
      : new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000));

  // Encrypt card token if available (Rule P-19)
  const encryptedToken = payment.cardToken
    ? encryptCardToken(payment.cardToken)
    : null;

  try {
    await db.$transaction(async (tx) => {
      // Rule P-14: Lock the Subscription row with SELECT ... FOR UPDATE (Rule S-7 tagged template)
      await tx.$executeRaw`
        SELECT 1 FROM "Subscription"
        WHERE "userId" = ${session.userId}
        FOR UPDATE
      `;

      // 1. Write FULFILMENT PaymentLog row (Rule P-15, P-17)
      await writePaymentLog(
        {
          idempotencyKey,
          eventType: PaymentEventType.FULFILMENT,
          source,
          userId: session.userId,
          checkoutSessionId: session.id,
          providerRef: payment.txRef,
          providerTransactionId: payment.providerTransactionId,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          outcome,
          payload: payment.rawPayload,
        },
        tx
      );

      // 2. Upsert Subscription row
      await tx.subscription.upsert({
        where: { userId: session.userId },
        create: {
          userId: session.userId,
          planId: session.targetPlanId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          cardTokenEncrypted: encryptedToken,
          lastAmountMinor: payment.amountMinor,
          currency: payment.currency,
        },
        update: {
          planId: session.targetPlanId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          pendingPlanId: null,
          graceEndsAt: null,
          canceledAt: null,
          ...(encryptedToken ? { cardTokenEncrypted: encryptedToken } : {}),
          lastAmountMinor: payment.amountMinor,
          currency: payment.currency,
        },
      });

      // 3. Update User.plan and CheckoutSession
      await tx.user.update({
        where: { id: session.userId },
        data: { plan: session.targetPlan.tier },
      });

      await tx.checkoutSession.update({
        where: { id: session.id },
        data: {
          status: CheckoutStatus.COMPLETED,
          providerTransactionId: payment.providerTransactionId,
        },
      });

      // 4. Write PLAN_APPLIED SubscriptionEvent (Rule P-18)
      await writeSubscriptionEvent(
        {
          idempotencyKey: `sub:apply:${payment.providerTransactionId}`,
          userId: session.userId,
          type: SubscriptionEventType.PLAN_APPLIED,
        },
        tx
      );
    });

    return {
      ok: true,
      outcome: fulfillOutcome,
      plan: session.targetPlan.tier,
    };
  } catch (err: unknown) {
    const errorString = String(err);
    // If unique key collision on idempotencyKey, already handled
    if (errorString.includes("Unique constraint failed") || errorString.includes("P2002")) {
      return { ok: true, outcome: "ALREADY_FULFILLED" };
    }
    throw err;
  }
}
