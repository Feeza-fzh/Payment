/**
 * Shared plan and subscription types used by UI components.
 * Server modules use Prisma-generated types; these are the display-safe shapes.
 */

export type PlanTier = "FREE" | "MONTHLY" | "YEARLY";

export type EffectivePlan = PlanTier;

/** Display-safe plan record — amounts already formatted as strings server-side. */
export interface PlanDisplay {
  tier: PlanTier;
  label: string;
  /** Formatted naira price, e.g. "₦5,000" */
  priceFormatted: string;
  interval: "month" | "year" | null;
  description: string;
  features: PlanFeature[];
}

export interface PlanFeature {
  text: string;
  included: boolean;
}

/**
 * The CTA a plan card should show, per PRD §5.2 CTA matrix.
 * Resolved server-side so the component stays presentation-only (S-9).
 */
export type PlanCta =
  | { kind: "current" }
  | { kind: "subscribe" }
  | { kind: "upgrade" }
  | { kind: "downgrade-to-free" }
  | { kind: "switch-to-monthly" }
  | { kind: "scheduled"; label: string }
  | { kind: "pay-now" }
  | { kind: "disabled"; reason: string };

export interface PlanCardProps {
  plan: PlanDisplay;
  cta: PlanCta;
  recommended?: boolean;
}

/** Billing summary shown below the plan cards (FR-12). */
export interface BillingSummary {
  currentPlan: string;
  status: "active" | "past_due" | "free" | "ended";
  /** Formatted next charge date or amount, or null for free. */
  nextCharge: string | null;
}
