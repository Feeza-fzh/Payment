-- Hand-written SQL migration per PRD §10:
-- Two database roles:
-- 1. subslice_owner (migration role): owns the schema and all tables.
-- 2. subslice_app (app role): runtime connection. Has no UPDATE or DELETE on PaymentLog.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'subslice_owner') THEN
    CREATE ROLE subslice_owner WITH LOGIN PASSWORD 'password';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'subslice_app') THEN
    CREATE ROLE subslice_app WITH LOGIN PASSWORD 'password';
  END IF;
END $$;

-- Grant schema usage
GRANT USAGE, CREATE ON SCHEMA public TO subslice_owner;
GRANT USAGE ON SCHEMA public TO subslice_app;

-- Grant table permissions to subslice_owner
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO subslice_owner;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO subslice_owner;

-- Grant app role permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "User", "Subscription", "CheckoutSession", "SubscriptionEvent", "RateLimitHit" TO subslice_app;
GRANT SELECT ON TABLE "Plan" TO subslice_app;

-- Rule P-16, Section 10: App role has ONLY SELECT and INSERT on PaymentLog (no UPDATE, no DELETE)
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "PaymentLog" FROM subslice_app;
GRANT SELECT, INSERT ON TABLE "PaymentLog" TO subslice_app;
