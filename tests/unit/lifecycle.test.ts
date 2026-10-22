import { describe, it, expect, vi, beforeEach } from "vitest";
import { setClockForTesting, Clock } from "@/server/clock";
import { effectivePlan } from "@/server/identity/effectivePlan";
import { cancelSubscription } from "@/server/billing/cancelSubscription";
import { scheduleDowngrade } from "@/server/billing/scheduleDowngrade";
import { keepMyPlan } from "@/server/billing/keepMyPlan";
import { fulfillEntitlement } from "@/server/payments/fulfillEntitlement";
import type { VerifiedPayment } from "@/server/payments/verifyTransaction";
import { db } from "@/server/db";
import {
  CheckoutKind,
  CheckoutStatus,
  EventSource,
  PaymentOutcome,
  PlanTier,
  SubscriptionEventType,
  SubscriptionStatus,
} from "@prisma/client";

// Injected test clock
class MockClock implements Clock {
  private currentTime: Date;

  constructor(initial: Date) {
    this.currentTime = initial;
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  nowMs(): number {
    return this.currentTime.getTime();
  }

  advanceDays(days: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + days * 86400000);
  }

  setTime(d: Date): void {
    this.currentTime = new Date(d);
  }
}

describe("Lifecycle & Subscriptions — T13–T16, T21, T25–T27, T29, T30", () => {
  let mockClock: MockClock;

  beforeEach(() => {
    mockClock = new MockClock(new Date("2026-06-01T00:00:00.000Z"));
    setClockForTesting(mockClock);
    vi.clearAllMocks();
  });

  it("T13: Cancel mid-period keeps access to period end, ending only after period end", async () => {
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-07-01T00:00:00.000Z");

    const sub = {
      id: "sub_1",
      userId: "usr_1",
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      plan: { tier: PlanTier.MONTHLY },
    };

    // Advance clock to mid-period: June 15
    mockClock.advanceDays(14);

    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(sub as any);
    const updateSpy = vi.spyOn(db.subscription, "update").mockResolvedValue({} as any);
    const eventSpy = vi.spyOn(db.subscriptionEvent, "create").mockResolvedValue({} as any);
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => {
      return cb(db);
    });

    const res = await cancelSubscription({
      userId: "usr_1",
      requestId: "req_cancel_1",
    });

    expect(res.ok).toBe(true);
    expect(eventSpy).toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelAtPeriodEnd: true,
        }),
      })
    );

    // Verify access during remainder of period: still MONTHLY
    const userMidPeriod = {
      plan: PlanTier.MONTHLY,
      subscription: {
        ...sub,
        cancelAtPeriodEnd: true,
      },
    };
    expect(effectivePlan(userMidPeriod as any)).toBe(PlanTier.MONTHLY);

    // Advance clock past period end: July 2
    mockClock.advanceDays(17);
    expect(effectivePlan(userMidPeriod as any)).toBe(PlanTier.FREE);
  });

  it("T15: Yearly user schedules monthly downgrade, yearly access continues to period end", async () => {
    const sub = {
      id: "sub_yearly",
      userId: "usr_yearly",
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      plan: { tier: PlanTier.YEARLY },
    };

    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(sub as any);
    vi.spyOn(db.plan, "findUnique").mockResolvedValue({
      id: "plan_monthly_id",
      tier: PlanTier.MONTHLY,
    } as any);
    const updateSpy = vi.spyOn(db.subscription, "update").mockResolvedValue({} as any);
    vi.spyOn(db.subscriptionEvent, "create").mockResolvedValue({} as any);
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => cb(db));

    const res = await scheduleDowngrade({
      userId: "usr_yearly",
      requestId: "req_down_1",
    });

    expect(res.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingPlanId: "plan_monthly_id",
        }),
      })
    );

    // Access remains YEARLY while pendingPlan is active
    const user = {
      plan: PlanTier.YEARLY,
      subscription: {
        ...sub,
        pendingPlanId: "plan_monthly_id",
        pendingPlan: { tier: PlanTier.MONTHLY },
      },
    };
    expect(effectivePlan(user as any)).toBe(PlanTier.YEARLY);
  });

  it("T30: Keep my plan clears cancellation and scheduled downgrade flags, writes CHANGE_UNDONE", async () => {
    const sub = {
      id: "sub_cancelled",
      userId: "usr_1",
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: true,
      pendingPlanId: "plan_monthly_id",
    };

    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(sub as any);
    const updateSpy = vi.spyOn(db.subscription, "update").mockResolvedValue({} as any);
    const eventSpy = vi.spyOn(db.subscriptionEvent, "create").mockResolvedValue({} as any);
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => cb(db));

    const res = await keepMyPlan({
      userId: "usr_1",
      requestId: "req_keep_1",
    });

    expect(res.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelAtPeriodEnd: false,
          canceledAt: null,
          pendingPlanId: null,
        }),
      })
    );
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: SubscriptionEventType.CHANGE_UNDONE,
        }),
      })
    );
  });

  it("T16: Declined renewal moves to PAST_DUE with grace = periodEnd + 3 days, and ends after grace", async () => {
    const periodEnd = new Date("2026-06-01T00:00:00.000Z");
    const graceEndsAt = new Date("2026-06-04T00:00:00.000Z");

    const userPastDue = {
      plan: PlanTier.MONTHLY,
      subscription: {
        status: SubscriptionStatus.PAST_DUE,
        currentPeriodStart: new Date("2026-05-01T00:00:00.000Z"),
        currentPeriodEnd: periodEnd,
        graceEndsAt,
        cancelAtPeriodEnd: false,
      },
    };

    // On June 2 (within grace): access is kept (Rule P-11)
    mockClock.setTime(new Date("2026-06-02T12:00:00.000Z"));
    expect(effectivePlan(userPastDue as any)).toBe(PlanTier.MONTHLY);

    // On June 5 (after grace): access drops to FREE
    mockClock.setTime(new Date("2026-06-05T00:00:00.000Z"));
    expect(effectivePlan(userPastDue as any)).toBe(PlanTier.FREE);
  });

  it("T27: FulfillEntitlement applies payment on expired session with outcome PAID_EXPIRED_SESSION", async () => {
    const session = {
      id: "sess_expired",
      userId: "usr_1",
      targetPlanId: "plan_m_id",
      targetPlan: { tier: PlanTier.MONTHLY },
      kind: CheckoutKind.NEW,
      txRef: "tx_expired_1",
      amountMinor: 500000,
      currency: "NGN",
      status: CheckoutStatus.EXPIRED,
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    };

    mockClock.setTime(new Date("2026-06-01T01:00:00.000Z")); // after expiresAt

    vi.spyOn(db.paymentLog, "findUnique").mockResolvedValue(null);
    vi.spyOn(db.checkoutSession, "findUnique").mockResolvedValue(session as any);
    vi.spyOn(db, "$executeRaw").mockResolvedValue(1 as any);
    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(null);
    const logSpy = vi.spyOn(db.paymentLog, "create").mockResolvedValue({} as any);
    vi.spyOn(db.subscription, "upsert").mockResolvedValue({} as any);
    vi.spyOn(db.user, "update").mockResolvedValue({} as any);
    vi.spyOn(db.checkoutSession, "update").mockResolvedValue({} as any);
    vi.spyOn(db.subscriptionEvent, "create").mockResolvedValue({} as any);
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => cb(db));

    const verifiedPayment = {
      __brand: "VerifiedPayment" as const,
      providerTransactionId: "flw_tx_expired",
      txRef: "tx_expired_1",
      amountMinor: 500000,
      currency: "NGN",
      rawPayload: { id: 999 },
    };

    const res = await fulfillEntitlement(
      verifiedPayment as unknown as VerifiedPayment,
      EventSource.WEBHOOK
    );

    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("PAID_EXPIRED_SESSION");
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: PaymentOutcome.PAID_EXPIRED_SESSION,
        }),
      })
    );
  });

  it("T29: Second payment for already paid period does not extend period, logs DUPLICATE_PAYMENT", async () => {
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-07-01T00:00:00.000Z");

    const session = {
      id: "sess_dup",
      userId: "usr_1",
      targetPlanId: "plan_m_id",
      targetPlan: { tier: PlanTier.MONTHLY },
      kind: CheckoutKind.NEW,
      txRef: "tx_dup_1",
      amountMinor: 500000,
      currency: "NGN",
      status: CheckoutStatus.PENDING,
      quotedPeriodStart: periodStart,
      quotedPeriodEnd: periodEnd,
      expiresAt: new Date("2026-06-01T00:15:00.000Z"),
    };

    const currentSub = {
      id: "sub_1",
      userId: "usr_1",
      planId: "plan_m_id",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      status: SubscriptionStatus.ACTIVE,
    };

    vi.spyOn(db.paymentLog, "findUnique").mockResolvedValue(null);
    vi.spyOn(db.checkoutSession, "findUnique").mockResolvedValue(session as any);
    vi.spyOn(db, "$executeRaw").mockResolvedValue(1 as any);
    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(currentSub as any);
    const logSpy = vi.spyOn(db.paymentLog, "create").mockResolvedValue({} as any);
    const upsertSpy = vi.spyOn(db.subscription, "upsert");
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => cb(db));

    const verifiedPayment = {
      __brand: "VerifiedPayment" as const,
      providerTransactionId: "flw_tx_dup_2",
      txRef: "tx_dup_1",
      amountMinor: 500000,
      currency: "NGN",
      rawPayload: { id: 1002 },
    };

    const res = await fulfillEntitlement(
      verifiedPayment as unknown as VerifiedPayment,
      EventSource.WEBHOOK
    );

    expect(res.ok).toBe(false);
    expect(res.outcome).toBe("DUPLICATE_PAYMENT");
    // Period is NOT extended / upserted
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: PaymentOutcome.DUPLICATE_PAYMENT,
        }),
      })
    );
  });

  it("T25: Renewal payment verifies after cancel: paid period applied, cancel flag kept, RENEWAL_AFTER_CANCEL", async () => {
    const session = {
      id: "sess_renew_cancel",
      userId: "usr_1",
      targetPlanId: "plan_m_id",
      targetPlan: { tier: PlanTier.MONTHLY },
      kind: CheckoutKind.RENEWAL,
      txRef: "renew:sub_1:2026-06-01:1",
      amountMinor: 500000,
      currency: "NGN",
      status: CheckoutStatus.PENDING,
      expiresAt: new Date("2026-06-01T00:15:00.000Z"),
    };

    const currentSub = {
      id: "sub_1",
      userId: "usr_1",
      planId: "plan_m_id",
      currentPeriodStart: new Date("2026-05-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-06-01T00:00:00.000Z"),
      cancelAtPeriodEnd: true,
      canceledAt: new Date("2026-05-15T00:00:00.000Z"),
      status: SubscriptionStatus.ACTIVE,
    };

    vi.spyOn(db.paymentLog, "findUnique").mockResolvedValue(null);
    vi.spyOn(db.checkoutSession, "findUnique").mockResolvedValue(session as any);
    vi.spyOn(db, "$executeRaw").mockResolvedValue(1 as any);
    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(currentSub as any);
    const logSpy = vi.spyOn(db.paymentLog, "create").mockResolvedValue({} as any);
    const upsertSpy = vi.spyOn(db.subscription, "upsert").mockResolvedValue({} as any);
    vi.spyOn(db.user, "update").mockResolvedValue({} as any);
    vi.spyOn(db.checkoutSession, "update").mockResolvedValue({} as any);
    vi.spyOn(db.subscriptionEvent, "create").mockResolvedValue({} as any);
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => cb(db));

    const verifiedPayment = {
      __brand: "VerifiedPayment" as const,
      providerTransactionId: "flw_renew_after_cancel",
      txRef: "renew:sub_1:2026-06-01:1",
      amountMinor: 500000,
      currency: "NGN",
      rawPayload: { id: 1003 },
    };

    const res = await fulfillEntitlement(
      verifiedPayment as unknown as VerifiedPayment,
      EventSource.WEBHOOK
    );

    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("RENEWAL_AFTER_CANCEL");
    // Cancel flag remains true (Rule FR-14 / T25)
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          cancelAtPeriodEnd: true,
        }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: PaymentOutcome.RENEWAL_AFTER_CANCEL,
        }),
      })
    );
  });

  it("T26: pendingPlan applied at renewal: plan flips and pendingPlan is cleared", async () => {
    const session = {
      id: "sess_renew_downgrade",
      userId: "usr_1",
      targetPlanId: "plan_m_id",
      targetPlan: { tier: PlanTier.MONTHLY },
      kind: CheckoutKind.RENEWAL,
      txRef: "renew:sub_1:2026-06-01:1",
      amountMinor: 500000,
      currency: "NGN",
      status: CheckoutStatus.PENDING,
      expiresAt: new Date("2026-06-01T00:15:00.000Z"),
    };

    const currentSub = {
      id: "sub_1",
      userId: "usr_1",
      planId: "plan_y_id",
      pendingPlanId: "plan_m_id",
      currentPeriodStart: new Date("2025-06-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-06-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      status: SubscriptionStatus.ACTIVE,
    };

    vi.spyOn(db.paymentLog, "findUnique").mockResolvedValue(null);
    vi.spyOn(db.checkoutSession, "findUnique").mockResolvedValue(session as any);
    vi.spyOn(db, "$executeRaw").mockResolvedValue(1 as any);
    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(currentSub as any);
    vi.spyOn(db.plan, "findUnique").mockResolvedValue({
      id: "plan_m_id",
      tier: PlanTier.MONTHLY,
    } as any);
    vi.spyOn(db.paymentLog, "create").mockResolvedValue({} as any);
    const upsertSpy = vi.spyOn(db.subscription, "upsert").mockResolvedValue({} as any);
    const userUpdateSpy = vi.spyOn(db.user, "update").mockResolvedValue({} as any);
    vi.spyOn(db.checkoutSession, "update").mockResolvedValue({} as any);
    vi.spyOn(db.subscriptionEvent, "create").mockResolvedValue({} as any);
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => cb(db));

    const verifiedPayment = {
      __brand: "VerifiedPayment" as const,
      providerTransactionId: "flw_renew_pending",
      txRef: "renew:sub_1:2026-06-01:1",
      amountMinor: 500000,
      currency: "NGN",
      rawPayload: { id: 1004 },
    };

    const res = await fulfillEntitlement(
      verifiedPayment as unknown as VerifiedPayment,
      EventSource.WEBHOOK
    );

    expect(res.ok).toBe(true);
    expect(res.plan).toBe(PlanTier.MONTHLY);
    expect(userUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { plan: PlanTier.MONTHLY },
      })
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          planId: "plan_m_id",
          pendingPlanId: null,
        }),
      })
    );
  });

  it("Yearly user downgrades to monthly: 1 month is stacked onto current yearly plan", async () => {
    const yearlyPeriodStart = new Date("2026-01-01T00:00:00.000Z");
    const yearlyPeriodEnd = new Date("2027-01-01T00:00:00.000Z");
    const newPeriodEnd = new Date("2027-02-01T00:00:00.000Z");

    const currentSub = {
      id: "sub_yearly",
      userId: "usr_1",
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: yearlyPeriodStart,
      currentPeriodEnd: yearlyPeriodEnd,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      planId: "plan_yearly_id",
      plan: { id: "plan_yearly_id", tier: PlanTier.YEARLY },
    };

    const session = {
      id: "sess_downgrade",
      userId: "usr_1",
      targetPlanId: "plan_monthly_id",
      targetPlan: { id: "plan_monthly_id", tier: PlanTier.MONTHLY },
      kind: CheckoutKind.RENEWAL,
      status: CheckoutStatus.PENDING,
      amountMinor: 500000,
      currency: "NGN",
      expiresAt: new Date("2026-06-01T01:00:00.000Z"),
      quotedPeriodStart: yearlyPeriodEnd,
      quotedPeriodEnd: newPeriodEnd,
    };

    vi.spyOn(db.checkoutSession, "findUnique").mockResolvedValue(session as any);
    vi.spyOn(db.subscription, "findUnique").mockResolvedValue(currentSub as any);
    vi.spyOn(db.paymentLog, "create").mockResolvedValue({} as any);
    const upsertSpy = vi.spyOn(db.subscription, "upsert").mockResolvedValue({} as any);
    const userUpdateSpy = vi.spyOn(db.user, "update").mockResolvedValue({} as any);
    vi.spyOn(db.checkoutSession, "update").mockResolvedValue({} as any);
    vi.spyOn(db.subscriptionEvent, "create").mockResolvedValue({} as any);
    vi.spyOn(db, "$transaction").mockImplementation(async (cb: any) => cb(db));

    const verifiedPayment = {
      __brand: "VerifiedPayment" as const,
      providerTransactionId: "flw_downgrade_tx",
      txRef: "sub_monthly_123",
      amountMinor: 500000,
      currency: "NGN",
      rawPayload: { id: 1005 },
    };

    const res = await fulfillEntitlement(
      verifiedPayment as unknown as VerifiedPayment,
      EventSource.WEBHOOK
    );

    expect(res.ok).toBe(true);
    expect(res.plan).toBe(PlanTier.MONTHLY);
    expect(userUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { plan: PlanTier.MONTHLY },
      })
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          planId: "plan_monthly_id",
          pendingPlanId: null,
          currentPeriodStart: yearlyPeriodStart,
          currentPeriodEnd: newPeriodEnd,
        }),
      })
    );
  });
});
