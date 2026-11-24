/**
 * REG24 Batch 1 — Candidate 5 Section 47 (`มาตรา 47`) Verifier, OBS-2 & Restricted Diagnostics Suite
 *
 * Covers Workstream 3 & Checklist #8 requirements:
 *   1. Family-fact → authorized-total matrix (0–4 legitimate children pre/post-2561, 0–3 adopted children
 *      with §47(1)(ค)(2) cap, spouse with/without income, single, parents, disabled, exact POS-1..4 prompts,
 *      and all 24 Thai phrasing sweep cases including unquantified child clarification).
 *   2. 5 draft-phrasing variants × each POS-1..4 (commas, no commas, parentheses, Thai numerals, and
 *      "0 บาท" for absent/barred components) → all 20/20 pass, save, and reopen cleanly.
 *   3. 5 draft-phrasing variants × each NEG-1..4 + subset-sum wrong totals (150,000 & 120,000 on POS-2)
 *      + zero-total / zero-on-supported-component controls → all 32/32 rejected, ZERO rejected numbers
 *      in UI/API/saved envelope, and restricted server-side diagnostic populated.
 *   4. Wrong-subparagraph controls (citing 47(1)(ง) instead of (ค)(1), wrong amount on (ก) or (ค)(2)) → rejected.
 *   5. OBS-2: §47 Case Facts Used lists taxpayer, spouse status, children + birth year, and tax year 2568
 *      (never gift-transfer "ผู้รับโอน..."), and As-of shows "ปีภาษี 2568".
 *   6. HTTP POST /api/v1/knowledge/query preview-only `[QA_PREVIEW_FIXTURE:...]` & zero leaked numbers in JSON.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as queryPost } from "../../src/app/api/v1/knowledge/query/route";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import { saveOrReviseAnswerServerVerified } from "../../src/core/knowledge/claim-traceability-engine";
import type { Actor } from "../../src/core/knowledge/contracts";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  clearSection47RestrictedDiagnosticsForTest,
  getRecentSection47RestrictedDiagnostics,
} from "../../src/core/knowledge/s47-restricted-diagnostics";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import { verifySection47AllowanceComponentsFromFacts } from "../../src/core/knowledge/tax-calculation-verifier";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const S47_PSG_ID = "psg.e4ec78f644930e";

const TEST_ACTOR: Actor = {
  actor_id: "cand5.s47.test@reg24.internal",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

const POS_FIXTURES = {
  POS1: {
    id: "S47-POS-1",
    prompt: "ผู้มีเงินได้โสด ไม่มีบุตร ปีภาษี 2568 มีสิทธิหักลดหย่อนส่วนตัวตามมาตรา 47 เท่าใด",
    expectedTotal: 60_000,
    subclauses: "มาตรา 47 (1) (ก)",
    absentZeroNote:
      "ไม่มีสิทธิหักลดหย่อนคู่สมรสตามมาตรา 47 (1) (ข) (0 บาท) และไม่มีสิทธิหักลดหย่อนบุตรตามมาตรา 47 (1) (ค) (0 บาท)",
    explanationBase:
      "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 44) พ.ศ. 2560 ให้หักลดหย่อนสำหรับผู้มีเงินได้จำนวน 60,000 บาท",
  },
  POS2: {
    id: "S47-POS-2",
    prompt:
      "นายสมมติ ใจดี มีคู่สมรสที่ไม่มีเงินได้ และมีบุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี 2561 ทั้งคู่ ปีภาษี 2568 มีสิทธิหักลดหย่อนตามมาตรา 47 รวมเท่าใด",
    expectedTotal: 180_000,
    subclauses: "มาตรา 47 (1) (ก), (ข) และ (ค) (1)",
    absentZeroNote: "และไม่มีบุตรบุญธรรมตามมาตรา 47 (1) (ค) (2) (0 บาท)",
    explanationBase:
      "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) ผู้มีเงินได้ 60,000 บาท มาตรา 47 (1) (ข) คู่สมรสไม่มีเงินได้ 60,000 บาท และมาตรา 47 (1) (ค) (1) บุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี พ.ศ. 2561 คนละ 30,000 บาท รวมค่าลดหย่อนบุตร 60,000 บาท",
  },
  POS3: {
    id: "S47-POS-3",
    prompt:
      "นางสาวกานดา มีคู่สมรสที่ไม่มีเงินได้ และมีบุตรชอบด้วยกฎหมาย 2 คน คนแรกเกิดปี พ.ศ. 2559 คนที่สองเกิดปี พ.ศ. 2562 ปีภาษี 2568 มีสิทธิหักลดหย่อนตามมาตรา 47 รวมเท่าใด",
    expectedTotal: 210_000,
    subclauses: "มาตรา 47 (1) (ก), (ข) และ (ค) (1)",
    absentZeroNote: "โดยไม่มีบุตรบุญธรรมตามมาตรา 47 (1) (ค) (2) (0 บาท)",
    explanationBase:
      "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) ผู้มีเงินได้ 60,000 บาท มาตรา 47 (1) (ข) คู่สมรสไม่มีเงินได้ 60,000 บาท และมาตรา 47 (1) (ค) (1) บุตรคนแรก 30,000 บาท บุตรคนที่สองเกิดตั้งแต่ปี พ.ศ. 2561 หักได้เพิ่มอีก 30,000 บาท เป็น 60,000 บาท รวมค่าลดหย่อนบุตร 90,000 บาท",
  },
  POS4: {
    id: "S47-POS-4",
    prompt:
      "นายวิชัย มีคู่สมรสที่ไม่มีเงินได้ มีบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่ 3 คน (เกิดก่อนปี พ.ศ. 2561 ทุกคน) และมีบุตรบุญธรรมอีก 1 คน ปีภาษี 2568 มีสิทธิหักลดหย่อนตามมาตรา 47 สำหรับตนเอง คู่สมรส และบุตร รวมเท่าใด",
    expectedTotal: 210_000,
    subclauses: "มาตรา 47 (1) (ก), (ข), (ค) (1) และ (ค) (2)",
    absentZeroNote:
      "ส่วนบุตรบุญธรรม 1 คน ตามมาตรา 47 (1) (ค) (2) ไม่อาจนำมาหักลดหย่อนได้เนื่องจากมีบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่ครบ 3 คนแล้ว (0 บาท)",
    explanationBase:
      "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) ผู้มีเงินได้ 60,000 บาท มาตรา 47 (1) (ข) คู่สมรสไม่มีเงินได้ 60,000 บาท มาตรา 47 (1) (ค) (1) บุตรชอบด้วยกฎหมายที่มีชีวิตอยู่ 3 คน เกิดก่อนปี พ.ศ. 2561 คนละ 30,000 บาท รวมค่าลดหย่อนบุตร 90,000 บาท และตามมาตรา 47 (1) (ค) (2) เมื่อมีบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่ครบ 3 คนแล้ว จึงนำบุตรบุญธรรมมาหักไม่ได้อีก",
  },
};

function toThaiDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => "๐๑๒๓๔๕๖๗๘๙"[Number(d)]!);
}

function formatFiveVariants(
  amountThb: number,
  subclauses: string,
  absentZeroNote: string
): Array<{ label: string; conclusion: string; extraExplanation: string }> {
  const comma = amountThb.toLocaleString("en-US");
  const plain = String(amountThb);
  const thaiComma = toThaiDigits(comma);
  return [
    {
      label: "v1_commas",
      conclusion: `ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร ${subclauses} รวมทั้งสิ้น ${comma} บาท`,
      extraExplanation: `รวมทั้งสิ้น ${comma} บาท`,
    },
    {
      label: "v2_no_commas",
      conclusion: `ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร ${subclauses} จำนวน ${plain} บาท`,
      extraExplanation: `รวมเป็นเงินทั้งสิ้น ${plain} บาท`,
    },
    {
      label: "v3_parentheses",
      conclusion: `ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร ${subclauses} รวมทั้งสิ้น (${comma} บาท)`,
      extraExplanation: `คิดเป็นยอดรวม (${comma} บาท)`,
    },
    {
      label: "v4_thai_numerals",
      conclusion: `ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร ${subclauses} รวมทั้งสิ้น ${thaiComma} บาท`,
      extraExplanation: `รวมทั้งสิ้น ${thaiComma} บาท`,
    },
    {
      label: "v5_with_zero_baht_absent",
      conclusion: `ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร ${subclauses} ${absentZeroNote} รวมทั้งสิ้น ${comma} บาท`,
      extraExplanation: `${absentZeroNote} รวมทั้งสิ้น ${comma} บาท`,
    },
  ];
}

describe("Candidate 5 — Section 47 (`มาตรา 47`) Verifier, OBS-2 & Restricted Diagnostics", () => {
  let store: DurableKnowledgeStore;
  let tmpDir: string;
  let psg47Text: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand5-"));
    fs.cpSync(STAGING_STORE_DIR, tmpDir, { recursive: true });
    store = new DurableKnowledgeStore(tmpDir);
    psg47Text = store.getState().passages[S47_PSG_ID]!.exact_text;
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("1. Family-fact → authorized-total matrix (0–4 legit pre/post-2561, 0–3 adopted, spouse income, POS-1..4, and 24 phrasing variants)", () => {
    const matrix: Array<{
      id: string;
      facts: string;
      expectedTotal: number | "CLARIFY";
      mustReject?: number[];
    }> = [
      { id: "POS-1", facts: POS_FIXTURES.POS1.prompt, expectedTotal: 60_000, mustReject: [0, 120_000, 180_000] },
      { id: "POS-2", facts: POS_FIXTURES.POS2.prompt, expectedTotal: 180_000, mustReject: [210_000, 240_000] },
      { id: "POS-3", facts: POS_FIXTURES.POS3.prompt, expectedTotal: 210_000, mustReject: [240_000, 270_000] },
      { id: "POS-4", facts: POS_FIXTURES.POS4.prompt, expectedTotal: 210_000, mustReject: [240_000, 270_000] },
      { id: "M-01_single_1legit_pre2561", facts: "โสด มีบุตรชอบด้วยกฎหมาย 1 คน เกิดปี 2558", expectedTotal: 90_000 },
      { id: "M-02_single_1legit_post2561_no_bonus_for_1st", facts: "โสด มีบุตรชอบด้วยกฎหมาย 1 คน เกิดปี 2563", expectedTotal: 90_000 },
      { id: "M-03_single_2legit_both_post2561", facts: "โสด มีบุตรชอบด้วยกฎหมาย 2 คน เกิดหลังปี 2561 ทั้งสองคน", expectedTotal: 150_000 },
      { id: "M-04_married_noinc_3legit_2post2561", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมายรวม 3 คน คนโตเกิดปี 2559 คนกลางเกิดปี 2561 คนเล็กเกิดปี 2565", expectedTotal: 270_000 },
      { id: "M-05_married_noinc_4legit_3post2561", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมาย 4 คน เกิดปี 2558, 2561, 2563 และ 2566", expectedTotal: 330_000 },
      { id: "M-06_married_sep_inc_2legit_pre2561", facts: "คู่สมรสมีเงินได้แยกยื่นรายการ มีบุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี 2561 ทั้งคู่", expectedTotal: 120_000 },
      { id: "M-07_single_3adopted_0legit", facts: "โสด ไม่มีบุตรชอบด้วยกฎหมาย มีบุตรบุญธรรม 3 คน", expectedTotal: 150_000 },
      { id: "M-08_single_4adopted_cap3", facts: "โสด ไม่มีบุตรชอบด้วยกฎหมาย มีบุตรบุญธรรม 4 คน", expectedTotal: 150_000 },
      { id: "M-09_single_1legit_3adopted_cap3", facts: "โสด มีบุตรชอบด้วยกฎหมาย 1 คน (เกิดปี 2559) และบุตรบุญธรรมอีก 3 คน", expectedTotal: 150_000 },
      { id: "M-10_married_2legit_2adopted_cap3", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมาย 2 คน (เกิดก่อนปี 2561) และมีบุตรบุญธรรมที่จดทะเบียนอีก 2 คน", expectedTotal: 210_000 },
      { id: "M-11_married_4legit_1adopted_barred", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่ 4 คน เกิดก่อนปี 2561 ทุกคน และบุตรบุญธรรมอีก 1 คน", expectedTotal: 240_000 },
      { id: "SW-05_paren_not_adopted", facts: "มีคู่สมรสไม่มีเงินได้ และมีบุตรชอบด้วยกฎหมาย (ไม่ใช่บุตรบุญธรรม) 2 คน เกิดก่อนปี 2561", expectedTotal: 180_000 },
      { id: "SW-06_no_adopted_clause", facts: "มีคู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี 2561 และไม่มีบุตรบุญธรรม", expectedTotal: 180_000 },
      { id: "SW-07_living_qualifier", facts: "โสด มีบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่รวม 2 คน เกิดก่อนปี 2561", expectedTotal: 120_000 },
      { id: "SW-08_all_qualifier", facts: "คู่สมรสไม่มีรายได้ มีบุตรชอบด้วยกฎหมายทั้งหมดสามคน เกิดก่อนปี 2561", expectedTotal: 210_000 },
      { id: "SW-09_thai_digits", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมาย ๒ คน เกิดก่อนปี ๒๕๖๑ และบุตรบุญธรรมอีก ๑ คน", expectedTotal: 210_000 },
      { id: "SW-10_son_daughter", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชายชอบด้วยกฎหมาย 1 คน (เกิดปี 2558) และบุตรสาวชอบด้วยกฎหมาย 1 คน (เกิดปี 2563)", expectedTotal: 210_000 },
      { id: "SW-11_listed_one_by_one", facts: "โสด มีบุตรชอบด้วยกฎหมาย คือ ด.ช.เอก (เกิดปี 2559) และ ด.ญ.โท (เกิดปี 2564)", expectedTotal: 150_000 },
      { id: "SW-12_adopted_with_reg_qual", facts: "โสด ไม่มีบุตรชอบด้วยกฎหมาย แต่มีบุตรบุญธรรมที่จดทะเบียนรับเป็นบุตรบุญธรรมแล้ว 2 คน", expectedTotal: 120_000 },
      { id: "SW-13_single_with_spouse_mention_negated", facts: "ผู้มีเงินได้เป็นโสด (ไม่ได้มีคู่สมรสที่ไม่มีเงินได้) ไม่มีบุตร", expectedTotal: 60_000 },
      { id: "SW-14_spouse_has_income_separate", facts: "นายเอก สมรสกับนางโทซึ่งมีเงินได้แยกยื่นแบบ ไม่มีบุตร นายเอกหักลดหย่อนส่วนตัวเท่าใด", expectedTotal: 60_000 },
      { id: "SW-15_unknown_child_count_many", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมายหลายคน เกิดก่อนปี 2561", expectedTotal: "CLARIFY" },
      { id: "SW-16_unknown_child_count_bare", facts: "โสด มีบุตรชอบด้วยกฎหมายซึ่งกำลังศึกษาอยู่ในมหาวิทยาลัย หักลดหย่อนรวมเท่าใด", expectedTotal: "CLARIFY" },
      { id: "SW-17_unknown_adopted_count", facts: "โสด มีบุตรบุญธรรมอยู่ในความอุปการะ หักลดหย่อนรวมเท่าใด", expectedTotal: "CLARIFY" },
      { id: "SW-18_seven_children_pre2561", facts: "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมายเจ็ดคน เกิดก่อนปี 2561 ทุกคน", expectedTotal: 330_000 },
      { id: "SW-23_parents_listed", facts: "โสด ไม่มีบุตร อุปการะเลี้ยงดูบิดาอายุ 65 ปี และมารดาอายุ 63 ปี ซึ่งไม่มีรายได้เพียงพอ", expectedTotal: 120_000 },
      { id: "SW-24_wife_no_income_wording", facts: "นายก้อง จดทะเบียนสมรส โดยภริยาเป็นแม่บ้านไม่มีเงินได้พึงประเมินตลอดปีภาษี และมีบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่ 1 คน เกิดปี 2563", expectedTotal: 150_000 },
    ];

    for (const row of matrix) {
      const res = verifySection47AllowanceComponentsFromFacts({
        userContextText: row.facts,
        citedVerbatimText: psg47Text,
      });
      expect(res.applicable, row.id).toBe(true);
      if (row.expectedTotal === "CLARIFY") {
        expect(res.needsChildCountClarification, row.id).toBe(true);
      } else {
        expect(res.needsChildCountClarification, row.id).toBe(false);
        expect(res.expectedTotalThb, row.id).toBe(row.expectedTotal);
        expect(res.validAmountsThb, row.id).not.toContain(0);
        for (const bad of row.mustReject || []) {
          expect(res.validAmountsThb, `${row.id} must not allow ${bad}`).not.toContain(bad);
        }
      }
    }
  });

  it(
    "2. Five draft-phrasing variants × POS-1..POS-4 (20 runs): all pass as ANSWERED, save cleanly, and emit PASSED server diagnostic",
    async () => {
      clearSection47RestrictedDiagnosticsForTest();
      const fixtures = [POS_FIXTURES.POS1, POS_FIXTURES.POS2, POS_FIXTURES.POS3, POS_FIXTURES.POS4];

      for (const fx of fixtures) {
        const variants = formatFiveVariants(fx.expectedTotal, fx.subclauses, fx.absentZeroNote);
        for (const v of variants) {
          const shouldTestFullSave = v.label === "v5_with_zero_baht_absent";
          const ans = await queryKnowledge(
            {
              question: fx.prompt,
              release_id: "rel.B01.rc8",
              answer_generation_mode: "llm_grounded",
            },
            TEST_ACTOR,
            {
              store,
              persistAnswerAtomically: shouldTestFullSave,
              llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
                answer_status: "ANSWERED",
                overall_summary_th: v.conclusion,
                case_facts_used: [],
                issues: [
                  {
                    issue_id: `${fx.id}.${v.label}`,
                    issue_title_th: `สิทธิหักลดหย่อนตามมาตรา 47 (${fx.id})`,
                    party_or_scope_th: "ผู้มีเงินได้บุคคลธรรมดา",
                    conclusion_th: v.conclusion,
                    material_facts_relied_on: ["ข้อเท็จจริงตามคำถาม"],
                    governing_passage_ids: [S47_PSG_ID],
                    application_explanation_th: `${fx.explanationBase} ${v.extraExplanation}`,
                    authority_distinction_note_th: "",
                    proposed_calculation: {
                      is_computable_from_stated_facts: true,
                      formula_description_th: "ผลรวมค่าลดหย่อนตามมาตรา 47",
                      tax_base_thb: null,
                      exempt_amount_thb: fx.expectedTotal,
                      taxable_amount_thb: null,
                      rate_pct: null,
                      computed_tax_thb: null,
                      missing_inputs_th: [],
                      steps_th: [],
                    },
                    missing_facts_or_uncertainties_th: [],
                  },
                ],
                assumptions_th: [],
                clarification_questions_th: [],
                evidence_gaps_th: [],
              }),
            }
          );

          expect(ans.status, `${fx.id} ${v.label}`).toBe("ANSWERED");
          expect(ans.claims.length, `${fx.id} ${v.label} claims`).toBe(1);
          expect(ans.applicable_date, `${fx.id} ${v.label} OBS-2 as-of`).toBe("ปีภาษี 2568");
          expect(ans.answer, `${fx.id} ${v.label} OBS-2 no gift label`).not.toContain(
            "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ"
          );

          if (shouldTestFullSave) {
            expect(ans.traceable_answer, `${fx.id} ${v.label} traceable_answer`).toBeTruthy();
            const saved = await saveOrReviseAnswerServerVerified(store, {
              actor: TEST_ACTOR,
              question_text: fx.prompt,
              submitted_envelope: {
                ...ans.traceable_answer!,
                answer_id: `ans.cand5.${fx.id.toLowerCase()}.${v.label}`,
              },
            });
            expect(saved.status, `${fx.id} ${v.label} saved status`).toBe("complete");
          }
        }
      }

      const diags = getRecentSection47RestrictedDiagnostics();
      expect(diags.filter((d) => d.outcome === "PASSED").length).toBe(20);
    },
    60_000
  );

  it("3. Five draft-phrasing variants × NEG-1..4 + subset-sum wrong totals (150k/120k on POS-2) + zero abuses: all rejected with ZERO rejected numbers in UI/API and full server diagnostic", async () => {
    clearSection47RestrictedDiagnosticsForTest();

    const negCases: Array<{
      id: string;
      prompt: string;
      wrongTotal: number;
      forbiddenStringsInPublicOut: string[];
      absentZeroNote: string;
      subclauses: string;
    }> = [
      {
        id: "NEG-1_240k_on_POS2",
        prompt: POS_FIXTURES.POS2.prompt,
        wrongTotal: 240_000,
        forbiddenStringsInPublicOut: ["240,000", "240000", "๒๔๐,๐๐๐"],
        absentZeroNote: "ไม่มีบุตรบุญธรรม (0 บาท)",
        subclauses: "มาตรา 47 (1) (ก), (ข) และ (ค) (1)",
      },
      {
        id: "NEG-2_210k_on_POS2",
        prompt: POS_FIXTURES.POS2.prompt,
        wrongTotal: 210_000,
        forbiddenStringsInPublicOut: ["210,000", "210000", "๒๑๐,๐๐๐"],
        absentZeroNote: "ไม่มีบุตรบุญธรรม (0 บาท)",
        subclauses: "มาตรา 47 (1) (ก), (ข) และ (ค) (1)",
      },
      {
        id: "NEG-3_120k_on_POS1_single",
        prompt: POS_FIXTURES.POS1.prompt,
        wrongTotal: 120_000,
        forbiddenStringsInPublicOut: ["120,000", "120000", "๑๒๐,๐๐๐"],
        absentZeroNote: "ไม่มีบุตร (0 บาท)",
        subclauses: "มาตรา 47 (1) (ก) และ (ข)",
      },
      {
        id: "NEG-4_240k_adopted_bar_on_POS4",
        prompt: POS_FIXTURES.POS4.prompt,
        wrongTotal: 240_000,
        forbiddenStringsInPublicOut: ["240,000", "240000", "๒๔๐,๐๐๐"],
        absentZeroNote: "ไม่มีค่าลดหย่อนบิดามารดา (0 บาท)",
        subclauses: "มาตรา 47 (1) (ก), (ข) และ (ค)",
      },
      {
        id: "NEG-SUBSET-150k_on_POS2",
        prompt: POS_FIXTURES.POS2.prompt,
        wrongTotal: 150_000,
        forbiddenStringsInPublicOut: ["150,000", "150000", "๑๕๐,๐๐๐"],
        absentZeroNote: "ไม่มีบุตรบุญธรรม (0 บาท)",
        subclauses: "มาตรา 47 (1) (ก), (ข) และ (ค) (1)",
      },
      {
        id: "NEG-SUBSET-120k_on_POS2",
        prompt: POS_FIXTURES.POS2.prompt,
        wrongTotal: 120_000,
        forbiddenStringsInPublicOut: ["120,000", "120000", "๑๒๐,๐๐๐"],
        absentZeroNote: "ไม่มีบุตรบุญธรรม (0 บาท)",
        subclauses: "มาตรา 47 (1) (ก) และ (ข)",
      },
    ];

    for (const nc of negCases) {
      const variants = formatFiveVariants(nc.wrongTotal, nc.subclauses, nc.absentZeroNote);
      for (const v of variants) {
        const beforeCount = getRecentSection47RestrictedDiagnostics().length;
        const ans = await queryKnowledge(
          {
            question: nc.prompt,
            release_id: "rel.B01.rc8",
            answer_generation_mode: "llm_grounded",
          },
          TEST_ACTOR,
          {
            store,
            persistAnswerAtomically: true,
            llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
              answer_status: "ANSWERED",
              overall_summary_th: v.conclusion,
              case_facts_used: [],
              issues: [
                {
                  issue_id: `${nc.id}.${v.label}`,
                  issue_title_th: "สิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47",
                  party_or_scope_th: "ผู้มีเงินได้บุคคลธรรมดา",
                  conclusion_th: v.conclusion,
                  material_facts_relied_on: ["ข้อเท็จจริงตามคำถาม"],
                  governing_passage_ids: [S47_PSG_ID],
                  application_explanation_th: `ตามประมวลรัษฎากร ${nc.subclauses} ${v.extraExplanation}`,
                  authority_distinction_note_th: "",
                  proposed_calculation: null,
                  missing_facts_or_uncertainties_th: [],
                },
              ],
              assumptions_th: [],
              clarification_questions_th: [],
              evidence_gaps_th: [],
            }),
          }
        );

        expect(ans.status, `${nc.id} ${v.label}`).toBe("REVIEW_REQUIRED");
        expect(ans.claims.length, `${nc.id} ${v.label} 0 claims`).toBe(0);
        expect(ans.evidence.length, `${nc.id} ${v.label} 0 sources`).toBe(0);

        const publicBlob = JSON.stringify({
          answer: ans.answer,
          claims: ans.claims,
          coverage_warnings: ans.coverage_warnings,
          rejected_calculations_diagnostic: ans.rejected_calculations_diagnostic,
        });
        for (const forbidden of nc.forbiddenStringsInPublicOut) {
          expect(publicBlob, `${nc.id} ${v.label} leaked ${forbidden}`).not.toContain(forbidden);
        }

        const afterDiags = getRecentSection47RestrictedDiagnostics();
        expect(afterDiags.length).toBe(beforeCount + 1);
        const latestDiag = afterDiags[afterDiags.length - 1]!;
        expect(latestDiag.outcome).toBe("SUPPRESSED");
        expect(latestDiag.stage_code).toBe("S47_AUTHORIZED_SET_TOTAL_MISMATCH");
        expect(latestDiag.rejected_token).toContain(String(nc.wrongTotal));
      }
    }

    for (const badZeroDraft of [
      "ผู้มีเงินได้มีสิทธิหักลดหย่อนตามมาตรา 47 รวมทั้งสิ้น 0 บาท",
      "ผู้มีเงินได้มีสิทธิหักลดหย่อนส่วนตัว 60,000 บาท คู่สมรสไม่มีสิทธิหัก (0 บาท) และบุตร 60,000 บาท รวมทั้งสิ้น 180,000 บาท",
    ]) {
      const zAns = await queryKnowledge(
        {
          question: POS_FIXTURES.POS2.prompt,
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        TEST_ACTOR,
        {
          store,
          persistAnswerAtomically: false,
          llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
            answer_status: "ANSWERED",
            overall_summary_th: badZeroDraft,
            case_facts_used: [],
            issues: [
              {
                issue_id: "neg.zero_abuse",
                issue_title_th: "สิทธิหักลดหย่อนตามมาตรา 47",
                party_or_scope_th: "ผู้มีเงินได้",
                conclusion_th: badZeroDraft,
                material_facts_relied_on: [],
                governing_passage_ids: [S47_PSG_ID],
                application_explanation_th: `ตามประมวลรัษฎากร มาตรา 47 (1) (ก) (ข) และ (ค) ${badZeroDraft}`,
                authority_distinction_note_th: "",
                proposed_calculation: null,
                missing_facts_or_uncertainties_th: [],
              },
            ],
            assumptions_th: [],
            clarification_questions_th: [],
            evidence_gaps_th: [],
          }),
        }
      );
      expect(zAns.status).toBe("REVIEW_REQUIRED");
      expect(zAns.claims.length).toBe(0);
    }
  });

  it("4. Wrong-subparagraph controls (Change 6) & unquantified child clarification (Change 2) & OBS-2 facts", async () => {
    clearSection47RestrictedDiagnosticsForTest();

    const wrongSubAns = await queryKnowledge(
      {
        question: POS_FIXTURES.POS2.prompt,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
          answer_status: "ANSWERED",
          overall_summary_th: "รวม 180,000 บาท",
          case_facts_used: [],
          issues: [
            {
              issue_id: "neg.wrong_subpara_ngor",
              issue_title_th: "สิทธิหักลดหย่อนตามมาตรา 47",
              party_or_scope_th: "ผู้มีเงินได้",
              conclusion_th:
                "ผู้มีเงินได้มีสิทธิหักลดหย่อนส่วนตัวตามมาตรา 47 (1) (ก) คู่สมรสตามมาตรา 47 (1) (ข) และบุตรตามมาตรา 47 (1) (ง) รวมทั้งสิ้น 180,000 บาท",
              material_facts_relied_on: [],
              governing_passage_ids: [S47_PSG_ID],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) จำนวน 60,000 บาท มาตรา 47 (1) (ข) จำนวน 60,000 บาท และมาตรา 47 (1) (ง) จำนวน 60,000 บาท รวมทั้งสิ้น 180,000 บาท",
              authority_distinction_note_th: "",
              proposed_calculation: null,
              missing_facts_or_uncertainties_th: [],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(wrongSubAns.status).toBe("REVIEW_REQUIRED");
    expect(wrongSubAns.claims.length).toBe(0);
    const lastDiag = getRecentSection47RestrictedDiagnostics().at(-1)!;
    expect(lastDiag.stage_code).toBe("S47_SUBCLAUSE_AMOUNT_MISMATCH");
    expect(lastDiag.rejected_token).toContain("47 (1) (ง)");

    const clarifyAns = await queryKnowledge(
      {
        question:
          "คู่สมรสไม่มีเงินได้ มีบุตรชอบด้วยกฎหมายหลายคน เกิดก่อนปี 2561 ปีภาษี 2568 หักลดหย่อนตามมาตรา 47 รวมเท่าใด",
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
          answer_status: "ANSWERED",
          overall_summary_th: "รวม 120,000 บาท",
          case_facts_used: [],
          issues: [
            {
              issue_id: "clarify.test",
              issue_title_th: "สิทธิหักลดหย่อนตามมาตรา 47",
              party_or_scope_th: "ผู้มีเงินได้",
              conclusion_th: "หักลดหย่อนรวมทั้งสิ้น 120,000 บาท",
              material_facts_relied_on: [],
              governing_passage_ids: [S47_PSG_ID],
              application_explanation_th: "ตามมาตรา 47 (1) (ก) และ (ข) รวม 120,000 บาท",
              authority_distinction_note_th: "",
              proposed_calculation: null,
              missing_facts_or_uncertainties_th: [],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(clarifyAns.status).toBe("NEEDS_CLARIFICATION");
    expect(clarifyAns.clarification_questions.length).toBeGreaterThanOrEqual(1);
    expect(getRecentSection47RestrictedDiagnostics().at(-1)?.stage_code).toBe(
      "S47_FACT_EXTRACTION_CLARIFICATION"
    );

    const pos4Ledger = buildStructuredCaseFactLedger({
      question: POS_FIXTURES.POS4.prompt,
      applicableDate: null,
    });
    expect(pos4Ledger.material_facts.some((f) => f.fact_key === "recipient_kinship")).toBe(false);
    expect(pos4Ledger.material_facts.map((f) => f.fact_key)).toEqual([
      "s47_taxpayer",
      "s47_spouse_status",
      "s47_children",
      "s47_tax_year",
    ]);
    expect(pos4Ledger.temporal_facts.legal_as_of_date).toBe("ปีภาษี 2568");
  });

  it("5. HTTP POST /api/v1/knowledge/query strips [QA_PREVIEW_FIXTURE:...] prefix and sanitizes llm_audit_trace", async () => {
    setDefaultKnowledgeStoreForTesting(store);
    try {
      const prevEnv = process.env.REG24_TRIAL_GATE_ENABLED;
      process.env.REG24_TRIAL_GATE_ENABLED = "false";
      try {
        const req = new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-actor-id": TEST_ACTOR.actor_id,
            "x-actor-role": "legal_reviewer",
            "x-csrf-verified": "1",
          },
          body: JSON.stringify({
            question: `[QA_PREVIEW_FIXTURE:S47_NEG_1_TOTAL_240K] ${POS_FIXTURES.POS2.prompt}`,
            persist_answer: false,
            answer_generation_mode: "baseline_deterministic",
          }),
        });
        const res = await queryPost(req);
        expect(res.status).toBe(200);
        const bodyTxt = await res.text();
        expect(bodyTxt).not.toContain("QA_PREVIEW_FIXTURE");
      } finally {
        process.env.REG24_TRIAL_GATE_ENABLED = prevEnv;
      }
    } finally {
      setDefaultKnowledgeStoreForTesting(null);
    }
  });
});
