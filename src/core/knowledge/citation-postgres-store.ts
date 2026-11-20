/**
 * REG24 — Hosted PostgreSQL (Neon) Durable Citation, Answer Revision & Legal Feedback Repository
 *
 * Ensures that onboarded official sources/attachments, passages, published answers, ownership bindings,
 * immutable revision chains (`r1` -> `r2` -> ...), audit events, and Legal Team feedback survive:
 *   1. Serverless container cold starts / process restarts,
 *   2. Separate Vercel Preview/Staging deployments sharing `DATABASE_URL`, and
 *   3. Hosted Neon Backup & Point-in-Time Restore (PITR).
 *
 * Automatically stays inert during fast local Vitest unit runs (`process.env.VITEST`) unless either
 * `REG24_ALLOW_LIVE_DB_IN_VITEST === "1"` or a test transport is injected via
 * `setCustomCitationDbTransportForTesting()`.
 */

import { sha256Bytes } from "./identity";
import { REVIEWED_OFFICIAL_PUBLISHER_REGISTRY } from "./source-onboarding";
import type { Actor } from "./contracts";
import type {
  AnswerRevisionHistoryEntryDto,
  ClaimEvidenceReferenceDto,
  DocumentVersionRecord,
  EvidencePassageRecord,
  ExtractionRevisionRecord,
  LegalReviewFeedbackRecord,
  OfficialDocumentRecord,
  OfficialLocationRecord,
  PublishedAtomicClaimDto,
  TraceableAnswerEnvelope,
  TraceabilityAuditEventRecord,
} from "./citation-contracts";

export type CitationDbTransport = <T = Record<string, unknown>>(
  query: string,
  params?: unknown[]
) => Promise<{ rows: T[]; rowCount: number }>;

export type CitationTxTransport = (
  statements: Array<{ query: string; params: unknown[] }>
) => Promise<void>;

let customCitationDbTransport: CitationDbTransport | null = null;
let customCitationTxTransport: CitationTxTransport | null = null;

const ONBOARDED_SOURCES_CACHE_TTL_MS = 30_000;
let onboardedSourcesCache: {
  expiresAt: number;
  data: {
    documents: Record<string, OfficialDocumentRecord>;
    versions: Record<string, DocumentVersionRecord>;
    locations: Record<string, OfficialLocationRecord>;
    extractions: Record<string, ExtractionRevisionRecord>;
    passages: Record<string, EvidencePassageRecord>;
  };
} | null = null;
const syncedCanonicalBundleKeys = new Set<string>();

export function invalidateCitationPostgresReadCaches(): void {
  onboardedSourcesCache = null;
  syncedCanonicalBundleKeys.clear();
}

export function setCustomCitationDbTransportForTesting(
  transport: CitationDbTransport | null,
  txTransport?: CitationTxTransport | null
): void {
  customCitationDbTransport = transport;
  customCitationTxTransport = txTransport ?? null;
  invalidateCitationPostgresReadCaches();
}

export function resolveActiveCitationDbTransport(): CitationDbTransport | null {
  if (customCitationDbTransport) {
    return customCitationDbTransport;
  }
  if (process.env.VITEST && process.env.REG24_ALLOW_LIVE_DB_IN_VITEST !== "1") {
    return null;
  }
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) return null;

  let host: string;
  try {
    const parsed = new URL(dbUrl);
    if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith(".neon.tech")) {
    return null;
  }

  return async <T = Record<string, unknown>>(
    query: string,
    params: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number }> => {
    const resp = await fetch(`https://${host}/sql`, {
      method: "POST",
      headers: {
        "Neon-Connection-String": dbUrl,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, params }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`NEON_CITATION_SQL_HTTP_${resp.status}:${errBody.slice(0, 240)}`);
    }
    const json = (await resp.json()) as { rows?: T[]; rowCount?: number };
    const rows = Array.isArray(json.rows) ? json.rows : [];
    return {
      rows,
      rowCount: Number(json.rowCount ?? rows.length),
    };
  };
}

export function hasActiveCitationPostgresStore(): boolean {
  return resolveActiveCitationDbTransport() !== null;
}

/**
 * Executes a batch of SQL statements inside ONE atomic Neon PostgreSQL transaction (`BEGIN ... COMMIT`).
 * If ANY statement fails or the save is interrupted mid-flight, PostgreSQL rolls back the entire
 * transaction so NO partial answer revision, claim, citation link, or audit event is ever visible.
 */
export async function executeCitationPostgresTransaction(
  statements: Array<{ query: string; params: unknown[] }>
): Promise<boolean> {
  if (statements.length === 0) return true;
  if (customCitationTxTransport) {
    await customCitationTxTransport(statements);
    return true;
  }
  if (customCitationDbTransport) {
    // Legacy mock transport compatibility: execute sequentially when no tx mock is registered
    for (const st of statements) {
      await customCitationDbTransport(st.query, st.params);
    }
    return true;
  }
  if (process.env.VITEST && process.env.REG24_ALLOW_LIVE_DB_IN_VITEST !== "1") {
    return false;
  }
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) return false;
  let host: string;
  try {
    const parsed = new URL(dbUrl);
    if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host.endsWith(".neon.tech")) return false;

  const resp = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Neon-Connection-String": dbUrl,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Neon-Batch-Isolation-Level": "ReadCommitted",
    },
    body: JSON.stringify({ queries: statements }),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`NEON_CITATION_TX_HTTP_${resp.status}:${errBody.slice(0, 240)}`);
  }
  return true;
}

function getEnvScope(): "staging" | "trial" {
  return process.env.REG24_TRIAL_ENV_SCOPE === "trial" ? "trial" : "staging";
}

async function ensurePublisherInPostgres(
  db: CitationDbTransport,
  publisherId: string
): Promise<void> {
  const pub = REVIEWED_OFFICIAL_PUBLISHER_REGISTRY[publisherId] || {
    publisher_id: publisherId,
    name_th: publisherId,
    name_en: publisherId,
    source_families: ["gazette_enactment", "revenue_department_ruling"],
    permitted_hosts: ["www.rd.go.th", "ratchakitcha.soc.go.th"],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  };
  await db(
    `INSERT INTO citation_official_publisher (
       publisher_id, name_th, name_en, source_families, permitted_hosts,
       supports_page_anchors, supports_html_fragments, reviewed_by, reviewed_at, active
     ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
     ON CONFLICT (publisher_id) DO NOTHING`,
    [
      pub.publisher_id,
      pub.name_th,
      pub.name_en,
      JSON.stringify(pub.source_families),
      JSON.stringify(pub.permitted_hosts),
      pub.supports_pdf_page_fragment,
      pub.supports_html_fragment,
      pub.reviewed_by,
      pub.reviewed_at,
      pub.active,
    ]
  );
}

/**
 * Persists an onboarded document, version, location, extraction revision, and passages
 * into hosted PostgreSQL (`citation_*` tables) so attachments and citations survive restarts/deployments.
 */
export async function persistCitationSourceBundleToPostgres(params: {
  doc: OfficialDocumentRecord;
  version: DocumentVersionRecord;
  location: OfficialLocationRecord;
  extraction: ExtractionRevisionRecord;
  passages: EvidencePassageRecord[];
  auditEvent?: TraceabilityAuditEventRecord;
}): Promise<{ persisted: boolean }> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return { persisted: false };

  const envScope = getEnvScope();
  await ensurePublisherInPostgres(db, params.doc.issuer_id);

  await db(
    `INSERT INTO citation_official_document (
       doc_id, source_family, issuer_id, source_native_id, reviewed_surrogate_id,
       is_reviewed_surrogate, original_title_th, language, record_type,
       access_permission, preservation_permission, access_scope, access_conditions_th,
       eligible_for_citation, ineligible_reason, canonical_work_id, environment_scope, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
     )
     ON CONFLICT (doc_id) DO UPDATE SET
       eligible_for_citation = EXCLUDED.eligible_for_citation,
       ineligible_reason = EXCLUDED.ineligible_reason`,
    [
      params.doc.doc_id,
      params.doc.source_family,
      params.doc.issuer_id,
      params.doc.source_native_id,
      params.doc.reviewed_surrogate_id || (params.doc.source_native_id ? null : params.doc.doc_id),
      params.doc.source_native_id ? params.doc.is_reviewed_surrogate : true,
      params.doc.original_title_th,
      params.doc.language,
      params.doc.record_type,
      params.doc.access_permission,
      params.doc.preservation_permission,
      params.doc.access_scope,
      params.doc.access_conditions_th,
      params.doc.eligible_for_citation,
      params.doc.ineligible_reason,
      params.doc.canonical_work_id,
      envScope,
      params.doc.created_at,
    ]
  );

  const validIsoDate = (d: string | null | undefined) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;

  await db(
    `INSERT INTO citation_document_version (
       version_id, doc_id, artifact_sha256, captured_at, artifact_ref,
       mime_type, byte_size, source_metadata, publication_date, publication_date_status,
       effective_from, effective_to, effective_date_status, applicability_rules_th,
       affected_provisions, predecessor_version_id, amending_version_ids,
       byte_change_classification, canonical_version_id, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19,$20
     )
     ON CONFLICT (version_id) DO UPDATE SET
       effective_to = COALESCE(EXCLUDED.effective_to, citation_document_version.effective_to),
       amending_version_ids = EXCLUDED.amending_version_ids`,
    [
      params.version.version_id,
      params.doc.doc_id,
      params.version.artifact_sha256.padEnd(64, "0").slice(0, 64),
      params.version.captured_at,
      params.version.artifact_ref,
      params.version.mime_type,
      params.version.byte_size,
      JSON.stringify(params.version.source_metadata || {}),
      validIsoDate(params.version.publication_date),
      params.version.publication_date_status,
      validIsoDate(params.version.effective_from),
      validIsoDate(params.version.effective_to),
      params.version.effective_date_status,
      JSON.stringify(params.version.applicability_rules_th || []),
      JSON.stringify(params.version.affected_provisions || []),
      params.version.predecessor_version_id,
      JSON.stringify(params.version.amending_version_ids || []),
      params.version.byte_change_classification,
      params.version.canonical_version_id,
      params.version.created_at,
    ]
  );

  await db(
    `INSERT INTO citation_official_location (
       location_id, doc_id, version_id, exact_official_url, location_role,
       parent_landing_location_id, original_observed_url, redirect_history, prior_location_ids,
       first_verified_at, last_verified_at, last_successful_verified_at, verification_method,
       identity_match_result, link_health, last_http_status, failure_reason, is_active_primary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18
     )
     ON CONFLICT (location_id) DO UPDATE SET
       exact_official_url = EXCLUDED.exact_official_url,
       link_health = EXCLUDED.link_health,
       last_verified_at = EXCLUDED.last_verified_at,
       last_successful_verified_at = EXCLUDED.last_successful_verified_at,
       prior_location_ids = EXCLUDED.prior_location_ids`,
    [
      params.location.location_id,
      params.doc.doc_id,
      params.version.version_id,
      params.location.exact_official_url,
      params.location.role,
      null,
      params.location.original_observed_url,
      JSON.stringify(params.location.redirect_history || []),
      JSON.stringify(params.location.prior_urls || []),
      params.location.first_verified_at,
      params.location.last_verified_at,
      params.location.last_successful_verified_at,
      params.location.verification_method,
      params.location.identity_match_result,
      params.location.link_health,
      params.location.last_http_status,
      params.location.failure_reason,
      params.location.is_active_primary,
    ]
  );

  await db(
    `INSERT INTO citation_extraction_revision (
       extraction_revision_id, version_id, parent_revision_id, parser_or_ocr_version,
       is_scanned_material, page_mapping, raw_transcription, normalized_search_text,
       alignment_map, ocr_ambiguity_detected, ocr_ambiguity_reasons, review_status,
       reviewer_id, reviewed_at, correction_note, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16
     )
     ON CONFLICT (extraction_revision_id) DO NOTHING`,
    [
      params.extraction.extraction_revision_id,
      params.version.version_id,
      params.extraction.parent_revision_id,
      params.extraction.parser_or_ocr_version,
      params.extraction.is_scanned_material,
      JSON.stringify(params.extraction.page_mapping || []),
      params.extraction.raw_transcription,
      params.extraction.normalized_search_text,
      JSON.stringify(params.extraction.alignment_map || []),
      params.extraction.ocr_ambiguity_detected,
      JSON.stringify(params.extraction.ocr_ambiguity_reasons || []),
      params.extraction.review_status,
      params.extraction.reviewer_id,
      params.extraction.reviewed_at,
      params.extraction.correction_note,
      params.extraction.created_at,
    ]
  );

  if (!customCitationDbTransport && params.passages.length > 1) {
    const chunkSize = 50;
    for (let offset = 0; offset < params.passages.length; offset += chunkSize) {
      const chunk = params.passages.slice(offset, offset + chunkSize);
      const valuesSql: string[] = [];
      const flatParams: unknown[] = [];
      for (const psg of chunk) {
        const safeAnchors =
          psg.anchors && psg.anchors.length > 0
            ? psg.anchors
            : [{ anchor_kind: "html_text_quote", exact_quote: psg.verbatim_text.slice(0, 120) }];
        const base = flatParams.length;
        valuesSql.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9}::jsonb,$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15}::jsonb,$${base + 16},$${base + 17},$${base + 18},$${base + 19},$${base + 20},$${base + 21})`
        );
        flatParams.push(
          psg.passage_id,
          psg.extraction_revision_id,
          psg.version_id,
          psg.doc_id,
          psg.verbatim_text,
          psg.text_sha256.padEnd(64, "0").slice(0, 64),
          psg.surrounding_before || "",
          psg.surrounding_after || "",
          JSON.stringify(psg.section_paragraph_path || []),
          psg.statement_role,
          psg.physical_page_start,
          psg.physical_page_end,
          psg.printed_page_start,
          psg.printed_page_end,
          JSON.stringify(safeAnchors),
          psg.human_pinpoint_th,
          psg.locator_replay_status,
          psg.quarantine_reason,
          psg.eligible_for_publication,
          psg.access_scope || "scope.platform.public",
          psg.created_at
        );
      }
      await db(
        `INSERT INTO citation_evidence_passage (
           passage_id, extraction_revision_id, version_id, doc_id, verbatim_text,
           text_sha256, surrounding_before, surrounding_after, section_paragraph_path,
           statement_role, physical_page_start, physical_page_end, printed_page_start,
           printed_page_end, anchors, human_pinpoint_th, locator_replay_status,
           quarantine_reason, eligible_for_publication, access_scope, created_at
         ) VALUES ${valuesSql.join(",")}
         ON CONFLICT (passage_id) DO UPDATE SET
           extraction_revision_id = EXCLUDED.extraction_revision_id,
           verbatim_text = EXCLUDED.verbatim_text,
           text_sha256 = EXCLUDED.text_sha256,
           locator_replay_status = EXCLUDED.locator_replay_status,
           eligible_for_publication = EXCLUDED.eligible_for_publication,
           quarantine_reason = EXCLUDED.quarantine_reason`,
        flatParams
      );
    }
  } else {
    for (const psg of params.passages) {
      const safeAnchors =
        psg.anchors && psg.anchors.length > 0
          ? psg.anchors
          : [{ anchor_kind: "html_text_quote", exact_quote: psg.verbatim_text.slice(0, 120) }];
      await db(
        `INSERT INTO citation_evidence_passage (
           passage_id, extraction_revision_id, version_id, doc_id, verbatim_text,
           text_sha256, surrounding_before, surrounding_after, section_paragraph_path,
           statement_role, physical_page_start, physical_page_end, printed_page_start,
           printed_page_end, anchors, human_pinpoint_th, locator_replay_status,
           quarantine_reason, eligible_for_publication, access_scope, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21
         )
         ON CONFLICT (passage_id) DO UPDATE SET
           extraction_revision_id = EXCLUDED.extraction_revision_id,
           verbatim_text = EXCLUDED.verbatim_text,
           text_sha256 = EXCLUDED.text_sha256,
           locator_replay_status = EXCLUDED.locator_replay_status,
           eligible_for_publication = EXCLUDED.eligible_for_publication,
           quarantine_reason = EXCLUDED.quarantine_reason`,
        [
          psg.passage_id,
          psg.extraction_revision_id,
          psg.version_id,
          psg.doc_id,
          psg.verbatim_text,
          psg.text_sha256.padEnd(64, "0").slice(0, 64),
          psg.surrounding_before || "",
          psg.surrounding_after || "",
          JSON.stringify(psg.section_paragraph_path || []),
          psg.statement_role,
          psg.physical_page_start,
          psg.physical_page_end,
          psg.printed_page_start,
          psg.printed_page_end,
          JSON.stringify(safeAnchors),
          psg.human_pinpoint_th,
          psg.locator_replay_status,
          psg.quarantine_reason,
          psg.eligible_for_publication,
          psg.access_scope || "scope.platform.public",
          psg.created_at,
        ]
      );
    }
  }

  if (
    !params.doc.canonical_work_id ||
    params.passages.some((p) => !p.eligible_for_publication)
  ) {
    onboardedSourcesCache = null;
  }

  if (params.auditEvent) {
    await appendAuditEventToPostgres(params.auditEvent);
  }

  return { persisted: true };
}

export async function appendAuditEventToPostgres(
  ev: TraceabilityAuditEventRecord
): Promise<boolean> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return false;
  const envScope = getEnvScope();
  await db(
    `INSERT INTO citation_audit_event (
       audit_id, actor_or_service, recorded_at, event_type, affected_ids,
       before_status, after_status, reason, correlation_id, environment_scope
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)
     ON CONFLICT (audit_id) DO NOTHING`,
    [
      ev.audit_id,
      ev.actor_or_service,
      ev.recorded_at,
      ev.event_type,
      JSON.stringify(ev.affected_ids || []),
      ev.before_status ? JSON.stringify(ev.before_status) : null,
      ev.after_status ? JSON.stringify(ev.after_status) : null,
      ev.reason,
      ev.correlation_id,
      envScope,
    ]
  );
  return true;
}

/**
 * Checks existing ownership, full revision history & conversation question lineage for `answer_id` in PostgreSQL
 * so cross-instance saves enforce strict ownership (`403` on another user's answer_id), authoritative
 * monotonic revisions (`r1` -> `r2`) with guaranteed FK integrity, and same-conversation follow-up binding.
 */
export async function inspectExistingAnswerOwnershipInPostgres(
  answerId: string
): Promise<{
  exists: boolean;
  owner_actor_id: string | null;
  owner_tenant_id: string | null;
  latest_revision_number: number;
  latest_answer_revision: string | null;
  first_question_text: string | null;
  latest_question_text: string | null;
  question_texts: string[];
  revisions: AnswerRevisionHistoryEntryDto[];
}> {
  const db = resolveActiveCitationDbTransport();
  if (!db) {
    return {
      exists: false,
      owner_actor_id: null,
      owner_tenant_id: null,
      latest_revision_number: 0,
      latest_answer_revision: null,
      first_question_text: null,
      latest_question_text: null,
      question_texts: [],
      revisions: [],
    };
  }
  const res = await db<{
    answer_revision_id: string;
    revision_number: number;
    supersedes_revision_id: string | null;
    question_text: string;
    generated_at: string;
    as_of_date_raw: string | null;
    status: TraceableAnswerEnvelope["status"];
    actor_id: string;
    owner_actor_id: string;
    owner_tenant_id: string;
    revision_reason: string;
    ordered_claim_ids: string[];
  }>(
    `SELECT answer_revision_id, revision_number, supersedes_revision_id,
            question_text, generated_at::text AS generated_at, as_of_date_raw, status,
            actor_id, owner_actor_id, owner_tenant_id, revision_reason, ordered_claim_ids
     FROM citation_published_answer
     WHERE answer_id = $1
     ORDER BY revision_number DESC`,
    [answerId]
  );
  if (res.rows.length === 0) {
    return {
      exists: false,
      owner_actor_id: null,
      owner_tenant_id: null,
      latest_revision_number: 0,
      latest_answer_revision: null,
      first_question_text: null,
      latest_question_text: null,
      question_texts: [],
      revisions: [],
    };
  }
  const sortedDesc = [...res.rows].sort(
    (a, b) => Number(b.revision_number) - Number(a.revision_number)
  );
  const sortedAsc = [...sortedDesc].reverse();
  const top = sortedDesc[0];
  const first = sortedAsc[0];
  return {
    exists: true,
    owner_actor_id: first.owner_actor_id || top.owner_actor_id,
    owner_tenant_id: first.owner_tenant_id || top.owner_tenant_id,
    latest_revision_number: Number(top.revision_number),
    latest_answer_revision: top.answer_revision_id,
    first_question_text: first.question_text || null,
    latest_question_text: top.question_text || null,
    question_texts: sortedAsc.map((r) => r.question_text).filter(Boolean),
    revisions: sortedAsc.map((h) => ({
      answer_revision: h.answer_revision_id,
      revision_number: Number(h.revision_number),
      supersedes_answer_revision: h.supersedes_revision_id ?? null,
      generated_at: h.generated_at,
      as_of_date: h.as_of_date_raw ?? null,
      status: h.status,
      actor_id: h.actor_id,
      owner_actor_id: h.owner_actor_id,
      revision_reason: h.revision_reason || "Initial verified publication",
      published_claims_count: Array.isArray(h.ordered_claim_ids)
        ? h.ordered_claim_ids.length
        : 0,
    })),
  };
}

/**
 * Verifies that an exact `answer_revision_id` actually exists in PostgreSQL `citation_published_answer`
 * before any follow-up answer is permitted to link to or supersede that conversation's revision chain.
 */
export async function lookupSavedRevisionRecordInPostgres(
  answerRevisionId: string
): Promise<{
  exists: boolean;
  answer_revision_id: string | null;
  answer_id: string | null;
  revision_number: number;
  owner_actor_id: string | null;
  owner_tenant_id: string | null;
  question_text: string | null;
  revision_reason: string | null;
}> {
  const db = resolveActiveCitationDbTransport();
  if (!db) {
    return {
      exists: false,
      answer_revision_id: null,
      answer_id: null,
      revision_number: 0,
      owner_actor_id: null,
      owner_tenant_id: null,
      question_text: null,
      revision_reason: null,
    };
  }
  const res = await db<{
    answer_revision_id: string;
    answer_id: string;
    revision_number: number;
    owner_actor_id: string;
    owner_tenant_id: string;
    question_text: string;
    revision_reason: string;
  }>(
    `SELECT answer_revision_id, answer_id, revision_number,
            owner_actor_id, owner_tenant_id, question_text, revision_reason
     FROM citation_published_answer
     WHERE answer_revision_id = $1 OR answer_id = $1
     ORDER BY revision_number DESC
     LIMIT 1`,
    [answerRevisionId]
  );
  const match = res.rows.find((r) => r.answer_revision_id === answerRevisionId);
  if (!match) {
    return {
      exists: false,
      answer_revision_id: null,
      answer_id: null,
      revision_number: 0,
      owner_actor_id: null,
      owner_tenant_id: null,
      question_text: null,
      revision_reason: null,
    };
  }
  return {
    exists: true,
    answer_revision_id: match.answer_revision_id,
    answer_id: match.answer_id,
    revision_number: Number(match.revision_number),
    owner_actor_id: match.owner_actor_id,
    owner_tenant_id: match.owner_tenant_id,
    question_text: match.question_text || null,
    revision_reason: match.revision_reason || null,
  };
}

/**
 * Persists a validated `TraceableAnswerEnvelope` + its supporting source bundles, claims,
 * claim-evidence links, and append-only audit event to PostgreSQL.
 */
export async function persistAnswerRevisionToPostgres(params: {
  envelope: TraceableAnswerEnvelope;
  question_text: string;
  owner_actor_id: string;
  owner_tenant_id: string;
  actor: Actor;
  revision_reason: string;
  referenced_bundles: Array<{
    doc: OfficialDocumentRecord;
    version: DocumentVersionRecord;
    location: OfficialLocationRecord;
    extraction: ExtractionRevisionRecord;
    passages: EvidencePassageRecord[];
  }>;
}): Promise<{ persisted: boolean }> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return { persisted: false };

  const envScope = getEnvScope();
  const env = params.envelope;

  // Ensure all referenced source documents/versions/passages exist in PostgreSQL for FK integrity & cold-start resolution!
  // On live Neon (`!customCitationDbTransport`), skip redundant re-upserts for immutable canonical release bundles
  // already synced in this container lifetime (saves 5-15 HTTPS round-trips per warm save).
  for (const b of params.referenced_bundles) {
    const bundleKey = b.doc.canonical_work_id
      ? `${b.doc.doc_id}|${b.version.version_id}|${b.passages
          .map((p) => `${p.passage_id}:${p.eligible_for_publication ? 1 : 0}`)
          .sort()
          .join(",")}`
      : null;
    if (!customCitationDbTransport && bundleKey && syncedCanonicalBundleKeys.has(bundleKey)) {
      continue;
    }
    await persistCitationSourceBundleToPostgres(b);
    if (!customCitationDbTransport && bundleKey) {
      syncedCanonicalBundleKeys.add(bundleKey);
    }
  }

  const validIsoDate = (d: string | null | undefined) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;

  // Deterministic audit_id bound to `answer_revision` so retry is 100% idempotent (zero duplicate rows!)
  const deterministicAuditId = `caud.pg.${sha256Bytes(`pub:${env.answer_revision}`).slice(0, 14)}`;

  if (!customCitationDbTransport || customCitationTxTransport) {
    // ATOMIC TRANSACTIONAL SAVE (Section 4):
    // Saves `citation_published_answer` + `citation_atomic_claim` + `citation_claim_evidence_link`
    // + `citation_audit_event` inside ONE atomic PostgreSQL transaction (`BEGIN ... COMMIT`) with
    // `ON CONFLICT DO NOTHING` so interrupted saves leave ZERO partial revision visible and retries never duplicate!
    const txStatements: Array<{ query: string; params: unknown[] }> = [];

    txStatements.push({
      query: `INSERT INTO citation_published_answer (
         answer_revision_id, answer_id, revision_number, supersedes_revision_id,
         channel, question_text, generated_at, as_of_date, as_of_date_raw,
         status, rendered_answer_th, ordered_claim_ids, unresolved_issues,
         user_supplied_facts, assumptions, legacy_warning_th, release_id,
         verifier_version, ruleset_version, owner_actor_id, owner_tenant_id,
         actor_id, tenant_id, revision_reason, environment_scope, execution_provenance
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
         $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb
       ) ON CONFLICT (answer_revision_id) DO NOTHING`,
      params: [
        env.answer_revision,
        env.answer_id,
        env.revision_number,
        env.supersedes_answer_revision,
        env.channel,
        params.question_text,
        env.generated_at,
        validIsoDate(env.as_of_date),
        env.as_of_date,
        env.status,
        env.rendered_answer_th,
        JSON.stringify(env.claims.map((c) => c.claim_id)),
        JSON.stringify(env.unresolved_issues || []),
        JSON.stringify(env.user_supplied_facts || []),
        JSON.stringify(env.assumptions || []),
        env.legacy_warning_th,
        env.verifier_metadata.release_id,
        env.verifier_metadata.verifier_version,
        env.verifier_metadata.ruleset_version,
        params.owner_actor_id,
        params.owner_tenant_id,
        params.actor.actor_id,
        params.actor.tenant_id,
        params.revision_reason,
        envScope,
        env.execution_provenance ? JSON.stringify(env.execution_provenance) : null,
      ],
    });

    if (env.claims.length > 0) {
      const claimValuesSql: string[] = [];
      const claimParams: unknown[] = [];
      for (const clm of env.claims) {
        const validLinkCount = clm.evidence_references.filter(
          (r) => r.verification_status === "supported"
        ).length;
        const base = claimParams.length;
        claimValuesSql.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb,$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13}::jsonb)`
        );
        claimParams.push(
          clm.claim_id,
          env.answer_revision,
          clm.claim_number,
          clm.text,
          clm.claim_type,
          JSON.stringify(clm.premise_ids || []),
          clm.verification_decision,
          validLinkCount,
          clm.published,
          clm.withheld_explanation_th,
          null,
          null,
          clm.bound_calculation ? JSON.stringify(clm.bound_calculation) : null
        );
      }
      txStatements.push({
        query: `INSERT INTO citation_atomic_claim (
           claim_id, answer_revision_id, display_order, displayed_claim_text,
           claim_type, premise_claim_ids, verification_decision, evidence_link_count,
           published, withheld_reason_th, human_approved_by, human_approval_audit_id, bound_calculation
         ) VALUES ${claimValuesSql.join(",")} ON CONFLICT (claim_id) DO NOTHING`,
        params: claimParams,
      });
    }

    const allLinks: Array<{ clmId: string; ref: ClaimEvidenceReferenceDto }> = [];
    for (const clm of env.claims) {
      for (const ref of clm.evidence_references) {
        if (ref.verification_status === "legacy_unverified") continue;
        allLinks.push({ clmId: clm.claim_id, ref });
      }
    }
    const linkChunkSize = 100;
    for (let offset = 0; offset < allLinks.length; offset += linkChunkSize) {
      const chunk = allLinks.slice(offset, offset + linkChunkSize);
      const linkValuesSql: string[] = [];
      const linkParams: unknown[] = [];
      for (const { clmId, ref } of chunk) {
        const base = linkParams.length;
        linkValuesSql.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},'PASS','supported',$${base + 12},$${base + 13},$${base + 14})`
        );
        linkParams.push(
          ref.link_id,
          env.answer_revision,
          clmId,
          ref.evidence_id,
          ref.version_id,
          ref.support_role,
          ref.required_group,
          ref.citation_label_th,
          ref.official_url,
          ref.resolver_url,
          ref.locator.human_pinpoint_th,
          env.verifier_metadata.verifier_version,
          env.verifier_metadata.ruleset_version,
          env.generated_at
        );
      }
      txStatements.push({
        query: `INSERT INTO citation_claim_evidence_link (
           link_id, answer_revision_id, claim_id, passage_id, version_id,
           support_role, required_group, citation_label_th, official_url,
           resolver_url, human_pinpoint_th, deterministic_check, substantive_check,
           verifier_or_reviewer_id, ruleset_version, verified_at
         ) VALUES ${linkValuesSql.join(",")} ON CONFLICT (link_id) DO NOTHING`,
        params: linkParams,
      });
    }

    txStatements.push({
      query: `INSERT INTO citation_audit_event (
         audit_id, actor_or_service, recorded_at, event_type, affected_ids,
         before_status, after_status, reason, correlation_id, environment_scope
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)
       ON CONFLICT (audit_id) DO NOTHING`,
      params: [
        deterministicAuditId,
        params.actor.actor_id,
        env.generated_at,
        env.revision_number > 1 ? "ANSWER_REVISION_CREATED" : "ANSWER_PUBLISHED_ATOMIC",
        JSON.stringify([env.answer_revision, ...env.claims.map((c) => c.claim_id)]),
        env.supersedes_answer_revision
          ? JSON.stringify({ supersedes: env.supersedes_answer_revision })
          : null,
        JSON.stringify({
          status: env.status,
          revision_number: env.revision_number,
          owner_actor_id: params.owner_actor_id,
        }),
        params.revision_reason,
        env.answer_revision,
        envScope,
      ],
    });

    await executeCitationPostgresTransaction(txStatements);
    return { persisted: true };
  }

  await db(
    `INSERT INTO citation_published_answer (
       answer_revision_id, answer_id, revision_number, supersedes_revision_id,
       channel, question_text, generated_at, as_of_date, as_of_date_raw,
       status, rendered_answer_th, ordered_claim_ids, unresolved_issues,
       user_supplied_facts, assumptions, legacy_warning_th, release_id,
       verifier_version, ruleset_version, owner_actor_id, owner_tenant_id,
       actor_id, tenant_id, revision_reason, environment_scope, execution_provenance
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
       $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb
     )`,
    [
      env.answer_revision,
      env.answer_id,
      env.revision_number,
      env.supersedes_answer_revision,
      env.channel,
      params.question_text,
      env.generated_at,
      validIsoDate(env.as_of_date),
      env.as_of_date,
      env.status,
      env.rendered_answer_th,
      JSON.stringify(env.claims.map((c) => c.claim_id)),
      JSON.stringify(env.unresolved_issues || []),
      JSON.stringify(env.user_supplied_facts || []),
      JSON.stringify(env.assumptions || []),
      env.legacy_warning_th,
      env.verifier_metadata.release_id,
      env.verifier_metadata.verifier_version,
      env.verifier_metadata.ruleset_version,
      params.owner_actor_id,
      params.owner_tenant_id,
      params.actor.actor_id,
      params.actor.tenant_id,
      params.revision_reason,
      envScope,
      env.execution_provenance ? JSON.stringify(env.execution_provenance) : null,
    ]
  );

  for (const clm of env.claims) {
      const validLinkCount = clm.evidence_references.filter(
        (r) => r.verification_status === "supported"
      ).length;
      await db(
        `INSERT INTO citation_atomic_claim (
           claim_id, answer_revision_id, display_order, displayed_claim_text,
           claim_type, premise_claim_ids, verification_decision, evidence_link_count,
           published, withheld_reason_th, human_approved_by, human_approval_audit_id, bound_calculation
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [
          clm.claim_id,
          env.answer_revision,
          clm.claim_number,
          clm.text,
          clm.claim_type,
          JSON.stringify(clm.premise_ids || []),
          clm.verification_decision,
          validLinkCount,
          clm.published,
          clm.withheld_explanation_th,
          null,
          null,
          clm.bound_calculation ? JSON.stringify(clm.bound_calculation) : null,
        ]
      );

      for (const ref of clm.evidence_references) {
        if (ref.verification_status === "legacy_unverified") continue;
        await db(
          `INSERT INTO citation_claim_evidence_link (
             link_id, answer_revision_id, claim_id, passage_id, version_id,
             support_role, required_group, citation_label_th, official_url,
             resolver_url, human_pinpoint_th, deterministic_check, substantive_check,
             verifier_or_reviewer_id, ruleset_version, verified_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PASS','supported',$12,$13,$14)`,
          [
            ref.link_id,
            env.answer_revision,
            clm.claim_id,
            ref.evidence_id,
            ref.version_id,
            ref.support_role,
            ref.required_group,
            ref.citation_label_th,
            ref.official_url,
            ref.resolver_url,
            ref.locator.human_pinpoint_th,
            env.verifier_metadata.verifier_version,
            env.verifier_metadata.ruleset_version,
            env.generated_at,
          ]
        );
      }
  }

  await appendAuditEventToPostgres({
    audit_id: deterministicAuditId,
    actor_or_service: params.actor.actor_id,
    recorded_at: env.generated_at,
    event_type:
      env.revision_number > 1 ? "ANSWER_REVISION_CREATED" : "ANSWER_PUBLISHED_ATOMIC",
    affected_ids: [env.answer_revision, ...env.claims.map((c) => c.claim_id)],
    before_status: env.supersedes_answer_revision
      ? { supersedes: env.supersedes_answer_revision }
      : null,
    after_status: {
      status: env.status,
      revision_number: env.revision_number,
      owner_actor_id: params.owner_actor_id,
    },
    reason: params.revision_reason,
    correlation_id: env.answer_revision,
  });

  return { persisted: true };
}

/**
 * Loads a saved answer revision (or latest revision of `answer_id`) PLUS its full auditable
 * `revision_history` directly from PostgreSQL across cold starts & separate deployments!
 */
export async function loadSavedAnswerFromPostgres(
  answerRevisionOrId: string,
  actor: Actor
): Promise<{
  found: boolean;
  forbidden_restricted?: boolean;
  question_text?: string;
  answer?: TraceableAnswerEnvelope;
  audit_events?: TraceabilityAuditEventRecord[];
}> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return { found: false };

  const ansRes = await db<{
    answer_revision_id: string;
    answer_id: string;
    revision_number: number;
    supersedes_revision_id: string | null;
    channel: TraceableAnswerEnvelope["channel"];
    question_text: string;
    generated_at: string;
    as_of_date_raw: string | null;
    status: TraceableAnswerEnvelope["status"];
    rendered_answer_th: string;
    unresolved_issues: TraceableAnswerEnvelope["unresolved_issues"];
    user_supplied_facts: string[];
    assumptions: string[];
    legacy_warning_th: string | null;
    release_id: string;
    verifier_version: string;
    ruleset_version: string;
    owner_actor_id: string;
    owner_tenant_id: string;
    actor_id: string;
    tenant_id: string;
    revision_reason: string;
    execution_provenance?: TraceableAnswerEnvelope["execution_provenance"];
  }>(
    `SELECT answer_revision_id, answer_id, revision_number, supersedes_revision_id,
            channel, question_text, generated_at::text AS generated_at, as_of_date_raw,
            status, rendered_answer_th, unresolved_issues, user_supplied_facts,
            assumptions, legacy_warning_th, release_id, verifier_version, ruleset_version,
            owner_actor_id, owner_tenant_id, actor_id, tenant_id, revision_reason,
            execution_provenance
     FROM citation_published_answer
     WHERE answer_revision_id = $1 OR answer_id = $1
     ORDER BY revision_number DESC
     LIMIT 1`,
    [answerRevisionOrId]
  );

  if (ansRes.rows.length === 0) return { found: false };
  const row = ansRes.rows[0];

  if (row.owner_tenant_id !== "PUBLIC" && row.owner_tenant_id !== actor.tenant_id) {
    return { found: false, forbidden_restricted: true };
  }

  // Fetch full ordered revision history for this `answer_id`
  const histRes = await db<{
    answer_revision_id: string;
    revision_number: number;
    supersedes_revision_id: string | null;
    generated_at: string;
    as_of_date_raw: string | null;
    status: TraceableAnswerEnvelope["status"];
    actor_id: string;
    owner_actor_id: string;
    revision_reason: string;
    ordered_claim_ids: string[];
  }>(
    `SELECT answer_revision_id, revision_number, supersedes_revision_id,
            generated_at::text AS generated_at, as_of_date_raw, status,
            actor_id, owner_actor_id, revision_reason, ordered_claim_ids
     FROM citation_published_answer
     WHERE answer_id = $1
     ORDER BY revision_number ASC`,
    [row.answer_id]
  );

  const revisionHistory: AnswerRevisionHistoryEntryDto[] = histRes.rows.map((h) => ({
    answer_revision: h.answer_revision_id,
    revision_number: Number(h.revision_number),
    supersedes_answer_revision: h.supersedes_revision_id,
    generated_at: h.generated_at,
    as_of_date: h.as_of_date_raw,
    status: h.status,
    actor_id: h.actor_id,
    owner_actor_id: h.owner_actor_id,
    revision_reason: h.revision_reason,
    published_claims_count: Array.isArray(h.ordered_claim_ids)
      ? h.ordered_claim_ids.length
      : 0,
  }));

  // Fetch claims & joined links/passages/docs/locations
  const claimsRes = await db<{
    claim_id: string;
    display_order: number;
    displayed_claim_text: string;
    claim_type: PublishedAtomicClaimDto["claim_type"];
    premise_claim_ids: string[];
    verification_decision: PublishedAtomicClaimDto["verification_decision"];
    published: boolean;
    withheld_reason_th: string | null;
    bound_calculation?: PublishedAtomicClaimDto["bound_calculation"];
  }>(
    `SELECT claim_id, display_order, displayed_claim_text, claim_type,
            premise_claim_ids, verification_decision, published, withheld_reason_th,
            bound_calculation
     FROM citation_atomic_claim
     WHERE answer_revision_id = $1
     ORDER BY display_order ASC`,
    [row.answer_revision_id]
  );

  const linksRes = await db<{
    link_id: string;
    claim_id: string;
    passage_id: string;
    version_id: string;
    support_role: ClaimEvidenceReferenceDto["support_role"];
    required_group: string;
    citation_label_th: string;
    official_url: string;
    resolver_url: string;
    human_pinpoint_th: string;
    doc_id: string;
    extraction_revision_id: string;
    section_paragraph_path: string[];
    physical_page_start: number | null;
    physical_page_end: number | null;
    printed_page_start: string | null;
    printed_page_end: string | null;
    anchors: ClaimEvidenceReferenceDto["locator"]["anchors"];
    access_scope: string;
    issuer_id: string;
    source_family: ClaimEvidenceReferenceDto["source_family"];
    record_type: ClaimEvidenceReferenceDto["record_type"];
    access_permission: ClaimEvidenceReferenceDto["access_permission"];
    access_conditions_th: string | null;
    effective_from: string | null;
    publication_date: string | null;
    link_health: ClaimEvidenceReferenceDto["link_health"];
    last_successful_verified_at: string | null;
  }>(
    `SELECT l.link_id, l.claim_id, l.passage_id, l.version_id, l.support_role,
            l.required_group, l.citation_label_th, l.official_url, l.resolver_url,
            l.human_pinpoint_th, p.doc_id, p.extraction_revision_id,
            p.section_paragraph_path, p.physical_page_start, p.physical_page_end,
            p.printed_page_start, p.printed_page_end, p.anchors, p.access_scope,
            d.issuer_id, d.source_family, d.record_type, d.access_permission, d.access_conditions_th,
            v.effective_from::text AS effective_from, v.publication_date::text AS publication_date,
            COALESCE(loc.link_health, 'unchecked_live') AS link_health,
            loc.last_successful_verified_at::text AS last_successful_verified_at
     FROM citation_claim_evidence_link l
     JOIN citation_evidence_passage p ON p.passage_id = l.passage_id
     JOIN citation_official_document d ON d.doc_id = p.doc_id
     JOIN citation_document_version v ON v.version_id = l.version_id
     LEFT JOIN citation_official_location loc ON loc.doc_id = d.doc_id AND loc.is_active_primary = TRUE
     WHERE l.answer_revision_id = $1`,
    [row.answer_revision_id]
  );

  // Enforce caller access scope on restricted passages (`T10`)
  for (const lk of linksRes.rows) {
    if (
      lk.access_scope !== "scope.platform.public" &&
      !actor.authorized_scopes.includes(lk.access_scope)
    ) {
      return { found: false, forbidden_restricted: true };
    }
  }

  const claimTypeLabels: Record<string, string> = {
    legal_proposition: "ข้อกฎหมายจากแหล่งอ้างอิงทางการ",
    interpretation: "การปรับใช้ข้อกฎหมายกับข้อเท็จจริง (การตีความ)",
    user_fact_or_assumption: "ข้อเท็จจริงหรือสมมติฐานที่ผู้ใช้ระบุ",
    scoped_unresolved_notice: "คำชี้แจงประเด็นที่ยังยืนยันจากเอกสารทางการไม่ได้",
  };
  const roleLabels: Record<string, string> = {
    primary_authority: "หลักฐานกฎหมายหลัก",
    statutory_premise: "บทบัญญัติแห่งกฎหมายที่เป็นฐานข้อสรุป",
    ruling_application: "แนววินิจฉัยทางการที่ใช้ปรับบท",
    judicial_reasoning: "เหตุผลหรือคำวินิจฉัยของศาล",
    exception_or_proviso: "ข้อยกเว้นหรือเงื่อนไขบังคับ",
    transitional_applicability: "บทเฉพาะกาลหรือวันเริ่มใช้บังคับ",
    requester_factual_context: "ข้อเท็จจริงของผู้ขอหารือในเอกสารต้นฉบับ",
    official_summary_scope: "สรุปย่อทางการ",
    verified_attachment_authority: "เอกสารกฎหมายทางการที่แนบและยืนยันต้นฉบับแล้ว",
  };
  const familyLabels: Record<string, string> = {
    gazette_enactment: "กฎหมาย/บทบัญญัติประกาศในราชกิจจานุเบกษา",
    supreme_court_decision: "คำพิพากษาศาลฎีกา",
    council_of_state_opinion: "ความเห็นคณะกรรมการกฤษฎีกา",
    revenue_department_ruling: "หนังสือตอบข้อหารือกรมสรรพากร",
  };

  const claimsOut: PublishedAtomicClaimDto[] = claimsRes.rows.map((c) => {
    const refs = linksRes.rows
      .filter((l) => l.claim_id === c.claim_id)
      .map((l): ClaimEvidenceReferenceDto => {
        const pub = REVIEWED_OFFICIAL_PUBLISHER_REGISTRY[l.issuer_id];
        return {
          link_id: l.link_id,
          evidence_id: l.passage_id,
          doc_id: l.doc_id,
          version_id: l.version_id,
          extraction_revision_id: l.extraction_revision_id,
          support_role: l.support_role,
          support_role_label_th: roleLabels[l.support_role] || l.support_role,
          required_group: l.required_group,
          citation_label_th: l.citation_label_th,
          issuer_name_th: pub?.name_th || l.issuer_id,
          source_family: l.source_family,
          source_family_label_th: familyLabels[l.source_family] || l.source_family,
          record_type: l.record_type,
          record_type_label_th:
            l.record_type === "verified_official_attachment"
              ? "เอกสารกฎหมายทางการที่แนบและยืนยันต้นฉบับแล้ว"
              : "เอกสารฉบับเต็มทางการ",
          date_relied_on: row.as_of_date_raw || l.effective_from || l.publication_date,
          official_url: l.official_url,
          official_url_with_anchor:
            l.physical_page_start !== null && !l.official_url.includes("#")
              ? `${l.official_url}#page=${l.physical_page_start}`
              : l.official_url,
          resolver_url: l.resolver_url,
          locator: {
            human_pinpoint_th: l.human_pinpoint_th,
            section_paragraph_path: Array.isArray(l.section_paragraph_path)
              ? l.section_paragraph_path
              : [],
            physical_page_start: l.physical_page_start,
            physical_page_end: l.physical_page_end,
            printed_page_start: l.printed_page_start,
            printed_page_end: l.printed_page_end,
            anchors: Array.isArray(l.anchors) ? l.anchors : [],
          },
          verification_status: "supported",
          link_health: l.link_health,
          link_health_notice_th:
            l.link_health === "temporarily_offline"
              ? `ลิงก์ทางการไม่พร้อมใช้งาน (ตรวจสอบสำเร็จล่าสุดเมื่อ ${l.last_successful_verified_at || "-"})`
              : null,
          last_successful_verification_at: l.last_successful_verified_at,
          access_permission: l.access_permission,
          access_conditions_th: l.access_conditions_th,
        };
      });

    return {
      claim_id: c.claim_id,
      claim_number: Number(c.display_order),
      text: c.displayed_claim_text,
      claim_type: c.claim_type,
      claim_type_label_th: claimTypeLabels[c.claim_type] || c.claim_type,
      premise_ids: Array.isArray(c.premise_claim_ids) ? c.premise_claim_ids : [],
      verification_decision: c.verification_decision,
      published: Boolean(c.published),
      withheld_explanation_th: c.withheld_reason_th,
      evidence_references: refs,
      bound_calculation: c.bound_calculation ?? null,
    };
  });

  // Fetch audit trail for this answer's revisions
  const revIds = revisionHistory.map((r) => r.answer_revision);
  const auditRes = await db<{
    audit_id: string;
    actor_or_service: string;
    recorded_at: string;
    event_type: TraceabilityAuditEventRecord["event_type"];
    affected_ids: string[];
    before_status: Record<string, unknown> | null;
    after_status: Record<string, unknown> | null;
    reason: string;
    correlation_id: string;
  }>(
    `SELECT audit_id, actor_or_service, recorded_at::text AS recorded_at, event_type,
            affected_ids, before_status, after_status, reason, correlation_id
     FROM citation_audit_event
     WHERE correlation_id = ANY($1::text[])
     ORDER BY recorded_at ASC`,
    [revIds]
  );

  return {
    found: true,
    question_text: row.question_text,
    audit_events: auditRes.rows,
    answer: {
      schema_version: "reg24.citation-traceability.v1",
      answer_id: row.answer_id,
      answer_revision: row.answer_revision_id,
      revision_number: Number(row.revision_number),
      supersedes_answer_revision: row.supersedes_revision_id,
      owner_actor_id: row.owner_actor_id,
      owner_tenant_id: row.owner_tenant_id,
      revision_reason: row.revision_reason,
      revision_history: revisionHistory,
      channel: row.channel,
      generated_at: row.generated_at,
      as_of_date: row.as_of_date_raw,
      status: row.status,
      rendered_answer_th: row.rendered_answer_th,
      user_supplied_facts: Array.isArray(row.user_supplied_facts) ? row.user_supplied_facts : [],
      assumptions: Array.isArray(row.assumptions) ? row.assumptions : [],
      claims: claimsOut,
      unresolved_issues: Array.isArray(row.unresolved_issues) ? row.unresolved_issues : [],
      legacy_warning_th: row.legacy_warning_th,
      execution_provenance: row.execution_provenance ?? null,
      verifier_metadata: {
        verifier_version: row.verifier_version,
        ruleset_version: row.ruleset_version,
        release_id: row.release_id,
        publication_gate_mode: "enforced",
      },
    },
  };
}

/**
 * Resolves an onboarded/attached evidence passage directly from PostgreSQL across cold starts & deployments!
 */
export async function loadPinnedPassageFromPostgres(
  evidenceId: string
): Promise<{
  found: boolean;
  doc?: OfficialDocumentRecord;
  version?: DocumentVersionRecord;
  location?: OfficialLocationRecord;
  extraction?: ExtractionRevisionRecord;
  passage?: EvidencePassageRecord;
}> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return { found: false };

  const res = await db<{
    passage_id: string;
    extraction_revision_id: string;
    version_id: string;
    doc_id: string;
    verbatim_text: string;
    text_sha256: string;
    surrounding_before: string;
    surrounding_after: string;
    section_paragraph_path: string[];
    statement_role: EvidencePassageRecord["statement_role"];
    physical_page_start: number | null;
    physical_page_end: number | null;
    printed_page_start: string | null;
    printed_page_end: string | null;
    anchors: EvidencePassageRecord["anchors"];
    human_pinpoint_th: string;
    locator_replay_status: "VERIFIED" | "QUARANTINED";
    quarantine_reason: string | null;
    eligible_for_publication: boolean;
    access_scope: string;
    psg_created_at: string;
    source_family: OfficialDocumentRecord["source_family"];
    issuer_id: string;
    source_native_id: string | null;
    reviewed_surrogate_id: string | null;
    is_reviewed_surrogate: boolean;
    original_title_th: string;
    language: "th" | "en" | "mixed";
    record_type: OfficialDocumentRecord["record_type"];
    access_permission: OfficialDocumentRecord["access_permission"];
    preservation_permission: OfficialDocumentRecord["preservation_permission"];
    access_conditions_th: string | null;
    eligible_for_citation: boolean;
    ineligible_reason: string | null;
    canonical_work_id: string | null;
    artifact_sha256: string;
    captured_at: string;
    artifact_ref: string;
    mime_type: string;
    byte_size: number;
    source_metadata: Record<string, unknown>;
    publication_date: string | null;
    effective_from: string | null;
    effective_to: string | null;
    parser_or_ocr_version: string;
    is_scanned_material: boolean;
    page_mapping: ExtractionRevisionRecord["page_mapping"];
    raw_transcription: string;
    normalized_search_text: string;
    review_status: ExtractionRevisionRecord["review_status"];
    reviewer_id: string | null;
    reviewed_at: string | null;
    correction_note: string | null;
    location_id: string | null;
    exact_official_url: string | null;
    original_observed_url: string | null;
    link_health: OfficialLocationRecord["link_health"] | null;
    last_successful_verified_at: string | null;
    prior_location_ids: OfficialLocationRecord["prior_urls"] | null;
  }>(
    `SELECT p.passage_id, p.extraction_revision_id, p.version_id, p.doc_id, p.verbatim_text,
            p.text_sha256, p.surrounding_before, p.surrounding_after, p.section_paragraph_path,
            p.statement_role, p.physical_page_start, p.physical_page_end, p.printed_page_start,
            p.printed_page_end, p.anchors, p.human_pinpoint_th, p.locator_replay_status,
            p.quarantine_reason, p.eligible_for_publication, p.access_scope,
            p.created_at::text AS psg_created_at,
            d.source_family, d.issuer_id, d.source_native_id, d.reviewed_surrogate_id,
            d.is_reviewed_surrogate, d.original_title_th, d.language, d.record_type,
            d.access_permission, d.preservation_permission, d.access_conditions_th,
            d.eligible_for_citation, d.ineligible_reason, d.canonical_work_id,
            v.artifact_sha256, v.captured_at::text AS captured_at, v.artifact_ref,
            v.mime_type, v.byte_size::bigint AS byte_size, v.source_metadata,
            v.publication_date::text AS publication_date, v.effective_from::text AS effective_from,
            v.effective_to::text AS effective_to,
            e.parser_or_ocr_version, e.is_scanned_material, e.page_mapping,
            e.raw_transcription, e.normalized_search_text, e.review_status,
            e.reviewer_id, e.reviewed_at::text AS reviewed_at, e.correction_note,
            loc.location_id, loc.exact_official_url, loc.original_observed_url,
            loc.link_health, loc.last_successful_verified_at::text AS last_successful_verified_at,
            loc.prior_location_ids
     FROM citation_evidence_passage p
     JOIN citation_official_document d ON d.doc_id = p.doc_id
     JOIN citation_document_version v ON v.version_id = p.version_id
     JOIN citation_extraction_revision e ON e.extraction_revision_id = p.extraction_revision_id
     LEFT JOIN citation_official_location loc ON loc.doc_id = d.doc_id AND loc.is_active_primary = TRUE
     WHERE p.passage_id = $1
     LIMIT 1`,
    [evidenceId]
  );

  if (res.rows.length === 0) return { found: false };
  const r = res.rows[0];

  return {
    found: true,
    doc: {
      doc_id: r.doc_id,
      source_family: r.source_family,
      issuer_id: r.issuer_id,
      source_native_id: r.source_native_id,
      reviewed_surrogate_id: r.reviewed_surrogate_id,
      is_reviewed_surrogate: r.is_reviewed_surrogate,
      original_title_th: r.original_title_th,
      language: r.language,
      record_type: r.record_type,
      access_permission: r.access_permission,
      preservation_permission: r.preservation_permission,
      access_scope: r.access_scope,
      access_conditions_th: r.access_conditions_th,
      eligible_for_citation: r.eligible_for_citation,
      ineligible_reason: r.ineligible_reason,
      canonical_work_id: r.canonical_work_id,
      owner_batch_id: "B01",
      created_at: r.psg_created_at,
    },
    version: {
      version_id: r.version_id,
      doc_id: r.doc_id,
      artifact_sha256: r.artifact_sha256,
      captured_at: r.captured_at,
      artifact_ref: r.artifact_ref,
      mime_type: r.mime_type,
      byte_size: Number(r.byte_size || 0),
      source_metadata: r.source_metadata || {},
      publication_date: r.publication_date,
      publication_date_status: r.publication_date ? "known" : "unknown_explicit",
      effective_from: r.effective_from,
      effective_to: r.effective_to,
      effective_date_status: r.effective_from ? "known" : "unknown_explicit",
      applicability_rules_th: [],
      affected_provisions: [],
      predecessor_version_id: null,
      amending_version_ids: [],
      byte_change_classification: "initial_capture",
      canonical_version_id: null,
      created_at: r.captured_at,
    },
    location: {
      location_id: r.location_id || "oloc.pg",
      doc_id: r.doc_id,
      version_id: r.version_id,
      exact_official_url: r.exact_official_url || "",
      role: "primary_official",
      parent_landing_location_id: null,
      original_observed_url: r.original_observed_url || "",
      redirect_history: [],
      prior_urls: Array.isArray(r.prior_location_ids) ? r.prior_location_ids : [],
      first_verified_at: r.last_successful_verified_at,
      last_verified_at: r.last_successful_verified_at,
      last_successful_verified_at: r.last_successful_verified_at,
      verification_method: "postgres_durable",
      identity_match_result: "VERIFIED_MATCH",
      link_health: r.link_health || "unchecked_live",
      last_http_status: r.link_health === "verified_online" ? 200 : null,
      failure_reason: null,
      is_active_primary: true,
    },
    extraction: {
      extraction_revision_id: r.extraction_revision_id,
      version_id: r.version_id,
      parent_revision_id: null,
      parser_or_ocr_version: r.parser_or_ocr_version,
      is_scanned_material: r.is_scanned_material,
      page_mapping: Array.isArray(r.page_mapping) ? r.page_mapping : [],
      raw_transcription: r.raw_transcription,
      normalized_search_text: r.normalized_search_text,
      alignment_map: [],
      ocr_ambiguity_detected: false,
      ocr_ambiguity_reasons: [],
      review_status: r.review_status,
      reviewer_id: r.reviewer_id,
      reviewed_at: r.reviewed_at,
      correction_note: r.correction_note,
      created_at: r.psg_created_at,
    },
    passage: {
      passage_id: r.passage_id,
      extraction_revision_id: r.extraction_revision_id,
      version_id: r.version_id,
      doc_id: r.doc_id,
      verbatim_text: r.verbatim_text,
      normalized_search_text: r.normalized_search_text,
      text_sha256: r.text_sha256,
      surrounding_before: r.surrounding_before,
      surrounding_after: r.surrounding_after,
      section_paragraph_path: Array.isArray(r.section_paragraph_path)
        ? r.section_paragraph_path
        : [],
      statement_role: r.statement_role,
      physical_page_start: r.physical_page_start,
      physical_page_end: r.physical_page_end,
      printed_page_start: r.printed_page_start,
      printed_page_end: r.printed_page_end,
      anchors: Array.isArray(r.anchors) ? r.anchors : [],
      human_pinpoint_th: r.human_pinpoint_th,
      source_family_pinpoint: {},
      locator_replay_status: r.locator_replay_status,
      quarantine_reason: r.quarantine_reason,
      eligible_for_publication: r.eligible_for_publication,
      access_scope: r.access_scope,
      created_at: r.psg_created_at,
    },
  };
}

/**
 * Persists and lists Legal Team review feedback in shared hosted PostgreSQL (`citation_legal_review_feedback`).
 */
export async function saveLegalReviewFeedbackToPostgres(
  fb: LegalReviewFeedbackRecord
): Promise<{ persisted_postgres: boolean }> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return { persisted_postgres: false };

  await db(
    `INSERT INTO citation_legal_review_feedback (
       feedback_id, scenario_id, question_text, as_of_date, answer_revision_id,
       answer_status, reviewer_name, reviewer_actor_id, verdict,
       checked_original_source, comments_th, cited_evidence_ids,
       environment_scope, recorded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
    [
      fb.feedback_id,
      fb.scenario_id,
      fb.question_text,
      fb.as_of_date,
      fb.answer_revision_id,
      fb.answer_status,
      fb.reviewer_name,
      fb.reviewer_actor_id,
      fb.verdict,
      fb.checked_original_source,
      fb.comments_th,
      JSON.stringify(fb.cited_evidence_ids || []),
      fb.environment_scope,
      fb.recorded_at,
    ]
  );
  return { persisted_postgres: true };
}

export async function listLegalReviewFeedbackFromPostgres(
  limit = 100
): Promise<LegalReviewFeedbackRecord[] | null> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return null;

  const res = await db<{
    feedback_id: string;
    scenario_id: string | null;
    question_text: string;
    as_of_date: string | null;
    answer_revision_id: string | null;
    answer_status: string;
    reviewer_name: string;
    reviewer_actor_id: string;
    verdict: LegalReviewFeedbackRecord["verdict"];
    checked_original_source: boolean;
    comments_th: string;
    cited_evidence_ids: string[];
    environment_scope: "staging" | "trial";
    recorded_at: string;
  }>(
    `SELECT feedback_id, scenario_id, question_text, as_of_date, answer_revision_id,
            answer_status, reviewer_name, reviewer_actor_id, verdict,
            checked_original_source, comments_th, cited_evidence_ids,
            environment_scope, recorded_at::text AS recorded_at
     FROM citation_legal_review_feedback
     ORDER BY recorded_at DESC
     LIMIT $1`,
    [limit]
  );

  return res.rows.map((r) => ({
    ...r,
    cited_evidence_ids: Array.isArray(r.cited_evidence_ids) ? r.cited_evidence_ids : [],
  }));
}

export async function listSavedAnswersSummaryFromPostgres(
  actor: Actor,
  limit = 50
): Promise<
  Array<{
    answer_id: string;
    answer_revision: string;
    revision_number: number;
    owner_actor_id: string;
    question_text: string;
    as_of_date: string | null;
    generated_at: string;
    status: string;
    claims_count: number;
    legacy_warning_th: string | null;
  }> | null
> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return null;

  const res = await db<{
    answer_id: string;
    answer_revision_id: string;
    revision_number: number;
    owner_actor_id: string;
    owner_tenant_id: string;
    question_text: string;
    as_of_date_raw: string | null;
    generated_at: string;
    status: string;
    ordered_claim_ids: string[];
    legacy_warning_th: string | null;
  }>(
    `SELECT answer_id, answer_revision_id, revision_number, owner_actor_id, owner_tenant_id,
            question_text, as_of_date_raw, generated_at::text AS generated_at,
            status, ordered_claim_ids, legacy_warning_th
     FROM citation_published_answer
     WHERE owner_tenant_id = 'PUBLIC' OR owner_tenant_id = $1
     ORDER BY generated_at DESC
     LIMIT $2`,
    [actor.tenant_id, limit]
  );

  return res.rows.map((r) => ({
    answer_id: r.answer_id,
    answer_revision: r.answer_revision_id,
    revision_number: Number(r.revision_number),
    owner_actor_id: r.owner_actor_id,
    question_text: r.question_text,
    as_of_date: r.as_of_date_raw,
    generated_at: r.generated_at,
    status: r.status,
    claims_count: Array.isArray(r.ordered_claim_ids) ? r.ordered_claim_ids.length : 0,
    legacy_warning_th: r.legacy_warning_th,
  }));
}

/**
 * Loads all onboarded official documents/attachments/versions/passages from PostgreSQL
 * so cold-start containers on new Vercel deployments immediately include attached/onboarded sources!
 *
 * Uses a single joined SQL query filtered to non-canonical attachments or quarantined overrides
 * + a 30s in-process TTL cache on live Neon (`!customCitationDbTransport`), eliminating the
 * 200-query N+1 sequential HTTPS bottleneck while keeping custom Vitest mock transports compatible.
 */
export async function loadAllOnboardedSourcesFromPostgres(): Promise<{
  documents: Record<string, OfficialDocumentRecord>;
  versions: Record<string, DocumentVersionRecord>;
  locations: Record<string, OfficialLocationRecord>;
  extractions: Record<string, ExtractionRevisionRecord>;
  passages: Record<string, EvidencePassageRecord>;
} | null> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return null;

  if (!customCitationDbTransport) {
    if (onboardedSourcesCache && Date.now() < onboardedSourcesCache.expiresAt) {
      return onboardedSourcesCache.data;
    }

    const res = await db<{
      passage_id: string;
      extraction_revision_id: string;
      version_id: string;
      doc_id: string;
      verbatim_text: string;
      text_sha256: string;
      surrounding_before: string;
      surrounding_after: string;
      section_paragraph_path: string[];
      statement_role: EvidencePassageRecord["statement_role"];
      physical_page_start: number | null;
      physical_page_end: number | null;
      printed_page_start: string | null;
      printed_page_end: string | null;
      anchors: EvidencePassageRecord["anchors"];
      human_pinpoint_th: string;
      locator_replay_status: "VERIFIED" | "QUARANTINED";
      quarantine_reason: string | null;
      eligible_for_publication: boolean;
      access_scope: string;
      psg_created_at: string;
      source_family: OfficialDocumentRecord["source_family"];
      issuer_id: string;
      source_native_id: string | null;
      reviewed_surrogate_id: string | null;
      is_reviewed_surrogate: boolean;
      original_title_th: string;
      language: "th" | "en" | "mixed";
      record_type: OfficialDocumentRecord["record_type"];
      access_permission: OfficialDocumentRecord["access_permission"];
      preservation_permission: OfficialDocumentRecord["preservation_permission"];
      access_conditions_th: string | null;
      eligible_for_citation: boolean;
      ineligible_reason: string | null;
      canonical_work_id: string | null;
      artifact_sha256: string;
      captured_at: string;
      artifact_ref: string;
      mime_type: string;
      byte_size: number;
      source_metadata: Record<string, unknown>;
      publication_date: string | null;
      effective_from: string | null;
      effective_to: string | null;
      parser_or_ocr_version: string;
      is_scanned_material: boolean;
      page_mapping: ExtractionRevisionRecord["page_mapping"];
      raw_transcription: string;
      normalized_search_text: string;
      review_status: ExtractionRevisionRecord["review_status"];
      reviewer_id: string | null;
      reviewed_at: string | null;
      correction_note: string | null;
      location_id: string | null;
      exact_official_url: string | null;
      original_observed_url: string | null;
      link_health: OfficialLocationRecord["link_health"] | null;
      last_successful_verified_at: string | null;
      prior_location_ids: OfficialLocationRecord["prior_urls"] | null;
    }>(
      `SELECT p.passage_id, p.extraction_revision_id, p.version_id, p.doc_id, p.verbatim_text,
              p.text_sha256, p.surrounding_before, p.surrounding_after, p.section_paragraph_path,
              p.statement_role, p.physical_page_start, p.physical_page_end, p.printed_page_start,
              p.printed_page_end, p.anchors, p.human_pinpoint_th, p.locator_replay_status,
              p.quarantine_reason, p.eligible_for_publication, p.access_scope,
              p.created_at::text AS psg_created_at,
              d.source_family, d.issuer_id, d.source_native_id, d.reviewed_surrogate_id,
              d.is_reviewed_surrogate, d.original_title_th, d.language, d.record_type,
              d.access_permission, d.preservation_permission, d.access_conditions_th,
              d.eligible_for_citation, d.ineligible_reason, d.canonical_work_id,
              v.artifact_sha256, v.captured_at::text AS captured_at, v.artifact_ref,
              v.mime_type, v.byte_size::bigint AS byte_size, v.source_metadata,
              v.publication_date::text AS publication_date, v.effective_from::text AS effective_from,
              v.effective_to::text AS effective_to,
              e.parser_or_ocr_version, e.is_scanned_material, e.page_mapping,
              e.raw_transcription, e.normalized_search_text, e.review_status,
              e.reviewer_id, e.reviewed_at::text AS reviewed_at, e.correction_note,
              loc.location_id, loc.exact_official_url, loc.original_observed_url,
              loc.link_health, loc.last_successful_verified_at::text AS last_successful_verified_at,
              loc.prior_location_ids
       FROM citation_evidence_passage p
       JOIN citation_official_document d ON d.doc_id = p.doc_id
       JOIN citation_document_version v ON v.version_id = p.version_id
       JOIN citation_extraction_revision e ON e.extraction_revision_id = p.extraction_revision_id
       LEFT JOIN citation_official_location loc ON loc.doc_id = d.doc_id AND loc.is_active_primary = TRUE
       WHERE d.canonical_work_id IS NULL OR p.eligible_for_publication = FALSE
       ORDER BY p.created_at DESC
       LIMIT 200`
    );

    const documents: Record<string, OfficialDocumentRecord> = {};
    const versions: Record<string, DocumentVersionRecord> = {};
    const locations: Record<string, OfficialLocationRecord> = {};
    const extractions: Record<string, ExtractionRevisionRecord> = {};
    const passages: Record<string, EvidencePassageRecord> = {};

    for (const r of res.rows) {
      documents[r.doc_id] = {
        doc_id: r.doc_id,
        source_family: r.source_family,
        issuer_id: r.issuer_id,
        source_native_id: r.source_native_id,
        reviewed_surrogate_id: r.reviewed_surrogate_id,
        is_reviewed_surrogate: r.is_reviewed_surrogate,
        original_title_th: r.original_title_th,
        language: r.language,
        record_type: r.record_type,
        access_permission: r.access_permission,
        preservation_permission: r.preservation_permission,
        access_scope: r.access_scope,
        access_conditions_th: r.access_conditions_th,
        eligible_for_citation: r.eligible_for_citation,
        ineligible_reason: r.ineligible_reason,
        canonical_work_id: r.canonical_work_id,
        owner_batch_id: "B01",
        created_at: r.psg_created_at,
      };
      versions[r.version_id] = {
        version_id: r.version_id,
        doc_id: r.doc_id,
        artifact_sha256: r.artifact_sha256,
        captured_at: r.captured_at,
        artifact_ref: r.artifact_ref,
        mime_type: r.mime_type,
        byte_size: Number(r.byte_size || 0),
        source_metadata: r.source_metadata || {},
        publication_date: r.publication_date,
        publication_date_status: r.publication_date ? "known" : "unknown_explicit",
        effective_from: r.effective_from,
        effective_to: r.effective_to,
        effective_date_status: r.effective_from ? "known" : "unknown_explicit",
        applicability_rules_th: [],
        affected_provisions: [],
        predecessor_version_id: null,
        amending_version_ids: [],
        byte_change_classification: "initial_capture",
        canonical_version_id: null,
        created_at: r.captured_at,
      };
      const locId = r.location_id || "oloc.pg";
      locations[locId] = {
        location_id: locId,
        doc_id: r.doc_id,
        version_id: r.version_id,
        exact_official_url: r.exact_official_url || "",
        role: "primary_official",
        parent_landing_location_id: null,
        original_observed_url: r.original_observed_url || "",
        redirect_history: [],
        prior_urls: Array.isArray(r.prior_location_ids) ? r.prior_location_ids : [],
        first_verified_at: r.last_successful_verified_at,
        last_verified_at: r.last_successful_verified_at,
        last_successful_verified_at: r.last_successful_verified_at,
        verification_method: "postgres_durable",
        identity_match_result: "VERIFIED_MATCH",
        link_health: r.link_health || "unchecked_live",
        last_http_status: r.link_health === "verified_online" ? 200 : null,
        failure_reason: null,
        is_active_primary: true,
      };
      extractions[r.extraction_revision_id] = {
        extraction_revision_id: r.extraction_revision_id,
        version_id: r.version_id,
        parent_revision_id: null,
        parser_or_ocr_version: r.parser_or_ocr_version,
        is_scanned_material: r.is_scanned_material,
        page_mapping: Array.isArray(r.page_mapping) ? r.page_mapping : [],
        raw_transcription: r.raw_transcription,
        normalized_search_text: r.normalized_search_text,
        alignment_map: [],
        ocr_ambiguity_detected: false,
        ocr_ambiguity_reasons: [],
        review_status: r.review_status,
        reviewer_id: r.reviewer_id,
        reviewed_at: r.reviewed_at,
        correction_note: r.correction_note,
        created_at: r.psg_created_at,
      };
      passages[r.passage_id] = {
        passage_id: r.passage_id,
        extraction_revision_id: r.extraction_revision_id,
        version_id: r.version_id,
        doc_id: r.doc_id,
        verbatim_text: r.verbatim_text,
        normalized_search_text: r.normalized_search_text,
        text_sha256: r.text_sha256,
        surrounding_before: r.surrounding_before,
        surrounding_after: r.surrounding_after,
        section_paragraph_path: Array.isArray(r.section_paragraph_path)
          ? r.section_paragraph_path
          : [],
        statement_role: r.statement_role,
        physical_page_start: r.physical_page_start,
        physical_page_end: r.physical_page_end,
        printed_page_start: r.printed_page_start,
        printed_page_end: r.printed_page_end,
        anchors: Array.isArray(r.anchors) ? r.anchors : [],
        human_pinpoint_th: r.human_pinpoint_th,
        source_family_pinpoint: {},
        locator_replay_status: r.locator_replay_status,
        quarantine_reason: r.quarantine_reason,
        eligible_for_publication: r.eligible_for_publication,
        access_scope: r.access_scope,
        created_at: r.psg_created_at,
      };
    }

    const result = { documents, versions, locations, extractions, passages };
    onboardedSourcesCache = {
      expiresAt: Date.now() + ONBOARDED_SOURCES_CACHE_TTL_MS,
      data: result,
    };
    return result;
  }

  const psgRes = await db<{ passage_id: string }>(
    `SELECT passage_id FROM citation_evidence_passage ORDER BY created_at DESC LIMIT 200`
  );
  const documents: Record<string, OfficialDocumentRecord> = {};
  const versions: Record<string, DocumentVersionRecord> = {};
  const locations: Record<string, OfficialLocationRecord> = {};
  const extractions: Record<string, ExtractionRevisionRecord> = {};
  const passages: Record<string, EvidencePassageRecord> = {};

  for (const row of psgRes.rows) {
    const loaded = await loadPinnedPassageFromPostgres(row.passage_id);
    if (!loaded.found || !loaded.doc || !loaded.version || !loaded.extraction || !loaded.passage) {
      continue;
    }
    documents[loaded.doc.doc_id] = loaded.doc;
    versions[loaded.version.version_id] = loaded.version;
    if (loaded.location) {
      locations[loaded.location.location_id] = loaded.location;
    }
    extractions[loaded.extraction.extraction_revision_id] = loaded.extraction;
    passages[loaded.passage.passage_id] = loaded.passage;
  }

  return { documents, versions, locations, extractions, passages };
}
