import "server-only";
import { fromProviderAmount } from "./money";
import { writePaymentLog } from "./log";
import { PaymentEventType, EventSource, PaymentOutcome } from "@prisma/client";

// Branded type per PRD §7.2, Rule S-2: Only verifyTransaction can construct this
declare const VerifiedPaymentBrand: unique symbol;

export interface VerifiedPayment {
  readonly [VerifiedPaymentBrand]: true;
  providerTransactionId: string;
  txRef: string;
  flwRef: string;
  amountMinor: number;
  currency: string;
  cardToken?: string | null;
  rawPayload: Record<string, unknown>;
}

export type VerifyTransactionResult =
  | { ok: true; payment: VerifiedPayment }
  | { ok: false; outcome: PaymentOutcome; error: string };

/**
 * Verifies a transaction with Flutterwave via REST API (Rule P-6, P-7, PRD §7.6).
 * Accepts expected session data to cross-check amount, currency, and tx_ref.
 */
export async function verifyTransaction(params: {
  transactionId: string;
  expectedTxRef?: string;
  expectedAmountMinor?: number;
  expectedCurrency?: string;
  source: EventSource;
  userId?: string | null;
  checkoutSessionId?: string | null;
}): Promise<VerifyTransactionResult> {
  const secretKey = process.env.FLW_SECRET_KEY;

  if (!secretKey || !secretKey.startsWith("FLWSECK_TEST-")) {
    return {
      ok: false,
      outcome: PaymentOutcome.PROVIDER_ERROR,
      error: "Flutterwave test secret key is missing or invalid.",
    };
  }

  let rawResponse: Record<string, unknown>;
  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions/${params.transactionId}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    rawResponse = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verify API timeout/failure";
    await writePaymentLog({
      idempotencyKey: `fail:verify:${params.transactionId}:timeout`,
      eventType: PaymentEventType.FAILURE,
      source: params.source,
      userId: params.userId,
      checkoutSessionId: params.checkoutSessionId,
      providerRef: params.expectedTxRef || params.transactionId,
      providerTransactionId: params.transactionId,
      outcome: PaymentOutcome.VERIFY_TIMEOUT,
      payload: { error: message },
    });

    return {
      ok: false,
      outcome: PaymentOutcome.VERIFY_TIMEOUT,
      error: message,
    };
  }

  const data = (rawResponse.data as Record<string, unknown>) ?? {};
  const status = (data.status as string) ?? "";
  const txRef = (data.tx_ref as string) ?? "";
  const flwRef = (data.flw_ref as string) ?? "";
  const currency = (data.currency as string) ?? "";
  const rawAmount = data.amount;

  // 1. Provider status must be successful
  if (status.toLowerCase() !== "successful") {
    const outcome = PaymentOutcome.PROVIDER_ERROR;
    await writePaymentLog({
      idempotencyKey: `fail:verify:${params.transactionId}:${outcome}`,
      eventType: PaymentEventType.FAILURE,
      source: params.source,
      userId: params.userId,
      checkoutSessionId: params.checkoutSessionId,
      providerRef: txRef || params.transactionId,
      providerTransactionId: params.transactionId,
      outcome,
      payload: data as Record<string, unknown>,
    });
    return { ok: false, outcome, error: `Provider status is "${status}".` };
  }

  // 2. Parse provider amount safely without parseFloat (Rule P-3)
  const parsedAmount = fromProviderAmount(rawAmount as number | string);
  if (!parsedAmount.ok) {
    const outcome = PaymentOutcome.AMOUNT_MISMATCH;
    await writePaymentLog({
      idempotencyKey: `fail:verify:${params.transactionId}:amount_format`,
      eventType: PaymentEventType.FAILURE,
      source: params.source,
      userId: params.userId,
      checkoutSessionId: params.checkoutSessionId,
      providerRef: txRef,
      providerTransactionId: params.transactionId,
      outcome,
      payload: data as Record<string, unknown>,
    });
    return { ok: false, outcome, error: parsedAmount.error };
  }

  // 3. Amount and currency must match expected values exactly (Rule P-7)
  if (
    params.expectedAmountMinor !== undefined &&
    parsedAmount.amountMinor !== params.expectedAmountMinor
  ) {
    const outcome = PaymentOutcome.AMOUNT_MISMATCH;
    await writePaymentLog({
      idempotencyKey: `fail:verify:${params.transactionId}:${outcome}`,
      eventType: PaymentEventType.FAILURE,
      source: params.source,
      userId: params.userId,
      checkoutSessionId: params.checkoutSessionId,
      providerRef: txRef,
      providerTransactionId: params.transactionId,
      amountMinor: parsedAmount.amountMinor,
      currency,
      outcome,
      payload: data as Record<string, unknown>,
    });
    return {
      ok: false,
      outcome,
      error: `Amount mismatch: expected ${params.expectedAmountMinor} kobo, got ${parsedAmount.amountMinor} kobo.`,
    };
  }

  if (params.expectedCurrency && currency !== params.expectedCurrency) {
    const outcome = PaymentOutcome.CURRENCY_MISMATCH;
    await writePaymentLog({
      idempotencyKey: `fail:verify:${params.transactionId}:${outcome}`,
      eventType: PaymentEventType.FAILURE,
      source: params.source,
      userId: params.userId,
      checkoutSessionId: params.checkoutSessionId,
      providerRef: txRef,
      providerTransactionId: params.transactionId,
      amountMinor: parsedAmount.amountMinor,
      currency,
      outcome,
      payload: data as Record<string, unknown>,
    });
    return {
      ok: false,
      outcome,
      error: `Currency mismatch: expected ${params.expectedCurrency}, got ${currency}.`,
    };
  }

  // 4. tx_ref match (Rule P-7)
  if (params.expectedTxRef && txRef !== params.expectedTxRef) {
    const outcome = PaymentOutcome.UNMATCHED_REFERENCE;
    await writePaymentLog({
      idempotencyKey: `fail:verify:${params.transactionId}:${outcome}`,
      eventType: PaymentEventType.FAILURE,
      source: params.source,
      userId: params.userId,
      checkoutSessionId: params.checkoutSessionId,
      providerRef: txRef,
      providerTransactionId: params.transactionId,
      outcome,
      payload: data as Record<string, unknown>,
    });
    return { ok: false, outcome, error: "Reference mismatch." };
  }

  // Write VERIFICATION payment log (Rule P-15)
  // Pass data (not rawResponse) so sanitizePayload can extract id, tx_ref, amount etc (P-17)
  await writePaymentLog({
    idempotencyKey: `verify:${params.source.toLowerCase()}:${params.transactionId}`,
    eventType: PaymentEventType.VERIFICATION,
    source: params.source,
    userId: params.userId,
    checkoutSessionId: params.checkoutSessionId,
    providerRef: txRef,
    providerTransactionId: params.transactionId,
    amountMinor: parsedAmount.amountMinor,
    currency,
    outcome: PaymentOutcome.SUCCESS,
    payload: data as Record<string, unknown>,
  });

  // Extract reusable card token if present (PRD §7.6, Rule P-19)
  const cardObj = (data.card as Record<string, unknown>) ?? {};
  const cardToken = (cardObj.token as string) ?? null;

  return {
    ok: true,
    payment: {
      providerTransactionId: params.transactionId,
      txRef,
      flwRef,
      amountMinor: parsedAmount.amountMinor,
      currency,
      cardToken,
      rawPayload: data as Record<string, unknown>,
    } as VerifiedPayment,
  };
}
