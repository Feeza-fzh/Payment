import "server-only";
import { db } from "../db";
import { writeSubscriptionEvent } from "../payments/log";
import {
  PlanTier,
  SubscriptionEventType,
  SubscriptionStatus,
} from "@prisma/client";

export type ScheduleDowngradeResult =
  | { ok: true; effectiveDate: Date }
  | { ok: false; error: string };

/**
 * Schedules downgrade from yearly to monthly per FR-16, T15, and Rule P-10.
 * Applies at period end. Yearly access continues until currentPeriodEnd.
 * Writes DOWNGRADE_SCHEDULED to SubscriptionEvent (Rule P-18).
 */
export async function scheduleDowngrade(params: {
  userId: string;
  requestId: string;
}): Promise<ScheduleDowngradeResult> {
  const { userId, requestId } = params;

  const sub = await db.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });

  if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
    return { ok: false, error: "No active subscription found." };
  }

  if (sub.plan.tier !== PlanTier.YEARLY) {
    return { ok: false, error: "Only yearly subscriptions can schedule a downgrade to monthly." };
  }

  const monthlyPlan = await db.plan.findUnique({
    where: { tier: PlanTier.MONTHLY },
  });

  if (!monthlyPlan) {
    return { ok: false, error: "Monthly plan not found." };
  }

  const idempotencyKey = `sub:DOWNGRADE_SCHEDULED:${sub.id}:${requestId}`;

  await db.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        pendingPlanId: monthlyPlan.id,
      },
    });

    await writeSubscriptionEvent(
      {
        idempotencyKey,
        userId,
        type: SubscriptionEventType.DOWNGRADE_SCHEDULED,
      },
      tx
    );
  });

  return { ok: true, effectiveDate: sub.currentPeriodEnd };
}
