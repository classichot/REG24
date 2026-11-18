-- REG24 Migration 0005: Official-Source Citations and Claim Traceability
-- Implements Sections 2, 3, 4, 5, 6, 7 of "REG24 developer requirements — official-source citations and claim traceability"
-- Enforces referential integrity, explicit unknown dates, immutable versions/revisions, jointly-required
-- claim-evidence support groups, append-only audit events, and Neon 2.0 GiB budget ceiling compatibility.

-- 1. Reviewed Registry of Official Publishers, Permitted Hosts & Source Families (SRC-01)
CREATE TABLE IF NOT EXISTS citation_official_publisher (
  publisher_id             TEXT PRIMARY KEY,
  name_th                  TEXT NOT NULL,
  name_en                  TEXT NOT NULL,
  source_families          JSONB NOT NULL DEFAULT '[]'::jsonb,
  permitted_hosts          JSONB NOT NULL DEFAULT '[]'::jsonb,
  supports_page_anchors    BOOLEAN NOT NULL DEFAULT FALSE,
  supports_html_fragments  BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by              TEXT NOT NULL,
  reviewed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active                   BOOLEAN NOT NULL DEFAULT TRUE
);

-- 2. Official Document (Section 3 Entity 1 + SRC-02 / SRC-03)
CREATE TABLE IF NOT EXISTS citation_official_document (
  doc_id                   TEXT PRIMARY KEY,
  source_family            TEXT NOT NULL CHECK (
    source_family IN (
      'gazette_enactment',
      'supreme_court_decision',
      'council_of_state_opinion',
      'revenue_department_ruling'
    )
  ),
  issuer_id                TEXT NOT NULL REFERENCES citation_official_publisher(publisher_id),
  source_native_id         TEXT,
  reviewed_surrogate_id    TEXT,
  is_reviewed_surrogate    BOOLEAN NOT NULL DEFAULT FALSE,
  original_title_th        TEXT NOT NULL,
  language                 TEXT NOT NULL CHECK (language IN ('th', 'en', 'mixed')),
  record_type              TEXT NOT NULL DEFAULT 'full_record' CHECK (
    record_type IN ('full_record', 'official_summary', 'landing_only', 'third_party_discovery')
  ),
  access_permission        TEXT NOT NULL DEFAULT 'public' CHECK (
    access_permission IN ('public', 'authenticated_internal', 'restricted_tenant', 'restricted_external_official')
  ),
  preservation_permission  TEXT NOT NULL DEFAULT 'retained_artifact_permitted' CHECK (
    preservation_permission IN (
      'version_pinned_official_archive',
      'retained_artifact_permitted',
      'metadata_only_ineligible'
    )
  ),
  access_conditions_th     TEXT,
  eligible_for_citation    BOOLEAN NOT NULL DEFAULT TRUE,
  ineligible_reason        TEXT,
  canonical_work_id        TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_doc_identifier_present CHECK (
    source_native_id IS NOT NULL OR (is_reviewed_surrogate = TRUE AND reviewed_surrogate_id IS NOT NULL)
  ),
  CONSTRAINT chk_third_party_never_eligible CHECK (
    record_type <> 'third_party_discovery' OR eligible_for_citation = FALSE
  ),
  CONSTRAINT chk_metadata_only_never_eligible CHECK (
    preservation_permission <> 'metadata_only_ineligible' OR eligible_for_citation = FALSE
  )
);

-- 3. Document Version (Section 3 Entity 2 — Immutable + Explicit Unknown Dates)
CREATE TABLE IF NOT EXISTS citation_document_version (
  version_id               TEXT PRIMARY KEY,
  doc_id                   TEXT NOT NULL REFERENCES citation_official_document(doc_id),
  artifact_sha256          CHAR(64) NOT NULL,
  captured_at              TIMESTAMPTZ NOT NULL,
  artifact_ref             TEXT NOT NULL,
  mime_type                TEXT NOT NULL,
  byte_size                BIGINT NOT NULL CHECK (byte_size >= 0),
  source_metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  publication_date         DATE,
  publication_date_status  TEXT NOT NULL DEFAULT 'known' CHECK (publication_date_status IN ('known', 'unknown_explicit')),
  effective_from           DATE,
  effective_to             DATE,
  effective_date_status    TEXT NOT NULL DEFAULT 'known' CHECK (
    effective_date_status IN ('known', 'unknown_explicit', 'open_ended', 'transitional_conditional')
  ),
  applicability_rules_th   JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_provisions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  predecessor_version_id   TEXT REFERENCES citation_document_version(version_id),
  amending_version_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  byte_change_classification TEXT NOT NULL DEFAULT 'initial_capture' CHECK (
    byte_change_classification IN (
      'initial_capture',
      'identical_retry_reused',
      'unclassified_byte_change_quarantined',
      'reencode_non_substantive',
      'verified_legal_amendment'
    )
  ),
  canonical_version_id     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_id, artifact_sha256, version_id)
);

-- 4. Official Location (Section 3 Entity 3 + Section 7 Link Health & URL History)
CREATE TABLE IF NOT EXISTS citation_official_location (
  location_id              TEXT PRIMARY KEY,
  doc_id                   TEXT NOT NULL REFERENCES citation_official_document(doc_id),
  version_id               TEXT REFERENCES citation_document_version(version_id),
  exact_official_url       TEXT NOT NULL,
  location_role            TEXT NOT NULL CHECK (
    location_role IN ('primary_official', 'durable_landing_record', 'expiring_direct_asset', 'pinned_official_archive', 'third_party_discovery')
  ),
  parent_landing_location_id TEXT REFERENCES citation_official_location(location_id),
  original_observed_url    TEXT NOT NULL,
  redirect_history         JSONB NOT NULL DEFAULT '[]'::jsonb,
  prior_location_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_verified_at        TIMESTAMPTZ,
  last_verified_at         TIMESTAMPTZ,
  last_successful_verified_at TIMESTAMPTZ,
  verification_method      TEXT NOT NULL,
  identity_match_result    TEXT NOT NULL CHECK (
    identity_match_result IN (
      'VERIFIED_MATCH',
      'FAILED_LOGIN_WALL',
      'FAILED_HOMEPAGE_OR_SEARCH',
      'FAILED_SOFT_404',
      'FAILED_UNRELATED_DOCUMENT',
      'FAILED_UNTRUSTED_HOST',
      'PENDING_VERIFICATION'
    )
  ),
  link_health              TEXT NOT NULL DEFAULT 'verified_online' CHECK (
    link_health IN ('verified_online', 'temporarily_offline', 'moved_verified', 'quarantined_identity_failure')
  ),
  last_http_status         INTEGER,
  failure_reason           TEXT,
  is_active_primary        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Extraction Revision (Section 3 Entity 4 — Immutable; OCR Corrections Create New Revisions)
CREATE TABLE IF NOT EXISTS citation_extraction_revision (
  extraction_revision_id   TEXT PRIMARY KEY,
  version_id               TEXT NOT NULL REFERENCES citation_document_version(version_id),
  parent_revision_id       TEXT REFERENCES citation_extraction_revision(extraction_revision_id),
  parser_or_ocr_version    TEXT NOT NULL,
  is_scanned_material      BOOLEAN NOT NULL DEFAULT FALSE,
  page_mapping             JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_transcription        TEXT NOT NULL,
  normalized_search_text   TEXT NOT NULL,
  alignment_map            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ocr_ambiguity_detected   BOOLEAN NOT NULL DEFAULT FALSE,
  ocr_ambiguity_reasons    JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_status            TEXT NOT NULL DEFAULT 'VERIFIED_NATIVE' CHECK (
    review_status IN ('VERIFIED_NATIVE', 'AWAITING_THAI_REVIEW', 'REVIEWED_APPROVED', 'REVIEWED_CORRECTED', 'QUARANTINED')
  ),
  reviewer_id              TEXT,
  reviewed_at              TIMESTAMPTZ,
  correction_note          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Evidence Passage (Section 3 Entity 5 — Stable Opaque ID + >=1 Replayable Locator)
CREATE TABLE IF NOT EXISTS citation_evidence_passage (
  passage_id               TEXT PRIMARY KEY,
  extraction_revision_id   TEXT NOT NULL REFERENCES citation_extraction_revision(extraction_revision_id),
  version_id               TEXT NOT NULL REFERENCES citation_document_version(version_id),
  doc_id                   TEXT NOT NULL REFERENCES citation_official_document(doc_id),
  verbatim_text            TEXT NOT NULL,
  text_sha256              CHAR(64) NOT NULL,
  surrounding_before       TEXT NOT NULL DEFAULT '',
  surrounding_after        TEXT NOT NULL DEFAULT '',
  section_paragraph_path   JSONB NOT NULL DEFAULT '[]'::jsonb,
  statement_role           TEXT NOT NULL,
  physical_page_start      INTEGER CHECK (physical_page_start IS NULL OR physical_page_start >= 1),
  physical_page_end        INTEGER CHECK (physical_page_end IS NULL OR physical_page_end >= physical_page_start),
  printed_page_start       TEXT,
  printed_page_end         TEXT,
  anchors                  JSONB NOT NULL,
  human_pinpoint_th        TEXT NOT NULL,
  locator_replay_status    TEXT NOT NULL CHECK (locator_replay_status IN ('VERIFIED', 'QUARANTINED')),
  quarantine_reason        TEXT,
  eligible_for_publication BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_anchors_non_empty CHECK (jsonb_typeof(anchors) = 'array' AND jsonb_array_length(anchors) >= 1),
  CONSTRAINT chk_quarantined_passage_not_eligible CHECK (
    locator_replay_status = 'VERIFIED' OR eligible_for_publication = FALSE
  )
);

-- 7. Legal Proposition or Graph Assertion (Section 3 Entity 6 + RET-02)
CREATE TABLE IF NOT EXISTS citation_graph_assertion (
  assertion_id             TEXT PRIMARY KEY,
  subject_id               TEXT NOT NULL,
  predicate                TEXT NOT NULL,
  object_id                TEXT NOT NULL,
  proposition_text_th      TEXT NOT NULL,
  applicability            JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_passage_ids     JSONB NOT NULL,
  relation_to_evidence     TEXT NOT NULL CHECK (
    relation_to_evidence IN ('substantive_support', 'navigation_only', 'similarity_only')
  ),
  verification_state       TEXT NOT NULL CHECK (
    verification_state IN ('VERIFIED', 'PROPOSED', 'QUARANTINED', 'WITHDRAWN')
  ),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_substantive_edge_has_evidence CHECK (
    relation_to_evidence <> 'substantive_support'
    OR (jsonb_typeof(evidence_passage_ids) = 'array' AND jsonb_array_length(evidence_passage_ids) >= 1)
  )
);

-- 8. Answer & Atomic Claim (Section 3 Entity 7 — Immutable Answer Revision + Separate As-Of vs Generated Time)
CREATE TABLE IF NOT EXISTS citation_published_answer (
  answer_revision_id       TEXT PRIMARY KEY,
  answer_id                TEXT NOT NULL,
  revision_number          INTEGER NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  supersedes_revision_id   TEXT REFERENCES citation_published_answer(answer_revision_id),
  channel                  TEXT NOT NULL CHECK (
    channel IN ('chat', 'research', 'report', 'saved_answer', 'export', 'api', 'mcp')
  ),
  question_text            TEXT NOT NULL,
  generated_at             TIMESTAMPTZ NOT NULL,
  as_of_date               DATE,
  as_of_date_raw           TEXT,
  status                   TEXT NOT NULL CHECK (
    status IN ('complete', 'partial', 'insufficient', 'legacy_unverified')
  ),
  rendered_answer_th       TEXT NOT NULL,
  ordered_claim_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  unresolved_issues        JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_supplied_facts      JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions              JSONB NOT NULL DEFAULT '[]'::jsonb,
  legacy_warning_th        TEXT,
  release_id               TEXT NOT NULL,
  verifier_version         TEXT NOT NULL,
  ruleset_version          TEXT NOT NULL,
  actor_id                 TEXT NOT NULL,
  tenant_id                TEXT NOT NULL DEFAULT 'PUBLIC',
  UNIQUE (answer_id, revision_number)
);

CREATE TABLE IF NOT EXISTS citation_atomic_claim (
  claim_id                 TEXT PRIMARY KEY,
  answer_revision_id       TEXT NOT NULL REFERENCES citation_published_answer(answer_revision_id) ON DELETE RESTRICT,
  display_order            INTEGER NOT NULL CHECK (display_order >= 1),
  displayed_claim_text     TEXT NOT NULL,
  claim_type               TEXT NOT NULL CHECK (
    claim_type IN (
      'legal_proposition',
      'interpretation',
      'user_fact_or_assumption',
      'scoped_unresolved_notice'
    )
  ),
  premise_claim_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_decision    TEXT NOT NULL CHECK (
    verification_decision IN ('supported', 'insufficient', 'conflicting', 'needs_review', 'legacy_unverified')
  ),
  published                BOOLEAN NOT NULL,
  withheld_reason_th       TEXT,
  human_approved_by        TEXT,
  human_approval_audit_id  TEXT,
  UNIQUE (answer_revision_id, display_order)
);

-- 9. Claim–Evidence Link (Section 3 Entity 8 — Persist Every Member of a Jointly Required Group)
CREATE TABLE IF NOT EXISTS citation_claim_evidence_link (
  link_id                  TEXT PRIMARY KEY,
  answer_revision_id       TEXT NOT NULL REFERENCES citation_published_answer(answer_revision_id) ON DELETE RESTRICT,
  claim_id                 TEXT NOT NULL REFERENCES citation_atomic_claim(claim_id) ON DELETE RESTRICT,
  passage_id               TEXT NOT NULL REFERENCES citation_evidence_passage(passage_id) ON DELETE RESTRICT,
  version_id               TEXT NOT NULL REFERENCES citation_document_version(version_id) ON DELETE RESTRICT,
  support_role             TEXT NOT NULL CHECK (
    support_role IN (
      'primary_authority',
      'statutory_premise',
      'ruling_application',
      'judicial_reasoning',
      'exception_or_proviso',
      'transitional_applicability',
      'requester_factual_context',
      'official_summary_scope'
    )
  ),
  required_group           TEXT NOT NULL,
  citation_label_th        TEXT NOT NULL,
  official_url             TEXT NOT NULL,
  resolver_url             TEXT NOT NULL,
  human_pinpoint_th        TEXT NOT NULL,
  deterministic_check      TEXT NOT NULL CHECK (deterministic_check IN ('PASS', 'FAIL')),
  substantive_check        TEXT NOT NULL CHECK (
    substantive_check IN ('supported', 'insufficient', 'conflicting', 'needs_review')
  ),
  verifier_or_reviewer_id  TEXT NOT NULL,
  ruleset_version          TEXT NOT NULL,
  verified_at              TIMESTAMPTZ NOT NULL,
  UNIQUE (claim_id, passage_id, support_role, required_group)
);

-- 10. Append-Only Audit Event & Reconciliation Tasks + Projection Outbox (Section 3 Entity 9 & SRC-02)
CREATE TABLE IF NOT EXISTS citation_audit_event (
  audit_id                 TEXT PRIMARY KEY,
  actor_or_service         TEXT NOT NULL,
  recorded_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type               TEXT NOT NULL,
  affected_ids             JSONB NOT NULL DEFAULT '[]'::jsonb,
  before_status            JSONB,
  after_status             JSONB,
  reason                   TEXT NOT NULL,
  correlation_id           TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION reg24_prevent_citation_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CITATION_AUDIT_IMMUTABLE: citation_audit_event is append-only; UPDATE and DELETE are prohibited';
END;
$$;

DROP TRIGGER IF EXISTS trg_citation_audit_append_only ON citation_audit_event;
CREATE TRIGGER trg_citation_audit_append_only
  BEFORE UPDATE OR DELETE ON citation_audit_event
  FOR EACH ROW
  EXECUTE FUNCTION reg24_prevent_citation_audit_mutation();

CREATE TABLE IF NOT EXISTS citation_reconciliation_task (
  task_id                  TEXT PRIMARY KEY,
  discovery_doc_id         TEXT NOT NULL REFERENCES citation_official_document(doc_id),
  observed_url             TEXT NOT NULL,
  target_hint              TEXT NOT NULL,
  reason                   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RECONCILED', 'REJECTED')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at              TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS citation_projection_outbox (
  outbox_id                TEXT PRIMARY KEY,
  target_store             TEXT NOT NULL CHECK (target_store IN ('lexical', 'vector', 'graph')),
  entity_kind              TEXT NOT NULL CHECK (entity_kind IN ('passage', 'assertion', 'answer')),
  entity_id                TEXT NOT NULL,
  payload                  JSONB NOT NULL,
  attempt_count            INTEGER NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'RETRYABLE_FAILED')),
  last_error               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_citation_passage_doc_ver ON citation_evidence_passage (doc_id, version_id);
CREATE INDEX IF NOT EXISTS idx_citation_location_doc_ver ON citation_official_location (doc_id, version_id);
CREATE INDEX IF NOT EXISTS idx_citation_claims_answer ON citation_atomic_claim (answer_revision_id, display_order);
CREATE INDEX IF NOT EXISTS idx_citation_links_claim ON citation_claim_evidence_link (claim_id);
CREATE INDEX IF NOT EXISTS idx_citation_outbox_pending ON citation_projection_outbox (status, created_at);

-- Attach Neon 2.0 GiB storage ceiling guard if defined in Migration 0004
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reg24_enforce_trial_storage_ceiling') THEN
    DROP TRIGGER IF EXISTS trg_citation_answer_storage_cap ON citation_published_answer;
    CREATE TRIGGER trg_citation_answer_storage_cap
      BEFORE INSERT OR UPDATE ON citation_published_answer
      FOR EACH ROW EXECUTE FUNCTION reg24_enforce_trial_storage_ceiling();

    DROP TRIGGER IF EXISTS trg_citation_audit_storage_cap ON citation_audit_event;
    CREATE TRIGGER trg_citation_audit_storage_cap
      BEFORE INSERT ON citation_audit_event
      FOR EACH ROW EXECUTE FUNCTION reg24_enforce_trial_storage_ceiling();
  END IF;
END
$$;
