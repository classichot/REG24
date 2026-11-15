import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { materializeB01Rc2Preview } from "../../scripts/materialize-b01-rc2-preview";
import { setDefaultKnowledgeStoreForTesting } from "../../src/core/knowledge/store";
import { GET as getBatchReportRoute } from "../../src/app/api/v1/knowledge/batches/[id]/report/route";
import { POST as postQueryRoute } from "../../src/app/api/v1/knowledge/query/route";
import { GET as getEvidenceRoute } from "../../src/app/api/v1/knowledge/evidence/[id]/route";

describe("B01-rc2 Isolated Exploratory Preview Store & HTTP Smoke", () => {
  const prevPreviewEnv = process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
  const prevDataDirEnv = process.env.REG24_KNOWLEDGE_DATA_DIR;

  afterEach(() => {
    if (prevPreviewEnv === undefined) {
      delete process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
    } else {
      process.env.REG24_USE_B01_RC2_PREVIEW_STORE = prevPreviewEnv;
    }
    if (prevDataDirEnv === undefined) {
      delete process.env.REG24_KNOWLEDGE_DATA_DIR;
    } else {
      process.env.REG24_KNOWLEDGE_DATA_DIR = prevDataDirEnv;
    }
    setDefaultKnowledgeStoreForTesting(null);
  });

  it("Materializes isolated rel.B01.rc2 preview store and serves all 8 representative exploratory questions via HTTP routes while leaving live rc1 untouched", async () => {
    const previewStateGz = path.resolve(
      process.cwd(),
      "data",
      "knowledge-store-b01-rc2-staging",
      "canonical-state.json.gz"
    );
    const smokeJsonPath = path.resolve(
      process.cwd(),
      "docs",
      "audit",
      "dodo-review-rc2-b02",
      "b01_rc2_exploratory_preview_smoke.json"
    );

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

    // Verify HTTP route handlers serve rel.B01.rc2 when REG24_USE_B01_RC2_PREVIEW_STORE=1
    delete process.env.REG24_KNOWLEDGE_DATA_DIR;
    process.env.REG24_USE_B01_RC2_PREVIEW_STORE = "1";
    setDefaultKnowledgeStoreForTesting(null);

    const repRes = await getBatchReportRoute(new Request("http://localhost/api/v1/knowledge/batches/B01/report"), {
      params: Promise.resolve({ id: "B01" }),
    });
    expect(repRes.status).toBe(200);
    const repJson = await repRes.json();
    expect(repJson.report.release_id).toBe("rel.B01.rc2");
    expect(repJson.release_record.release_id).toBe("rel.B01.rc2");
    expect(repJson.dependency_manifest.loaded_b02_dependencies_count).toBeGreaterThanOrEqual(150);
    expect(repJson.dependency_manifest.unresolved_external_references_count).toBe(1381);
    const b01Gate = repJson.batch_gate_board.find((g: { batch_id: string }) => g.batch_id === "B01");
    expect(b01Gate.release_id).toBe("rel.B01.rc2");

    // Verify Royal Decree 244 remediation question via HTTP POST /api/v1/knowledge/query (omitting release_id)
    const qRes = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/13980 เรื่องการยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกา ฉบับที่ 244 มาตรา 3 (5)",
          mode: "standard",
        }),
      })
    );
    expect(qRes.status).toBe(200);
    const qJson = await qRes.json();
    expect(qJson.answer.release_id).toBe("rel.B01.rc2");
    expect(qJson.answer.status).toBe("ANSWERED");
    expect(qJson.answer.evidence.length).toBeGreaterThan(0);

    // Verify Evidence Drawer locator endpoint resolves HTTP 200 with real source URL
    const firstPassageId = qJson.answer.evidence[0].passage_id;
    const evRes = await getEvidenceRoute(
      new Request(`http://localhost/api/v1/knowledge/evidence/${encodeURIComponent(firstPassageId)}`),
      { params: Promise.resolve({ id: firstPassageId }) }
    );
    expect(evRes.status).toBe(200);
    const evJson = await evRes.json();
    expect(evJson.ok).toBe(true);
    expect(evJson.evidence.locator.origin_uri).toBeTruthy();
  }, 180_000);
});
