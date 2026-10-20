import Link from "next/link";
import type { BillingSummary } from "./types";
import styles from "./BillingBar.module.css";

interface BillingBarProps {
  summary: BillingSummary;
}

function statusLabel(status: BillingSummary["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "past_due":
      return "Past due";
    case "ended":
      return "Ended";
    case "free":
      return "Free tier";
    default: {
      void (status satisfies never);
      return "";
    }
  }
}

function dotClass(status: BillingSummary["status"]): string {
  switch (status) {
    case "active":
      return styles.dotActive ?? "";
    case "past_due":
      return styles.dotPastDue ?? "";
    default:
      return styles.dotFree ?? "";
  }
}

/**
 * BillingBar — FR-12 summary strip.
 * Presentation-only. Current plan, status, next charge, and a link to Billing.
 */
export default function BillingBar({
  summary,
}: BillingBarProps): React.ReactElement {
  return (
    <div className={styles.bar} id="billing-bar">
      <div className={styles.item}>
        <span className={styles.label}>Current plan</span>
        <span className={styles.value} id="billing-plan">
          {summary.currentPlan}
        </span>
      </div>

      <div className={styles.item}>
        <span className={styles.label}>Status</span>
        <span className={styles.statusValue} id="billing-status">
          <span className={`${styles.dot} ${dotClass(summary.status)}`} />
          {statusLabel(summary.status)}
        </span>
      </div>

      <div className={styles.item}>
        <span className={styles.label}>Next charge</span>
        <span className={styles.value} id="billing-next-charge">
          {summary.nextCharge ?? "—"}
        </span>
      </div>

      <Link href="/billing" className={styles.manageLink} id="billing-manage-link">
        Manage billing
      </Link>
    </div>
  );
}
