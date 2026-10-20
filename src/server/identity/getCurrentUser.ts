import "server-only";
import { db } from "../db";
import type { User, Subscription, Plan } from "@prisma/client";

export type UserWithSubscription = User & {
  subscription: (Subscription & { plan: Plan; pendingPlan: Plan | null }) | null;
};

/**
 * Returns the single seeded user who acts as the signed-in user (Rule P-22, PRD §7.3).
 * Never reads user ID from request body, query, cookies, or headers (Rule P-23).
 */
export async function getCurrentUser(): Promise<UserWithSubscription | null> {
  const email = process.env.SEED_USER_EMAIL || "ada@example.com";

  try {
    const user = await db.user.findUnique({
      where: { email },
      include: {
        subscription: {
          include: {
            plan: true,
            pendingPlan: true,
          },
        },
      },
    });

    return user;
  } catch {
    // If DB is offline or not yet migrated, returns null
    return null;
  }
}
