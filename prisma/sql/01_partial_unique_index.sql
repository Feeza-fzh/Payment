-- Hand-written SQL migration per PRD §10:
-- Partial unique index on CheckoutSession (userId, targetPlanId)
-- where status = 'PENDING' and kind <> 'RENEWAL'.
-- Holds at most one open pending checkout session per user and plan.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_checkout_session_user_target_pending"
ON "CheckoutSession" ("userId", "targetPlanId")
WHERE "status" = 'PENDING' AND "kind" <> 'RENEWAL';
