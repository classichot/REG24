/**
 * REG24 Batch 1 — Candidate 7 Remediation Suite for C6 VAT Smoke Failure (`trc.b4e093fb8c339f`)
 *
 * Verifies BOTH sides of the shared statutory amendment-lineage citation rule (zero decree allowlist,
 * zero answer templates, zero blanket relaxation):
 *   1. Original C6 VAT smoke scenario (`฿50,000` domestic sale before VAT, delivered & invoiced `5 Nov 2569`)
 *      when the model explains that `พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569` amends `มาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560`:
 *      MUST publish `ANSWERED` with `7%` (`6.3%` + `0.7%`), `฿3,500` VAT, `subreg.th.rc.royal_decree.807`
 *      (`ver.th.rc.royal_decree.807.v3`, `dc807.pdf`), and identical Generate -> Save -> Reopen envelopes.
 *   2. Paraphrase of the domestic VAT scenario (including reverse phrasing `มาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) ... ซึ่งแก้ไขเพิ่มเติมโดย พ.ร.ฎ. (ฉบับที่ 807)`):
 *      MUST publish `ANSWERED` with verified claims, calculation, and official source links through Save & Reopen.
 *   3. Negative controls MUST still be rejected (`REVIEW_REQUIRED` / `422`, `0` verified claims):
 *      - Wrong-version / expired intermediate amending decree (`พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568`) claimed as governing on `5 Nov 2569`.
 *      - Standalone unamended base decree (`พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560`) claimed on `5 Nov 2569` WITHOUT citing the bound governing amending decree (`807`).
 *      - Unsupported/nonexistent decree (`พ.ร.ฎ. (ฉบับที่ 999)`), unrelated corpus decree (`พ.ร.ฎ. (ฉบับที่ 342)` SBT), or historical guidance example (`พ.ร.ฎ. (ฉบับที่ 507)`).
 *      - Unverified section number of the base decree (`มาตรา 9 แห่ง พ.ร.ฎ. (ฉบับที่ 646)`).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reopenSavedTraceableAnswer,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import type { Actor } from "../../src/core/knowledge/contracts";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

const TEST_ACTOR: Actor = {
  actor_id: "cand7.vat.smoke.test@reg24.internal",
  role: "reader",
  tenant_id: "tenant.trial.cand7smoke",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

describe("Candidate 7 — Shared Amending-Decree Lineage Grounding & Strict Negative Controls", () => {
  let store: DurableKnowledgeStore;
  let tmpDir: string;

  beforeAll(() => {
    process.env.REG24_PINNED_RELEASE_ID = "rel.B01.rc8";
    process.env.REG24_GROUNDED_LLM_STAGING_ENABLED = "true";
    delete process.env.DATABASE_URL;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand7-vat-"));
    fs.cpSync(STAGING_STORE_DIR, tmpDir, { recursive: true });
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    delete process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
    delete process.env.REG24_PINNED_RELEASE_ID;
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("1. Original C6 VAT smoke scenario (฿50,000 domestic sale on 5 Nov 2569 citing RD 807 amending §4 of RD 646): publishes ANSWERED with RD 807 v3, 7%, ฿3,500 and agrees across Generate -> Save -> Reopen", async () => {
    const smokeQuestion =
      "[QA-SYNTHETIC C6 SMOKE] บริษัท ทดสอบนกกระจิบ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ 5 พฤศจิกายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มเท่าใด";

    const answer = await queryKnowledge(
      {
        question: smokeQuestion,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        thinking_level: "low",
      },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: (): GroundedLlmDraftResponse => ({
          answer_status: "ANSWERED",
          overall_summary_th:
            "ความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นเมื่อวันที่ 5 พฤศจิกายน 2569 โดยบริษัทฯ ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละ 7.0 (ภาษีมูลค่าเพิ่มร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7) จากฐานราคาสินค้า 50,000 บาท เป็นเงินภาษีมูลค่าเพิ่ม 3,500 บาท",
          case_facts_used: [
            {
              fact_label_th: "การขายสินค้าในประเทศและวันเกิดความรับผิด",
              original_fact_th: "ราคาสินค้า 50,000 บาท ไม่รวม VAT ส่งมอบและออกใบกำกับภาษีวันที่ 5 พฤศจิกายน 2569",
              source_turn: 1,
              legal_significance_th:
                "เกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มเมื่อส่งมอบสินค้าตามมาตรา 78 (1) ซึ่งอยู่ในช่วงใช้บังคับของพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 (แก้ไขเพิ่มเติมมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560)",
            },
          ],
          issues: [
            {
              issue_id: "ISSUE_01_VAT_DOMESTIC_SALE",
              issue_title_th:
                "วันเกิดความรับผิด อัตราภาษี และจำนวนภาษีมูลค่าเพิ่มที่ต้องเรียกเก็บจากการขายสินค้าในประเทศ",
              party_or_scope_th:
                "บริษัท ทดสอบนกกระจิบ จำกัด (ผู้ขายสินค้าซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม)",
              conclusion_th:
                "บริษัท ทดสอบนกกระจิบ จำกัด ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละ 7.0 (ภาษีมูลค่าเพิ่มร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7) จากฐานราคาสินค้า 50,000 บาท คิดเป็นภาษีมูลค่าเพิ่มจำนวน 3,500 บาท (รวมเป็นเงินที่เรียกเก็บทั้งสิ้น 53,500 บาท)",
              material_facts_relied_on: [
                "เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม",
                "ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ 5 พฤศจิกายน 2569",
              ],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th:
                "สำหรับการขายสินค้าทั่วไปในประเทศ ประมวลรัษฎากร มาตรา 78 (1) กำหนดให้ความรับผิดในการเสียภาษีมูลค่าเพิ่มทั้งหมดเกิดขึ้นเมื่อส่งมอบสินค้า เมื่อบริษัทฯ ส่งมอบสินค้าและออกใบกำกับภาษีในวันที่ 5 พฤศจิกายน 2569 ความรับผิดจึงเกิดขึ้นในวันที่ 5 พฤศจิกายน 2569 ซึ่งแม้ประมวลรัษฎากร มาตรา 80 (1) จะกำหนดอัตราภาษีไว้ที่ร้อยละ 10.0 แต่มาตรา 80 วรรคสอง ให้อำนาจลดอัตราภาษีโดยตราเป็นพระราชกฤษฎีกาได้ โดย ณ วันที่ 5 พฤศจิกายน 2569 พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569 ซึ่งแก้ไขเพิ่มเติมมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 มีผลใช้บังคับอยู่ โดยให้ลดอัตราภาษีมูลค่าเพิ่มและคงจัดเก็บในอัตราร้อยละ 6.3 สำหรับความรับผิดที่เกิดขึ้นตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2560 ถึงวันที่ 30 กันยายน พ.ศ. 2570 และเมื่อรวมภาษีท้องถิ่นอีก 1 ใน 9 ของอัตราภาษีที่จัดเก็บ (ร้อยละ 0.7) ตามพระราชบัญญัติจัดสรรรายได้ประเภทภาษีมูลค่าเพิ่มและภาษีธุรกิจเฉพาะให้แก่ราชการส่วนท้องถิ่น พ.ศ. 2534 จึงรวมเป็นอัตราภาษีมูลค่าเพิ่มที่จัดเก็บจริงร้อยละ 7.0 คิดเป็นภาษี 50,000 × 7% = 3,500 บาท",
              authority_distinction_note_th:
                "อาศัยประมวลรัษฎากร มาตรา 78 และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 ซึ่งแก้ไขมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 และคำแนะนำทางการเรื่องภาษีท้องถิ่น",
              proposed_calculation: {
                formula_description_th: "50,000 × 7% (VAT 6.3% + ภาษีท้องถิ่น 0.7%)",
                tax_base_thb: 50000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 50000,
                rate_pct: 7,
                computed_tax_thb: 3500,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: [
                  "ฐานภาษีสำหรับการขายสินค้า = 50,000 บาท",
                  "อัตราภาษีมูลค่าเพิ่มรวมภาษีท้องถิ่น = 6.3% + 0.7% = 7.0%",
                  "ภาษีมูลค่าเพิ่มที่ต้องเรียกเก็บ = 50,000 × 7% = 3,500 บาท",
                ],
              },
              missing_facts_or_uncertainties_th: [],
            },
          ],
          assumptions_th: [
            "สินค้าที่ขายมิใช่สินค้าที่ได้รับยกเว้นภาษีมูลค่าเพิ่ม และไม่มีการโอนกรรมสิทธิ์หรือรับชำระราคาก่อนวันส่งมอบสินค้า",
          ],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );

    expect(answer.status).toBe("ANSWERED");
    expect(answer.claims.length).toBe(1);
    expect(answer.claims[0].bound_calculation?.inputs.rate_pct).toBe(7);
    expect(answer.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(3500);
    expect(answer.evidence.map((e) => e.work_id)).toEqual(
      expect.arrayContaining([
        "prov.th.rc.78",
        "prov.th.rc.80",
        "subreg.th.rc.royal_decree.807",
        "subreg.th.rd.vat_local_tax_guide",
      ])
    );
    const rd807Ev = answer.evidence.find((e) => e.work_id === "subreg.th.rc.royal_decree.807");
    expect(rd807Ev?.version_id).toBe("ver.th.rc.royal_decree.807.v3");
    expect(rd807Ev?.locator.origin_uri).toBe(
      "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf"
    );

    // Verify Save -> Reopen exact agreement
    expect(answer.traceable_answer).toBeDefined();
    const saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: answer.traceable_answer!,
      grounded_answer_snapshot: answer,
      question_text: smokeQuestion,
      actor: TEST_ACTOR,
      save_operation_key: "op.cand7.vat.smoke.1",
      query_persistence_context: {
        conversation_id: "conv.cand7.vat.smoke.1",
        trusted_calculations_by_claim_id: {
          [answer.traceable_answer!.claims[0].claim_id]:
            answer.claims[0].bound_calculation!,
        },
        trusted_calculation_tokens_by_claim_id: {
          [answer.traceable_answer!.claims[0].claim_id]:
            answer.claims[0].verified_calculation_numeric_tokens || [],
        },
      },
    });
    expect(saved.status).toBe("complete");
    expect(saved.claims.length).toBe(1);
    expect(saved.claims[0].published).toBe(true);
    expect(saved.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(3500);
    expect(
      saved.claims[0].evidence_references.map((r) => ({
        doc_id: r.doc_id,
        version_id: r.version_id,
        official_url: r.official_url,
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          doc_id: "subreg.th.rc.royal_decree.807",
          version_id: "ver.th.rc.royal_decree.807.v3",
          official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf",
        },
      ])
    );

    const reopened = reopenSavedTraceableAnswer(store, saved.answer_revision, TEST_ACTOR);
    expect(reopened.found).toBe(true);
    expect(reopened.answer?.answer_revision).toBe(saved.answer_revision);
    expect(reopened.answer?.rendered_answer_th).toBe(saved.rendered_answer_th);
    expect(reopened.answer?.claims).toEqual(saved.claims);
  });

  it("2. Paraphrase of domestic VAT sale (reverse statutory phrasing: มาตรา 4 แห่ง พ.ร.ฎ. 646 ซึ่งแก้ไขเพิ่มเติมโดย พ.ร.ฎ. 807): publishes ANSWERED and agrees across Generate -> Save -> Reopen", async () => {
    const paraphraseQuestion =
      "[QA-SYNTHETIC C7 PARAPHRASE] ห้างหุ้นส่วนจำกัด สยามพาณิชย์ จดทะเบียนภาษีมูลค่าเพิ่มแล้ว จำหน่ายสินค้าในราชอาณาจักรโดยคิดมูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม 50,000 บาท ส่งมอบของพร้อมออกใบกำกับภาษีเมื่อวันที่ 5 พ.ย. 2569 กิจการต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราใดและเป็นจำนวนเงินกี่บาท";

    const answer = await queryKnowledge(
      {
        question: paraphraseQuestion,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        thinking_level: "low",
      },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: (): GroundedLlmDraftResponse => ({
          answer_status: "ANSWERED",
          overall_summary_th:
            "ห้างหุ้นส่วนจำกัด สยามพาณิชย์ ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละ 7.0 เป็นเงิน 3,500 บาท สำหรับการส่งมอบสินค้าและออกใบกำกับภาษีเมื่อวันที่ 5 พฤศจิกายน 2569",
          case_facts_used: [],
          issues: [
            {
              issue_id: "ISSUE_PARAPHRASE_VAT",
              issue_title_th: "อัตราและจำนวนภาษีมูลค่าเพิ่มสำหรับการจำหน่ายสินค้าในราชอาณาจักร",
              party_or_scope_th: "ห้างหุ้นส่วนจำกัด สยามพาณิชย์ (ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม)",
              conclusion_th:
                "ความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นเมื่อวันที่ 5 พฤศจิกายน 2569 ตามมาตรา 78 (1) และต้องเรียกเก็บภาษีมูลค่าเพิ่มรวมภาษีท้องถิ่นในอัตราร้อยละ 7.0 ตามมาตรา 80 ประกอบมาตรา 4 แห่งพระราชกฤษฎีกาฯ (ฉบับที่ 646) พ.ศ. 2560 ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569 คิดเป็นภาษีมูลค่าเพิ่มจำนวน 3,500 บาท",
              material_facts_relied_on: [
                "จำหน่ายสินค้าในราชอาณาจักรมูลค่าก่อนภาษีมูลค่าเพิ่ม 50,000 บาท",
                "ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ 5 พฤศจิกายน 2569",
              ],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) ความรับผิดในการขายสินค้าเกิดขึ้นเมื่อส่งมอบสินค้าในวันที่ 5 พฤศจิกายน 2569 โดยมาตรา 4 แห่งพระราชกฤษฎีกาฯ (ฉบับที่ 646) พ.ศ. 2560 ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาฯ (ฉบับที่ 807) พ.ศ. 2569 กำหนดให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 คงจัดเก็บร้อยละ 6.3 สำหรับความรับผิดถึงวันที่ 30 กันยายน 2570 เมื่อรวมภาษีท้องถิ่นอีก 1 ใน 9 (ร้อยละ 0.7) จึงเป็นอัตราร้อยละ 7.0 คิดจากฐาน 50,000 บาท ได้ภาษี 3,500 บาท",
              authority_distinction_note_th: "",
              proposed_calculation: {
                formula_description_th: "50,000 × 7%",
                tax_base_thb: 50000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 50000,
                rate_pct: 7,
                computed_tax_thb: 3500,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["50,000 × 7% = 3,500 บาท"],
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

    expect(answer.status).toBe("ANSWERED");
    expect(answer.claims.length).toBe(1);
    expect(answer.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(3500);

    const saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: answer.traceable_answer!,
      grounded_answer_snapshot: answer,
      question_text: paraphraseQuestion,
      actor: TEST_ACTOR,
      save_operation_key: "op.cand7.vat.paraphrase.1",
      query_persistence_context: {
        conversation_id: "conv.cand7.vat.paraphrase.1",
        trusted_calculations_by_claim_id: {
          [answer.traceable_answer!.claims[0].claim_id]:
            answer.claims[0].bound_calculation!,
        },
        trusted_calculation_tokens_by_claim_id: {
          [answer.traceable_answer!.claims[0].claim_id]:
            answer.claims[0].verified_calculation_numeric_tokens || [],
        },
      },
    });
    expect(saved.status).toBe("complete");
    const reopened = reopenSavedTraceableAnswer(store, saved.answer_revision, TEST_ACTOR);
    expect(reopened.found).toBe(true);
    expect(reopened.answer?.rendered_answer_th).toBe(saved.rendered_answer_th);
    expect(reopened.answer?.claims).toEqual(saved.claims);
  });

  it("3. Negative controls: rejects wrong-version decree (RD 799 on 5 Nov 2569), standalone unamended RD 646 without RD 807, unsupported RD 999 / RD 507 / RD 342, and fabricated base-decree section", async () => {
    const smokeQuestion =
      "[QA-SYNTHETIC C6 SMOKE] บริษัท ทดสอบนกกระจิบ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ 5 พฤศจิกายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มเท่าใด";

    const runNegativeVariant = async (conclusionTh: string, explanationTh: string) =>
      queryKnowledge(
        {
          question: smokeQuestion,
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
          thinking_level: "low",
        },
        TEST_ACTOR,
        {
          store,
          channel: "chat",
          persistAnswerAtomically: false,
          llmMockInvokerForTesting: (): GroundedLlmDraftResponse => ({
            answer_status: "ANSWERED",
            overall_summary_th: conclusionTh,
            case_facts_used: [],
            issues: [
              {
                issue_id: "NEG_ISSUE",
                issue_title_th: "การคำนวณภาษีมูลค่าเพิ่ม",
                party_or_scope_th: "บริษัท ทดสอบนกกระจิบ จำกัด",
                conclusion_th: conclusionTh,
                material_facts_relied_on: ["ขายสินค้า 50,000 บาท วันที่ 5 พฤศจิกายน 2569"],
                governing_passage_ids: [
                  "psg.aa853373203223",
                  "psg.1b1abb8e7e22df",
                  "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
                  "psg.3d0eb5636faa0e",
                ],
                application_explanation_th: explanationTh,
                authority_distinction_note_th: "",
                proposed_calculation: {
                  formula_description_th: "50,000 × 7%",
                  tax_base_thb: 50000,
                  exempt_amount_thb: 0,
                  taxable_amount_thb: 50000,
                  rate_pct: 7,
                  computed_tax_thb: 3500,
                  is_computable_from_stated_facts: true,
                  missing_inputs_th: [],
                  steps_th: ["50,000 × 7% = 3,500 บาท"],
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

    // 3a. Wrong-version / expired intermediate decree RD 799 claimed as governing on 5 Nov 2569 (even when RD 807 is also mentioned)
    const wrongVer799 = await runNegativeVariant(
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 และพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569",
      "ตามมาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 จึงจัดเก็บร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น 3,500 บาท"
    );
    expect(wrongVer799.status).toBe("REVIEW_REQUIRED");
    expect(wrongVer799.claims.length).toBe(0);
    expect(wrongVer799.answer).not.toContain("799");

    // 3b. Standalone unamended RD 646 cited WITHOUT citing the governing amending decree RD 807
    const standalone646 = await runNegativeVariant(
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560",
      "ตามมาตรา 78 (1) และมาตรา 80 ประกอบมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 จึงจัดเก็บร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น 3,500 บาท"
    );
    expect(standalone646.status).toBe("REVIEW_REQUIRED");
    expect(standalone646.claims.length).toBe(0);

    // 3c. Nonexistent decree RD 999
    const nonexistent999 = await runNegativeVariant(
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 999) พ.ศ. 2569",
      "ตามมาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 999) พ.ศ. 2569 ลดอัตราเหลือร้อยละ 6.3 รวมภาษีท้องถิ่นเป็นร้อยละ 7.0 คิดเป็น 3,500 บาท"
    );
    expect(nonexistent999.status).toBe("REVIEW_REQUIRED");
    expect(nonexistent999.claims.length).toBe(0);
    expect(nonexistent999.answer).not.toContain("999");

    // 3d. Historical expired RD 507 (mentioned inside vat_local_tax_guide Q&A example) claimed as governing
    const expired507 = await runNegativeVariant(
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 507) พ.ศ. 2553",
      "ตามมาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 507) พ.ศ. 2553 ลดอัตราเหลือร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น 3,500 บาท"
    );
    expect(expired507.status).toBe("REVIEW_REQUIRED");
    expect(expired507.claims.length).toBe(0);
    expect(expired507.answer).not.toContain("507");

    // 3e. Unrelated SBT decree RD 342
    const unrelated342 = await runNegativeVariant(
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 และพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541",
      "ตามมาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 และพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 จึงคิดภาษี 3,500 บาท"
    );
    expect(unrelated342.status).toBe("REVIEW_REQUIRED");
    expect(unrelated342.claims.length).toBe(0);

    // 3f. Fabricated section (มาตรา 9) of base decree RD 646
    const fabricatedBaseSec9 = await runNegativeVariant(
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท",
      "ตามมาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 ซึ่งแก้ไขเพิ่มเติมมาตรา 9 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 จึงลดอัตราเหลือร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น 3,500 บาท"
    );
    expect(fabricatedBaseSec9.status).toBe("REVIEW_REQUIRED");
    expect(fabricatedBaseSec9.claims.length).toBe(0);

    // 3g. Compiler `( ดูพระราชกฤษฎีกาฯ (ฉบับที่ 479) )` margin footnote inside `prov.th.rc.80` must also be rejected
    const compilerFootnote479 = await runNegativeVariant(
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 479) พ.ศ. 2551",
      "ตามมาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 479) พ.ศ. 2551 ลดอัตราภาษีมูลค่าเพิ่มเป็นร้อยละ 7.0 คิดเป็น 3,500 บาท"
    );
    expect(compilerFootnote479.status).toBe("REVIEW_REQUIRED");
    expect(compilerFootnote479.claims.length).toBe(0);
    expect(compilerFootnote479.answer).not.toContain("479");
  });
});
