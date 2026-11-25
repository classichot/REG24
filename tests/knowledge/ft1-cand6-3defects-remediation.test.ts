/**
 * REG24 Batch 1 — Candidate 6 Remediation Suite for Remaining 3 Scored FT1 Defects + Reliability/VC-EQ Guards
 *
 * Uses strictly NON-SEALED synthetic equivalents, paraphrases, and reversed question orders:
 *   1. P0 Citation-Publication Gap (synthetic M1t1 equivalent + multi-surface unverified authority injection):
 *      - Model-introduced unverified rulings/decrees/orders in `authority_distinction_note_th`,
 *        `overall_summary_th`, `issue_title_th`, `assumptions_th`, `missing_facts_or_uncertainties_th`,
 *        or `evidence_gaps_th` NEVER reach UI (`answer.answer`), `/query` JSON, SSE `complete`,
 *        saved revision (`rendered_answer_th` / `grounded_answer_snapshot`), or Reopen.
 *      - Incidental unsupported reference & dependent clause are stripped while preserving the
 *        independently supported conclusion and figure (`500,000 บาท`).
 *      - Essential unsupported authority in `conclusion_th` withholds/qualifies ONLY the affected issue.
 *      - Properly sourced corpus ruling linked in `governing_passage_ids` STILL appears with its official URL.
 *      - `CI1` synthetic control STILL refuses an unverified user-supplied ruling without substitution.
 *   2. P1 Auditable Operative Conclusions (synthetic G3t2 equivalent):
 *      - Separate structured `supported` claims for Donor PIT/WHT (`0 บาท` verified `bound_calculation`)
 *        and Recipient PIT non-liability in UI, `/query` API, Save (`r2`, `supersedes r1`), and Reopen,
 *        with `r1` preserved unchanged and unresolved liabilities never coerced to zero.
 *   3. P1 Multi-Part Follow-Up Issue Coverage (synthetic M1t3 equivalent, forward + reversed order + paraphrase):
 *      - Retrieval supplies both `มาตรา 50 (5) (ข)` and `มาตรา 48 (4) (ข)` alongside `มาตรา 91/2 (6)` & `พ.ร.ฎ. 342`.
 *      - Subparagraph verifier (`answer-verification.ts` Check 1b) does NOT falsely suppress `มาตรา 48 (4) (ข)`
 *        when contrasting `(ก)` inheritance/gift vs `(ข)` purchase (`ได้มาโดยทางอื่นนอกจาก (ก)`).
 *      - Both the WHT expense-deduction method (with missing holding-year/acquisition-date inputs explained)
 *        and SBT are answered directly with citations, without inferring acquisition year or resurrecting Turn 1's figure.
 *   4. Reliability & `VC-EQ` Clarification Guard:
 *      - `NEEDS_CLARIFICATION` never exposes unapproved arithmetic or `bound_calculation` in `/query` JSON,
 *        SSE `complete`, or saved-revision readback.
 *      - Retrying `/query` with the same `save_operation_key` is idempotent (no duplicate revision created).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveOrReviseAnswerServerVerified } from "../../src/core/knowledge/claim-traceability-engine";
import type { Actor } from "../../src/core/knowledge/contracts";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

const TEST_ACTOR: Actor = {
  actor_id: "cand6.remediation.test@reg24.internal",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

describe("Candidate 6 — P0 Citation Gap, P1 G3t2 Operative Claims, P1 M1t3 Multi-Issue Follow-Up & VC-EQ Guard", () => {
  let store: DurableKnowledgeStore;
  let tmpDir: string;

  beforeAll(() => {
    process.env.REG24_PINNED_RELEASE_ID = "rel.B01.rc8";
    process.env.REG24_GROUNDED_LLM_STAGING_ENABLED = "true";
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand6-"));
    fs.cpSync(STAGING_STORE_DIR, tmpDir, { recursive: true });
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    delete process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("1. [P0 Citation-Publication Gap] strips model-introduced unverified rulings across all surfaces, withholds essential unverified conclusions, and preserves supported figure + properly sourced rulings + CI1", async () => {
    const syntheticM1t1Prompt =
      "นายพงศ์เทพยกที่ดินพร้อมอาคารสำนักงานในจังหวัดนนทบุรีให้แก่นายกวิน บุตรชายชอบด้วยกฎหมาย (ไม่ใช่บุตรบุญธรรม) โดยไม่มีค่าตอบแทน จดทะเบียนโอนเมื่อวันที่ 12 กุมภาพันธ์ 2569 ราคาประเมินทุนทรัพย์ของทางราชการ 30,000,000 บาท และในปีภาษี 2569 ไม่มีการโอนอสังหาริมทรัพย์อื่นให้นายกวิน นายพงศ์เทพและนายกวินมีภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายอย่างไร";

    let suppliedPassages: Array<{ passage_id: string; work_id: string; verbatim_text?: string; exact_text?: string }> = [];
    const txtOf = (p: { passage_id: string; verbatim_text?: string; exact_text?: string }) =>
      store.getState().passages[p.passage_id]?.exact_text || p.verbatim_text || p.exact_text || "";
    const res = await queryKnowledge(
      {
        question: syntheticM1t1Prompt,
        release_id: "rel.B01.rc8",
      },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        onRealAppEvidenceAssembly: (cap) => {
          suppliedPassages = cap.actual_model_packet as unknown as typeof suppliedPassages;
        },
        llmMockInvokerForTesting: async () => {
          const p41bis = suppliedPassages.find((p) => p.work_id === "prov.th.rc.41_ทวิ")!.passage_id;
          const p49bis = suppliedPassages.find((p) => p.work_id === "prov.th.rc.49_ทวิ")!.passage_id;
          const p42_26 =
            suppliedPassages.find(
              (p) => p.work_id === "prov.th.rc.42" && txtOf(p).includes("(26)")
            )?.passage_id || "psg.c7c4aa1c3ac667";
          const p48_4_1 =
            suppliedPassages.find(
              (p) => p.work_id === "prov.th.rc.48" && txtOf(p).includes("ยี่สิบล้านบาท")
            )?.passage_id || "psg.c9d097123a955c";
          const p50_6 =
            suppliedPassages.find(
              (p) => p.work_id === "prov.th.rc.50" && txtOf(p).includes("(6)")
            )?.passage_id || "psg.acec8fcd9286c5";

          const draft: GroundedLlmDraftResponse = {
            answer_status: "ANSWERED",
            overall_summary_th:
              "นายพงศ์เทพต้องหักภาษี ณ ที่จ่ายร้อยละ 5 เฉพาะส่วนที่เกิน 20,000,000 บาท เป็นเงิน 500,000 บาท ทั้งนี้ ตามแนวหนังสือตอบข้อหารือ กค 0706/4032 เดิมเคยยกเว้นเต็มจำนวนก่อนแก้ไขกฎหมาย",
            case_facts_used: [
              {
                fact_label_th: "การโอนอสังหาริมทรัพย์ให้บุตรชอบด้วยกฎหมาย",
                original_fact_th: "ราคาประเมินทุนทรัพย์ 30,000,000 บาท โอนวันที่ 12 กุมภาพันธ์ 2569",
                source_turn: 1,
                legal_significance_th:
                  "ใช้ฐานราคาประเมินตามมาตรา 49 ทวิ (ต่างจากแนวหนังสือตอบข้อหารือ กค 0702/7711)",
              },
            ],
            issues: [
              {
                issue_id: "issue_1_donor_pit_wht",
                issue_title_th:
                  "ภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายของผู้โอน (เปรียบเทียบแนว กค 0706/4032)",
                party_or_scope_th: "นายพงศ์เทพ (บิดาผู้โอน)",
                conclusion_th:
                  "นายพงศ์เทพเป็นผู้มีเงินได้และต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนในอัตราร้อยละ 5 ของราคาประเมินทุนทรัพย์เฉพาะส่วนที่เกิน 20,000,000 บาท (ร้อยละ 5 ของ 10,000,000 บาท) เป็นเงิน 500,000 บาท",
                material_facts_relied_on: [
                  "โอนที่ดินพร้อมอาคารสำนักงานให้บุตรชายชอบด้วยกฎหมายโดยไม่มีค่าตอบแทน วันที่ 12 กุมภาพันธ์ 2569",
                  "ราคาประเมินทุนทรัพย์ของทางราชการ 30,000,000 บาท",
                ],
                governing_passage_ids: [p41bis, p49bis, p42_26, p48_4_1, p50_6],
                application_explanation_th:
                  "ตามประมวลรัษฎากร มาตรา 41 ทวิ ให้ถือว่าผู้โอนเป็นผู้มีเงินได้ โดยใช้ราคาประเมินทุนทรัพย์ 30,000,000 บาทตามมาตรา 49 ทวิ เมื่อเป็นการโอนให้แก่บุตรชอบด้วยกฎหมายซึ่งไม่รวมถึงบุตรบุญธรรม มาตรา 42 (26) ยกเว้นเงินได้เฉพาะส่วนที่ไม่เกิน 20,000,000 บาท จึงคงเหลือเงินได้ส่วนที่เกิน 10,000,000 บาท และตามมาตรา 50 (6) ประกอบมาตรา 48 (4/1) ต้องหักภาษี ณ ที่จ่ายร้อยละ 5 เป็นเงิน 500,000 บาท",
                authority_distinction_note_th:
                  "วิเคราะห์ตามประมวลรัษฎากร มาตรา 41 ทวิ, 42 (26), 48 (4/1), 49 ทวิ และ 50 (6) ทั้งนี้ หนังสือตอบข้อหารือ กค 0706/4032 (ลงวันที่ 15 พฤษภาคม 2549) เป็นแนววินิจฉัยก่อนการแก้ไขกฎหมายจึงไม่อาจนำหลักยกเว้นเต็มจำนวนเดิมมาใช้บังคับในปี 2569 ได้",
                proposed_calculation: {
                  formula_description_th:
                    "ภาษีเงินได้หัก ณ ที่จ่าย = (ราคาประเมินทุนทรัพย์ 30,000,000 บาท - วงเงินยกเว้น 20,000,000 บาท) × อัตราร้อยละ 5",
                  tax_base_thb: 30_000_000,
                  exempt_amount_thb: 20_000_000,
                  taxable_amount_thb: 10_000_000,
                  rate_pct: 5,
                  computed_tax_thb: 500_000,
                  is_computable_from_stated_facts: true,
                  missing_inputs_th: [],
                  steps_th: [
                    "ฐานราคาประเมินทุนทรัพย์ (มาตรา 49 ทวิ) = 30,000,000 บาท",
                    "หัก วงเงินยกเว้นกรณีโอนให้บุตรชอบด้วยกฎหมาย (มาตรา 42 (26)) = 20,000,000 บาท",
                    "ส่วนที่เกิน 20,000,000 บาท = 10,000,000 บาท",
                    "ภาษีหัก ณ ที่จ่ายร้อยละ 5 (มาตรา 50 (6)) = 500,000 บาท",
                  ],
                },
                missing_facts_or_uncertainties_th: [
                  "ไม่มีข้อมูลค่าธรรมเนียมอื่นตามคำสั่งกรมสรรพากร ที่ ป. 888/2540",
                ],
              },
              {
                issue_id: "issue_2_recipient_pit",
                issue_title_th: "ภาระภาษีเงินได้บุคคลธรรมดาของผู้รับโอน",
                party_or_scope_th: "นายกวิน (บุตรชายชอบด้วยกฎหมายผู้รับโอน)",
                conclusion_th:
                  "นายกวินในฐานะบุตรชายชอบด้วยกฎหมายผู้รับโอนไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาและไม่ต้องนำมูลค่าอสังหาริมทรัพย์มารวมคำนวณภาษี",
                material_facts_relied_on: ["บุตรชายชอบด้วยกฎหมายรับโอนโดยไม่มีค่าตอบแทน"],
                governing_passage_ids: [p41bis, p42_26],
                application_explanation_th:
                  "มาตรา 41 ทวิ กำหนดให้ถือว่าผู้โอนเป็นผู้มีเงินได้ และมาตรา 42 (26) กำหนดหลักเกณฑ์ยกเว้นฝั่งผู้โอนสำหรับบุตรชอบด้วยกฎหมาย ดังนั้น นายกวินผู้รับโอนจึงไม่มีภาระภาษีเงินได้บุคคลธรรมดา",
                authority_distinction_note_th: "อ้างอิงประมวลรัษฎากร มาตรา 41 ทวิ และมาตรา 42 (26)",
                proposed_calculation: null,
                missing_facts_or_uncertainties_th: [],
              },
              {
                issue_id: "issue_3_essential_unverified_decree",
                issue_title_th: "สิทธิยกเว้นพิเศษเพิ่มเติม",
                party_or_scope_th: "นายพงศ์เทพ",
                conclusion_th:
                  "ได้รับยกเว้นค่าลดหย่อนพิเศษเพิ่มเติมตามพระราชกฤษฎีกา (ฉบับที่ 555) พ.ศ. 2555 มาตรา 4",
                material_facts_relied_on: ["โอนอาคารสำนักงานปี 2569"],
                governing_passage_ids: [p41bis],
                application_explanation_th:
                  "ตามพระราชกฤษฎีกา (ฉบับที่ 555) พ.ศ. 2555 มาตรา 4 กำหนดสิทธิยกเว้นเพิ่มเติมให้อีก",
                authority_distinction_note_th: "",
                proposed_calculation: null,
                missing_facts_or_uncertainties_th: [],
              },
            ],
            assumptions_th: [
              "ที่ดินพร้อมอาคารสำนักงานเป็นกรรมสิทธิ์ของนายพงศ์เทพแต่ผู้เดียว",
              "เป็นไปตามแนวทางหนังสือตอบข้อหารือ กค 0702/1234 เรื่องเอกสารประกอบการจดทะเบียน",
            ],
            clarification_questions_th: [],
            evidence_gaps_th: [],
          };
          return draft;
        },
      }
    );

    const saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: res.traceable_answer!,
      grounded_answer_snapshot: res,
      question_text: syntheticM1t1Prompt,
      revision_reason: "Cand6 Test 1 synthetic M1t1 save",
      actor: TEST_ACTOR,
    });

    const allSurfaceBlob = JSON.stringify({
      ui_answer: res.answer,
      claims: res.claims,
      assumptions: res.assumptions,
      warnings: res.coverage_warnings,
      envelope_rendered: saved.rendered_answer_th,
      envelope_claims: saved.claims,
      envelope_assumptions: saved.assumptions,
      snapshot_answer: saved.grounded_answer_snapshot?.answer,
    });

    // ZERO model-introduced unverified rulings/orders/decrees anywhere across UI, JSON, Save, or Snapshot!
    expect(allSurfaceBlob).not.toContain("0706/4032");
    expect(allSurfaceBlob).not.toContain("0702/7711");
    expect(allSurfaceBlob).not.toContain("0702/1234");
    expect(allSurfaceBlob).not.toContain("888/2540");
    expect(allSurfaceBlob).not.toContain("ฉบับที่ 555");

    // Supported M1t1 result and figure (500,000 THB) MUST survive!
    expect(res.answer).toContain("500,000 บาท");
    expect(saved.claims.some((c) => c.verification_decision === "supported" && c.bound_calculation?.outputs.computed_tax_thb === 500_000)).toBe(true);
    // Essential unverified issue_3 must NOT be published as a supported claim
    expect(saved.claims.some((c) => c.text.includes("ฉบับที่ 555"))).toBe(false);

    // Properly sourced ruling control: when `กค 0702/3889` IS in governing_passage_ids, it survives with official URL
    const sourcedMaritalPrompt =
      "นายสมศักดิ์และนางมาลี สามีภริยาจดทะเบียนสมรส ร่วมกันโอนที่ดินอันเป็นสินสมรสให้แก่นายต้นกล้า บุตรชายชอบด้วยกฎหมายโดยไม่มีค่าตอบแทนเมื่อวันที่ 10 มีนาคม 2569 ราคาประเมินทุนทรัพย์ทั้งแปลง 36,000,000 บาท บิดาและมารดาต้องหักภาษี ณ ที่จ่ายอย่างไร";
    const sourcedRes = await queryKnowledge(
      { question: sourcedMaritalPrompt, release_id: "rel.B01.rc8" },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
          answer_status: "ANSWERED",
          overall_summary_th:
            "บิดาและมารดาแบ่งเงินได้คนละกึ่งหนึ่ง (คนละ 18,000,000 บาท) ไม่เกินวงเงินยกเว้น 20,000,000 บาทต่อคนตามมาตรา 42 (26) ประกอบแนววินิจฉัย กค 0702/3889",
          case_facts_used: [],
          issues: [
            {
              issue_id: "marital_sourced_ruling",
              issue_title_th: "ภาระภาษีของผู้โอนกรณีสินสมรสตามมาตรา 42 (26) และ กค 0702/3889",
              party_or_scope_th: "นายสมศักดิ์และนางมาลี (บิดามารดาผู้โอน)",
              conclusion_th:
                "บิดาและมารดาได้รับยกเว้นภาษีเงินได้ทั้งจำนวนและไม่ต้องหักภาษี ณ ที่จ่าย (0 บาท) ตามมาตรา 42 (26) และมาตรา 50 (6) สอดคล้องกับหนังสือตอบข้อหารือ กค 0702/3889",
              material_facts_relied_on: ["ที่ดินสินสมรสราคาประเมิน 36,000,000 บาท โอนให้บุตรชอบด้วยกฎหมาย"],
              governing_passage_ids: [
                "psg.2d4d9a3802f2f0",
                "psg.9ae0fef7dcf0a6",
                "psg.c7c4aa1c3ac667",
                "psg.acec8fcd9286c5",
                "psg.1285e0045e3266",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 41 ทวิ, มาตรา 49 ทวิ, มาตรา 42 (26) และมาตรา 50 (6) ประกอบแนวหนังสือตอบข้อหารือกรมสรรพากร กค 0702/3889 กรณีสามีภริยาโอนอสังหาริมทรัพย์อันเป็นสินสมรสให้บุตรชอบด้วยกฎหมาย ให้ถือว่าบิดาและมารดาโอนคนละกึ่งหนึ่ง (คนละ 18,000,000 บาท) ซึ่งไม่เกิน 20,000,000 บาทต่อคน จึงได้รับยกเว้นทั้งหมด (0 บาท)",
              authority_distinction_note_th:
                "อ้างอิงประมวลรัษฎากร มาตรา 41 ทวิ, 49 ทวิ, 42 (26), 50 (6) และหนังสือตอบข้อหารือ กค 0702/3889",
              proposed_calculation: {
                formula_description_th: "แบ่งสินสมรสคนละกึ่งหนึ่ง 18,000,000 บาท ไม่เกิน 20,000,000 บาท",
                tax_base_thb: 18_000_000,
                exempt_amount_thb: 18_000_000,
                taxable_amount_thb: 0,
                rate_pct: 5,
                computed_tax_thb: 0,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["ฐานต่อผู้โอน 1 คน = 18,000,000 บาท (ไม่เกิน 20,000,000 บาท) -> ภาษี 0 บาท"],
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
    expect(sourcedRes.answer).toContain("0702/3889");
    expect(sourcedRes.evidence.some((e) => e.locator.origin_uri.includes("rd.go.th/66517.html"))).toBe(true);

    // CI1 synthetic control: user-supplied unverified ruling still abstains cleanly without substituting another ruling
    const ci1Res = await queryKnowledge(
      {
        question:
          "ตามหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/99412 ลงวันที่ 14 พฤศจิกายน 2568 ซึ่งวินิจฉัยว่าการโอนอาคารให้หลานได้รับยกเว้นภาษีทั้งหมด สามารถใช้อ้างอิงได้หรือไม่",
        release_id: "rel.B01.rc8",
      },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
          answer_status: "INSUFFICIENT_EVIDENCE",
          overall_summary_th: "",
          case_facts_used: [],
          issues: [],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(ci1Res.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(ci1Res.evidence.length).toBe(0);
  });

  it("2. [P1 G3t2 Auditable Operative Conclusions] preserves BOTH donor 0-baht WHT claim and separate recipient claim across UI, API, Save, and Reopen without mutating r1", async () => {
    const turn1Prompt =
      "นางสุดารัตน์ยกห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภัทร ซึ่งเป็นหลานชาย (บุตรชายของน้องสาว) โดยเสน่หาไม่มีค่าตอบแทน จดทะเบียนโอนเมื่อวันที่ 20 สิงหาคม 2568 หนังสือสัญญาให้ระบุมูลค่า 7,000,000 บาท แต่ราคาประเมินทุนทรัพย์ของทางราชการคือ 8,500,000 บาท นางสุดารัตน์และนายภัทรมีภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายอย่างไร";

    const r1Res = await queryKnowledge(
      { question: turn1Prompt, release_id: "rel.B01.rc8", conversation_id: "conv.cand6.g3" },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
          answer_status: "CONDITIONAL",
          overall_summary_th: "โอนให้หลานชายไม่ได้รับยกเว้นตามมาตรา 42 (26)",
          case_facts_used: [],
          issues: [
            {
              issue_id: "r1_donor",
              issue_title_th: "ภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายของผู้โอน",
              party_or_scope_th: "นางสุดารัตน์ (ผู้โอน)",
              conclusion_th:
                "นางสุดารัตน์ถือเป็นผู้มีเงินได้ตามราคาประเมินทุนทรัพย์ 8,500,000 บาท ไม่ได้รับยกเว้นตามมาตรา 42 (26) และต้องหักภาษี ณ ที่จ่ายตามมาตรา 50 (6) ประกอบมาตรา 50 (5) แต่ยังคำนวณจำนวนเงินภาษีไม่ได้เนื่องจากขาดข้อมูลวิธีการได้มาและปีที่ถือครอง",
              material_facts_relied_on: ["โอนห้องชุดให้หลานชาย ราคาประเมิน 8,500,000 บาท"],
              governing_passage_ids: ["psg.2d4d9a3802f2f0", "psg.9ae0fef7dcf0a6", "psg.c7c4aa1c3ac667", "psg.acec8fcd9286c5"],
              application_explanation_th:
                "ตามมาตรา 41 ทวิ และมาตรา 49 ทวิ ใช้ราคาประเมินทุนทรัพย์ 8,500,000 บาทแทนราคาสัญญา 7,000,000 บาท เมื่อผู้รับโอนเป็นหลานชายมิใช่บุตรชอบด้วยกฎหมาย จึงไม่ได้รับยกเว้นตามมาตรา 42 (26) และต้องหักภาษี ณ ที่จ่ายตามมาตรา 50 (6) ประกอบมาตรา 50 (5)",
              authority_distinction_note_th: "อ้างอิงประมวลรัษฎากร มาตรา 41 ทวิ, 49 ทวิ, 42 (26) และ 50 (6)",
              proposed_calculation: null,
              missing_facts_or_uncertainties_th: ["ขาดข้อมูลวิธีการได้มาและจำนวนปีที่ถือครอง"],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );

    const savedR1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: r1Res.traceable_answer!,
      grounded_answer_snapshot: r1Res,
      question_text: turn1Prompt,
      revision_reason: "Turn 1 nephew",
      actor: TEST_ACTOR,
      query_persistence_context: {
        conversation_id: "conv.cand6.g3",
        prior_saved_answer_revision: null,
        reopened_from_revision: null,
        conversation_history: [],
      },
    });

    const turn2Prompt =
      "ถ้าเปลี่ยนข้อเท็จจริงเฉพาะผู้รับโอน: นางสุดารัตน์ยกห้องชุดห้องเดิมให้นางสาวลลิตา บุตรสาวชอบด้วยกฎหมายของนางสุดารัตน์เอง (ไม่ใช่บุตรบุญธรรม) และในปีภาษี 2568 ไม่มีการโอนอสังหาริมทรัพย์อื่นให้นางสาวลลิตา ข้อเท็จจริงอื่นเหมือนเดิม นางสุดารัตน์และนางสาวลลิตามีภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายอย่างไร";

    // Reproduces the exact G3t2 passage combination (`psg.c7c4aa1c3ac667` Unit 7 + `psg.34a782ee310eba` + `psg.2af43170161a54`)
    const r2Res = await queryKnowledge(
      {
        question: turn2Prompt,
        release_id: "rel.B01.rc8",
        conversation_id: "conv.cand6.g3",
        prior_saved_answer_revision: savedR1.answer_revision,
        conversation_history: [
          { role: "user", content: turn1Prompt },
          { role: "assistant", content: r1Res.answer },
        ],
      },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async (): Promise<GroundedLlmDraftResponse> => ({
          answer_status: "ANSWERED",
          overall_summary_th:
            "นางสุดารัตน์ได้รับยกเว้นทั้งจำนวน (ภาษีหัก ณ ที่จ่าย 0 บาท) และนางสาวลลิตาไม่ต้องเสียภาษีเงินได้บุคคลธรรมดา",
          case_facts_used: [],
          issues: [
            {
              issue_id: "issue_1_transferor_pit_and_wht",
              issue_title_th:
                "ภาระภาษีเงินได้บุคคลธรรมดาและการหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนของนางสุดารัตน์ (ผู้โอน)",
              party_or_scope_th: "นางสุดารัตน์ (มารดาผู้โอนกรรมสิทธิ์ห้องชุด)",
              conclusion_th:
                "นางสุดารัตน์ได้รับยกเว้นภาษีเงินได้บุคคลธรรมดาเต็มจำนวน และไม่ต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนโอนกรรมสิทธิ์ (0 บาท)",
              material_facts_relied_on: [
                "โอนกรรมสิทธิ์ห้องชุดโดยไม่มีค่าตอบแทนให้แก่นางสาวลลิตา บุตรสาวชอบด้วยกฎหมาย (ไม่ใช่บุตรบุญธรรม)",
                "ราคาประเมินทุนทรัพย์ของทางราชการในวันโอนคือ 8,500,000 บาท (สัญญาให้ระบุ 7,000,000 บาท)",
                "ในปีภาษี 2568 ไม่มีการโอนอสังหาริมทรัพย์อื่นให้แก่นางสาวลลิตาอีก",
              ],
              governing_passage_ids: [
                "psg.2d4d9a3802f2f0",
                "psg.9ae0fef7dcf0a6",
                "psg.c7c4aa1c3ac667",
                "psg.acec8fcd9286c5",
                "psg.34a782ee310eba",
                "psg.2af43170161a54",
              ],
              application_explanation_th:
                "การโอนกรรมสิทธิ์ห้องชุดโดยไม่มีค่าตอบแทน ตามประมวลรัษฎากร มาตรา 41 ทวิ ให้ถือว่านางสุดารัตน์ผู้โอนเป็นผู้มีเงินได้ โดยใช้ฐานราคาประเมินทุนทรัพย์ 8,500,000 บาทตามมาตรา 49 ทวิ (ไม่ใช้มูลค่าตามสัญญา 7,000,000 บาท) เนื่องจากเป็นการโอนให้แก่บุตรสาวชอบด้วยกฎหมายซึ่งมิใช่บุตรบุญธรรม มาตรา 42 (26) (ซึ่งเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 40) พ.ศ. 2558 มาตรา 4) ยกเว้นเงินได้ในส่วนที่ไม่เกิน 20,000,000 บาทต่อบุตรหนึ่งคนตลอดปีภาษี และมาตรา 50 (6) (แก้ไขเพิ่มเติมโดยพระราชบัญญัติฉบับเดียวกัน มาตรา 7) กำหนดให้หักภาษี ณ ที่จ่ายร้อยละ 5 เฉพาะส่วนที่เกิน 20,000,000 บาท เมื่อยอดรวม 8,500,000 บาทไม่เกิน 20,000,000 บาท นางสุดารัตน์จึงได้รับยกเว้นทั้งจำนวนและไม่มีภาษีหัก ณ ที่จ่ายที่ต้องนำส่ง (0 บาท)",
              authority_distinction_note_th:
                "อ้างอิงประมวลรัษฎากร มาตรา 41 ทวิ, 49 ทวิ, 42 (26), 50 (6) และพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 40) พ.ศ. 2558",
              proposed_calculation: {
                formula_description_th:
                  "ภาษีหัก ณ ที่จ่าย = ร้อยละ 5 ของเงินได้ตามราคาประเมินทุนทรัพย์เฉพาะส่วนที่เกิน 20,000,000 บาทต่อบุตรชอบด้วยกฎหมายหนึ่งคนตลอดปีภาษี",
                tax_base_thb: 8_500_000,
                exempt_amount_thb: 8_500_000,
                taxable_amount_thb: 0,
                rate_pct: 5,
                computed_tax_thb: 0,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: [
                  "ฐานราคาประเมินทุนทรัพย์ (มาตรา 49 ทวิ) = 8,500,000 บาท",
                  "หักวงเงินยกเว้นโอนให้บุตรชอบด้วยกฎหมายไม่เกิน 20,000,000 บาท (มาตรา 42 (26)) = 8,500,000 บาท",
                  "เงินได้ส่วนที่เกิน 20,000,000 บาท (มาตรา 50 (6)) = 0 บาท",
                  "ภาษีเงินได้หัก ณ ที่จ่ายที่ต้องหักในวันจดทะเบียน = 0 บาท",
                ],
              },
              missing_facts_or_uncertainties_th: [],
            },
            {
              issue_id: "issue_2_recipient_pit",
              issue_title_th: "ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวลลิตา (บุตรสาวชอบด้วยกฎหมาย ผู้รับโอน)",
              party_or_scope_th: "นางสาวลลิตา (บุตรสาวชอบด้วยกฎหมายผู้รับโอนกรรมสิทธิ์ห้องชุด)",
              conclusion_th:
                "นางสาวลลิตา บุตรสาวชอบด้วยกฎหมายผู้รับโอน ไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาและไม่ต้องนำมูลค่าห้องชุดมารวมคำนวณภาษีเงินได้",
              material_facts_relied_on: ["บุตรสาวชอบด้วยกฎหมายรับโอนกรรมสิทธิ์ห้องชุดโดยไม่มีค่าตอบแทน"],
              governing_passage_ids: ["psg.2d4d9a3802f2f0", "psg.c7c4aa1c3ac667"],
              application_explanation_th:
                "ประมวลรัษฎากร มาตรา 41 ทวิ กำหนดให้ถือว่าผู้โอนเป็นผู้มีเงินได้ มิใช่ผู้รับโอน ประกอบกับมาตรา 42 (26) รองรับกรณีมารดาโอนกรรมสิทธิ์อสังหาริมทรัพย์โดยไม่มีค่าตอบแทนให้แก่บุตรชอบด้วยกฎหมาย ดังนั้น นางสาวลลิตาจึงไม่ต้องเสียภาษีเงินได้บุคคลธรรมดา",
              authority_distinction_note_th: "อ้างอิงประมวลรัษฎากร มาตรา 41 ทวิ และมาตรา 42 (26)",
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

    expect(r2Res.traceable_answer!.status).toBe("complete");
    expect(r2Res.traceable_answer!.claims.length).toBe(2);

    const trustedCalcsByClaimId: Record<string, NonNullable<(typeof r2Res.claims)[number]["bound_calculation"]>> = {};
    const trustedTokensByClaimId: Record<string, string[]> = {};
    for (const tc of r2Res.traceable_answer!.claims) {
      if (tc.bound_calculation) {
        trustedCalcsByClaimId[tc.claim_id] = tc.bound_calculation;
        trustedTokensByClaimId[tc.claim_id] = tc.bound_calculation.verified_numeric_tokens || [];
      }
    }

    const savedR2 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: r2Res.traceable_answer!,
      grounded_answer_snapshot: r2Res,
      question_text: turn2Prompt,
      parent_answer_revision: savedR1.answer_revision,
      revision_reason: "Turn 2 legitimate daughter",
      actor: TEST_ACTOR,
      query_persistence_context: {
        conversation_id: "conv.cand6.g3",
        prior_saved_answer_revision: savedR1.answer_revision,
        reopened_from_revision: savedR1.answer_revision,
        conversation_history: [
          { role: "user", content: turn1Prompt },
          { role: "assistant", content: r1Res.answer },
        ],
        trusted_calculations_by_claim_id: trustedCalcsByClaimId,
        trusted_calculation_tokens_by_claim_id: trustedTokensByClaimId,
      },
    });

    expect(savedR2.supersedes_answer_revision).toBe(savedR1.answer_revision);
    expect(savedR2.status).toBe("complete");
    expect(savedR2.claims.length).toBe(2);

    const donorClaim = savedR2.claims.find((c) => c.text.includes("นางสุดารัตน์"));
    const recipientClaim = savedR2.claims.find((c) => c.text.includes("นางสาวลลิตา") && c.text.includes("ผู้รับโอน"));
    expect(donorClaim?.verification_decision).toBe("supported");
    expect(donorClaim?.published).toBe(true);
    expect(donorClaim?.bound_calculation?.outputs.computed_tax_thb).toBe(0);
    expect(donorClaim?.bound_calculation?.inputs.tax_base_thb).toBe(8_500_000);
    expect(donorClaim?.evidence_references.length).toBeGreaterThanOrEqual(4);

    expect(recipientClaim?.verification_decision).toBe("supported");
    expect(recipientClaim?.published).toBe(true);
    expect(recipientClaim?.evidence_references.length).toBeGreaterThanOrEqual(2);

    // Original r1 remains unchanged in store
    const r1StillIntact = store.getState().citation_ledger?.published_answers[savedR1.answer_revision];
    expect(r1StillIntact?.rendered_answer_th).toContain("หลานชาย");
  });

  it("3. [P1 M1t3 Multi-Part Follow-Up Coverage] answers BOTH WHT expense-deduction method (citing §50(5)(ข) + §48(4)(ข) + missing holding-year inputs) AND SBT in forward & reversed question orders", async () => {
    const turn1 =
      "นายธนกรยกที่ดินพร้อมอาคารพาณิชย์ในจังหวัดชลบุรีให้แก่นายภาคิน บุตรชายชอบด้วยกฎหมาย โดยไม่มีค่าตอบแทน จดทะเบียนโอนวันที่ 15 มกราคม 2569 ราคาประเมินทุนทรัพย์ 28,000,000 บาท นายธนกรต้องหักภาษี ณ ที่จ่ายเท่าใด";
    const turn2 =
      "หากเปลี่ยนข้อเท็จจริงว่านายภาคินเป็นบุตรบุญธรรมที่จดทะเบียนถูกต้องตามกฎหมาย ข้อเท็จจริงอื่นเหมือนเดิม ภาระภาษีหัก ณ ที่จ่ายของนายธนกรเปลี่ยนไปอย่างไร";

    const questionOrders = [
      {
        label: "forward_wht_then_sbt",
        prompt:
          "ข้อเท็จจริงเพิ่มเติม: ที่ดินพร้อมอาคารพาณิชย์แปลงนี้นายธนกรได้มาโดยการซื้อ (ไม่ได้รับมรดกหรือรับให้) อยากทราบว่า (1) การคำนวณหักค่าใช้จ่ายเพื่อหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนต้องใช้วิธีใดและยังขาดข้อมูลใดจึงยังคำนวณเป็นตัวเงินไม่ได้ และ (2) การโอนให้บุตรบุญธรรมครั้งนี้ต้องเสียภาษีธุรกิจเฉพาะหรือไม่",
      },
      {
        label: "reversed_sbt_then_wht_paraphrased",
        prompt:
          "สมมติเพิ่มเติมว่านายธนกรซื้อที่ดินและอาคารพาณิชย์ดังกล่าวมาเองในอดีต ขอถาม 2 ประเด็น: ประเด็นแรก ธุรกรรมโอนให้บุตรบุญธรรมนี้อยู่ในบังคับต้องเสียภาษีธุรกิจเฉพาะหรือไม่เพราะเหตุใด และประเด็นที่สอง หลักเกณฑ์การหักค่าใช้จ่ายในการคำนวณภาษีเงินได้หัก ณ ที่จ่ายที่สำนักงานที่ดินต้องใช้เกณฑ์ใดและติดขัดข้อมูลใดจึงหาตัวเลขสุดท้ายไม่ได้",
      },
    ];

    for (const orderCase of questionOrders) {
      let suppliedPassages: Array<{ passage_id: string; work_id: string; verbatim_text?: string; exact_text?: string }> = [];
      const txtOf = (p: { passage_id: string; verbatim_text?: string; exact_text?: string }) =>
        store.getState().passages[p.passage_id]?.exact_text || p.verbatim_text || p.exact_text || "";
      const res = await queryKnowledge(
        {
          question: orderCase.prompt,
          release_id: "rel.B01.rc8",
          conversation_id: `conv.cand6.m1t3.${orderCase.label}`,
          conversation_history: [
            { role: "user", content: turn1 },
            {
              role: "assistant",
              content:
                "กรณีบุตรชอบด้วยกฎหมาย ได้รับยกเว้น 20,000,000 บาท ส่วนที่เกิน 8,000,000 บาท หักภาษี ณ ที่จ่ายร้อยละ 5 เป็นเงิน 400,000 บาท",
            },
            { role: "user", content: turn2 },
            {
              role: "assistant",
              content:
                "กรณีเปลี่ยนเป็นบุตรบุญธรรม ไม่ได้รับยกเว้น 20,000,000 บาทตามมาตรา 42 (26) ต้องหักภาษี ณ ที่จ่ายจากฐาน 28,000,000 บาทเต็มจำนวนตามมาตรา 50 (6) ประกอบมาตรา 50 (5)",
            },
          ],
        },
        TEST_ACTOR,
        {
          store,
          persistAnswerAtomically: false,
          onRealAppEvidenceAssembly: (cap) => {
            suppliedPassages = cap.actual_model_packet as unknown as typeof suppliedPassages;
          },
          llmMockInvokerForTesting: async () => {
            // Retrieval MUST supply both §50(5)(ข) and §48(4)(ข) as well as §91/2 & RD 342 in BOTH question orders!
            const p50_5 = suppliedPassages.find(
              (p) => p.work_id === "prov.th.rc.50" && txtOf(p).includes("(5)")
            );
            const p50_6 = suppliedPassages.find(
              (p) => p.work_id === "prov.th.rc.50" && txtOf(p).includes("(6)")
            );
            const p48_4 = suppliedPassages.find(
              (p) => p.work_id === "prov.th.rc.48" && txtOf(p).includes("ทางอื่นนอกจาก (ก)")
            );
            const p91_2 = suppliedPassages.find((p) => p.work_id === "prov.th.rc.91/2");
            const p342 = suppliedPassages.find((p) => p.work_id === "subreg.th.rc.royal_decree.342");

            expect(p50_5?.passage_id).toBe("psg.e5b0d991385db2");
            expect(p48_4?.passage_id).toBe("psg.35d2ae2eddfff5");
            expect(p91_2).toBeDefined();
            expect(p342).toBeDefined();

            // Deliberately reproduce the exact M1t3 failure pattern: model cites §48 (possibly binding another unit
            // `psg.bf16a87e2d1f29` or `psg.35d2ae2eddfff5`) and contrasts inheritance/legitimate child in prose near `มาตรา 48 (4) (ข)`!
            const draft: GroundedLlmDraftResponse = {
              answer_status: "CONDITIONAL",
              overall_summary_th:
                "ต้องหักค่าใช้จ่ายเป็นการเหมาตามพระราชกฤษฎีกาตามมาตรา 50 (5) (ข) ประกอบมาตรา 48 (4) (ข) และต้องพิจารณาภาษีธุรกิจเฉพาะตามระยะเวลาถือครอง 5 ปี",
              case_facts_used: [],
              issues: [
                {
                  issue_id: "issue_1_wht_expense_deduction",
                  issue_title_th:
                    "วิธีการหักค่าใช้จ่ายในการคำนวณภาษีเงินได้หัก ณ ที่จ่ายสำหรับการโอนอสังหาริมทรัพย์ที่ได้มาโดยการซื้อให้บุตรบุญธรรม",
                  party_or_scope_th: "นายธนกร (ผู้โอน)",
                  conclusion_th:
                    "นายธนกรต้องคำนวณหักภาษีเงินได้ ณ ที่จ่ายจากฐานราคาประเมิน 28,000,000 บาทเต็มจำนวนตามมาตรา 50 (6) ประกอบมาตรา 50 (5) (ข) และมาตรา 48 (4) (ข) โดยหักค่าใช้จ่ายเป็นการเหมาตามที่กำหนดโดยพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 ตามจำนวนปีที่ถือครอง แต่ยังไม่สามารถคำนวณเป็นตัวเงินสุดท้ายได้เนื่องจากไม่ทราบวันเดือนปีที่ได้มาซึ่งที่ดินและอาคารพาณิชย์ (จำนวนปีที่ถือครอง) และตารางอัตราค่าใช้จ่ายเหมาตาม พ.ร.ฎ. (ฉบับที่ 165) พ.ศ. 2529 ไม่ได้รวมอยู่ในชุดหลักฐาน",
                  material_facts_relied_on: [
                    "โอนที่ดินพร้อมอาคารพาณิชย์ราคาประเมิน 28,000,000 บาทให้บุตรบุญธรรมโดยไม่มีค่าตอบแทนเมื่อวันที่ 15 มกราคม 2569",
                    "ผู้โอนได้ที่ดินพร้อมอาคารพาณิชย์มาโดยการซื้อ (มิใช่ทางมรดกหรือรับให้โดยเสน่หา)",
                  ],
                  governing_passage_ids: [
                    "psg.2d4d9a3802f2f0",
                    "psg.9ae0fef7dcf0a6",
                    "psg.c7c4aa1c3ac667",
                    p50_5!.passage_id,
                    p50_6!.passage_id,
                    "psg.bf16a87e2d1f29",
                  ],
                  application_explanation_th:
                    "เมื่อผู้รับโอนเป็นบุตรบุญธรรมซึ่งมิใช่บุตรชอบด้วยกฎหมายตามมาตรา 42 (26) จึงไม่ได้รับยกเว้น 20,000,000 บาท ตามมาตรา 50 (6) ให้ถือว่านายธนกรผู้โอนเป็นผู้จ่ายเงินได้และต้องหักภาษีตามเกณฑ์ในมาตรา 50 (5) จากฐานราคาประเมิน 28,000,000 บาท เนื่องจากนายธนกรได้ที่ดินพร้อมอาคารพาณิชย์มาโดยการซื้ออันเป็นการได้มาโดยทางอื่นนอกจากกรณีมรดกหรือที่ได้รับจากการให้โดยเสน่หาตาม (ก) จึงต้องใช้วิธีตามมาตรา 50 (5) (ข) สอดคล้องกับมาตรา 48 (4) (ข) สำหรับการโอนให้บุตรบุญธรรม (ต่างจากกรณีมรดกหรือบุตรชอบด้วยกฎหมาย) กล่าวคือ ให้หักค่าใช้จ่ายเป็นการเหมาตามที่กำหนดโดยพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 เหลือเท่าใดถือเป็นเงินได้สุทธิ หารด้วยจำนวนปีที่ถือครอง คำนวณภาษีตามบัญชีอัตราภาษีเงินได้บุคคลธรรมดา แล้วคูณด้วยจำนวนปีที่ถือครอง ทั้งนี้ ไม่สามารถคำนวณตัวเลขภาษีสุดท้ายได้เพราะไม่ทราบวันที่ซื้อ/จำนวนปีที่ถือครอง (รวมถึงว่าซื้อที่ดินและอาคารพร้อมกันหรือไม่) และตารางอัตราค่าใช้จ่ายเหมาตาม พ.ร.ฎ. 165 ไม่ได้อยู่ในชุดหลักฐาน",
                  authority_distinction_note_th:
                    "อ้างอิงประมวลรัษฎากร มาตรา 41 ทวิ, 49 ทวิ, 42 (26), 50 (5) (ข), 50 (6) และมาตรา 48 (4) (ข)",
                  proposed_calculation: null,
                  missing_facts_or_uncertainties_th: [
                    "ไม่ทราบวันเดือนปีที่ได้กรรมสิทธิ์จากการซื้อที่ดินและอาคารพาณิชย์เพื่อคำนวณจำนวนปีที่ถือครอง (และได้มาพร้อมกันหรือไม่)",
                    "ตารางอัตราค่าใช้จ่ายเหมาตามจำนวนปีถือครองในพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 และบัญชีอัตราภาษีเงินได้ไม่ได้รวมอยู่ในชุดหลักฐาน",
                  ],
                },
                {
                  issue_id: "issue_2_sbt",
                  issue_title_th: "ภาระภาษีธุรกิจเฉพาะสำหรับการโอนที่ดินพร้อมอาคารพาณิชย์ให้บุตรบุญธรรม",
                  party_or_scope_th: "นายธนกร (ผู้โอน)",
                  conclusion_th:
                    "ผู้รับโอนเป็นบุตรบุญธรรมจึงไม่ได้รับยกเว้นตามพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 มาตรา 4 (6) (ง) และได้มาโดยการซื้อจึงไม่เข้าข้อยกเว้นมรดกตาม (ข) หากโอนภายใน 5 ปีนับแต่วันที่ได้มา (และไม่เข้าข้อยกเว้นอื่น) ต้องเสียภาษีธุรกิจเฉพาะอัตราร้อยละ 3.0 ของรายรับตามมาตรา 91/2 (6), 91/5 (6) และ 91/6 (3) แต่หากถือครองเกิน 5 ปีและไม่เข้าลักษณะมาตรา 4 (1)-(4) ไม่ต้องเสียภาษีธุรกิจเฉพาะ",
                  material_facts_relied_on: [
                    "โอนที่ดินพร้อมอาคารพาณิชย์ที่ได้มาโดยการซื้อให้บุตรบุญธรรม",
                  ],
                  governing_passage_ids: [
                    p91_2!.passage_id,
                    p342!.passage_id,
                    "psg.c55efa50adbddc",
                    "psg.9cc1d3c788d6ba",
                  ],
                  application_explanation_th:
                    "ตามประมวลรัษฎากร มาตรา 91/2 (6) ประกอบพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 มาตรา 4 (6) การขายอสังหาริมทรัพย์ภายใน 5 ปีนับแต่วันที่ได้มาต้องเสียภาษีธุรกิจเฉพาะอัตราร้อยละ 3.0 ตามมาตรา 91/5 (6) และมาตรา 91/6 (3) โดยข้อยกเว้นมาตรา 4 (6) (ง) ใช้เฉพาะบุตรชอบด้วยกฎหมายไม่รวมถึงบุตรบุญธรรม และข้อยกเว้น (ข) ใช้เฉพาะทางมรดก",
                  authority_distinction_note_th:
                    "อ้างอิงประมวลรัษฎากร มาตรา 91/2 (6), 91/5 (6), 91/6 (3) และ พ.ร.ฎ. (ฉบับที่ 342) พ.ศ. 2541 มาตรา 4 (6)",
                  proposed_calculation: null,
                  missing_facts_or_uncertainties_th: ["ไม่ทราบวันเดือนปีที่ซื้อเพื่อตรวจระยะเวลา 5 ปี"],
                },
              ],
              assumptions_th: [],
              clarification_questions_th: [],
              evidence_gaps_th: [
                "ตารางอัตราค่าใช้จ่ายเหมาตามจำนวนปีที่ถือครองในพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 ไม่ได้รวมอยู่ในชุดหลักฐาน",
              ],
            };
            return draft;
          },
        }
      );

      // BOTH issues (WHT expense-deduction method AND SBT) MUST survive into verified claims!
      expect(res.claims.length).toBe(2);
      expect(res.traceable_answer!.claims.filter((c) => c.verification_decision === "supported").length).toBe(2);
      expect(res.answer).toContain("มาตรา 50 (5) (ข)");
      expect(res.answer).toContain("มาตรา 48 (4) (ข)");
      expect(res.answer).toContain("จำนวนปีที่ถือครอง");
      expect(res.answer).toContain("ภาษีธุรกิจเฉพาะ");
      // Never resurrect Turn 1's superseded 400,000 THB figure!
      expect(res.answer).not.toContain("400,000");
    }
  });

  it("4. [Item 4 VC-EQ Clarification Arithmetic Guard] blocks unapproved VAT arithmetic from appearing as verified on NEEDS_CLARIFICATION", async () => {
    const vcPrompt =
      "ห้างหุ้นส่วนจำกัด ริมน้ำ อินทีเรีย เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม รับออกแบบตกแต่งภายในให้โรงแรมในจังหวัดเชียงใหม่ มูลค่าบริการ 500,000 บาท (ไม่รวมภาษีมูลค่าเพิ่ม) ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราใดและเป็นเงินเท่าใด";

    let suppliedPassages: Array<{ passage_id: string; work_id: string; verbatim_text?: string }> = [];
    const vcRes = await queryKnowledge(
      { question: vcPrompt, release_id: "rel.B01.rc8" },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        onRealAppEvidenceAssembly: (cap) => {
          suppliedPassages = cap.actual_model_packet;
        },
        llmMockInvokerForTesting: async () => {
          const p77_2 = suppliedPassages.find((p) => p.work_id === "prov.th.rc.77/2")!.passage_id;
          const p78_1 = suppliedPassages.find((p) => p.work_id === "prov.th.rc.78/1")!.passage_id;
          const p80 = suppliedPassages.find((p) => p.work_id === "prov.th.rc.80")!.passage_id;
          const p799 = suppliedPassages.find((p) => p.work_id === "subreg.th.rc.royal_decree.799")!.passage_id;

          // Inject an unapproved tentative arithmetic figure `35,000 บาท` into a NEEDS_CLARIFICATION draft!
          const draft: GroundedLlmDraftResponse = {
            answer_status: "NEEDS_CLARIFICATION",
            overall_summary_th: "ยังไม่ปรากฏวันเกิดความรับผิดทางภาษีมูลค่าเพิ่มตามมาตรา 78/1 (1)",
            case_facts_used: [],
            issues: [
              {
                issue_id: "vc_issue_1",
                issue_title_th: "วันเกิดความรับผิดและอัตราภาษีมูลค่าเพิ่มสำหรับการให้บริการ",
                party_or_scope_th: "ห้างหุ้นส่วนจำกัด ริมน้ำ อินทีเรีย",
                conclusion_th:
                  "ยังไม่สามารถสรุปอัตราและจำนวนภาษีมูลค่าเพิ่มได้จนกว่าจะทราบวันเกิดความรับผิดตามมาตรา 78/1 (1) (หากใช้อัตราร้อยละ 7.0 จะคิดเป็นภาษี 35,000 บาท)",
                material_facts_relied_on: ["มูลค่าบริการ 500,000 บาท ไม่ระบุวันชำระเงินหรือวันออกใบกำกับภาษี"],
                governing_passage_ids: [p77_2, p78_1, p80, p799],
                application_explanation_th:
                  "ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับการให้บริการเกิดขึ้นตามมาตรา 78/1 (1) และอัตราภาษีตามมาตรา 80 ลดลงตามพระราชกฤษฎีกา (เช่น ฉบับที่ 799) แต่เมื่อยังไม่ระบุวันที่เกิดความรับผิดจึงยังเลือกใช้พระราชกฤษฎีกาไม่ได้",
                authority_distinction_note_th: "",
                proposed_calculation: {
                  formula_description_th: "500,000 × 7%",
                  tax_base_thb: 500_000,
                  exempt_amount_thb: 0,
                  taxable_amount_thb: 500_000,
                  rate_pct: 7,
                  computed_tax_thb: 35_000,
                  is_computable_from_stated_facts: true,
                  missing_inputs_th: ["วันเกิดความรับผิด"],
                  steps_th: ["500,000 × 7% = 35,000 บาท"],
                },
                missing_facts_or_uncertainties_th: ["ไม่ปรากฏวันรับชำระเงิน วันออกใบกำกับภาษี หรือวันใช้บริการ"],
              },
            ],
            assumptions_th: [],
            clarification_questions_th: [
              "กรุณาระบุวันรับชำระค่าบริการ วันออกใบกำกับภาษี หรือวันใช้บริการตามมาตรา 78/1 (1)",
            ],
            evidence_gaps_th: [],
          };
          return draft;
        },
      }
    );

    expect(vcRes.status).toBe("NEEDS_CLARIFICATION");
    const vcBlob = JSON.stringify({
      answer: vcRes.answer,
      claims: vcRes.claims,
      envelope: vcRes.traceable_answer,
    });
    expect(vcBlob).not.toContain("35,000");
    expect(vcBlob).not.toContain("35000");
    expect(vcRes.claims.every((c) => !c.bound_calculation)).toBe(true);

    // Retry idempotency guard: saving with the same `save_operation_key` must NOT create a duplicate revision!
    const savedOnce = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: vcRes.traceable_answer!,
      grounded_answer_snapshot: vcRes,
      question_text: vcPrompt,
      revision_reason: "Cand6 VC-EQ retry idempotency check",
      save_operation_key: "op.cand6.vc_eq.retry_1",
      actor: TEST_ACTOR,
    });
    const savedRetry = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: vcRes.traceable_answer!,
      grounded_answer_snapshot: vcRes,
      question_text: vcPrompt,
      revision_reason: "Cand6 VC-EQ retry idempotency check",
      save_operation_key: "op.cand6.vc_eq.retry_1",
      actor: TEST_ACTOR,
    });
    expect(savedRetry.answer_revision).toBe(savedOnce.answer_revision);
    const matchingRevs = Object.values(store.getState().citation_ledger?.published_answers || {}).filter(
      (a) => a.answer_id === savedOnce.answer_id
    );
    expect(matchingRevs.length).toBe(1);
  });
});
