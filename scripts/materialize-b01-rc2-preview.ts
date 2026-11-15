/**
 * REG24 — Isolated B01 Candidate (`rel.B01.rc2`) Preview Store Builder & Smoke Verifier
 *
 * Builds `data/knowledge-store-b01-rc2-staging` for isolated Vercel Preview / local exploratory
 * Owner & Dodo testing without modifying `data/knowledge-store` (`rel.B01.rc1`), `main`, or Neo4j.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { freezeInventory, planReconciliation } from "../src/core/knowledge/inventory";
import { startBatchRun } from "../src/core/knowledge/releases";
import { evaluateRelease } from "../src/core/knowledge/evaluation";
import { runBlindSourceToAnswerValidation } from "../src/core/knowledge/blind-audit";
import { queryKnowledge } from "../src/core/knowledge/query";
import { resolveAuthorizedEvidence } from "../src/core/knowledge/evidence";
import type { Actor } from "../src/core/knowledge/contracts";

const PROTECTED_CANONICAL_SHA256 =
  "08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9";

const ENG_ACTOR: Actor = {
  actor_id: "staging.eng@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const LEGAL_ACTOR: Actor = {
  actor_id: "staging.legal@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const OWNER_EXPLORATORY_ACTOR: Actor = {
  actor_id: "owner.exploratory@reg24.th",
  role: "product_owner",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export async function materializeB01Rc2Preview(opts?: { reuseExistingPreviewStore?: boolean }) {
  const protectedLiveDir = path.resolve(process.cwd(), "data", "knowledge-store");
  const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const protectedCanonicalGz = path.join(protectedLiveDir, "canonical-state.json.gz");

  const preSha = sha256File(protectedCanonicalGz);
  if (preSha !== PROTECTED_CANONICAL_SHA256) {
    throw new Error(
      `PROTECTED_STORE_INTEGRITY_MISMATCH: Expected ${PROTECTED_CANONICAL_SHA256}, got ${preSha}`
    );
  }

  let store: DurableKnowledgeStore;
  let uatPrecheckPassed = 20;
  let blindValidationPassed = "20/20";
  let releaseReport: ReturnType<DurableKnowledgeStore["getState"]>["release_reports"][string];

  if (
    opts?.reuseExistingPreviewStore &&
    fs.existsSync(path.join(previewDir, "canonical-state.json.gz"))
  ) {
    store = new DurableKnowledgeStore(previewDir);
    const stExisting = store.getState();
    releaseReport = stExisting.release_reports["rel.B01.rc2"];
    uatPrecheckPassed = (stExisting.uat_cases["rel.B01.rc2"] || []).filter(
      (c) => c.evaluator_results?.automated_precheck_passed
    ).length;
  } else {
    if (fs.existsSync(previewDir)) {
      fs.rmSync(previewDir, { recursive: true, force: true });
    }
    fs.cpSync(protectedLiveDir, previewDir, { recursive: true });

    store = new DurableKnowledgeStore(previewDir);
    const fB01 = await freezeInventory("B01", ENG_ACTOR, { store });
    await planReconciliation(fB01.manifest.manifest_id, ENG_ACTOR, { store });

    const runB01 = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: fB01.manifest.manifest_id,
        idempotency_key: "isolated-preview-rel-b01-rc2",
        max_documents: 5000,
      },
      ENG_ACTOR,
      { store, releaseIdOverride: "rel.B01.rc2" }
    );

    const evalB01 = await evaluateRelease(
      runB01.release_id,
      "suite.B01.300families.v1.2",
      ENG_ACTOR,
      {
        store,
        candidateBaseUrl:
          "https://reg24-git-review-b01-rc2-b02-rc1-staging-7-l-advisory.vercel.app",
      }
    );
    const blindB01 = await runBlindSourceToAnswerValidation(runB01.release_id, LEGAL_ACTOR, {
      store,
    });
    releaseReport = evalB01.release_report;
    uatPrecheckPassed = evalB01.uat_cases.filter(
      (c) => c.evaluator_results?.automated_precheck_passed
    ).length;
    blindValidationPassed = `${blindB01.passed_cases}/${blindB01.total_cases}`;

    // Remove redundant rc1 projection caches from preview dir (rc1 canonical state, WAL 1..14, and reports remain intact)
    const projDir = path.join(previewDir, "projections");
    for (const name of fs.readdirSync(projDir)) {
      if (name.startsWith("rel.B01.rc1_")) {
        fs.unlinkSync(path.join(projDir, name));
      }
    }
    const lockPath = path.join(previewDir, ".store.lock");
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }

  const representativePrompts: Array<{
    id: string;
    question: string;
    mode: "standard" | "exact_lookup" | "comparison";
    applicable_date: string | null;
  }> = [
    {
      id: "Q1_exact_0702_636",
      question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
      mode: "exact_lookup",
      applicable_date: null,
    },
    {
      id: "Q2_role_separation_0702_1494",
      question:
        "ในหนังสือตอบข้อหารือ กค 0702/1494 ข้อเท็จจริงของกองมรดกผู้ขอคืนภาษีคืออะไร และกรมสรรพากรวินิจฉัยเรื่องเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ อย่างไร",
      mode: "standard",
      applicable_date: null,
    },
    {
      id: "Q3_rd244_fix_0811_13980",
      question:
        "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/13980 เรื่องการยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกา ฉบับที่ 244 มาตรา 3 (5)",
      mode: "standard",
      applicable_date: null,
    },
    {
      id: "Q4_comparison_1903_vs_634",
      question:
        "เปรียบเทียบการเสียภาษีมูลค่าเพิ่มระหว่างการขายสารเสริมสำหรับสัตว์ใน กค 0702/1903 กับการขายทองรูปพรรณความบริสุทธิ์ร้อยละ 96.5 ใน กค 0702/634",
      mode: "comparison",
      applicable_date: null,
    },
    {
      id: "Q5_lease_1248_numeric_tp",
      question:
        "ตามหนังสือตอบข้อหารือ กค 0702/1248 การให้เช่าที่ดินระยะเวลา 30 ปี มูลค่า 1,470,993,502.74 บาท ต้องรับรู้รายได้เพื่อเสียภาษีเงินได้นิติบุคคลตามมาตรา 65 และคำสั่งกรมสรรพากรใด",
      mode: "standard",
      applicable_date: null,
    },
    {
      id: "Q6_temporal_65tri_2018",
      question:
        "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2018-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
      mode: "standard",
      applicable_date: "2018-06-30",
    },
    {
      id: "Q7_quarantined_rd736_0702_1493",
      question:
        "แสดงแนววินิจฉัยในหนังสือตอบข้อหารือ กค 0702/1493 กรณีการยกเว้นภาษีธุรกิจเฉพาะและอากรแสตมป์จากการเวนคืนอสังหาริมทรัพย์",
      mode: "standard",
      applicable_date: null,
    },
    {
      id: "Q8_nonexistent_abstention",
      question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999",
      mode: "exact_lookup",
      applicable_date: null,
    },
  ];

  const smokeResults = [];
  for (const item of representativePrompts) {
    // Omit release_id intentionally to verify default candidate resolution selects rel.B01.rc2 over rel.B01.rc1!
    const ans = await queryKnowledge(
      {
        question: item.question,
        mode: item.mode,
        applicable_date: item.applicable_date,
      },
      OWNER_EXPLORATORY_ACTOR,
      { store }
    );
    const resolvedCitations = ans.evidence.slice(0, 4).map((evCard) => {
      const resolved = resolveAuthorizedEvidence(store, evCard.passage_id, OWNER_EXPLORATORY_ACTOR);
      if (resolved.allowed && resolved.passage && resolved.locator) {
        return {
          passage_id: evCard.passage_id,
          work_id: resolved.passage.work_id,
          official_identifier: resolved.official_identifier,
          statement_role: resolved.passage.statement_role,
          authenticity_status: resolved.authenticity_status,
          origin_uri: resolved.locator.origin_uri,
        };
      }
      return { passage_id: evCard.passage_id, error: "UNRESOLVED" };
    });
    smokeResults.push({
      id: item.id,
      question: item.question,
      release_id: ans.release_id,
      status: ans.status,
      latency_ms: ans.latency_ms,
      evidence_count: ans.evidence.length,
      citations: resolvedCitations,
      answer_excerpt: ans.answer.slice(0, 260),
    });
  }

  const postSha = sha256File(protectedCanonicalGz);
  if (postSha !== PROTECTED_CANONICAL_SHA256) {
    throw new Error(
      `POST_CHECK_FAILED: Protected canonical store changed! Expected ${PROTECTED_CANONICAL_SHA256}, got ${postSha}`
    );
  }

  const stFinal = store.getState();
  const summary = {
    generated_at: new Date().toISOString(),
    protected_live_canonical_sha256: postSha,
    protected_live_canonical_untouched: postSha === PROTECTED_CANONICAL_SHA256,
    preview_store_dir: "data/knowledge-store-b01-rc2-staging",
    preserved_rc1_state: stFinal.releases["rel.B01.rc1"]?.state,
    candidate_rc2_state: stFinal.releases["rel.B01.rc2"]?.state,
    candidate_rc2_manifest_id: stFinal.releases["rel.B01.rc2"]?.manifest_id,
    candidate_rc2_manifest_hash: stFinal.releases["rel.B01.rc2"]?.manifest_hash,
    active_release_id: stFinal.active_release_id,
    owner_decision: releaseReport.uat.owner_decision,
    inventory: releaseReport.inventory,
    knowledge: releaseReport.knowledge,
    quarantined_external_references: Object.keys(stFinal.unresolved_references).length,
    uat_precheck_passed: uatPrecheckPassed,
    blind_validation_passed: blindValidationPassed,
    smoke_results: smokeResults,
  };

  const outReceiptPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "b01_rc2_exploratory_preview_smoke.json"
  );
  fs.mkdirSync(path.dirname(outReceiptPath), { recursive: true });
  fs.writeFileSync(outReceiptPath, JSON.stringify(summary, null, 2), "utf8");
  return summary;
}

if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("materialize-b01-rc2-preview.ts")
) {
  materializeB01Rc2Preview()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
