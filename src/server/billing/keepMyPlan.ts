import "server-only";
import { db } from "../db";
import { writeSubscriptionEvent } from "../payments/log";
import { SubscriptionEventType, SubscriptionStatus } from "@prisma/client";

export type KeepMyPlanResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Undoes a scheduled cancellation or downgrade per FR-21, T30.
 * Clears cancelAtPeriodEnd, canceledAt, cancellation reasons, and pendingPlanId.
 * Writes CHANGE_UNDONE to SubscriptionEvent (Rule P-18).
 * Takes no payment.
 */
export async function keepMyPlan(params: {
  userId: string;
  requestId: string;
}): Promise<KeepMyPlanResult> {
  const { userId, requestId } = params;

  const sub = await db.subscription.findUnique({
    where: { userId },
  });

  if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
    return { ok: false, error: "No active subscription found to keep." };
  }

  const idempotencyKey = `sub:CHANGE_UNDONE:${sub.id}:${requestId}`;

  await db.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancellationReasonCode: null,
        cancellationReasonText: null,
        pendingPlanId: null,
      },
    });

    await writeSubscriptionEvent(
      {
        idempotencyKey,
        userId,
        type: SubscriptionEventType.CHANGE_UNDONE,
      },
      tx
    );
  }, {
    maxWait: 10000,
    timeout: 20000,
  });

  return { ok: true };
}
