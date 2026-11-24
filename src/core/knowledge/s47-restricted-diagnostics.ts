/**
 * Restricted Server-Side Diagnostics for Revenue Code Section 47 (`มาตรา 47`) Verifier.
 *
 * SECURITY INVARIANT (Candidate 5 Exit Criterion #5):
 *   - Every §47 evaluation / suppression logs extracted facts, authorized amounts, draft numeric tokens,
 *     the rejected token (if any), and the stage-specific code STRICTLY server-side (structured server log
 *     `[REG24_S47_RESTRICTED_DIAG]` + restricted Neon PostgreSQL table `s47_verifier_restricted_diagnostics`).
 *   - NEVER expose raw rejected numeric tokens or rows from `s47_verifier_restricted_diagnostics`
 *     to any UI component, `/api/v1/knowledge/query`, `/api/v1/knowledge/answers`, or saved revision!
 */

import { resolveActiveCitationDbTransport } from "./citation-postgres-store";
import type { Section47ExtractedFacts } from "./tax-calculation-verifier";

export type Section47DiagnosticStageCode =
  | "S47_VERIFIED_PASS"
  | "S47_FACT_EXTRACTION_CLARIFICATION"
  | "S47_AUTHORIZED_SET_TOTAL_MISMATCH"
  | "S47_SUBCLAUSE_AMOUNT_MISMATCH"
  | "S47_TOKEN_NOT_IN_AUTHORIZED_SET";

export interface Section47RestrictedDiagnosticRecord {
  diag_id: string;
  trace_id: string;
  issue_id: string;
  outcome: "PASSED" | "SUPPRESSED" | "CLARIFICATION_REQUIRED";
  stage_code: Section47DiagnosticStageCode;
  cleaned_active_text: string;
  extracted_facts: Section47ExtractedFacts;
  authorized_valid_amounts_thb: number[];
  expected_total_thb: number | null;
  draft_numeric_tokens: string[];
  rejected_token: string | null;
  qa_synthetic_fixture: string | null;
  recorded_at: string;
}

const MAX_RING_BUFFER = 200;
const inMemoryRingBuffer: Section47RestrictedDiagnosticRecord[] = [];
let tableEnsured = false;

export function recordSection47RestrictedDiagnostic(
  entry: Omit<Section47RestrictedDiagnosticRecord, "diag_id" | "recorded_at">
): Section47RestrictedDiagnosticRecord {
  const recordedAt = new Date().toISOString();
  const fullRecord: Section47RestrictedDiagnosticRecord = {
    diag_id: `s47diag.${entry.trace_id}.${entry.issue_id}.${Date.now().toString(36)}`,
    recorded_at: recordedAt,
    ...entry,
  };

  inMemoryRingBuffer.push(fullRecord);
  if (inMemoryRingBuffer.length > MAX_RING_BUFFER) {
    inMemoryRingBuffer.splice(0, inMemoryRingBuffer.length - MAX_RING_BUFFER);
  }

  // Server-side structured log (restricted to server stdout / Vercel function logs)
  console.info("[REG24_S47_RESTRICTED_DIAG]", JSON.stringify(fullRecord));

  // Best-effort async write to restricted Neon table (awaited via flush helper when needed in route)
  const pendingWrite = persistSection47DiagnosticToNeon(fullRecord).catch((err) => {
    console.warn(
      "[REG24_S47_RESTRICTED_DIAG_DB_WARN]",
      err instanceof Error ? err.message : String(err)
    );
  });
  pendingDiagWrites.add(pendingWrite);
  void pendingWrite.finally(() => {
    pendingDiagWrites.delete(pendingWrite);
  });

  return fullRecord;
}

const pendingDiagWrites = new Set<Promise<void>>();

export async function flushPendingSection47RestrictedDiagnostics(): Promise<void> {
  if (pendingDiagWrites.size === 0) return;
  await Promise.allSettled(Array.from(pendingDiagWrites));
}

async function persistSection47DiagnosticToNeon(
  rec: Section47RestrictedDiagnosticRecord
): Promise<void> {
  const db = resolveActiveCitationDbTransport();
  if (!db) return;

  if (!tableEnsured) {
    await db(
      `CREATE TABLE IF NOT EXISTS s47_verifier_restricted_diagnostics (
         diag_id TEXT PRIMARY KEY,
         trace_id TEXT NOT NULL,
         issue_id TEXT NOT NULL,
         outcome TEXT NOT NULL,
         stage_code TEXT NOT NULL,
         cleaned_active_text TEXT NOT NULL,
         extracted_facts_json JSONB NOT NULL,
         authorized_amounts_json JSONB NOT NULL,
         expected_total_thb BIGINT,
         draft_numeric_tokens_json JSONB NOT NULL,
         rejected_token TEXT,
         qa_synthetic_fixture TEXT,
         recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      []
    );
    tableEnsured = true;
  }

  await db(
    `INSERT INTO s47_verifier_restricted_diagnostics (
       diag_id, trace_id, issue_id, outcome, stage_code,
       cleaned_active_text, extracted_facts_json, authorized_amounts_json,
       expected_total_thb, draft_numeric_tokens_json, rejected_token,
       qa_synthetic_fixture, recorded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12,$13)
     ON CONFLICT (diag_id) DO NOTHING`,
    [
      rec.diag_id,
      rec.trace_id,
      rec.issue_id,
      rec.outcome,
      rec.stage_code,
      rec.cleaned_active_text,
      JSON.stringify(rec.extracted_facts),
      JSON.stringify(rec.authorized_valid_amounts_thb),
      rec.expected_total_thb,
      JSON.stringify(rec.draft_numeric_tokens),
      rec.rejected_token,
      rec.qa_synthetic_fixture,
      rec.recorded_at,
    ]
  );
}

/** Server/test-only inspection of recent §47 diagnostics (NEVER wired to any HTTP route). */
export function getRecentSection47RestrictedDiagnostics(): Section47RestrictedDiagnosticRecord[] {
  return [...inMemoryRingBuffer];
}

/** Test-only reset for deterministic unit assertions. */
export function clearSection47RestrictedDiagnosticsForTest(): void {
  inMemoryRingBuffer.length = 0;
}
