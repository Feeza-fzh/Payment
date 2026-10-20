import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTransaction } from "@/server/payments/verifyTransaction";
import { EventSource, PaymentOutcome } from "@prisma/client";

describe("Transaction Verification — Rule P-6, P-7, T6, T7, PRD §7.6", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.FLW_SECRET_KEY = "FLWSECK_TEST-SANDBOXDEMOKEY-X";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("T6: rejects if provider status is not successful", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          id: 1001,
          status: "failed",
          tx_ref: "sub_monthly_1",
          amount: 5000,
          currency: "NGN",
        },
      }),
    });

    const result = await verifyTransaction({
      transactionId: "1001",
      expectedTxRef: "sub_monthly_1",
      expectedAmountMinor: 500000,
      expectedCurrency: "NGN",
      source: EventSource.RETURN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe(PaymentOutcome.PROVIDER_ERROR);
    }
  });

  it("T7: rejects with AMOUNT_MISMATCH if provider amount differs from expected (Rule P-7)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          id: 1002,
          status: "successful",
          tx_ref: "sub_monthly_2",
          amount: 2500, // ₦2,500 instead of expected ₦5,000
          currency: "NGN",
        },
      }),
    });

    const result = await verifyTransaction({
      transactionId: "1002",
      expectedTxRef: "sub_monthly_2",
      expectedAmountMinor: 500000, // expected ₦5,000 in kobo
      expectedCurrency: "NGN",
      source: EventSource.WEBHOOK,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe(PaymentOutcome.AMOUNT_MISMATCH);
    }
  });

  it("rejects with CURRENCY_MISMATCH if currency is not expected", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          id: 1003,
          status: "successful",
          tx_ref: "sub_monthly_3",
          amount: 5000,
          currency: "USD",
        },
      }),
    });

    const result = await verifyTransaction({
      transactionId: "1003",
      expectedTxRef: "sub_monthly_3",
      expectedAmountMinor: 500000,
      expectedCurrency: "NGN",
      source: EventSource.RETURN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe(PaymentOutcome.CURRENCY_MISMATCH);
    }
  });

  it("successfully constructs VerifiedPayment and captures reusable card token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          id: 1004,
          status: "successful",
          tx_ref: "sub_monthly_4",
          flw_ref: "flw_ref_1004",
          amount: 5000,
          currency: "NGN",
          card: {
            token: "flw-t1nf-verified-card-token",
          },
        },
      }),
    });

    const result = await verifyTransaction({
      transactionId: "1004",
      expectedTxRef: "sub_monthly_4",
      expectedAmountMinor: 500000,
      expectedCurrency: "NGN",
      source: EventSource.RETURN,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payment.providerTransactionId).toBe("1004");
      expect(result.payment.amountMinor).toBe(500000);
      expect(result.payment.currency).toBe("NGN");
      expect(result.payment.cardToken).toBe("flw-t1nf-verified-card-token");
    }
  });
});
