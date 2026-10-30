-- REG24 Infrastructure Developer Requirements v1.0 (30 October 2026)
-- Canonical System of Record DDL (ARC08, DATA01-DATA05) + Row-Level Security (SEC05)

-- Create non-owner runtime role so RLS is strictly enforced (SEC05)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reg24_app_runtime') THEN
    CREATE ROLE reg24_app_runtime NOINHERIT LOGIN;
  END IF;
END
$$;

-- 1. LegalSource (DATA01)
CREATE TABLE IF NOT EXISTS legal_source (
  source_id TEXT PRIMARY KEY,
  jurisdiction_code TEXT NOT NULL,
  source_type TEXT NOT NULL,
  authority_tier TEXT NOT NULL,
  issuing_authority TEXT NOT NULL,
  official_identifier TEXT NOT NULL,
  title_th TEXT NOT NULL,
  title_en TEXT,
  official_url TEXT NOT NULL,
  license_policy_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SourceAcquisitionArtifact (DATA01 / ING02)
CREATE TABLE IF NOT EXISTS source_acquisition_artifact (
  artifact_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES legal_source(source_id),
  immutable_object_uri TEXT NOT NULL,
  sha256_hash CHAR(64) NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  parser_version TEXT NOT NULL,
  ocr_confidence NUMERIC(5,4) NOT NULL
);

-- 3. Provision (DATA01)
CREATE TABLE IF NOT EXISTS provision (
  provision_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES legal_source(source_id),
  jurisdiction_code TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  section_number TEXT NOT NULL,
  heading_th TEXT NOT NULL,
  heading_en TEXT
);

-- 4. ProvisionVersion (DATA01 / TIME01-TIME06 Bitemporal)
CREATE TABLE IF NOT EXISTS provision_version (
  provision_version_id TEXT PRIMARY KEY,
  provision_id TEXT NOT NULL REFERENCES provision(provision_id),
  version_number INT NOT NULL,
  verbatim_text_th TEXT NOT NULL,
  english_working_translation TEXT,
  source_sha256 CHAR(64) NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES source_acquisition_artifact(artifact_id),
  published_date DATE,
  effective_from DATE,
  effective_to DATE,
  repealed_date DATE,
  superseded_by_version_id TEXT,
  known_from TIMESTAMPTZ NOT NULL,
  known_to TIMESTAMPTZ,
  transitional_notes TEXT
);

-- 5. AmendmentEvent (DATA01)
CREATE TABLE IF NOT EXISTS amendment_event (
  amendment_event_id TEXT PRIMARY KEY,
  amending_source_id TEXT NOT NULL REFERENCES legal_source(source_id),
  target_provision_id TEXT NOT NULL REFERENCES provision(provision_id),
  prior_version_id TEXT,
  new_version_id TEXT NOT NULL REFERENCES provision_version(provision_version_id),
  gazette_published_date DATE NOT NULL,
  effective_from DATE NOT NULL,
  known_from TIMESTAMPTZ NOT NULL,
  summary_th TEXT NOT NULL,
  summary_en TEXT NOT NULL
);

-- 6. JudicialDecision (DATA01)
CREATE TABLE IF NOT EXISTS judicial_decision (
  decision_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES legal_source(source_id),
  court_name TEXT NOT NULL,
  decision_number TEXT NOT NULL,
  decision_date DATE,
  issues_summary_th TEXT NOT NULL,
  holding_verbatim_th TEXT NOT NULL,
  cited_provision_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  authority_tier TEXT NOT NULL,
  source_sha256 CHAR(64) NOT NULL
);

-- 7. AdministrativeRuling (DATA01)
CREATE TABLE IF NOT EXISTS administrative_ruling (
  ruling_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES legal_source(source_id),
  issuing_agency TEXT NOT NULL,
  ruling_number TEXT NOT NULL,
  ruling_date DATE,
  inquiry_facts_th TEXT NOT NULL,
  ruling_conclusion_th TEXT NOT NULL,
  cited_provision_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  authority_tier TEXT NOT NULL DEFAULT 'persuasive_administrative',
  fact_specific_non_binding BOOLEAN NOT NULL DEFAULT TRUE,
  source_sha256 CHAR(64) NOT NULL
);

-- 8. LegalRelationship (DATA01 / DATA02)
CREATE TABLE IF NOT EXISTS legal_relationship (
  relationship_id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  evidence_span TEXT NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  effective_from DATE,
  effective_to DATE,
  known_from TIMESTAMPTZ NOT NULL,
  known_to TIMESTAMPTZ,
  extraction_method TEXT NOT NULL,
  review_state TEXT NOT NULL
);

-- 9. ObligationRule (DATA01 / INTEL06)
CREATE TABLE IF NOT EXISTS obligation_rule (
  rule_id TEXT PRIMARY KEY,
  jurisdiction_code TEXT NOT NULL,
  domain TEXT NOT NULL,
  title_th TEXT NOT NULL,
  title_en TEXT NOT NULL,
  governing_provision_version_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_status TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  required_fact_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  penalty_summary_th TEXT NOT NULL,
  deadline_rule_id TEXT
);

-- 10. CorpusSnapshot (DATA01 / ING06-ING07)
CREATE TABLE IF NOT EXISTS corpus_snapshot (
  corpus_snapshot_id TEXT PRIMARY KEY,
  jurisdiction_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoted_at TIMESTAMPTZ,
  previous_snapshot_id TEXT,
  provision_version_count INT NOT NULL,
  relationship_count INT NOT NULL,
  embedding_generation_id TEXT NOT NULL,
  graph_projection_id TEXT NOT NULL,
  manifest_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL
);

-- 11. Matter (DATA01 / SEC03-SEC05 Tenant & Ethical Wall Scoped)
CREATE TABLE IF NOT EXISTS matter (
  matter_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  jurisdiction_code TEXT NOT NULL,
  ethical_wall_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_principal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  denied_principal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  pinned_corpus_snapshot_id TEXT NOT NULL REFERENCES corpus_snapshot(corpus_snapshot_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. DeliverableEvidenceManifest (DATA01 / TRUST02)
CREATE TABLE IF NOT EXISTS deliverable_evidence_manifest (
  evidence_manifest_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  matter_id TEXT,
  deliverable_id TEXT NOT NULL,
  corpus_snapshot_id TEXT NOT NULL REFERENCES corpus_snapshot(corpus_snapshot_id),
  legal_as_of DATE NOT NULL,
  known_as_of DATE NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  verification_dimensions JSONB NOT NULL,
  citations JSONB NOT NULL,
  approval_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidated_by_source_withdrawal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Durable Missions (EXEC01-EXEC04)
CREATE TABLE IF NOT EXISTS durable_mission (
  mission_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  matter_id TEXT,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL,
  beast_mode TEXT NOT NULL,
  pinned_corpus_snapshot_id TEXT NOT NULL,
  latest_detected_snapshot_id TEXT NOT NULL,
  snapshot_changed_alert BOOLEAN NOT NULL DEFAULT FALSE,
  legal_as_of DATE NOT NULL,
  known_as_of DATE NOT NULL,
  checkpoint_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
);

-- Transactional Event Outbox (EVT01-EVT07)
CREATE TABLE IF NOT EXISTS event_outbox (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  matter_id TEXT,
  resource_id TEXT NOT NULL,
  sequence_number BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  dispatched BOOLEAN NOT NULL DEFAULT FALSE
);

-- Tamper-Evident Audit Hash Chain (TRUST08)
CREATE TABLE IF NOT EXISTS audit_log_chain (
  audit_id TEXT PRIMARY KEY,
  sequence_no BIGINT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_json TEXT NOT NULL,
  prev_hash CHAR(64) NOT NULL,
  entry_hash CHAR(64) NOT NULL
);

-- Enable & Force Row-Level Security on all tenant-scoped tables (SEC05)
ALTER TABLE matter ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter FORCE ROW LEVEL SECURITY;

ALTER TABLE deliverable_evidence_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverable_evidence_manifest FORCE ROW LEVEL SECURITY;

ALTER TABLE durable_mission ENABLE ROW LEVEL SECURITY;
ALTER TABLE durable_mission FORCE ROW LEVEL SECURITY;

ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outbox FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_log_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_chain FORCE ROW LEVEL SECURITY;

-- Tenant + Ethical Wall RLS Policies (SEC03 / SEC05)
DROP POLICY IF EXISTS matter_tenant_isolation ON matter;
CREATE POLICY matter_tenant_isolation ON matter
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    AND workspace_id = current_setting('app.current_workspace_id', true)
    AND (
      NOT ethical_wall_restricted
      OR (
        allowed_principal_ids ? current_setting('app.current_principal_id', true)
        AND NOT (denied_principal_ids ? current_setting('app.current_principal_id', true))
      )
    )
  );

DROP POLICY IF EXISTS evidence_manifest_tenant_isolation ON deliverable_evidence_manifest;
CREATE POLICY evidence_manifest_tenant_isolation ON deliverable_evidence_manifest
  USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS durable_mission_tenant_isolation ON durable_mission;
CREATE POLICY durable_mission_tenant_isolation ON durable_mission
  USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS event_outbox_tenant_isolation ON event_outbox;
CREATE POLICY event_outbox_tenant_isolation ON event_outbox
  USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log_chain;
CREATE POLICY audit_log_tenant_isolation ON audit_log_chain
  USING (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO reg24_app_runtime;
