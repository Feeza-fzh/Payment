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
 * Parameters for charging a saved card token via Flutterwave tokenized charge.
 * PRD §5.3 FR-22 / Rule L-6, L-9
 */
export interface ChargeCardTokenParams {
  token: string;
  currency: string;
  amount: number; // in NGN whole naira
  email: string;
  txRef: string;
}

export type ChargeCardTokenResult =
  | { ok: true; providerTransactionId: string; status: string }
  | { ok: false; error: string; code?: string };

/**
 * Validates that the secret key starts with Flutterwave's test key pattern (Rule P-21).
 */
function getValidatedTestKey(): { ok: true; secretKey: string } | { ok: false; error: string } {
  const secretKey = process.env.FLW_SECRET_KEY;
  if (!secretKey || !secretKey.startsWith("FLWSECK_TEST-")) {
    return {
      ok: false,
      error:
        "Flutterwave test mode secret key is missing or invalid. FLW_SECRET_KEY must start with 'FLWSECK_TEST-'.",
    };
  }
  return { ok: true, secretKey };
}

/**
 * Flutterwave standard hosted payment endpoint caller.
 * Single job: every HTTP call to Flutterwave (Rule L-6).
 * Enforces test mode only (Rule P-21).
 */
export async function createHostedPaymentLink(
  params: CreateHostedPaymentParams
): Promise<CreateHostedPaymentResult> {
  const keyCheck = getValidatedTestKey();
  if (!keyCheck.ok) {
    return { ok: false, error: keyCheck.error, code: "INVALID_TEST_KEY" };
  }

  try {
    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keyCheck.secretKey}`,
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

/**
 * Charges a saved card token via Flutterwave tokenized charge endpoint (Rule L-6, L-9, FR-22).
 */
export async function chargeCardToken(
  params: ChargeCardTokenParams
): Promise<ChargeCardTokenResult> {
  const keyCheck = getValidatedTestKey();
  if (!keyCheck.ok) {
    return { ok: false, error: keyCheck.error, code: "INVALID_TEST_KEY" };
  }

  try {
    const response = await fetch(
      "https://api.flutterwave.com/v3/tokenized-charges",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keyCheck.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          token: params.token,
          currency: params.currency,
          country: "NG",
          amount: params.amount,
          email: params.email,
          tx_ref: params.txRef,
        }),
      }
    );

    const data = (await response.json()) as {
      status?: string;
      message?: string;
      data?: { id?: number | string; status?: string };
    };

    if (
      response.ok &&
      data.status === "success" &&
      data.data?.status === "successful" &&
      data.data?.id
    ) {
      return {
        ok: true,
        providerTransactionId: String(data.data.id),
        status: data.data.status,
      };
    }

    return {
      ok: false,
      error: data.message || "Card charge declined or failed",
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
