-- REG24 Batch 1 RC10.3 P0-2 Migration (`0007`)
-- 1. Add stable `save_operation_key` and `save_payload_sha256` columns on `citation_published_answer`
--    so repeating a save operation (lost response, network retry, or concurrent retry) returns the
--    exact same revision without creating a duplicate revision or re-invoking the model, while
--    reusing the same key with different content fails clearly with HTTP 409.
-- 2. Back `save_operation_key` with a real PostgreSQL partial unique index scoped to
--    `(owner_actor_id, owner_tenant_id, answer_id, save_operation_key)`.

ALTER TABLE citation_published_answer
  ADD COLUMN IF NOT EXISTS save_operation_key TEXT;

ALTER TABLE citation_published_answer
  ADD COLUMN IF NOT EXISTS save_payload_sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_published_answer_save_op_unique
  ON citation_published_answer (owner_actor_id, owner_tenant_id, answer_id, save_operation_key)
  WHERE save_operation_key IS NOT NULL;
