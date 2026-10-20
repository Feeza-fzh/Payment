# AGENTS.md

Read this whole file before every task. These rules outrank your own judgment.

The PRD says what to build. This file says how to behave while building it. If you are about to do something this file forbids, stop and ask.

---

## 1. What is this project?

**What it is.** A test-mode subscription slice. One paid plan is sold on two intervals, monthly and yearly, next to a free plan. The thing sold is a plan flag on a user record. Nothing else is sold and nothing sits behind the paywall.

**Who it is for.** One seeded user who acts as the signed-in user. There is no login and no other account.

**Version.** PRD Revision 2, built in four phases, one at a time:

| Phase | Build only this | Exit tests (PRD section 7.13) |
|---|---|---|
| 0. Spike | No app code. Read Flutterwave's current docs. Write `docs/spike-notes.md`. | Notes written, owner decisions recorded |
| 1. Core path | Schema, DB roles, seed, shell, Plans view, checkout initiation, webhook, verification, `fulfillEntitlement`, return view, payment log, error pages | T1 to T10, T22, T23, T24, T32 |
| 2. Lifecycle | `Clock`, fixture signer, upgrade with proration, cancel, Keep my plan, downgrade, renewal job, lifecycle job, PAST_DUE, Pay now | T11 to T16, T21, T25 to T31 |
| 3. Hardening | Rate limiting, Origin checks, fault injection, lint rules, bundle scan, dispute report | T17 to T20, T33, all success metrics |

The current phase is written in `docs/progress.md`. If that file does not exist, the current phase is 0. Never build anything from a later phase. Never start the next phase until the owner says so.

**Source of truth.** `docs/PRD_Subscription_Slice_Rev2.md`.
- The PRD decides what you build. This file decides how you behave.
- If the PRD and this file disagree, stop and ask. Do not pick a side.
- Never edit the PRD. Propose changes in `docs/decisions.md`.

**Blocked until the owner answers.** Open Questions 3, 9, 10 and 11 in the PRD. Do not write Phase 1 code until the answers are recorded in `docs/decisions.md`. The other open questions use the PRD's recommended default.

**Start every task like this.**
1. Read `docs/progress.md`.
2. Name the PRD requirements you will meet (FR, T, G numbers).
3. Name the rules in sections 3 and 4 that touch this task.
4. Then write code.

---

## 2. What is locked?

Never change, swap, upgrade across a major version, or "improve" anything in this section. To propose a change, write it in `docs/decisions.md` and stop.

### Tools and services

| ID | Locked choice |
|---|---|
| L-1 | **Node.js:** the newest Active LTS release. Never a Current or odd-numbered release. Check the Node.js release schedule, then pin the version in `.nvmrc` and in `engines` in `package.json`. |
| L-2 | **Package manager:** npm. Commit `package-lock.json`. Pin exact versions, with no `^` or `~`. |
| L-3 | **Framework:** Next.js with the App Router. Use the latest stable release that supports the pinned Node LTS. No Pages Router. No canary, beta, or rc builds. |
| L-4 | **Language:** TypeScript with `strict` on and `noUncheckedIndexedAccess` on. No `any` anywhere in `src/server`. |
| L-5 | **Database:** PostgreSQL through Prisma. One Prisma client, created in `src/server/db.ts`. No other ORM. |
| L-6 | **Payments:** Flutterwave in test mode only. Call its REST API with `fetch` from `flutterwaveClient.ts`. Do not install a Flutterwave SDK. (This file's choice. The PRD allows either.) |
| L-7 | **Money:** `Int` in kobo, with the currency stored beside it. NGN only. |
| L-8 | **Identity:** no authentication. The only source of identity is `getCurrentUser()`, which returns the seeded user. |
| L-9 | **Renewals:** tokenized charges started by our own scheduler. Never Flutterwave payment plans. Pending owner confirmation of Open Questions 3 and 11. |
| L-10 | **Hosting and jobs:** Vercel. One daily cron route, `/api/cron/lifecycle`, protected by `CRON_SECRET`. It calls `runLifecycle`, then `runRenewals`. |
| L-11 | **Rate limiting:** a sliding window log in the `RateLimitHit` Postgres table. No Redis. |
| L-12 | **Validation:** Zod, at every boundary where outside data enters. |
| L-13 | **Tests:** Vitest for unit and integration tests. Playwright for the browser fault run. Integration tests use a separate database named by `DATABASE_URL_TEST`. |
| L-14 | **Lint and format:** ESLint with typescript-eslint, plus Prettier. |
| L-15 | **UI:** plain CSS Modules. No UI library. No component kit. No CSS framework. |

Add no other dependency without owner approval. When you want one, write why in `docs/decisions.md` and stop.

### Database design

- Copy the Prisma schema in PRD section 10 exactly. Do not add, rename, or remove a model, column, enum, or index without owner approval.
- Every money column is `Int` and has a `currency` column beside it.
- `PaymentLog.idempotencyKey` is unique. `CheckoutSession.txRef` and `providerTransactionId` are unique.
- Add the hand-written SQL migrations from PRD section 10 in `prisma/sql/`: the partial unique index on open checkout sessions, the two database roles, and the trigger that blocks UPDATE and DELETE on `PaymentLog`.
- Environment variable names are fixed: `DATABASE_URL`, `DATABASE_URL_MIGRATE`, `DATABASE_URL_TEST`, `FLW_SECRET_KEY`, `FLW_ENCRYPTION_KEY`, `FLW_WEBHOOK_SECRET_HASH`, `TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL`, `CRON_SECRET`, `SEED_USER_EMAIL`. Every one is server-only.

---

## 3. What must never happen?

These rules protect money, access, card data, and the user.

**Breaking any rule in this section means the task failed, even if the code runs, the build passes, and the feature works.** If a task would force you to break one, stop and ask.

### Money

- **P-1.** Store every amount as a whole number in the smallest unit (kobo). Use Prisma `Int`. Never use Float, Decimal, or fractional JavaScript numbers for money. Anywhere. Ever. (G7, 7.10)
- **P-2.** Store the currency code in a column beside every amount. Use NGN only. (7.10)
- **P-3.** Convert units only in `money.ts`. Read inbound provider amounts through `fromProviderAmount()`, which goes through the decimal string and rejects more than two decimal places. Never call `parseFloat` on a provider amount. (7.10)
- **P-4.** Calculate proration only in `proration.ts`, with integer arithmetic and the PRD 7.9 formula: `charge = floor((yearly * D - lastPaid * U) / D)` and `credit = yearly - charge`. Floor once, at the end. Use whole UTC days. Use `Subscription.lastAmountMinor` as `lastPaid`, never the current plan price. Floor with the remainder, `(n - (n % d)) / d`, never with a float division result. Show the charge and credit to the user before payment. (G4, FR-4, 7.9, T11, T12)

### Access and verification

- **P-5.** Never grant, extend, or change paid access because the user reached a URL, a redirect, a query value such as `status`, or any message from the browser. A visit to `/billing/return` without a verified payment grants nothing. (G1, FR-6, FR-7, T4, T5, T6)
- **P-6.** Grant access only after server-side verification with Flutterwave through `verifyTransaction()`, which returns a `VerifiedPayment`. (7.6)
- **P-7.** Reject any payment whose amount, currency, or `tx_ref` does not match exactly what we stored. Write a FAILURE row. Grant nothing. (7.6, T7)
- **P-8.** Never roll back a verified payment. Apply PRD 7.8 rules (a) to (d): a drifted upgrade period is applied as quoted, a paid expired session is applied, a duplicate payment is logged and does not extend the period, an unmatched reference is logged and grants nothing. Every verified payment ends in access or a flagged log row. (G8, 7.8, T21, T27, T29)
- **P-9.** Decide access only with `effectivePlan()`. Never read `User.plan` to decide access. Paid access never outlasts `currentPeriodEnd` + 3 days without a verified payment. (7.3)
- **P-10.** Never cut off access right after a payment, a cancel, or a downgrade. Cancel and downgrade take effect at the end of the paid period. Cancellation needs a confirmation step and never requires a reason. (G5, FR-13 to FR-16, T13, T15)
- **P-11.** Keep paid access in PAST_DUE until `graceEndsAt`, which is `currentPeriodEnd` + 3 days. (5.1, FR-11)

### Webhooks and idempotency

- **P-12.** Check the webhook signature before anything else. Read the raw body with `request.text()`, reject bodies over 64 KB, verify the signature, and only then parse. Use only the scheme in the current Flutterwave docs. No fallback header. Never add an env flag, debug mode, or test header that skips the check, in any environment. On failure return 401 and store only the SHA-256 of the body and the signature header. (FR-9, 7.7, T3, T32)
- **P-13.** Make every webhook idempotent on the provider transaction id. A repeat is recorded once, acted on once, returns 200, and makes no provider call. The unique index on `idempotencyKey` is the guard. Never replace it with a check-then-insert. (G3, FR-9, T2, T22)
- **P-14.** Lock the user's Subscription row with `SELECT ... FOR UPDATE` inside the fulfilment transaction. (7.8, T28)

### The payment log

- **P-15.** Write every payment event as its own PaymentLog row: INITIATION, VERIFICATION, FULFILMENT, FAILURE. Never skip a row because a status column already shows the state. (G2, section 6)
- **P-16.** Never UPDATE or DELETE a PaymentLog row, in app code, scripts, tests, or migrations. The log is append-only. (T23)
- **P-17.** Store only these payload fields: `id`, `tx_ref`, `flw_ref`, `status`, `amount`, `currency`, `created_at`. Never store the raw provider body. (section 10, T24)
- **P-18.** Write cancel, downgrade, undo, period end, and grace start to SubscriptionEvent, never to PaymentLog. Use the idempotency key formats in PRD section 6. (section 6)

### Card data and secrets

- **P-19.** Never store, log, or send card numbers, CVV, expiry, or the first-six or last-four digits. The only card artifact allowed is the provider token, encrypted with `TOKEN_ENCRYPTION_KEY` in `tokenVault.ts` and stored in `Subscription.cardTokenEncrypted`. Never log the token. Never send it to the client. (requirement 11, 7.6, T24)
- **P-20.** Keep every secret on the server. Never put `NEXT_PUBLIC_` on a secret. Never import a secret into a client component. Never print a secret in the terminal, a log, a commit, or chat. Never commit a `.env` file. Keep `.env.example` with names and no values. (7.4)
- **P-21.** Use Flutterwave test mode only. Keep the boot check that refuses non-test keys and the seed script's refusal to run against live keys. Never add a way around either. (7.4, FR-20)

### Identity

- **P-22.** Do not build authentication. No login, signup, password, session, cookie, or OAuth. Get the user only from `getCurrentUser()`. (7.3, non-goals)
- **P-23.** Never read a user ID from the request body, query, cookies, or headers. Ignore any that arrive. (7.3, T19)
- **P-24.** Check the Origin header against `APP_BASE_URL` in every state-changing route handler. Build cancel, downgrade, and undo as server actions. (7.3, T33)

### Abuse and duplicates

- **P-25.** Rate limit checkout initiation to 5 per user per minute and 20 per IP per minute. Rate limit the webhook and return routes to 60 per minute per IP. Use a sliding window. Read the client IP only from the hosting platform's trusted header. Answer with 429 and `Retry-After`. (7.11, T18)
- **P-26.** Keep one open pending checkout per user and plan. Expire stale sessions and reuse or insert inside one transaction, and catch the unique-violation error. (7.5, T17)

### Availability

- **P-27.** Never leave a user on a blank page or a 404 anywhere in the payment path. Every failure in PRD 7.12 shows its defined message. Keep `error.tsx`, `global-error.tsx`, and `not-found.tsx` with links to Plans and Billing. (G6, FR-18, 7.12, T20)

### Scope

- **P-28.** Never build: a landing page, a pricing marketing page, product features behind the paywall, authentication, an admin screen, an invoice or payment-history screen, refunds, a free trial, multi-currency, tax logic, or a resume control for an ended subscription. (section 3 non-goals)
- **P-29.** Never build anything from a later phase than the current one. (section 13)

### Safe operation

- **P-30.** Run migrations, seeds, and resets only against the local dev or test database. Never run `prisma migrate reset`, `prisma db push --force-reset`, `DROP`, `TRUNCATE`, or `rm -rf` without owner approval. Never use live Flutterwave keys.
- **P-31.** Never fake verification. No stubs, mocks, or hard-coded success in `src/`. Fakes and fixtures live in `tests/` only.
- **P-32.** Never edit anything in `docs/PRD_Subscription_Slice_Rev2.md`.

---

## 4. How is the work arranged?

### Folder layout

Put every file where this tree says. Do not invent new top-level folders.

```
.
├── AGENTS.md
├── .nvmrc
├── .env.example
├── docs/
│   ├── PRD_Subscription_Slice_Rev2.md     read-only
│   ├── progress.md                        current phase and task checklists
│   ├── decisions.md                       owner answers and proposals
│   └── spike-notes.md                     Phase 0 findings
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── sql/                               hand-written SQL migrations
├── scripts/
│   ├── seed.ts
│   └── dispute-report.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx                     the signed-in shell
│   │   ├── error.tsx
│   │   ├── global-error.tsx
│   │   ├── not-found.tsx
│   │   ├── plans/page.tsx
│   │   ├── billing/page.tsx
│   │   ├── billing/actions.ts             thin server actions
│   │   ├── billing/return/page.tsx
│   │   └── api/
│   │       ├── checkout/initiate/route.ts
│   │       ├── checkout/status/route.ts
│   │       ├── webhooks/flutterwave/route.ts
│   │       └── cron/lifecycle/route.ts
│   ├── components/                        presentation only
│   └── server/                            all payment-mutating code
│       ├── db.ts
│       ├── env.ts                         Zod env check and test-key boot check
│       ├── constants.ts                   limits, windows, grace days
│       ├── clock.ts
│       ├── rateLimit.ts
│       ├── identity/
│       │   ├── getCurrentUser.ts
│       │   └── effectivePlan.ts
│       ├── payments/
│       │   ├── flutterwaveClient.ts
│       │   ├── initiateCheckout.ts
│       │   ├── verifyTransaction.ts
│       │   ├── fulfillEntitlement.ts
│       │   ├── handleWebhook.ts
│       │   ├── handleVerifiedReturn.ts
│       │   ├── proration.ts
│       │   ├── money.ts
│       │   ├── log.ts
│       │   └── tokenVault.ts
│       ├── billing/
│       │   ├── cancelSubscription.ts
│       │   ├── scheduleDowngrade.ts
│       │   ├── keepMyPlan.ts
│       │   └── saveCancellationReason.ts
│       └── lifecycle/
│           ├── runLifecycle.ts
│           └── runRenewals.ts
└── tests/
    ├── unit/
    ├── integration/
    ├── e2e/
    └── fixtures/                          signed webhook fixtures
```

### One job per file

| File | Its only job |
|---|---|
| `money.ts` | Unit conversion in and out. Display formatting. |
| `proration.ts` | The proration formula. |
| `flutterwaveClient.ts` | Every HTTP call to Flutterwave. Nothing else calls it. |
| `verifyTransaction.ts` | Verify with the provider and build the `VerifiedPayment`. |
| `fulfillEntitlement.ts` | Apply a verified payment, once. |
| `log.ts` | Every write to `PaymentLog` and `SubscriptionEvent`. |
| `tokenVault.ts` | Encrypt and decrypt the card token. |
| `clock.ts` | The current time. |
| `effectivePlan.ts` | The only reader of plan state for access decisions. |

### Structure rules

Breaking any of these also means the task failed.

- **S-1.** Put all payment-mutating code in `src/server`. Start each file there with `import "server-only"`. Never put such code in a client component or a `"use client"` file. Client code calls server actions or route handlers. (7.2)
- **S-2.** Implement `fulfillEntitlement()` once, in `fulfillEntitlement.ts`. Import it only from `handleWebhook.ts` and `handleVerifiedReturn.ts`. Enforce this with an ESLint `no-restricted-imports` rule that fails CI. It accepts only a `VerifiedPayment`, which only `verifyTransaction()` can construct. (7.2)
- **S-3.** Read `User.plan` only in `effectivePlan.ts` and the lifecycle job. Enforce it with an ESLint rule. (7.2)
- **S-4.** Keep the lifecycle and renewal jobs separate modules. They never grant access, never verify payments, and never call `fulfillEntitlement()`. The renewal job only creates a RENEWAL session, writes INITIATION, and starts the charge. The webhook finishes the job. (FR-17, FR-22)
- **S-5.** Keep route handlers, server actions, and pages thin. Validate with Zod, check Origin and rate limit, call one server module, return. No business logic in routes, pages, or components.
- **S-6.** Get the time only from the injected `Clock` in `clock.ts`. Never call `Date.now()` or `new Date()` elsewhere in `src/server`. (7.13)
- **S-7.** Reach Prisma only through `db.ts`. Reach the log tables only through `log.ts`. Raw SQL is allowed only in `prisma/sql/`, in the row lock in `fulfillEntitlement.ts`, and in the window count in `rateLimit.ts`. Use tagged templates so every value is parameterised.
- **S-8.** Mark the webhook, return, status, and cron routes `export const dynamic = "force-dynamic"`. Never cache a payment response.
- **S-9.** Keep client components to presentation. They get money as strings already formatted on the server. They do no money math, read no env values, and never call Flutterwave.
- **S-10.** Use the two database roles. The app role has no UPDATE or DELETE on `PaymentLog`. Only the migration role changes the schema. (section 10)

---

## 5. How should the code look?

Write clean, readable, modern code on the LTS stack in section 2.

**Language and tooling**
- Use current stable TypeScript and ES modules. Use `async` and `await`. Use `const` by default.
- Use no deprecated APIs. Use no `@ts-ignore` and no `eslint-disable` without a one-line reason and owner approval.
- Use Server Components by default. Add `"use client"` only for interaction.
- Format with Prettier. Lint with ESLint. Both must be clean before you finish.

**Shape**
- Give each function one job. Aim for under 40 lines. Aim for no more than 3 levels of nesting.
- Use early returns instead of deep `if` chains.
- Use named exports. Use default exports only where Next.js requires them.
- Give every exported function an explicit return type.
- Return a typed result (`{ ok: true, ... }` or `{ ok: false, outcome }`) for expected failures. Throw only for bugs and transient infrastructure errors.
- Use discriminated unions and enums (`PaymentOutcome`, `SubscriptionStatus`) instead of loose strings.
- Keep every limit, window, and day count in `constants.ts`. No magic numbers in logic.

**Names and files**
- Use `camelCase` for functions and variables, `PascalCase` for types and components, and `SCREAMING_SNAKE_CASE` for constants.
- Name server modules exactly as the folder layout shows. Name component files in `PascalCase.tsx`.

**Safety habits**
- Validate all outside input with Zod: webhook bodies, query values, form data, and env values.
- Never swallow an error. No empty `catch`.
- Never log a payload, a token, or a secret. Log ids and outcomes only.
- Write a short comment above each payment-path function naming the PRD rule it enforces, such as `// PRD 7.8 rule (b)`. Comment why, not what.

**Tests**
- Name each test with its PRD id, for example `T2 duplicate webhook`.
- Test failure paths first. A duplicate webhook test is mandatory.
- Run renewal and period-end tests on the injected `Clock` and with locally signed fixture webhooks.

---

## 6. What counts as done?

A task is done only when every item below is true. Do not say "done" until you have run the commands and read the output.

**Gate**
- `npm run typecheck` passes with zero errors.
- `npm run lint` passes with zero errors and zero warnings.
- `npm test` passes, including every test the task is meant to satisfy.
- `npm run build` passes with zero errors.
- The code you wrote has no TODO stubs, no commented-out code, and no placeholder logic in the payment path.
- Every rule in sections 3 and 4 that touches the task is still true.

Create these npm scripts in Phase 1 if they do not exist: `typecheck`, `lint`, `test`, `build`, and `check`, where `check` runs the first four.

**Report format.** End every task with this checklist, filled in. Also append it to `docs/progress.md`.

```
## Task report

Phase: <0 to 3>
Task: <one line>

PRD requirements met
- [x] FR-__  <what now works>
- [x] T__    <test name and result>
- [x] G__    <goal supported>

Rules checked
- [x] P-__   <how you kept it>
- [x] S-__   <how you kept it>

Commands run
- typecheck: <pass or fail>
- lint:      <pass or fail>
- test:      <passed N, failed N>
- build:     <pass or fail>

Files changed
- <path>: <why>

Not done, and why
- <item, or "none">

Assumptions or questions
- <anything not in the PRD, or "none">
```

Never tick a box you did not verify. Never report a passing command you did not run. If something fails, say so plainly, leave the box unticked, and say what blocks it.

---

## 7. What does the agent do when unsure?

**Stop and ask. Do not guess.**

### The order of authority

1. If the PRD answers the question, follow the PRD.
2. If the PRD is silent but this file has a rule, follow this file.
3. If neither answers it, stop. Write the question in `docs/decisions.md` in this form, tell the owner, and wait.

```
STOP: decision needed
Context:        <what you were building>
The question:   <one sentence>
Options:        <A, B, with the cost of each>
Recommendation: <your pick and why>
```

### What you must never do when unsure

- Never add a feature, screen, endpoint, column, or dependency the PRD does not list.
- Never invent scope. "It would be nice if" is not a reason.
- Never build ahead of the current phase.
- Never choose a tool, library, or pattern that section 2 does not name.
- Never add a workaround to make a test or a build pass. Fix the cause.
- Never add a "temporary" hack, a feature flag that skips a check, or a fallback that weakens a rule in section 3.
- Never disable a TypeScript or ESLint rule to get past an error.
- Never copy and paste a block of logic to avoid a refactor. One rule, one place.
- Never wrap a problem in nested conditions or a catch-all `try` to hide it.
- Never fake a result so the screen looks right.

### Known open items

- **Open Questions 3, 9, 10, 11:** blocked until the owner answers. Do not start Phase 1 before that.
- **Phase 0:** if you cannot read Flutterwave's current docs (signature scheme, verify endpoint, tokenization in test mode), stop and ask. Do not write those parts from memory.
- **Open Questions 1, 2, 4, 5, 6, 7, 8, 12:** use the PRD's recommended default. Tag anything you add beyond it `[ASSUMPTION ADDED]` in your report.
- **Any conflict** between two PRD sections, or between the PRD and this file: stop and ask.


<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
