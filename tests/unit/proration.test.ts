import { describe, it, expect } from "vitest";
import {
  calculateProration,
  addOneMonthClamped,
  addOneYearClamped,
} from "../../src/server/payments/proration";

describe("Proration Calculation — PRD §7.9, Rule P-4, T11, T12", () => {
  it("T11: Upgrade with 20 unused days of 30 charges exactly 4,666,666 kobo", () => {
    // 30-day period: 2026-06-01 to 2026-07-01
    const currentPeriodStart = new Date("2026-06-01T00:00:00.000Z");
    const currentPeriodEnd = new Date("2026-07-01T00:00:00.000Z");
    const quoteDate = new Date("2026-06-11T00:00:00.000Z"); // 20 unused days remaining

    const quote = calculateProration({
      currentPeriodStart,
      currentPeriodEnd,
      lastAmountMinor: 500000, // 5,000 NGN
      yearlyPriceKobo: 5000000, // 50,000 NGN
      quoteDate,
    });

    expect(quote.totalDays).toBe(30);
    expect(quote.unusedDays).toBe(20);
    expect(quote.chargeKobo).toBe(4666666);
    expect(quote.creditKobo).toBe(333334);
    expect(quote.chargeKobo + quote.creditKobo).toBe(5000000);
    expect(quote.quotedPeriodStart.toISOString()).toBe(quoteDate.toISOString());
  });

  it("T12: Upgrade with 24 unused days of 31 charges exactly 4,612,903 kobo", () => {
    // 31-day period: 2026-07-01 to 2026-08-01
    const currentPeriodStart = new Date("2026-07-01T00:00:00.000Z");
    const currentPeriodEnd = new Date("2026-08-01T00:00:00.000Z");
    const quoteDate = new Date("2026-07-08T00:00:00.000Z"); // 24 unused days remaining

    const quote = calculateProration({
      currentPeriodStart,
      currentPeriodEnd,
      lastAmountMinor: 500000,
      yearlyPriceKobo: 5000000,
      quoteDate,
    });

    expect(quote.totalDays).toBe(31);
    expect(quote.unusedDays).toBe(24);
    expect(quote.chargeKobo).toBe(4612903);
    expect(quote.creditKobo).toBe(387097);
    expect(quote.chargeKobo + quote.creditKobo).toBe(5000000);
  });

  it("Edge case: 0 unused days gives full yearly price", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-02-01T00:00:00.000Z");
    const quoteDate = new Date("2026-02-01T00:00:00.000Z"); // 0 unused days

    const quote = calculateProration({
      currentPeriodStart: start,
      currentPeriodEnd: end,
      lastAmountMinor: 500000,
      yearlyPriceKobo: 5000000,
      quoteDate,
    });

    expect(quote.unusedDays).toBe(0);
    expect(quote.chargeKobo).toBe(5000000);
    expect(quote.creditKobo).toBe(0);
  });

  it("Edge case: unused days = total days gives yearly minus lastPaid", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-02-01T00:00:00.000Z");
    const quoteDate = new Date("2026-01-01T00:00:00.000Z"); // all 31 days unused

    const quote = calculateProration({
      currentPeriodStart: start,
      currentPeriodEnd: end,
      lastAmountMinor: 500000,
      yearlyPriceKobo: 5000000,
      quoteDate,
    });

    expect(quote.unusedDays).toBe(31);
    expect(quote.chargeKobo).toBe(4500000);
    expect(quote.creditKobo).toBe(500000);
  });

  it("Clamping: addOneMonthClamped clamps Jan 31 to Feb 28 in non-leap year", () => {
    const jan31 = new Date("2026-01-31T12:00:00.000Z");
    const febClamped = addOneMonthClamped(jan31);
    expect(febClamped.getUTCMonth()).toBe(1); // February
    expect(febClamped.getUTCDate()).toBe(28);
  });

  it("Clamping: addOneYearClamped clamps Feb 29 leap day to Feb 28 next year", () => {
    const leapDay = new Date("2024-02-29T12:00:00.000Z");
    const nextYear = addOneYearClamped(leapDay);
    expect(nextYear.getUTCFullYear()).toBe(2025);
    expect(nextYear.getUTCMonth()).toBe(1); // February
    expect(nextYear.getUTCDate()).toBe(28);
  });
});
