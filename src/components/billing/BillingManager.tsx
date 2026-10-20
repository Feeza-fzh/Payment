"use client";

import React, { useState, useTransition } from "react";
import styles from "./BillingManager.module.css";
import {
  cancelSubscriptionAction,
  saveCancellationReasonAction,
  scheduleDowngradeAction,
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
}

export default function BillingManager(props: BillingManagerProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modals state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState<CancellationReasonCode>(
    CancellationReasonCode.TOO_EXPENSIVE
  );
  const [reasonText, setReasonText] = useState("");

  const handleCancelClick = () => {
    setError(null);
    setShowCancelModal(true);
  };

  const confirmCancel = () => {
    startTransition(async () => {
      const requestId = Math.random().toString(36).substring(2, 10);
      const res = await cancelSubscriptionAction(requestId);
      if (res.ok) {
        setShowCancelModal(false);
        setShowReasonModal(true);
        setNotice("Your subscription will end on the scheduled date.");
      } else {
        setError(res.error || "Failed to cancel subscription.");
      }
    });
  };

  const submitReason = (skip = false) => {
    if (skip) {
      setShowReasonModal(false);
      return;
    }
    startTransition(async () => {
      const requestId = Math.random().toString(36).substring(2, 10);
      await saveCancellationReasonAction(selectedReason, reasonText, requestId);
      setShowReasonModal(false);
    });
  };

  const handleKeepMyPlan = () => {
    setError(null);
    startTransition(async () => {
      const requestId = Math.random().toString(36).substring(2, 10);
      const res = await keepMyPlanAction(requestId);
      if (res.ok) {
        setNotice("Your plan has been kept! You will remain subscribed.");
      } else {
        setError(res.error || "Failed to keep plan.");
      }
    });
  };

  const handleDowngrade = () => {
    setError(null);
    startTransition(async () => {
      const requestId = Math.random().toString(36).substring(2, 10);
      const res = await scheduleDowngradeAction(requestId);
      if (res.ok) {
        setNotice("Your plan will switch to Monthly at the end of your billing cycle.");
      } else {
        setError(res.error || "Failed to schedule downgrade.");
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
        setError(res.error || "Payment attempt failed.");
      }
    });
  };

  return (
    <div className={styles.container}>
      {error && <div className={`${styles.notice} ${styles.noticeDanger}`}>{error}</div>}
      {notice && <div className={`${styles.notice} ${styles.noticeWarning}`}>{notice}</div>}

      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Subscription Overview</h2>
          <span
            className={`${styles.statusBadge} ${
              props.status === "ACTIVE"
                ? styles.statusActive
                : props.status === "PAST_DUE"
                ? styles.statusPastDue
                : styles.statusEnded
            }`}
          >
            {props.status === "PAST_DUE" ? "Past Due" : props.status}
          </span>
        </div>

        {props.status === "PAST_DUE" && props.graceEndsAtFormatted && (
          <div className={`${styles.notice} ${styles.noticeDanger}`}>
            Payment failed. Please pay by {props.graceEndsAtFormatted} to retain access.
          </div>
        )}

        {props.cancelAtPeriodEnd && (
          <div className={`${styles.notice} ${styles.noticeWarning}`}>
            Your plan is set to cancel on {props.periodEndFormatted}. You will not be charged again.
          </div>
        )}

        {props.pendingPlanTier && (
          <div className={`${styles.notice} ${styles.noticeWarning}`}>
            Scheduled change: Switches to {props.pendingPlanTier} on {props.periodEndFormatted}.
          </div>
        )}

        <div className={styles.grid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Plan Tier</span>
            <span className={styles.fieldValue}>{props.planTier}</span>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              {props.cancelAtPeriodEnd ? "Access Ends" : "Renews On"}
            </span>
            <span className={styles.fieldValue}>{props.periodEndFormatted}</span>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Next Charge</span>
            <span className={styles.fieldValue}>
              {props.cancelAtPeriodEnd ? "₦0.00" : props.nextChargeFormatted}
            </span>
          </div>
        </div>

        <div className={styles.actions}>
          {props.status === "PAST_DUE" && (
            <button
              className={styles.btnPrimary}
              onClick={handlePayNow}
              disabled={isPending}
            >
              {isPending ? "Processing..." : "Pay Now"}
            </button>
          )}

          {(props.cancelAtPeriodEnd || props.pendingPlanTier) && (
            <button
              className={styles.btnPrimary}
              onClick={handleKeepMyPlan}
              disabled={isPending}
            >
              {isPending ? "Updating..." : "Keep My Plan"}
            </button>
          )}

          {props.status === "ACTIVE" &&
            props.planTier === "YEARLY" &&
            !props.cancelAtPeriodEnd &&
            !props.pendingPlanTier && (
              <button
                className={styles.btnSecondary}
                onClick={handleDowngrade}
                disabled={isPending}
              >
                {isPending ? "Updating..." : "Switch to Monthly"}
              </button>
            )}

          {props.status === "ACTIVE" &&
            !props.cancelAtPeriodEnd &&
            props.planTier !== "FREE" && (
              <button
                className={styles.btnDanger}
                onClick={handleCancelClick}
                disabled={isPending}
              >
                Cancel Subscription
              </button>
            )}
        </div>
      </div>

      {/* Cancel Confirmation Modal (FR-13, FR-14) */}
      {showCancelModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Cancel Subscription?</h3>
            <div className={styles.modalBody}>
              <p>
                Your paid access will continue until{" "}
                <strong>{props.periodEndFormatted}</strong>.
              </p>
              <p>No further charges will be made to your payment method.</p>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnSecondary}
                onClick={() => setShowCancelModal(false)}
                disabled={isPending}
              >
                Keep Plan
              </button>
              <button
                className={styles.btnDanger}
                onClick={confirmCancel}
                disabled={isPending}
              >
                {isPending ? "Cancelling..." : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optional Reason Survey Modal (FR-15) */}
      {showReasonModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Help us improve</h3>
            <div className={styles.modalBody}>
              <p>Why did you decide to cancel? (Optional)</p>
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="reason"
                    checked={selectedReason === CancellationReasonCode.TOO_EXPENSIVE}
                    onChange={() => setSelectedReason(CancellationReasonCode.TOO_EXPENSIVE)}
                  />
                  Too expensive
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="reason"
                    checked={selectedReason === CancellationReasonCode.MISSING_FEATURES}
                    onChange={() => setSelectedReason(CancellationReasonCode.MISSING_FEATURES)}
                  />
                  Missing features
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="reason"
                    checked={selectedReason === CancellationReasonCode.NOT_USING}
                    onChange={() => setSelectedReason(CancellationReasonCode.NOT_USING)}
                  />
                  Not using it enough
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="reason"
                    checked={selectedReason === CancellationReasonCode.FOUND_ALTERNATIVE}
                    onChange={() => setSelectedReason(CancellationReasonCode.FOUND_ALTERNATIVE)}
                  />
                  Found an alternative
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="reason"
                    checked={selectedReason === CancellationReasonCode.OTHER}
                    onChange={() => setSelectedReason(CancellationReasonCode.OTHER)}
                  />
                  Other
                </label>
              </div>
              <textarea
                className={styles.textarea}
                placeholder="Additional feedback (up to 500 characters)"
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
                {isPending ? "Saving..." : "Submit Feedback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
