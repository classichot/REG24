import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyFactDelta,
  buildStructuredCaseFactLedger,
  computeLedgerStateHash,
} from "../../src/core/knowledge/case-fact-ledger";
import { queryKnowledge, type RealAppEvidenceAssemblyCapture } from "../../src/core/knowledge/query";
import { evaluateSubstantiveClaimSupport } from "../../src/core/knowledge/answer-verification";
import * as cte from "../../src/core/knowledge/claim-traceability-engine";
import { DurableKnowledgeStore, setDefaultKnowledgeStoreForTesting } from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";

type AssembledPacketItem = RealAppEvidenceAssemblyCapture["actual_model_packet"][number];

const QA_ACTOR: Actor = {
  actor_id: "trial.user.vat3_synthetic@reg24.th",
  role: "reader",
  tenant_id: "tenant.trial.vat3_synthetic",
  authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.vat3_synthetic"],
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

describe("REG24 Batch 1 — Three VAT Failure Paths (Independent Synthetic Repros from 1457398)", () => {
  const tempDirs: string[] = [];
  let store: DurableKnowledgeStore;

  beforeEach(() => {
    const cloned = cloneCanonicalStoreToTemp("reg24-vat3-");
    tempDirs.push(cloned.dir);
    store = cloned.store;
    setDefaultKnowledgeStoreForTesting(store);
  });

  afterEach(() => {
    setDefaultKnowledgeStoreForTesting(null);
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Failure 1: Date correction across the RD 799 -> RD 807 boundary
  // =========================================================================
  it("VAT3-1A (Date boundary correction 30 Sep -> 1 Oct 2026): undated service-use location does NOT invent a SERVICE_USE date; moving payment & invoice to 1 Oct switches controlling tax point and governing authority from RD 799 to RD 807", async () => {
    const turn1 =
      "บริษัท สยามดิจิทัล จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาระบบคลาวด์แก่ลูกค้าในประเทศไทย ซึ่งใช้บริการทั้งหมดในประเทศไทย ค่าบริการ 80,000 บาท (ยังไม่รวม VAT) โดยออกใบกำกับภาษีและได้รับชำระค่าบริการเต็มจำนวนเมื่อวันที่ 30 กันยายน 2569 ต้องเสียภาษีมูลค่าเพิ่มตามพระราชกฤษฎีกาฉบับใด อัตราเท่าใด และเป็นเงินเท่าใด";
    const turn2 =
      "ขอแก้ไขข้อเท็จจริงว่า การออกใบกำกับภาษีและการได้รับชำระค่าบริการเปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 แทน ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด พระราชกฤษฎีกาที่ใช้บังคับและภาษีมูลค่าเพิ่มเป็นอย่างไร";

    // 1. Turn 1 ledger MUST NOT fabricate a SERVICE_USE event on 2026-09-30 from the undated location phrase!
    const ledgerT1 = buildStructuredCaseFactLedger({ question: turn1, applicableDate: null });
    const t1ServiceUseEvents = ledgerT1.temporal_facts.transaction_or_event_dates.filter(
      (e) => e.event_type === "SERVICE_USE"
    );
    expect(t1ServiceUseEvents).toHaveLength(0);
    expect(ledgerT1.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-30");

    // 1b. Even when the undated location phrase sits in the same clause immediately before payment/invoice,
    //     NO phantom SERVICE_USE event is created on 2026-09-30!
    const turn1SameClause =
      "บริษัท สยามดิจิทัล จำกัด จดทะเบียน VAT ให้บริการที่ปรึกษา ค่าบริการ 80,000 บาท ลูกค้าใช้บริการทั้งหมดในประเทศไทยและชำระค่าบริการพร้อมออกใบกำกับภาษีเมื่อวันที่ 30 กันยายน 2569";
    const ledgerT1SameClause = buildStructuredCaseFactLedger({
      question: turn1SameClause,
      applicableDate: null,
    });
    expect(
      ledgerT1SameClause.temporal_facts.transaction_or_event_dates.filter(
        (e) => e.event_type === "SERVICE_USE"
      )
    ).toHaveLength(0);

    // 2. Turn 2 regex ledger MUST move controlling tax point to 2026-10-01 (NOT stuck at 2026-09-30!)
    const ledgerT2Regex = buildStructuredCaseFactLedger({
      question: turn2,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: turn1 }],
    });
    expect(ledgerT2Regex.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-01");

    // 3. Turn 2 via pure applyFactDelta (targeting PAYMENT & INVOICE only) MUST also move controlling tax point to 2026-10-01!
    const ledgerT2Delta = applyFactDelta(
      ledgerT1,
      {
        is_correction: true,
        confidence: "high",
        unchanged_scope: "all_other_facts",
        changes: [
          {
            op: "set_event",
            event_type: "INVOICE",
            lots: [],
            lots_mode: "only",
            from_date: null,
            to_date: "2026-10-01",
            amount_thb: null,
            source_span: "การออกใบกำกับภาษีและการได้รับชำระค่าบริการเปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569",
          },
          {
            op: "set_event",
            event_type: "PAYMENT",
            lots: [],
            lots_mode: "only",
            from_date: null,
            to_date: "2026-10-01",
            amount_thb: null,
            source_span: "การออกใบกำกับภาษีและการได้รับชำระค่าบริการเปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569",
          },
        ],
      },
      { userTurnText: turn2, applicableDate: null }
    );
    expect(ledgerT2Delta.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-01");

    // 4. Evidence assembly BEFORE LLM drafting MUST select RD 807 as governing (NOT RD 799!)
    let capturedPack: AssembledPacketItem[] = [];
    let capturedDate: string | null = null;
    await queryKnowledge(
      {
        question: turn2,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        conversation_history: [{ role: "user", content: turn1 }],
      },
      QA_ACTOR,
      {
        store,
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (ev) => {
          capturedDate = ev.controlling_date_iso;
          capturedPack = ev.actual_model_packet;
        },
      }
    );
    expect(capturedDate).toBe("2026-10-01");
    expect(
      capturedPack.some(
        (p) => p.work_id === "subreg.th.rc.royal_decree.807" && p.evidence_role === "governing"
      )
    ).toBe(true);
    expect(
      capturedPack.some(
        (p) => p.work_id === "subreg.th.rc.royal_decree.799" && p.evidence_role === "governing"
      )
    ).toBe(false);
  });

  it("VAT3-1B (Controls): genuinely dated earlier SERVICE_USE still controls (RD 799), and fresh single-turn matters on 30 Sep vs 1 Oct select RD 799 vs RD 807 cleanly", () => {
    const turn1DatedUse =
      "บริษัท สยามดิจิทัล จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาระบบคลาวด์ในประเทศไทย ค่าบริการ 80,000 บาท ลูกค้าเริ่มใช้บริการเมื่อวันที่ 28 กันยายน 2569 และบริษัทออกใบกำกับภาษีพร้อมรับชำระค่าบริการเมื่อวันที่ 30 กันยายน 2569";
    const turn2MovePayInv =
      "ขอแก้ไขข้อเท็จจริงว่า การออกใบกำกับภาษีและการได้รับชำระค่าบริการเลื่อนเป็นวันที่ 1 ตุลาคม 2569 แทน ส่วนวันเริ่มใช้บริการคงเดิม";

    const ledgerT1 = buildStructuredCaseFactLedger({ question: turn1DatedUse, applicableDate: null });
    expect(
      ledgerT1.temporal_facts.transaction_or_event_dates.some(
        (e) => e.event_type === "SERVICE_USE" && e.iso_date === "2026-09-28"
      )
    ).toBe(true);
    expect(ledgerT1.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-28");

    // Moving PAYMENT and INVOICE to 1 Oct MUST preserve genuinely dated SERVICE_USE on 28 Sep!
    const ledgerT2 = applyFactDelta(
      ledgerT1,
      {
        is_correction: true,
        confidence: "high",
        unchanged_scope: "all_other_facts",
        changes: [
          {
            op: "set_event",
            event_type: "INVOICE",
            lots: [],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-10-01",
            amount_thb: null,
            source_span: "การออกใบกำกับภาษีและการได้รับชำระค่าบริการเลื่อนเป็นวันที่ 1 ตุลาคม 2569",
          },
          {
            op: "set_event",
            event_type: "PAYMENT",
            lots: [],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-10-01",
            amount_thb: null,
            source_span: "การออกใบกำกับภาษีและการได้รับชำระค่าบริการเลื่อนเป็นวันที่ 1 ตุลาคม 2569",
          },
        ],
      },
      { userTurnText: turn2MovePayInv, applicableDate: null }
    );
    expect(ledgerT2.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-28");

    // Fresh matter on 1 Oct selects 2026-10-01 independently
    const freshOct1 = buildStructuredCaseFactLedger({
      question:
        "บริษัท ทดสอบใหม่ จำกัด ให้บริการที่ปรึกษาซึ่งใช้บริการทั้งหมดในประเทศไทย ค่าบริการ 80,000 บาท ออกใบกำกับภาษีและรับชำระค่าบริการวันที่ 1 ตุลาคม 2569 ต้องเสีย VAT เท่าใด",
      applicableDate: null,
    });
    expect(freshOct1.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-01");

    // Unrelated installment preservation: moving installment 2 from 30 Sep -> 1 Oct MUST preserve installment 1 (15 Sep)!
    const twoInstTurn1 =
      "บริษัท ทดสอบงวด จำกัด ผู้ประกอบการจดทะเบียน VAT ให้บริการที่ปรึกษาซึ่งใช้บริการในประเทศไทย แบ่งชำระ 2 งวด: งวดที่ 1 มูลค่า 50,000 บาท รับชำระและออกใบกำกับภาษีวันที่ 15 กันยายน 2569 และงวดที่ 2 มูลค่า 50,000 บาท รับชำระและออกใบกำกับภาษีวันที่ 30 กันยายน 2569";
    const twoInstLedger1 = buildStructuredCaseFactLedger({
      question: twoInstTurn1,
      applicableDate: null,
    });
    const twoInstLedger2 = applyFactDelta(
      twoInstLedger1,
      {
        is_correction: true,
        confidence: "high",
        unchanged_scope: "all_other_facts",
        changes: [
          {
            op: "set_event",
            event_type: "PAYMENT",
            lots: ["2"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-10-01",
            amount_thb: null,
            source_span: "งวดที่ 2 เลื่อนวันรับชำระเป็นวันที่ 1 ตุลาคม 2569",
          },
          {
            op: "set_event",
            event_type: "INVOICE",
            lots: ["2"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-10-01",
            amount_thb: null,
            source_span: "งวดที่ 2 เลื่อนวันออกใบกำกับภาษีเป็นวันที่ 1 ตุลาคม 2569",
          },
        ],
      },
      {
        userTurnText:
          "ขอแก้ไขเฉพาะงวดที่ 2 เป็นรับชำระและออกใบกำกับภาษีวันที่ 1 ตุลาคม 2569 ส่วนงวดที่ 1 คงเดิม",
        applicableDate: null,
      }
    );
    const activeSplitDates = (twoInstLedger2.temporal_facts.split_payment_tax_points || []).map(
      (s) => s.iso_date
    );
    expect(activeSplitDates).toContain("2026-09-15");
    expect(activeSplitDates).toContain("2026-10-01");
    expect(activeSplitDates).not.toContain("2026-09-30");
  });

  // =========================================================================
  // Failure 2: Eligible zero-rated service wrongly withheld ("not 7%")
  // =========================================================================
  it("VAT3-2A (Eligible 0% export service with negated comparison 'ไม่ใช่ร้อยละ 7' / 'not 7%'): publishes 0% with controlling §80/1(2) & DG VAT No. 105 evidence and survives Save/Reopen", async () => {
    // 1. Direct verifier check: sourced 0% claim saying "(ไม่ใช่ร้อยละ 7)" and "not 7%" MUST pass!
    const state = store.getState();
    const p80_1 = Object.values(state.passages).find(
      (p) => p.work_id === "prov.th.rc.80/1" && /ร้อยละ\s*[0๐]/.test(p.exact_text)
    )!;
    const p105 = Object.values(state.passages).find(
      (p) => p.work_id === "subreg.th.rd.dg_vat.105" && p.statement_role === "statutory_text"
    )!;
    expect(p80_1).toBeTruthy();
    expect(p105).toBeTruthy();

    const thCheck = evaluateSubstantiveClaimSupport({
      claim_text:
        "การให้บริการพัฒนาซอฟต์แวร์จากในประเทศไทยแก่ผู้ว่าจ้างในประเทศญี่ปุ่นและมีการใช้บริการทั้งหมดในประเทศญี่ปุ่น ได้รับสิทธิเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 (ไม่ใช่ร้อยละ 7) ตามประมวลรัษฎากร มาตรา 80/1 (2) ประกอบประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 105) คิดเป็นภาษีมูลค่าเพิ่ม 0 บาท จากฐานค่าบริการ 120,000 บาท",
      verified_calculation_numeric_tokens: ["0", "120000", "120,000"],
      passages: [
        {
          passage_id: p80_1.passage_id,
          doc_id: p80_1.work_id,
          verbatim_text: p80_1.exact_text,
          doc_title_th: p80_1.contextualized_header,
          section_path: p80_1.structural_path,
        },
        {
          passage_id: p105.passage_id,
          doc_id: p105.work_id,
          verbatim_text: p105.exact_text,
          doc_title_th: p105.contextualized_header,
          section_path: p105.structural_path,
        },
      ],
    });
    expect(thCheck, `thCheck failed: ${JSON.stringify(thCheck)}`).toMatchObject({
      supported: true,
    });

    const enCheck = evaluateSubstantiveClaimSupport({
      claim_text:
        "The software engineering service performed in Thailand and used entirely in Japan qualifies for 0% VAT (not 7%) under Revenue Code Section 80/1 (2) and Director-General Notification on VAT (No. 105), resulting in VAT of 0 THB on THB 120,000.",
      verified_calculation_numeric_tokens: ["0", "120000", "120,000"],
      passages: [
        {
          passage_id: p80_1.passage_id,
          doc_id: p80_1.work_id,
          verbatim_text: p80_1.exact_text,
          doc_title_th: p80_1.contextualized_header,
          section_path: p80_1.structural_path,
        },
        {
          passage_id: p105.passage_id,
          doc_id: p105.work_id,
          verbatim_text: p105.exact_text,
          doc_title_th: p105.contextualized_header,
          section_path: p105.structural_path,
        },
      ],
    });
    expect(enCheck).toMatchObject({ supported: true });

    // 2. End-to-end queryKnowledge -> Save -> exact Reopen with negated "ไม่ใช่ร้อยละ 7" comparison
    const exportQuestion =
      "บริษัท สยามโค้ด จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการออกแบบซอฟต์แวร์แก่บริษัทในประเทศญี่ปุ่น โดยส่งมอบและลูกค้าใช้บริการทั้งหมดในประเทศญี่ปุ่น (ไม่มีการใช้ในประเทศไทย) ค่าบริการ 120,000 บาท ได้รับชำระค่าบริการและออกใบกำกับภาษีเมื่อวันที่ 15 ตุลาคม 2569 ต้องเสียภาษีมูลค่าเพิ่มในอัตราใดและเป็นเงินเท่าใด";

    let assembledExportPack: AssembledPacketItem[] = [];
    const res = await queryKnowledge(
      {
        question: exportQuestion,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      QA_ACTOR,
      {
        store,
        onRealAppEvidenceAssembly: (ev) => {
          assembledExportPack = ev.actual_model_packet;
        },
        llmMockInvokerForTesting: async () => {
          const id80_1 =
            assembledExportPack.find((p) => p.work_id === "prov.th.rc.80/1")?.passage_id ||
            p80_1.passage_id;
          const id105 =
            assembledExportPack.find((p) => p.work_id === "subreg.th.rd.dg_vat.105")?.passage_id ||
            p105.passage_id;
          const id78_1 = assembledExportPack.find((p) => p.work_id === "prov.th.rc.78/1")?.passage_id;
          const cited = [id80_1, id105, ...(id78_1 ? [id78_1] : [])];
          const draft: GroundedLlmDraftResponse = {
            answer_status: "ANSWERED",
            overall_summary_th: "การให้บริการจากไทยแก่ลูกค้าในญี่ปุ่นและใช้บริการทั้งหมดในต่างประเทศ",
            case_facts_used: [
              {
                fact_label_th: "สถานที่ให้บริการและใช้บริการ",
                original_fact_th: "ให้บริการจากไทยและใช้บริการทั้งหมดในประเทศญี่ปุ่น",
                source_turn: 1,
                legal_significance_th: "เข้าหลักเกณฑ์การส่งออกบริการตามมาตรา 80/1 (2)",
              },
            ],
            issues: [
              {
                issue_id: "iss.export_zero_rate",
                issue_title_th: "อัตราภาษีมูลค่าเพิ่มสำหรับการส่งออกบริการ (ใช้บริการทั้งหมดในต่างประเทศ)",
                party_or_scope_th: "บริษัท สยามโค้ด จำกัด (ผู้ประกอบการจดทะเบียน VAT)",
                conclusion_th:
                  "การให้บริการออกแบบซอฟต์แวร์จากในประเทศไทยแก่บริษัทในประเทศญี่ปุ่นซึ่งมีการใช้บริการทั้งหมดในประเทศญี่ปุ่น อยู่ในบังคับต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 (ไม่ใช่ร้อยละ 7) คิดเป็นภาษีมูลค่าเพิ่ม 0 บาท ตามมาตรา 80/1 (2) ประกอบประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 105)",
                application_explanation_th:
                  "กรณีนี้ยังคงอยู่ในระบบภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 (มิใช่กรณีได้รับยกเว้นภาษีมูลค่าเพิ่มตามมาตรา 81 และไม่ใช่การเสียภาษีในอัตราร้อยละ 7) โดยความรับผิดเกิดขึ้นเมื่อได้รับชำระค่าบริการหรือออกใบกำกับภาษีวันที่ 15 ตุลาคม 2569 จากฐานค่าบริการ 120,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 0 บาท",
                authority_distinction_note_th:
                  "มาตรา 80/1 (2) และประกาศอธิบดีฯ VAT (ฉบับที่ 105) เป็นหลักเกณฑ์อัตราร้อยละ 0 แยกจากการยกเว้นภาษีตามมาตรา 81",
                governing_passage_ids: cited,
                asserted_authorities: [
                  { work_id: "prov.th.rc.80/1", section: "มาตรา 80/1 (2)" },
                  { work_id: "subreg.th.rd.dg_vat.105", section: "ข้อ 2" },
                ],
                contrast_mentions: [{ work_id: "prov.th.rc.81", role: "not_applicable" }],
                material_facts_relied_on: [
                  "ใช้บริการทั้งหมดในประเทศญี่ปุ่น",
                  "ได้รับชำระค่าบริการวันที่ 15 ตุลาคม 2569",
                  "ค่าบริการ 120,000 บาท",
                ],
                missing_facts_or_uncertainties_th: [],
                proposed_calculation: {
                  formula_description_th: "120,000 บาท × ร้อยละ 0 = 0 บาท",
                  tax_base_thb: 120000,
                  exempt_amount_thb: 0,
                  taxable_amount_thb: 120000,
                  rate_pct: 0,
                  computed_tax_thb: 0,
                  is_computable_from_stated_facts: true,
                  missing_inputs_th: [],
                  steps_th: ["120,000 × 0% = 0 บาท"],
                },
              },
            ],
            assumptions_th: [],
            clarification_questions_th: [],
            evidence_gaps_th: [],
          };
          return draft;
        },
      }
    );

    expect(res.status).toBe("ANSWERED");
    expect(res.claims.length).toBeGreaterThanOrEqual(1);
    expect(res.traceable_answer?.claims.length).toBeGreaterThanOrEqual(1);
    expect(res.answer).toMatch(/ร้อยละ\s*0|0%/);

    // Exact Save -> Reopen
    const saved = await cte.saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: res.traceable_answer!,
      question_text: exportQuestion,
      revision_reason: "VAT3-2A zero-rated export save",
      actor: QA_ACTOR,
      grounded_answer_snapshot: res,
    });
    const reopened = cte.reopenSavedTraceableAnswer(store, saved.answer_revision, QA_ACTOR);
    expect(reopened.found).toBe(true);
    expect(reopened.answer?.claims.length).toBe(saved.claims.length);
  });

  it("VAT3-2B (Strict negative guards): unsupported operative rate, missing rate, exempt-as-0%, and bogus derived amounts MUST stay blocked", () => {
    const state = store.getState();
    const p80_1 = Object.values(state.passages).find(
      (p) => p.work_id === "prov.th.rc.80/1" && /ร้อยละ\s*[0๐]/.test(p.exact_text)
    )!;
    const p81 = Object.values(state.passages).find(
      (p) => p.work_id === "prov.th.rc.81" && p.statement_role === "statutory_text"
    )!;

    // 1. Unsupported OPERATIVE 7% on 80/1-only passage MUST fail!
    const opSevenOn80_1 = evaluateSubstantiveClaimSupport({
      claim_text: "ต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 7 ตามมาตรา 80/1 (2)",
      verified_calculation_numeric_tokens: ["0"],
      passages: [
        {
          passage_id: p80_1.passage_id,
          doc_id: p80_1.work_id,
          verbatim_text: p80_1.exact_text,
          doc_title_th: p80_1.contextualized_header,
          section_path: p80_1.structural_path,
        },
      ],
    });
    expect(opSevenOn80_1.supported).toBe(false);
    expect(opSevenOn80_1.reason_code).toBe("UNGROUNDED_NUMERIC_ASSERTION");

    // 2. Bogus derived baht amount (8,400 THB) on a 0% export claim MUST fail even when "ไม่ใช่ร้อยละ 7" is present!
    const bogusAmt = evaluateSubstantiveClaimSupport({
      claim_text:
        "ได้รับสิทธิเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 (ไม่ใช่ร้อยละ 7) ตามมาตรา 80/1 (2) คิดเป็นภาษีมูลค่าเพิ่ม 8,400 บาท",
      verified_calculation_numeric_tokens: ["0", "120000"],
      passages: [
        {
          passage_id: p80_1.passage_id,
          doc_id: p80_1.work_id,
          verbatim_text: p80_1.exact_text,
          doc_title_th: p80_1.contextualized_header,
          section_path: p80_1.structural_path,
        },
      ],
    });
    expect(bogusAmt.supported).toBe(false);
    expect(bogusAmt.reason_code).toBe("UNGROUNDED_NUMERIC_ASSERTION");

    // 3. Exempt (§81) MUST NOT be accepted as 0% zero-rated VAT!
    const exemptAsZero = evaluateSubstantiveClaimSupport({
      claim_text: "กิจการที่ได้รับยกเว้นตามมาตรา 81 เสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0",
      verified_calculation_numeric_tokens: [],
      passages: [
        {
          passage_id: p81.passage_id,
          doc_id: p81.work_id,
          verbatim_text: p81.exact_text,
          doc_title_th: p81.contextualized_header,
          section_path: p81.structural_path,
        },
      ],
    });
    expect(exemptAsZero.supported).toBe(false);
  });

  // =========================================================================
  // Failure 3: Domestic use correction still follows the export path
  // =========================================================================
  it("VAT3-3A (Overseas -> Thailand correction): updates active service-use location, preserves existing tax date (2026-10-20), routes to domestic standard rate + RD 807 as governing, and demotes §80/1 & DG VAT 105 out of governing evidence", async () => {
    const turn1Export =
      "บริษัท สยามคลาวด์ จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการออกแบบระบบแก่ลูกค้าในประเทศสิงคโปร์ โดยลูกค้าใช้บริการทั้งหมดในประเทศสิงคโปร์ ค่าบริการ 100,000 บาท (ยังไม่รวม VAT) ออกใบกำกับภาษีและได้รับชำระค่าบริการเมื่อวันที่ 20 ตุลาคม 2569 ต้องเสียภาษีมูลค่าเพิ่มอัตราใดและเป็นเงินเท่าใด";
    const turn2DomesticCorrection =
      "ขอแก้ไขข้อเท็จจริงว่า ลูกค้านำผลของบริการดังกล่าวมาใช้ในประเทศไทยทั้งหมด ส่วนวันที่ออกใบกำกับภาษี วันที่รับชำระค่าบริการ และข้อเท็จจริงอื่นคงเดิม ต้องเสียภาษีมูลค่าเพิ่มอัตราใด ตามพระราชกฤษฎีกาฉบับใด และเป็นเงินเท่าใด";

    const ledgerT1 = buildStructuredCaseFactLedger({ question: turn1Export, applicableDate: null });
    expect(
      ledgerT1.material_facts.find((f) => f.fact_key === "vat_place_of_use")?.normalized_category
    ).toBe("SERVICE_USED_ENTIRELY_ABROAD_EXPORT");
    expect(ledgerT1.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-20");

    const ledgerT2 = buildStructuredCaseFactLedger({
      question: turn2DomesticCorrection,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: turn1Export }],
    });
    expect(
      ledgerT2.material_facts.find((f) => f.fact_key === "vat_place_of_use")?.normalized_category
    ).toBe("SERVICE_USED_IN_THAILAND_DOMESTIC");
    expect(ledgerT2.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-20");
    // Ledger hash MUST reflect the service-use location change!
    expect(computeLedgerStateHash(ledgerT2)).not.toBe(computeLedgerStateHash(ledgerT1));

    // Verify structured FactDelta `set_service_use_location` (English Overseas -> Thailand follow-up)
    // preserves the existing 2026-10-20 tax point while switching vat_place_of_use!
    const ledgerT2EnDelta = applyFactDelta(
      ledgerT1,
      {
        is_correction: true,
        confidence: "high",
        unchanged_scope: "all_other_facts",
        changes: [
          {
            op: "set_service_use_location",
            event_type: null,
            lots: [],
            lots_mode: "only",
            from_date: null,
            to_date: null,
            amount_thb: null,
            service_use_location: "THAILAND_DOMESTIC",
            source_span: "the client used the service in Thailand instead",
          },
        ],
      },
      {
        userTurnText:
          "Correction: the client used the service in Thailand instead. Keep the payment date and all other facts unchanged.",
        applicableDate: null,
      }
    );
    expect(
      ledgerT2EnDelta.material_facts.find((f) => f.fact_key === "vat_place_of_use")
        ?.normalized_category
    ).toBe("SERVICE_USED_IN_THAILAND_DOMESTIC");
    expect(ledgerT2EnDelta.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-20");
    expect(computeLedgerStateHash(ledgerT2EnDelta)).not.toBe(computeLedgerStateHash(ledgerT1));

    // Evidence assembly on Turn 2 MUST route to domestic standard rate + RD 807 as GOVERNING,
    // and MUST NOT include prov.th.rc.80/1 or dg_vat.105 as governing!
    let capturedPack: AssembledPacketItem[] = [];
    let capturedDate: string | null = null;
    await queryKnowledge(
      {
        question: turn2DomesticCorrection,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        conversation_history: [{ role: "user", content: turn1Export }],
      },
      QA_ACTOR,
      {
        store,
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (ev) => {
          capturedDate = ev.controlling_date_iso;
          capturedPack = ev.actual_model_packet;
        },
      }
    );

    expect(capturedDate).toBe("2026-10-20");
    expect(
      capturedPack.some(
        (p) => p.work_id === "subreg.th.rc.royal_decree.807" && p.evidence_role === "governing"
      )
    ).toBe(true);
    expect(
      capturedPack.some((p) => p.work_id === "prov.th.rc.80" && p.evidence_role === "governing")
    ).toBe(true);
    expect(
      capturedPack.some(
        (p) =>
          (p.work_id === "prov.th.rc.80/1" || p.work_id === "subreg.th.rd.dg_vat.105") &&
          p.evidence_role === "governing"
      )
    ).toBe(false);

    // Verify prior revision preservation across Overseas (r1) -> Domestic correction (r2) Save/Reopen:
    let t1Pack: AssembledPacketItem[] = [];
    const resT1 = await queryKnowledge(
      {
        question: turn1Export,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      QA_ACTOR,
      {
        store,
        onRealAppEvidenceAssembly: (ev) => {
          t1Pack = ev.actual_model_packet;
        },
        llmMockInvokerForTesting: async () => ({
          answer_status: "ANSWERED",
          overall_summary_th: "ให้บริการแก่ลูกค้าสิงคโปร์และใช้บริการทั้งหมดในสิงคโปร์ อัตราร้อยละ 0",
          case_facts_used: [
            {
              fact_label_th: "สถานที่ใช้บริการ",
              original_fact_th: "ใช้บริการทั้งหมดในประเทศสิงคโปร์",
              source_turn: 1,
              legal_significance_th: "เข้าเกณฑ์อัตราร้อยละ 0 ตามมาตรา 80/1 (2)",
            },
          ],
          issues: [
            {
              issue_id: "iss.t1_export",
              issue_title_th: "อัตรา VAT การส่งออกบริการ (ใช้บริการในสิงคโปร์)",
              party_or_scope_th: "บริษัท สยามคลาวด์ จำกัด",
              conclusion_th:
                "การให้บริการแก่ลูกค้าในประเทศสิงคโปร์และใช้บริการทั้งหมดในประเทศสิงคโปร์ เสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 คิดเป็นภาษีมูลค่าเพิ่ม 0 บาท ตามมาตรา 80/1 (2) ประกอบประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 105)",
              application_explanation_th:
                "ฐานค่าบริการ 100,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 0 บาท ความรับผิดเกิดวันที่ 20 ตุลาคม 2569",
              authority_distinction_note_th: "ใช้มาตรา 80/1 (2) และประกาศอธิบดีฯ VAT (ฉบับที่ 105)",
              governing_passage_ids: [
                t1Pack.find((p) => p.work_id === "prov.th.rc.80/1")!.passage_id,
                t1Pack.find((p) => p.work_id === "subreg.th.rd.dg_vat.105")!.passage_id,
              ],
              asserted_authorities: [
                { work_id: "prov.th.rc.80/1", section: "มาตรา 80/1 (2)" },
                { work_id: "subreg.th.rd.dg_vat.105", section: "ข้อ 2" },
              ],
              contrast_mentions: [],
              material_facts_relied_on: ["ใช้บริการทั้งหมดในประเทศสิงคโปร์", "วันที่ 20 ตุลาคม 2569"],
              missing_facts_or_uncertainties_th: [],
              proposed_calculation: {
                formula_description_th: "100,000 × 0% = 0 บาท",
                tax_base_thb: 100000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 100000,
                rate_pct: 0,
                computed_tax_thb: 0,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["100,000 × 0% = 0 บาท"],
              },
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(resT1.status).toBe("ANSWERED");
    const savedR1 = await cte.saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: resT1.traceable_answer!,
      question_text: turn1Export,
      revision_reason: "VAT3-3A r1 overseas export",
      actor: QA_ACTOR,
      grounded_answer_snapshot: resT1,
    });

    let t2Pack: AssembledPacketItem[] = [];
    const resT2 = await queryKnowledge(
      {
        question: turn2DomesticCorrection,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        conversation_history: [{ role: "user", content: turn1Export }],
      },
      QA_ACTOR,
      {
        store,
        onRealAppEvidenceAssembly: (ev) => {
          t2Pack = ev.actual_model_packet;
        },
        llmMockInvokerForTesting: async () => ({
          answer_status: "ANSWERED",
          overall_summary_th: "แก้ไขเป็นใช้บริการทั้งหมดในประเทศไทย ต้องเสีย VAT ร้อยละ 7 ตาม พ.ร.ฎ. (ฉบับที่ 807)",
          case_facts_used: [
            {
              fact_label_th: "สถานที่ใช้บริการ (แก้ไข)",
              original_fact_th: "ใช้บริการทั้งหมดในประเทศไทย วันที่ 20 ตุลาคม 2569 คงเดิม",
              source_turn: 2,
              legal_significance_th: "ไม่ได้รับสิทธิอัตราร้อยละ 0 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 7",
            },
          ],
          issues: [
            {
              issue_id: "iss.t2_domestic",
              issue_title_th: "อัตรา VAT การใช้บริการในประเทศไทย (วันที่ 20 ตุลาคม 2569)",
              party_or_scope_th: "บริษัท สยามคลาวด์ จำกัด",
              conclusion_th:
                "เมื่อลูกค้านำผลของบริการมาใช้ในประเทศไทยทั้งหมด จึงไม่เข้าเกณฑ์อัตราร้อยละ 0 ต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 7 (ร้อยละ 6.3 รวมภาษีท้องถิ่น 1 ใน 9) ตามมาตรา 80 แห่งประมวลรัษฎากร ประกอบพระราชกฤษฎีกา (ฉบับที่ 807) คิดเป็นภาษีมูลค่าเพิ่ม 7,000 บาท จากฐานค่าบริการ 100,000 บาท",
              application_explanation_th:
                "ความรับผิดเกิดขึ้นวันที่ 20 ตุลาคม 2569 ตามมาตรา 78/1 ซึ่งอยู่ในช่วงใช้บังคับของพระราชกฤษฎีกา (ฉบับที่ 807) ตั้งแต่วันที่ 1 ตุลาคม 2569 ถึงวันที่ 30 กันยายน 2570 คำนวณ VAT 100,000 × 7% = 7,000 บาท",
              authority_distinction_note_th: "มาตรา 80/1 (2) ไม่นำมาปรับใช้เนื่องจากมีการใช้บริการในประเทศไทย",
              governing_passage_ids: [
                t2Pack.find((p) => p.work_id === "prov.th.rc.80")!.passage_id,
                t2Pack.find((p) => p.work_id === "subreg.th.rc.royal_decree.807")!.passage_id,
                t2Pack.find((p) => p.work_id === "prov.th.rc.78/1")!.passage_id,
                ...(t2Pack.find((p) => p.work_id.includes("local_tax"))
                  ? [t2Pack.find((p) => p.work_id.includes("local_tax"))!.passage_id]
                  : []),
              ],
              asserted_authorities: [
                { work_id: "prov.th.rc.80", section: "มาตรา 80" },
                { work_id: "subreg.th.rc.royal_decree.807", section: "มาตรา 4" },
                { work_id: "prov.th.rc.78/1", section: "มาตรา 78/1" },
              ],
              contrast_mentions: [{ work_id: "prov.th.rc.80/1", role: "not_applicable" }],
              material_facts_relied_on: ["ใช้บริการทั้งหมดในประเทศไทย", "วันที่ 20 ตุลาคม 2569", "ค่าบริการ 100,000 บาท"],
              missing_facts_or_uncertainties_th: [],
              proposed_calculation: {
                formula_description_th: "100,000 × 7% = 7,000 บาท",
                tax_base_thb: 100000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 100000,
                rate_pct: 7,
                computed_tax_thb: 7000,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["100,000 × 7% = 7,000 บาท"],
              },
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(resT2.status).toBe("ANSWERED");
    const savedR2 = await cte.saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: resT2.traceable_answer!,
      question_text: turn2DomesticCorrection,
      parent_answer_revision: savedR1.answer_revision,
      revision_reason: "VAT3-3A r2 domestic Thailand correction",
      actor: QA_ACTOR,
      grounded_answer_snapshot: resT2,
      query_persistence_context: {
        prior_saved_answer_revision: savedR1.answer_revision,
        conversation_history: [{ role: "user", content: turn1Export }],
      },
    });
    expect(savedR2.answer_revision).not.toBe(savedR1.answer_revision);
    expect(savedR2.revision_number).toBeGreaterThan(savedR1.revision_number);

    // Reopen BOTH r1 and r2 — confirm r1 was NOT rewritten and r2 preserves domestic RD 807 + 7%!
    const reopenR1 = cte.reopenSavedTraceableAnswer(store, savedR1.answer_revision, QA_ACTOR);
    const reopenR2 = cte.reopenSavedTraceableAnswer(store, savedR2.answer_revision, QA_ACTOR);
    expect(reopenR1.found).toBe(true);
    expect(reopenR2.found).toBe(true);
    expect(reopenR1.answer?.rendered_answer_th).toContain("80/1");
    expect(reopenR1.answer?.rendered_answer_th).not.toContain("7,000");
    expect(reopenR2.answer?.rendered_answer_th).toContain("807");
    expect(reopenR2.answer?.rendered_answer_th).toContain("7,000");
  });

  it("VAT3-3B (Reverse direction Thailand -> overseas & Mixed/Unknown guards): Thailand -> overseas routes to 0% (§80/1 governing, RD 807 non-governing); mixed or unknown use is NOT silently collapsed to domestic or overseas", async () => {
    const turn1Domestic =
      "บริษัท สยามคลาวด์ จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาแก่ลูกค้าในประเทศสิงคโปร์ โดยลูกค้าใช้บริการทั้งหมดในประเทศไทย ค่าบริการ 100,000 บาท ออกใบกำกับภาษีและรับชำระค่าบริการเมื่อวันที่ 20 ตุลาคม 2569";
    const turn2Overseas =
      "ขอแก้ไขข้อเท็จจริงว่า ลูกค้าใช้บริการทั้งหมดในประเทศสิงคโปร์โดยไม่มีการใช้ในประเทศไทยเลย ข้อเท็จจริงอื่นคงเดิม";

    let capturedPack: AssembledPacketItem[] = [];
    await queryKnowledge(
      {
        question: turn2Overseas,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        conversation_history: [{ role: "user", content: turn1Domestic }],
      },
      QA_ACTOR,
      {
        store,
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (ev) => {
          capturedPack = ev.actual_model_packet;
        },
      }
    );
    expect(
      capturedPack.some((p) => p.work_id === "prov.th.rc.80/1" && p.evidence_role === "governing")
    ).toBe(true);
    expect(
      capturedPack.some(
        (p) => p.work_id === "subreg.th.rd.dg_vat.105" && p.evidence_role === "governing"
      )
    ).toBe(true);
    expect(
      capturedPack.some(
        (p) => p.work_id === "subreg.th.rc.royal_decree.807" && p.evidence_role === "governing"
      )
    ).toBe(false);

    // Mixed use MUST NOT be silently classified as purely domestic or purely overseas!
    const mixedLedger = buildStructuredCaseFactLedger({
      question:
        "บริษัทไทยจดทะเบียน VAT ให้บริการออกแบบระบบแก่ลูกค้าในสิงคโปร์ โดยลูกค้าใช้บริการบางส่วนในประเทศไทยและบางส่วนในสิงคโปร์ ค่าบริการ 100,000 บาท วันที่ 20 ตุลาคม 2569 เสีย VAT อัตราใด",
      applicableDate: null,
    });
    const mixedPlace = mixedLedger.material_facts.find(
      (f) => f.fact_key === "vat_place_of_use"
    )?.normalized_category;
    expect(mixedPlace).not.toBe("SERVICE_USED_IN_THAILAND_DOMESTIC");
    expect(mixedPlace).not.toBe("SERVICE_USED_ENTIRELY_ABROAD_EXPORT");

    // Unknown use MUST NOT be silently classified as purely domestic or purely overseas!
    const unknownLedger = buildStructuredCaseFactLedger({
      question:
        "บริษัทไทยจดทะเบียน VAT ให้บริการพัฒนาซอฟต์แวร์แก่ลูกค้าในสิงคโปร์ โดยไม่ทราบว่าลูกค้าจะนำบริการไปใช้ในประเทศไทยหรือต่างประเทศ ค่าบริการ 100,000 บาท วันที่ 20 ตุลาคม 2569 เสีย VAT อัตราใด",
      applicableDate: null,
    });
    const unknownPlace = unknownLedger.material_facts.find(
      (f) => f.fact_key === "vat_place_of_use"
    )?.normalized_category;
    expect(unknownPlace).not.toBe("SERVICE_USED_IN_THAILAND_DOMESTIC");
    expect(unknownPlace).not.toBe("SERVICE_USED_ENTIRELY_ABROAD_EXPORT");
  });
});
