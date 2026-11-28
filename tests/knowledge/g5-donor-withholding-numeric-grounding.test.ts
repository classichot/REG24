import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { queryKnowledge, type RealAppEvidenceAssemblyCapture } from "../../src/core/knowledge/query";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";
import { DurableKnowledgeStore, setDefaultKnowledgeStoreForTesting } from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";

type AssembledPacketItem = RealAppEvidenceAssemblyCapture["actual_model_packet"][number];

const SYNTHETIC_QA_ACTOR: Actor = {
  actor_id: "trial.user.g5_synthetic@reg24.th",
  role: "reader",
  tenant_id: "tenant.trial.g5_synthetic",
  authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.g5_synthetic"],
  csrf_verified: true,
};

function cloneCanonicalStoreToTemp(prefix: string): { dir: string; store: DurableKnowledgeStore } {
  const srcDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const gz = path.join(srcDir, "canonical-state.json.gz");
  if (fs.existsSync(gz)) {
    fs.copyFileSync(gz, path.join(dir, "canonical-state.json.gz"));
  } else {
    fs.copyFileSync(path.join(srcDir, "canonical-state.json"), path.join(dir, "canonical-state.json"));
  }
  const store = new DurableKnowledgeStore(dir);
  return { dir, store };
}

/**
 * Independent synthetic regression suite for donor-withholding numeric grounding
 * on gratuitous immovable-property transfers (RC §§41 bis, 49 bis, 42(26), 50(6), 50(5)(ก), 48(4)(ก), 48(4)).
 *
 * Uses strictly synthetic facts/names (never copies sealed QA prompts or keys).
 */
describe("G5 Synthetic Regression — Donor Withholding §48(4)(ก) / §48(4) Numeric Grounding", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  const SYNTHETIC_INHERITED_LAND_PROMPT =
    "วันที่ 12 สิงหาคม 2568 นายสมชายโอนกรรมสิทธิ์ที่ดินเปล่าซึ่งได้รับมรดกมาจากมารดา ให้แก่นางสาวนิดา (หลานสาว) โดยไม่มีค่าตอบแทน ราคาประเมินทุนทรัพย์ของทางราชการ 12,000,000 บาท แต่ยังไม่ทราบปีที่ได้รับมรดก ขอทราบภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายของผู้โอน ความรับผิดตามมาตรา 54 และภาษีธุรกิจเฉพาะ";

  const SYNTHETIC_PURCHASED_LAND_PROMPT =
    "วันที่ 12 สิงหาคม 2568 นายสมชายโอนกรรมสิทธิ์ที่ดินเปล่าซึ่งซื้อมาเอง ให้แก่นางสาวนิดา (หลานสาว) โดยไม่มีค่าตอบแทน ราคาประเมินทุนทรัพย์ของทางราชการ 12,000,000 บาท แต่ยังไม่ทราบปีที่ซื้อมา ขอทราบภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายของผู้โอน";

  beforeEach(() => {
    const cloned = cloneCanonicalStoreToTemp("reg24-g5-synth-");
    tmpDir = cloned.dir;
    store = cloned.store;
    setDefaultKnowledgeStoreForTesting(store);
  });

  afterEach(() => {
    setDefaultKnowledgeStoreForTesting(null);
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  async function runSyntheticDonorDraft(params: {
    question: string;
    conclusion: string;
    explanation: string;
    includeRc48Unit5?: boolean;
    includeExtraUnmentioned41Bis?: boolean;
  }) {
    let pack: AssembledPacketItem[] = [];
    const ans = await queryKnowledge(
      {
        question: params.question,
        applicable_date: null,
        answer_generation_mode: "llm_grounded",
        release_id: "rel.B01.rc8",
        mode: "standard",
      },
      SYNTHETIC_QA_ACTOR,
      {
        store,
        onRealAppEvidenceAssembly: (cap) => {
          pack = cap.actual_model_packet;
        },
        llmMockInvokerForTesting: async () => {
          const byWork = (wid: string) =>
            pack.filter((p) => p.work_id === wid && p.evidence_role === "governing").map((p) => p.passage_id);
          const rc48Target = params.includeRc48Unit5 === false
            ? ["psg.35d2ae2eddfff5"]
            : ["psg.35d2ae2eddfff5", "psg.a5d9ae11eeb4a7"];
          const rc48Ids = byWork("prov.th.rc.48").filter((id) => rc48Target.includes(id));
          const govIds = [
            ...(params.includeExtraUnmentioned41Bis ? ["psg.2d4d9a3802f2f0"] : byWork("prov.th.rc.41_ทวิ")),
            ...byWork("prov.th.rc.49_ทวิ"),
            ...byWork("prov.th.rc.42").filter((id) => id === "psg.c7c4aa1c3ac667"),
            ...byWork("prov.th.rc.50").filter((id) =>
              ["psg.e5b0d991385db2", "psg.acec8fcd9286c5"].includes(id)
            ),
            ...rc48Ids,
          ];
          const draft: GroundedLlmDraftResponse = {
            answer_status: "CONDITIONAL",
            overall_summary_th: params.conclusion,
            case_facts_used: [
              {
                fact_label_th: "ทรัพย์สินที่โอน",
                original_fact_th: "ที่ดินเปล่า ราคาประเมิน 12,000,000 บาท",
                source_turn: 1,
                legal_significance_th: "ใช้เกณฑ์มาตรา 50 (6) ประกอบมาตรา 50 (5) และมาตรา 48 (4)",
              },
            ],
            issues: [
              {
                issue_id: "ISSUE_1_TRANSFEROR_PIT_WHT",
                issue_title_th: "ภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายของผู้โอน",
                party_or_scope_th: "นายสมชาย (ผู้โอนที่ดินเปล่า)",
                conclusion_th: params.conclusion,
                application_explanation_th: params.explanation,
                authority_distinction_note_th: "อ้างอิงเฉพาะกฎหมายแม่บทตามประมวลรัษฎากร",
                governing_passage_ids: govIds,
                asserted_authorities: [
                  { work_id: "prov.th.rc.41_ทวิ", section: "มาตรา 41 ทวิ" },
                  { work_id: "prov.th.rc.49_ทวิ", section: "มาตรา 49 ทวิ" },
                  { work_id: "prov.th.rc.42", section: "มาตรา 42 (26)" },
                  { work_id: "prov.th.rc.50", section: "มาตรา 50 (6)" },
                  { work_id: "prov.th.rc.48", section: "มาตรา 48 (4) (ก)" },
                ],
                contrast_mentions: [],
                material_facts_relied_on: ["โอนที่ดินเปล่าให้หลานสาวโดยไม่มีค่าตอบแทน ราคาประเมิน 12,000,000 บาท"],
                missing_facts_or_uncertainties_th: [
                  "ไม่ทราบปีที่ได้มาซึ่งที่ดิน",
                  "ไม่มีบัญชีอัตราภาษีเงินได้บุคคลธรรมดาในชุดหลักฐาน",
                ],
                proposed_calculation: null,
              },
              {
                issue_id: "ISSUE_2_SEC54",
                issue_title_th: "ความรับผิดกรณีหักและนำส่งไม่ครบตามมาตรา 54",
                party_or_scope_th: "ผู้โอนตามมาตรา 50 (6)",
                conclusion_th:
                  "หากมิได้หักและนำส่งภาษีตามมาตรา 50 (6) ประกอบมาตรา 50 (5) (ก) หรือนำส่งไม่ครบ ผู้จ่ายเงินต้องรับผิดร่วมตามมาตรา 54",
                application_explanation_th:
                  "ตามมาตรา 54 ผู้จ่ายเงินตามมาตรา 50 ที่มิได้หักและนำส่งหรือนำส่งไม่ครบต้องรับผิดร่วมกับผู้มีเงินได้",
                authority_distinction_note_th: "กฎหมายแม่บท",
                governing_passage_ids: [
                  ...byWork("prov.th.rc.54"),
                  ...byWork("prov.th.rc.50").filter((id) =>
                    ["psg.e5b0d991385db2", "psg.acec8fcd9286c5"].includes(id)
                  ),
                ],
                asserted_authorities: [
                  { work_id: "prov.th.rc.54", section: "มาตรา 54" },
                  { work_id: "prov.th.rc.50", section: "มาตรา 50 (6)" },
                ],
                contrast_mentions: [],
                material_facts_relied_on: ["ผู้โอนมีหน้าที่หักภาษี ณ ที่จ่ายตามมาตรา 50 (6)"],
                missing_facts_or_uncertainties_th: [],
                proposed_calculation: null,
              },
            ],
            assumptions_th: [],
            clarification_questions_th: ["ผู้โอนได้รับมรดกที่ดินเปล่าแปลงนี้ในปี พ.ศ. ใด"],
            evidence_gaps_th: ["ตารางบัญชีอัตราภาษีเงินได้บุคคลธรรมดาไม่ได้รวมอยู่ในชุดหลักฐาน"],
          };
          return draft;
        },
      }
    );
    return ans;
  }

  it("preserves supported donor-withholding conclusion & citations when stating §48(4)(ก) 50% deduction (6,000,000 THB) and §48(4) 20% cap (<= 2,400,000 THB) with proposed_calculation=null", async () => {
    const ans = await runSyntheticDonorDraft({
      question: SYNTHETIC_INHERITED_LAND_PROMPT,
      conclusion:
        "นายสมชาย (ผู้โอน) ถือเป็นผู้มีเงินได้ตามมาตรา 41 ทวิ จากราคาประเมิน 12,000,000 บาทตามมาตรา 49 ทวิ ไม่ได้รับยกเว้นตามมาตรา 42 (26) เนื่องจากหลานสาวมิใช่บุตรชอบด้วยกฎหมาย และต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนตามมาตรา 50 (6) ประกอบมาตรา 50 (5) (ก) และมาตรา 48 (4) (ก) โดยหักค่าใช้จ่ายเป็นการเหมาร้อยละ 50 (6,000,000 บาท) คงเหลือเงินได้สุทธิ 6,000,000 บาท ก่อนหารด้วยจำนวนปีที่ถือครอง (ไม่เกิน 10 ปี) และเมื่อคำนวณภาษีแล้วต้องเสียไม่เกินร้อยละ 20 ของราคาขาย (ไม่เกิน 2,400,000 บาท) แต่ไม่สามารถคำนวณจำนวนเงินภาษีหัก ณ ที่จ่ายสุดท้ายได้เพราะไม่ทราบปีที่ได้รับมรดกและไม่มีตารางอัตราภาษีในชุดหลักฐาน",
      explanation:
        "ตามมาตรา 41 ทวิ มาตรา 49 ทวิ มาตรา 42 (26) มาตรา 50 (6) มาตรา 50 (5) (ก) และมาตรา 48 (4) (ก) สำหรับอสังหาริมทรัพย์อันเป็นมรดก ให้หักค่าใช้จ่ายร้อยละ 50 ของเงินได้ 12,000,000 บาท คิดเป็น 6,000,000 บาท เหลือเงินได้สุทธิ 6,000,000 บาท แล้วหารด้วยจำนวนปีที่ถือครอง (เกิน 10 ปีนับ 10 ปี เศษของปีนับเป็น 1 ปี) โดยภาษีที่คำนวณได้ต้องไม่เกินร้อยละ 20 ของราคาขาย (ไม่เกิน 2,400,000 บาท)",
    });

    const suppressed = (ans.coverage_warnings || []).filter((w) => w.includes("ระงับประเด็นร่าง"));
    expect(suppressed).toEqual([]);
    expect(ans.claims.length).toBe(2);
    const donorClaim = ans.claims.find((c) => /มาตรา\s*48\s*\(4\)\s*\(ก\)/.test(c.statement));
    expect(donorClaim).toBeDefined();
    expect(donorClaim!.supporting_passage_ids).toContain("psg.35d2ae2eddfff5");
    expect(donorClaim!.supporting_passage_ids).toContain("psg.a5d9ae11eeb4a7");
    expect(donorClaim!.supporting_passage_ids).toContain("psg.e5b0d991385db2");
    expect(donorClaim!.supporting_passage_ids).toContain("psg.acec8fcd9286c5");
    expect(donorClaim!.supporting_passage_ids).toContain("psg.2d4d9a3802f2f0");
    expect(donorClaim!.supporting_passage_ids).toContain("psg.9ae0fef7dcf0a6");
  });

  it("auto-binds sibling governing §48 Unit 5 when Unit 4 is cited with 10-year/1-year/20% cap wording even if an unmentioned passage requires IRRELEVANT_CITED_PASSAGE pruning", async () => {
    const ans = await runSyntheticDonorDraft({
      question: SYNTHETIC_INHERITED_LAND_PROMPT,
      includeRc48Unit5: false,
      includeExtraUnmentioned41Bis: true,
      conclusion:
        "นายสมชายผู้โอนกรรมสิทธิ์ในอสังหาริมทรัพย์ต้องหักภาษีเงินได้ ณ ที่จ่ายตามมาตรา 50 (6) ประกอบมาตรา 50 (5) (ก) และมาตรา 48 (4) (ก) โดยถือตามราคาประเมินทุนทรัพย์ 12,000,000 บาทตามมาตรา 49 ทวิ (ไม่ได้รับยกเว้นตามมาตรา 42 (26)) หักค่าใช้จ่ายร้อยละ 50 (6,000,000 บาท) หารด้วยจำนวนปีที่ถือครองไม่เกิน 10 ปี เศษของปีนับเป็น 1 ปี และเสียไม่เกินร้อยละ 20 ของราคาขาย (ไม่เกิน 2,400,000 บาท)",
      explanation:
        "ตามมาตรา 50 (6) มาตรา 50 (5) (ก) มาตรา 49 ทวิ (ราคาประเมินทุนทรัพย์สำหรับการโอนกรรมสิทธิ์ในอสังหาริมทรัพย์) มาตรา 42 (26) และมาตรา 48 (4) (ก) หักค่าใช้จ่ายร้อยละ 50 คงเหลือ 6,000,000 บาท หารด้วยจำนวนปีที่ถือครองสูงสุด 10 ปี เศษของปีนับเป็น 1 ปี และภาษีต้องไม่เกินร้อยละ 20 ของราคาขาย (ไม่เกิน 2,400,000 บาท)",
    });

    const suppressed = (ans.coverage_warnings || []).filter((w) => w.includes("ระงับประเด็นร่าง"));
    expect(suppressed).toEqual([]);
    expect(ans.claims.length).toBe(2);
    const donorClaim = ans.claims.find((c) => /มาตรา\s*48\s*\(4\)\s*\(ก\)/.test(c.statement));
    expect(donorClaim).toBeDefined();
    expect(donorClaim!.supporting_passage_ids).toContain("psg.35d2ae2eddfff5");
    expect(donorClaim!.supporting_passage_ids).toContain("psg.a5d9ae11eeb4a7");
  });

  it("strictly blocks unsupported fabricated tax amounts, unsupported tax rates, unframed 20% figure asserted as actual tax, and 50% deduction misapplied to purchased property", async () => {
    // 1. Fabricated final WHT tax figure (850,000 THB) -> MUST BE BLOCKED!
    const badTaxAmt = await runSyntheticDonorDraft({
      question: SYNTHETIC_INHERITED_LAND_PROMPT,
      conclusion:
        "นายสมชายต้องหักภาษีเงินได้ ณ ที่จ่ายตามมาตรา 41 ทวิ มาตรา 49 ทวิ มาตรา 42 (26) มาตรา 50 (6) มาตรา 50 (5) (ก) และมาตรา 48 (4) (ก) เป็นจำนวนเงินภาษี 850,000 บาท",
      explanation:
        "คำนวณจากฐาน 12,000,000 บาท หักค่าใช้จ่ายร้อยละ 50 เหลือ 6,000,000 บาท คิดเป็นภาษีที่ต้องหัก ณ ที่จ่าย 850,000 บาท",
    });
    expect(
      (badTaxAmt.coverage_warnings || []).some(
        (w) => w.includes("ISSUE_1_TRANSFEROR_PIT_WHT") && w.includes("UNGROUNDED_NUMERIC_ASSERTION")
      )
    ).toBe(true);
    expect(badTaxAmt.claims.some((c) => /850,000/.test(c.statement))).toBe(false);

    // 2. Fabricated tax rate (25%) -> MUST BE BLOCKED!
    const badRate = await runSyntheticDonorDraft({
      question: SYNTHETIC_INHERITED_LAND_PROMPT,
      conclusion:
        "นายสมชายต้องหักภาษีเงินได้ ณ ที่จ่ายในอัตราร้อยละ 25 จากราคาประเมิน 12,000,000 บาท ตามมาตรา 41 ทวิ มาตรา 49 ทวิ มาตรา 42 (26) มาตรา 50 (6) และมาตรา 48 (4) (ก)",
      explanation: "ใช้อัตราภาษีร้อยละ 25 กับเงินได้ 12,000,000 บาท",
    });
    expect(
      (badRate.coverage_warnings || []).some(
        (w) => w.includes("ISSUE_1_TRANSFEROR_PIT_WHT") && w.includes("UNGROUNDED_NUMERIC_ASSERTION")
      )
    ).toBe(true);
    expect(badRate.claims.some((c) => /ร้อยละ\s*25/.test(c.statement))).toBe(false);

    // 3. 2,400,000 THB asserted as ACTUAL tax owed WITHOUT ceiling/cap framing -> MUST BE BLOCKED!
    const unframedCapAsActualTax = await runSyntheticDonorDraft({
      question: SYNTHETIC_INHERITED_LAND_PROMPT,
      conclusion:
        "นายสมชายต้องหักภาษีเงินได้ ณ ที่จ่ายตามมาตรา 41 ทวิ มาตรา 49 ทวิ มาตรา 42 (26) มาตรา 50 (6) มาตรา 50 (5) (ก) และมาตรา 48 (4) (ก) เป็นเงินภาษีที่ต้องชำระจริง 2,400,000 บาท",
      explanation:
        "ตามมาตรา 48 (4) คำนวณภาษีเงินได้หัก ณ ที่จ่ายจากราคาประเมิน 12,000,000 บาท เป็นเงินภาษีที่ต้องนำส่ง 2,400,000 บาท",
    });
    expect(
      (unframedCapAsActualTax.coverage_warnings || []).some(
        (w) => w.includes("ISSUE_1_TRANSFEROR_PIT_WHT") && w.includes("UNGROUNDED_NUMERIC_ASSERTION")
      )
    ).toBe(true);
    expect(unframedCapAsActualTax.claims.some((c) => /2,400,000/.test(c.statement))).toBe(false);

    // 4. Purchased (non-inherited) property misapplying §48(4)(ก) 50% deduction (6,000,000 THB) -> MUST BE BLOCKED!
    const purchasedWrong50Pct = await runSyntheticDonorDraft({
      question: SYNTHETIC_PURCHASED_LAND_PROMPT,
      conclusion:
        "นายสมชายต้องหักภาษีเงินได้ ณ ที่จ่ายตามมาตรา 41 ทวิ มาตรา 49 ทวิ มาตรา 42 (26) มาตรา 50 (6) และมาตรา 48 (4) จากราคาประเมิน 12,000,000 บาท โดยหักค่าใช้จ่ายร้อยละ 50 (6,000,000 บาท) คงเหลือเงินได้สุทธิ 6,000,000 บาท",
      explanation:
        "หักค่าใช้จ่ายร้อยละ 50 ของราคาประเมิน 12,000,000 บาท คิดเป็น 6,000,000 บาท คงเหลือเงินได้สุทธิ 6,000,000 บาท",
    });
    expect(
      (purchasedWrong50Pct.coverage_warnings || []).some(
        (w) => w.includes("ISSUE_1_TRANSFEROR_PIT_WHT") && w.includes("UNGROUNDED_NUMERIC_ASSERTION")
      )
    ).toBe(true);
    expect(purchasedWrong50Pct.claims.some((c) => /6,000,000/.test(c.statement))).toBe(false);
  });
});
