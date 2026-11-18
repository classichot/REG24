import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildB01LegalSpotCheckPack } from "../../scripts/generate-b01-legal-spotcheck-pack";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

describe("Non-Provisioning Trial Prep: 30-Case Legal Spot-Check Pack & SQL Backup/Restore Drill", () => {
  it("Generates 30-case stratified rel.B01.rc5 legal spot-check pack with complete conclusions, zero cut-off condition bullets, zero synthetic placeholders, and strict abstentions", async () => {
    const pack = await buildB01LegalSpotCheckPack();
    expect(pack.total_cases).toBe(30);
    expect(pack.release_id).toBe("rel.B01.rc5");
    expect(pack.automated_tests_replace_independent_legal_review).toBe(false);
    expect(pack.automated_guard_summary.zero_synthetic_ext_dep_across_all_30).toBe(true);
    expect(pack.automated_guard_summary.stratum_6_abstentions_passed).toBe(true);
    expect(pack.automated_guard_summary.stratum_4_direct_quarantine_abstentions_passed).toBe(true);
    expect(pack.automated_guard_summary.lsc12_unverified_historical_statute_suppressed).toBe(true);
    expect(pack.automated_guard_summary.all_answered_cases_render_complete_source_tail).toBe(
      true
    );
    expect(pack.automated_guard_summary.zero_cutoff_condition_bullets_across_all_30).toBe(true);
    const lsc01 = pack.cases.find((c) => c.spotcheck_id === "LSC-01")!;
    const lsc02 = pack.cases.find((c) => c.spotcheck_id === "LSC-02")!;
    const lsc04 = pack.cases.find((c) => c.spotcheck_id === "LSC-04")!;
    expect(lsc02.legal_check_focus).toContain("Section 81(2)(ก) juncto Section 81(1)(ง)");
    expect(lsc02.legal_check_focus).not.toContain("81(1)(ฉ)");
    expect(lsc01.answer_text).toContain(
      "จึงมีสิทธิได้รับเครดิตภาษีในการคำนวณภาษีเงินได้บุคคลธรรมดาตามมาตรา 47 ทวิ และมาตรา 48 แห่งประมวลรัษฎากร"
    );
    // Linked B02 Section 47 bis renders multi-unit text including paragraph 3 domicile rule
    expect(lsc01.answer_text).toContain(
      "มิให้ใช้บังคับแก่ผู้มีเงินได้ซึ่งมิได้มีภูมิลำเนาอยู่ในประเทศไทย"
    );
    expect(lsc04.answer_text).toContain(
      "ตามมาตรา 4 แห่งพระราชกฤษฎีกาฯ (ฉบับที่ 595) พ.ศ. 2558"
    );
    expect(lsc04.answer_text).toContain("ข้อจำกัดความครบถ้วนของหลักฐานกฎหมายประกอบ");
    expect(pack.cases.every((c) => c.independent_legal_reviewer_verdict === null)).toBe(true);
  }, 60_000);

  it("Compiles 0003_trial_access_and_audit.sql, takes online backup, simulates DB loss, and verifies 100% point-in-time recovery", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-sql-backup-drill-"));
    try {
      const liveDbPath = path.join(tmpDir, "live_trial.sqlite");
      const backupDbPath = path.join(tmpDir, "backup_trial_snapshot.sqlite");
      const restoredDbPath = path.join(tmpDir, "restored_trial.sqlite");

      const rawSql = fs.readFileSync(
        path.resolve(process.cwd(), "prisma/migrations/0003_trial_access_and_audit.sql"),
        "utf8"
      );
      const portableSql = rawSql
        .replace(/::jsonb/gi, "")
        .replace(/\bJSONB\b/gi, "TEXT")
        .replace(/\bTIMESTAMPTZ\b/gi, "TEXT")
        .replace(/\bCHAR\(\d+\)/gi, "TEXT")
        .replace(/\bNOW\(\)/gi, "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");

      const db = new DatabaseSync(liveDbPath);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA synchronous = FULL;");
      db.exec(portableSql);

      const inviteHash = crypto.createHash("sha256").update("trial-invite-001").digest("hex");
      db.prepare(
        `INSERT INTO trial_invite_credentials (invite_id, token_sha256, assigned_email, environment_scope, expires_at)
         VALUES ('inv.001', ?, 'reviewer@law24.th', 'trial', '2026-12-31T23:59:59Z')`
      ).run(inviteHash);

      const qSha = crypto.createHash("sha256").update("กค 0702/636").digest("hex");
      db.prepare(
        `INSERT INTO trial_audit_events (
           audit_id, event_type, environment_scope, actor_id, actor_role, invite_fingerprint,
           release_id, manifest_hash, trace_id, question_sha256, question_text, answer_status,
           cited_passage_ids_json, cited_work_ids_json, latency_ms
         ) VALUES (
           'aud.q.1', 'TRIAL_QUERY', 'trial', 'reviewer@law24.th', 'reader', ?,
           'rel.B01.rc2', '467cdb91862fb4537c721cef993fc324dfd7812e9b29d5d9b9f29092760e4692',
           'trc.drill01', ?, 'ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636', 'ANSWERED',
           '["psg.bf1ba0ea86ded7"]', '["work.th.rd.gk_0702_636_2026_ec1b79d8"]', 142
         )`
      ).run(inviteHash.slice(0, 12), qSha);

      // Online atomic backup snapshot (`VACUUM INTO` mirrors online logical/snapshot backup)
      db.exec(`VACUUM INTO '${backupDbPath.replace(/'/g, "''")}';`);
      db.close();

      const backupSha = crypto
        .createHash("sha256")
        .update(fs.readFileSync(backupDbPath))
        .digest("hex");
      expect(backupSha).toHaveLength(64);

      // Simulate complete primary database loss
      fs.unlinkSync(liveDbPath);
      expect(fs.existsSync(liveDbPath)).toBe(false);

      // Restore into clean path and verify zero lost credentials or audit records
      fs.copyFileSync(backupDbPath, restoredDbPath);
      const restoredDb = new DatabaseSync(restoredDbPath);
      const cred = restoredDb
        .prepare("SELECT invite_id, assigned_email, environment_scope FROM trial_invite_credentials WHERE invite_id = 'inv.001'")
        .get() as { invite_id: string; assigned_email: string; environment_scope: string };
      expect(cred.assigned_email).toBe("reviewer@law24.th");
      expect(cred.environment_scope).toBe("trial");

      const aud = restoredDb
        .prepare("SELECT audit_id, release_id, answer_status, cited_passage_ids_json FROM trial_audit_events WHERE audit_id = 'aud.q.1'")
        .get() as { audit_id: string; release_id: string; answer_status: string; cited_passage_ids_json: string };
      expect(aud.release_id).toBe("rel.B01.rc2");
      expect(aud.answer_status).toBe("ANSWERED");
      expect(JSON.parse(aud.cited_passage_ids_json)).toEqual(["psg.bf1ba0ea86ded7"]);
      restoredDb.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
