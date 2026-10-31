# SubSlice: Subscription Billing Slice Implementation & Architectural Report

---

## Section 1: What This Is

SubSlice is an end-to-end, test-mode subscription billing slice for software-as-a-service applications. It allows a single authenticated user to view self-serve subscription plans (Free, Monthly, and Yearly), initiate checkouts, pay securely through Flutterwave's hosted checkout modal in Nigerian Naira (NGN), and receive immediate account entitlement once the payment is verified server-side. Once subscribed, the customer can manage their ongoing subscription from a dedicated billing portal: previewing prorated upgrades from monthly to yearly plans, scheduling downgrades, initiating cancellations with optional feedback surveys, undoing pending changes before cycle completion, and executing manual card renewals or "Pay Now" actions when past due. Every financial state transition is recorded in an immutable, append-only payment log and handled through an internal scheduler that executes recurring card token charges, manages a 3-day grace period, and transitions lapsed subscriptions.

Deliberately omitted from this slice are user registration, login screens, multi-tenant authentication, and product features sitting behind the paywall. There is no admin portal, manual refund issuance engine, multi-currency conversion system, or tax calculation engine. These omissions were chosen because production-grade payment architecture requires isolating the mechanics of money movement, verification, idempotency, and entitlement state machines from customer identity and application-level business logic. Introducing authentication, multi-currency FX math, or arbitrary product features would obscure the core auditability and regulatory compliance requirements of payment processing—namely, that access is granted solely upon cryptographically verified server-side evidence and that no amount of client-side manipulation can forge an entitlement.

---

## Section 2: How To Run It

Follow these numbered steps to run the application locally from a fresh clone in under ten minutes.

### 1. Prerequisites and Installation
Ensure your local machine has Node.js 22 LTS (pinned in `.nvmrc`) and PostgreSQL 14+ installed and running.

Clone the repository and install the exact pinned dependencies using `npm`:
```bash
npm install
```

### 2. Environment Configuration
Create a local `.env.local` configuration file by copying the committed `.env.example` template:
```bash
cp .env.example .env.local
```

Populate `.env.local` with your database credentials and Flutterwave test sandbox keys. Every environment variable is strictly server-only and must never be prefixed with `NEXT_PUBLIC_`:

| Environment Variable | Source & Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the runtime application pool (e.g., `postgresql://postgres:password@localhost:5432/payment_dev?schema=public`). |
| `DATABASE_URL_MIGRATE` | Direct connection string with administrative table creation privileges used for running Prisma migrations and hand-written SQL scripts. |
| `DATABASE_URL_TEST` | Dedicated PostgreSQL test database URL used by the Vitest test suite to isolate test fixtures from local development data. |
| `FLW_SECRET_KEY` | Flutterwave secret API key from your Flutterwave Sandbox dashboard. Must start with `FLWSECK_TEST-` (the application refuses to boot if non-test keys are detected). |
| `FLW_ENCRYPTION_KEY` | Flutterwave encryption key from the Sandbox account API keys tab. |
| `FLW_WEBHOOK_SECRET_HASH` | A secret string configured in your Flutterwave dashboard under Webhook Settings. Sent in the `verif-hash` HTTP header of every inbound webhook event. |
| `TOKEN_ENCRYPTION_KEY` | A 64-character hexadecimal string (32 bytes) used to encrypt reusable provider card tokens at rest using AES-256-GCM. Generate via `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`. |
| `APP_BASE_URL` | The public or local base URL of the application (e.g., `http://localhost:3000`). Used for strict HTTP Origin header validation and hosted checkout return URLs. |
| `CRON_SECRET` | A secure bearer token used to authenticate automated invocations of the daily lifecycle cron endpoint (`/api/cron/lifecycle`). |
| `SEED_USER_EMAIL` | The email address of the default seeded user acting as the signed-in session (defaults to `ada@example.com`). |

*(Note: Never commit `.env` or `.env.local` to source control. The repository maintains `.env.example` with commented placeholders so any reviewer can configure their local sandbox immediately.)*

### 3. Database Setup, Migrations, and SQL Role Enforcement
Apply Prisma schema migrations, execute hand-written database roles and trigger constraints, and seed initial plans and the default user:
```bash
# Push schema migrations to Postgres
npx prisma db push

# Apply hand-written SQL migrations (partial unique indexes, database roles, and immutable payment log triggers)
psql "$DATABASE_URL_MIGRATE" -f prisma/sql/01_partial_unique_index.sql
psql "$DATABASE_URL_MIGRATE" -f prisma/sql/02_database_roles.sql
psql "$DATABASE_URL_MIGRATE" -f prisma/sql/03_payment_log_trigger.sql

# Seed default plans (Free, Monthly @ ₦5,000, Yearly @ ₦50,000) and the seeded user (ada@example.com)
npx tsx scripts/seed.ts
```

### 4. Start the Application
Start the Next.js development server:
```bash
npm run dev
```
*(Alternatively, run a production build and start via `npm run build && npm start`.)*

### 5. Access the Application
Open your web browser and navigate to:
```
http://localhost:3000/plans
```
You can also visit the billing overview at `http://localhost:3000/billing`.

---

## Section 3: The Flow, Step By Step

### Step 1: Viewing Plans and Checking Entitlement
* **What the user does:** The user opens their browser and navigates to `http://localhost:3000/plans`.
* **What the frontend sends:** A standard HTTP `GET` request to `/plans` with no custom client credentials or user IDs.
* **What the server does:** In [src/app/plans/page.tsx](file:///c:/Users/USER/Desktop/Payment/src/app/plans/page.tsx), the server retrieves the current session identity via [getCurrentUser()](file:///c:/Users/USER/Desktop/Payment/src/server/identity/getCurrentUser.ts) (which returns the seeded user record `ada@example.com`). It then evaluates the user's active entitlement using [effectivePlan()](file:///c:/Users/USER/Desktop/Payment/src/server/identity/effectivePlan.ts), which inspects subscription dates, grace windows, and status flags rather than trusting `User.plan`. It renders three [PlanCard](file:///c:/Users/USER/Desktop/Payment/src/components/plans/PlanCard.tsx) components displaying prices already converted from integer kobo to Nigerian Naira strings (e.g., "₦5,000 / month" and "₦50,000 / year").

### Step 2: Initiating Checkout
* **What the user does:** The user clicks the "Subscribe" or "Upgrade" button on the Monthly or Yearly plan card.
* **What the frontend sends:** A `POST` request to `/api/checkout/initiate` containing a form-encoded or JSON body `{ "planTier": "MONTHLY" }` along with standard browser headers (`Origin: http://localhost:3000`).
* **What the server does:** In [src/app/api/checkout/initiate/route.ts](file:///c:/Users/USER/Desktop/Payment/src/app/api/checkout/initiate/route.ts), the route handler first checks the `Origin` header against `APP_BASE_URL` to prevent cross-site request forgery. It checks the sliding window rate limiter in [src/server/rateLimit.ts](file:///c:/Users/USER/Desktop/Payment/src/server/rateLimit.ts) against the user key (max 5/min) and client IP (max 20/min). If allowed, it invokes [initiateCheckout()](file:///c:/Users/USER/Desktop/Payment/src/server/payments/initiateCheckout.ts). The server marks any expired pending sessions as `EXPIRED`, generates a unique transaction reference `txRef` (`sub_monthly_<timestamp>_<random>`), creates a `CheckoutSession` row in PostgreSQL with `status: PENDING`, logs an immutable `INITIATION` event to `PaymentLog` via [writePaymentLog()](file:///c:/Users/USER/Desktop/Payment/src/server/payments/log.ts), calls Flutterwave's REST API via [createHostedPaymentLink()](file:///c:/Users/USER/Desktop/Payment/src/server/payments/flutterwaveClient.ts) to generate a hosted payment URL, updates the session with `paymentLink`, and issues an HTTP 303 redirect to the Flutterwave hosted checkout modal.

### Step 3: Paying on Flutterwave Hosted Checkout
* **What the user does:** The user is redirected to Flutterwave's secure hosted payment page. The user inputs their test card details (card number, expiration date, CVV, and test OTP PIN) and clicks "Pay ₦5,000".
* **What the frontend sends:** All sensitive payment card data is transmitted directly from the user's browser to Flutterwave's PCI-DSS Level 1 compliant servers. No card numbers or CVVs ever touch our application server.
* **What the server does:** Flutterwave authorizes the transaction. At this point, two asynchronous actions occur: Flutterwave sends an HTTP webhook to our webhook endpoint, and Flutterwave redirects the customer's browser back to our return URL.

### Step 4: Webhook Ingestion, Signature Verification, and Entitlement Fulfillment
* **What the user does:** Nothing directly; this occurs in the background over server-to-server HTTP.
* **What the frontend sends (from Flutterwave):** Flutterwave's dispatch servers send an HTTP `POST` request to `/api/webhooks/flutterwave` with the header `verif-hash: <secret_hash>` and a JSON body containing `event: "charge.completed"` and payment metadata.
* **What the server does:** In [src/app/api/webhooks/flutterwave/route.ts](file:///c:/Users/USER/Desktop/Payment/src/app/api/webhooks/flutterwave/route.ts), the server checks the IP rate limiter (60 req/min). In [src/server/payments/handleWebhook.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/handleWebhook.ts), the server reads the raw request text, ensures the body does not exceed 64 KB, and immediately verifies the `verif-hash` header against `process.env.FLW_WEBHOOK_SECRET_HASH` *before* parsing the JSON. If valid, it extracts `data.id` (provider transaction ID) and `data.tx_ref`. It checks `PaymentLog` for `idempotencyKey: fulfil:<providerTransactionId>` to prevent duplicate processing. It then calls [verifyTransaction()](file:///c:/Users/USER/Desktop/Payment/src/server/payments/verifyTransaction.ts), which reaches out to Flutterwave's REST API (`GET /v3/transactions/{id}/verify`) to confirm the transaction status is `"successful"`, parses the amount into integer kobo without `parseFloat`, and verifies that the currency is `NGN`, the amount matches the session, and the reference matches. Upon building a branded `VerifiedPayment` object, it calls [fulfillEntitlement()](file:///c:/Users/USER/Desktop/Payment/src/server/payments/fulfillEntitlement.ts). Inside a serializable transaction with a `SELECT ... FOR UPDATE` row lock on `Subscription`, the server writes a `FULFILMENT` row to `PaymentLog`, updates or inserts the user's `Subscription` record to `status: ACTIVE`, stores the encrypted card token (via AES-256-GCM in [src/server/payments/tokenVault.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/tokenVault.ts)), updates `CheckoutSession` to `COMPLETED`, updates `User.plan`, writes `PLAN_APPLIED` to `SubscriptionEvent`, and returns HTTP 200 to Flutterwave.

### Step 5: User Return Redirect and Verified Entitlement Reflection
* **What the user does:** Upon completing payment, Flutterwave redirects the user's browser back to our application at `http://localhost:3000/billing/return?tx_ref=sub_monthly_...&transaction_id=1234567`.
* **What the frontend sends:** A browser `GET` request to `/billing/return` with `tx_ref` and `transaction_id` query parameters.
* **What the server does:** In [src/app/billing/return/page.tsx](file:///c:/Users/USER/Desktop/Payment/src/app/billing/return/page.tsx) and [src/server/payments/handleVerifiedReturn.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/handleVerifiedReturn.ts), the server completely ignores any `status` query parameters sent by the browser. It looks up the user's session by `txRef`. If the background webhook already completed fulfillment, it detects `session.status === COMPLETED` and immediately redirects to `/plans?confirmed=1`. If the return request arrives before the webhook finishes, the return handler calls `verifyTransaction()` and `fulfillEntitlement()` itself, ensuring synchronous fulfillment so the user is never left waiting on an unfulfilled state. If valid, the user is redirected to `/plans?confirmed=1` with an active subscription badge.

### Step 6: Managing Subscriptions in the Billing Portal
* **What the user does:** The user navigates to `/billing` to view their active subscription, renewal dates, payment method status, and self-serve controls.
* **What the frontend sends:** A `GET` request to `/billing`.
* **What the server does:** In [src/app/billing/page.tsx](file:///c:/Users/USER/Desktop/Payment/src/app/billing/page.tsx), the server loads the user's subscription and payment log history, checks [effectivePlan()](file:///c:/Users/USER/Desktop/Payment/src/server/identity/effectivePlan.ts), and passes formatted status and date models to the [BillingManager](file:///c:/Users/USER/Desktop/Payment/src/components/billing/BillingManager.tsx) component.

### Step 7: Upgrading with Proration Quote
* **What the user does:** From `/billing` or `/plans`, an active monthly subscriber clicks "Upgrade to Yearly".
* **What the frontend sends:** Invokes the server action [previewUpgradeAction()](file:///c:/Users/USER/Desktop/Payment/src/app/billing/actions.ts).
* **What the server does:** The server executes [calculateProration()](file:///c:/Users/USER/Desktop/Payment/src/server/payments/proration.ts) using whole UTC days and integer remainder math. It calculates the unused days remaining in the current monthly cycle, computes the exact kobo credit, subtracts it from the yearly plan price, and returns a quote showing the exact charge and credit. If the user confirms, checkout initiation creates an `UPGRADE` checkout session, stores `prorationCreditMinor`, and charges only the net difference.

### Step 8: Cancellation, Downgrade Scheduling, and "Keep My Plan"
* **What the user does:** The user clicks "Cancel Subscription" or "Downgrade to Monthly" on the billing page, confirms the prompt dialog, and optionally submits a cancellation feedback reason.
* **What the frontend sends:** Invokes server actions [cancelSubscriptionAction()](file:///c:/Users/USER/Desktop/Payment/src/app/billing/actions.ts), [scheduleDowngradeAction()](file:///c:/Users/USER/Desktop/Payment/src/app/billing/actions.ts), or [keepMyPlanAction()](file:///c:/Users/USER/Desktop/Payment/src/app/billing/actions.ts).
* **What the server does:** The server actions delegate to [cancelSubscription.ts](file:///c:/Users/USER/Desktop/Payment/src/server/billing/cancelSubscription.ts), [scheduleDowngrade.ts](file:///c:/Users/USER/Desktop/Payment/src/server/billing/scheduleDowngrade.ts), or [keepMyPlan.ts](file:///c:/Users/USER/Desktop/Payment/src/server/billing/keepMyPlan.ts). For cancellations, the server updates `cancelAtPeriodEnd: true` and logs `CANCEL_REQUESTED` to `SubscriptionEvent`. It never cuts off access immediately: `effectivePlan()` continues granting paid access until `currentPeriodEnd`. If the user clicks "Keep my plan", `keepMyPlanAction()` immediately clears `cancelAtPeriodEnd` and `pendingPlanId`, writing `CHANGE_UNDONE` to `SubscriptionEvent` without touching payment rails.

### Step 9: Daily Lifecycle, Renewals, and Grace Management
* **What the user does:** Nothing; triggered automatically by a scheduled cron service.
* **What the frontend/scheduler sends:** A `GET` request to `/api/cron/lifecycle` with header `Authorization: Bearer <CRON_SECRET>`.
* **What the server does:** In [src/app/api/cron/lifecycle/route.ts](file:///c:/Users/USER/Desktop/Payment/src/app/api/cron/lifecycle/route.ts), the route validates `CRON_SECRET` and calls [runLifecycle()](file:///c:/Users/USER/Desktop/Payment/src/server/lifecycle/runLifecycle.ts) followed by [runRenewals()](file:///c:/Users/USER/Desktop/Payment/src/server/lifecycle/runRenewals.ts). `runLifecycle()` finds subscriptions where `cancelAtPeriodEnd === true` and `currentPeriodEnd <= now` and transitions them to `ENDED`, dropping `User.plan` to `FREE`. It also ends subscriptions whose 3-day grace period expired and prunes rate-limit hits older than 24 hours. `runRenewals()` finds active uncancelled subscriptions reaching period end, decrypts the stored card token via [decryptCardToken()](file:///c:/Users/USER/Desktop/Payment/src/server/payments/tokenVault.ts), creates a `RENEWAL` checkout session, logs `INITIATION`, and calls Flutterwave's tokenized charge API. If declined or missing a token, the subscription transitions to `PAST_DUE` with `graceEndsAt` set to `currentPeriodEnd + 3 days`, allowing the customer to recover their subscription via the "Pay Now" flow.

---

## Section 4: The Data Model

### The Prisma Schema

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DATABASE_URL_MIGRATE")
}

generator client {
  provider = "prisma-client-js"
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

---

### Table Explanations and Column Design Decisions

#### 1. `User`
* **What it holds:** Represents the account identity holding customer profile information and plan associations.
* **Column decisions:**
  * `email`: `String @unique`. Not nullable. Enforces account uniqueness and prevents duplicate customer identities.
  * `plan`: `PlanTier @default(FREE)`. Enum. Represents the database tier flag; while runtime entitlement is decided strictly via `effectivePlan()`, this cached tier allows efficient relational indexing and reporting.

#### 2. `Plan`
* **What it holds:** The canonical catalog of subscribable tiers, billing intervals, and prices.
* **Column decisions:**
  * `tier`: `PlanTier @unique`. Not nullable. Ensures only one record exists per tier (FREE, MONTHLY, YEARLY).
  * `interval`: `Interval?`. Nullable. Free plans do not have recurring billing intervals; paid tiers are strictly `MONTH` or `YEAR`.
  * `amountMinor`: `Int`. Not nullable. Stores price in minor units (kobo). Whole integer prevents floating-point precision loss.
  * `currency`: `String @db.Char(3)`. Fixed 3-character ISO 4217 string (`NGN`). Not nullable. Stored explicitly beside every monetary amount to eliminate currency ambiguity.

#### 3. `Subscription`
* **What it holds:** The live entitlement record, billing cycle dates, renewal states, and encrypted card tokens for a user.
* **Column decisions:**
  * `userId`: `String @unique`. Not nullable. Guarantees that a user can have at most one subscription record in the system.
  * `status`: `SubscriptionStatus` (`ACTIVE`, `PAST_DUE`, `ENDED`). Not nullable. Tracks state machine position.
  * `currentPeriodStart` & `currentPeriodEnd`: `DateTime`. Not nullable. Explicit UTC timestamps defining the exact prepaid billing window.
  * `cancelAtPeriodEnd`: `Boolean @default(false)`. Not nullable. Signals that cancellation was requested without cutting off access early.
  * `pendingPlanId`: `String?`. Nullable. Points to a scheduled downgrade plan (e.g. Yearly downgrading to Monthly at cycle end). Null when no change is queued.
  * `graceEndsAt`: `DateTime?`. Nullable. Set to `currentPeriodEnd + 3 days` only when transitioning to `PAST_DUE`. Null during normal active operation.
  * `cardTokenEncrypted`: `String?`. Nullable. Stores the AES-256-GCM encrypted provider token (`iv:authTag:ciphertext`). Null if the user paid via an untokenized method.
  * `lastAmountMinor`: `Int`. Not nullable. Records the exact minor amount paid in the most recent successful billing event, serving as the basis for fair proration calculations.

#### 4. `CheckoutSession`
* **What it holds:** Ephemeral intent records initiated prior to provider payment, capturing quoted amounts, kind, and expiration.
* **Column decisions:**
  * `txRef`: `String @unique`. Not nullable. Canonical transaction reference passed to Flutterwave to correlate checkouts with provider webhooks.
  * `providerTransactionId`: `String? @unique`. Nullable. Populated upon verification or completion with Flutterwave's numeric transaction ID. Uniqueness prevents two checkout sessions from claiming the same provider transaction.
  * `amountMinor`: `Int`. Not nullable. The exact kobo amount quoted and expected from the payment gateway.
  * `prorationCreditMinor`: `Int?`. Nullable. Stores any deducted credit during an upgrade checkout, preserving the quote audit trail.
  * `status`: `CheckoutStatus @default(PENDING)`. Enum (`PENDING`, `COMPLETED`, `FAILED`, `EXPIRED`).
  * `expiresAt`: `DateTime`. Not nullable. Enforces 15-minute or midnight expiration on checkout quotes.

#### 5. `PaymentLog`
* **What it holds:** An immutable, append-only financial audit log recording every payment event across all sources.
* **Column decisions:**
  * `idempotencyKey`: `String @unique`. Not nullable. Prevents duplicate logging or processing of identical events.
  * `eventType`: `PaymentEventType` (`INITIATION`, `VERIFICATION`, `FULFILMENT`, `FAILURE`). Not nullable. Categorizes the event in the payment lifecycle.
  * `source`: `EventSource` (`CHECKOUT`, `WEBHOOK`, `RETURN`, `RENEWAL_JOB`). Not nullable. Captures the origination mechanism.
  * `outcome`: `PaymentOutcome`. Not nullable. Granular outcome code (e.g., `SUCCESS`, `AMOUNT_MISMATCH`, `DUPLICATE_PAYMENT`, `SIGNATURE_INVALID`).
  * `payload`: `Json`. Not nullable. Contains strictly allowlisted provider fields (`id`, `tx_ref`, `flw_ref`, `status`, `amount`, `currency`, `created_at`). Raw request bodies and card numbers are strictly forbidden.

#### 6. `SubscriptionEvent`
* **What it holds:** An audit log of non-payment subscription lifecycle events (cancellations, scheduled downgrades, and undo actions).
* **Column decisions:**
  * `idempotencyKey`: `String @unique`. Not nullable. Formatted as `sub:<type>:<subscriptionId>:<requestId>` to guarantee at-most-once processing of lifecycle actions.
  * `type`: `SubscriptionEventType`. Not nullable. Enum representing the business event (`CANCEL_REQUESTED`, `DOWNGRADE_SCHEDULED`, `CHANGE_UNDONE`, `PERIOD_ENDED`, `GRACE_STARTED`, `PLAN_APPLIED`).
  * `reasonCode` & `reasonText`: Nullable. Captures optional churn feedback without requiring users to supply a reason to cancel.

#### 7. `RateLimitHit`
* **What it holds:** Sliding window rate limit timestamps for user, IP, and endpoint tracking.
* **Column decisions:**
  * `key`: `String`. Not nullable. Composite key identifying the rate limit target (e.g., `user:ada@example.com`, `ip:192.168.1.1`, `webhook:ip:10.0.0.1`).
  * `at`: `DateTime @default(now())`. Not nullable. Timestamp used for sliding window counts and automated daily cleanup.

---

### Constraints That Make Invalid States Impossible

A schema is the application's final line of defense against race conditions, bugs, and data corruption. The following constraints make invalid states physically impossible at the database level:

1. **Partial Unique Index on Open Pending Sessions:**
   ```sql
   CREATE UNIQUE INDEX "idx_checkout_session_user_target_pending"
   ON "CheckoutSession" ("userId", "targetPlanId")
   WHERE "status" = 'PENDING' AND "kind" <> 'RENEWAL';
   ```
   *What it prevents:* Prevents a user from opening multiple pending checkout sessions for the same plan. Even if a user double-clicks the checkout button or sends simultaneous parallel API requests, the database rejects the second insertion, forcing session reuse or sequential expiration.

2. **Immutable Trigger on `PaymentLog`:**
   ```sql
   CREATE OR REPLACE FUNCTION prevent_payment_log_mutation()
   RETURNS TRIGGER AS $$
   BEGIN
     RAISE EXCEPTION 'PaymentLog is append-only. UPDATE and DELETE operations are forbidden.';
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER trg_payment_log_immutable
   BEFORE UPDATE OR DELETE ON "PaymentLog"
   FOR EACH ROW
   EXECUTE FUNCTION prevent_payment_log_mutation();
   ```
   *What it prevents:* Completely prevents any `UPDATE` or `DELETE` query against `PaymentLog` across all database connections, application code, test runs, and administrative scripts. Financial history cannot be tampered with or accidentally wiped.

3. **Database Roles and Runtime Privilege Revocation:**
   ```sql
   REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "PaymentLog" FROM subslice_app;
   GRANT SELECT, INSERT ON TABLE "PaymentLog" TO subslice_app;
   ```
   *What it prevents:* The runtime application user role (`subslice_app`) lacks permissions to mutate payment logs. Even if an attacker achieved arbitrary SQL injection through application vulnerabilities, PostgreSQL denies write mutation permissions.

4. **Unique Constraint on `PaymentLog.idempotencyKey`:**
   *What it prevents:* Prevents duplicate processing of webhooks, duplicate fulfillments, or multiple verification records for the same provider event. If a concurrent return and webhook race to fulfill the same transaction ID (`fulfil:<providerTransactionId>`), the second transaction triggers a unique constraint collision and aborts.

5. **Unique Constraint on `Subscription.userId`:**
   *What it prevents:* Guarantees that a user can never possess two competing subscription records. All plan updates, upgrades, and renewals must update the single existing record, eliminating ghost subscriptions.

6. **Unique Constraints on `CheckoutSession.txRef` and `CheckoutSession.providerTransactionId`:**
   *What it prevents:* Prevents transaction reference collision and ensures that no two sessions can ever point to or be fulfilled by the same provider payment ID.

---

## Section 5: The Concepts

### 1. Minor Units and Why Money is Never a Decimal

#### What it is
Minor units represent monetary values expressed in the smallest recognized denomination of a currency—such as kobo for Nigerian Naira (NGN) or cents for US Dollars (USD)—as whole integers. One Naira is stored as `100` kobo, and a ₦5,000 subscription is stored as `500000`. Decimal numbers and floating-point representations are strictly forbidden across storage, arithmetic, and internal application boundaries.

#### Why it is needed
Binary floating-point types (`float`, `double`, and JavaScript's `Number` type) cannot accurately represent base-10 fractions. In JavaScript, simple decimal arithmetic produces precision errors such as `0.1 + 0.2 = 0.30000000000000004`. If recurring subscription billing or proration calculations use floating-point numbers, fractional kobo inaccuracies accumulate over thousands of transactions, resulting in reconciliations where ledger balances fail to balance, tax records mismatch, or customer cards are charged incorrect amounts.

#### How I implemented it
Every monetary column in Prisma is typed as `Int` (e.g., `amountMinor`). In [src/server/payments/money.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/money.ts), inbound provider numbers and strings are converted to integer kobo via `fromProviderAmount()` without ever invoking `parseFloat`:

```typescript
export function fromProviderAmount(
  rawAmount: number | string
): { ok: true; amountMinor: number } | { ok: false; error: string } {
  const str = String(rawAmount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return { ok: false, error: `Invalid provider amount format: "${str}".` };
  }
  const [wholePart = "", decimalPart = ""] = str.split(".");
  const amountMinor = parseInt(wholePart, 10) * 100 + parseInt(decimalPart.padEnd(2, "0"), 10);
  return { ok: true, amountMinor };
}
```

#### What I chose against, and why
I chose against using PostgreSQL `Decimal`/`Numeric` fields and against third-party arbitrary-precision decimal libraries like `decimal.js`. While arbitrary-precision decimal libraries prevent floating-point rounding errors, storing pure integers (`Int`) in minor units requires zero external dependencies, maps directly to standard database integer types, executes faster in arithmetic computations, and natively matches the minor-unit integer APIs used by modern payment gateways.

---

### 2. The Payment Lifecycle: Initiation, Verification, and Fulfilment

#### What it is
The payment lifecycle is the strict tripartite sequence of stages required to process a financial charge: *Initiation* records the user's intent to purchase and establishes the expected price; *Verification* contacts the payment processor server-to-server to independently confirm that the transaction was captured and matches our exact terms; and *Fulfilment* atomically applies the purchased entitlement to the user's account.

#### Why it is needed
Collapsing these three stages into one or trusting the client browser to confirm payment creates severe security vulnerabilities. A malicious user can intercept the client-side redirect from Flutterwave, spoof a query parameter like `?status=successful`, or simulate a return URL without paying. If the server fulfilled entitlements upon URL redirection, attackers would obtain free subscriptions. Conversely, if verification and fulfillment were not separate, transient network timeouts during entitlement updates would cause unrecorded, orphaned transactions.

#### How I implemented it
The stages live in distinct modules. Initiation occurs in [src/server/payments/initiateCheckout.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/initiateCheckout.ts), which writes an `INITIATION` row to `PaymentLog`. Verification is handled in [src/server/payments/verifyTransaction.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/verifyTransaction.ts), which issues an HTTP call to Flutterwave and constructs a branded `VerifiedPayment` type. Fulfillment in [src/server/payments/fulfillEntitlement.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/fulfillEntitlement.ts) strictly requires this branded object:

```typescript
// Branded type enforces compile-time proof of verification
declare const VerifiedPaymentBrand: unique symbol;
export interface VerifiedPayment {
  readonly [VerifiedPaymentBrand]: true;
  providerTransactionId: string;
  txRef: string;
  amountMinor: number;
  currency: string;
}
```

#### What I chose against, and why
I chose against inline, opportunistic fulfillment inside route handlers. Coupling HTTP route parsing with provider verification and database transaction logic produces duplicate, untestable code across the return view and webhook endpoints. Isolating fulfillment into a single server function guarantees that entitlement logic is written once and protected by an ESLint architectural boundary.

---

### 3. The Payment Log and Dispute Proof

#### What it is
The payment log is an immutable, append-only ledger in PostgreSQL (`PaymentLog`) that records every financial event, attempt, verification outcome, and failure across the entire application. It stores the timestamp, idempotency key, provider transaction IDs, expected and received amounts, outcome codes, and sanitized provider payloads.

#### Why it is needed
When a customer disputes a charge with their issuing bank or submits a chargeback claim, the merchant must provide incontrovertible evidence showing exactly when the checkout was started, the provider reference received, the verified response from the gateway, and the exact timestamp entitlement was provisioned. Without an immutable log, developers cannot reconstruct past states, diagnose duplicate charges, or prove to payment processors that a service was delivered as contracted.

#### How I implemented it
All writes route through `writePaymentLog()` in [src/server/payments/log.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/log.ts). The table is protected by a PostgreSQL trigger blocking `UPDATE` and `DELETE`, and an automated dispute script in [scripts/dispute-report.ts](file:///c:/Users/USER/Desktop/Payment/scripts/dispute-report.ts) extracts flagged events:

```typescript
// Extracts flagged transactions for manual dispute resolution
const flaggedLogs = await prisma.paymentLog.findMany({
  where: {
    outcome: {
      in: [PaymentOutcome.DUPLICATE_PAYMENT, PaymentOutcome.UNMATCHED_REFERENCE,
           PaymentOutcome.PAID_EXPIRED_SESSION, PaymentOutcome.UPGRADE_PERIOD_DRIFT],
    },
  },
  include: { user: true, checkoutSession: true },
});
```

#### What I chose against, and why
I chose against relying on application-level logging tools (e.g., Datadog, CloudWatch, or console logs) or overwriting a status column on `CheckoutSession`. Application logs are ephemeral, lack relational integrity with database entities, and cannot participate in atomic database transactions. An append-only relational table ensures that an audit log row commits alongside the entitlement change in the exact same transaction.

---

### 4. Idempotency in Payments

#### What it is
Idempotency is the property of an operation whereby executing it multiple times produces the exact same system state as executing it once. In payment processing, an idempotent endpoint guarantees that if the gateway delivers the same payment notification five times, the customer's card is charged once, their subscription period is extended once, and only one fulfillment record is created.

#### Why it is needed
Payment gateways operate over distributed networks and employ "at-least-once" delivery semantics. If a network blip occurs before our server returns an HTTP 200, Flutterwave re-delivers the webhook repeatedly over several hours. Without idempotency, each delivery would execute fulfillment anew, extending the user's subscription indefinitely or creating duplicate charges on the user's card during renewal jobs.

#### How I implemented it
Idempotency is enforced through deterministic unique keys on `PaymentLog.idempotencyKey` and `SubscriptionEvent.idempotencyKey`. In [src/server/payments/fulfillEntitlement.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/fulfillEntitlement.ts), the key is formatted as `fulfil:<providerTransactionId>`. An atomic transaction serializes checks via database-level unique indexing:

```typescript
const idempotencyKey = `fulfil:${payment.providerTransactionId}`;
const existingFulfilment = await db.paymentLog.findUnique({ where: { idempotencyKey } });
if (existingFulfilment) {
  return { ok: true, outcome: "ALREADY_FULFILLED" };
}
```

#### What I chose against, and why
I chose against in-memory caches or Redis key-value locks for idempotency guards. If a Redis node restarts or network partitions occur between the cache and the primary database, check-then-set race conditions emerge. Enforcing idempotency through PostgreSQL unique constraints guarantees ACID-level serialized enforcement that cannot be bypassed.

---

### 5. Webhook Signature Verification

#### What it is
Webhook signature verification is a cryptographic check performed on incoming HTTP requests from a payment processor to prove that the payload genuinely originated from the gateway and was not forged or altered in transit. In Flutterwave's architecture, this is verified by inspecting the `verif-hash` header against a pre-shared secret hash.

#### Why it is needed
Without signature verification, webhook endpoints are public HTTP endpoints vulnerable to spoofing. Any malicious actor on the internet could send a crafted `POST` request to `/api/webhooks/flutterwave` claiming that transaction `123456` succeeded for ₦50,000, causing the server to grant free annual access without receiving real funds.

#### How I implemented it
In [src/server/payments/handleWebhook.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/handleWebhook.ts), signature verification occurs immediately after capping the request size to 64 KB and *before* JSON parsing or database lookups. If invalid, it logs the SHA-256 hash of the payload and halts:

```typescript
if (!signatureHeader || signatureHeader !== expectedSecretHash) {
  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  await writePaymentLog({
    idempotencyKey: `fail:sig:${bodySha256}`,
    eventType: PaymentEventType.FAILURE,
    outcome: PaymentOutcome.SIGNATURE_INVALID,
    payload: { body_sha256: bodySha256, signature_header: signatureHeader },
  });
  return { status: 401, message: "Unauthorized: Invalid webhook signature." };
}
```

#### What I chose against, and why
I chose against IP allowlisting as the primary webhook security mechanism. Gateway provider IPs change frequently, are vulnerable to spoofing behind reverse proxies, and fail when running in cloud serverless environments behind shared NAT gateways. Cryptographic header verification provides zero-trust authentication independent of hosting infrastructure.

---

### 6. Proration with Exact Integer Arithmetic

#### What it is
Proration is the fair calculation of credit owed to a subscriber when upgrading from a cheaper plan (Monthly) to a more expensive plan (Yearly) mid-cycle. The unused portion of the already-paid monthly period is credited towards the yearly purchase, and the new yearly billing cycle begins immediately.

#### Why it is needed
If an application charges the full annual price of ₦50,000 to a user who paid ₦5,000 for a monthly subscription only two days prior, the customer is double-charged for the remaining 28 days of their month. Conversely, if proration logic uses floating-point division, off-by-one penny or kobo rounding errors will cause the invoice line items (`charge + credit`) to not sum to the catalog price (`yearlyPrice`), failing accounting reconciliation.

#### How I implemented it
Proration is implemented in [src/server/payments/proration.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/proration.ts) using whole UTC days and integer remainder division. Given total days $D$, unused days $U$, last paid amount $L$, and yearly price $Y$, the formula computes:
$$\text{charge} = \left\lfloor \frac{Y \cdot D - L \cdot U}{D} \right\rfloor = \frac{(Y \cdot D - L \cdot U) - ((Y \cdot D - L \cdot U) \pmod D)}{D}$$
$$\text{credit} = Y - \text{charge}$$

```typescript
const numerator = yearly * totalDays - lastPaid * unusedDays;
const remainder = numerator % totalDays;
chargeKobo = (numerator - remainder) / totalDays;
const creditKobo = yearly - chargeKobo;
```

#### Concrete Calculation Walkthrough with Real Numbers
Consider the verified test case **T11** in our test suite:
* A user pays ₦5,000 (`500000` kobo) on June 1, 2026, for a 30-day period ending July 1, 2026 ($D = 30$).
* On June 11, 2026, with 20 unused days remaining ($U = 20$), the user requests an upgrade to Yearly (₦50,000 or `5000000` kobo).
* Arithmetic evaluation:
  1. $Y \cdot D = 5{,}000{,}000 \times 30 = 150{,}000{,}000$
  2. $L \cdot U = 500{,}000 \times 20 = 10{,}000{,}000$
  3. $\text{Numerator} = 150{,}000{,}000 - 10{,}000{,}000 = 140{,}000{,}000$
  4. $\text{Remainder} = 140{,}000{,}000 \pmod{30} = 20$
  5. $\text{chargeKobo} = (140{,}000{,}000 - 20) / 30 = 4{,}666{,}666 \text{ kobo (₦46,666.66)}$
  6. $\text{creditKobo} = 5{,}000{,}000 - 4{,}666{,}666 = 333{,}334 \text{ kobo (₦3,333.34)}$
  7. Exact Sum Verification: $4{,}666{,}666 + 333{,}334 = 5{,}000{,}000 \text{ kobo (₦50,000.00)}$

#### What I chose against, and why
I chose against second-by-second fractional proration and against JavaScript floating-point division (`Math.floor(x / y)`). Sub-day second-based proration creates confusing quotes that change every second while the user is reading the checkout page, and float division produces fractional kobo truncation errors. Whole UTC days provide predictable quotes, and integer remainder math guarantees exact kobo reconciliation.

---

### 7. Cancellation and Period-End Access with Legal Reasoning

#### What it is
Cancellation is the customer's instruction to terminate a recurring subscription at the end of the current paid billing cycle. Rather than revoking access immediately, the subscription remains `ACTIVE` with `cancelAtPeriodEnd = true`, and paid access continues until the prepaid `currentPeriodEnd` date passes.

#### Why it is needed
When a customer pays in advance for 30 days or 365 days of software access, a legally binding contract for service is formed under consumer protection laws (including UK Consumer Rights, EU Distance Selling Directives, and Nigerian Federal Competition and Consumer Protection Commission regulations). Revoking access immediately upon cancellation without issuing a full prorated refund constitutes breach of contract. Furthermore, forcing customers to provide feedback reasons or navigate complex cancellation retention funnels violates modern consumer transparency regulations (such as FTC "Click to Cancel" rules).

#### How I implemented it
In [src/server/billing/cancelSubscription.ts](file:///c:/Users/USER/Desktop/Payment/src/server/billing/cancelSubscription.ts), cancellation flags the record without modifying the period end date. Access gating in [src/server/identity/effectivePlan.ts](file:///c:/Users/USER/Desktop/Payment/src/server/identity/effectivePlan.ts) continues granting full access:

```typescript
// Access continues until currentPeriodEnd even if cancellation was requested
if (subscription.cancelAtPeriodEnd && now > subscription.currentPeriodEnd) {
  return "FREE";
}
return user.plan;
```

#### What I chose against, and why
I chose against immediate mid-period access termination with automated micro-refunds. Card networks penalize merchants with excessive refund ratios, and issuing immediate refunds requires complex processing fee deductions that frustrate customers. Granting access through the prepaid period honors the original purchase contract cleanly and transparently.

---

### 8. Why We Do Not Store Cards and PCI Scope Reduction

#### What it is
Cardholder Data (CHD) encompasses primary account numbers (PAN), expiration dates, and card verification values (CVV/CVC). Payment Card Industry Data Security Standards (PCI-DSS) regulate organizations that store, process, or transmit cardholder data. We store zero cardholder numbers, expiration dates, or CVVs; we only retain encrypted provider reference tokens (`cardToken`).

#### Why it is needed
If an application server touches, transmits, or stores raw credit card numbers, it falls under PCI-DSS Level 1 or 2 scope (SAQ D), requiring physical data center audits, dedicated hardware security modules (HSM), quarterly penetration testing, and millions of dollars in annual compliance overhead. If the database were compromised, plain-text card numbers would lead to catastrophic fraud and severe liability.

#### How I implemented it
Card details are entered directly on Flutterwave's hosted checkout modal. When Flutterwave returns a reusable token, [src/server/payments/tokenVault.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/tokenVault.ts) encrypts it at rest using AES-256-GCM with a server-only 32-byte key:

```typescript
export function encryptCardToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}
```

#### What I chose against, and why
I chose against custom payment form inputs (embedded card elements) that transmit card data to our Next.js API routes before forwarding to Flutterwave. Even if the server does not store the numbers, having card numbers traverse our server memory expands PCI scope to SAQ A-EP. Using Flutterwave hosted checkout limits our compliance posture to the simplest standard: SAQ A.

---

### 9. Rate Limiting on Payment Endpoints

#### What it is
Rate limiting controls the frequency with which clients can submit requests to sensitive endpoints within a sliding time window. We enforce 5 requests per minute per user and 20 per minute per IP on checkout initiation, and 60 requests per minute per IP on webhook and return routes.

#### Why it is needed
Payment endpoints are prime targets for automated abuse. Malicious actors use automated checkout bots for card testing (validating thousands of stolen card numbers against real merchant accounts), which results in massive gateway decline fees and merchant account suspension. Unthrottled webhook endpoints are also vulnerable to denial-of-service (DoS) attacks that exhaust server database connection pools.

#### How I implemented it
Implemented via a sliding window log in PostgreSQL using the `RateLimitHit` table in [src/server/rateLimit.ts](file:///c:/Users/USER/Desktop/Payment/src/server/rateLimit.ts). When limits are exceeded, the server returns an HTTP 429 status code with a standard `Retry-After` header:

```typescript
const count = await db.rateLimitHit.count({
  where: { key, at: { gte: windowStart } },
});
if (count >= limit) {
  const retryAfterSeconds = Math.max(1, Math.ceil((oldestTime + windowSeconds * 1000 - now.getTime()) / 1000));
  return { allowed: false, retryAfterSeconds };
}
await db.rateLimitHit.create({ data: { key, at: now } });
```

#### What I chose against, and why
I chose against deploying a standalone Redis cluster or using in-memory token bucket libraries. In-memory limiters fail on multi-instance serverless deployments (where each serverless function invocation maintains separate memory), while provisioning Redis adds external infrastructure dependencies and connection latency for a single slice. Storing timestamp hits in PostgreSQL leverages existing transactional storage and requires zero extra cloud infrastructure.

---

## Section 6: What Went Wrong

### 1. Concurrent Race Condition Between Webhook and Browser Return
* **The Symptom:** During automated integration tests and rapid manual checkout testing, when the user returned to `/billing/return` at the exact millisecond Flutterwave's webhook hit `/api/webhooks/flutterwave`, the browser encountered an unhandled 500 server crash, and Postgres logged `PrismaClientKnownRequestError: Unique constraint failed on the fields: (idempotencyKey)`.
* **The Investigation:** Initially investigated whether Flutterwave was firing duplicate webhooks for a single charge (which proved false; provider logs confirmed only one webhook dispatch). Then investigated whether React 19 Strict Mode was mounting page components twice in development. By adding microsecond logging inside `fulfillEntitlement.ts`, discovered that both the webhook route and the return view handler were executing `fulfillEntitlement()` simultaneously for the same `providerTransactionId`. Both passed the initial `findUnique` check because neither had committed yet, and both attempted to insert a `PaymentLog` row with `idempotencyKey: fulfil:<providerTransactionId>`, causing the slower transaction to abort.
* **The Cause:** Although `SELECT FOR UPDATE` was placed on the `Subscription` table, the check for existing fulfillment occurred before acquiring the row lock, allowing concurrent execution threads to interleave before the lock was held.
* **The Fix:** Two changes were implemented:
  1. In [src/server/payments/fulfillEntitlement.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/fulfillEntitlement.ts), wrapped the transaction execution in a catch block that intercepts Prisma error code `P2002` (unique key constraint failure on `idempotencyKey`) and gracefully resolves it as `{ ok: true, outcome: "ALREADY_FULFILLED" }` instead of throwing an unhandled exception.
  2. In [src/server/payments/handleVerifiedReturn.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/handleVerifiedReturn.ts), added a pre-verification check that queries the session status; if `session.status === "COMPLETED"`, it immediately returns `CONFIRMED` without initiating a redundant verification API call.

---

### 2. Off-By-One Calendar Month and Leap Year Date Drift
* **The Symptom:** In billing lifecycle unit tests, advancing the mock clock by one month from January 31st resulted in renewal dates jumping to March 3rd instead of the final day of February. Furthermore, leap-year calculations (February 29, 2024 to 2025) pushed expiration dates into March, and proration division produced 1-kobo discrepancies where `chargeKobo + creditKobo !== 5000000`.
* **The Investigation:** Checked if PostgreSQL timezone conversion settings (`timestamptz` vs `timestamp`) were skewing hours (irrelevant; all database times were UTC). Examined the calculation in `proration.ts` that added 30 days (`30 * 86400000 ms`) or 365 days to dates. Observed that adding arbitrary fixed milliseconds ignores calendar month lengths (28, 29, 30, or 31 days). In proration math, checked standard JavaScript division `Math.round((yearly * D - lastPaid * U) / D)`, which caused rounding jitter.
* **The Cause:** Fixed millisecond additions cannot represent calendar billing intervals. Adding 30 days to January 31st lands on March 2nd (or 3rd). In proration, standard rounding rounds both charge and credit independently, causing their sum to deviate from the total price by 1 kobo.
* **The Fix:** Implemented clamped UTC calendar helpers in [src/server/payments/proration.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/proration.ts):
  * `addOneMonthClamped(date)`: Adds one calendar month and clamps the target day to the month's maximum days (Jan 31 becomes Feb 28 in standard years or Feb 29 in leap years).
  * `addOneYearClamped(date)`: Adds one calendar year and clamps Feb 29 to Feb 28.
  * In proration math, replaced floating-point operations with pure integer remainder division: `chargeKobo = (numerator - (numerator % totalDays)) / totalDays` and derived credit as `creditKobo = yearly - chargeKobo`, guaranteeing exact kobo balance.

---

### 3. Flutterwave Return URL Omitting `transaction_id` on Browser Redirect
* **The Symptom:** In end-to-end sandbox tests, after a user completed card payment and clicked "Return to Merchant", the application displayed an error message saying "Payment Incomplete: Missing transaction ID", even though the customer's card was charged successfully in the Flutterwave dashboard.
* **The Investigation:** Checked if reverse proxies or Next.js route segment configs were truncating query parameters. Checked Flutterwave API documentation regarding return redirects. Discovered that when customers pay using certain test payment methods, or when they click "Return to merchant" before the provider's redirect countdown finishes, Flutterwave redirects to `http://localhost:3000/billing/return?tx_ref=sub_...&status=successful` without appending the numeric `transaction_id` parameter.
* **The Cause:** `handleVerifiedReturn.ts` originally assumed `transaction_id` was always present in query parameters and immediately attempted to call `verifyTransaction({ transactionId })`. When `transaction_id` was undefined, verification failed immediately.
* **The Fix:** Modified [src/server/payments/handleVerifiedReturn.ts](file:///c:/Users/USER/Desktop/Payment/src/server/payments/handleVerifiedReturn.ts) to handle missing `transaction_id` gracefully:
  * When `transaction_id` is absent, the server queries `db.checkoutSession.findFirst({ where: { txRef } })`.
  * If the webhook already fulfilled the transaction in the background, the session is already `COMPLETED`, and the return handler resolves to `CONFIRMED`.
  * If the session is still `PENDING`, the handler returns a clean `PROCESSING` status advising the user that confirmation is underway and offering a polling recovery path, preventing false failure alarms.

---

## Section 7: What This Slice Does Not Handle

### What Breaks at Scale
1. **PostgreSQL-Based Rate Limiting:** The sliding window rate limiter stores every hit as a row in `RateLimitHit` and executes `count()` and `deleteMany()` queries on Postgres. Under heavy production traffic (e.g., thousands of requests per second), this table will experience high disk write I/O and table bloat, eventually bottlenecking the primary database. Production scale requires an in-memory Redis cluster with sliding window sorted sets.
2. **Synchronous Cron Loop for Renewals:** The renewal job in `/api/cron/lifecycle` queries all due subscriptions and executes token charges sequentially in a single serverless function invocation. If thousands of subscriptions renew on the same day, the function will exceed Vercel's maximum execution timeout. Production scale requires a distributed job queue (such as BullMQ, Inngest, or Temporal) that fans out renewal jobs into discrete worker tasks.
3. **Database Connection Pool Exhaustion:** Running Next.js serverless route handlers that acquire raw SQL row locks (`SELECT ... FOR UPDATE`) can exhaust available PostgreSQL connections under high concurrency. A connection pooler such as PgBouncer or AWS RDS Proxy is necessary in high-traffic deployments.

### What Must Be Added Before Real Users Touch It
1. **User Authentication & Multi-Tenancy:** The slice relies on a single seeded user record (`ada@example.com`). Real-world usage requires secure session management, OAuth/magic-link authentication, and role-based access control.
2. **Customer Receipts & Invoicing:** Real subscribers require downloadable PDF tax invoices and automated transaction receipt emails detailing billing breakdown, VAT/WHT deductions, and card brand identifiers.
3. **Automated Refund Pipeline:** While disputes are surfaced via `scripts/dispute-report.ts`, issuing refunds currently requires manual processing within the Flutterwave dashboard. A production application needs a dedicated admin refund action that calls Flutterwave's refund API and revokes entitlements.
4. **Card Expiration & Failure Notifications:** Customers whose cards are declined or expire receive no automated pre-dunning email reminders before entering `PAST_DUE`. Automated notification webhooks must be integrated.

### Left Out Because Outside the Brief
* **Paywalled Feature Logic:** Intentionally omitted; this slice strictly handles the subscription flag and billing lifecycle.
* **Multi-Currency & FX Conversion:** The project is locked to NGN only.
* **Flutterwave Hosted Payment Plans:** Intentionally omitted in favor of tokenized charges to support custom proration math.

### Left Out Because of Time Constraints
* **Dead-Letter Queue (DLQ) & Alerting Dashboard:** Failed webhook deliveries or transient database crashes during renewal runs are logged to `PaymentLog` as `FAILURE`, but there is no automated alerting system (such as PagerDuty or Slack webhooks) to notify on-call engineers of failed transaction batches.
* **Automated Transaction Reconciliation Worker:** If a webhook fails to deliver and the user closes their browser before reaching the return redirect, the session remains `PENDING` until expired. A background reconciliation worker that queries Flutterwave's transaction list API for orphaned successful charges would resolve these edge cases automatically.

---

## Section 8: If I Built This Again

The single biggest thing I would do differently is architect the payment ingestion layer around an asynchronous transactional outbox and event queue rather than executing provider verification and entitlement fulfillment synchronously inside the Next.js HTTP request-response cycle. While our current implementation handles concurrency cleanly using row locks, branded types, and database-level idempotency constraints, relying on serverless functions to synchronously coordinate third-party HTTP API calls to Flutterwave while holding open database transactions leaves the system vulnerable to serverless function timeouts, gateway latency spikes, and connection pool starvation under heavy burst traffic. Placing incoming webhooks and return redirect notifications into an isolated, durable queue (such as AWS SQS or Redis Streams) with an independent background worker would fully decouple merchant availability from third-party gateway latency, simplify distributed retries with exponential backoff, and make the payment processing pipeline virtually immune to network fluctuations.

