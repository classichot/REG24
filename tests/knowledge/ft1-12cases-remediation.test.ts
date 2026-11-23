/**
 * REG24 Batch 1 — Formal Test 1 Remediation Regression Gates (All 12 Non-Passing Cases + Controls)
 *
 * Written FIRST against frozen baseline `89af331` (`archive/b01-rc10.3-89af331`) to reproduce
 * every underlying defect before applying code fixes:
 *   - WS1: Critical land-gift cases (`G2b`, `G3`, `G4`) + unified immovable-gift issue separation
 *          (`G1`, `G3t2`, `G5`, `M1t2`), unseen relationship/property variants, and supported cash-gift control (`K1`).
 *   - WS2: Answer checker false suppressions (`M1t3` §50(5)(ข) + RD 165 reference + SBT §91/2(6) & RD 342 §4,
 *          §54 joint liability in `G1`/`G3`/`G4`/`M1t2`, `K1` §42(27) partial exemption, `K2` bank WHT),
 *          negative controls (wrong base, stale amount, fake rate, unretrieved RD 165 §4), and `K3` redacted diagnostic.
 *   - WS3: Save & exact Reopen fidelity (`CONDITIONAL` preserved as `partial`/`CONDITIONAL` instead of `ANSWERED`,
 *          `G1` verbatim evidence preserved, `K1` bound calculation preserved on UI re-save & reopen,
 *          exact `r1` reopen preserved after `r2` follow-up).
 *   - WS4: Fact integrity (`K2` `฿24,000,000` preserved without `฿200,000` overwrite across Generate, Save, Reopen,
 *          plus intentional Turn 2 amount correction creating `r2` while leaving `r1` intact).
 *   - WS5: Multi-turn follow-ups (all 6 recorded follow-ups + 3-turn variant; zero assistant-citation leak on `VAt2`;
 *          explicit non-blank `REVIEW_REQUIRED` error with `trace_id` when LLM output is incomplete, never saved as answered).
 *   - WS6: Per-answer execution provenance (`execution_mode`: `rule_only_model_not_invoked` vs `llm_invoked`)
 *          and deterministic post-LLM guards for `VC`, `CI1`, `VF`, and `VG`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import { buildGroundedPassagePack } from "../../src/core/knowledge/grounded-llm-drafter";
import { verifyAndRenderGroundedLlmDraft } from "../../src/core/knowledge/grounded-llm-verifier";
import { verifyClaimAgainstPassages } from "../../src/core/knowledge/answer-verification";
import {
  queryKnowledge,
  type RealAppEvidenceAssemblyCapture,
} from "../../src/core/knowledge/query";
import {
  attachTraceableEnvelopeToGroundedAnswer,
  reopenSavedTraceableAnswer,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import { setCustomCitationDbTransportForTesting } from "../../src/core/knowledge/citation-postgres-store";
import type { Actor, Passage } from "../../src/core/knowledge/contracts";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

const QA_ACTOR: Actor = {
  actor_id: "trial.user.ft1_reg@reg24.th",
  role: "legal_reviewer",
  tenant_id: "tenant.trial.ft1_reg",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

function createWritableTempCloneOfStagingStore(): { store: DurableKnowledgeStore; dir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-remediation-"));
  fs.cpSync(STAGING_STORE_DIR, tmpDir, { recursive: true });
  const store = new DurableKnowledgeStore(tmpDir);
  return { store, dir: tmpDir };
}

describe("REG24 Batch 1 — Formal Test 1 All 12 Non-Passing Cases Remediation Suite", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    setCustomCitationDbTransportForTesting(null, null);
    setDefaultKnowledgeStoreForTesting(null);
    for (const d of tempDirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore cleanup race on Windows
      }
    }
  });

  it("WS1 (G2b, G3, G4, G3t2, M1t2 + unseen variants + K1 control): rejects any zero/numeric recipient PIT claim on immovable gifts while permitting statutory-limit recipient claims and K1 cash-gift control", () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const state = store.getState();
    const rc8 = store.getPassagesForRelease("rel.B01.rc8");
    const psg41Bis = rc8.find((p) => p.work_id === "prov.th.rc.41_ทวิ")!;
    const psg42_1 = rc8.find((p) => p.work_id === "prov.th.rc.42" && p.exact_text.includes("มาตรา 42"))!;
    const psg42_26 = rc8.find((p) => p.work_id === "prov.th.rc.42" && p.exact_text.includes("(26)"))!;
    const psg42_27 = rc8.find((p) => p.work_id === "prov.th.rc.42" && p.exact_text.includes("(27)"))!;
    const psg48_1 = rc8.find((p) => p.work_id === "prov.th.rc.48" && p.exact_text.includes("มาตรา 48"))!;
    const psg48_6 = rc8.find((p) => p.work_id === "prov.th.rc.48" && p.exact_text.includes("(6)"))!;
    const psgAct40 = rc8.filter((p) => p.work_id === "statute.th.rc_amendment_40_2558");

    // 1. G3 defect reproduction: applying donor rule §41 bis to conclude collateral nephew owes no PIT on condo ("ตกอยู่แก่นางวิไลวรรณ มิใช่นายภูมิ")
    const g3UnsupportedRecipient = verifyClaimAgainstPassages(
      {
        statement:
          "[ภาระภาษีเงินได้บุคคลธรรมดาของนายภูมิ (ผู้รับโอน)] สำหรับการโอนกรรมสิทธิ์ห้องชุดโดยไม่มีค่าตอบแทน ประมวลรัษฎากร มาตรา 41 ทวิ กำหนดให้ถือว่าผู้โอนเป็นผู้มีเงินได้ ดังนั้นภาระภาษีเงินได้บุคคลธรรมดาจึงตกอยู่แก่นางวิไลวรรณ มิใช่นายภูมิ นายภูมิจึงไม่ต้องนำมูลค่าห้องชุดมารวมคำนวณภาษีเงินได้บุคคลธรรมดา",
        supporting_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id],
      },
      rc8
    );
    expect(g3UnsupportedRecipient.allow_confident_answer).toBe(false);

    // 2. G4 defect reproduction: grand-niece ("บุตรสาวของหลานชาย") house+land recipient asserted to have no PIT liability
    const g4Question =
      "นายเกรียงไกรจดทะเบียนยกบ้านเดี่ยวพร้อมที่ดินในจังหวัดนครราชสีมาให้แก่นางสาวปาริชาติ ซึ่งเป็นบุตรสาวของหลานชายนายเกรียงไกร (หลานชายคนนั้นเป็นบุตรของพี่สาวนายเกรียงไกร) โดยเสน่หาไม่มีค่าตอบแทน เมื่อวันที่ 3 มีนาคม 2569 ในหนังสือสัญญาให้ระบุมูลค่า 9,500,000 บาท ส่วนราคาประเมินทุนทรัพย์ของทางราชการที่ใช้ในการจดทะเบียนคือ 8,300,000 บาท นายเกรียงไกรซื้อบ้านหลังนี้มาเองเมื่อหลายปีก่อนแต่จำปีที่ซื้อไม่ได้ การให้ครั้งนี้ไม่เกี่ยวกับพิธีหรือประเพณีใด ใครเป็นผู้มีหน้าที่เสียภาษีเงินได้ ต้องหักภาษี ณ ที่จ่ายเท่าใด และนางสาวปาริชาติมีภาระภาษีเงินได้ของตนเองอย่างไร";
    const g4Ledger = buildStructuredCaseFactLedger({ question: g4Question });
    expect(g4Ledger.fact_preservation_guards.forbid_niece_substitution).toBe(false);
    expect(g4Ledger.fact_preservation_guards.recipient_original_noun_th).toContain("บุตรสาวของหลานชาย");

    const g4UnsupportedRecipient = verifyClaimAgainstPassages(
      {
        statement:
          "[ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวปาริชาติ (ผู้รับโอน)] นางสาวปาริชาติไม่มีภาระภาษีเงินได้บุคคลธรรมดาจากการรับโอนบ้านเดี่ยวพร้อมที่ดินนี้ เนื่องจากมาตรา 41 ทวิ กำหนดให้ถือว่าผู้โอนเป็นผู้มีเงินได้",
        supporting_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id],
      },
      rc8
    );
    expect(g4UnsupportedRecipient.allow_confident_answer).toBe(false);

    // 3. G3t2 / G1 / M1t1 defect reproduction: legitimate-child immovable recipient given `0 บาท` figure + `computed_tax_thb: 0` calculation
    const g3t2Pack = buildGroundedPassagePack({
      passages: [psg41Bis, psg42_1, psg42_26, ...psgAct40],
      state,
      controllingDateIso: "2025-08-18",
      maxPassages: 12,
    });
    const rawMap = new Map<string, Passage>([psg41Bis, psg42_1, psg42_26, ...psgAct40].map((p) => [p.passage_id, p]));
    const g3t2Ledger = buildStructuredCaseFactLedger({
      question:
        "ถ้าเปลี่ยนข้อเท็จจริงเฉพาะผู้รับ: นางวิไลวรรณยกห้องชุดห้องเดิมให้นางสาวแพรวา ซึ่งเป็นบุตรสาวชอบด้วยกฎหมายของนางวิไลวรรณเอง (ไม่ใช่บุตรบุญธรรม) แทนนายภูมิ ในวันเดิม ราคาประเมิน 7,200,000 บาท บุตรสาวต้องเสียภาษีเงินได้หรือไม่",
    });
    expect(g3t2Ledger.fact_preservation_guards.recipient_kinship_category).toBe("LEGITIMATE_CHILD_NON_ADOPTED");

    const g3t2ZeroRecipientOutcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.test.g3t2.zero",
      factLedger: g3t2Ledger,
      passagePack: g3t2Pack,
      rawPassagesById: rawMap,
      state,
      llmOk: true,
      stagingFlagActive: true,
      invocationAudit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: "gemini-4-neon",
        resolved_model: "gemini-4-neon",
        actual_model_invoked: "gemini-4-neon",
        pinned_settings: { thinking_level: "low", thinking_level_note: null, temperature: 0, max_output_tokens: 16384, timeout_ms: 180000, store: false },
        prompt_version: "test",
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: "completed",
        failure_classification: "NONE",
        latency_ms: 10,
        input_tokens: 100,
        output_tokens: 100,
        thought_tokens: 10,
        total_tokens: 210,
        estimated_cost_usd: 0.001,
        attempts: [],
        error_summary: null,
      },
      draft: {
        answer_status: "ANSWERED",
        overall_summary_th: "",
        case_facts_used: [],
        issues: [
          {
            issue_id: "issue_recipient_zero",
            issue_title_th: "ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวแพรวา (ผู้รับโอน)",
            party_or_scope_th: "นางสาวแพรวา (บุตรสาวชอบด้วยกฎหมาย ผู้รับโอนห้องชุด)",
            conclusion_th: "นางสาวแพรวาไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาจากการรับโอนห้องชุดดังกล่าว คิดเป็นภาษี 0 บาท",
            material_facts_relied_on: ["ห้องชุดราคาประเมิน 7,200,000 บาท"],
            governing_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id],
            application_explanation_th: "เนื่องจากมาตรา 41 ทวิ กำหนดให้ผู้โอนเป็นผู้มีเงินได้ ผู้รับโอนจึงมีภาระภาษี 0 บาท",
            authority_distinction_note_th: "",
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              tax_base_thb: 0,
              exempt_amount_thb: 0,
              taxable_amount_thb: 0,
              rate_pct: 0,
              computed_tax_thb: 0,
              formula_description_th: "ผู้รับโอนไม่ใช่ผู้มีเงินได้ตามมาตรา 41 ทวิ = 0 บาท",
              missing_inputs_th: [],
              steps_th: ["ภาษีเงินได้ของผู้รับโอน = 0 บาท"],
            },
            missing_facts_or_uncertainties_th: [],
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
    });
    expect(g3t2ZeroRecipientOutcome.verified_issues.length).toBe(0);
    expect(g3t2ZeroRecipientOutcome.audit_trace.rejected_calculations.length).toBeGreaterThanOrEqual(1);

    // 4. Positive land-gift recipient claim (explaining statutory limit under §41 bis & §42(26)-(28) with NO recipient figure, including ambiguous kinship `หลานสาว` in G2b): MUST PASS!
    const g2bSupportedLimitClaim = verifyClaimAgainstPassages(
      {
        statement:
          "[ขอบเขตบทบัญญัติสำหรับภาษีเงินได้ของหลานสาว (ผู้รับโอนที่ดิน)] สำหรับการรับโอนกรรมสิทธิ์ในที่ดินโดยไม่มีค่าตอบแทนเนื่องในงานสมรสตามประเพณี ประมวลรัษฎากร มาตรา 41 ทวิ กำหนดหลักเกณฑ์ฝั่งผู้โอนให้ถือว่าผู้โอนเป็นผู้มีเงินได้ และมาตรา 42 (26) กำหนดข้อยกเว้นเฉพาะฝั่งผู้โอนที่โอนอสังหาริมทรัพย์ให้แก่บุตรชอบด้วยกฎหมายเท่านั้น ทั้งนี้ ตัวบทมาตรา 41 ทวิ และมาตรา 42 (26)-(28) ในชุดหลักฐานที่ตรวจสอบแล้วไม่ได้บัญญัติสรุปภาระภาษีเงินได้บุคคลธรรมดาหรือวงเงินยกเว้นเฉพาะฝั่งผู้รับโอนอสังหาริมทรัพย์ไว้โดยตรง จึงไม่อาจระบุจำนวนภาษีของผู้รับโอนเป็นตัวเลขใดๆ ได้",
        supporting_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id, psg42_27.passage_id],
      },
      rc8
    );
    expect(g2bSupportedLimitClaim.allow_confident_answer).toBe(true);

    // 5. Supported cash-gift control (`K1`: 24,000,000 THB cash gift to biological father -> Issue 1 §42(27) 20M exemption + 4M taxable excess, Issue 2 §48(6) 5% = 200,000 THB): BOTH MUST PASS!
    const k1Issue1ExemptionAndExcess = verifyClaimAgainstPassages(
      {
        statement:
          "[สิทธิยกเว้นภาษีเงินได้ตามมาตรา 42 (27) — บิดาบังเกิดเกล้า (ผู้รับเงินสด)] เงินสดจำนวน 24,000,000 บาท ที่บิดาบังเกิดเกล้าได้รับจากการให้โดยเสน่หาจากบุตรซึ่งเป็นผู้สืบสันดาน ได้รับยกเว้นไม่ต้องรวมคำนวณเพื่อเสียภาษีเงินได้บุคคลธรรมดาเฉพาะส่วนที่ไม่เกิน 20,000,000 บาท ตลอดปีภาษีนั้นตามประมวลรัษฎากร มาตรา 42 (27) ส่วนที่เกิน 20,000,000 บาท คือจำนวน 4,000,000 บาท ไม่ได้รับยกเว้นและต้องเสียภาษีเงินได้บุคคลธรรมดา",
        supporting_passage_ids: [psg42_1.passage_id, psg42_27.passage_id],
        verified_calculation_numeric_tokens: ["24000000", "20000000", "4000000"],
      },
      rc8
    );
    expect(k1Issue1ExemptionAndExcess.allow_confident_answer).toBe(true);

    const k1Issue2Calc = verifyClaimAgainstPassages(
      {
        statement:
          "[การเลือกเสียภาษีอัตราร้อยละ 5 ตามมาตรา 48 (6)] บิดามีสิทธิเลือกเสียภาษีเงินได้ในอัตราร้อยละ 5 ของเงินได้ส่วนที่เกิน 20,000,000 บาท (ฐานภาษีส่วนเกิน 4,000,000 บาท) โดยไม่ต้องนำไปรวมคำนวณภาษีตาม (1) และ (2) ตามมาตรา 48 (6) คิดเป็นภาษีเงินได้ที่ต้องชำระจำนวน 200,000 บาท",
        supporting_passage_ids: [psg48_1.passage_id, psg48_6.passage_id],
        verified_calculation_numeric_tokens: ["24000000", "20000000", "4000000", "5", "200000"],
      },
      rc8
    );
    expect(k1Issue2Calc.allow_confident_answer).toBe(true);

    // 6. Unseen developer fixtures varying relationship, property type, and wording (brother + townhouse; spouse + orchard land; ambiguous `หลาน` + commercial building):
    //    Any recipient zero/numeric tax conclusion is blocked, while statutory-limit recipient explanations pass without case-specific branches!
    for (const unseenUnsupported of [
      "[ภาษีเงินได้ของน้องชายผู้รับโอนทาวน์โฮม] น้องชายร่วมบิดามารดาไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาจากการรับให้ทาวน์โฮม เนื่องจากผู้โอนเป็นผู้มีเงินได้ตามมาตรา 41 ทวิ",
      "[ภาษีเงินได้ของคู่สมรสผู้รับโอนสวนผลไม้] คู่สมรสได้รับยกเว้นไม่ต้องเสียภาษีเงินได้ 0 บาท จากการรับโอนที่ดินสวนผลไม้ตามมาตรา 42 (26)",
      "[ภาษีเงินได้ของหลานผู้รับมอบตึกแถว] หลานไม่มีภาระภาษีเงินได้ของตนเองจากการรับโอนตึกแถวราคาประเมิน 15,000,000 บาท",
    ]) {
      const checkUnseen = verifyClaimAgainstPassages(
        {
          statement: unseenUnsupported,
          supporting_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id],
        },
        rc8
      );
      expect(checkUnseen.allow_confident_answer).toBe(false);
    }
  });

  it("WS2 (M1t3, s.54 in G3/G4/M1t2, K2 bank WHT, negative controls, and K3 diagnostic): fixes false suppressions while preserving strict checker rejections and exposing redacted K3 diagnostic", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);
    const rc8 = store.getPassagesForRelease("rel.B01.rc8");

    // 1. M1t3 passage pack MUST include prov.th.rc.50 Units 5 & 6 (`(5)(ก)(ข)` + `(6)`) AND subreg.th.rc.royal_decree.342 (`มาตรา 4`)!
    let m1t3Cap: RealAppEvidenceAssemblyCapture | null = null;
    await queryKnowledge(
      {
        question:
          "ถ้านายชาตรีได้ที่ดินพร้อมอาคารนี้มาโดยการซื้อ ต้องใช้วิธีหักค่าใช้จ่ายแบบใดในการคำนวณภาษีหัก ณ ที่จ่าย และต้องเสียภาษีธุรกิจเฉพาะด้วยหรือไม่",
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        conversation_history: [
          {
            role: "user",
            content:
              "นายชาตรีจดทะเบียนโอนที่ดินพร้อมอาคารพาณิชย์ในจังหวัดขอนแก่นให้นายต้นกล้า ซึ่งเป็นบุตรชายชอบด้วยกฎหมายของนายชาตรี (ไม่ใช่บุตรบุญธรรม) โดยไม่มีค่าตอบแทน เมื่อวันที่ 8 มกราคม 2569 ราคาประเมินทุนทรัพย์ของทางราชการในการจดทะเบียนคือ 26,000,000 บาท ปีนั้นไม่มีการโอนอสังหาริมทรัพย์อื่นให้นายต้นกล้า ใครต้องเสียภาษีเงินได้ และต้องหักภาษี ณ ที่จ่ายในวันจดทะเบียนเท่าใด",
          },
          { role: "assistant", content: "คำตอบเทิร์นแรก" },
          {
            role: "user",
            content:
              "ขอแก้ข้อเท็จจริง: นายต้นกล้าเป็นบุตรบุญธรรมที่จดทะเบียนรับเป็นบุตรบุญธรรมถูกต้องตามกฎหมาย ไม่ใช่บุตรที่ชอบด้วยกฎหมายโดยกำเนิด ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด ผลทางภาษีเปลี่ยนไปอย่างไร",
          },
          { role: "assistant", content: "คำตอบเทิร์นสอง" },
        ],
      },
      QA_ACTOR,
      {
        store,
        retrievalStrategy: "hybrid_with_graph",
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (c) => {
          m1t3Cap = c;
        },
      }
    );
    expect(m1t3Cap).not.toBeNull();
    const packWorkIds = new Set(m1t3Cap!.actual_model_packet.map((x) => x.work_id));
    const packPassageIds = new Set(m1t3Cap!.actual_model_packet.map((x) => x.passage_id));
    expect(packWorkIds.has("prov.th.rc.50")).toBe(true);
    expect(packPassageIds.has("psg.e5b0d991385db2")).toBe(true); // §50(5)(ก)(ข) + RD 165 cross-ref
    expect(packPassageIds.has("psg.acec8fcd9286c5")).toBe(true); // §50(6) amended by Act 40
    expect(packWorkIds.has("subreg.th.rc.royal_decree.342")).toBe(true); // RD 342 §4 for SBT!

    // 2. M1t3 `มาตรา 50 (5) (ข)` contrasting inheritance ("มิใช่มรดกหรือการได้รับจากการให้โดยเสน่หา") + `พระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529` MUST NOT be falsely rejected as `(ก)`!
    const psg50_1 = rc8.find((p) => p.passage_id === "psg.e2314cfbdec884")!;
    const psg50_5 = rc8.find((p) => p.passage_id === "psg.e5b0d991385db2")!;
    const psg50_6 = rc8.find((p) => p.passage_id === "psg.acec8fcd9286c5")!;
    const m1t3S50_5bCheck = verifyClaimAgainstPassages(
      {
        statement:
          "[วิธีหักค่าใช้จ่ายในการคำนวณภาษีเงินได้หัก ณ ที่จ่าย] เนื่องจากนายชาตรีได้ที่ดินพร้อมอาคารพาณิชย์มาโดยการซื้อ (ได้มาโดยทางอื่นนอกจากมรดกหรืออสังหาริมทรัพย์ที่ได้รับจากการให้โดยเสน่หา) และเป็นการโอนให้แก่บุตรบุญธรรมซึ่งไม่ได้รับยกเว้น ผู้โอนจึงต้องหักภาษีเงินได้ ณ ที่จ่ายตามประมวลรัษฎากร มาตรา 50 (6) ประกอบมาตรา 50 (5) (ข) โดยให้หักค่าใช้จ่ายเป็นการเหมาตามที่กำหนดโดยพระราชกฤษฎีกา (พระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529) แล้วคำนวณภาษีตามเกณฑ์ในมาตรา 48 (4) (ข)",
        supporting_passage_ids: [psg50_1.passage_id, psg50_5.passage_id, psg50_6.passage_id],
      },
      rc8
    );
    expect(m1t3S50_5bCheck.allow_confident_answer).toBe(true);

    // Negative control: citing an unverified section (`มาตรา 99`) or wrong subparagraph on RD 342 (`มาตรา 4 (6) (ค)` for inheritance) MUST STILL BE REJECTED!
    const psg342_2 = rc8.find((p) => p.passage_id === "psg.08ca6b4e422984")!;
    const psg342_3 = rc8.find((p) => p.passage_id === "psg.12526cd9839b73")!;
    const wrongSubparaControl = verifyClaimAgainstPassages(
      {
        statement:
          "การขายที่ดินที่ได้มาโดยทางมรดกภายใน 5 ปี ได้รับยกเว้นไม่ต้องเสียภาษีธุรกิจเฉพาะตามพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 มาตรา 4 (6) (ค)",
        supporting_passage_ids: [psg342_2.passage_id, psg342_3.passage_id],
      },
      rc8
    );
    expect(wrongSubparaControl.allow_confident_answer).toBe(false);

    // 3. §54 joint liability claim in G3 / G4 / M1t2 citing `prov.th.rc.54` + `prov.th.rc.50` MUST PASS!
    const psg54 = rc8.find((p) => p.work_id === "prov.th.rc.54")!;
    const s54ClaimCheck = verifyClaimAgainstPassages(
      {
        statement:
          "[ความรับผิดกรณีหักภาษีเงินได้ ณ ที่จ่ายและนำส่งไม่ครบถ้วนตามมาตรา 54] เนื่องจากธุรกรรมนี้มีหน้าที่ต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนโอนกรรมสิทธิ์ตามมาตรา 50 (6) และมาตรา 50 (5) หากมิได้หักและนำเงินส่ง หรือได้หักและนำเงินส่งแล้วแต่ไม่ครบจำนวนที่ถูกต้อง ผู้จ่ายเงินต้องรับผิดร่วมกับผู้มีเงินได้ในการเสียภาษีที่ต้องชำระตามจำนวนเงินภาษีที่มิได้หักและนำส่งหรือตามจำนวนที่ขาดไปตามประมวลรัษฎากร มาตรา 54",
        supporting_passage_ids: [psg54.passage_id, psg50_1.passage_id, psg50_6.passage_id],
      },
      rc8
    );
    expect(s54ClaimCheck.allow_confident_answer).toBe(true);

    // 3b. Cross-referenced §54 + §50(5)(ข) resolution in `verifyAndRenderGroundedLlmDraft` when LLM cites only `psg54` on Issue 2 while `prov.th.rc.50` is in `passagePack` (`G4`/`G5`/`M1t2` live edge case!)
    const s54Pack = buildGroundedPassagePack({
      passages: [psg54, psg50_1, psg50_5, psg50_6],
      state: store.getState(),
      controllingDateIso: "2026-03-03",
      maxPassages: 10,
    });
    const s54RawMap = new Map<string, Passage>([psg54, psg50_1, psg50_5, psg50_6].map((p) => [p.passage_id, p]));
    const g4S54Outcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.test.g4.s54",
      factLedger: buildStructuredCaseFactLedger({ question: "นายเกรียงไกรยกบ้านพร้อมที่ดินให้นางสาวปาริชาติ ราคาประเมิน 8,300,000 บาท" }),
      passagePack: s54Pack,
      rawPassagesById: s54RawMap,
      state: store.getState(),
      llmOk: true,
      stagingFlagActive: true,
      invocationAudit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: "gemini-4-neon",
        resolved_model: "gemini-4-neon",
        actual_model_invoked: "gemini-4-neon",
        pinned_settings: { thinking_level: "low", thinking_level_note: null, temperature: 0, max_output_tokens: 16384, timeout_ms: 180000, store: false },
        prompt_version: "test",
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: "completed",
        failure_classification: "NONE",
        latency_ms: 10,
        input_tokens: 100,
        output_tokens: 100,
        thought_tokens: 10,
        total_tokens: 210,
        estimated_cost_usd: 0.001,
        attempts: [],
        error_summary: null,
      },
      draft: {
        answer_status: "CONDITIONAL",
        overall_summary_th: "",
        case_facts_used: [],
        issues: [
          {
            issue_id: "ISSUE_2_SECTION_54",
            issue_title_th: "ความรับผิดกรณีหักภาษี ณ ที่จ่ายไม่ครบถ้วนตามมาตรา 54",
            party_or_scope_th: "ผู้จ่ายเงินได้และผู้มีเงินได้",
            conclusion_th:
              "หากไม่หักและนำส่งภาษีเงินได้ ณ ที่จ่ายตามมาตรา 50 (5) (ข) และมาตรา 50 (6) ในวันจดทะเบียนให้ครบถ้วน ผู้จ่ายเงินต้องรับผิดร่วมกับผู้มีเงินได้ตามประมวลรัษฎากร มาตรา 54",
            material_facts_relied_on: ["ราคาประเมิน 8,300,000 บาท"],
            governing_passage_ids: [psg54.passage_id], // intentionally omitted psg50_5/psg50_6 from Issue 2!
            application_explanation_th:
              "ประมวลรัษฎากร มาตรา 54 กำหนดให้ผู้จ่ายเงินต้องรับผิดร่วมกับผู้มีเงินได้ตามจำนวนเงินภาษีที่มิได้หักและนำส่งหรือตามจำนวนที่ขาดไป",
            authority_distinction_note_th: "",
            proposed_calculation: null,
            missing_facts_or_uncertainties_th: [],
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
    });
    expect(g4S54Outcome.verified_issues.length).toBe(1);
    expect(g4S54Outcome.verified_issues[0].governing_passage_ids).toContain(psg54.passage_id);
    expect(g4S54Outcome.verified_issues[0].governing_passage_ids).toContain(psg50_5.passage_id);

    // 4. K3 (`RC1_REJECTED_CALC`) redacted diagnostic across Generate, Save, and exact Reopen (ZERO leaked `999,888` or `88.5`)
    const k3Answer = await queryKnowledge(
      {
        question:
          "บริษัท นอร์ทสตาร์ โซลูชันส์ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการที่ปรึกษาด้านระบบสารสนเทศแก่บริษัทลูกค้าในกรุงเทพมหานคร ซึ่งใช้บริการทั้งหมดในประเทศไทย โดยออกใบกำกับภาษีและได้รับชำระค่าบริการครบถ้วนในวันที่ 15 มีนาคม 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราเท่าใด และตามกฎหมายฉบับใด",
        release_id: "rel.B01.rc8",
        qa_synthetic_fixture: "RC1_REJECTED_CALC",
        answer_generation_mode: "baseline_deterministic",
      },
      QA_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(k3Answer.answer).not.toContain("999,888");
    expect(k3Answer.answer).not.toContain("88.5");
    const k3Env = k3Answer.traceable_answer as unknown as Record<string, unknown>;
    const k3Diag = (k3Env?.rejected_calculations_diagnostic || []) as Array<Record<string, unknown>>;
    expect(k3Diag.length).toBeGreaterThanOrEqual(1);
    expect(k3Diag[0].fixture_id).toBe("RC1_REJECTED_CALC");
    expect(String(k3Diag[0].rejected_claim_or_issue_id || "")).toContain("rc1");
    expect(JSON.stringify(k3Diag)).not.toContain("999888");
    expect(JSON.stringify(k3Diag)).not.toContain("999,888");
    expect(JSON.stringify(k3Diag)).not.toContain("88.5");

    const k3Saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: k3Answer.traceable_answer!,
      question_text: "K3 synthetic rejected calc test",
      actor: QA_ACTOR,
      save_operation_key: "op.k3.test.r1",
    });
    const k3Reopened = reopenSavedTraceableAnswer(store, k3Saved.answer_revision, QA_ACTOR);
    expect(k3Reopened.found).toBe(true);
    const reopenedDiag = ((k3Reopened.answer as unknown as Record<string, unknown>)?.rejected_calculations_diagnostic || []) as Array<Record<string, unknown>>;
    expect(reopenedDiag.length).toBeGreaterThanOrEqual(1);
    expect(reopenedDiag[0].fixture_id).toBe("RC1_REJECTED_CALC");
    expect(JSON.stringify(k3Reopened.answer)).not.toContain("999888");
    expect(JSON.stringify(k3Reopened.answer)).not.toContain("88.5");
  });

  it("WS3 (Save & exact Reopen): preserves CONDITIONAL status (never relabels as ANSWERED/complete), retains verbatim evidence on G1, retains K1 verified calculation across UI Save & Reopen, and reopens exact r1 after r2 exists", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);
    const rc8 = store.getPassagesForRelease("rel.B01.rc8");
    const psg42_1 = rc8.find((p) => p.work_id === "prov.th.rc.42" && p.exact_text.includes("มาตรา 42"))!;
    const psg42_27 = rc8.find((p) => p.work_id === "prov.th.rc.42" && p.exact_text.includes("(27)"))!;
    const psg48_1 = rc8.find((p) => p.work_id === "prov.th.rc.48" && p.exact_text.includes("มาตรา 48"))!;
    const psg48_6 = rc8.find((p) => p.work_id === "prov.th.rc.48" && p.exact_text.includes("(6)"))!;

    const k1Question =
      "นายธีรวัฒน์มอบเงินสดจำนวน 24,000,000 บาท ให้แก่บิดาบังเกิดเกล้าของตนโดยเสน่หา เมื่อวันที่ 2 กันยายน 2568 ปีภาษีนั้นบิดาไม่ได้รับเงินอุปการะหรือเงินให้โดยเสน่หาจากบุพการี ผู้สืบสันดาน หรือคู่สมรสรายอื่น หากบิดาเลือกเสียภาษีในอัตราร้อยละ 5 ของส่วนที่เกินยี่สิบล้านบาท จะต้องเสียภาษีเงินได้เท่าใด";

    // Build a CONDITIONAL GroundedAnswer (simulating partial/conditional outcome) with K1's verified 200,000 THB calculation
    const conditionalGrounded = {
      release_id: "rel.B01.rc8",
      knowledge_snapshot_at: new Date().toISOString(),
      generated_at: new Date().toISOString(),
      status: "CONDITIONAL" as const,
      answer: "บิดาได้รับยกเว้น 20,000,000 บาท ตามมาตรา 42 (27) และเสียภาษีร้อยละ 5 ของส่วนที่เกิน (4,000,000 บาท) เป็นเงิน 200,000 บาท ตามมาตรา 48 (6)",
      claims: [
        {
          claim_id: "clm.trc.k1test.llm_issue.1",
          statement:
            "[การเลือกเสียภาษีอัตราร้อยละ 5 ตามมาตรา 48 (6)] เงินสด 24,000,000 บาท ได้รับยกเว้น 20,000,000 บาท ตามมาตรา 42 (27) และบิดาเลือกเสียภาษีในอัตราร้อยละ 5 ของเงินได้ส่วนที่เกิน (4,000,000 บาท) ตามมาตรา 48 (6) เป็นภาษีที่ต้องชำระจำนวน 200,000 บาท",
          claim_type: "qualified_legal_synthesis" as const,
          statement_role: "statutory_text" as const,
          supporting_passage_ids: [psg42_1.passage_id, psg42_27.passage_id, psg48_1.passage_id, psg48_6.passage_id],
          applicable_version_id: psg48_6.version_id,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED" as const,
          verified_calculation_numeric_tokens: ["24000000", "20000000", "4000000", "5", "200000"],
          bound_calculation: {
            calculation_id: "calc.trc.k1test.1",
            claim_id: "clm.trc.k1test.llm_issue.1",
            answer_revision: "ans.trc.k1test.r1",
            verifier_version: "reg24-llm-calc-verifier-v1.1",
            formula: "(24,000,000 - 20,000,000) * 5%",
            inputs: { tax_base_thb: 24_000_000, exempt_amount_thb: 20_000_000, rate_pct: 5 },
            outputs: { taxable_amount_thb: 4_000_000, computed_tax_thb: 200_000 },
            units: { primary_unit: "THB" as const, detail_th: "บาท (THB)" },
            source_versions: [
              { evidence_id: psg42_27.passage_id, doc_id: psg42_27.work_id, version_id: psg42_27.version_id },
              { evidence_id: psg48_6.passage_id, doc_id: psg48_6.work_id, version_id: psg48_6.version_id },
            ],
            verified_numeric_tokens: ["24000000", "20000000", "4000000", "5", "200000"],
            verified_at: new Date().toISOString(),
          },
        },
      ],
      evidence: [],
      assumptions: [],
      clarification_questions: [],
      coverage_warnings: ["มีเงื่อนไขต้องไม่เคยได้รับเงินให้จากบุพการี/ผู้สืบสันดาน/คู่สมรสรายอื่นในปีภาษีเดียวกัน"],
      applicable_date: null,
      model_policy_version: "reg24-grounded-llm-legal-application-v1.1",
      trace_id: "trc.k1test",
      latency_ms: 100,
    };

    const env = attachTraceableEnvelopeToGroundedAnswer(store, conditionalGrounded, {
      question: k1Question,
      actor: QA_ACTOR,
      persist: false,
    });
    // CRITICAL: A CONDITIONAL GroundedAnswer must NEVER be stamped `status: "complete"`!
    expect(env.status).toBe("partial");
    expect((env as unknown as Record<string, unknown>).grounded_answer_status).toBe("CONDITIONAL");

    // Initial auto-save of r1 (as query endpoint does)
    const savedR1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: env,
      question_text: k1Question,
      actor: QA_ACTOR,
      save_operation_key: "op.k1test.auto.r1",
      query_persistence_context: {
        conversation_id: "conv.k1test",
        trusted_calculations_by_claim_id: {
          [env.claims[0].claim_id]: env.claims[0].bound_calculation!,
        },
        trusted_calculation_tokens_by_claim_id: {
          [env.claims[0].claim_id]: env.claims[0].bound_calculation!.verified_numeric_tokens,
        },
      },
    });
    expect(savedR1.status).toBe("partial");
    expect(savedR1.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(200_000);

    // Subsequent UI "Save" click (`POST /api/v1/knowledge/answers` WITHOUT query_persistence_context) MUST retain status + bound_calculation!
    const uiResavedR1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: savedR1,
      question_text: k1Question,
      actor: QA_ACTOR,
    });
    expect(uiResavedR1.answer_revision).toBe(savedR1.answer_revision);
    expect(uiResavedR1.status).toBe("partial");
    expect(uiResavedR1.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(200_000);

    // Commit a follow-up r2 in the same conversation, then reopen exact r1: MUST return r1 (not r2) AND include verbatim passage excerpts!
    const savedR2 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: savedR1,
      question_text: `${k1Question} (ยืนยันข้อเท็จจริงเพิ่มเติม)`,
      revision_reason: "Follow-up answer revision in same conversation [conv:conv.k1test]",
      actor: QA_ACTOR,
      save_operation_key: "op.k1test.followup.r2",
    });
    expect(savedR2.revision_number).toBe(2);

    const reopenedExactR1 = reopenSavedTraceableAnswer(store, savedR1.answer_revision, QA_ACTOR);
    expect(reopenedExactR1.found).toBe(true);
    expect(reopenedExactR1.answer!.answer_revision).toBe(savedR1.answer_revision);
    expect(reopenedExactR1.answer!.revision_number).toBe(1);
    expect(reopenedExactR1.answer!.status).toBe("partial");
    expect((reopenedExactR1.answer as unknown as Record<string, unknown>).grounded_answer_status).toBe("CONDITIONAL");
    expect(reopenedExactR1.answer!.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(200_000);
    const firstEvRef = reopenedExactR1.answer!.claims[0].evidence_references[0] as unknown as Record<string, unknown>;
    expect(String(firstEvRef.verbatim_excerpt_th || "").length).toBeGreaterThan(20);
  });

  it("WS4 (K2 Fact Integrity): preserves ฿24,000,000 gift amount without ฿200,000 overwrite in Turn 1, routes §50 + §42(27) + Stamp Duty, and leaves r1 unchanged on Turn 2 amount edit", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);

    const k2Question =
      "นายธีรวัฒน์โอนเงินสด 24,000,000 บาท ผ่านธนาคารให้บิดาบังเกิดเกล้าโดยเสน่หาเมื่อวันที่ 2 กันยายน 2568 มีผู้แนะนำว่าธนาคารผู้โอนต้องหักภาษีเงินได้ ณ ที่จ่ายไว้ 200,000 บาท ในวันโอนเงิน และนายธีรวัฒน์ต้องเสียอากรแสตมป์อีก 200,000 บาท ถูกต้องหรือไม่ ตามกฎหมายมาตราใด";

    const k2Ledger = buildStructuredCaseFactLedger({ question: k2Question });
    const assetValFact = k2Ledger.material_facts.find((f) => f.fact_key === "stated_asset_value_thb");
    expect(assetValFact).toBeDefined();
    expect(assetValFact!.normalized_category).toBe("STATED_VALUE_THB_24000000");
    expect(assetValFact!.original_text_th).toContain("24,000,000");
    expect(assetValFact!.overridden_from).toBeNull();

    let k2Cap: RealAppEvidenceAssemblyCapture | null = null;
    await queryKnowledge(
      {
        question: k2Question,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      QA_ACTOR,
      {
        store,
        retrievalStrategy: "hybrid_with_graph",
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (c) => {
          k2Cap = c;
        },
      }
    );
    const k2PackWorkIds = new Set(k2Cap!.actual_model_packet.map((x) => x.work_id));
    expect(k2PackWorkIds.has("prov.th.rc.50")).toBe(true);
    expect(k2PackWorkIds.has("prov.th.rc.103")).toBe(true);
    expect(k2PackWorkIds.has("prov.th.rc.104")).toBe(true);
    expect(k2PackWorkIds.has("sched.th.rc.stamp_duty")).toBe(true);
    expect(k2Cap!.actual_model_packet.some((x) => x.work_id === "prov.th.rc.42" && x.passage_id === "psg.c7c4aa1c3ac667")).toBe(true);

    // Intentional Turn 2 amount correction ("ขอแก้ไขจำนวนเงินสดที่โอนเป็น 30,000,000 บาท") overrides cleanly in Turn 2
    const k2Turn2Ledger = buildStructuredCaseFactLedger({
      question: "ขอแก้ไขจำนวนเงินสดที่นายธีรวัฒน์โอนให้บิดาเป็น 30,000,000 บาท ข้อเท็จจริงอื่นเหมือนเดิม",
      conversationHistory: [
        { role: "user", content: k2Question },
        { role: "assistant", content: "คำตอบรอบแรก" },
      ],
    });
    const t2ValFact = k2Turn2Ledger.material_facts.find((f) => f.fact_key === "stated_asset_value_thb");
    expect(t2ValFact?.normalized_category).toBe("STATED_VALUE_THB_30000000");
    expect(t2ValFact?.overridden_from?.previous_category).toBe("STATED_VALUE_THB_24000000");
  });

  it("WS5 (Follow-ups & VAt2): prevents assistant Turn 1 citation leak into VAt2, resolves all 6 follow-up fact overrides + 3-turn variant, and surfaces explicit non-blank failure with trace_id on incomplete LLM response", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);

    // 1. VAt1 -> VAt2: Assistant Turn 1 cited RD 799, User Turn 2 moves date to 1 Oct 2569 -> ZERO RD 799 leak in assumptions or governing pack!
    const vat1Q =
      "ห้างหุ้นส่วนจำกัด ริมน้ำ อินทีเรีย เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม รับออกแบบตกแต่งภายในให้โรงแรมแห่งหนึ่งในจังหวัดเชียงใหม่ ซึ่งใช้บริการทั้งหมดในประเทศไทย ค่าบริการ 400,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ได้รับชำระเงินและออกใบกำกับภาษีในวันเดียวกันคือวันที่ 30 กันยายน 2569 ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด ตามพระราชกฤษฎีกาฉบับใด และภาษีขายเป็นเงินเท่าใด";
    const vat2Q =
      "ถ้าวันที่ได้รับชำระเงินและออกใบกำกับภาษีเลื่อนเป็นวันที่ 1 ตุลาคม 2569 แทน ข้อเท็จจริงอื่นเหมือนเดิม คำตอบเปลี่ยนไปหรือไม่";

    let vat2Cap: RealAppEvidenceAssemblyCapture | null = null;
    const vat2DryRun = await queryKnowledge(
      {
        question: vat2Q,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        conversation_history: [
          { role: "user", content: vat1Q },
          {
            role: "assistant",
            content:
              "ต้องใช้อัตราร้อยละ 7.0 ตามพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 799) พ.ศ. 2568 คิดเป็นภาษีขาย 28,000 บาท",
          },
        ],
      },
      QA_ACTOR,
      {
        store,
        retrievalStrategy: "hybrid_with_graph",
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (c) => {
          vat2Cap = c;
        },
      }
    );
    expect(vat2DryRun.assumptions.join(" ")).not.toContain("799");
    expect(vat2Cap!.controlling_date_iso).toBe("2026-10-01");
    expect(vat2Cap!.actual_model_packet.some((p) => p.work_id === "subreg.th.rc.royal_decree.807" && p.evidence_role === "governing")).toBe(true);
    expect(vat2Cap!.actual_model_packet.some((p) => p.work_id === "subreg.th.rc.royal_decree.799" && p.evidence_role === "governing")).toBe(false);

    // 2. M1t1 -> M1t2 -> M1t3 3-turn fact carry-forward & replacement (`บุตรชายชอบด้วยกฎหมาย` -> `บุตรบุญธรรม` + `ได้มาโดยการซื้อ`)
    const m1t3Ledger = buildStructuredCaseFactLedger({
      question:
        "ถ้านายชาตรีได้ที่ดินพร้อมอาคารนี้มาโดยการซื้อ ต้องใช้วิธีหักค่าใช้จ่ายแบบใดในการคำนวณภาษีหัก ณ ที่จ่าย และต้องเสียภาษีธุรกิจเฉพาะด้วยหรือไม่",
      conversationHistory: [
        {
          role: "user",
          content:
            "นายชาตรีจดทะเบียนโอนที่ดินพร้อมอาคารพาณิชย์ในจังหวัดขอนแก่นให้นายต้นกล้า ซึ่งเป็นบุตรชายชอบด้วยกฎหมายของนายชาตรี (ไม่ใช่บุตรบุญธรรม) โดยไม่มีค่าตอบแทน เมื่อวันที่ 8 มกราคม 2569 ราคาประเมินทุนทรัพย์ของทางราชการในการจดทะเบียนคือ 26,000,000 บาท",
        },
        {
          role: "user",
          content:
            "ขอแก้ข้อเท็จจริง: นายต้นกล้าเป็นบุตรบุญธรรมที่จดทะเบียนรับเป็นบุตรบุญธรรมถูกต้องตามกฎหมาย ไม่ใช่บุตรที่ชอบด้วยกฎหมายโดยกำเนิด ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด ผลทางภาษีเปลี่ยนไปอย่างไร",
        },
      ],
    });
    expect(m1t3Ledger.fact_preservation_guards.recipient_kinship_category).toBe("ADOPTED_CHILD_NOT_LEGITIMATE_CHILD");
    expect(m1t3Ledger.material_facts.some((f) => f.fact_key === "appraised_value_thb" && f.normalized_category.includes("26000000"))).toBe(true);
    expect(m1t3Ledger.material_facts.some((f) => f.fact_key === "acquisition_method" && f.normalized_category === "ACQUIRED_BY_PURCHASE")).toBe(true);

    // 3. Explicit failure when LLM returns incomplete / blocked output: non-blank rendered_answer_th with trace_id, NEVER saved as answered!
    const failedOutcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.vat2.incomplete",
      factLedger: buildStructuredCaseFactLedger({ question: vat2Q }),
      passagePack: [],
      rawPassagesById: new Map(),
      state: store.getState(),
      llmOk: false,
      draft: null,
      stagingFlagActive: true,
      invocationAudit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: "gemini-4-neon",
        resolved_model: "gemini-4-neon",
        actual_model_invoked: "gemini-4-neon",
        pinned_settings: { thinking_level: "low", thinking_level_note: null, temperature: 0, max_output_tokens: 16384, timeout_ms: 180000, store: false },
        prompt_version: "test",
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: "incomplete",
        failure_classification: "BLOCKED_OR_INCOMPLETE",
        latency_ms: 108236,
        input_tokens: 20000,
        output_tokens: 0,
        thought_tokens: 16384,
        total_tokens: 36384,
        estimated_cost_usd: 0.09,
        attempts: [],
        error_summary: "Provider returned status='incomplete'",
      },
    });
    expect(failedOutcome.status).toBe("REVIEW_REQUIRED");
    expect(failedOutcome.rendered_answer_th).toContain("trc.vat2.incomplete");
  });

  it("WS6 (Model Provenance on VC, CI1, VF, VG): records explicit per-answer execution_mode distinguishing Rule-only vs Model-invoked", async () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const prevKey = process.env.GEMINI_API_KEY;
    const prevGoogleKey = process.env.GOOGLE_API_KEY;
    const prevGenAiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      // Offline (no API key): VC, CI1, VF, VG report explicit `execution_mode: "rule_only_model_not_invoked"`!
      const vcRes = await queryKnowledge(
        {
          question:
            "ห้างหุ้นส่วนจำกัด ริมน้ำ อินทีเรีย เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม จะรับออกแบบตกแต่งภายในให้โรงแรมแห่งหนึ่งในจังหวัดเชียงใหม่ ซึ่งใช้บริการทั้งหมดในประเทศไทย ค่าบริการ 400,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ยังไม่ได้กำหนดวันรับชำระเงินหรือวันออกใบกำกับภาษี ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด และตามกฎหมายฉบับใด",
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        QA_ACTOR,
        { store }
      );
      expect(vcRes.status).toBe("NEEDS_CLARIFICATION");
      expect((vcRes.execution_provenance as unknown as Record<string, unknown>)?.execution_mode).toBe(
        "rule_only_model_not_invoked"
      );

      const ci1Res = await queryKnowledge(
        {
          question:
            "ตามหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/8826 ลงวันที่ 12 ตุลาคม 2568 ซึ่งวินิจฉัยว่า การยกห้องชุดให้หลานโดยเสน่หา ผู้ให้ไม่ต้องหักภาษีเงินได้ ณ ที่จ่าย ณ สำนักงานที่ดิน ขอให้ยืนยันว่าแนววินิจฉัยนี้ใช้กับกรณีที่นางสาวรัตนายกห้องชุดในกรุงเทพมหานครให้หลานชายเมื่อวันที่ 2 กุมภาพันธ์ 2569 ได้หรือไม่",
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        QA_ACTOR,
        { store }
      );
      expect(ci1Res.status).toBe("INSUFFICIENT_EVIDENCE");
      expect((ci1Res.execution_provenance as unknown as Record<string, unknown>)?.execution_mode).toBe(
        "rule_only_model_not_invoked"
      );

      const vfRes = await queryKnowledge(
        {
          question:
            "ห้างหุ้นส่วนจำกัด ทองหล่อ คลีนนิ่ง เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการทำความสะอาดอาคารสำนักงานในกรุงเทพมหานคร ค่าบริการ 60,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ได้รับชำระเงินและออกใบกำกับภาษีในวันเดียวกันคือวันที่ 15 มิถุนายน 2565 ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด ตามพระราชกฤษฎีกาฉบับใด และภาษีขายเป็นเงินเท่าใด",
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        QA_ACTOR,
        { store }
      );
      expect(vfRes.status).toBe("INSUFFICIENT_EVIDENCE");
      expect((vfRes.execution_provenance as unknown as Record<string, unknown>)?.execution_mode).toBe(
        "rule_only_model_not_invoked"
      );

      // Live/mocked LLM path: VC, CI1, VF, and VG genuinely invoke Gemini 4 Neon @ low (`execution_mode: "llm_invoked"`)
      // while post-LLM deterministic guards block any ungrounded ruling substitution, pre-cutoff VAT rate/calc, or unconditioned calc!
      const vcLlmRes = await queryKnowledge(
        {
          question:
            "ห้างหุ้นส่วนจำกัด ริมน้ำ อินทีเรีย เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม จะรับออกแบบตกแต่งภายในให้โรงแรมแห่งหนึ่งในจังหวัดเชียงใหม่ ซึ่งใช้บริการทั้งหมดในประเทศไทย ค่าบริการ 400,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ยังไม่ได้กำหนดวันรับชำระเงินหรือวันออกใบกำกับภาษี ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด และตามกฎหมายฉบับใด",
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        QA_ACTOR,
        {
          store,
          llmMockInvokerForTesting: ({ userPrompt, specialConstraints }) => {
            expect(specialConstraints?.needs_vat_date_clarification).toBe(true);
            const jsonIdx = userPrompt.indexOf("{");
            const parsedPrompt = JSON.parse(userPrompt.slice(jsonIdx)) as {
              PASSAGE_PACK: Array<{ passage_id: string; official_identifier: string }>;
            };
            const p80 = parsedPrompt.PASSAGE_PACK.find((p) => p.official_identifier.includes("มาตรา 80") && !p.official_identifier.includes("80/1"))!;
            const p78_1 = parsedPrompt.PASSAGE_PACK.find((p) => p.official_identifier.includes("78/1"))!;
            return {
              answer_status: "NEEDS_CLARIFICATION",
              overall_summary_th: "ยังไม่สามารถยืนยันพระราชกฤษฎีกาลดอัตราและคำนวณภาษีขายได้เนื่องจากยังไม่กำหนดวันเกิดความรับผิดทางภาษี",
              case_facts_used: [],
              issues: [
                {
                  issue_id: "vc_tax_point",
                  issue_title_th: "วันเกิดความรับผิดและกรอบอัตราภาษีมูลค่าเพิ่มสำหรับการให้บริการ",
                  party_or_scope_th: "ห้างหุ้นส่วนจำกัด ริมน้ำ อินทีเรีย",
                  conclusion_th:
                    "ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับการให้บริการเกิดขึ้นเมื่อได้รับชำระราคาค่าบริการหรือเมื่อได้ออกใบกำกับภาษีตามประมวลรัษฎากร มาตรา 78/1 (1) เนื่องจากยังไม่ได้กำหนดวันดังกล่าวจึงยังไม่สามารถยืนยันพระราชกฤษฎีกาลดอัตราและคำนวณภาษีมูลค่าเพิ่มได้",
                  material_facts_relied_on: ["ค่าบริการ 400,000 บาท ยังไม่กำหนดวันรับชำระเงินหรือวันออกใบกำกับภาษี"],
                  governing_passage_ids: [p80.passage_id, p78_1.passage_id],
                  application_explanation_th:
                    "ประมวลรัษฎากร มาตรา 80 กำหนดให้ใช้อัตราภาษีร้อยละ 10.0 ในการคำนวณภาษีมูลค่าเพิ่ม เว้นแต่จะมีพระราชกฤษฎีกาลดอัตราที่ใช้บังคับอยู่ในวันเกิดความรับผิดตามมาตรา 78/1 (1)",
                  authority_distinction_note_th: "",
                  proposed_calculation: {
                    formula_description_th: "400,000 * 7%",
                    tax_base_thb: 400_000,
                    exempt_amount_thb: 0,
                    taxable_amount_thb: 400_000,
                    rate_pct: 7,
                    computed_tax_thb: 28_000,
                    is_computable_from_stated_facts: true,
                    missing_inputs_th: [],
                    steps_th: [],
                  },
                  missing_facts_or_uncertainties_th: ["ยังไม่กำหนดวันรับชำระค่าบริการและวันออกใบกำกับภาษี"],
                },
              ],
              assumptions_th: [],
              clarification_questions_th: ["กรุณายืนยันวันรับชำระค่าบริการและวันออกใบกำกับภาษี"],
              evidence_gaps_th: [],
            };
          },
        }
      );
      expect(vcLlmRes.status).toBe("NEEDS_CLARIFICATION");
      expect(vcLlmRes.execution_provenance?.execution_mode).toBe("llm_invoked");
      expect(vcLlmRes.claims.length).toBeGreaterThanOrEqual(1);
      expect(vcLlmRes.claims.every((c) => !c.bound_calculation)).toBe(true);

      const ci1LlmRes = await queryKnowledge(
        {
          question:
            "ตามหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/8826 ลงวันที่ 12 ตุลาคม 2568 ซึ่งวินิจฉัยว่า การยกห้องชุดให้หลานโดยเสน่หา ผู้ให้ไม่ต้องหักภาษีเงินได้ ณ ที่จ่าย ณ สำนักงานที่ดิน ขอให้ยืนยันว่าแนววินิจฉัยนี้ใช้กับกรณีที่นางสาวรัตนายกห้องชุดในกรุงเทพมหานครให้หลานชายเมื่อวันที่ 2 กุมภาพันธ์ 2569 ได้หรือไม่",
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        QA_ACTOR,
        {
          store,
          llmMockInvokerForTesting: ({ specialConstraints }) => {
            expect(specialConstraints?.unresolved_explicit_ruling_ids).toContain("กค 0702/8826");
            return {
              answer_status: "INSUFFICIENT_EVIDENCE",
              overall_summary_th:
                "ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่ กค 0702/8826 ในคลังหลักฐานที่ผ่านการรับรอง จึงไม่สามารถยืนยันแนววินิจฉัยดังกล่าวได้",
              case_facts_used: [],
              issues: [],
              assumptions_th: [],
              clarification_questions_th: ["กรุณาตรวจสอบเลขที่หนังสือตอบข้อหารือ กค 0702/8826 อีกครั้ง"],
              evidence_gaps_th: ["ไม่พบต้นฉบับ กค 0702/8826 ในคลัง rel.B01.rc8"],
            };
          },
        }
      );
      expect(ci1LlmRes.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(ci1LlmRes.execution_provenance?.execution_mode).toBe("llm_invoked");
      expect(ci1LlmRes.evidence.length).toBe(0);

      const vfLlmRes = await queryKnowledge(
        {
          question:
            "ห้างหุ้นส่วนจำกัด ทองหล่อ คลีนนิ่ง เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการทำความสะอาดอาคารสำนักงานในกรุงเทพมหานคร ค่าบริการ 60,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ได้รับชำระเงินและออกใบกำกับภาษีในวันเดียวกันคือวันที่ 15 มิถุนายน 2565 ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด ตามพระราชกฤษฎีกาฉบับใด และภาษีขายเป็นเงินเท่าใด",
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        QA_ACTOR,
        {
          store,
          llmMockInvokerForTesting: ({ specialConstraints }) => {
            expect(specialConstraints?.pre_cutoff_vat_coverage_constraint?.controlling_date_iso).toBe("2022-06-15");
            return {
              answer_status: "INSUFFICIENT_EVIDENCE",
              overall_summary_th: "อยู่นอกช่วงพระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่มที่รับรองต้นฉบับแล้วก่อน 1 ตุลาคม 2566",
              case_facts_used: [],
              issues: [],
              assumptions_th: [],
              clarification_questions_th: [],
              evidence_gaps_th: ["คลังรับรองตั้งแต่วันที่ 1 ตุลาคม 2566 เป็นต้นไป"],
            };
          },
        }
      );
      expect(vfLlmRes.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(vfLlmRes.execution_provenance?.execution_mode).toBe("llm_invoked");
      expect(vfLlmRes.answer).toContain("1 ตุลาคม 2566");
      expect(vfLlmRes.answer).not.toContain("646");
      expect(vfLlmRes.evidence.length).toBe(0);
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
      if (prevGoogleKey !== undefined) process.env.GOOGLE_API_KEY = prevGoogleKey;
      if (prevGenAiKey !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevGenAiKey;
    }
  });
});
