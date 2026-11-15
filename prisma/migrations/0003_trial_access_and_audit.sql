-- REG24 Migration 0003: Protected Invite-Only Trial Credentials, Rate-Limit Ledger & Query/Citation Audit Log
-- Supports isolated `staging` and `trial` database branches/schemas on Managed PostgreSQL (Option A).

CREATE TABLE IF NOT EXISTS trial_invite_credentials (
  invite_id           TEXT PRIMARY KEY,
  token_sha256        CHAR(64) NOT NULL UNIQUE,
  assigned_email      TEXT NOT NULL,
  organization_id     TEXT NOT NULL DEFAULT 'PUBLIC_TRIAL',
  environment_scope   TEXT NOT NULL CHECK (environment_scope IN ('staging', 'trial')),
  query_limit_15m     INTEGER NOT NULL DEFAULT 30 CHECK (query_limit_15m > 0),
  evidence_limit_15m  INTEGER NOT NULL DEFAULT 120 CHECK (evidence_limit_15m > 0),
  revoked_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trial_audit_events (
  audit_id                 TEXT PRIMARY KEY,
  event_type               TEXT NOT NULL CHECK (event_type IN ('TRIAL_QUERY', 'TRIAL_CITATION_OPEN')),
  environment_scope        TEXT NOT NULL DEFAULT 'trial' CHECK (environment_scope IN ('staging', 'trial')),
  recorded_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id                 TEXT NOT NULL,
  actor_role               TEXT NOT NULL,
  invite_fingerprint       TEXT,
  release_id               TEXT,
  manifest_hash            CHAR(64),
  trace_id                 TEXT,
  question_sha256          CHAR(64),
  question_text            TEXT,
  applicable_date          TEXT,
  mode                     TEXT,
  answer_status            TEXT,
  cited_passage_ids_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  cited_work_ids_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage_warnings_count  INTEGER NOT NULL DEFAULT 0,
  passage_id               TEXT,
  work_id                  TEXT,
  official_identifier      TEXT,
  origin_uri               TEXT,
  http_status              INTEGER NOT NULL DEFAULT 200,
  latency_ms               INTEGER
);

CREATE INDEX IF NOT EXISTS idx_trial_audit_recorded_at ON trial_audit_events (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_audit_actor_id ON trial_audit_events (actor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_audit_release_id ON trial_audit_events (release_id);
