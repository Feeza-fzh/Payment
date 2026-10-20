import "server-only";

/**
 * Money utilities — Rule P-1, P-2, P-3, PRD §7.10
 *
 * All internal money math uses integer kobo (minor units).
 * Provider amounts in decimal strings are safely parsed to integer kobo
 * without calling parseFloat.
 */

/**
 * Converts integer kobo to an integer naira value for provider requests.
 * E.g., 500000 kobo -> 5000 NGN.
 */
export function koboToNairaInt(kobo: number): number {
  if (!Number.isInteger(kobo)) {
    throw new TypeError(`Amount in kobo must be an integer, got: ${kobo}`);
  }
  return Math.floor(kobo / 100);
}

/**
 * Formats integer kobo to a comma-separated naira string for UI display.
 * E.g., 500000 -> "5,000"
 */
export function formatKoboToNaira(kobo: number): string {
  const naira = koboToNairaInt(kobo);
  return naira.toLocaleString("en-NG");
}

/**
 * Converts an inbound provider amount (number or string) to integer kobo.
 * Rule P-3: Parses the decimal string directly, rejects > 2 decimal places,
 * and never calls parseFloat.
 */
export function fromProviderAmount(
  rawAmount: number | string
): { ok: true; amountMinor: number } | { ok: false; error: string } {
  const str = String(rawAmount).trim();

  // Validate format: whole number or up to 2 decimal places
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return {
      ok: false,
      error: `Invalid provider amount format: "${str}". Must be numeric with at most 2 decimal places.`,
    };
  }

  const [wholePart, decimalPart = ""] = str.split(".");
  if (!wholePart) {
    return { ok: false, error: "Missing whole number in provider amount." };
  }

  const whole = parseInt(wholePart, 10);
  const fraction = parseInt(decimalPart.padEnd(2, "0"), 10);

  const amountMinor = whole * 100 + fraction;
  return { ok: true, amountMinor };
}
