-- Hand-written SQL migration per PRD §10, Rule P-16:
-- Trigger that rejects UPDATE and DELETE on PaymentLog, ensuring append-only behavior.

CREATE OR REPLACE FUNCTION prevent_payment_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PaymentLog is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_log_immutable ON "PaymentLog";

CREATE TRIGGER trg_payment_log_immutable
BEFORE UPDATE OR DELETE ON "PaymentLog"
FOR EACH ROW
EXECUTE FUNCTION prevent_payment_log_mutation();
