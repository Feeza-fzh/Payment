import Link from "next/link";
import type { EffectivePlan } from "@/components/plans/types";
import styles from "./ShellHeader.module.css";

interface ShellHeaderProps {
  email: string;
  effectivePlan: EffectivePlan;
  activePage: "plans" | "billing";
}

/** FR-1 — The signed-in shell: email, plan badge, nav to Plans and Billing. */
export default function ShellHeader({
  email,
  effectivePlan,
  activePage,
}: ShellHeaderProps): React.ReactElement {
  const initial = email[0]?.toUpperCase() ?? "?";
  const isPaid = effectivePlan !== "FREE";
  const badgeLabel = effectivePlan === "MONTHLY"
    ? "Monthly"
    : effectivePlan === "YEARLY"
      ? "Yearly"
      : "Free";

  return (
    <header className={styles.header} id="shell-header">
      <Link href="/plans" className={styles.brand} id="shell-brand">
        SubSlice
      </Link>

      <nav className={styles.nav} id="shell-nav" aria-label="Main navigation">
        <Link
          href="/plans"
          className={`${styles.navLink} ${activePage === "plans" ? styles.navLinkActive : ""}`}
          id="nav-plans"
          aria-current={activePage === "plans" ? "page" : undefined}
        >
          Plans
        </Link>
        <Link
          href="/billing"
          className={`${styles.navLink} ${activePage === "billing" ? styles.navLinkActive : ""}`}
          id="nav-billing"
          aria-current={activePage === "billing" ? "page" : undefined}
        >
          Billing
        </Link>
      </nav>

      <div className={styles.user} id="shell-user">
        <div className={styles.avatar} id="shell-avatar" aria-hidden="true">
          {initial}
        </div>
        <div className={styles.userInfo}>
          <span className={styles.email} id="shell-user-email">
            {email}
          </span>
          <span
            className={`${styles.badge} ${isPaid ? styles.badgePaid : styles.badgeFree}`}
            id="shell-plan-badge"
          >
            {badgeLabel}
          </span>
        </div>
      </div>
    </header>
  );
}
