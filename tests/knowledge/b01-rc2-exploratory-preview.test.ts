import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { materializeB01Rc2Preview } from "../../scripts/materialize-b01-rc2-preview";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import {
  readTrialAuditEvents,
  resetTrialRateLimiterForTesting,
} from "../../src/core/knowledge/trial-gate";
import { GET as getBatchReportRoute } from "../../src/app/api/v1/knowledge/batches/[id]/report/route";
import { POST as postQueryRoute } from "../../src/app/api/v1/knowledge/query/route";
import { GET as getEvidenceRoute } from "../../src/app/api/v1/knowledge/evidence/[id]/route";
import { POST as postUatDecisionRoute } from "../../src/app/api/v1/knowledge/releases/[id]/uat-decisions/route";

describe("B01-rc2 Isolated Exploratory Preview, Trial Scope Controls & Custom Owner UAT", () => {
  const prevPreviewEnv = process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
  const prevDataDirEnv = process.env.REG24_KNOWLEDGE_DATA_DIR;
  const prevInviteEnv = process.env.REG24_TRIAL_INVITE_ONLY;
  const prevCodesEnv = process.env.REG24_TRIAL_INVITE_CODES;
  const prevLimitEnv = process.env.REG24_TRIAL_QUERY_LIMIT_15M;

  afterEach(() => {
    if (prevPreviewEnv === undefined) delete process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
    else process.env.REG24_USE_B01_RC2_PREVIEW_STORE = prevPreviewEnv;

    if (prevDataDirEnv === undefined) delete process.env.REG24_KNOWLEDGE_DATA_DIR;
    else process.env.REG24_KNOWLEDGE_DATA_DIR = prevDataDirEnv;

    if (prevInviteEnv === undefined) delete process.env.REG24_TRIAL_INVITE_ONLY;
    else process.env.REG24_TRIAL_INVITE_ONLY = prevInviteEnv;

    if (prevCodesEnv === undefined) delete process.env.REG24_TRIAL_INVITE_CODES;
    else process.env.REG24_TRIAL_INVITE_CODES = prevCodesEnv;

    if (prevLimitEnv === undefined) delete process.env.REG24_TRIAL_QUERY_LIMIT_15M;
    else process.env.REG24_TRIAL_QUERY_LIMIT_15M = prevLimitEnv;

    resetTrialRateLimiterForTesting();
    setDefaultKnowledgeStoreForTesting(null);
  });

  it("Serves rel.B01.rc2, enforces non-RD & quarantined-law abstention, invite-only rate-limited audit logs, and custom Owner UAT questions on a disposable copy", async () => {
    const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
    const previewStateGz = path.join(previewDir, "canonical-state.json.gz");

    const summary = await materializeB01Rc2Preview({
      reuseExistingPreviewStore: fs.existsSync(previewStateGz),
    });

    expect(summary.protected_live_canonical_untouched).toBe(true);
    expect(summary.candidate_rc2_state).toBe("READY_FOR_UAT");
    expect(summary.owner_decision).toBeNull();
    expect(summary.active_release_id).toBeNull();
    expect(summary.uat_precheck_passed).toBe(20);
    expect(summary.blind_validation_passed).toBe("20/20");
    for (const s of summary.smoke_results) {
      expect(s.release_id).toBe("rel.B01.rc2");
    }

    // 1. Exploratory Preview Mode (REG24_USE_B01_RC2_PREVIEW_STORE=1)
    delete process.env.REG24_KNOWLEDGE_DATA_DIR;
    process.env.REG24_USE_B01_RC2_PREVIEW_STORE = "1";
    setDefaultKnowledgeStoreForTesting(null);

    const repRes = await getBatchReportRoute(
      new Request("http://localhost/api/v1/knowledge/batches/B01/report"),
      { params: Promise.resolve({ id: "B01" }) }
    );
    expect(repRes.status).toBe(200);
    const repJson = await repRes.json();
    expect(repJson.report.release_id).toBe("rel.B01.rc2");
    expect(repJson.report.uat.owner_decision).toBeNull();
    expect(repJson.report.supersession_lineage?.supersedes_release_id).toBe("rel.B01.rc1");
    expect(repJson.dependency_manifest.unresolved_external_references_count).toBe(1381);

    // 2. Scope & Non-Guessing Controls:
    // 2a. Out-of-scope Labour Protection Act question -> INSUFFICIENT_EVIDENCE
    const labourRes = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            "เลิกจ้างพนักงานทำงานครบ 3 ปี นายจ้างต้องจ่ายค่าชดเชยเท่าไรตามพระราชบัญญัติคุ้มครองแรงงาน",
        }),
      })
    );
    const labourJson = await labourRes.json();
    expect(labourJson.answer.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(labourJson.answer.evidence).toHaveLength(0);

    // 2b. Direct statutory lookup of quarantined Royal Decree 736 -> INSUFFICIENT_EVIDENCE
    const rd736DirectRes = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "พระราชกฤษฎีกา ฉบับที่ 736 บัญญัติหลักเกณฑ์ไว้อย่างไร",
        }),
      })
    );
    const rd736DirectJson = await rd736DirectRes.json();
    expect(rd736DirectJson.answer.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(rd736DirectJson.answer.answer).toContain("usable_as_legal_evidence: false");

    // 2c. Ruling citing quarantined Royal Decree 736 (กค 0702/1493) -> ANSWERED + explicit coverage_warnings
    const rd736RulingRes = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            "แสดงแนววินิจฉัยในหนังสือตอบข้อหารือ กค 0702/1493 กรณีการยกเว้นภาษีธุรกิจเฉพาะและอากรแสตมป์จากการเวนคืนอสังหาริมทรัพย์",
        }),
      })
    );
    const rd736RulingJson = await rd736RulingRes.json();
    expect(rd736RulingJson.answer.status).toBe("ANSWERED");
    expect(
      rd736RulingJson.answer.coverage_warnings.some((w: string) =>
        w.includes("usable_as_legal_evidence: false")
      )
    ).toBe(true);

    // 3. Invite-Only Limited Trial Gate, Rate Limiting & Query/Citation Audit Logs + Custom Owner UAT on disposable copy
    const tmpTrialDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-trial-verify-"));
    try {
      fs.cpSync(previewDir, tmpTrialDir, { recursive: true });
      const disposableStore = new DurableKnowledgeStore(tmpTrialDir);
      setDefaultKnowledgeStoreForTesting(disposableStore);

      process.env.REG24_TRIAL_INVITE_ONLY = "1";
      process.env.REG24_TRIAL_INVITE_CODES = "trial-owner-2026,trial-dodo-2026";
      process.env.REG24_TRIAL_QUERY_LIMIT_15M = "2";

      // Missing invite -> 401
      const unauthRes = await postQueryRoute(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636" }),
        })
      );
      expect(unauthRes.status).toBe(401);

      // Valid invite #1 -> 200 + audit log
      const okRes1 = await postQueryRoute(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-trial-invite": "trial-owner-2026",
          },
          body: JSON.stringify({
            question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
            mode: "exact_lookup",
          }),
        })
      );
      expect(okRes1.status).toBe(200);
      const okJson1 = await okRes1.json();
      const passageId = okJson1.answer.evidence[0].passage_id;

      // Citation open with valid invite -> 200 + citation audit log
      const evRes = await getEvidenceRoute(
        new Request(`http://localhost/api/v1/knowledge/evidence/${encodeURIComponent(passageId)}`, {
          headers: { "x-reg24-trial-invite": "trial-owner-2026" },
        }),
        { params: Promise.resolve({ id: passageId }) }
      );
      expect(evRes.status).toBe(200);

      // Valid invite #2 -> 200; #3 -> 429 Rate Limited
      const okRes2 = await postQueryRoute(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-trial-invite": "trial-owner-2026",
          },
          body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999" }),
        })
      );
      expect(okRes2.status).toBe(200);

      const rateLimRes = await postQueryRoute(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-trial-invite": "trial-owner-2026",
          },
          body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636" }),
        })
      );
      expect(rateLimRes.status).toBe(429);

      const auditEvents = readTrialAuditEvents(disposableStore);
      expect(auditEvents.filter((e) => e.event_type === "TRIAL_QUERY")).toHaveLength(2);
      expect(auditEvents.filter((e) => e.event_type === "TRIAL_CITATION_OPEN")).toHaveLength(1);

      // Verify Formal Owner UAT records Owner's own ad-hoc questions alongside Technical & Legal attestations (on disposable copy only!)
      const rc2Rel = disposableStore.getState().releases["rel.B01.rc2"];
      const uatRes = await postUatDecisionRoute(
        new Request("http://localhost/api/v1/knowledge/releases/rel.B01.rc2/uat-decisions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-csrf": "1",
            "x-reg24-actor-role": "product_owner",
            "x-reg24-actor-id": "rattaroj@reg24.th",
          },
          body: JSON.stringify({
            manifest_hash: rc2Rel.manifest_hash,
            expected_revision: rc2Rel.revision,
            decision: "UAT_PASS",
            comments: "Disposable test verifying custom_owner_questions persistence",
            custom_owner_questions: [
              {
                question_id: "OWNER-LIVE-Q1",
                question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/13980 เรื่องพระราชกฤษฎีกา ฉบับที่ 244 มาตรา 3 (5)",
                trace_id: okJson1.answer.trace_id,
                decision: "PASS",
                comment: "Verified Royal Decree 244 section 3(5) citation & source URL",
              },
            ],
          }),
        }),
        { params: Promise.resolve({ id: "rel.B01.rc2" }) }
      );
      expect(uatRes.status).toBe(200);
      const uatJson = await uatRes.json();
      expect(uatJson.acceptance.custom_owner_questions).toHaveLength(1);
      expect(uatJson.acceptance.custom_owner_questions[0].question_id).toBe("OWNER-LIVE-Q1");
      // Preserved rel.B01.rc1 remains untouched in audit history
      expect(disposableStore.getState().releases["rel.B01.rc1"].manifest_id).toBe(
        "mfst.b01.mwgj0yb3"
      );
    } finally {
      fs.rmSync(tmpTrialDir, { recursive: true, force: true });
    }

    // Confirm committed preview store itself STILL has owner_decision === null (no pre-recorded 20/20!)
    const verifyPreviewStore = new DurableKnowledgeStore(previewDir);
    expect(verifyPreviewStore.getState().acceptances["rel.B01.rc2"].user_decision).toBeNull();
  }, 180_000);
});
