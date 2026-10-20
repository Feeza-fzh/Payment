"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * error.tsx — PRD §7.12, Rule P-27, FR-18
 * Friendly error page ensuring users are never left on a blank page.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Log unexpected client runtime errors
    console.error("Application error:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "520px",
          width: "100%",
          padding: "32px",
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-surface-variant, #e0e0e0)",
          borderRadius: "16px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "24px",
            marginBottom: "12px",
            color: "var(--color-on-surface, #212121)",
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            color: "var(--color-on-surface-variant, #616161)",
            marginBottom: "24px",
            fontSize: "15px",
          }}
        >
          An unexpected error occurred while processing your request. Please try
          again or return to the plans page.
        </p>

        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button
            onClick={() => reset()}
            type="button"
            style={{
              padding: "10px 20px",
              background: "var(--color-primary, #0a0e27)",
              color: "#ffffff",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Retry
          </button>
          <Link
            href="/plans"
            style={{
              padding: "10px 20px",
              background: "var(--color-surface-variant, #f5f5f5)",
              color: "var(--color-on-surface, #212121)",
              borderRadius: "8px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Choose Plan
          </Link>
          <Link
            href="/billing"
            style={{
              padding: "10px 20px",
              background: "transparent",
              color: "var(--color-on-surface-variant, #616161)",
              borderRadius: "8px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Billing
          </Link>
        </div>
      </div>
    </div>
  );
}
