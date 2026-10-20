import "server-only";
import { createHostedPaymentLink } from "./flutterwaveClient";

export type InitiateCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Initiates a hosted checkout flow for a chosen plan tier.
 * PRD §7.5, FR-3
 */
export async function initiateCheckout(params: {
  planTier: "MONTHLY" | "YEARLY";
  userEmail: string;
}): Promise<InitiateCheckoutResult> {
  const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";

  // PRD §8 price placeholders in whole naira (NGN)
  const amount = params.planTier === "YEARLY" ? 50000 : 5000;
  const planLabel = params.planTier === "YEARLY" ? "Yearly" : "Monthly";

  const txRef = `sub_${params.planTier.toLowerCase()}_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 8)}`;

  const result = await createHostedPaymentLink({
    txRef,
    amount,
    currency: "NGN",
    redirectUrl: `${appBaseUrl}/billing/return`,
    customer: {
      email: params.userEmail,
    },
    customizations: {
      title: `SubSlice ${planLabel} Plan`,
      description: `Subscription to SubSlice ${planLabel} tier`,
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
    };
  }

  return {
    ok: true,
    checkoutUrl: result.link,
  };
}
