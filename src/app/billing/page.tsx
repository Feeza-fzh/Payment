import type { Metadata } from "next";
import ShellHeader from "@/components/shell/ShellHeader";
import BillingManager from "@/components/billing/BillingManager";
import { getCurrentUser } from "@/server/identity/getCurrentUser";
import { effectivePlan } from "@/server/identity/effectivePlan";
import { formatKoboToNaira } from "@/server/payments/money";

export const metadata: Metadata = {
  title: "Billing — SubSlice",
  description: "Manage your billing and subscription.",
};

export const dynamic = "force-dynamic";

/**
 * Billing page — FR-12
 * Shows plan, status, renewal or end date, next charge amount,
 * pending changes, and full cancellation/downgrade/keep controls.
 */
export default async function BillingPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  const currentPlan = effectivePlan(user);
  const email = user?.email ?? "ada@example.com";
  const sub = user?.subscription;

  const planTier = (sub?.plan?.tier ?? currentPlan) as "FREE" | "MONTHLY" | "YEARLY";
  const status = (sub?.status ?? "ACTIVE") as "ACTIVE" | "PAST_DUE" | "ENDED";

  const periodEndFormatted = sub?.currentPeriodEnd
    ? sub.currentPeriodEnd.toLocaleDateString("en-NG", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "None";

  const graceEndsAtFormatted = sub?.graceEndsAt
    ? sub.graceEndsAt.toLocaleDateString("en-NG", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  const canceledAtFormatted = sub?.canceledAt
    ? sub.canceledAt.toLocaleDateString("en-NG", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  const nextChargeAmount = sub
    ? sub.pendingPlan
      ? sub.pendingPlan.amountMinor
      : sub.plan.amountMinor
    : 0;

  const nextChargeFormatted = `₦${formatKoboToNaira(nextChargeAmount)}`;

  return (
    <>
      <ShellHeader email={email} effectivePlan={currentPlan} activePage="billing" />
      <main
        id="billing-main"
        style={{
          padding: "var(--spacing-very-large)",
          maxWidth: "960px",
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            font: "var(--font-heading-large)",
            letterSpacing: "var(--font-heading-large-letter-spacing)",
            color: "var(--color-on-surface)",
            marginBottom: "var(--spacing-large)",
          }}
        >
          Billing & Subscription
        </h1>

        <BillingManager
          planTier={planTier}
          status={status}
          periodEndFormatted={periodEndFormatted}
          nextChargeFormatted={nextChargeFormatted}
          cancelAtPeriodEnd={sub?.cancelAtPeriodEnd ?? false}
          canceledAtFormatted={canceledAtFormatted}
          pendingPlanTier={sub?.pendingPlan?.tier ?? null}
          graceEndsAtFormatted={graceEndsAtFormatted}
        />
      </main>
    </>
  );
}
