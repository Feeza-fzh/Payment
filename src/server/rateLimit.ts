import "server-only";
import { db } from "./db";
import { getClock } from "./clock";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Sliding window rate limiter using the RateLimitHit PostgreSQL table (Rule P-25, PRD §7.11).
 * Counts hits in [now - windowSeconds, now].
 * Returns 429 Retry-After when over limit.
 */
export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = params;
  const now = getClock().now();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);

  const count = await db.rateLimitHit.count({
    where: {
      key,
      at: { gte: windowStart },
    },
  });

  if (count >= limit) {
    const oldestHit = await db.rateLimitHit.findFirst({
      where: {
        key,
        at: { gte: windowStart },
      },
      orderBy: { at: "asc" },
    });

    const oldestTime = oldestHit?.at.getTime() ?? windowStart.getTime();
    const retryAfterMs = oldestTime + windowSeconds * 1000 - now.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    return {
      allowed: false,
      retryAfterSeconds,
    };
  }

  // Record this hit
  await db.rateLimitHit.create({
    data: {
      key,
      at: now,
    },
  });

  return { allowed: true };
}

/**
 * Extracts client IP from trusted headers per PRD §7.11.
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "127.0.0.1";
}
