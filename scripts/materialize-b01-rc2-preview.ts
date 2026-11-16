/**
 * REG24 — Isolated B01 Candidate (`rel.B01.rc3`) Preview Store Builder & Completeness Verifier
 *
 * Builds `data/knowledge-store-b01-rc2-staging` serving remediated candidate `rel.B01.rc3`
 * (superseding `rel.B01.rc2` after fixing DEF-B01-05 snippet & multi-chunk conclusion truncation)
 * without modifying `data/knowledge-store` (`rel.B01.rc1`), `main`, or Neo4j.
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
import { resolveAuthorizedEvidence, withdrawKnowledgeTarget } from "../src/core/knowledge/evidence";
import { THAI_TAX_RULINGS_CORPUS } from "../src/core/data/thai-tax-rulings-loader";
import type { Actor } from "../src/core/knowledge/contracts";

export const CURRENT_B01_PREVIEW_RELEASE_ID = "rel.B01.rc4";

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
  const safelyExcludedWorks: Array<{ work_id: string; official_identifier: string; reason: string }> = [];

  const inquiryOnlyRulingNos = new Set(
    THAI_TAX_RULINGS_CORPUS.filter((r) => !r.ruling || r.ruling.trim() === "" || r.ruling.trim() === "-")
      .map((r) => r.ruling_no.trim())
  );

  const ensureInquiryOnlyWorksWithdrawn = (targetStore: DurableKnowledgeStore) => {
    const stNow = targetStore.getState();
    const activeWithdrawnIds = new Set(
      Object.values(stNow.withdrawals)
        .filter((w) => w.active)
        .map((w) => w.target_id)
    );
    for (const work of Object.values(stNow.works)) {
      if (work.type !== "TaxRuling") continue;
      const hitInquiryOnly = work.official_identifiers.some(
        (o) => inquiryOnlyRulingNos.has(o.raw.trim()) || inquiryOnlyRulingNos.has(o.normalized.trim())
      );
      if (hitInquiryOnly && !activeWithdrawnIds.has(work.work_id)) {
        const idLabel = work.official_identifiers[0]?.normalized || work.work_id;
        const reason = `Official rd.go.th source (${idLabel}) contains taxpayer inquiry only ('แนววินิจฉัย: -') with no published Revenue Department conclusion; safely excluded from trial answering.`;
        withdrawKnowledgeTarget(targetStore, work.work_id, reason, LEGAL_ACTOR);
        activeWithdrawnIds.add(work.work_id);
      }
    }
    const stPost = targetStore.getState();
    for (const w of Object.values(stPost.withdrawals)) {
      if (
        w.active &&
        stPost.works[w.target_id]?.type === "TaxRuling" &&
        !safelyExcludedWorks.some((x) => x.work_id === w.target_id)
      ) {
        safelyExcludedWorks.push({
          work_id: w.target_id,
          official_identifier:
            stPost.works[w.target_id]?.official_identifiers[0]?.normalized || w.target_id,
          reason: w.reason,
        });
      }
    }
  };

  if (
    opts?.reuseExistingPreviewStore &&
    fs.existsSync(path.join(previewDir, "canonical-state.json.gz"))
  ) {
    store = new DurableKnowledgeStore(previewDir);
    const stExisting = store.getState();
    if (stExisting.releases[CURRENT_B01_PREVIEW_RELEASE_ID]) {
      ensureInquiryOnlyWorksWithdrawn(store);
      uatPrecheckPassed = (stExisting.uat_cases[CURRENT_B01_PREVIEW_RELEASE_ID] || []).filter(
        (c) => c.evaluator_results?.automated_precheck_passed
      ).length;
      if (uatPrecheckPassed < 20) {
        const reEval = await evaluateRelease(
          CURRENT_B01_PREVIEW_RELEASE_ID,
          "suite.B01.300families.v1.2",
          ENG_ACTOR,
          { store }
        );
        uatPrecheckPassed = reEval.uat_cases.filter(
          (c) => c.evaluator_results?.automated_precheck_passed
        ).length;
      }
      releaseReport = store.getState().release_reports[CURRENT_B01_PREVIEW_RELEASE_ID];
      const blindExisting = await runBlindSourceToAnswerValidation(
        CURRENT_B01_PREVIEW_RELEASE_ID,
        LEGAL_ACTOR,
        { store }
      );
      blindValidationPassed = `${blindExisting.passed_cases}/${blindExisting.total_cases}`;
    } else {
      return materializeB01Rc2Preview({ reuseExistingPreviewStore: false });
    }
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
        idempotency_key: "isolated-preview-rel-b01-rc4-conditions-remediated",
        max_documents: 5000,
      },
      ENG_ACTOR,
      { store, releaseIdOverride: CURRENT_B01_PREVIEW_RELEASE_ID }
    );

    // Safety guard (Owner Item 2): Safely exclude any ruling work whose official rd.go.th page has
    // zero Revenue Department conclusion (`แนววินิจฉัย: -` inquiry-only) or mid-word cutoff
    const stAfterRun = store.getState();
    const relRec = stAfterRun.releases[CURRENT_B01_PREVIEW_RELEASE_ID];
    const relPassages = store.getPassagesForRelease(CURRENT_B01_PREVIEW_RELEASE_ID);
    const concByWork = new Map<string, string[]>();
    for (const p of relPassages) {
      if (p.statement_role === "official_conclusion") {
        const list = concByWork.get(p.work_id) || [];
        list.push(p.exact_text);
        concByWork.set(p.work_id, list);
      }
    }
    for (const wid of relRec.created_work_ids) {
      const work = stAfterRun.works[wid];
      if (!work || work.type !== "TaxRuling") continue;
      const concTexts = concByWork.get(wid) || [];
      const joined = concTexts.join("\n").trim();
      const idLabel = work.official_identifiers[0]?.normalized || wid;
      if (concTexts.length === 0 || !joined) {
        const reason = `Official rd.go.th source (${idLabel}) contains taxpayer inquiry only ('แนววินิจฉัย: -') with no published Revenue Department conclusion; safely excluded from trial answering.`;
        withdrawKnowledgeTarget(store, wid, reason, LEGAL_ACTOR);
        safelyExcludedWorks.push({ work_id: wid, official_identifier: idLabel, reason });
      } else if (/[\u0E40-\u0E44\u0E31]$/.test(joined)) {
        const reason = `Ruling (${idLabel}) detected with mid-word trailing vowel/tone cutoff; safely excluded pending manual check.`;
        withdrawKnowledgeTarget(store, wid, reason, LEGAL_ACTOR);
        safelyExcludedWorks.push({ work_id: wid, official_identifier: idLabel, reason });
      }
    }
    ensureInquiryOnlyWorksWithdrawn(store);

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
    {
      id: "Q9_lsc04_4point_sme_0702_4825",
      question:
        "ตามหนังสือตอบข้อหารือ กค 0702/4825 ห้างฯ ที่เคยมีทุนจดทะเบียน 30 ล้านบาทและลดทุนเหลือ 5 ล้านบาทในปี 2543 จะได้รับสิทธิยกเว้นภาษีเงินได้นิติบุคคลตามพระราชกฤษฎีกา (ฉบับที่ 595) หรือไม่",
      mode: "standard",
      applicable_date: null,
    },
    {
      id: "Q10_long_multichunk_0702_2994",
      question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/2994",
      mode: "exact_lookup",
      applicable_date: null,
    },
  ];

  const smokeResults = [];
  for (const item of representativePrompts) {
    const ans = await queryKnowledge(
      {
        question: item.question,
        mode: item.mode,
        applicable_date: item.applicable_date,
      },
      OWNER_EXPLORATORY_ACTOR,
      { store }
    );
    const resolvedCitations = ans.evidence.slice(0, 6).map((evCard) => {
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
      answer_tail_200: ans.answer.slice(-200),
    });
  }

  // Representative sample verification of 12 long, multi-point rulings (Owner Item 2)
  const longMultiPointSampleIds = [
    "กค 0702/1494", // LSC-01 (3 numbered points, 3,149 chars)
    "กค 0702/4825", // LSC-04 (4 numbered points, 2,685 chars)
    "กค 0702/636",  // 2569 0% VAT foreign grant ruling
    "กค 0702/6077", // 2568 EV subsidy CIT ruling
    "กค 0702/1255", // 2569 CIT ruling
    "กค 0702/2794", // 4 conclusion chunks (5,001 chars)
    "กค 0702/2994", // 4 conclusion chunks (6,033 chars)
    "กค 0702/7731", // 3 conclusion chunks (3,704 chars)
    "กค 0702/1693", // 3 conclusion chunks (3,908 chars)
    "กค 0702/10118", // 3 conclusion chunks (2,811 chars)
    "กค 0811/7275", // 4 numbered WHT air-freight points (upgraded from 260 chars -> 1,648 chars)
    "กค 0811/3516", // 3 numbered debt-to-equity points (upgraded from 260 chars -> 1,060 chars)
  ];

  const allRelPassages = store.getPassagesForRelease(CURRENT_B01_PREVIEW_RELEASE_ID);
  const longMultiPointVerification = [];
  for (const rId of longMultiPointSampleIds) {
    const ans = await queryKnowledge(
      {
        question: `ค้นหาหนังสือตอบข้อหารือเลขที่ ${rId}`,
        mode: "exact_lookup",
        applicable_date: null,
      },
      OWNER_EXPLORATORY_ACTOR,
      { store }
    );
    const officialClaim = ans.claims.find((c) => c.statement_role === "official_conclusion");
    const workId = ans.evidence.find((e) => e.statement_role === "official_conclusion")?.work_id || "";
    const canonicalUnits = allRelPassages
      .filter((p) => p.work_id === workId && p.statement_role === "official_conclusion")
      .sort((a, b) => {
        const ua = Number((a.structural_path.at(-1) || "").replace(/\D+/g, "")) || 0;
        const ub = Number((b.structural_path.at(-1) || "").replace(/\D+/g, "")) || 0;
        return ua - ub;
      });
    const canonicalFullConclusion = canonicalUnits.map((u) => u.exact_text).join("\n");
    const finalTail = canonicalFullConclusion.slice(-120);
    const answerContainsFinalTail = Boolean(finalTail && ans.answer.includes(finalTail));
    longMultiPointVerification.push({
      ruling_no: rId,
      work_id: workId,
      origin_uri: canonicalUnits[0]?.real_locator.origin_uri || null,
      conclusion_unit_count: canonicalUnits.length,
      canonical_conclusion_chars: canonicalFullConclusion.length,
      supporting_passage_ids_in_claim: officialClaim?.supporting_passage_ids.length || 0,
      answer_contains_exact_final_120_chars: answerContainsFinalTail,
      final_120_chars: finalTail,
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
    superseded_candidates: [
      {
        release_id: "rel.B01.rc1",
        manifest_id: "mfst.b01.mwgj0yb3",
        reason: "Preserved original baseline candidate (DEF-B01-01..04).",
      },
      {
        release_id: "rel.B01.rc2",
        manifest_id: "mfst.b01.mwi46hrg",
        reason:
          "Superseded prior to Owner UAT after Dodo identified source snippet & multi-chunk conclusion truncation (DEF-B01-05).",
      },
      {
        release_id: "rel.B01.rc3",
        manifest_id: "mfst.b01.mwihl1gx",
        reason:
          "Superseded after fixing 220-character condition/exception bullet mid-sentence truncation, multi-unit linked statutory sections, and LSC-02/06/10 legal review guidance.",
      },
    ],
    current_candidate_release_id: CURRENT_B01_PREVIEW_RELEASE_ID,
    candidate_rc2_state: stFinal.releases[CURRENT_B01_PREVIEW_RELEASE_ID]?.state,
    candidate_rc2_manifest_id: stFinal.releases[CURRENT_B01_PREVIEW_RELEASE_ID]?.manifest_id,
    candidate_rc2_manifest_hash: stFinal.releases[CURRENT_B01_PREVIEW_RELEASE_ID]?.manifest_hash,
    active_release_id: stFinal.active_release_id,
    owner_decision: releaseReport.uat.owner_decision,
    inventory: releaseReport.inventory,
    knowledge: releaseReport.knowledge,
    quarantined_external_references: Object.keys(stFinal.unresolved_references).length,
    safely_excluded_incomplete_or_inquiry_only_works: safelyExcludedWorks,
    uat_precheck_passed: uatPrecheckPassed,
    blind_validation_passed: blindValidationPassed,
    long_multipoint_12case_verification: {
      total_tested: longMultiPointVerification.length,
      all_12_contain_exact_final_conclusion: longMultiPointVerification.every(
        (x) => x.answer_contains_exact_final_120_chars
      ),
      cases: longMultiPointVerification,
    },
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
      console.log(
        JSON.stringify(
          {
            current_candidate_release_id: summary.current_candidate_release_id,
            manifest_id: summary.candidate_rc2_manifest_id,
            manifest_hash: summary.candidate_rc2_manifest_hash,
            safely_excluded_works: summary.safely_excluded_incomplete_or_inquiry_only_works,
            long_multipoint_12_passed:
              summary.long_multipoint_12case_verification.all_12_contain_exact_final_conclusion,
            uat_precheck_passed: summary.uat_precheck_passed,
            blind_validation_passed: summary.blind_validation_passed,
          },
          null,
          2
        )
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
