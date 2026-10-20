import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleWebhook } from "@/server/payments/handleWebhook";
import { sanitizePayload } from "@/server/payments/log";

describe("Webhook Security & Validation — Rule P-12, P-17, T3, T24, T32", () => {
  const secretHash = "test_webhook_secret_hash_subslice";
  const originalEnv = process.env.FLW_WEBHOOK_SECRET_HASH;

  beforeEach(() => {
    process.env.FLW_WEBHOOK_SECRET_HASH = secretHash;
  });

  afterEach(() => {
    process.env.FLW_WEBHOOK_SECRET_HASH = originalEnv;
  });

  it("T32: rejects webhook body over 64 KB with 413", async () => {
    const largeBody = "a".repeat(65 * 1024); // 65 KB
    const result = await handleWebhook(largeBody, secretHash);

    expect(result.status).toBe(413);
    expect(result.message).toContain("Payload Too Large");
  });

  it("T3: rejects forged webhook signature with 401 without parsing body", async () => {
    const body = JSON.stringify({ event: "charge.completed", data: { id: 123 } });
    const forgedSignature = "invalid_hash_signature";

    const result = await handleWebhook(body, forgedSignature);

    expect(result.status).toBe(401);
    expect(result.message).toContain("Invalid webhook signature");
  });

  it("T3: rejects missing signature header with 401", async () => {
    const body = JSON.stringify({ event: "charge.completed", data: { id: 123 } });

    const result = await handleWebhook(body, null);

    expect(result.status).toBe(401);
  });

  it("T24: sanitizes payloads to strip card data and raw tokens", () => {
    const rawProviderPayload = {
      id: 99999,
      tx_ref: "tx_12345",
      flw_ref: "flw_ref_123",
      status: "successful",
      amount: 5000,
      currency: "NGN",
      created_at: "2026-05-15T12:00:00Z",
      // Sensitive card fields that MUST be stripped (Rule P-17, P-19, T24)
      card: {
        first_6digits: "123456",
        last_4digits: "7890",
        issuer: "TEST BANK",
        country: "NG",
        type: "VERVE",
        token: "flw-t1nf-secret-token",
        expiry: "09/32",
      },
      customer: {
        email: "user@example.com",
      },
    };

    const sanitized = sanitizePayload(rawProviderPayload);

    // Verify only allowlisted keys are retained
    expect(sanitized).toEqual({
      id: 99999,
      tx_ref: "tx_12345",
      flw_ref: "flw_ref_123",
      status: "successful",
      amount: 5000,
      currency: "NGN",
      created_at: "2026-05-15T12:00:00Z",
    });

    // Ensure forbidden card fields are NOT present in sanitized payload
    expect(sanitized).not.toHaveProperty("card");
    expect(sanitized).not.toHaveProperty("first_6digits");
    expect(sanitized).not.toHaveProperty("last_4digits");
    expect(sanitized).not.toHaveProperty("token");
  });
});
