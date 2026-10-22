import type { PlanCardProps, PlanCta } from "./types";
import styles from "./PlanCard.module.css";

/** SVG check icon — included feature */
function CheckIcon(): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1.5 5.5L4 8L8.5 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** SVG dash icon — excluded feature */
function DashIcon(): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 5H7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Resolve the CSS modifier class for a CTA kind (§5.2 matrix). */
function ctaClass(cta: PlanCta): string {
  switch (cta.kind) {
    case "current":
      return styles.ctaCurrent ?? "";
    case "disabled":
      return styles.ctaDisabled ?? "";
    case "scheduled":
      return styles.ctaScheduled ?? "";
    case "switch-to-monthly":
    case "downgrade-to-free":
      return styles.ctaSecondary ?? "";
    case "subscribe":
    case "upgrade":
    case "pay-now":
      return styles.ctaPrimary ?? "";
  }
}

/** Resolve the human-readable label for a CTA kind. */
function ctaLabel(cta: PlanCta): string {
  switch (cta.kind) {
    case "current":
      return "Current plan";
    case "subscribe":
      return "Upgrade";
    case "upgrade":
      return "Upgrade to yearly";
    case "downgrade-to-free":
      return "Downgrade to free";
    case "switch-to-monthly":
      return "Switch to monthly";
    case "scheduled":
      return cta.label;
    case "pay-now":
      return "Pay now";
    case "disabled":
      return cta.reason;
    default: {
      void (cta satisfies never);
      return "";
    }
  }
}

/**
 * PlanCard — FR-2, PRD §5.2
 * Presentation-only Server Component. Receives pre-resolved CTA and
 * pre-formatted prices from the page (S-9). Does no money math.
 */
export default function PlanCard({
  plan,
  cta,
  recommended = false,
}: PlanCardProps): React.ReactElement {
  const isCurrent = cta.kind === "current";
  const isDisabled =
    cta.kind === "disabled" ||
    cta.kind === "current" ||
    cta.kind === "scheduled";

  const cardClass = [
    styles.card,
    recommended ? styles.cardRecommended : "",
    isCurrent ? styles.cardCurrent : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClass} id={`plan-card-${plan.tier.toLowerCase()}`}>
      {recommended && (
        <span className={styles.badge} id={`plan-badge-${plan.tier.toLowerCase()}`}>
          Best value
        </span>
      )}

      <div className={styles.header}>
        <div className={styles.tier}>{plan.label}</div>
        <div className={styles.price}>
          <span className={styles.currency}>₦</span>
          <span className={styles.amount} id={`price-${plan.tier.toLowerCase()}`}>
            {plan.priceFormatted}
          </span>
          {plan.interval !== null && (
            <span className={styles.interval}>/{plan.interval}</span>
          )}
        </div>
      </div>

      <p className={styles.description}>{plan.description}</p>

      <div className={styles.divider} />

      <ul className={styles.features}>
        {plan.features.map((feature) => (
          <li key={feature.text} className={styles.feature}>
            <span
              className={`${styles.featureIcon} ${
                feature.included
                  ? styles.featureIconCheck
                  : styles.featureIconDash
              }`}
            >
              {feature.included ? <CheckIcon /> : <DashIcon />}
            </span>
            {feature.text}
          </li>
        ))}
      </ul>

      {isDisabled ? (
        <button
          className={`${styles.cta} ${ctaClass(cta)}`}
          id={`cta-${plan.tier.toLowerCase()}`}
          disabled
          type="button"
        >
          {ctaLabel(cta)}
        </button>
      ) : (
        <form
          action="/api/checkout/initiate"
          method="POST"
          style={{ width: "100%", marginTop: "auto" }}
        >
          <input type="hidden" name="planTier" value={plan.tier} />
          <button
            className={`${styles.cta} ${ctaClass(cta)}`}
            id={`cta-${plan.tier.toLowerCase()}`}
            type="submit"
            aria-label={ctaLabel(cta)}
          >
            {ctaLabel(cta)}
          </button>
        </form>
      )}
    </article>
  );
}
