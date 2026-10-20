import type { Metadata } from "next";
import Link from "next/link";
import ShellHeader from "@/components/shell/ShellHeader";
import { getCurrentUser } from "@/server/identity/getCurrentUser";
import { effectivePlan } from "@/server/identity/effectivePlan";
import { handleVerifiedReturn } from "@/server/payments/handleVerifiedReturn";

export const metadata: Metadata = {
  title: "Payment Confirmation — SubSlice",
  description: "Verifying your payment and updating your subscription.",
};

export const dynamic = "force-dynamic";

interface ReturnPageProps {
  searchParams: Promise<{
    tx_ref?: string;
    transaction_id?: string;
  }>;
}

export default async function BillingReturnPage({
  searchParams,
}: ReturnPageProps): Promise<React.ReactElement> {
  const { tx_ref, transaction_id } = await searchParams;

  const result = await handleVerifiedReturn(tx_ref, transaction_id);
  const user = await getCurrentUser();
  const currentPlan = effectivePlan(user);
  const email = user?.email ?? "ada@example.com";

  return (
    <>
      <ShellHeader
        email={email}
        effectivePlan={currentPlan}
        activePage="billing"
      />

      <main
        style={{
          maxWidth: "600px",
          margin: "48px auto",
          padding: "32px 24px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-surface-variant)",
          borderRadius: "16px",
          textAlign: "center",
        }}
      >
        {result.status === "CONFIRMED" && (
          <div>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "#E8F5E9",
                color: "#2E7D32",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: "24px",
              }}
            >
              ✓
            </div>
            <h1 style={{ fontSize: "24px", marginBottom: "8px", color: "var(--color-on-surface)" }}>
              Payment Confirmed
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "24px" }}>
              {result.message}
            </p>
            <Link
              href="/billing"
              style={{
                display: "inline-block",
                padding: "12px 24px",
                background: "var(--color-primary)",
                color: "var(--color-on-primary)",
                borderRadius: "8px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Go to Billing
            </Link>
          </div>
        )}

        {result.status === "PROCESSING" && (
          <div>
            <h1 style={{ fontSize: "24px", marginBottom: "8px", color: "var(--color-on-surface)" }}>
              Payment Processing
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "24px" }}>
              {result.message}
            </p>
            <Link
              href="/billing"
              style={{
                display: "inline-block",
                padding: "12px 24px",
                background: "var(--color-primary)",
                color: "var(--color-on-primary)",
                borderRadius: "8px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Check Billing Status
            </Link>
          </div>
        )}

        {(result.status === "UNKNOWN_REF" || result.status === "FAILED") && (
          <div>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "#FFEBEE",
                color: "#C62828",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: "24px",
              }}
            >
              ✕
            </div>
            <h1 style={{ fontSize: "24px", marginBottom: "8px", color: "var(--color-on-surface)" }}>
              {result.status === "UNKNOWN_REF"
                ? "Payment Not Found"
                : "Payment Incomplete"}
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "24px" }}>
              {result.message}
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <Link
                href="/plans"
                style={{
                  display: "inline-block",
                  padding: "12px 24px",
                  background: "var(--color-primary)",
                  color: "var(--color-on-primary)",
                  borderRadius: "8px",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Return to Plans
              </Link>
              <Link
                href="/billing"
                style={{
                  display: "inline-block",
                  padding: "12px 24px",
                  background: "var(--color-surface-variant)",
                  color: "var(--color-on-surface)",
                  borderRadius: "8px",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Billing Overview
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
