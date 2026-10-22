"use client";

import React, { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./BillingManager.module.css";
import {
  cancelSubscriptionAction,
  saveCancellationReasonAction,
  keepMyPlanAction,
  payNowAction,
} from "@/app/billing/actions";
import { CancellationReasonCode } from "@prisma/client";

export interface BillingManagerProps {
  planTier: "FREE" | "MONTHLY" | "YEARLY";
  status: "ACTIVE" | "PAST_DUE" | "ENDED";
  periodEndFormatted: string;
  nextChargeFormatted: string;
  cancelAtPeriodEnd: boolean;
  canceledAtFormatted?: string | null;
  pendingPlanTier?: "FREE" | "MONTHLY" | "YEARLY" | null;
  graceEndsAtFormatted?: string | null;
  downgradedToMonthly?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function planLabel(tier: BillingManagerProps["planTier"]): string {
  if (tier === "MONTHLY") return "Monthly";
  if (tier === "YEARLY") return "Yearly";
  return "Free";
}

function planSubtitle(tier: BillingManagerProps["planTier"]): string {
  if (tier === "MONTHLY") return "Billed every 30 days";
  if (tier === "YEARLY") return "Billed annually — best value";
  return "You are on the free plan with no active subscription.";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BillingManager(
  props: BillingManagerProps
): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resubscribeSuccess, setResubscribeSuccess] = useState(false);
  const isDowngradeBannerTarget = Boolean(
    (props.downgradedToMonthly || props.pendingPlanTier) &&
    !props.cancelAtPeriodEnd
  );
  const [showPendingBanner, setShowPendingBanner] = useState(
    isDowngradeBannerTarget
  );
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss the resubscribe success banner after 5 s
  useEffect(() => {
    if (!resubscribeSuccess) return;
    dismissTimerRef.current = setTimeout(() => setResubscribeSuccess(false), 5000);
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [resubscribeSuccess]);

  // Auto-dismiss the downgrade / pending plan banner after 5 s
  useEffect(() => {
    if (!isDowngradeBannerTarget) return;
    const timer = setTimeout(() => {
      setShowPendingBanner(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [isDowngradeBannerTarget]);

  // Modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [showResubscribeModal, setShowResubscribeModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState<CancellationReasonCode>(
    CancellationReasonCode.TOO_EXPENSIVE
  );
  const [reasonText, setReasonText] = useState("");

  const confirmCancel = () => {
    setError(null);
    startTransition(async () => {
      const requestId = Math.random().toString(36).substring(2, 10);
      const res = await cancelSubscriptionAction(requestId);
      if (res.ok) {
        setShowCancelModal(false);
        setShowReasonModal(true);
        setNotice(null);
      } else {
        setError(res.error ?? "Failed to cancel subscription.");
      }
    });
  };

  const submitReason = (skip: boolean) => {
    startTransition(async () => {
      if (!skip) {
        await saveCancellationReasonAction(
          selectedReason,
          reasonText.trim() ? reasonText.trim() : undefined
        );
      }
      setShowReasonModal(false);
    });
  };

  const handleKeepMyPlan = () => {
    setError(null);
    startTransition(async () => {
      const requestId = Math.random().toString(36).substring(2, 10);
      const res = await keepMyPlanAction(requestId);
      if (res.ok) {
        setResubscribeSuccess(true);
      } else {
        setError(res.error ?? "Failed to update subscription.");
      }
    });
  };


  const handlePayNow = () => {
    setError(null);
    startTransition(async () => {
      const res = await payNowAction();
      if (res.ok && res.data) {
        if (res.data.type === "REDIRECT" && res.data.redirectUrl) {
          window.location.href = res.data.redirectUrl;
        } else {
          setNotice("Payment successful! Your subscription is active.");
        }
      } else {
        setError(res.error ?? "Payment attempt failed.");
      }
    });
  };

  const canCancel =
    props.status === "ACTIVE" &&
    !props.cancelAtPeriodEnd &&
    props.planTier !== "FREE";
  const hasActions =
    props.status === "PAST_DUE" ||
    canCancel;

  return (
    <div className={styles.container}>
      {/* Alert banners */}
      {error && (
        <div className={`${styles.alert} ${styles.alertDanger}`} role="alert">
          {error}
        </div>
      )}
      {notice && !props.cancelAtPeriodEnd && (
        <div className={`${styles.alert} ${styles.alertInfo}`} role="status">
          {notice}
        </div>
      )}
      {resubscribeSuccess && (
        <div className={`${styles.alert} ${styles.alertSuccess}`} role="status">
          Resubscribed successfully.
        </div>
      )}
      {props.status === "PAST_DUE" && props.graceEndsAtFormatted && (
        <div
          className={`${styles.alert} ${styles.alertDanger}`}
          role="alert"
        >
          ⚠️ Payment failed. Pay now to keep access — grace period ends{" "}
          <strong>{props.graceEndsAtFormatted}</strong>.
        </div>
      )}
      {props.cancelAtPeriodEnd && (
        <div className={`${styles.alert} ${styles.alertCancel}`} role="status">
          <span>
            Your subscription will be canceled on {props.periodEndFormatted}.
          </span>
          <button
            className={styles.btnResubscribe}
            onClick={() => setShowResubscribeModal(true)}
            disabled={isPending}
            id="btn-resubscribe"
          >
            Resubscribe
          </button>
        </div>
      )}
      {showPendingBanner && isDowngradeBannerTarget && (
        <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
          {props.downgradedToMonthly || props.pendingPlanTier === "MONTHLY" ? (
            <span>
              You have downgraded to the Monthly plan. Your subscription ends on{" "}
              <strong>{props.periodEndFormatted}</strong>.
            </span>
          ) : (
            <span>
              You have scheduled a switch to the {planLabel(props.pendingPlanTier!)} plan. Your subscription ends on{" "}
              <strong>{props.periodEndFormatted}</strong>.
            </span>
          )}
        </div>
      )}

      {/* Plan hero */}
      <div className={styles.planHero}>
        <div className={styles.planInfo}>
          {props.planTier === "FREE" && (
            <span className={styles.freeBadge}>Current Tier</span>
          )}
          <h1 className={styles.planName} id="current-plan-name">
            {planLabel(props.planTier)} Plan
          </h1>
          <p className={styles.planSub}>{planSubtitle(props.planTier)}</p>
        </div>
        <Link
          href="/plans"
          className={styles.managePlansLink}
          id="btn-manage-plans"
        >
          {props.planTier === "FREE" ? "Upgrade Plan" : "Manage Plans"}
        </Link>
      </div>

      {/* Meta strip */}
      {props.planTier === "FREE" ? (
        <div className={styles.metaGrid}>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Status</span>
            <span className={styles.metaValue}>Free Tier</span>
          </div>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Recurring Cost</span>
            <span className={styles.metaValue}>₦0</span>
          </div>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Subscription</span>
            <span className={styles.metaValue}>None active</span>
          </div>
        </div>
      ) : (
        <div className={styles.metaGrid}>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>
              {props.cancelAtPeriodEnd ? "Access Ends" : "Renews On"}
            </span>
            <span className={styles.metaValue}>{props.periodEndFormatted}</span>
          </div>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Next Charge</span>
            <span className={styles.metaValue}>
              {props.cancelAtPeriodEnd ? "₦0" : props.nextChargeFormatted}
            </span>
          </div>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Billing Cycle</span>
            <span className={styles.metaValue}>
              {props.planTier === "YEARLY" ? "Annual" : "Monthly"}
            </span>
          </div>
        </div>
      )}

      {/* Free plan upgrade callout */}
      {props.planTier === "FREE" && (
        <div className={styles.freeUpgradeCta}>
          <p className={styles.freeUpgradeText}>
            You currently have no active paid plan. Upgrade to a Monthly or Yearly plan to unlock all features.
          </p>
          <Link
            href="/plans"
            className={styles.btnPrimary}
            id="btn-explore-plans"
            style={{ textDecoration: "none", display: "inline-block" }}
          >
            Explore Plans
          </Link>
        </div>
      )}

      {/* Actions row */}
      {hasActions && (
        <div className={styles.actionsRow}>
          {/* Pay now (PAST_DUE) */}
          {props.status === "PAST_DUE" && (
            <button
              className={styles.btnPrimary}
              onClick={handlePayNow}
              disabled={isPending}
              id="btn-pay-now"
            >
              {isPending ? "Processing…" : "Pay Now"}
            </button>
          )}



          {/* Cancel */}
          {canCancel && (
            <button
              className={styles.btnDanger}
              onClick={() => {
                setError(null);
                setShowCancelModal(true);
              }}
              disabled={isPending}
              id="btn-cancel-subscription"
            >
              Cancel Subscription
            </button>
          )}
        </div>
      )}

      {/* ── Resubscribe confirmation modal ────────────────────────────────── */}
      {showResubscribeModal && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="resubscribe-modal-title">
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle} id="resubscribe-modal-title">
              Resubscribe?
            </h3>
            <div className={styles.modalBody}>
              <p>
                You&apos;ll keep access to your current{" "}
                <strong>{planLabel(props.planTier)} Plan</strong>. Your next
                charge of{" "}
                <strong>{props.nextChargeFormatted}</strong> will be processed
                on <strong>{props.periodEndFormatted}</strong>.
              </p>
              <p>You can cancel again at any time before that date.</p>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setShowResubscribeModal(false)}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                className={styles.btnPrimary}
                onClick={() => {
                  setShowResubscribeModal(false);
                  handleKeepMyPlan();
                }}
                disabled={isPending}
                id="btn-confirm-resubscribe"
              >
                {isPending ? "Updating…" : "Confirm Resubscription"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel confirmation modal ──────────────────────────────────────── */}
      {showCancelModal && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Cancel Subscription?</h3>
            <div className={styles.modalBody}>
              <p>
                Your paid access will continue until{" "}
                <strong>{props.periodEndFormatted}</strong>. After that, your
                account reverts to the Free plan.
              </p>
              <p>No further charges will be made.</p>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setShowCancelModal(false)}
                disabled={isPending}
              >
                Keep Subscription
              </button>
              <button
                className={styles.btnDanger}
                onClick={confirmCancel}
                disabled={isPending}
              >
                {isPending ? "Cancelling…" : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reason survey modal ────────────────────────────────────────────── */}
      {showReasonModal && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Help us improve</h3>
            <div className={styles.modalBody}>
              <p>Why did you decide to cancel? (Optional)</p>
              <div className={styles.radioGroup}>
                {(
                  [
                    [CancellationReasonCode.TOO_EXPENSIVE, "Too expensive"],
                    [
                      CancellationReasonCode.MISSING_FEATURES,
                      "Missing features",
                    ],
                    [CancellationReasonCode.NOT_USING, "Not using it enough"],
                    [
                      CancellationReasonCode.FOUND_ALTERNATIVE,
                      "Found an alternative",
                    ],
                    [CancellationReasonCode.OTHER, "Other"],
                  ] as [CancellationReasonCode, string][]
                ).map(([code, label]) => (
                  <label key={code} className={styles.radioLabel}>
                    <input
                      type="radio"
                      name="reason"
                      checked={selectedReason === code}
                      onChange={() => setSelectedReason(code)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <textarea
                className={styles.textarea}
                placeholder="Additional feedback (optional, up to 500 characters)"
                maxLength={500}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => submitReason(true)}
                disabled={isPending}
              >
                Skip
              </button>
              <button
                className={styles.btnPrimary}
                onClick={() => submitReason(false)}
                disabled={isPending}
              >
                {isPending ? "Saving…" : "Submit Feedback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
