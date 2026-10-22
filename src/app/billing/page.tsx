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
 * Shows current plan, status, renewal date, next charge, and plan controls.
 */
export default async function BillingPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  const currentPlan = effectivePlan(user);
  const email = user?.email ?? "ada@example.com";
  const sub = user?.subscription;

  const planTier = (sub?.plan?.tier ?? currentPlan) as
    | "FREE"
    | "MONTHLY"
    | "YEARLY";
  const status = (sub?.status ?? "ACTIVE") as "ACTIVE" | "PAST_DUE" | "ENDED";

  const periodEndFormatted = sub?.currentPeriodEnd
    ? sub.currentPeriodEnd.toLocaleDateString("en-NG", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

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
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--spacing-very-large) var(--spacing-base)",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
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
