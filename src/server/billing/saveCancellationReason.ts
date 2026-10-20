import "server-only";
import { db } from "../db";
import { writeSubscriptionEvent } from "../payments/log";
import { CancellationReasonCode, SubscriptionEventType } from "@prisma/client";

export type SaveCancellationReasonResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Saves cancellation reason per FR-15.
 * Reason is optional. Never required for cancellation.
 */
export async function saveCancellationReason(params: {
  userId: string;
  reasonCode: CancellationReasonCode;
  reasonText?: string;
  requestId?: string;
}): Promise<SaveCancellationReasonResult> {
  const { userId, reasonCode, reasonText, requestId } = params;

  // Trim and clamp to 500 characters
  const trimmedText = reasonText ? reasonText.trim().substring(0, 500) : null;

  const sub = await db.subscription.findUnique({
    where: { userId },
  });

  if (!sub) {
    return { ok: false, error: "Subscription not found." };
  }

  await db.subscription.update({
    where: { id: sub.id },
    data: {
      cancellationReasonCode: reasonCode,
      cancellationReasonText: trimmedText,
    },
  });

  // If a requestId is provided, write/update the reason on SubscriptionEvent
  if (requestId) {
    const idempotencyKey = `sub:CANCEL_REASON:${sub.id}:${requestId}`;
    try {
      await writeSubscriptionEvent({
        idempotencyKey,
        userId,
        type: SubscriptionEventType.CANCEL_REQUESTED,
        reasonCode,
        reasonText: trimmedText ?? undefined,
      });
    } catch {
      // Rule FR-15: "Save fails: We could not save that. Your cancellation is unaffected."
    }
  }

  return { ok: true };
}
