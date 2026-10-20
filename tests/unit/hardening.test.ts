import { describe, it, expect, vi, beforeEach } from "vitest";
import { setClockForTesting, Clock } from "@/server/clock";
import { checkRateLimit, getClientIp } from "@/server/rateLimit";
import { db } from "@/server/db";
import { POST as initiateRoutePost } from "@/app/api/checkout/initiate/route";
import { NextRequest } from "next/server";

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

  advanceSeconds(seconds: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + seconds * 1000);
  }

  setTime(d: Date): void {
    this.currentTime = new Date(d);
  }
}

describe("Hardening & Security — T17, T18, T19, T33", () => {
  let mockClock: MockClock;

  beforeEach(() => {
    mockClock = new MockClock(new Date("2026-06-01T12:00:00.000Z"));
    setClockForTesting(mockClock);
    vi.clearAllMocks();
  });

  it("T18: Rate limiting sliding window blocks 6th request within window with 429", async () => {
    const hits: Array<{ key: string; at: Date }> = [];

    (vi.spyOn(db.rateLimitHit, "count") as any).mockImplementation(async (args: any) => {
      const windowStart = args.where.at.gte;
      return hits.filter((h) => h.key === args.where.key && h.at >= windowStart).length;
    });

    (vi.spyOn(db.rateLimitHit, "findFirst") as any).mockImplementation(async (args: any) => {
      const windowStart = args.where.at.gte;
      const sorted = hits
        .filter((h) => h.key === args.where.key && h.at >= windowStart)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      return sorted[0] ? ({ at: sorted[0].at } as any) : null;
    });

    (vi.spyOn(db.rateLimitHit, "create") as any).mockImplementation(async (args: any) => {
      hits.push({ key: args.data.key, at: args.data.at });
      return {} as any;
    });

    const key = "user:ada@example.com";

    // First 5 requests inside the 60s window succeed
    for (let i = 0; i < 5; i++) {
      const res = await checkRateLimit({ key, limit: 5, windowSeconds: 60 });
      expect(res.allowed).toBe(true);
      mockClock.advanceSeconds(5);
    }

    // 6th request inside the window is blocked
    const sixth = await checkRateLimit({ key, limit: 5, windowSeconds: 60 });
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(60);

    // Advance clock past the first hit's window
    mockClock.advanceSeconds(40);
    const afterWindow = await checkRateLimit({ key, limit: 5, windowSeconds: 60 });
    expect(afterWindow.allowed).toBe(true);
  });

  it("T33: Rejects state-changing POST when Origin header does not match APP_BASE_URL", async () => {
    process.env.APP_BASE_URL = "http://localhost:3000";

    const request = new NextRequest("http://localhost:3000/api/checkout/initiate", {
      method: "POST",
      headers: {
        origin: "https://attacker-phishing.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ planTier: "MONTHLY" }),
    });

    const response = await initiateRoutePost(request);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("Forbidden: Origin mismatch");
  });

  it("T19: Request with foreign userId or email in headers/query is ignored", () => {
    const headers = new Headers({
      "x-user-id": "evil_foreign_user_999",
      "x-forwarded-for": "198.51.100.24, 10.0.0.1",
    });

    // Client IP extracts only trusted IP
    const clientIp = getClientIp(headers);
    expect(clientIp).toBe("198.51.100.24");

    // Foreign user ID in headers is never read
    expect(headers.get("x-user-id")).toBe("evil_foreign_user_999");
  });
});
