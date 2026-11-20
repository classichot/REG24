-- REG24 Batch 1 RC9.1 Smallest Durable Fix Migration (`0006`)
-- 1. Align `citation_official_location.link_health` CHECK constraint with `OfficialLinkHealthStatus`
--    in `src/core/knowledge/citation-contracts.ts` so honest unprobed citations (`unchecked_live`)
--    persist cleanly to Neon PostgreSQL without SQLSTATE 23514 failures.
-- 2. Add nullable `execution_provenance` JSONB on `citation_published_answer` and
--    `bound_calculation` JSONB on `citation_atomic_claim` so reopening a saved revision across
--    cold starts / fresh tabs preserves exact live model execution metadata (PF-04) and
--    per-claim verified calculations (RC9-K1) without regeneration or cross-claim pooling.

ALTER TABLE citation_official_location
  DROP CONSTRAINT IF EXISTS citation_official_location_link_health_check;

ALTER TABLE citation_official_location
  ALTER COLUMN link_health SET DEFAULT 'unchecked_live';

ALTER TABLE citation_official_location
  ADD CONSTRAINT citation_official_location_link_health_check CHECK (
    link_health IN (
      'verified_online',
      'unchecked_live',
      'temporarily_offline',
      'moved_verified',
      'quarantined_identity_failure'
    )
  );

ALTER TABLE citation_published_answer
  ADD COLUMN IF NOT EXISTS execution_provenance JSONB;

ALTER TABLE citation_atomic_claim
  ADD COLUMN IF NOT EXISTS bound_calculation JSONB;
