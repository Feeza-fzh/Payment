import "server-only";
import { db } from "../db";
import { getClock } from "../clock";
import { encryptCardToken } from "./tokenVault";
import { writePaymentLog, writeSubscriptionEvent } from "./log";
import { addOneMonthClamped, addOneYearClamped } from "./proration";
import type { VerifiedPayment } from "./verifyTransaction";
import {
  CheckoutKind,
  CheckoutStatus,
  EventSource,
  PaymentEventType,
  PaymentOutcome,
  SubscriptionEventType,
  SubscriptionStatus,
} from "@prisma/client";

export type FulfillEntitlementOutcome =
  | "FULFILLED"
  | "ALREADY_FULFILLED"
  | "PAID_EXPIRED_SESSION"
  | "UPGRADE_PERIOD_DRIFT"
  | "DUPLICATE_PAYMENT"
  | "UNMATCHED_REFERENCE"
  | "RENEWAL_AFTER_CANCEL";

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

  // PRD 7.8 rule (b): Paid expired session is applied with PAID_EXPIRED_SESSION outcome (T27)
  if (session.status === CheckoutStatus.EXPIRED || now > session.expiresAt) {
    outcome = PaymentOutcome.PAID_EXPIRED_SESSION;
    fulfillOutcome = "PAID_EXPIRED_SESSION";
  }

  // Use quoted period from the session when available.
  // Fallback uses clamped calendar helpers (not raw ms) to handle leap years
  // and variable month lengths correctly (avoids the 30-day / 365-day bug).
  const periodStart = session.quotedPeriodStart ?? now;
  const periodEnd =
    session.quotedPeriodEnd ??
    (session.targetPlan.tier === "YEARLY"
      ? addOneYearClamped(periodStart)
      : addOneMonthClamped(periodStart));

  // Encrypt card token if available (Rule P-19)
  const encryptedToken = payment.cardToken
    ? encryptCardToken(payment.cardToken)
    : null;

  try {
    const txResult = await db.$transaction(async (tx) => {
      // Rule P-14: Lock the Subscription row with SELECT ... FOR UPDATE (Rule S-7 tagged template)
      await tx.$executeRaw`
        SELECT 1 FROM "Subscription"
        WHERE "userId" = ${session.userId}
        FOR UPDATE
      `;

      // Read current subscription after row lock
      const currentSub = await tx.subscription.findUnique({
        where: { userId: session.userId },
        include: { plan: true },
      });

      // PRD 7.8 rule (c) / T29: Duplicate payment for already-paid period
      if (
        currentSub &&
        currentSub.planId === session.targetPlanId &&
        currentSub.currentPeriodStart.getTime() === periodStart.getTime() &&
        currentSub.currentPeriodEnd.getTime() === periodEnd.getTime() &&
        currentSub.status === SubscriptionStatus.ACTIVE
      ) {
        await writePaymentLog(
          {
            idempotencyKey: `fail:fulfil:${payment.providerTransactionId}:dup`,
            eventType: PaymentEventType.FAILURE,
            source,
            userId: session.userId,
            checkoutSessionId: session.id,
            providerRef: payment.txRef,
            providerTransactionId: payment.providerTransactionId,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            outcome: PaymentOutcome.DUPLICATE_PAYMENT,
            payload: payment.rawPayload,
          },
          tx
        );
        return {
          ok: false,
          outcome: "DUPLICATE_PAYMENT" as const,
          error: "Duplicate payment for current period.",
        };
      }

      // PRD 7.8 rule (a) / T21: Upgrade period drift
      if (session.kind === CheckoutKind.UPGRADE && currentSub) {
        if (
          session.quotedPeriodStart &&
          currentSub.currentPeriodEnd.getTime() !== session.quotedPeriodStart.getTime()
        ) {
          outcome = PaymentOutcome.UPGRADE_PERIOD_DRIFT;
          fulfillOutcome = "UPGRADE_PERIOD_DRIFT";
        }
      }

      // FR-14 / T25: Renewal payment verifies after cancel
      let keepCancelFlag = false;
      const canceledAt = currentSub?.canceledAt ?? null;
      if (session.kind === CheckoutKind.RENEWAL && currentSub?.cancelAtPeriodEnd) {
        keepCancelFlag = true;
        outcome = PaymentOutcome.RENEWAL_AFTER_CANCEL;
        fulfillOutcome = "RENEWAL_AFTER_CANCEL";
      }

      // FR-22 / T26: Apply pendingPlan on renewal
      let appliedPlanId = session.targetPlanId;
      let appliedPlanTier = session.targetPlan.tier;
      if (session.kind === CheckoutKind.RENEWAL && currentSub?.pendingPlanId) {
        appliedPlanId = currentSub.pendingPlanId;
        const pendingPlan = await tx.plan.findUnique({
          where: { id: currentSub.pendingPlanId },
        });
        if (pendingPlan) {
          appliedPlanTier = pendingPlan.tier;
        }
      }

      // Stacking logic for yearly-to-monthly downgrade:
      // The plan reflects as MONTHLY immediately on plans and billing,
      // and the purchased month is stacked onto currentPeriodEnd.
      const effectivePeriodStart =
        currentSub &&
        currentSub.status === SubscriptionStatus.ACTIVE &&
        currentSub.currentPeriodStart <= now &&
        session.kind === CheckoutKind.RENEWAL
          ? currentSub.currentPeriodStart
          : periodStart;

      const finalPlanId = appliedPlanId;
      const finalPlanTier = appliedPlanTier;
      const finalPendingPlanId = null;

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
          planId: finalPlanId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: keepCancelFlag,
          canceledAt,
          cardTokenEncrypted: encryptedToken,
          lastAmountMinor: payment.amountMinor,
          currency: payment.currency,
        },
        update: {
          planId: finalPlanId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: effectivePeriodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: keepCancelFlag,
          canceledAt: keepCancelFlag ? canceledAt : null,
          pendingPlanId: finalPendingPlanId,
          graceEndsAt: null,
          ...(encryptedToken ? { cardTokenEncrypted: encryptedToken } : {}),
          lastAmountMinor: payment.amountMinor,
          currency: payment.currency,
        },
      });

      // 3. Concurrently update User.plan, CheckoutSession, and write SubscriptionEvent (Rule P-18)
      await Promise.all([
        tx.user.update({
          where: { id: session.userId },
          data: { plan: finalPlanTier },
        }),
        tx.checkoutSession.update({
          where: { id: session.id },
          data: {
            status: CheckoutStatus.COMPLETED,
            providerTransactionId: payment.providerTransactionId,
          },
        }),
        writeSubscriptionEvent(
          {
            idempotencyKey: `sub:apply:${payment.providerTransactionId}`,
            userId: session.userId,
            type: SubscriptionEventType.PLAN_APPLIED,
          },
          tx
        ),
      ]);

      return {
        ok: true,
        outcome: fulfillOutcome,
        plan: finalPlanTier,
      };
    },
    {
      maxWait: 15000,
      timeout: 30000,
    });

    return txResult;
  } catch (err: unknown) {
    const errorString = String(err);
    // If unique key collision on idempotencyKey, already handled (Rule P-13)
    if (
      errorString.includes("Unique constraint failed") ||
      errorString.includes("P2002")
    ) {
      return { ok: true, outcome: "ALREADY_FULFILLED" };
    }
    throw err;
  }
}
