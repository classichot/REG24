-- REG24 Migration 0004: Hard PostgreSQL Storage Ceiling Guard for Neon Launch ($15/mo Budget Protection)
-- Prevents runaway table/WAL growth from pushing monthly logical storage ($0.35/GiB-mo) or 7-day PITR history
-- ($0.20/GiB-mo) past the approved $15/mo trial budget, working alongside Neon per-project API compute/write quotas.

CREATE OR REPLACE FUNCTION reg24_enforce_trial_storage_ceiling()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_bytes BIGINT;
  -- Hard 2.0 GiB ceiling = $0.70/month max storage on Neon Launch ($0.35/GiB-month)
  max_allowed_bytes CONSTANT BIGINT := 2147483648;
BEGIN
  SELECT pg_database_size(current_database()) INTO current_bytes;
  IF current_bytes >= max_allowed_bytes THEN
    RAISE EXCEPTION 'REG24_STORAGE_CAP_EXCEEDED: Database size (% bytes) reached 2.0 GiB trial budget ceiling', current_bytes
      USING ERRCODE = '53100';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trial_audit_storage_cap ON trial_audit_events;
CREATE TRIGGER trg_trial_audit_storage_cap
  BEFORE INSERT OR UPDATE ON trial_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reg24_enforce_trial_storage_ceiling();

DROP TRIGGER IF EXISTS trg_trial_invite_storage_cap ON trial_invite_credentials;
CREATE TRIGGER trg_trial_invite_storage_cap
  BEFORE INSERT OR UPDATE ON trial_invite_credentials
  FOR EACH ROW
  EXECUTE FUNCTION reg24_enforce_trial_storage_ceiling();

DROP TRIGGER IF EXISTS trg_trial_ratelimit_storage_cap ON trial_rate_limit_buckets;
CREATE TRIGGER trg_trial_ratelimit_storage_cap
  BEFORE INSERT OR UPDATE ON trial_rate_limit_buckets
  FOR EACH ROW
  EXECUTE FUNCTION reg24_enforce_trial_storage_ceiling();
