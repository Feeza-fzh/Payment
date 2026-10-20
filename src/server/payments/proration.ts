import "server-only";

export interface ProrationQuote {
  chargeKobo: number;
  creditKobo: number;
  totalDays: number;
  unusedDays: number;
  lastPaidKobo: number;
  yearlyPriceKobo: number;
  quotedPeriodStart: Date;
  quotedPeriodEnd: Date;
  expiresAt: Date;
}

/**
 * Calculates whole UTC calendar days between two dates.
 * Discards time component by computing difference at UTC midnight.
 */
export function differenceInUtcDays(start: Date, end: Date): number {
  const startUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const endUtc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  return Math.floor((endUtc - startUtc) / 86400000);
}

/**
 * Returns the number of days in a given UTC month.
 */
export function getDaysInUtcMonth(year: number, monthZeroIndexed: number): number {
  return new Date(Date.UTC(year, monthZeroIndexed + 1, 0)).getUTCDate();
}

/**
 * Adds one calendar month, clamped to month end (PRD §7.9).
 * E.g., Jan 31 -> Feb 28 (or 29 in leap year).
 */
export function addOneMonthClamped(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  let targetYear = year;
  let targetMonth = month + 1;
  if (targetMonth > 11) {
    targetYear += 1;
    targetMonth = 0;
  }

  const maxDays = getDaysInUtcMonth(targetYear, targetMonth);
  const targetDay = Math.min(day, maxDays);

  const result = new Date(date);
  result.setUTCFullYear(targetYear, targetMonth, targetDay);
  return result;
}

/**
 * Adds one calendar year, clamped (PRD §7.9).
 * E.g., Feb 29 leap day -> Feb 28 next year.
 */
export function addOneYearClamped(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetYear = year + 1;
  const maxDays = getDaysInUtcMonth(targetYear, month);
  const targetDay = Math.min(day, maxDays);

  const result = new Date(date);
  result.setUTCFullYear(targetYear, month, targetDay);
  return result;
}

/**
 * Calculates upgrade quote from monthly to yearly per PRD §7.9 and Rule P-4.
 *
 * Formula:
 * chargeKobo = floor((yearly * D - lastPaid * U) / D)
 * creditKobo = yearly - chargeKobo
 *
 * Floor is implemented using integer remainder: (n - (n % d)) / d.
 */
export function calculateProration(params: {
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  lastAmountMinor: number;
  yearlyPriceKobo: number;
  quoteDate: Date;
}): ProrationQuote {
  const {
    currentPeriodStart,
    currentPeriodEnd,
    lastAmountMinor: lastPaid,
    yearlyPriceKobo: yearly,
    quoteDate,
  } = params;

  // D = total days in current period
  const totalDays = Math.max(
    1,
    differenceInUtcDays(currentPeriodStart, currentPeriodEnd)
  );

  // U = unused days from quoteDate to currentPeriodEnd
  const rawUnused = differenceInUtcDays(quoteDate, currentPeriodEnd);
  const unusedDays = Math.max(0, Math.min(totalDays, rawUnused));

  let chargeKobo: number;
  if (unusedDays <= 0) {
    chargeKobo = yearly;
  } else if (unusedDays >= totalDays) {
    chargeKobo = yearly - lastPaid;
  } else {
    // Integer arithmetic: floor with remainder (Rule P-4)
    const numerator = yearly * totalDays - lastPaid * unusedDays;
    const remainder = numerator % totalDays;
    chargeKobo = (numerator - remainder) / totalDays;
  }

  // Credit shown so line items sum exactly (PRD §7.9)
  const creditKobo = yearly - chargeKobo;

  // Yearly period starts on quote date (PRD §7.9)
  const quotedPeriodStart = quoteDate;
  const quotedPeriodEnd = addOneYearClamped(quoteDate);

  // Quote expires at 15 minutes or UTC midnight, whichever is first
  const fifteenMinutesLater = new Date(quoteDate.getTime() + 15 * 60 * 1000);
  const nextUtcMidnight = new Date(
    Date.UTC(
      quoteDate.getUTCFullYear(),
      quoteDate.getUTCMonth(),
      quoteDate.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );
  const expiresAt =
    fifteenMinutesLater.getTime() < nextUtcMidnight.getTime()
      ? fifteenMinutesLater
      : nextUtcMidnight;

  return {
    chargeKobo,
    creditKobo,
    totalDays,
    unusedDays,
    lastPaidKobo: lastPaid,
    yearlyPriceKobo: yearly,
    quotedPeriodStart,
    quotedPeriodEnd,
    expiresAt,
  };
}
