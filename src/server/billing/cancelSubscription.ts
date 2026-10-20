import "server-only";
import { db } from "../db";
import { getClock } from "../clock";
import { writeSubscriptionEvent } from "../payments/log";
import { SubscriptionEventType, SubscriptionStatus } from "@prisma/client";

export type CancelSubscriptionResult =
  | { ok: true; endsAt: Date }
  | { ok: false; error: string };

/**
 * Cancels a subscription at period end per FR-13, FR-14, and Rule P-10.
 * Never cuts off access immediately. Paid access continues until currentPeriodEnd.
 * Writes CANCEL_REQUESTED to SubscriptionEvent (Rule P-18).
 */
export async function cancelSubscription(params: {
  userId: string;
  requestId: string;
}): Promise<CancelSubscriptionResult> {
  const { userId, requestId } = params;
  const now = getClock().now();

  const sub = await db.subscription.findUnique({
    where: { userId },
  });

  if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
    return { ok: false, error: "No active subscription found to cancel." };
  }

  // Idempotency key per PRD §6: sub:{type}:{subscriptionId}:{requestId}
  const idempotencyKey = `sub:CANCEL_REQUESTED:${sub.id}:${requestId}`;

  await db.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        cancelAtPeriodEnd: true,
        canceledAt: now,
        pendingPlanId: null,
      },
    });

    await writeSubscriptionEvent(
      {
        idempotencyKey,
        userId,
        type: SubscriptionEventType.CANCEL_REQUESTED,
      },
      tx
    );
  }, {
    maxWait: 10000,
    timeout: 20000,
  });

  return { ok: true, endsAt: sub.currentPeriodEnd };
}
