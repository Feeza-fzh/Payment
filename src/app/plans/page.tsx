import type { Metadata } from "next";
import ShellHeader from "@/components/shell/ShellHeader";
import PlanCard from "@/components/plans/PlanCard";
import type {
  PlanDisplay,
  PlanCta,
  EffectivePlan,
} from "@/components/plans/types";
import styles from "./PlansPage.module.css";
import { getCurrentUser } from "@/server/identity/getCurrentUser";
import { effectivePlan } from "@/server/identity/effectivePlan";

export const metadata: Metadata = {
  title: "Plans — SubSlice",
  description: "Choose your subscription plan. Simple pricing, cancel anytime.",
};

/**
 * Static plan definitions.
 * Prices are the PRD §8 placeholders formatted as display strings.
 * Amounts in kobo live in the DB; this page shows pre-formatted strings (S-9).
 */
const PLAN_DEFINITIONS: PlanDisplay[] = [
  {
    tier: "FREE",
    label: "Free",
    priceFormatted: "0",
    interval: null,
    description: "Get started with the basics.",
    features: [
      { text: "Basic access", included: true },
      { text: "No premium features", included: false },
    ],
  },
  {
    tier: "MONTHLY",
    label: "Monthly",
    priceFormatted: "5,000",
    interval: "month",
    description: "Everything you need, billed monthly.",
    features: [
      { text: "Full access", included: true },
      { text: "Cancel anytime", included: true },
      { text: "Flexible billing", included: true },
    ],
  },
  {
    tier: "YEARLY",
    label: "Yearly",
    priceFormatted: "50,000",
    interval: "year",
    description: "Save ₦10,000 with annual billing.",
    features: [
      { text: "Full access", included: true },
      { text: "Cancel anytime", included: true },
      { text: "Priority support", included: true },
      { text: "Save ₦10,000/year vs monthly", included: true },
    ],
  },
];

/**
 * Resolve the CTA for each plan card per PRD §5.2 CTA matrix.
 * This runs server-side. The effective plan comes from effectivePlan() in
 * the real app; here we default to FREE for the Phase 1 shell.
 */
function resolveCta(
  cardTier: PlanDisplay["tier"],
  effectivePlan: EffectivePlan
): PlanCta {
  // Free user — PRD §5.2 row 1
  if (effectivePlan === "FREE") {
    if (cardTier === "FREE") return { kind: "current" };
    return { kind: "subscribe" };
  }

  // Monthly active user — PRD §5.2 row 2
  if (effectivePlan === "MONTHLY") {
    if (cardTier === "FREE") return { kind: "downgrade-to-free" };
    if (cardTier === "MONTHLY") return { kind: "current" };
    return { kind: "upgrade" };
  }

  // Yearly active user — PRD §5.2 row 4
  if (cardTier === "FREE") return { kind: "downgrade-to-free" };
  if (cardTier === "MONTHLY") return { kind: "switch-to-monthly" };
  return { kind: "current" };
}

/**
 * Plans page — FR-1, FR-2
 *
 * Phase 1 shell: uses a hardcoded FREE effective plan.
 * When getCurrentUser() and effectivePlan() are wired up in Phase 1,
 * replace the constant with their output.
 */
interface PlansPageProps {
  searchParams?: Promise<{ error?: string }>;
}

export default async function PlansPage(
  props: PlansPageProps
): Promise<React.ReactElement> {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const errorMessage = searchParams?.error;

  const user = await getCurrentUser();
  const activeEffectivePlan: EffectivePlan = effectivePlan(user);
  const email = user?.email ?? "ada@example.com";

  return (
    <>
      {/* FR-1: Shell with email, plan badge, nav */}
      <ShellHeader
        email={email}
        effectivePlan={activeEffectivePlan}
        activePage="plans"
      />

      <main className={styles.main} id="main-content">
        {/* Page heading */}
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle} id="page-title">
            Choose your plan
          </h1>
        </header>

        {/* PRD §7.12, Rule P-27: Inline error banner */}
        {errorMessage && (
          <div
            role="alert"
            style={{
              maxWidth: "960px",
              width: "100%",
              marginBottom: "var(--spacing-large)",
              padding: "var(--spacing-medium) var(--spacing-large)",
              background: "#F8EFEF",
              border: "1px solid #f9c8c8",
              borderRadius: "12px",
              color: "#333333",
              fontSize: "14px",
            }}
          >
            <strong>Checkout Notice:</strong> {errorMessage}
          </div>
        )}

        {/* FR-2: Three plan cards with §5.2 CTAs */}
        <div
          className={styles.grid}
          id="plans-grid"
          role="list"
          aria-label="Available plans"
        >
          {PLAN_DEFINITIONS.map((plan) => (
            <div key={plan.tier} role="listitem" className={styles.cardWrapper}>
              <PlanCard
                plan={plan}
                cta={resolveCta(plan.tier, activeEffectivePlan)}
                recommended={plan.tier === "YEARLY"}
              />
            </div>
          ))}
        </div>

      </main>
    </>
  );
}
