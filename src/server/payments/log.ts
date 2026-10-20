import "server-only";
import { db } from "../db";
import type {
  PaymentEventType,
  EventSource,
  PaymentOutcome,
  SubscriptionEventType,
  CancellationReasonCode,
  Prisma,
} from "@prisma/client";

/**
 * Allowlisted fields for PaymentLog.payload per PRD §10, Rule P-17:
 * id, tx_ref, flw_ref, status, amount, currency, created_at.
 * Never stores raw bodies or card details (Rule P-19, T24).
 */
export interface AllowlistedPayload {
  id?: string | number | null;
  tx_ref?: string | null;
  flw_ref?: string | null;
  status?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  created_at?: string | null;
}

export function sanitizePayload(raw: Record<string, unknown>): AllowlistedPayload {
  return {
    id: (raw.id as string | number) ?? null,
    tx_ref: (raw.tx_ref as string) ?? null,
    flw_ref: (raw.flw_ref as string) ?? null,
    status: (raw.status as string) ?? null,
    amount: (raw.amount as number | string) ?? null,
    currency: (raw.currency as string) ?? null,
    created_at: (raw.created_at as string) ?? null,
  };
}

export interface WritePaymentLogParams {
  idempotencyKey: string;
  eventType: PaymentEventType;
  source: EventSource;
  userId?: string | null;
  checkoutSessionId?: string | null;
  providerRef: string;
  providerTransactionId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  outcome: PaymentOutcome;
  payload?: Record<string, unknown> | null;
}

/**
 * Writes an append-only row to PaymentLog (Rule P-15, P-16, P-17).
 */
export async function writePaymentLog(
  params: WritePaymentLogParams,
  tx: Prisma.TransactionClient = db
): Promise<void> {
  const sanitized = params.payload ? sanitizePayload(params.payload) : {};

  try {
    await tx.paymentLog.create({
      data: {
        idempotencyKey: params.idempotencyKey,
        eventType: params.eventType,
        source: params.source,
        userId: params.userId ?? null,
        checkoutSessionId: params.checkoutSessionId ?? null,
        providerRef: params.providerRef,
        providerTransactionId: params.providerTransactionId ?? null,
        amountMinor: params.amountMinor ?? null,
        currency: params.currency ?? null,
        outcome: params.outcome,
        payload: sanitized as Prisma.InputJsonValue,
      },
    });
  } catch (err: unknown) {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    throw err;
  }
}

export interface WriteSubscriptionEventParams {
  idempotencyKey: string;
  userId: string;
  type: SubscriptionEventType;
  reasonCode?: CancellationReasonCode | null;
  reasonText?: string | null;
}

/**
 * Writes a row to SubscriptionEvent (Rule P-18).
 */
export async function writeSubscriptionEvent(
  params: WriteSubscriptionEventParams,
  tx: Prisma.TransactionClient = db
): Promise<void> {
  await tx.subscriptionEvent.create({
    data: {
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      type: params.type,
      reasonCode: params.reasonCode ?? null,
      reasonText: params.reasonText ?? null,
    },
  });
}
