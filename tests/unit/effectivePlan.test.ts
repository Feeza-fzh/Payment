import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { effectivePlan } from "@/server/identity/effectivePlan";
import { setClockForTesting } from "@/server/clock";
import type { Clock } from "@/server/clock";

class MockClock implements Clock {
  constructor(private currentTime: Date) {}
  now(): Date {
    return this.currentTime;
  }
  nowMs(): number {
    return this.currentTime.getTime();
  }
  setTime(time: Date): void {
    this.currentTime = time;
  }
}

describe("Effective Plan Access Logic — Rule P-9, PRD §7.3", () => {
  let mockClock: MockClock;

  beforeEach(() => {
    mockClock = new MockClock(new Date("2026-05-15T12:00:00Z"));
    setClockForTesting(mockClock);
  });

  afterEach(() => {
    setClockForTesting({
      now: () => new Date(),
      nowMs: () => Date.now(),
    });
  });

  it("returns FREE for users without an active subscription", () => {
    expect(effectivePlan(null)).toBe("FREE");
    expect(effectivePlan({ plan: "FREE", subscription: null })).toBe("FREE");
  });

  it("returns FREE immediately if subscription status is ENDED", () => {
    const result = effectivePlan({
      plan: "MONTHLY",
      subscription: {
        status: "ENDED",
        currentPeriodEnd: new Date("2026-05-20T12:00:00Z"),
        cancelAtPeriodEnd: false,
        graceEndsAt: null,
      },
    });
    expect(result).toBe("FREE");
  });

  it("returns plan while active and period has not ended", () => {
    const result = effectivePlan({
      plan: "MONTHLY",
      subscription: {
        status: "ACTIVE",
        currentPeriodEnd: new Date("2026-05-20T12:00:00Z"),
        cancelAtPeriodEnd: false,
        graceEndsAt: null,
      },
    });
    expect(result).toBe("MONTHLY");
  });

  it("keeps paid access to period end after cancel is scheduled (Rule P-10)", () => {
    // Before period end: active plan preserved
    const beforeEnd = effectivePlan({
      plan: "YEARLY",
      subscription: {
        status: "ACTIVE",
        currentPeriodEnd: new Date("2026-05-20T12:00:00Z"),
        cancelAtPeriodEnd: true,
        graceEndsAt: null,
      },
    });
    expect(beforeEnd).toBe("YEARLY");

    // After period end: drops to FREE
    mockClock.setTime(new Date("2026-05-21T00:00:00Z"));
    const afterEnd = effectivePlan({
      plan: "YEARLY",
      subscription: {
        status: "ACTIVE",
        currentPeriodEnd: new Date("2026-05-20T12:00:00Z"),
        cancelAtPeriodEnd: true,
        graceEndsAt: null,
      },
    });
    expect(afterEnd).toBe("FREE");
  });

  it("maintains access during PAST_DUE grace window and expires after grace (Rule P-11)", () => {
    const graceEndsAt = new Date("2026-05-18T12:00:00Z");

    // Inside grace window
    const insideGrace = effectivePlan({
      plan: "MONTHLY",
      subscription: {
        status: "PAST_DUE",
        currentPeriodEnd: new Date("2026-05-15T10:00:00Z"),
        cancelAtPeriodEnd: false,
        graceEndsAt,
      },
    });
    expect(insideGrace).toBe("MONTHLY");

    // Past grace window
    mockClock.setTime(new Date("2026-05-19T00:00:00Z"));
    const afterGrace = effectivePlan({
      plan: "MONTHLY",
      subscription: {
        status: "PAST_DUE",
        currentPeriodEnd: new Date("2026-05-15T10:00:00Z"),
        cancelAtPeriodEnd: false,
        graceEndsAt,
      },
    });
    expect(afterGrace).toBe("FREE");
  });
});
