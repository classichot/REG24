/**
 * REG24 Batch 1 RC10.3 P0-2 — Read-Only Neon Audit Receipt for QA's Locked Two-Session Concurrency Run
 *
 * Strictly READ-ONLY (`SELECT` queries only — ZERO INSERT / UPDATE / DELETE!).
 * Usage:
 *   npx tsx scripts/audit-rc10-3-qa-two-session-readonly.ts --answer-id <ans.xxx> [--rejected-text "<substring>"] [--rejected-key "<op-key>"] [--out <path.json>]
 *
 * Produces an independent DB-side receipt tied to QA's locked two-session run verifying:
 *  - Exact list of committed revisions in `citation_published_answer` for `answer_id`,
 *  - Exact row counts across `citation_published_answer`, `citation_atomic_claim`,
 *    `citation_claim_evidence_link`, and `citation_audit_event`,
 *  - ZERO orphaned child rows (every claim, link, and audit event belongs to a committed revision),
 *  - ZERO answer/claim/citation/audit rows attributable to the rejected concurrent edit,
 *  - Exact Neon readback of the winning revision (answer text, claims, citations, provenance, audit trail).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveActiveCitationDbTransport } from "../src/core/knowledge/citation-postgres-store";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

async function main() {
  loadDotEnvLocal();
  const answerId = getArg("--answer-id");
  const startingRevArg = getArg("--starting-revision");
  const winningKey = getArg("--winning-key");
  const rejectedText = getArg("--rejected-text");
  const rejectedKey = getArg("--rejected-key");
  const expectedOwnerActorId = getArg("--owner-actor-id");
  const outPath = getArg("--out");

  if (!answerId) {
    console.error(
      "Usage: npx tsx scripts/audit-rc10-3-qa-two-session-readonly.ts --answer-id <ans.xxx> [--starting-revision <ans.xxx.r1>] [--winning-key <key>] [--rejected-key <key>] [--rejected-text <substr>] [--owner-actor-id <actor>] [--out <file.json>]"
    );
    process.exit(1);
  }

  const db = resolveActiveCitationDbTransport();
  if (!db) {
    throw new Error("DATABASE_URL is not configured; cannot run read-only Neon audit.");
  }

  const ansRes = await db<{
    answer_revision_id: string;
    answer_id: string;
    revision_number: number;
    supersedes_revision_id: string | null;
    status: string;
    rendered_answer_th: string;
    release_id: string;
    owner_actor_id: string;
    save_operation_key: string | null;
    save_payload_sha256: string | null;
    generated_at: string;
    execution_provenance: unknown;
  }>(
    `SELECT answer_revision_id, answer_id, revision_number, supersedes_revision_id,
            status, rendered_answer_th, release_id, owner_actor_id,
            save_operation_key, save_payload_sha256, generated_at::text AS generated_at,
            execution_provenance
       FROM citation_published_answer
      WHERE answer_id = $1
      ORDER BY revision_number ASC`,
    [answerId]
  );

  const revIds = ansRes.rows.map((r) => r.answer_revision_id);
  const clmRes = await db<{
    claim_id: string;
    answer_revision_id: string;
    display_order: number;
    displayed_claim_text: string;
    verification_decision: string;
    published: boolean;
  }>(
    `SELECT claim_id, answer_revision_id, display_order, displayed_claim_text,
            verification_decision, published
       FROM citation_atomic_claim
      WHERE answer_revision_id LIKE $1
      ORDER BY answer_revision_id ASC, display_order ASC`,
    [`${answerId}.r%`]
  );

  const lnkRes = await db<{
    link_id: string;
    answer_revision_id: string;
    claim_id: string;
    passage_id: string;
    version_id: string;
    citation_label_th: string;
    official_url: string;
  }>(
    `SELECT link_id, answer_revision_id, claim_id, passage_id, version_id,
            citation_label_th, official_url
       FROM citation_claim_evidence_link
      WHERE answer_revision_id LIKE $1
      ORDER BY answer_revision_id ASC, link_id ASC`,
    [`${answerId}.r%`]
  );

  const audRes = await db<{
    audit_id: string;
    correlation_id: string;
    event_type: string;
    actor_or_service: string;
    recorded_at: string;
    reason: string | null;
  }>(
    `SELECT audit_id, correlation_id, event_type, actor_or_service,
            recorded_at::text AS recorded_at, reason
       FROM citation_audit_event
      WHERE correlation_id LIKE $1
      ORDER BY recorded_at ASC`,
    [`${answerId}.r%`]
  );

  const revSet = new Set(revIds);
  const orphanClaims = clmRes.rows.filter((c) => !revSet.has(c.answer_revision_id));
  const orphanLinks = lnkRes.rows.filter((l) => !revSet.has(l.answer_revision_id));
  const orphanAudits = audRes.rows.filter((a) => !revSet.has(a.correlation_id));

  const startingRevId = startingRevArg || `${answerId}.r1`;
  const startingRow = ansRes.rows.find((r) => r.answer_revision_id === startingRevId) || null;
  const startingClaims = startingRow
    ? clmRes.rows.filter((c) => c.answer_revision_id === startingRow.answer_revision_id)
    : [];
  const startingLinks = startingRow
    ? lnkRes.rows.filter((l) => l.answer_revision_id === startingRow.answer_revision_id)
    : [];

  const winningRow =
    (winningKey
      ? ansRes.rows.find(
          (r) =>
            r.save_operation_key === winningKey &&
            r.supersedes_revision_id === startingRevId
        )
      : ansRes.rows.find((r) => r.supersedes_revision_id === startingRevId)) || null;
  const winner = winningRow || ansRes.rows[ansRes.rows.length - 1] || null;
  const winnerClaims = winner
    ? clmRes.rows.filter((c) => c.answer_revision_id === winner.answer_revision_id)
    : [];
  const winnerLinks = winner
    ? lnkRes.rows.filter((l) => l.answer_revision_id === winner.answer_revision_id)
    : [];
  const winnerAudits = winner
    ? audRes.rows.filter((a) => a.correlation_id === winner.answer_revision_id)
    : [];

  const rejectedAnswerRows = ansRes.rows.filter(
    (r) =>
      (rejectedKey && r.save_operation_key === rejectedKey) ||
      (rejectedText && r.rendered_answer_th.includes(rejectedText))
  );
  const rejectedRevIdSet = new Set(rejectedAnswerRows.map((r) => r.answer_revision_id));
  const rejectedMatches = {
    answer_rows: rejectedAnswerRows.length,
    claim_rows: clmRes.rows.filter(
      (c) =>
        rejectedRevIdSet.has(c.answer_revision_id) ||
        Boolean(rejectedText && c.displayed_claim_text.includes(rejectedText))
    ).length,
    citation_link_rows: lnkRes.rows.filter(
      (l) =>
        rejectedRevIdSet.has(l.answer_revision_id) ||
        !revSet.has(l.answer_revision_id)
    ).length,
    successful_write_audit_rows: audRes.rows.filter(
      (a) =>
        rejectedRevIdSet.has(a.correlation_id) ||
        Boolean(
          (rejectedKey && a.reason && a.reason.includes(rejectedKey)) ||
            (rejectedText && a.reason && a.reason.includes(rejectedText))
        )
    ).length,
  };

  const startingRowPositivelyIdentified = Boolean(
    startingRow &&
      (!expectedOwnerActorId || startingRow.owner_actor_id === expectedOwnerActorId)
  );
  const winningRevisionPositivelyIdentified = Boolean(
    winningRow &&
      winningRow.supersedes_revision_id === startingRevId &&
      (!expectedOwnerActorId || winningRow.owner_actor_id === expectedOwnerActorId) &&
      (!winningKey || winningRow.save_operation_key === winningKey)
  );
  const sameOwnerForStartAndWinner = Boolean(
    startingRow && winningRow && startingRow.owner_actor_id === winningRow.owner_actor_id
  );
  const zeroOrphans =
    orphanClaims.length === 0 && orphanLinks.length === 0 && orphanAudits.length === 0;
  const zeroRejectedWrites =
    rejectedMatches.answer_rows === 0 &&
    rejectedMatches.claim_rows === 0 &&
    rejectedMatches.citation_link_rows === 0 &&
    rejectedMatches.successful_write_audit_rows === 0;
  const allPositiveAssertionsPassed =
    startingRowPositivelyIdentified &&
    winningRevisionPositivelyIdentified &&
    sameOwnerForStartAndWinner &&
    zeroOrphans &&
    zeroRejectedWrites;

  const receipt = {
    schema_version: "reg24.rc10_3.qa_two_session_readonly_neon_audit.v2",
    audited_at: new Date().toISOString(),
    readonly_mode: true,
    answer_id: answerId,
    positive_verification_assertions: {
      starting_row_positively_identified: startingRowPositivelyIdentified,
      winning_revision_positively_identified: winningRevisionPositivelyIdentified,
      same_owner_for_start_and_winner: sameOwnerForStartAndWinner,
      zero_orphaned_child_rows: zeroOrphans,
      zero_rejected_revision_claim_link_or_write_audit_rows: zeroRejectedWrites,
      non_empty_match_guard_passed: ansRes.rows.length >= 2 && startingRowPositivelyIdentified && winningRevisionPositivelyIdentified,
      all_assertions_passed: allPositiveAssertionsPassed,
    },
    starting_revision_row: startingRow
      ? {
          answer_revision_id: startingRow.answer_revision_id,
          revision_number: startingRow.revision_number,
          owner_actor_id: startingRow.owner_actor_id,
          release_id: startingRow.release_id,
          save_operation_key: startingRow.save_operation_key,
          save_payload_sha256: startingRow.save_payload_sha256,
          generated_at: startingRow.generated_at,
          claims_count: startingClaims.length,
          citations_count: startingLinks.length,
        }
      : null,
    table_counts: {
      citation_published_answer: ansRes.rows.length,
      citation_atomic_claim: clmRes.rows.length,
      citation_claim_evidence_link: lnkRes.rows.length,
      citation_audit_event: audRes.rows.length,
    },
    orphaned_child_rows: {
      claims: orphanClaims.length,
      evidence_links: orphanLinks.length,
      audit_events: orphanAudits.length,
      zero_orphans: zeroOrphans,
    },
    rejected_edit_leak_check: {
      checked_winning_key: winningKey,
      checked_rejected_key: rejectedKey,
      checked_rejected_text_substring: rejectedText,
      writes_attributable_to_rejected_edit: rejectedMatches,
      zero_rejected_edit_writes: zeroRejectedWrites,
    },
    committed_revisions: ansRes.rows.map((r) => ({
      answer_revision_id: r.answer_revision_id,
      revision_number: r.revision_number,
      supersedes_revision_id: r.supersedes_revision_id,
      owner_actor_id: r.owner_actor_id,
      release_id: r.release_id,
      status: r.status,
      save_operation_key: r.save_operation_key,
      generated_at: r.generated_at,
    })),
    winning_revision_neon_readback: winner
      ? {
          answer_revision_id: winner.answer_revision_id,
          revision_number: winner.revision_number,
          supersedes_revision_id: winner.supersedes_revision_id,
          owner_actor_id: winner.owner_actor_id,
          save_operation_key: winner.save_operation_key,
          save_payload_sha256: winner.save_payload_sha256,
          release_id: winner.release_id,
          rendered_answer_th: winner.rendered_answer_th,
          claims_count: winnerClaims.length,
          citations_count: winnerLinks.length,
          audit_events_count: winnerAudits.length,
          audit_ids: winnerAudits.map((a) => ({
            audit_id: a.audit_id,
            event_type: a.event_type,
            recorded_at: a.recorded_at,
          })),
          execution_provenance: winner.execution_provenance,
          citations: winnerLinks.map((l) => ({
            link_id: l.link_id,
            passage_id: l.passage_id,
            version_id: l.version_id,
            citation_label_th: l.citation_label_th,
            official_url: l.official_url,
          })),
        }
      : null,
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(receipt, null, 2));
  }
  console.log(JSON.stringify(receipt, null, 2));
  if (!allPositiveAssertionsPassed) {
    console.error("READONLY_NEON_AUDIT_FAILED: Positive starting/winning row match or zero-rejected-write check failed.");
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
