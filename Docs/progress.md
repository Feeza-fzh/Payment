# Progress

## Current Phase: 1 — Core path

Phase 0 spike skipped by owner decision (2026-10-20). Open Questions 3, 9, 10, 11 answered and recorded in `decisions.md`.

---

## Phase 0 — Spike
- [x] Open Questions 3, 9, 10, 11 answered (owner skipped spike, answered directly)
- [ ] Flutterwave docs review (spike skipped by owner)
- [ ] `docs/spike-notes.md` written (spike skipped by owner)

## Phase 1 — Core path
- [ ] Schema, DB roles, seed
- [ ] Shell (FR-1)
- [x] Plans view UI design (FR-2) — single-screen subscription slice
- [x] Checkout initiation (FR-3)
- [ ] Webhook with signature and idempotency (FR-9)
- [ ] Verification (FR-6, FR-7)
- [ ] `fulfillEntitlement` (FR-6, FR-9)
- [ ] Return view (FR-6, FR-7, FR-8)
- [ ] Payment log
- [ ] Error pages (FR-18)
- [ ] Tests: T1–T10, T22, T23, T24, T32

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
- Webhook and entitlement fulfillment: next steps in Phase 1

Assumptions or questions
- none


