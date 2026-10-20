import "server-only";
import { createHash } from "crypto";
import { db } from "../db";
import { MAX_WEBHOOK_BODY_BYTES } from "../constants";
import { verifyTransaction } from "./verifyTransaction";
import { fulfillEntitlement } from "./fulfillEntitlement";
import { writePaymentLog } from "./log";
import { PaymentEventType, EventSource, PaymentOutcome } from "@prisma/client";

export interface HandleWebhookResult {
  status: number;
  message: string;
}

/**
 * Handles incoming Flutterwave webhook events (Rule P-12, P-13, PRD §7.7).
 */
export async function handleWebhook(
  rawBody: string,
  signatureHeader: string | null
): Promise<HandleWebhookResult> {
  // 1. Cap raw body at 64 KB (Rule P-12, PRD §7.7, T32)
  const byteLength = Buffer.byteLength(rawBody, "utf8");
  if (byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return { status: 413, message: "Payload Too Large: exceeded 64 KB cap." };
  }

  const expectedSecretHash = process.env.FLW_WEBHOOK_SECRET_HASH;

  // 2. Signature verification before parsing or touching the DB (Rule P-12, T3)
  if (!signatureHeader || signatureHeader !== expectedSecretHash) {
    const bodySha256 = createHash("sha256").update(rawBody).digest("hex");

    // Store only SHA-256 of the body and signature header (Rule P-12)
    try {
      await writePaymentLog({
        idempotencyKey: `fail:sig:${bodySha256}`,
        eventType: PaymentEventType.FAILURE,
        source: EventSource.WEBHOOK,
        providerRef: "unknown",
        outcome: PaymentOutcome.SIGNATURE_INVALID,
        payload: {
          body_sha256: bodySha256,
          signature_header: signatureHeader,
        },
      });
    } catch {
      // Ignore DB logging failure during invalid signature
    }

    return { status: 401, message: "Unauthorized: Invalid webhook signature." };
  }

  // 3. Parse JSON
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, message: "Bad Request: Malformed JSON." };
  }

  const eventType = payload.event as string | undefined;
  const data = (payload.data as Record<string, unknown>) ?? {};
  const providerTransactionId = String(data.id ?? "");
  const txRef = String(data.tx_ref ?? "");

  // Only process charge.completed events; ignore others with 200 (PRD §7.7)
  if (eventType !== "charge.completed" || !providerTransactionId) {
    return { status: 200, message: "Ignored: non-charge event." };
  }

  // 4. Idempotency check on provider transaction ID (Rule P-13, T2)
  const existingFulfilment = await db.paymentLog.findUnique({
    where: { idempotencyKey: `fulfil:${providerTransactionId}` },
  });
  if (existingFulfilment) {
    return { status: 200, message: "OK: Already fulfilled." };
  }

  // Find corresponding session to get expected amount/currency
  const session = await db.checkoutSession.findUnique({
    where: { txRef },
    include: { targetPlan: true },
  });

  // 5. Server-side verification with Flutterwave (Rule P-6, P-7)
  const verifyResult = await verifyTransaction({
    transactionId: providerTransactionId,
    expectedTxRef: session?.txRef,
    expectedAmountMinor: session?.amountMinor,
    expectedCurrency: session?.currency,
    source: EventSource.WEBHOOK,
    userId: session?.userId,
    checkoutSessionId: session?.id,
  });

  if (!verifyResult.ok) {
    return { status: 200, message: `Verification failed: ${verifyResult.error}` };
  }

  // 6. Fulfill entitlement (Rule S-2, PRD §7.8)
  await fulfillEntitlement(verifyResult.payment, EventSource.WEBHOOK);

  return { status: 200, message: "OK: Payment fulfilled successfully." };
}
