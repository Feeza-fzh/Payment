import { describe, it, expect } from "vitest";
import {
  koboToNairaInt,
  formatKoboToNaira,
  fromProviderAmount,
} from "@/server/payments/money";

describe("Money Utilities — Rule P-1, P-2, P-3", () => {
  it("converts kobo to whole naira integers", () => {
    expect(koboToNairaInt(500000)).toBe(5000);
    expect(koboToNairaInt(5000000)).toBe(50000);
    expect(koboToNairaInt(0)).toBe(0);
  });

  it("throws TypeError if kobo amount is not an integer", () => {
    expect(() => koboToNairaInt(5000.5)).toThrow(TypeError);
  });

  it("formats kobo amounts for display without floats", () => {
    expect(formatKoboToNaira(500000)).toBe("5,000");
    expect(formatKoboToNaira(5000000)).toBe("50,000");
    expect(formatKoboToNaira(0)).toBe("0");
  });

  it("safely parses provider amounts from strings without parseFloat (Rule P-3)", () => {
    expect(fromProviderAmount("5000")).toEqual({ ok: true, amountMinor: 500000 });
    expect(fromProviderAmount("5000.00")).toEqual({ ok: true, amountMinor: 500000 });
    expect(fromProviderAmount("5000.50")).toEqual({ ok: true, amountMinor: 500050 });
    expect(fromProviderAmount("5000.05")).toEqual({ ok: true, amountMinor: 500005 });
    expect(fromProviderAmount(5000)).toEqual({ ok: true, amountMinor: 500000 });
  });

  it("rejects provider amounts with more than two decimal places (Rule P-3)", () => {
    const result = fromProviderAmount("5000.123");
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric provider amounts", () => {
    expect(fromProviderAmount("invalid").ok).toBe(false);
    expect(fromProviderAmount("").ok).toBe(false);
  });
});
