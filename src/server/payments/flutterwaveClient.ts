import "server-only";

/**
 * Parameters for creating a Flutterwave Standard hosted checkout payment link.
 * PRD §7.5 / Rule L-6
 */
export interface CreateHostedPaymentParams {
  txRef: string;
  amount: number; // in NGN whole naira
  currency: string;
  redirectUrl: string;
  customer: {
    email: string;
    name?: string;
  };
  customizations?: {
    title?: string;
    description?: string;
  };
}

export type CreateHostedPaymentResult =
  | { ok: true; link: string }
  | { ok: false; error: string; code?: string };

/**
 * Flutterwave standard hosted payment endpoint caller.
 * Single job: every HTTP call to Flutterwave (Rule L-6).
 * Enforces test mode only (Rule P-21).
 */
export async function createHostedPaymentLink(
  params: CreateHostedPaymentParams
): Promise<CreateHostedPaymentResult> {
  const secretKey = process.env.FLW_SECRET_KEY;

  // PRD §7.4, Rule P-21: Boot check refuses non-test keys
  if (!secretKey || !secretKey.startsWith("FLWSECK_TEST-")) {
    return {
      ok: false,
      error:
        "Flutterwave test mode secret key is missing or invalid. FLW_SECRET_KEY must start with 'FLWSECK_TEST-'.",
      code: "INVALID_TEST_KEY",
    };
  }

  try {
    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        tx_ref: params.txRef,
        amount: params.amount,
        currency: params.currency,
        redirect_url: params.redirectUrl,
        customer: params.customer,
        customizations: params.customizations,
        payment_options: "card",
      }),
    });

    const data = (await response.json()) as {
      status?: string;
      message?: string;
      data?: { link?: string };
    };

    if (response.ok && data.status === "success" && data.data?.link) {
      return {
        ok: true,
        link: data.data.link,
      };
    }

    return {
      ok: false,
      error: data.message || "Failed to create Flutterwave checkout session",
      code: "PROVIDER_ERROR",
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown network error";
    return {
      ok: false,
      error: message,
      code: "NETWORK_ERROR",
    };
  }
}
