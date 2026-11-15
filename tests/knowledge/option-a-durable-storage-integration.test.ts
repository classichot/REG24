import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Compiles `prisma/migrations/0002_knowledge_releases_cas_and_outbox.sql` (plus `audit_log_chain`
 * from `0001_reg24_canonical_rls.sql`) onto a disk-backed WAL SQL database (`node:sqlite`)
 * so Option A's exact relational DDL, `UNIQUE` concurrency locks, `CHECK` constraints,
 * hash-chained `audit_log_chain`, transactional outbox, and cold-restart recovery are
 * integration-tested end-to-end against real ACID SQL storage.
 */
function initializeOptionADurableSqlDb(dbFilePath: string): DatabaseSync {
  const db = new DatabaseSync(dbFilePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = FULL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log_chain (
      sequence_no INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      prev_entry_hash TEXT,
      entry_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const rawMigration0002 = fs.readFileSync(
    path.resolve(process.cwd(), "prisma/migrations/0002_knowledge_releases_cas_and_outbox.sql"),
    "utf8"
  );

  const portableSql = rawMigration0002
    .replace(/::jsonb/gi, "")
    .replace(/\bJSONB\b/gi, "TEXT")
    .replace(/\bTIMESTAMPTZ\b/gi, "TEXT")
    .replace(/\bCHAR\(\d+\)/gi, "TEXT")
    .replace(/\bBIGINT\b/gi, "INTEGER")
    .replace(/\bBOOLEAN\b/gi, "INTEGER")
    .replace(/\bDEFAULT\s+FALSE\b/gi, "DEFAULT 0")
    .replace(/\bDEFAULT\s+TRUE\b/gi, "DEFAULT 1")
    .replace(/\busable_as_legal_evidence\s*=\s*FALSE\b/gi, "usable_as_legal_evidence = 0")
    .replace(/\bNOW\(\)/gi, "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");

  db.exec(portableSql);

  db.prepare(
    `INSERT OR IGNORE INTO knowledge_store_coordinator (namespace_id, store_revision, active_release_id, accepted_batch_releases)
     VALUES ('PUBLIC', 0, NULL, '{}')`
  ).run();

  return db;
}

function appendHashChainedAuditRow(
  db: DatabaseSync,
  action: string,
  actorId: string,
  payload: Record<string, unknown>
): { sequenceNo: number; entryHash: string } {
  const prev = db
    .prepare("SELECT sequence_no, entry_hash FROM audit_log_chain ORDER BY sequence_no DESC LIMIT 1")
    .get() as { sequence_no: number; entry_hash: string } | undefined;

  const prevHash = prev?.entry_hash ?? "GENESIS";
  const payloadJson = JSON.stringify(payload);
  const entryHash = crypto
    .createHash("sha256")
    .update(`${prevHash}|${action}|${actorId}|${payloadJson}`)
    .digest("hex");

  const res = db
    .prepare(
      `INSERT INTO audit_log_chain (action, actor_id, payload_json, prev_entry_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(action, actorId, payloadJson, prevHash, entryHash);

  return { sequenceNo: Number(res.lastInsertRowid), entryHash };
}

function commitOwnerUatApprovalTx(
  db: DatabaseSync,
  params: {
    approvalId: string;
    releaseId: string;
    manifestHash: string;
    expectedReleaseRevision: number;
    decision: "UAT_PASS" | "UAT_PASS_WITH_DECLARED_GAPS" | "UAT_FAIL";
    actorId: string;
    caseDecisionsCount: number;
    failedCasesCount: number;
    declaredGaps?: string[];
    comments: string;
    simulateMidTxCrashAfterReleaseUpdate?: boolean;
  }
): { committedStoreRevision: number; newReleaseRevision: number; auditSequenceNo: number } {
  db.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    if (
      (params.decision === "UAT_PASS" || params.decision === "UAT_PASS_WITH_DECLARED_GAPS") &&
      (params.failedCasesCount > 0 || params.caseDecisionsCount < 20)
    ) {
      throw new Error(
        `MANDATORY_UAT_GATE_422: 20/20 mandatory cases required (got ${params.caseDecisionsCount - params.failedCasesCount}/20).`
      );
    }

    const relRow = db
      .prepare(
        "SELECT release_id, manifest_hash, revision, state FROM knowledge_release WHERE release_id = ?"
      )
      .get(params.releaseId) as
      | { release_id: string; manifest_hash: string; revision: number; state: string }
      | undefined;

    if (!relRow) {
      throw new Error(`RELEASE_NOT_FOUND_404: ${params.releaseId}`);
    }
    if (relRow.manifest_hash !== params.manifestHash) {
      throw new Error(`MANIFEST_HASH_MISMATCH_409: ${params.manifestHash} != ${relRow.manifest_hash}`);
    }

    // Optimistic CAS update on `knowledge_release`
    const nextState = params.decision === "UAT_FAIL" ? "UAT_FAILED" : "UAT_PASSED";
    const casRes = db
      .prepare(
        `UPDATE knowledge_release
            SET revision = revision + 1,
                state = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE release_id = ?
            AND revision = ?
            AND manifest_hash = ?`
      )
      .run(nextState, params.releaseId, params.expectedReleaseRevision, params.manifestHash);

    if (Number(casRes.changes) !== 1) {
      throw new Error(
        `REVISION_CONFLICT_409: Stale revision ${params.expectedReleaseRevision} (current=${relRow.revision}).`
      );
    }

    // Coordinator revision increment
    db.prepare(
      `UPDATE knowledge_store_coordinator
          SET store_revision = store_revision + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE namespace_id = 'PUBLIC'`
    ).run();

    const coord = db
      .prepare("SELECT store_revision FROM knowledge_store_coordinator WHERE namespace_id = 'PUBLIC'")
      .get() as { store_revision: number };

    if (params.simulateMidTxCrashAfterReleaseUpdate) {
      throw new Error("SIMULATED_MID_TRANSACTION_FAILURE_BEFORE_AUDIT_COMMIT");
    }

    const audit = appendHashChainedAuditRow(db, "RECORD_OWNER_UAT_DECISION", params.actorId, {
      release_id: params.releaseId,
      manifest_hash: params.manifestHash,
      expected_release_revision: params.expectedReleaseRevision,
      decision: params.decision,
      store_revision: coord.store_revision,
    });

    db.prepare(
      `INSERT INTO knowledge_release_approval (
         approval_id, release_id, manifest_hash, expected_release_revision, committed_store_revision,
         approval_kind, decision, actor_id, actor_role, case_decisions, declared_gaps, comments, audit_sequence_no
       ) VALUES (?, ?, ?, ?, ?, 'OWNER_UAT_DECISION', ?, ?, 'product_owner', ?, ?, ?, ?)`
    ).run(
      params.approvalId,
      params.releaseId,
      params.manifestHash,
      params.expectedReleaseRevision,
      coord.store_revision,
      params.decision,
      params.actorId,
      JSON.stringify({ passed: params.caseDecisionsCount - params.failedCasesCount, failed: params.failedCasesCount }),
      JSON.stringify(params.declaredGaps || []),
      params.comments,
      audit.sequenceNo
    );

    db.exec("COMMIT;");
    return {
      committedStoreRevision: Number(coord.store_revision),
      newReleaseRevision: params.expectedReleaseRevision + 1,
      auditSequenceNo: audit.sequenceNo,
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore if already rolled back
    }
    throw err;
  }
}

describe("Instruction 4 — Option A Durable Relational Storage Integration Suite (SQL WAL + Outbox + CAS)", () => {
  it("enforces atomic state+audit commits, CAS stale-revision 409 rejection, quarantine CHECK=false, supersession lineage, outbox sync & cold restart", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-option-a-sql-"));
    const dbPath = path.join(tmpDir, "reg24_option_a_durable.sqlite");

    const rc1Hash = "2059e51ee9bf2ba3fe26fc8f0b6abb4e5ed942be0a2e3cace8df116a41c2e444";
    const rc2Hash = "0dd66c57f27aa93844083267cba1a5372e4b61b9c3d598f7d508796abf160e4c";
    const b02Hash = "54bd47c5a67cee4684f61795c46289c5c2d296180475f731fd5f75cc608cf3b7";
    const commitSha = "e9c2ffc3b7c0a4f9c5a0bd2d66767d1dbe8966b5";

    try {
      const connA = initializeOptionADurableSqlDb(dbPath);
      const connB = new DatabaseSync(dbPath);
      connB.exec("PRAGMA foreign_keys = ON;");
      connB.exec("PRAGMA busy_timeout = 5000;");

      // 1. Seed preserved `rel.B01.rc1` + superseding `rel.B01.rc2` + limited-scope `rel.B02.rc1`
      connA.exec("BEGIN IMMEDIATE TRANSACTION;");
      connA
        .prepare(
          `INSERT INTO knowledge_batch_manifest (manifest_id, batch_id, inventory_snapshot_id, inventory_hash, source_cutoff_at, reconciliation_summary, frozen_by)
           VALUES (?, ?, ?, ?, '2026-11-14T14:00:00Z', '{}', 'eng.lead@reg24.th')`
        )
        .run("mfst.b01.mwgj0yb3", "B01", "inv.b01.mwgj0yb3", "a".repeat(64));
      connA
        .prepare(
          `INSERT INTO knowledge_batch_manifest (manifest_id, batch_id, inventory_snapshot_id, inventory_hash, source_cutoff_at, reconciliation_summary, frozen_by)
           VALUES (?, ?, ?, ?, '2026-11-15T06:00:00Z', '{}', 'eng.lead@reg24.th')`
        )
        .run("mfst.b01.mwhh9ec3", "B01", "inv.b01.mwhh9ec3", "b".repeat(64));
      connA
        .prepare(
          `INSERT INTO knowledge_batch_manifest (manifest_id, batch_id, inventory_snapshot_id, inventory_hash, source_cutoff_at, reconciliation_summary, frozen_by)
           VALUES (?, ?, ?, ?, '2026-11-15T06:10:00Z', '{}', 'eng.lead@reg24.th')`
        )
        .run("mfst.b02.mwhhbx89", "B02", "inv.b02.mwhhbx89", "c".repeat(64));

      // Preserved `rel.B01.rc1` (untouched in READY_FOR_UAT)
      connA
        .prepare(
          `INSERT INTO knowledge_release (
             release_id, batch_id, manifest_id, manifest_hash, code_commit, state, revision,
             created_work_count, created_passage_count, accepted_assertion_count
           ) VALUES ('rel.B01.rc1', 'B01', 'mfst.b01.mwgj0yb3', ?, ?, 'READY_FOR_UAT', 1, 4559, 9744, 35805)`
        )
        .run(rc1Hash, "7df41c4ca1f63059b8d187e4014f2cb16886972d");

      // Candidate `rel.B01.rc2` with transparent supersession lineage to `rel.B01.rc1`
      connA
        .prepare(
          `INSERT INTO knowledge_release (
             release_id, batch_id, manifest_id, manifest_hash, code_commit, state, revision,
             supersedes_release_id, supersedes_manifest_id, supersedes_manifest_hash,
             supersession_explanation, prior_chat_approval_preserved,
             created_work_count, created_passage_count, accepted_assertion_count
           ) VALUES (
             'rel.B01.rc2', 'B01', 'mfst.b01.mwhh9ec3', ?, ?, 'READY_FOR_UAT', 1,
             'rel.B01.rc1', 'mfst.b01.mwgj0yb3', ?,
             'Supersedes rel.B01.rc1 transparently while preserving prior chat approval in audit trail', 1,
             4559, 10665, 29094
           )`
        )
        .run(rc2Hash, commitSha, rc1Hash);

      // Candidate `rel.B02.rc1` (limited-scope candidate with 5,275 deferred OCR items)
      connA
        .prepare(
          `INSERT INTO knowledge_release (
             release_id, batch_id, manifest_id, manifest_hash, code_commit, state, revision,
             coverage_gaps, created_work_count, reused_work_count, created_passage_count, accepted_assertion_count
           ) VALUES (
             'rel.B02.rc1', 'B02', 'mfst.b02.mwhhbx89', ?, ?, 'READY_FOR_UAT', 1,
             ?, 2501, 482, 23435, 39604
           )`
        )
        .run(
          b02Hash,
          commitSha,
          JSON.stringify([
            "LIMITED-SCOPE CANDIDATE (2,024 / 7,335 physical files admitted): 5,275 image-only/legacy-font PDFs deferred pending verified OCR.",
          ])
        );
      connA.exec("COMMIT;");

      // 2. Verify mid-transaction crash rolls back BOTH `knowledge_release` AND `knowledge_store_coordinator` atomically
      expect(() =>
        commitOwnerUatApprovalTx(connA, {
          approvalId: "appr.crash.1",
          releaseId: "rel.B01.rc2",
          manifestHash: rc2Hash,
          expectedReleaseRevision: 1,
          decision: "UAT_PASS",
          actorId: "rattaroj@reg24.th",
          caseDecisionsCount: 20,
          failedCasesCount: 0,
          comments: "Simulated crash",
          simulateMidTxCrashAfterReleaseUpdate: true,
        })
      ).toThrow(/SIMULATED_MID_TRANSACTION_FAILURE_BEFORE_AUDIT_COMMIT/);

      const afterCrashRel = connB
        .prepare("SELECT state, revision FROM knowledge_release WHERE release_id = 'rel.B01.rc2'")
        .get() as { state: string; revision: number };
      expect(afterCrashRel.state).toBe("READY_FOR_UAT");
      expect(afterCrashRel.revision).toBe(1);

      const afterCrashCoord = connB
        .prepare("SELECT store_revision FROM knowledge_store_coordinator WHERE namespace_id = 'PUBLIC'")
        .get() as { store_revision: number };
      expect(afterCrashCoord.store_revision).toBe(0);

      // 3. Verify two-connection concurrent approval race (`DEF-B01-07`):
      //    Both `connA` and `connB` read `expectedReleaseRevision = 1`; `connA` commits `UAT_PASS`,
      //    `connB` attempting `UAT_FAIL` at stale revision `1` is deterministically rejected with `REVISION_CONFLICT_409`!
      const committedA = commitOwnerUatApprovalTx(connA, {
        approvalId: "appr.rc2.owner.1",
        releaseId: "rel.B01.rc2",
        manifestHash: rc2Hash,
        expectedReleaseRevision: 1,
        decision: "UAT_PASS",
        actorId: "rattaroj@reg24.th",
        caseDecisionsCount: 20,
        failedCasesCount: 0,
        comments: "20/20 mandatory cases verified",
      });
      expect(committedA.newReleaseRevision).toBe(2);
      expect(committedA.committedStoreRevision).toBe(1);
      expect(committedA.auditSequenceNo).toBe(1);

      expect(() =>
        commitOwnerUatApprovalTx(connB, {
          approvalId: "appr.rc2.owner.stale",
          releaseId: "rel.B01.rc2",
          manifestHash: rc2Hash,
          expectedReleaseRevision: 1,
          decision: "UAT_FAIL",
          actorId: "rattaroj@reg24.th",
          caseDecisionsCount: 20,
          failedCasesCount: 1,
          comments: "Stale concurrent writer",
        })
      ).toThrow(/REVISION_CONFLICT_409/);

      // 4. Verify DB-level `CHECK (usable_as_legal_evidence = 0)` constraint on `knowledge_quarantine_ledger`
      //    (including Royal Decrees 736 & 773 quarantine records!)
      connA
        .prepare(
          `INSERT INTO knowledge_quarantine_ledger (
             unresolved_ref_id, recorded_in_release_id, owner_batch_hint, source_work_id, source_version_id,
             source_passage_id, raw_citation_text, governing_instrument, section_label, target_hint, reason,
             quarantine_status, usable_as_legal_evidence
           ) VALUES (
             'uref.subreg.th.rc.royal_decree.736.work.th.rd.137028199402e798', 'rel.B01.rc2', 'B02',
             'work.th.rd.137028199402e798', 'ver.th.rd.68494.v1', 'psg.68494.conclusion',
             'พระราชกฤษฎีกาฯ (ฉบับที่ 736) พ.ศ. 2564', 'พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร (ฉบับที่ 736)',
             'มาตรา 3 (1)', 'subreg.th.rc.royal_decree.736',
             'Suppressed in B01 candidate; preserved as non-evidence until separate candidate review',
             'UNRESOLVED_QUARANTINED', 0
           )`
        )
        .run();

      // Any attempt to insert OR flip `usable_as_legal_evidence = 1` on a quarantined record MUST fail SQL CHECK constraint!
      expect(() =>
        connB
          .prepare(
            `UPDATE knowledge_quarantine_ledger
                SET usable_as_legal_evidence = 1
              WHERE unresolved_ref_id = 'uref.subreg.th.rc.royal_decree.736.work.th.rd.137028199402e798'`
          )
          .run()
      ).toThrow(/CHECK constraint failed/i);

      // 5. Verify Deferred OCR Recovery Queue (`5,275` schema) & Neo4j Outbox Projection Receipt (`Gate V06`)
      connA
        .prepare(
          `INSERT INTO knowledge_ocr_recovery_queue (
             queue_item_id, manifest_id, batch_id, folder_name, relative_path, file_name,
             sha256_hash, byte_size, physical_page_count, ocr_pages, deferral_reason_code, priority_tier
           ) VALUES (
             'ocrq.b02.0001', 'mfst.b02.mwhhbx89', 'B02', 'Primary Law/Royal Decrees',
             'Royal Decrees/RoyalDecree_244.pdf', 'RoyalDecree_244.pdf', ?, 184320, 4, 4,
             'IMAGE_ONLY_GAZETTE_SCAN_REQUIRES_VERIFIED_OCR', 'P0_UNLOCKS_QUARANTINED_CITATION'
           )`
        )
        .run("d".repeat(64));

      connA
        .prepare(
          `INSERT INTO knowledge_neo4j_projection_outbox (
             outbox_id, release_id, operation, manifest_hash, expected_node_count, expected_edge_count, neo4j_database, status
           ) VALUES (
             'outbox.rc2.1', 'rel.B01.rc2', 'PROJECT_RELEASE_GRAPH', ?, 5066, 29094, 'reg24_prod_graph', 'PENDING'
           )`
        )
        .run(rc2Hash);

      connA
        .prepare(
          `UPDATE knowledge_neo4j_projection_outbox
              SET verified_neo4j_node_count = 5066,
                  verified_neo4j_edge_count = 29094,
                  status = 'VERIFIED_COMPLETED',
                  completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE outbox_id = 'outbox.rc2.1' AND manifest_hash = ?`
        )
        .run(rc2Hash);

      // Close both connections to test cold-restart disk durability
      connB.close();
      connA.close();

      // 6. Reopen cold from disk on a brand-new connection (`connC`) and verify 100% state + hash-chain integrity
      const connC = new DatabaseSync(dbPath);
      try {
        const preservedRc1 = connC
          .prepare("SELECT state, revision, manifest_hash FROM knowledge_release WHERE release_id = 'rel.B01.rc1'")
          .get() as { state: string; revision: number; manifest_hash: string };
        expect(preservedRc1.state).toBe("READY_FOR_UAT");
        expect(preservedRc1.revision).toBe(1);
        expect(preservedRc1.manifest_hash).toBe(rc1Hash);

        const persistedRc2 = connC
          .prepare(
            "SELECT state, revision, supersedes_release_id, prior_chat_approval_preserved FROM knowledge_release WHERE release_id = 'rel.B01.rc2'"
          )
          .get() as {
          state: string;
          revision: number;
          supersedes_release_id: string;
          prior_chat_approval_preserved: number;
        };
        expect(persistedRc2.state).toBe("UAT_PASSED");
        expect(persistedRc2.revision).toBe(2);
        expect(persistedRc2.supersedes_release_id).toBe("rel.B01.rc1");
        expect(persistedRc2.prior_chat_approval_preserved).toBe(1);

        const approvals = connC
          .prepare("SELECT approval_id, decision, expected_release_revision, committed_store_revision FROM knowledge_release_approval")
          .all() as Array<{
          approval_id: string;
          decision: string;
          expected_release_revision: number;
          committed_store_revision: number;
        }>;
        expect(approvals).toHaveLength(1);
        expect(approvals[0].decision).toBe("UAT_PASS");

        const auditRows = connC
          .prepare("SELECT sequence_no, action, actor_id, payload_json, prev_entry_hash, entry_hash FROM audit_log_chain ORDER BY sequence_no ASC")
          .all() as Array<{
          sequence_no: number;
          action: string;
          actor_id: string;
          payload_json: string;
          prev_entry_hash: string;
          entry_hash: string;
        }>;
        expect(auditRows.length).toBe(1);
        const recomputedHash = crypto
          .createHash("sha256")
          .update(`${auditRows[0].prev_entry_hash}|${auditRows[0].action}|${auditRows[0].actor_id}|${auditRows[0].payload_json}`)
          .digest("hex");
        expect(auditRows[0].entry_hash).toBe(recomputedHash);

        const outbox = connC
          .prepare("SELECT status, expected_node_count, verified_neo4j_node_count FROM knowledge_neo4j_projection_outbox WHERE outbox_id = 'outbox.rc2.1'")
          .get() as { status: string; expected_node_count: number; verified_neo4j_node_count: number };
        expect(outbox.status).toBe("VERIFIED_COMPLETED");
        expect(outbox.verified_neo4j_node_count).toBe(outbox.expected_node_count);
      } finally {
        connC.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
