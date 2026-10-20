"use client";

import Link from "next/link";

/**
 * global-error.tsx — PRD §7.12, Rule P-27, FR-18
 * Catches root-level boundary errors.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f8f9fa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "520px",
            width: "100%",
            padding: "32px",
            background: "#ffffff",
            border: "1px solid #e0e0e0",
            borderRadius: "16px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "24px", marginBottom: "12px", color: "#111827" }}>
            Critical Application Error
          </h1>
          <p style={{ color: "#4b5563", marginBottom: "24px", fontSize: "15px" }}>
            The application encountered a critical error. Please reload or return to
            the plans overview.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              type="button"
              style={{
                padding: "10px 20px",
                background: "#0a0e27",
                color: "#ffffff",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Try Again
            </button>
            <Link
              href="/plans"
              style={{
                padding: "10px 20px",
                background: "#f3f4f6",
                color: "#111827",
                borderRadius: "8px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Plans
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
