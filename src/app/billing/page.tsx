import type { Metadata } from "next";
import ShellHeader from "@/components/shell/ShellHeader";

export const metadata: Metadata = {
  title: "Billing — SubSlice",
  description: "Manage your billing and subscription.",
};

/**
 * Billing page — FR-12 (Phase 1 shell placeholder).
 * Full billing state, cancel, downgrade, and Keep my plan are Phase 2.
 */
export default function BillingPage(): React.ReactElement {
  // Phase 1 placeholder — replaced by getCurrentUser() + effectivePlan()
  const email = "ada@example.com";

  return (
    <>
      <ShellHeader email={email} effectivePlan="FREE" activePage="billing" />
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
