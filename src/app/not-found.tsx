import Link from "next/link";
import ShellHeader from "@/components/shell/ShellHeader";

/**
 * not-found.tsx — PRD §7.12, Rule P-27, FR-18
 * 404 page with persistent links to Plans and Billing.
 */
export default function NotFound(): React.ReactElement {
  return (
    <>
      <ShellHeader
        email="ada@example.com"
        effectivePlan="FREE"
        activePage="plans"
      />
      <main
        style={{
          maxWidth: "520px",
          margin: "64px auto",
          padding: "32px",
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-surface-variant, #e0e0e0)",
          borderRadius: "16px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "28px",
            marginBottom: "12px",
            color: "var(--color-on-surface, #212121)",
          }}
        >
          Page Not Found
        </h1>
        <p
          style={{
            color: "var(--color-on-surface-variant, #616161)",
            marginBottom: "28px",
            fontSize: "15px",
          }}
        >
          The page or transaction view you are looking for does not exist or has
          expired.
        </p>

        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <Link
            href="/plans"
            style={{
              padding: "10px 20px",
              background: "var(--color-primary, #0a0e27)",
              color: "#ffffff",
              borderRadius: "8px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Available Plans
          </Link>
          <Link
            href="/billing"
            style={{
              padding: "10px 20px",
              background: "var(--color-surface-variant, #f5f5f5)",
              color: "var(--color-on-surface, #212121)",
              borderRadius: "8px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Billing
          </Link>
        </div>
      </main>
    </>
  );
}
