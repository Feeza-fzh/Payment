import "server-only";
import { getClock } from "../clock";
import { GRACE_PERIOD_DAYS } from "../constants";
import type { User, PlanTier, SubscriptionStatus } from "@prisma/client";

export interface EffectivePlanInput {
  plan: PlanTier;
  subscription?: {
    status: SubscriptionStatus;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    graceEndsAt: Date | null;
  } | null;
}

/**
 * The only reader of plan state for access decisions (Rule P-9, S-3, PRD §7.3).
 * Never read User.plan directly for gating access.
 */
export function effectivePlan(user: EffectivePlanInput | User | null | undefined): PlanTier {
  if (!user || !("subscription" in user) || !user.subscription) {
    return "FREE";
  }

  const { subscription } = user;
  const now = getClock().now();

  // 1. ENDED status drops immediately to FREE
  if (subscription.status === "ENDED") {
    return "FREE";
  }

  // 2. Cancellation scheduled: access ends when currentPeriodEnd passes
  if (subscription.cancelAtPeriodEnd && now > subscription.currentPeriodEnd) {
    return "FREE";
  }

  // 3. PAST_DUE: access continues until graceEndsAt
  if (subscription.status === "PAST_DUE") {
    if (!subscription.graceEndsAt || now > subscription.graceEndsAt) {
      return "FREE";
    }
    return user.plan;
  }

  // 4. ACTIVE without renewal: expires at currentPeriodEnd + 3 days
  if (subscription.status === "ACTIVE") {
    const hardExpiry = new Date(
      subscription.currentPeriodEnd.getTime() +
        GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
    );
    if (now > hardExpiry) {
      return "FREE";
    }
    return user.plan;
  }

  return "FREE";
}
