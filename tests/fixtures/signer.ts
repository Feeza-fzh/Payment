/**
 * Fixture webhook signer per PRD §7.13 (Phase 2).
 * Signs payload fixtures with the secret hash configured in FLW_WEBHOOK_SECRET_HASH.
 */
export function signWebhookPayload(secretHash: string): Record<string, string> {
  return {
    "verif-hash": secretHash,
    "content-type": "application/json",
  };
}

export function createSignedWebhookRequest(params: {
  payload: Record<string, unknown>;
  secretHash: string;
}): Request {
  const body = JSON.stringify(params.payload);
  return new Request("http://localhost:3000/api/webhooks/flutterwave", {
    method: "POST",
    headers: {
      "verif-hash": params.secretHash,
      "content-type": "application/json",
    },
    body,
  });
}
