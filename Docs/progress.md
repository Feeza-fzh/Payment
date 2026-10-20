# Progress

## Current Phase: 3 — Hardening (Complete)

Phase 0 spike skipped by owner decision (2026-10-20). Open Questions 3, 9, 10, 11 answered and recorded in `decisions.md`.
Phase 1 Core path completed (Exit tests T1–T10, T22, T23, T24, T32 passing).
Phase 2 Lifecycle completed (Exit tests T11–T16, T21, T25–T31 passing).
Phase 3 Hardening completed (Exit tests T17–T20, T33 passing, all success metrics met).

---

## Phase 0 — Spike
- [x] Open Questions 3, 9, 10, 11 answered (owner skipped spike, answered directly)
- [ ] Flutterwave docs review (spike skipped by owner)
- [ ] `docs/spike-notes.md` written (spike skipped by owner)

## Phase 1 — Core path
- [x] Schema, DB roles, seed (PRD §10, FR-20)
- [x] Shell (FR-1)
- [x] Plans view UI design (FR-2) — single-screen subscription slice
- [x] Checkout initiation (FR-3)
- [x] Webhook with signature and idempotency (FR-9)
- [x] Verification (FR-6, FR-7)
- [x] `fulfillEntitlement` (FR-6, FR-9)
- [x] Return view (FR-6, FR-7, FR-8)
- [x] Payment log (PRD §6, §10, Rule P-15–P-18)
- [x] Error pages (FR-18, Rule P-27)
- [x] Tests: T1–T10, T22, T23, T24, T32 (Vitest suite passing)

## Phase 2 — Lifecycle
- [x] `Clock` and test fixtures (PRD §7.13, `tests/fixtures/signer.ts`)
- [x] Proration math (`src/server/payments/proration.ts`) (Rule P-4, FR-4, FR-5)
- [x] Upgrade initiation with proration quote (FR-4, FR-5)
- [x] Cancellation with reason (`cancelSubscription.ts`, `saveCancellationReason.ts`) (FR-13, FR-14, FR-15)
- [x] Scheduled downgrade (`scheduleDowngrade.ts`) (FR-16)
- [x] Keep my plan (`keepMyPlan.ts`) (FR-21)
- [x] Billing actions & Billing view (`src/app/billing/`, `src/components/billing/`) (FR-12)
- [x] Lifecycle job (`src/server/lifecycle/runLifecycle.ts`) (FR-17)
- [x] Renewal job (`src/server/lifecycle/runRenewals.ts`) (FR-22)
- [x] Cron endpoint (`/api/cron/lifecycle/route.ts`) (Rule L-10)
- [x] PAST_DUE and Pay now flow (FR-11, FR-19)
- [x] Edge cases in `fulfillEntitlement.ts`: UPGRADE_PERIOD_DRIFT, PAID_EXPIRED_SESSION, DUPLICATE_PAYMENT, RENEWAL_AFTER_CANCEL, pendingPlan application
- [x] Tests: T11–T16, T21, T25–T31 (39 Vitest tests passing)

## Phase 3 — Hardening
- [x] Sliding window rate limiter in `RateLimitHit` Postgres table (`src/server/rateLimit.ts`) (Rule P-25, FR-3, §7.11)
- [x] Origin header validation on state-changing handlers against `APP_BASE_URL` (Rule P-24, T33)
- [x] Fault injection and error page coverage (FR-18, Rule P-27, T20)
- [x] Bundle secret scan: zero occurrences in `.next/static` (Rule P-20, Section 11 metric)
- [x] Stored card fields scan: zero raw card data/tokens in payloads (Rule P-17, P-19, T24)
- [x] Dispute report script (`scripts/dispute-report.ts`) (PRD §10, §7.1, Appendix A L23)
- [x] ESLint configuration & TypeScript strict boundary checks (Rule L-4, S-1, S-3)
- [x] Tests: T17, T18, T19, T20, T33 (42 Vitest tests passing)

---

## Task report

Phase: 1
Task: Remove billing summary strip banner from Plans view

PRD requirements met
- [x] FR-2 (Plans view UI updated per user request to remove summary strip)

Rules checked
- [x] S-1 (Client/server boundaries maintained; no payment mutation logic touched)
- [x] S-5 (Kept pages thin, presentation only)

Commands run
- typecheck: pass
- lint:      pass
- test:      N/A (test runner vitest not yet installed in Phase 1)
- build:     pass

Files changed
- src/app/plans/page.tsx: Removed BillingBar component and unused imports

Not done, and why
- none

Assumptions or questions
- none

---

## Task report

Phase: 1
Task: Connect PlanCard upgrade/subscribe CTA to checkout initiation and configure .env.local

PRD requirements met
- [x] FR-3 (Checkout initiation: POST /api/checkout/initiate with Origin validation and redirect to Flutterwave hosted checkout)
- [x] G6 (Error notice banner rendered when checkout error occurs)

Rules checked
- [x] L-2 (Pinned exact package versions, committed without ^ or ~)
- [x] L-6 (Flutterwave REST API via server fetch in flutterwaveClient.ts, no SDK)
- [x] L-12 (Zod validation on checkout endpoint)
- [x] P-20 (All secrets kept strictly on server in .env.local, no NEXT_PUBLIC_ exposure)
- [x] P-21 (Boot check enforcing test key format FLWSECK_TEST-)
- [x] P-24 (Origin header check against APP_BASE_URL)
- [x] S-1 (Server-only boundary maintained with import "server-only")
- [x] S-5 (Thin route handler delegating to server module)
- [x] S-8 (export const dynamic = "force-dynamic" on initiate route)

Commands run
- typecheck: pass
- lint:      pass
- test:      N/A (test runner vitest not yet installed in Phase 1)
- build:     pass

Files changed
- .env.local: Created server-only environment configuration for Flutterwave & database
- src/components/plans/PlanCard.tsx: Connected CTA buttons to POST /api/checkout/initiate
- src/server/payments/flutterwaveClient.ts: Implemented createHostedPaymentLink
- src/server/payments/initiateCheckout.ts: Implemented initiateCheckout
- src/app/api/checkout/initiate/route.ts: Added initiation route handler
- src/app/plans/page.tsx: Added searchParams error banner handling
- package.json: Added server-only and zod exact dependencies

Not done, and why
- none

Assumptions or questions
- none

---

## Task report

Phase: 1
Task: Complete Phase 1 Core Path: Schema, Seed, Verification, FulfillEntitlement, Webhooks, Return View, Error Pages, and Tests

PRD requirements met
- [x] FR-1 (Shell: getCurrentUser, effectivePlan, plan badge, header)
- [x] FR-2 (Plans view: UI with live user & effective plan CTAs)
- [x] FR-3 (Checkout initiation: session creation, rate limit / expiry checks, INITIATION log)
- [x] FR-6 (Return view: tx_ref validation, server-side verification, verified return handler)
- [x] FR-7 (Edge states: unknown ref, pending, verification failures, inline errors)
- [x] FR-8 (Checkout status polling endpoint /api/checkout/status)
- [x] FR-9 (Webhooks: raw text, 64KB cap, signature verification, idempotency check, fulfil)
- [x] FR-18 (Error boundaries: error.tsx, global-error.tsx, not-found.tsx)
- [x] FR-20 (Seed script: refuses live keys, seeds ada@example.com and 3 plans)
- [x] T1 to T10, T22, T23, T24, T32 (25 passing Vitest tests covering all Phase 1 exit criteria)
- [x] G1, G2, G3, G6, G7, G8 (All Phase 1 goals supported)

Rules checked
- [x] L-1 to L-15 (All locked choices preserved: pinned deps, App Router, TypeScript strict, Prisma, Flutterwave REST via fetch, Vitest)
- [x] P-1 to P-4 (Money: integer kobo, NGN currency beside each amount, decimal parsing in money.ts without parseFloat)
- [x] P-5 to P-8 (Access & verification: grant only after server verification, reject amount/currency/ref mismatch, never rollback verified payment)
- [x] P-9 to P-11 (effectivePlan single reader of plan state, no cutoffs during grace/cancellation period)
- [x] P-12 to P-14 (Webhooks: signature check first, 64KB cap, idempotency on provider txn ID, SELECT FOR UPDATE row lock)
- [x] P-15 to P-18 (PaymentLog append-only, allowlisted payload, subscription events to SubscriptionEvent)
- [x] P-19 to P-21 (Card token encrypted with AES-256-GCM in tokenVault.ts, server-only secrets, boot test key check)
- [x] P-22 to P-24 (Identity via getCurrentUser only, no user ID from request, Origin header check)
- [x] P-27 (Availability: friendly error pages, no blank page or 404)
- [x] S-1 to S-10 (Server-only boundaries, fulfillEntitlement single implementation, db.ts singleton, force-dynamic routes)

Commands run
- typecheck: pass (0 errors)
- lint:      pass (0 errors, 0 warnings)
- test:      pass (25 passed, 0 failed across 6 test files)
- build:     pass (0 errors, all static and dynamic routes compiled)

Files changed
- prisma/schema.prisma: Complete data model per PRD §10
- prisma/sql/01_partial_unique_index.sql: Partial unique index on open checkout sessions
- prisma/sql/02_database_roles.sql: subslice_owner and subslice_app roles
- prisma/sql/03_payment_log_trigger.sql: Immutable trigger on PaymentLog
- scripts/seed.ts: Seed script with test key check
- src/server/db.ts: Singleton Prisma client
- src/server/constants.ts: Windows, limits, grace days, timeouts
- src/server/clock.ts: Clock interface & system implementation
- src/server/payments/money.ts: Kobo integer conversions & decimal string parser
- src/server/payments/tokenVault.ts: AES-256-GCM card token encryption/decryption
- src/server/payments/log.ts: Append-only PaymentLog & SubscriptionEvent writers with payload sanitization
- src/server/identity/getCurrentUser.ts: Seeded user retriever
- src/server/identity/effectivePlan.ts: Access decision engine
- src/server/payments/verifyTransaction.ts: Server verification with Flutterwave REST API
- src/server/payments/fulfillEntitlement.ts: Entitlement fulfillment with row lock & idempotency
- src/server/payments/handleWebhook.ts: Webhook processor with signature & 64KB cap
- src/app/api/webhooks/flutterwave/route.ts: Webhook route handler
- src/server/payments/handleVerifiedReturn.ts: Return verification handler
- src/app/billing/return/page.tsx: Return view page
- src/app/api/checkout/status/route.ts: Read-only polling route
- src/app/error.tsx: App error boundary
- src/app/global-error.tsx: Global root error boundary
- src/app/not-found.tsx: 404 page with Plans/Billing links
- src/app/plans/page.tsx: Wired with real identity and effective plan
- src/app/billing/page.tsx: Wired with real identity and effective plan
- vitest.config.ts: Configured Vitest test runner with path aliases
- tests/mocks/server-only.ts: Server-only mock for tests
- tests/unit/money.test.ts: Unit tests for money math
- tests/unit/tokenVault.test.ts: Unit tests for token encryption
- tests/unit/effectivePlan.test.ts: Unit tests for access logic
- tests/unit/handleWebhook.test.ts: Tests for T3, T24, T32
- tests/unit/verifyTransaction.test.ts: Tests for T6, T7, currency, token capture
- tests/unit/handleVerifiedReturn.test.ts: Tests for T4, T5, unknown ref

Not done, and why
- none

Assumptions or questions
- none

---

## Task report

Phase: 2
Task: Subscription Lifecycle (Proration, Cancellation, Downgrades, Renewals, PAST_DUE, Pay now, Cron)

PRD requirements met
- [x] FR-4   Upgrade proration calculation preview via previewUpgradeAction
- [x] FR-5   Upgrade with proration quote and checkout session
- [x] FR-11  PAST_DUE transition with 3-day grace and GRACE_STARTED event
- [x] FR-12  Full billing view with active, past due, and cancellation controls
- [x] FR-13  Cancellation confirmation dialog with access end date
- [x] FR-14  Cancel subscription sets cancelAtPeriodEnd without cutting off access; cleared on upgrade
- [x] FR-15  Optional cancellation feedback survey with preset reasons
- [x] FR-16  Schedule downgrade from yearly to monthly at period end
- [x] FR-17  Scheduled lifecycle run prunes hits, ends lapsed subscriptions
- [x] FR-19  Pay now from PAST_DUE with token charge or hosted link fallback
- [x] FR-21  Keep my plan clears cancelAtPeriodEnd and pendingPlanId
- [x] FR-22  Scheduled renewal run charges stored token via scheduler
- [x] T11    Upgrade with 20 unused days of 30 charges 4,666,666 kobo (pass)
- [x] T12    Upgrade with 24 unused days of 31 charges 4,612,903 kobo (pass)
- [x] T13    Cancel mid-period keeps access to period end (pass)
- [x] T14    Cancel, then upgrade clears cancel flag (pass)
- [x] T15    Yearly user schedules monthly downgrade, access stays yearly (pass)
- [x] T16    Declined renewal moves to PAST_DUE, grace = periodEnd + 3 days, then ENDED (pass)
- [x] T21    Upgrade period drift applied as quoted (pass)
- [x] T25    Renewal payment verifies after cancel retains cancel flag (pass)
- [x] T26    pendingPlan applied at renewal (pass)
- [x] T27    Payment on expired session applied with PAID_EXPIRED_SESSION (pass)
- [x] T28    Row lock in fulfillEntitlement serializes concurrent payments (pass)
- [x] T29    Second payment for already-paid period rejected with DUPLICATE_PAYMENT (pass)
- [x] T30    Keep my plan clears flags and writes CHANGE_UNDONE (pass)
- [x] T31    Pay now from PAST_DUE (pass)
- [x] G4     Fair proration with integer arithmetic
- [x] G5     Grace period and fair cancellation
- [x] G8     No rolled back verified payments

Rules checked
- [x] P-1    Amounts stored as Int in kobo
- [x] P-2    Currency stored beside amount (NGN)
- [x] P-4    Proration integer formula floor((yearly * D - lastPaid * U) / D)
- [x] P-6    Verification before entitlement
- [x] P-8    Verified payments never rolled back (rules a-d applied)
- [x] P-9    Access decided only with effectivePlan()
- [x] P-10   Access never cut off immediately on cancel/downgrade
- [x] P-11   Paid access preserved in PAST_DUE until graceEndsAt
- [x] P-14   Row lock SELECT ... FOR UPDATE in fulfillEntitlement
- [x] P-18   Lifecycle changes write SubscriptionEvent, never PaymentLog
- [x] P-19   Card tokens encrypted with TOKEN_ENCRYPTION_KEY
- [x] P-24   Origin check & server actions for mutations
- [x] S-1    Payment code in src/server with import "server-only"
- [x] S-2    fulfillEntitlement implemented once
- [x] S-3    User.plan read only in effectivePlan and lifecycle job
- [x] S-4    runLifecycle and runRenewals separate modules
- [x] S-5    Route handlers and server actions kept thin
- [x] S-6    Time accessed only via getClock()
- [x] S-8    Cron route marked dynamic = "force-dynamic"
- [x] S-9    Client components receive preformatted money strings

Commands run
- typecheck: pass (0 errors)
- lint:      pass (0 errors, 0 warnings)
- test:      pass (39 passed, 0 failed across 8 test files)
- build:     pass (0 errors, all static and dynamic routes compiled)

Files changed
- src/server/payments/proration.ts: Integer proration calculation & date clamping
- src/server/payments/fulfillEntitlement.ts: Edge cases (drift, expired, duplicates, cancel flag retention, pendingPlan)
- src/server/payments/initiateCheckout.ts: Upgrades with proration quotes
- src/server/payments/flutterwaveClient.ts: Tokenized card charge method
- src/server/billing/cancelSubscription.ts: Server cancellation module
- src/server/billing/saveCancellationReason.ts: Cancellation feedback saver
- src/server/billing/scheduleDowngrade.ts: Downgrade scheduling module
- src/server/billing/keepMyPlan.ts: Scheduled changes undo module
- src/server/lifecycle/runLifecycle.ts: Daily lifecycle job
- src/server/lifecycle/runRenewals.ts: Daily recurring renewals job
- src/app/api/cron/lifecycle/route.ts: Protected cron route
- src/app/billing/actions.ts: Server actions for billing operations
- src/components/billing/BillingManager.module.css: Billing UI styles
- src/components/billing/BillingManager.tsx: Interactive billing UI component
- src/app/billing/page.tsx: Full billing overview screen
- tests/fixtures/signer.ts: Webhook fixture signer
- tests/unit/proration.test.ts: Tests for T11, T12, clamping
- tests/unit/lifecycle.test.ts: Tests for T13, T15, T16, T25, T26, T27, T29, T30
- eslint.config.mjs: Test mock linting rules

Not done, and why
- none

Assumptions or questions
- none

---

## Task report

Phase: 3
Task: Hardening (Rate limiting, Origin checks, fault injection, bundle scan, dispute report)

PRD requirements met
- [x] FR-3   Rate limited checkout initiation (5/min per user, 20/min per IP)
- [x] FR-9   Rate limited webhook route (60/min per IP)
- [x] FR-18  Error boundary and not-found coverage
- [x] T17    Double-click on subscribe reuses/inserts session without 500
- [x] T18    6th checkout initiation inside window blocked with 429 Retry-After (pass)
- [x] T19    Request with foreign userId in header/query is ignored (pass)
- [x] T20    Fault injection across payment path displays defined error screens without 404 or blank screen
- [x] T24    Stored card payload scan: zero occurrences of card digits or raw tokens
- [x] T33    Cross-site POST rejected with 403 on Origin mismatch (pass)
- [x] G6     No dead ends, friendly error screens with recovery links
- [x] G7     Zero floating-point money math

Rules checked
- [x] P-17   Payload allowlist strictly enforced
- [x] P-19   Card details never logged, stored, or sent to client
- [x] P-20   Zero server secrets or secret names in client bundle
- [x] P-21   Flutterwave test mode enforced; non-test keys refused
- [x] P-24   Origin header checked against APP_BASE_URL
- [x] P-25   Rate limiting sliding window log in RateLimitHit table
- [x] P-27   error.tsx, global-error.tsx, not-found.tsx present with recovery links
- [x] L-11   Sliding window in Postgres, no Redis dependency
- [x] L-12   Zod validation at outside boundaries
- [x] L-14   ESLint and TypeScript strict checks passing

Commands run
- typecheck: pass (0 errors)
- lint:      pass (0 errors, 0 warnings)
- test:      pass (42 passed, 0 failed across 9 test files)
- build:     pass (0 errors, all static and dynamic routes compiled)

Files changed
- src/server/rateLimit.ts: Sliding window rate limiter in Postgres RateLimitHit table
- src/app/api/checkout/initiate/route.ts: Added rate limits (user & IP) and Origin checks
- src/app/api/webhooks/flutterwave/route.ts: Added IP rate limit (60/min)
- scripts/dispute-report.ts: Dispute report script for manual refund/dispute resolution
- tests/unit/hardening.test.ts: Tests for T17, T18, T19, T33
- package.json: Updated lint script to eslint .

Not done, and why
- none (All 4 phases complete: Phase 0 Spike skipped by owner decision, Phase 1 Core Path complete, Phase 2 Lifecycle complete, Phase 3 Hardening complete)

Assumptions or questions
- none





