# PRD: Test-Mode Subscription Slice

Revision 2. Incorporates the live review corrections L1 to L30.

Status: ready to build once Open Questions 3, 9, 10 and 11 are answered. Appendix A maps every fix to its section.

## 1. Product Summary

This is a test-mode subscription slice built on Flutterwave. It sells one paid plan on a monthly and a yearly interval, next to a free plan, and the only thing sold is a plan flag on a user record. A seeded user acts as the signed-in user, and the build adds no authentication. Users can subscribe, upgrade mid-cycle with a prorated charge, downgrade or cancel at period end, and see their billing state. It is done when every payment event is logged and no plan is granted without server-side verification.

## 2. Problem Statement

This build prevents five payment failures.

- A redirect to a success URL can grant access to anyone who types that URL. (G1)
- A single status column shows the present but not the history. In a dispute, nothing proves what was initiated, verified, or fulfilled. (G2)
- A repeated webhook can extend a plan twice. (G3)
- Without a fixed formula, a mid-cycle upgrade price is a guess. (G4)
- Cancellation can cut off access the user already paid for. (G5)

Each failure ends in a dispute, a refund, or lost trust. This slice proves the whole payment path, including the failure paths, before any real feature sits behind the paywall.

## 3. Goals and Non-Goals

### Goals

| ID | Goal | Measure |
|---|---|---|
| G1 | Grant paid access only after server-side verification | 0 paid users without a FULFILMENT log row |
| G2 | Record every payment event | 100% of test transactions have a complete trail. Success means INITIATION, VERIFICATION and FULFILMENT rows. Failure means an INITIATION row and at least one FAILURE row. |
| G3 | Act once on repeated webhooks | 5 replays, including 5 parallel replays, produce 1 fulfilment |
| G4 | Prorate upgrades correctly and show the amount before payment | Matches values computed independently in a spreadsheet for 20 dates |
| G5 | Keep paid access to period end after cancel or downgrade | 0 early cutoffs in tests |
| G6 | Never show a blank page or 404 in the payment path | 0 blank pages or 404s across the 8 user-visible rows of 7.12 |
| G7 | Keep money as integer kobo with currency stored beside it | 0 Float or Decimal fields in application money math |
| G8 | Every verified payment ends in an entitlement or a flagged log row | 0 verified payments with neither |

### Non-goals

- No landing page and no pricing marketing page.
- No product features behind the paywall.
- No authentication: no login, signup, password reset, sessions, or OAuth.
- No admin screen, no invoice or payment history screen, no refunds, no free trial, no multi-currency, no tax logic.
- No resume control for an ended subscription. The user subscribes again. A scheduled cancel or downgrade can be undone with Keep my plan (FR-21).

## 4. User Personas

All personas act through the one seeded user. They differ by subscription state, not by account.

| Persona | Goal | Payment scenario | Failure they fear |
|---|---|---|---|
| Ada, first-time subscriber (state: free) | Start the monthly plan | Pays on Flutterwave, returns to the app | Paying and seeing no change |
| Tunde, monthly user (state: monthly, mid-cycle) | Move to yearly without paying twice | Sees a prorated amount, pays the difference | An unclear or inflated charge |
| Ngozi, leaving user (state: active, cancelling) | Stop future billing and keep what she paid for | Cancels, confirms, gives a reason | Losing access early or being billed again |

## 5. Functional Requirements

### 5.1 Subscription status model

`User.plan` is `FREE`, `MONTHLY`, or `YEARLY`. The `Subscription` row holds lifecycle state. Only `effectivePlan()` decides access (7.3). PAST_DUE keeps paid access until `graceEndsAt`, and `graceEndsAt` = `currentPeriodEnd` + 3 days.

| From | To | Trigger | Owner |
|---|---|---|---|
| No row, or ENDED | ACTIVE | Verified first payment | `fulfillEntitlement()` |
| ACTIVE (monthly) | ACTIVE (yearly) | Verified upgrade payment. New period starts on the quote date. Clears pending change and cancel flag. | `fulfillEntitlement()` |
| ACTIVE | ACTIVE (new period) | Verified renewal charge. Next period starts at the old period end. | `fulfillEntitlement()` |
| ACTIVE with `pendingPlan` monthly | ACTIVE monthly | Verified renewal at the monthly price. Clears `pendingPlan`. | `fulfillEntitlement()` |
| ACTIVE | ACTIVE with `cancelAtPeriodEnd` | User confirms cancel | Billing action |
| ACTIVE (yearly) | ACTIVE with `pendingPlan` monthly | User schedules downgrade | Billing action |
| ACTIVE with cancel flag or `pendingPlan` | ACTIVE, flags cleared | User clicks Keep my plan (FR-21) | Billing action |
| ACTIVE | PAST_DUE | Renewal charge declined, or still pending after 24 hours. Sets `graceEndsAt`. | Renewal job |
| PAST_DUE | ACTIVE | Verified payment inside grace. New period starts on the payment date. | `fulfillEntitlement()` |
| PAST_DUE | ENDED | Grace expires | Lifecycle job |
| ACTIVE with `cancelAtPeriodEnd` | ENDED | Period end passes | Lifecycle job |
| ACTIVE, no verified renewal | ENDED | `currentPeriodEnd` + 3 days passes with no verified renewal | Lifecycle job |

The lifecycle job never grants access. It only lowers or ends it.

### 5.2 Plans view call-to-action matrix

| User state | Free card | Monthly card | Yearly card |
|---|---|---|---|
| Free or ENDED | Current plan | Subscribe | Subscribe |
| Monthly, active | Downgrade to free (opens cancel confirmation) | Current plan | Upgrade to yearly (opens proration preview) |
| Monthly, cancel scheduled | Scheduled, ends {date}. Keep my plan. | Current plan | Upgrade to yearly |
| Yearly, active | Downgrade to free (opens cancel confirmation) | Switch to monthly at renewal | Current plan |
| Yearly, pending monthly | Downgrade to free | Scheduled for {date}. Keep my plan. | Current plan |
| PAST_DUE | Disabled | If this is the current plan: Pay now. Otherwise disabled with “Pay your balance first”. | If this is the current plan: Pay now. Otherwise disabled with “Pay your balance first”. |

“Downgrade to free” and “Cancel” are the same action. Only the cancel flow asks for a reason.

### 5.3 Requirements

| ID | Trigger | System action | User sees | Error state |
|---|---|---|---|---|
| FR-1 | Any page load | Call `getCurrentUser()`. Render the shell with email, plan badge (from `effectivePlan()`), and links to Plans and Billing. | The shell with the correct plan | Seeded user missing: setup-incomplete page that names the seed command. Never blank. |
| FR-2 | Open Plans view | Read three plans from the `Plan` table. Mark the current plan per 5.2. | Three cards with naira prices, current plan marked | DB read fails: inline error panel with a Retry link. |
| FR-3 | Click Subscribe | `POST /api/checkout/initiate`. Check Origin. Rate limit. Expire stale sessions, then reuse or create one `CheckoutSession` (7.5). Write INITIATION. Create the hosted payment link with card tokenization on. Redirect. | Redirect to Flutterwave | 429: message with wait time. Provider error: FAILURE row and inline error with Retry. |
| FR-4 | Click Upgrade to yearly | Server action `previewUpgrade` computes proration (7.9). It does not write to the log. | Confirmation panel: yearly price, credit, charge today, new period dates, next renewal | Action fails: inline error. No charge. |
| FR-5 | Confirm upgrade | Create an UPGRADE session. Store charge, credit, and quoted period start and end. The session expires at 15 minutes or UTC midnight, whichever is first. Write INITIATION. Create the hosted payment link for the prorated amount. Redirect. | Redirect to Flutterwave for the prorated amount | Same as FR-3. |
| FR-6 | Land on return view | Read `tx_ref` from the query. Find the session for the current user. Call `verifyTransaction()`. On success, call `fulfillEntitlement()` through the verified-return handler. The `status` query value is ignored. | “Payment confirmed” with a link to Billing | See FR-7. |
| FR-7 | Return view edge states | Unknown or missing `tx_ref`: grant nothing, write nothing. Provider says pending: show processing. Verification fails or amounts mismatch: write FAILURE. | Unknown ref: “We could not find this payment” with a link to Plans. Pending: processing page that polls FR-8. Failed: “Payment not completed” with Retry. | Verify API timeout: processing page, then a “still checking” message. Never blank. |
| FR-8 | Processing page polls | A read-only status endpoint reads the DB every 3 seconds for up to 60 seconds. | Auto-updates to confirmed | After 60 seconds: “Still processing. We will update your plan when payment confirms.” with a link to Billing. |
| FR-9 | Webhook arrives | Order: read raw body, size cap, signature check, parse, idempotency check on the provider transaction id, provider verification, `fulfillEntitlement()`. A repeat with an existing FULFILMENT row returns 200 with no provider call. | Nothing (server only) | Bad signature: 401 and a hash-only FAILURE row. Body over 64 KB: 413. Transient DB or API error: 5xx so the provider retries. |
| FR-10 | Renewal webhook, success | Match the session by `tx_ref`. Renewal sessions carry our own references. Verify. Fulfil. Apply `pendingPlan` if set. | Renewal date moves forward | No matching session: FAILURE row with outcome UNMATCHED_REFERENCE, return 200. |
| FR-11 | Renewal charge declined | Set PAST_DUE and `graceEndsAt` = `currentPeriodEnd` + 3 days. Write FAILURE to PaymentLog and GRACE_STARTED to SubscriptionEvent. Paid access continues until `graceEndsAt`. | Billing shows “Payment failed, pay by {date}” with Pay now | None. |
| FR-12 | Open Billing | Show plan, status, renewal or end date, next charge amount, pending change notice, and the cancel control. Show Keep my plan when a cancel or downgrade is scheduled. | Current state, accurate to the stored data | DB error: inline error panel. |
| FR-13 | Click Cancel | Open a confirmation dialog. It states the access end date and that no further charge occurs. The dialog carries a one-time request id. | Dialog with Confirm and Keep plan | None. |
| FR-14 | Confirm cancel | Set `cancelAtPeriodEnd` and `canceledAt`. Clear `pendingPlan`. Write CANCEL_REQUESTED. No provider call is needed, because only our scheduler charges. If a verified renewal payment arrives while the flag is true, fulfil the paid period, keep the flag, and write outcome RENEWAL_AFTER_CANCEL. Plan flag is unchanged until period end. | “Your plan ends on {date}” | Write fails: inline error, nothing changes. |
| FR-15 | After cancel | Optional prompt with preset reasons and free text up to 500 characters. A server action saves the latest reason on the subscription and on the CANCEL_REQUESTED event. | Prompt with a Skip button | Save fails: “We could not save that. Your cancellation is unaffected.” |
| FR-16 | Click Switch to monthly (yearly user) | Set `pendingPlan` to monthly. Write DOWNGRADE_SCHEDULED. The renewal job charges the monthly price at period end (FR-22). | “Switches to monthly on {date}” | Write fails: inline error, nothing changes. |
| FR-17 | Scheduled lifecycle run | End subscriptions past `currentPeriodEnd` that have `cancelAtPeriodEnd`. End PAST_DUE subscriptions past `graceEndsAt`. End ACTIVE subscriptions with no verified renewal past `currentPeriodEnd` + 3 days. Set `User.plan` to FREE for each. Write a SubscriptionEvent per change. Delete `RateLimitHit` rows older than one day. The job never grants access, never verifies payments, and never calls `fulfillEntitlement()`. | Plan drops to free on next load | Job error: logged. Next run retries. `effectivePlan()` covers the gap. |
| FR-18 | Any unhandled error or unknown route | `error.tsx`, `global-error.tsx`, and `not-found.tsx` render a message and links to Plans and Billing. | Friendly page | None. |
| FR-19 | Click Pay now (PAST_DUE) | Create a RENEWAL session with the next attempt number. Charge the stored token for the current plan price. If there is no token or the charge fails, return a hosted checkout link. On a verified payment, start a new period on the payment date. | Billing updates. Redirect to Flutterwave only on the hosted fallback. | Same as FR-3. |
| FR-20 | Run seed script | Create the seeded user, three plans, and an empty subscription state. Refuse to run against live keys. | Console confirmation | Script exits with a clear message. |
| FR-21 | Click Keep my plan | Shown when `cancelAtPeriodEnd` or `pendingPlan` is set. Clear both. Write CHANGE_UNDONE. Take no payment. | “Your plan will continue” | Write fails: inline error, nothing changes. |
| FR-22 | Scheduled renewal run (daily) | For each ACTIVE subscription with `cancelAtPeriodEnd` false, `currentPeriodEnd` in the past, and no RENEWAL session for this period: create a RENEWAL session with txRef `renew:{subscriptionId}:{periodEndDate}:1`. Charge `pendingPlan`’s price if set, else the current plan’s price. Write INITIATION. Start a charge on the stored token. The job only starts the charge. The webhook handler verifies it and calls `fulfillEntitlement()`. If the charge is declined at once, or the session is still PENDING after 24 hours, set PAST_DUE (FR-11). A verified payment that arrives later is applied under rule (b) of 7.8. | Renewal date moves forward after verification | No stored token: set PAST_DUE and write FAILURE with outcome PROVIDER_ERROR. |

## 6. AI Processing Pipeline

This product uses no AI. This section describes the payment event pipeline.

| Step | Event | Owner module | Log row and idempotency key |
|---|---|---|---|
| 1 | User clicks subscribe or upgrade | `initiateCheckout` | PaymentLog INITIATION. `init:{txRef}` |
| 2 | Redirect to Flutterwave payment link | `initiateCheckout` | None |
| 3 | User returns to `/billing/return` | `handleVerifiedReturn` | None |
| 4 | Server verifies the transaction with Flutterwave | `verifyTransaction` | VERIFICATION. `verify:return:{providerTransactionId}` |
| 5 | Webhook arrives with raw body. Size cap, then signature check. | `handleWebhook` | On failure: FAILURE. `fail:sig:{sha256 of body}`. Body is not stored. |
| 6 | Idempotency check on the provider transaction id | `handleWebhook` | If a FULFILMENT row exists: return 200, no provider call |
| 7 | Verify with provider. Match amount, currency, reference. | `verifyTransaction` | VERIFICATION. `verify:webhook:{providerTransactionId}` |
| 8 | Fulfilment in one DB transaction with a row lock | `fulfillEntitlement` | FULFILMENT. `fulfil:{providerTransactionId}` |
| 9 | Any failure | The caller | FAILURE. `fail:{source}:{providerTransactionId or txRef}:{outcome}` |
| 10 | Renewal job starts a token charge. The webhook then follows steps 5 to 8. | `runRenewals` | INITIATION. `init:{txRef}` with source RENEWAL_JOB |
| 11 | Cancel, downgrade, undo, period end, grace start | Billing actions, `runLifecycle`, `runRenewals` | SubscriptionEvent rows, never PaymentLog rows. Job keys: `sub:{type}:{subscriptionId}:{periodEndDate}`. User action keys: `sub:{type}:{subscriptionId}:{requestId}`. |

Steps 4 and 7 can both occur for one payment. Both paths reach step 8. The unique idempotency key lets exactly one win. The provider transaction id is the provider reference. Before a payment exists, `txRef` stands in for it.

## 7. Technical Requirements

### 7.1 Module layout

```
src/server/identity/getCurrentUser.ts
src/server/identity/effectivePlan.ts
src/server/clock.ts
src/server/payments/flutterwaveClient.ts
src/server/payments/initiateCheckout.ts
src/server/payments/verifyTransaction.ts
src/server/payments/fulfillEntitlement.ts
src/server/payments/handleWebhook.ts
src/server/payments/handleVerifiedReturn.ts
src/server/payments/proration.ts
src/server/payments/money.ts
src/server/payments/log.ts
src/server/payments/tokenVault.ts
src/server/billing/cancelSubscription.ts
src/server/billing/scheduleDowngrade.ts
src/server/billing/keepMyPlan.ts
src/server/billing/saveCancellationReason.ts
src/server/lifecycle/runLifecycle.ts
src/server/lifecycle/runRenewals.ts
src/server/rateLimit.ts
src/app/api/checkout/initiate/route.ts
src/app/api/webhooks/flutterwave/route.ts
src/app/api/cron/lifecycle/route.ts
src/app/api/checkout/status/route.ts
src/app/billing/return/page.tsx
scripts/seed.ts
scripts/dispute-report.ts
```

### 7.2 Server-only rules

- Every file under `src/server` starts with `import "server-only"`.
- No client component imports from `src/server`. Client components call server actions or route handlers.
- An ESLint `no-restricted-imports` rule allows `fulfillEntitlement` to be imported only by `handleWebhook.ts` and `handleVerifiedReturn.ts`. CI fails otherwise.
- `fulfillEntitlement` accepts only a `VerifiedPayment` branded type. Only `verifyTransaction` can produce it. No caller can pass unverified data.
- No `any` on payment-path types. `tsconfig` enables `strict`. ESLint bans `no-explicit-any` under `src/server`.
- ESLint bans reading `User.plan` outside `effectivePlan.ts` and the lifecycle job.

### 7.3 Identity and access

- `getCurrentUser()` returns the seeded user, found by `SEED_USER_EMAIL`. It is the only source of identity.
- No endpoint reads a user ID from the body, query, cookies, or headers. Any such value is ignored.
- Webhooks find the user through `CheckoutSession.txRef`. Every payment, including renewals, has a session.
- Only `effectivePlan(user)` decides access. It returns FREE when: status is ENDED; `cancelAtPeriodEnd` is true and now is past `currentPeriodEnd`; status is PAST_DUE and now is past `graceEndsAt`; or status is ACTIVE and now is past `currentPeriodEnd` + 3 days with no verified renewal. Paid access never outlasts `currentPeriodEnd` + 3 days without a verified payment.
- State-changing route handlers check that the Origin header matches `APP_BASE_URL`. Cancel, downgrade, and undo are server actions.
- The test deployment sits behind Vercel Deployment Protection or basic auth at the platform level. This is not app authentication.
- A real auth system replaces `getCurrentUser()` later. No payment code changes.

### 7.4 Environment variables (all server-only, none with NEXT_PUBLIC_)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection for the app role. This role has no UPDATE or DELETE on `PaymentLog`. |
| `DATABASE_URL_MIGRATE` | Connection for the migration role. Used only by migrations and the seed script. |
| `FLW_SECRET_KEY` | Flutterwave API secret (test key) |
| `FLW_ENCRYPTION_KEY` | Only if the chosen SDK flow needs it |
| `FLW_WEBHOOK_SECRET_HASH` | Webhook verification secret |
| `TOKEN_ENCRYPTION_KEY` | Encrypts the stored card token at rest |
| `APP_BASE_URL` | Builds the redirect URL and the Origin check |
| `CRON_SECRET` | Protects the lifecycle and renewal routes |
| `SEED_USER_EMAIL` | Identifies the seeded user |

A boot check refuses to start if `FLW_SECRET_KEY` does not match Flutterwave’s test-key pattern. Confirm the pattern in the docs. [ASSUMPTION ADDED]

### 7.5 Checkout initiation

1. Call `getCurrentUser()`.
2. Check Origin and rate limit (7.11).
3. In one transaction, mark this user’s PENDING sessions whose `expiresAt` is in the past as EXPIRED. Then look for a PENDING session for this user and target plan. If none exists, insert one. If the insert hits the unique index, catch the error and return the existing session.
4. The new session gets a new `txRef`, the amount and currency from the `Plan` table (or the proration quote for upgrades), and `expiresAt` = 15 minutes from now or the next UTC midnight, whichever is first. [ASSUMPTION ADDED]
5. Write INITIATION.
6. Call Flutterwave to create the hosted payment link with tokenization on. The redirect URL is `APP_BASE_URL/billing/return`. Convert kobo to the provider’s amount format in `money.ts` only.
7. Return the link. The client redirects.

### 7.6 Verification

`verifyTransaction(txRef | transactionId)` calls Flutterwave’s verify endpoint from the server. Confirm the exact endpoint and fields in the current docs. It returns a `VerifiedPayment` only if all of these hold:

- Provider status is successful.
- `tx_ref` matches a known session.
- Amount in kobo, converted from the provider’s decimal string by `fromProviderAmount()`, equals the stored expected amount exactly.
- Currency equals the stored currency.

Otherwise it writes a FAILURE row and returns a typed failure. Token capture [ASSUMPTION ADDED]: if the verify response carries a reusable card token, `fulfillEntitlement()` encrypts it with `TOKEN_ENCRYPTION_KEY` and stores it in `Subscription.cardTokenEncrypted`. The token is never logged and never sent to the client. Confirm the field name and tokenization support in the Phase 0 spike.

### 7.7 Webhook flow

1. Read the raw body with `request.text()`.
2. Reject bodies over 64 KB with 413.
3. Verify the signature before parsing or touching the DB. Use only the scheme the current Flutterwave docs name. There is no fallback to a legacy header. On failure, return 401 and store only the SHA-256 of the body and the signature header.
4. Parse. Ignore unrelated event types with a 200.
5. Check idempotency on the provider transaction id. If a FULFILMENT row exists, return 200 with no provider call.
6. Verify with the provider (7.6). Never trust payload amounts.
7. Call `fulfillEntitlement()`.
8. Return 200 for success, duplicates, and unmatched-but-valid events. Return 5xx only for transient errors.

The webhook and return routes are rate limited to 60 requests per minute per IP.

### 7.8 fulfillEntitlement() contract

It takes a `VerifiedPayment` and a source of `WEBHOOK` or `RETURN`. In one DB transaction it does the following.

1. Locks the user’s Subscription row with `SELECT ... FOR UPDATE` before reading it. This serialises a renewal and an upgrade that run together.
2. Inserts the FULFILMENT log row with `idempotencyKey = fulfil:{providerTransactionId}`. A unique violation means “already done”. It exits with no changes.
3. Applies the payment under the rules below.
4. Updates the subscription (plan, period, status, flags, `lastAmountMinor`, encrypted token), `User.plan`, and the session status. Writes a PLAN_APPLIED SubscriptionEvent.

A verified payment is never rolled back. Rules:

- (a) An upgrade whose quoted period no longer matches the live period is applied as quoted, with outcome UPGRADE_PERIOD_DRIFT on the FULFILMENT row.
- (b) A payment on an expired session is applied, with outcome PAID_EXPIRED_SESSION on the FULFILMENT row.
- (c) A payment for a plan the user already holds in the same period does not extend it. It writes a FAILURE row with outcome DUPLICATE_PAYMENT. The dispute report finds it for a manual refund.
- (d) A payment with no matching reference is handled by the caller before this function runs. It writes a FAILURE row with outcome UNMATCHED_REFERENCE and grants nothing.

The lifecycle and renewal jobs write SubscriptionEvent rows with the same unique-key rule. They never call this function.

### 7.9 Periods and proration

All math is integer. Use whole UTC calendar days. [ASSUMPTION ADDED]

- Monthly period end = previous end plus one calendar month, clamped to month end. Yearly period end = previous end plus one year, clamped. Drift after short months is accepted: a period that starts on January 31 ends February 28, and the next one runs to March 28. [ASSUMPTION ADDED]
- The upgrade date is the quote date. The yearly period starts on it. The quote expires at 15 minutes or UTC midnight, whichever is first.
- `D` = days from `currentPeriodStart` to `currentPeriodEnd`. `U` = unused days from the quote date to `currentPeriodEnd`. `lastPaid` = `Subscription.lastAmountMinor`, which is what the user actually paid for this period.

```
chargeKobo = floor((yearly * D - lastPaid * U) / D)
creditKobo = yearly - chargeKobo   // shown so the line items sum exactly
```

**Worked example 1.** 30-day period, 20 unused days, `lastPaid` 500,000. Numerator: 5,000,000 x 30 - 500,000 x 20 = 140,000,000. Divide by 30: 4,666,666.67, floored to 4,666,666 kobo (NGN 46,666.66). Credit shown: 333,334 kobo.

**Worked example 2.** 31-day period, 24 unused days, `lastPaid` 500,000. Numerator: 155,000,000 - 12,000,000 = 143,000,000. Divide by 31: 4,612,903.23, floored to 4,612,903 kobo. Credit shown: 387,097 kobo.

**Edge cases.** Unused days = 0 gives the full yearly price of 5,000,000 kobo. Unused days = D gives 4,500,000 kobo.

### 7.10 Money

- Every money column is `Int` in kobo, with a `currency` column beside it.
- `money.ts` is the only place that converts to provider units or naira display. It uses integer math.
- `fromProviderAmount(value)` converts an inbound provider amount through its decimal string, rejects more than 2 decimal places, and returns `Int` kobo. Tests include 4666.66 and inputs such as 0.1 + 0.2.
- No `Float` or `Decimal` in application code for currency.

### 7.11 Rate limiting

- Sliding window log in the `RateLimitHit` table. [ASSUMPTION ADDED, pending Open Question 5]
- Checkout initiation: 5 per user per minute, 20 per IP per minute. With one seeded user, the per-IP limit is the main protection.
- Webhook and return routes: 60 per minute per IP.
- Read the client IP only from the hosting platform’s trusted header.
- Over the limit: 429 with `Retry-After`. The UI shows “Too many attempts. Try again in N seconds.”
- The lifecycle job prunes hits older than one day.

### 7.12 Error handling in the payment path

| Step | Failure | User sees | Logged | User-visible |
|---|---|---|---|---|
| Initiate | Rate limited | Wait message | None | Yes |
| Initiate | Provider error or timeout | Inline error with Retry | FAILURE (PROVIDER_ERROR) | Yes |
| Provider page | User cancels and returns | “Payment not completed” with Retry | FAILURE (USER_CANCELLED) | Yes |
| Return | Unknown or missing ref | “We could not find this payment” | None | Yes |
| Return | Verify timeout | Processing page, then still-checking message | FAILURE (VERIFY_TIMEOUT) | Yes |
| Return | Amount or currency mismatch | “Payment not completed” | FAILURE (AMOUNT_MISMATCH or CURRENCY_MISMATCH) | Yes |
| Webhook | Bad signature | None (401) | FAILURE (SIGNATURE_INVALID), hash only | No |
| Webhook | DB error | None (5xx, provider retries) | App error log | No |
| Renewal | Charge declined, or pending 24 hours | Billing shows “Payment failed” with Pay now | FAILURE (PROVIDER_ERROR) and GRACE_STARTED | Yes |
| Lifecycle | Job error | None | App error log, next run retries | No |
| Any | Uncaught error or unknown route | `error.tsx` or `not-found.tsx` page with links | App error log | Yes |

### 7.13 Test plan

Renewal and period-end tests run against an injected `Clock` and locally signed fixture webhooks. Flutterwave test mode cannot advance time.

| ID | Case | Expected | Covers |
|---|---|---|---|
| T1 | Happy path monthly subscribe | 1 INITIATION, 1 VERIFICATION, 1 FULFILMENT. Plan = MONTHLY. | FR-1, 3, 6, 9 |
| T2 | Duplicate webhook (replay 5 times, one after another) | 1 FULFILMENT. 1 period change. All 5 get 200. Replays make no provider call. | FR-9 |
| T3 | Forged webhook signature | 401. No state change. 1 hash-only FAILURE row. | FR-9 |
| T4 | Direct visit to the success URL with no ref | “Could not find this payment” page. No grant. | FR-6, 7 |
| T5 | Direct visit with a guessed or foreign `tx_ref` | No grant. | FR-6, 7 |
| T6 | Query says `status=successful` but the provider says failed | No grant. FAILURE row. | FR-6, 7 |
| T7 | Amount mismatch at verification | Rejected. FAILURE row. No grant. | FR-7, 9 |
| T8 | Webhook arrives before the user returns | Fulfilled once. Return page shows confirmed with no second fulfilment. | FR-6, 9 |
| T9 | User returns before the webhook | Fulfilled once. Later webhook is a no-op. | FR-6, 9 |
| T10 | User pays, then closes the tab | Webhook fulfils. | FR-9 |
| T11 | Upgrade with 20 unused days of 30 | Charge 4,666,666 kobo. Yearly period starts on the quote date. | FR-4, 5 |
| T12 | Upgrade with 24 unused days of 31 | Charge 4,612,903 kobo. | FR-4, 5 |
| T13 | Cancel mid-period | Access continues to period end. Access ends only at period end. | FR-13, 14, 17 |
| T14 | Cancel, then upgrade | Cancel flag cleared. | FR-5, 14 |
| T15 | Yearly user schedules monthly | `pendingPlan` set. Yearly access continues to period end. | FR-16 |
| T16 | Declined renewal | PAST_DUE. Grace = period end + 3 days. After grace, ENDED. | FR-11, 17, 22 |
| T17 | Double-click on subscribe | One session, one provider link. No 500. | FR-3 |
| T18 | 6th checkout initiation inside the window (injected clock) | 429 with message. The window slides, so no flake at the minute boundary. | FR-3 |
| T19 | Request sends a different user ID in body, query, and header | Ignored. Seeded user used. | FR-1 |
| T20 | Fault injection at each user-visible step in 7.12 | No blank page or 404. | FR-7, 8, 18 |
| T21 | Period changes between upgrade quote and payment | Payment applied as quoted. Outcome UPGRADE_PERIOD_DRIFT. | FR-5, 9 |
| T22 | Parallel replay of 5 identical webhooks | Exactly 1 FULFILMENT row. | FR-9 |
| T23 | `UPDATE` and `DELETE` on `PaymentLog` by the app role | Rejected by the database. | Section 10 |
| T24 | Scan stored payloads for card fields | No keys named `card`, `first_6digits`, or `last_4digits`. No token. | FR-9, Section 10 |
| T25 | Renewal payment verifies after cancel | Paid period applied. Flag stays. Outcome RENEWAL_AFTER_CANCEL. | FR-14, 22 |
| T26 | `pendingPlan` monthly at renewal | Monthly price charged. Plan flips. `pendingPlan` cleared. | FR-16, 22 |
| T27 | Payment on an expired session | Applied. Outcome PAID_EXPIRED_SESSION. | FR-6, 9 |
| T28 | Renewal and upgrade for the same user at once | Row lock serialises them. No lost update. Each applies once. | FR-9, 22 |
| T29 | Second payment for a period already paid | Period not extended. FAILURE row with DUPLICATE_PAYMENT. | FR-9 |
| T30 | Keep my plan after cancel, and after a scheduled downgrade | Flags cleared. CHANGE_UNDONE written. No charge. | FR-21 |
| T31 | Pay now from PAST_DUE | Token charge or hosted fallback. New period starts on the payment date. | FR-19 |
| T32 | Webhook body over 64 KB | 413. Nothing stored. | FR-9 |
| T33 | Cross-site POST to a state-changing handler | Rejected on Origin mismatch. | FR-3 |

## 8. Business Model

| Plan | Interval | Price (kobo) | Price (naira) |
|---|---|---|---|
| Free | None | 0 | 0 |
| Paid monthly | 1 month | 500,000 | 5,000 |
| Paid yearly | 1 year | 5,000,000 | 50,000 |

These prices are placeholders. [ASSUMPTION ADDED]

- Prices are the final amounts charged. The build has no tax logic. [ASSUMPTION ADDED]
- Upgrade: monthly to yearly, prorated, charged immediately. The yearly period starts on the quote date. The credit uses what the user last paid.
- Downgrade: yearly to monthly, or any paid plan to free. Applies at period end.
- Cancel: access lasts to period end. No refund.
- Renewal: our scheduler charges the plan price at renewal time. A price change reaches subscribers at their next renewal.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| No refund path | High | Medium | Out of scope. The dispute report and the log support manual refunds in the Flutterwave dashboard. Open Questions 2 and 12. |
| Paid upgrade finds a changed period | Low | High | A verified payment is never rolled back. It is applied as quoted with outcome UPGRADE_PERIOD_DRIFT (7.8). |
| Webhook never arrives | Medium | Medium | The return handler verifies independently. The processing page polls. A renewal pending past 24 hours moves to PAST_DUE, and a late verified payment still applies. |
| Stored card token | Medium | High | Encrypted at rest with a server-only key. Never logged, never sent to the client. Needs owner approval (Open Question 11). The provider holds the card data. |
| Tokenized renewals unsupported or limited in test mode | Medium | High | Phase 0 spike confirms support. If unsupported, the owner decides between payment plans with cancel and recreate, or another approach (Open Question 3). |
| Double billing | Medium | High | Only our scheduler charges. The renewal txRef is unique per subscription and period. No provider-side plans. |
| Test mode cannot advance time | High | Medium | Injected `Clock` and locally signed fixture webhooks. |
| Card digits in payloads | Medium | High | Payload allowlist plus the T24 scan. |
| Webhook flooding | Medium | Medium | 64 KB body cap, 60 requests per minute per IP, hash-only failure rows. |
| Time zone or clock errors | Medium | High | UTC everywhere. Whole-day proration. Tests on month-length boundaries. |
| Proration rounding disputes | Low | Medium | One integer formula. Credit shown as yearly minus charge so lines sum. Independent spreadsheet check. |
| Provider API or signature scheme changes | Medium | Medium | Isolate in `flutterwaveClient.ts`. Confirm in the Phase 0 spike. |
| Anyone who reaches the instance acts as the seeded user | High | Medium | Deployment behind Vercel Deployment Protection or basic auth at the platform level. Origin check. Boot check refuses live keys. Identity isolated in one helper. |
| Cron limits on the hosting plan | Medium | Low | `effectivePlan()` guard and the 3-day bound on access. Open Question 10. |
| Log tampering | Low | High | The app DB role has no UPDATE or DELETE on `PaymentLog`. A trigger backs it up. |

## 10. Prisma Data Model

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PlanTier {
  FREE
  MONTHLY
  YEARLY
}

enum Interval {
  MONTH
  YEAR
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  ENDED
}

enum CheckoutKind {
  NEW
  UPGRADE
  RENEWAL
}

enum CheckoutStatus {
  PENDING
  COMPLETED
  FAILED
  EXPIRED
}

enum PaymentEventType {
  INITIATION
  VERIFICATION
  FULFILMENT
  FAILURE
}

enum EventSource {
  CHECKOUT
  WEBHOOK
  RETURN
  RENEWAL_JOB
}

enum CancellationReasonCode {
  TOO_EXPENSIVE
  MISSING_FEATURES
  NOT_USING
  FOUND_ALTERNATIVE
  OTHER
}

enum PaymentOutcome {
  SUCCESS
  PENDING
  SIGNATURE_INVALID
  AMOUNT_MISMATCH
  CURRENCY_MISMATCH
  VERIFY_TIMEOUT
  USER_CANCELLED
  PROVIDER_ERROR
  UPGRADE_PERIOD_DRIFT
  PAID_EXPIRED_SESSION
  DUPLICATE_PAYMENT
  UNMATCHED_REFERENCE
  RENEWAL_AFTER_CANCEL
}

enum SubscriptionEventType {
  CANCEL_REQUESTED
  DOWNGRADE_SCHEDULED
  CHANGE_UNDONE
  PERIOD_ENDED
  GRACE_STARTED
  PLAN_APPLIED
}

model User {
  id                 String              @id @default(cuid())
  email              String              @unique
  plan               PlanTier            @default(FREE)
  createdAt          DateTime            @default(now())
  subscription       Subscription?
  checkoutSessions   CheckoutSession[]
  paymentLogs        PaymentLog[]
  subscriptionEvents SubscriptionEvent[]
}

model Plan {
  id               String            @id @default(cuid())
  tier             PlanTier          @unique
  interval         Interval?
  amountMinor      Int
  currency         String            @db.Char(3)
  active           Boolean           @default(true)
  subscriptions    Subscription[]    @relation("CurrentPlan")
  pendingFor       Subscription[]    @relation("PendingPlan")
  checkoutSessions CheckoutSession[]
}

model Subscription {
  id                     String                  @id @default(cuid())
  userId                 String                  @unique
  user                   User                    @relation(fields: [userId], references: [id])
  planId                 String
  plan                   Plan                    @relation("CurrentPlan", fields: [planId], references: [id])
  status                 SubscriptionStatus
  currentPeriodStart     DateTime
  currentPeriodEnd       DateTime
  cancelAtPeriodEnd      Boolean                 @default(false)
  pendingPlanId          String?
  pendingPlan            Plan?                   @relation("PendingPlan", fields: [pendingPlanId], references: [id])
  graceEndsAt            DateTime?
  canceledAt             DateTime?
  cancellationReasonCode CancellationReasonCode?
  cancellationReasonText String?                 @db.VarChar(500)
  cardTokenEncrypted     String?
  lastAmountMinor        Int
  currency               String                  @db.Char(3)
  createdAt              DateTime                @default(now())
  updatedAt              DateTime                @updatedAt

  @@index([status, currentPeriodEnd])
  @@index([graceEndsAt])
}

model CheckoutSession {
  id                    String         @id @default(cuid())
  userId                String
  user                  User           @relation(fields: [userId], references: [id])
  targetPlanId          String
  targetPlan            Plan           @relation(fields: [targetPlanId], references: [id])
  kind                  CheckoutKind
  txRef                 String         @unique
  providerTransactionId String?        @unique
  amountMinor           Int
  currency              String         @db.Char(3)
  prorationCreditMinor  Int?
  quotedPeriodStart     DateTime?
  quotedPeriodEnd       DateTime?
  status                CheckoutStatus @default(PENDING)
  paymentLink           String?
  expiresAt             DateTime
  createdAt             DateTime       @default(now())
  paymentLogs           PaymentLog[]

  @@index([userId, targetPlanId, status])
}

model PaymentLog {
  id                    String           @id @default(cuid())
  idempotencyKey        String           @unique
  eventType             PaymentEventType
  source                EventSource
  userId                String?
  user                  User?            @relation(fields: [userId], references: [id])
  checkoutSessionId     String?
  checkoutSession       CheckoutSession? @relation(fields: [checkoutSessionId], references: [id])
  providerRef           String
  providerTransactionId String?
  amountMinor           Int?
  currency              String?          @db.Char(3)
  outcome               PaymentOutcome
  payload               Json
  createdAt             DateTime         @default(now())

  @@index([providerRef])
  @@index([userId, createdAt])
  @@index([eventType, createdAt])
}

model SubscriptionEvent {
  id             String                  @id @default(cuid())
  idempotencyKey String                  @unique
  userId         String
  user           User                    @relation(fields: [userId], references: [id])
  type           SubscriptionEventType
  reasonCode     CancellationReasonCode?
  reasonText     String?                 @db.VarChar(500)
  createdAt      DateTime                @default(now())

  @@index([userId, createdAt])
}

model RateLimitHit {
  id  String   @id @default(cuid())
  key String
  at  DateTime @default(now())

  @@index([key, at])
}
```

**Payload allowlist.** `PaymentLog.payload` stores only `id`, `tx_ref`, `flw_ref`, `status`, `amount`, `currency`, and `created_at`. The card token is never stored in the payload.

**Indexes.** `PaymentLog.idempotencyKey` is unique, so a repeated event cannot insert twice. `providerRef` supports dispute lookups by transaction. `(userId, createdAt)` supports a user’s history. `Subscription (status, currentPeriodEnd)` lets the lifecycle and renewal jobs find due rows fast. `CheckoutSession.txRef` and `providerTransactionId` are unique for webhook matching. `RateLimitHit (key, at)` supports the sliding window count.

**Raw SQL migrations.** Prisma cannot express these, so add them by hand:

- A partial unique index on `CheckoutSession (userId, targetPlanId)` where `status = PENDING` and `kind <> RENEWAL`. It holds one open session per user and plan. Expiry is handled by the expire-then-insert step in 7.5, because an index predicate cannot use `now()`.
- Two database roles. The app role has no UPDATE or DELETE on `PaymentLog`. The migration role owns the schema.
- A trigger that rejects UPDATE and DELETE on `PaymentLog`, as a second barrier.

**Cancellation reason.** The latest reason sits on `Subscription` as the brief requires. Full history sits on `SubscriptionEvent`, so a later re-subscribe does not erase it.

**Dispute report.** `scripts/dispute-report.ts` prints the full PaymentLog and SubscriptionEvent trail for a `txRef` or provider transaction id.

## 11. Success Metrics

| Metric | Method | Pass |
|---|---|---|
| Paid users without a FULFILMENT row | SQL join of users on paid plans to the log | 0 |
| Test transactions with an incomplete trail | SQL per the G2 definition | 0 |
| Verified payments with no entitlement and no flagged outcome | SQL over FULFILMENT and FAILURE rows | 0 |
| Duplicate fulfilments under replay | T2 and T22 on 10 payments | Exactly 1 FULFILMENT row each |
| Proration mismatches | 20 dates including 28, 30, and 31 day periods, against an independent spreadsheet | 0 mismatches |
| Forged webhooks processed | 10 forged requests | 0 processed, 10 rejected |
| Grants from direct success-URL visits | 10 attempts | 0 |
| Blank pages or 404s | Scripted browser run across the 8 user-visible rows of 7.12 | 0 |
| 6th checkout request inside the window | Scripted test on an injected clock | 429 every time |
| Webhook response time | Test-mode timing, including the provider verify call | p95 under 1,500 ms |
| Time from provider success to plan change | Timestamps on the log and the plan change | p95 under 10 s via return, under 60 s via webhook only |
| Secrets in the client bundle | Grep `.next/static` for the env var names and the secret values | 0 occurrences |
| Card fields in stored payloads | T24 scan | 0 |

## 12. Assumptions

### Stated by the owner

- No authentication. The seeded user acts as the signed-in user through `getCurrentUser()`. One role. No admin screen.
- Next.js App Router, TypeScript, Prisma on PostgreSQL, and Flutterwave. All money is `Int` kobo with currency stored beside it.
- `fulfillEntitlement()` lives in one module with exactly two callers: the webhook handler and the verified-return handler.
- The payment log records initiation, verification, fulfilment, and failure as separate rows.
- Server-side verification before any entitlement. Webhook signature check before processing. Idempotency keyed on the provider reference.
- Proration is calculated and shown. Cancellation keeps access to period end with a confirmation step. An optional prompt fills the cancellation reason column.
- Rate limiting on checkout initiation. No blank page or 404 in the payment path. No card details stored in our system.

### Defaults awaiting confirmation

- NGN only (Open Question 1). Placeholder prices of 500,000 and 5,000,000 kobo (Open Question 8).
- No free trial. Refunds out of scope (Open Question 2).
- Downgrade paths: yearly to monthly, and any paid plan to free. Both apply at period end.
- PAST_DUE with a 3-day grace that starts at period end (Open Question 4).
- Rate limits of 5 per user per minute and 20 per IP per minute. Postgres-backed (Open Question 5).
- Vercel hosting with a daily scheduled route (Open Question 10).
- Renewals are tokenized charges started by our own scheduler. This reverses the earlier payment-plan default, because payment plans cannot take a prorated first charge (Open Questions 3 and 11).

### Added by this PRD

- [ASSUMPTION ADDED] Signature scheme, verify endpoint, and tokenization support are confirmed in the Phase 0 spike. One scheme, no fallback.
- [ASSUMPTION ADDED] Whole UTC calendar days for proration. Floor once at the end. Credit shown as yearly minus charge. The credit uses `lastAmountMinor`.
- [ASSUMPTION ADDED] Monthly period end = previous end plus one calendar month, clamped. Yearly = plus one year, clamped. Drift after short months is accepted.
- [ASSUMPTION ADDED] “Downgrade to free” and “Cancel” are the same action.
- [ASSUMPTION ADDED] Free users may buy yearly directly at full price.
- [ASSUMPTION ADDED] No resume control for an ended subscription. Keep my plan undoes a scheduled change.
- [ASSUMPTION ADDED] First payment and upgrade use hosted checkout. Renewals and Pay now use the stored token, with a hosted fallback.
- [ASSUMPTION ADDED] Checkout sessions expire after 15 minutes or at UTC midnight, whichever is first.
- [ASSUMPTION ADDED] Renewal txRef is `renew:{subscriptionId}:{periodEndDate}:{attempt}`. Pay now uses the next attempt number.
- [ASSUMPTION ADDED] A renewal still PENDING after 24 hours moves the subscription to PAST_DUE. Paid access never outlasts `currentPeriodEnd` + 3 days without a verified payment.
- [ASSUMPTION ADDED] A verified payment is never rolled back. Rules (a) to (d) in 7.8 apply.
- [ASSUMPTION ADDED] `CheckoutSession`, `SubscriptionEvent`, and `RateLimitHit` tables exist. PaymentLog holds payment events only.
- [ASSUMPTION ADDED] Sliding window rate limiting. The client IP comes only from the platform’s trusted header. Webhook and return routes allow 60 per minute per IP.
- [ASSUMPTION ADDED] Webhook body cap of 64 KB. Failure rows store only a hash.
- [ASSUMPTION ADDED] `PaymentLog.payload` uses the allowlist in Section 10.
- [ASSUMPTION ADDED] Two database roles plus a trigger protect `PaymentLog`.
- [ASSUMPTION ADDED] Idempotency key formats as in Section 6.
- [ASSUMPTION ADDED] The webhook returns 200 for duplicates and unmatched valid events, and 5xx for transient errors.
- [ASSUMPTION ADDED] The processing page polls every 3 seconds for 60 seconds.
- [ASSUMPTION ADDED] Cancellation reason presets: too expensive, missing features, not using it, found an alternative, other.
- [ASSUMPTION ADDED] `effectivePlan()` is the only reader of plan state.
- [ASSUMPTION ADDED] The boot check refuses non-test Flutterwave keys.
- [ASSUMPTION ADDED] The seed script creates the user and the plans.
- [ASSUMPTION ADDED] Prices are final amounts. No tax logic.
- [ASSUMPTION ADDED] The test deployment sits behind platform-level protection. State-changing handlers check Origin.

## 13. Phased Roadmap

| Phase | Scope | Exit test | Size |
|---|---|---|---|
| 0. Spike | Confirm API version, signature scheme, verify endpoint, and tokenized charges in test mode. Decide Open Questions 3, 9, 10, and 11. | Written notes and recorded decisions | 0.5 day |
| 1. Core path | Schema, migrations, DB roles, seed, platform deployment protection, shell, plans view, checkout initiation, webhook with signature and idempotency, verification, `fulfillEntitlement`, return view, payment log, error pages | T1 to T10, T22, T23, T24, T32 | 6 days |
| 2. Lifecycle | `Clock` and fixture webhook signer first. Then upgrade with proration, cancel with reason, Keep my plan, downgrade, renewal job, lifecycle job, PAST_DUE, Pay now | T11 to T16, T21, T25 to T31 | 6 days |
| 3. Hardening | Rate limiting, Origin checks, fault injection, lint rules, bundle scan, dispute report | T17 to T20, T33. All success metrics met. | 3 days |

Total: 15.5 days.

## 14. Open Questions

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| 1 | Do you need currencies other than NGN? | NGN only | Plan table, money formatting |
| 2 | Do you want a manual refund path? | No. The log and dispute report support manual handling. | Risk handling for duplicate payments |
| 3 | Renewals: tokenized charges from our own scheduler, or Flutterwave payment plans? Payment plans cannot take a custom prorated first charge and cannot change mid-cycle without cancelling and recreating. | Tokenized charges. This PRD is written for them. | FR-5, 10, 14, 16, 17, 19, 22, and Section 10 |
| 4 | Is the 3-day grace window right? | 3 days, starting at period end | FR-11, FR-17 |
| 5 | Is Redis available for rate limiting? | No. Use Postgres. | 7.11 |
| 6 | Keep the “AI Processing Pipeline” heading, or drop it? | Keep, as the payment event pipeline | Section 6 |
| 7 | Is a public webhook URL available in development? | If not, use a tunnel | T2, T3, T8 to T10 |
| 8 | What are the real prices? | Placeholders in Section 8 | Business model, seed data |
| 9 | Which Flutterwave API version? | The version current docs recommend for new integrations | 7.4, 7.6, 7.7 |
| 10 | Which Vercel plan? | Hobby, with a daily cron and the `effectivePlan()` guard | FR-17, FR-22 |
| 11 | Do you accept storing an encrypted provider card token? | Yes | Open Question 3 |
| 12 | Who refunds duplicate payments? | Manual, in the Flutterwave dashboard, using the dispute report | Risks |

## Appendix A: Change log from the live review

| ID | Fix | Where |
|---|---|---|
| L1 | Renewals move to tokenized charges. Payment plans cannot take a prorated first charge. | 5.3 FR-22, Q3, 12 |
| L2 | A verified payment is never rolled back. Rules (a) to (d) added. G8 added. | 3, 7.8 |
| L3 | Payload allowlist and card-field scan. | 10, T24 |
| L4 | SubscriptionEvent table. Lifecycle changes no longer write PaymentLog. | 6, 10 |
| L5 | `pendingPlan` applied at renewal. Test added. | 5.1, FR-22, T26 |
| L6 | Renewal after cancel defined as RENEWAL_AFTER_CANCEL. | FR-14, T25 |
| L7 | Pay now charges the stored token. No second provider plan. | FR-19, T31 |
| L8 | Idempotency keys use the provider transaction id. Failure keys include outcome. | 6, 10 |
| L9 | Expire-then-insert step. Unique error caught. | 7.5, 10 |
| L10 | Row lock in fulfilment. Concurrency test. | 7.8, T28 |
| L11 | Webhook order fixed. Size cap, hash-only failure rows, rate limit, idempotency before provider call. | 7.7, FR-9 |
| L12 | Injected Clock and fixture webhooks. | 7.13, 9 |
| L13 | Period definition, `lastPaid` credit, quote date rule. | 7.9 |
| L14 | Assumptions split into stated, awaiting confirmation, and added. | 12 |
| L15 | `effectivePlan()` is the only reader. Lint ban. | 7.2, 7.3 |
| L16 | PAST_DUE keeps access. Grace starts at period end. CTA cell fixed. | 5.1, 5.2 |
| L17 | Keep my plan added. | FR-21, 3 |
| L18 | `fromProviderAmount()` parser. | 7.10 |
| L19 | Roadmap reordered. Phase 0 spike added. | 13 |
| L20 | Sliding window. Trusted IP header. Pruning. | 7.11, FR-17 |
| L21 | G6 and metric now count 8 user-visible rows. | 3, 7.12, 11 |
| L22 | Proration checked against an independent spreadsheet. | 3, 11 |
| L23 | Dispute report script. | 10, 7.1 |
| L24 | `PaymentOutcome` enum replaces free-text outcome. | 10 |
| L25 | Legacy header fallback removed. | 7.7 |
| L26 | Test plan expanded to T33 with an FR coverage column. | 7.13 |
| L27 | Platform protection, Origin check, DB role split. | 7.3, 9, 10 |
| L28 | Time-to-plan-change and no-entitlement metrics. | 11 |
| L29 | Five-sentence summary. Problem statement tied to goals. | 1, 2 |
| L30 | Revenue line removed. Tax and price-change lines. New risks and questions. | 8, 9, 14 |
