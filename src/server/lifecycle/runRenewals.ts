import "server-only";
import { db } from "../db";
import { getClock } from "../clock";
import { decryptCardToken } from "../payments/tokenVault";
import { chargeCardToken } from "../payments/flutterwaveClient";
import { koboToNairaInt } from "../payments/money";
import { writePaymentLog, writeSubscriptionEvent } from "../payments/log";
import {
  addOneMonthClamped,
  addOneYearClamped,
} from "../payments/proration";
import {
  CheckoutKind,
  CheckoutStatus,
  EventSource,
  PaymentEventType,
  PaymentOutcome,
  SubscriptionEventType,
  SubscriptionStatus,
} from "@prisma/client";

export interface RenewalsRunResult {
  attemptedCount: number;
  pastDueCount: number;
}

/**
 * Daily renewal job per FR-22, Rule S-4, S-6.
 *
 * For each ACTIVE subscription with cancelAtPeriodEnd = false and currentPeriodEnd <= now:
 * - Creates a RENEWAL session with txRef: renew:{subscriptionId}:{periodEndDate}:1
 * - Writes INITIATION row to PaymentLog
 * - Charges the stored token (or moves to PAST_DUE if missing / declined)
 *
 * NEVER grants access, never verifies payments, and never calls fulfillEntitlement().
 */
export async function runRenewals(): Promise<RenewalsRunResult> {
  const clock = getClock();
  const now = clock.now();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let attemptedCount = 0;
  let pastDueCount = 0;

  // 1. Check for pending renewals older than 24 hours and transition to PAST_DUE (PRD §12)
  const stalePendingRenewals = await db.checkoutSession.findMany({
    where: {
      kind: CheckoutKind.RENEWAL,
      status: CheckoutStatus.PENDING,
      createdAt: { lte: twentyFourHoursAgo },
    },
    include: {
      user: {
        include: { subscription: true },
      },
    },
  });

  for (const session of stalePendingRenewals) {
    const sub = session.user.subscription;
    if (sub && sub.status === SubscriptionStatus.ACTIVE) {
      const graceEndsAt = new Date(
        sub.currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000
      );
      const periodEndStr = sub.currentPeriodEnd.toISOString().split("T")[0] ?? "unknown-date";
      const graceIdempotencyKey = `sub:GRACE_STARTED:${sub.id}:${periodEndStr}`;

      await db.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: SubscriptionStatus.PAST_DUE,
            graceEndsAt,
          },
        });

        await writeSubscriptionEvent(
          {
            idempotencyKey: graceIdempotencyKey,
            userId: sub.userId,
            type: SubscriptionEventType.GRACE_STARTED,
          },
          tx
        );
      });
      pastDueCount += 1;
    }
  }

  // 2. Find eligible ACTIVE subscriptions needing renewal
  const dueSubscriptions = await db.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { lte: now },
    },
    include: {
      plan: true,
      pendingPlan: true,
      user: true,
    },
  });

  for (const sub of dueSubscriptions) {
    const periodEndStr = sub.currentPeriodEnd.toISOString().split("T")[0] ?? "unknown-date";
    const txRef = `renew:${sub.id}:${periodEndStr}:1`;

    // Check if a renewal session already exists for this subscription and period
    const existingSession = await db.checkoutSession.findUnique({
      where: { txRef },
    });
    if (existingSession) {
      continue;
    }

    // Determine target plan and price (apply pendingPlan price if scheduled)
    const targetPlan = sub.pendingPlan ?? sub.plan;
    const amountMinor = targetPlan.amountMinor;
    const currency = sub.currency;

    const quotedPeriodStart = sub.currentPeriodEnd;
    const quotedPeriodEnd =
      targetPlan.tier === "YEARLY"
        ? addOneYearClamped(quotedPeriodStart)
        : addOneMonthClamped(quotedPeriodStart);

    const sessionExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    // Create RENEWAL CheckoutSession
    const session = await db.checkoutSession.create({
      data: {
        userId: sub.userId,
        targetPlanId: targetPlan.id,
        kind: CheckoutKind.RENEWAL,
        txRef,
        amountMinor,
        currency,
        quotedPeriodStart,
        quotedPeriodEnd,
        status: CheckoutStatus.PENDING,
        expiresAt: sessionExpiresAt,
      },
    });

    attemptedCount += 1;

    // Write INITIATION row to PaymentLog (PRD §6 Step 10)
    await writePaymentLog({
      idempotencyKey: `init:${txRef}`,
      eventType: PaymentEventType.INITIATION,
      source: EventSource.RENEWAL_JOB,
      userId: sub.userId,
      checkoutSessionId: session.id,
      providerRef: txRef,
      amountMinor,
      currency,
      outcome: PaymentOutcome.PENDING,
      payload: {
        plan_tier: targetPlan.tier,
        tx_ref: txRef,
        amount_minor: amountMinor,
        currency,
        source: "RENEWAL_JOB",
      },
    });

    // Check for stored card token
    if (!sub.cardTokenEncrypted) {
      // No stored token: move to PAST_DUE (FR-11, FR-22)
      await markPastDue({
        subscription: sub,
        periodEndStr,
        txRef,
        sessionId: session.id,
        amountMinor,
        currency,
      });
      pastDueCount += 1;
      continue;
    }

    // Decrypt token and charge
    const token = decryptCardToken(sub.cardTokenEncrypted);
    const amountNaira = koboToNairaInt(amountMinor);

    const chargeResult = await chargeCardToken({
      token,
      currency,
      amount: amountNaira,
      email: sub.user.email,
      txRef,
    });

    if (!chargeResult.ok) {
      // Charge declined or failed: move to PAST_DUE (FR-11, T16)
      await markPastDue({
        subscription: sub,
        periodEndStr,
        txRef,
        sessionId: session.id,
        amountMinor,
        currency,
      });
      pastDueCount += 1;
    }
    // If charge succeeds, webhook finishes verification and fulfills entitlement
  }

  return {
    attemptedCount,
    pastDueCount,
  };
}

/**
 * Transitions an unrenewed subscription to PAST_DUE with grace period.
 * FR-11: graceEndsAt = currentPeriodEnd + 3 days.
 * Writes FAILURE to PaymentLog and GRACE_STARTED to SubscriptionEvent.
 */
async function markPastDue(params: {
  subscription: {
    id: string;
    userId: string;
    currentPeriodEnd: Date;
  };
  periodEndStr: string;
  txRef: string;
  sessionId: string;
  amountMinor: number;
  currency: string;
}): Promise<void> {
  const { subscription, periodEndStr, txRef, sessionId, amountMinor, currency } = params;
  const graceEndsAt = new Date(
    subscription.currentPeriodEnd.getTime() + 3 * 24 * 60 * 60 * 1000
  );
  const graceIdempotencyKey = `sub:GRACE_STARTED:${subscription.id}:${periodEndStr}`;

  await db.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        graceEndsAt,
      },
    });

    await writePaymentLog(
      {
        idempotencyKey: `fail:renewal:${txRef}:declined`,
        eventType: PaymentEventType.FAILURE,
        source: EventSource.RENEWAL_JOB,
        userId: subscription.userId,
        checkoutSessionId: sessionId,
        providerRef: txRef,
        amountMinor,
        currency,
        outcome: PaymentOutcome.PROVIDER_ERROR,
        payload: {
          tx_ref: txRef,
          error: "Card charge declined or no stored token",
        },
      },
      tx
    );

    await writeSubscriptionEvent(
      {
        idempotencyKey: graceIdempotencyKey,
        userId: subscription.userId,
        type: SubscriptionEventType.GRACE_STARTED,
      },
      tx
    );
  });
}
