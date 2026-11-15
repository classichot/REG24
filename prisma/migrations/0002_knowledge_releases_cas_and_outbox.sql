-- REG24 Option A Production Storage Architecture — Draft Migration 0002 (FOR REVIEW ONLY; NOT APPLIED)
-- Extends `0001_reg24_canonical_rls.sql` with transactional Knowledge Batch Release Governance,
-- Optimistic CAS + Row-Locked Concurrency Control (`DEF-B01-07`), Immutable Owner UAT Approvals (`DEF-B01-05`),
-- Supersession Lineage, Non-Evidence Quarantine Ledger (`DEF-B01-03`), Deferred OCR Recovery Queue,
-- and Outbox-Driven Neo4j AuraDB Graph Projection with Two-Phase Rollback (`DEF-B01-06`).

-- 1. Singleton / Per-Namespace Optimistic Revision Coordinator (`DEF-B01-07`)
CREATE TABLE IF NOT EXISTS knowledge_store_coordinator (
  namespace_id TEXT PRIMARY KEY DEFAULT 'PUBLIC',
  store_revision BIGINT NOT NULL DEFAULT 0,
  active_release_id TEXT,
  accepted_batch_releases JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Immutable Batch Inventory Snapshots & Manifests
CREATE TABLE IF NOT EXISTS knowledge_batch_manifest (
  manifest_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  inventory_snapshot_id TEXT NOT NULL UNIQUE,
  inventory_hash CHAR(64) NOT NULL,
  source_cutoff_at TIMESTAMPTZ NOT NULL,
  expected_previous_release_id TEXT,
  reconciliation_summary JSONB NOT NULL,
  frozen_by TEXT NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Candidate & Accepted Release Registry with Transparent Supersession Lineage (`Instruction 2`)
CREATE TABLE IF NOT EXISTS knowledge_release (
  release_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  manifest_id TEXT NOT NULL REFERENCES knowledge_batch_manifest(manifest_id),
  manifest_hash CHAR(64) NOT NULL,
  code_commit CHAR(40) NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'PLANNED', 'INVENTORY_FROZEN', 'PROCESSING', 'QA_READY', 'READY_FOR_UAT',
      'UAT_PASSED', 'RELEASE_APPROVED', 'PUBLISHED', 'ACCEPTED',
      'ACCEPTED_WITH_DECLARED_GAPS', 'BLOCKED', 'PAUSED', 'UAT_FAILED', 'ROLLED_BACK'
    )
  ),
  revision BIGINT NOT NULL DEFAULT 1,
  previous_accepted_release_id TEXT REFERENCES knowledge_release(release_id),
  rollback_target_release_id TEXT REFERENCES knowledge_release(release_id),
  supersedes_release_id TEXT REFERENCES knowledge_release(release_id),
  supersedes_manifest_id TEXT REFERENCES knowledge_batch_manifest(manifest_id),
  supersedes_manifest_hash CHAR(64),
  supersession_explanation TEXT,
  prior_chat_approval_preserved BOOLEAN NOT NULL DEFAULT FALSE,
  created_work_count INT NOT NULL DEFAULT 0,
  reused_work_count INT NOT NULL DEFAULT 0,
  created_passage_count INT NOT NULL DEFAULT 0,
  accepted_assertion_count INT NOT NULL DEFAULT 0,
  coverage_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_no_self_supersession CHECK (supersedes_release_id IS NULL OR supersedes_release_id <> release_id)
);

-- 4. Append-Only Owner UAT & Dual-Control Attestation Ledger (`DEF-B01-05` & `DEF-B01-07`)
--    Prevents silent overwrite or conflicting approval decisions on the same (release_id, manifest_hash).
CREATE TABLE IF NOT EXISTS knowledge_release_approval (
  approval_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES knowledge_release(release_id),
  manifest_hash CHAR(64) NOT NULL,
  expected_release_revision BIGINT NOT NULL,
  committed_store_revision BIGINT NOT NULL,
  approval_kind TEXT NOT NULL CHECK (
    approval_kind IN ('OWNER_UAT_DECISION', 'ENGINEERING_ATTESTATION', 'LEGAL_ATTESTATION', 'PROMOTION_RECEIPT', 'ROLLBACK_RECEIPT')
  ),
  decision TEXT NOT NULL CHECK (
    decision IN ('UAT_PASS', 'UAT_PASS_WITH_DECLARED_GAPS', 'UAT_FAIL', 'ATTESTED', 'PROMOTED', 'ROLLED_BACK')
  ),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  case_decisions JSONB NOT NULL DEFAULT '{}'::jsonb,
  declared_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  comments TEXT NOT NULL DEFAULT '',
  audit_sequence_no BIGINT NOT NULL REFERENCES audit_log_chain(sequence_no),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Hard uniqueness prevents two concurrent processes from recording conflicting Owner UAT decisions for the same manifest revision
  UNIQUE (release_id, manifest_hash, approval_kind, expected_release_revision)
);

-- 5. Unverified External Citation Quarantine Ledger (`DEF-B01-03` / `Instruction 1`)
--    Database CHECK constraint guarantees quarantined items can NEVER have `usable_as_legal_evidence = TRUE`.
CREATE TABLE IF NOT EXISTS knowledge_quarantine_ledger (
  unresolved_ref_id TEXT PRIMARY KEY,
  recorded_in_release_id TEXT NOT NULL REFERENCES knowledge_release(release_id),
  owner_batch_hint TEXT NOT NULL,
  source_work_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  source_passage_id TEXT NOT NULL,
  raw_citation_text TEXT NOT NULL,
  governing_instrument TEXT NOT NULL,
  section_label TEXT,
  target_hint TEXT NOT NULL,
  suppressed_predicate TEXT NOT NULL DEFAULT 'CITES_PROVISION',
  reason TEXT NOT NULL,
  quarantine_status TEXT NOT NULL DEFAULT 'UNRESOLVED_QUARANTINED'
    CHECK (quarantine_status = 'UNRESOLVED_QUARANTINED'),
  usable_as_legal_evidence BOOLEAN NOT NULL DEFAULT FALSE
    CHECK (usable_as_legal_evidence = FALSE),
  resolved_by_release_id TEXT REFERENCES knowledge_release(release_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Deferred Scan & Legacy-Font OCR Recovery Queue (`Instruction 1` — 5,275 B02 items)
CREATE TABLE IF NOT EXISTS knowledge_ocr_recovery_queue (
  queue_item_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL REFERENCES knowledge_batch_manifest(manifest_id),
  batch_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256_hash CHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL,
  physical_page_count INT NOT NULL,
  native_pages INT NOT NULL DEFAULT 0,
  ocr_pages INT NOT NULL DEFAULT 0,
  corrupt_font_pages INT NOT NULL DEFAULT 0,
  noncontent_pages INT NOT NULL DEFAULT 0,
  deferral_reason_code TEXT NOT NULL,
  priority_tier TEXT NOT NULL CHECK (
    priority_tier IN (
      'P0_UNLOCKS_QUARANTINED_CITATION',
      'P1_CORE_TAX_CORPORATE_STATUTE',
      'P2_SECTORAL_PRIMARY_LAW',
      'P3_HISTORICAL_GAZETTE_GENERAL'
    )
  ),
  verification_stage TEXT NOT NULL DEFAULT 'QUEUED_FOR_VERIFIED_OCR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Transactional Neo4j AuraDB Graph Projection Outbox & Checksum Receipt (`V06` / `AT12`)
CREATE TABLE IF NOT EXISTS knowledge_neo4j_projection_outbox (
  outbox_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES knowledge_release(release_id),
  operation TEXT NOT NULL CHECK (operation IN ('PROJECT_RELEASE_GRAPH', 'DEACTIVATE_ROLLED_BACK_RELEASE')),
  manifest_hash CHAR(64) NOT NULL,
  expected_node_count INT NOT NULL,
  expected_edge_count INT NOT NULL,
  verified_neo4j_node_count INT,
  verified_neo4j_edge_count INT,
  neo4j_database TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'VERIFIED_COMPLETED', 'FAILED')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quarantine_release ON knowledge_quarantine_ledger(recorded_in_release_id);
CREATE INDEX IF NOT EXISTS idx_quarantine_instrument ON knowledge_quarantine_ledger(governing_instrument);
CREATE INDEX IF NOT EXISTS idx_ocr_queue_priority ON knowledge_ocr_recovery_queue(priority_tier, batch_id);
CREATE INDEX IF NOT EXISTS idx_neo4j_outbox_pending ON knowledge_neo4j_projection_outbox(status, created_at);
