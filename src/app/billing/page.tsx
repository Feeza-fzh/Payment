import type { Metadata } from "next";
import ShellHeader from "@/components/shell/ShellHeader";
import { getCurrentUser } from "@/server/identity/getCurrentUser";
import { effectivePlan } from "@/server/identity/effectivePlan";

export const metadata: Metadata = {
  title: "Billing — SubSlice",
  description: "Manage your billing and subscription.",
};

export const dynamic = "force-dynamic";

/**
 * Billing page — FR-12 (Phase 1 shell placeholder).
 * Full billing state, cancel, downgrade, and Keep my plan are Phase 2.
 */
export default async function BillingPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  const currentPlan = effectivePlan(user);
  const email = user?.email ?? "ada@example.com";

  return (
    <>
      <ShellHeader email={email} effectivePlan={currentPlan} activePage="billing" />
      <main id="billing-main" style={{ padding: "var(--spacing-very-large)", maxWidth: "960px", margin: "0 auto" }}>
        <h1 style={{ font: "var(--font-heading-large)", letterSpacing: "var(--font-heading-large-letter-spacing)", color: "var(--color-on-surface)", marginBottom: "var(--spacing-base)" }}>
          Billing
        </h1>
        <p style={{ font: "var(--font-body-large)", color: "var(--color-on-surface-variant)" }}>
          Full billing management comes in Phase 2.
        </p>
      </main>
    </>
  );
}
