import "server-only";
import { db } from "../db";
import { getCurrentUser } from "../identity/getCurrentUser";
import { verifyTransaction } from "./verifyTransaction";
import { fulfillEntitlement } from "./fulfillEntitlement";
import { EventSource, CheckoutStatus } from "@prisma/client";

export type ReturnViewStatus =
  | "CONFIRMED"
  | "PROCESSING"
  | "UNKNOWN_REF"
  | "FAILED";

export interface HandleVerifiedReturnResult {
  status: ReturnViewStatus;
  message: string;
  plan?: string;
}

/**
 * Handles payment verification when user returns from Flutterwave hosted checkout (Rule P-5, P-6, FR-6, FR-7).
 * The 'status' query parameter from the browser is completely ignored (Rule P-5).
 */
export async function handleVerifiedReturn(
  txRef: string | null | undefined,
  transactionId?: string | null
): Promise<HandleVerifiedReturnResult> {
  if (!txRef) {
    return {
      status: "UNKNOWN_REF",
      message: "We could not find this payment. Missing transaction reference.",
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      status: "UNKNOWN_REF",
      message: "We could not find this payment. Account or session not found.",
    };
  }

  // Find the user's checkout session matching txRef
  const session = await db.checkoutSession.findFirst({
    where: {
      txRef,
      userId: user.id,
    },
    include: { targetPlan: true },
  });

  if (!session) {
    return {
      status: "UNKNOWN_REF",
      message: "We could not find this payment. Reference does not match any known checkout session.",
    };
  }

  // If already completed in DB (e.g. webhook won the race)
  if (session.status === CheckoutStatus.COMPLETED) {
    return {
      status: "CONFIRMED",
      message: "Your payment has been confirmed!",
      plan: session.targetPlan.tier,
    };
  }

  // If transactionId is missing, check if the webhook already fulfilled it (FR-7)
  // Flutterwave occasionally omits transaction_id on the redirect URL
  if (!transactionId) {
    // Re-fetch session in case webhook completed it between page load and this check
    const freshSession = await db.checkoutSession.findFirst({
      where: { txRef, userId: user.id },
      include: { targetPlan: true },
    });
    if (freshSession?.status === "COMPLETED") {
      return {
        status: "CONFIRMED",
        message: "Your payment has been confirmed!",
        plan: freshSession.targetPlan.tier,
      };
    }
    return {
      status: "PROCESSING",
      message: "We are waiting for payment confirmation from Flutterwave. Please check back shortly or contact support if this persists.",
    };
  }

  // Verify server-side with Flutterwave (Rule P-6, P-7)
  const verifyResult = await verifyTransaction({
    transactionId,
    expectedTxRef: session.txRef,
    expectedAmountMinor: session.amountMinor,
    expectedCurrency: session.currency,
    source: EventSource.RETURN,
    userId: session.userId,
    checkoutSessionId: session.id,
  });

  if (!verifyResult.ok) {
    return {
      status: "FAILED",
      message: `Payment verification failed: ${verifyResult.error}`,
    };
  }

  // Fulfill entitlement (Rule S-2, PRD §7.8)
  const fulfillResult = await fulfillEntitlement(
    verifyResult.payment,
    EventSource.RETURN
  );

  if (fulfillResult.ok) {
    return {
      status: "CONFIRMED",
      message: "Your payment has been confirmed!",
      plan: fulfillResult.plan || session.targetPlan.tier,
    };
  }

  return {
    status: "FAILED",
    message: fulfillResult.error || "Failed to grant plan entitlement.",
  };
}
