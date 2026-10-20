import { describe, it, expect } from "vitest";
import { handleVerifiedReturn } from "@/server/payments/handleVerifiedReturn";

describe("Return View Verification — Rule P-5, T4, T5, FR-6, FR-7", () => {
  it("T4: returns UNKNOWN_REF and grants nothing if tx_ref is missing", async () => {
    const result = await handleVerifiedReturn(null);

    expect(result.status).toBe("UNKNOWN_REF");
    expect(result.message).toContain("Missing transaction reference");
  });

  it("T4: returns UNKNOWN_REF if tx_ref is undefined or empty string", async () => {
    const result = await handleVerifiedReturn("");

    expect(result.status).toBe("UNKNOWN_REF");
  });

  it("T5: returns UNKNOWN_REF if tx_ref is guessed or does not exist in DB", async () => {
    const result = await handleVerifiedReturn("guessed_tx_ref_99999");

    expect(result.status).toBe("UNKNOWN_REF");
    expect(result.message).toContain("We could not find this payment");
  });
});
