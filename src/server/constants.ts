import "server-only";

/**
 * Global constants per PRD §5, §7, §8 and AGENTS.md §5.
 * Keeps every limit, window, and day count in one place. No magic numbers.
 */

// Grace window after subscription period end
export const GRACE_PERIOD_DAYS = 3;

// Checkout session expiry
export const CHECKOUT_SESSION_EXPIRY_MINUTES = 15;

// Webhook body size cap (Rule P-12, PRD §7.7)
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024; // 64 KB

// Rate limiting windows and limits (Rule P-25, PRD §7.11)
export const RATE_LIMIT_CHECKOUT_PER_USER = 5;
export const RATE_LIMIT_CHECKOUT_PER_IP = 20;
export const RATE_LIMIT_WEBHOOK_RETURN_PER_IP = 60;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

// Poll duration on return view (PRD §5.3, FR-8)
export const RETURN_POLL_INTERVAL_MS = 3000;
export const RETURN_POLL_MAX_DURATION_MS = 60000;

// Currencies (PRD §7.10, Rule P-2)
export const ALLOWED_CURRENCY = "NGN";
