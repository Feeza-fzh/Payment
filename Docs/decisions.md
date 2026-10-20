# Decisions Log

## Open Question Resolutions

Recorded: 2026-10-20

### Open Question 3 — Renewals approach
**Decision:** Tokenized charges from our own scheduler (PRD recommended default).
Payment plans cannot take a custom prorated first charge and cannot change mid-cycle without cancelling and recreating.

### Open Question 9 — Flutterwave API version
**Decision:** Use the version Flutterwave's current docs recommend for new integrations (PRD recommended default).

### Open Question 10 — Vercel plan
**Decision:** Hobby plan, with a daily cron and the `effectivePlan()` guard (PRD recommended default).

### Open Question 11 — Storing encrypted provider card token
**Decision:** Yes, accept storing an encrypted provider card token.
Required for tokenized renewals (Q3). Token encrypted at rest with `TOKEN_ENCRYPTION_KEY`, never logged, never sent to client.

---

## Open Questions Using PRD Defaults (not blocked)

| # | Question | Default used |
|---|---|---|
| 1 | Currencies | NGN only |
| 2 | Manual refund path | No. Log and dispute report support manual handling. |
| 4 | Grace window | 3 days, starting at period end |
| 5 | Redis for rate limiting | No. Use Postgres. |
| 6 | AI Processing Pipeline heading | Keep, as the payment event pipeline |
| 7 | Public webhook URL in dev | Tunnel if needed |
| 8 | Prices | Placeholders: 500,000 (monthly) and 5,000,000 (yearly) kobo |
| 12 | Duplicate payment refunds | Manual, in Flutterwave dashboard, using dispute report |
