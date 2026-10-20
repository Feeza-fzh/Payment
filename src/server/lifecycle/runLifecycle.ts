import "server-only";
import { db } from "../db";
import { getClock } from "../clock";
import { writeSubscriptionEvent } from "../payments/log";
import {
  PlanTier,
  SubscriptionEventType,
  SubscriptionStatus,
} from "@prisma/client";

export interface LifecycleRunResult {
  endedCount: number;
  rateLimitHitsPruned: number;
}

/**
 * Daily lifecycle job per FR-17, Rule S-4, S-6.
 *
 * 1. Ends subscriptions past currentPeriodEnd that have cancelAtPeriodEnd.
 * 2. Ends PAST_DUE subscriptions past graceEndsAt.
 * 3. Ends ACTIVE subscriptions with no verified renewal past currentPeriodEnd + 3 days.
 * 4. Updates User.plan to FREE for each ended subscription (Rule S-3).
 * 5. Writes a SubscriptionEvent (PERIOD_ENDED) per change.
 * 6. Deletes RateLimitHit rows older than 1 day.
 *
 * NEVER grants access, never verifies payments, and never calls fulfillEntitlement().
 */
export async function runLifecycle(): Promise<LifecycleRunResult> {
  const clock = getClock();
  const now = clock.now();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let endedCount = 0;

  // 1. Subscriptions past currentPeriodEnd with cancelAtPeriodEnd = true
  const canceledSubscriptions = await db.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
    },
  });

  // 2. PAST_DUE subscriptions past graceEndsAt
  const pastDueSubscriptions = await db.subscription.findMany({
    where: {
      status: SubscriptionStatus.PAST_DUE,
      graceEndsAt: { lte: now },
    },
  });

  // 3. ACTIVE subscriptions past currentPeriodEnd + 3 days (unrenewed, unrecovered)
  const lapsedSubscriptions = await db.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { lte: threeDaysAgo },
    },
  });

  const subsToEnd = [
    ...canceledSubscriptions,
    ...pastDueSubscriptions,
    ...lapsedSubscriptions,
  ];

  // De-duplicate in case of overlap
  const seenIds = new Set<string>();
  const uniqueSubsToEnd = subsToEnd.filter((sub) => {
    if (seenIds.has(sub.id)) return false;
    seenIds.add(sub.id);
    return true;
  });

  for (const sub of uniqueSubsToEnd) {
    const periodEndStr = sub.currentPeriodEnd.toISOString().split("T")[0];
    const idempotencyKey = `sub:PERIOD_ENDED:${sub.id}:${periodEndStr}`;

    await db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ENDED,
        },
      });

      // Update User.plan to FREE (Rule S-3)
      await tx.user.update({
        where: { id: sub.userId },
        data: { plan: PlanTier.FREE },
      });

      await writeSubscriptionEvent(
        {
          idempotencyKey,
          userId: sub.userId,
          type: SubscriptionEventType.PERIOD_ENDED,
        },
        tx
      );
    });

    endedCount += 1;
  }

  // 6. Delete RateLimitHit rows older than 1 day
  const pruneResult = await db.rateLimitHit.deleteMany({
    where: {
      at: { lt: oneDayAgo },
    },
  });

  return {
    endedCount,
    rateLimitHitsPruned: pruneResult.count,
  };
}
