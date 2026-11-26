import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import {
  sanitizePublicLlmAuditTraceForHttp,
  verifyAndRenderGroundedLlmDraft,
} from "../../src/core/knowledge/grounded-llm-verifier";
import {
  buildGroundedPassagePack,
  type GroundedLlmDraftResponse,
  type GroundedPassagePackItem,
  type ProviderInvocationAudit,
} from "../../src/core/knowledge/grounded-llm-drafter";
import { attachTraceableEnvelopeToGroundedAnswer } from "../../src/core/knowledge/claim-traceability-engine";
import type { Actor, GroundedAnswer, Passage } from "../../src/core/knowledge/contracts";

const TEST_STORE = new DurableKnowledgeStore(
  path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging")
);

function buildPackFromStore(
  workIds: string[],
  splitDates: string[] = []
): {
  passagePack: GroundedPassagePackItem[];
  rawPassagesById: Map<string, Passage>;
  byWork: Map<string, GroundedPassagePackItem[]>;
} {
  const state = TEST_STORE.getState();
  const rawList: Passage[] = Object.values(state.passages).filter((p) =>
    workIds.includes(p.work_id)
  );
  const rawPassagesById = new Map<string, Passage>(rawList.map((p) => [p.passage_id, p]));
  const passagePack = buildGroundedPassagePack({
    passages: rawList,
    state,
    controllingDateIso: null,
    splitPaymentTaxPointDates: splitDates,
  });
  const byWork = new Map<string, GroundedPassagePackItem[]>();
  for (const item of passagePack) {
    const list = byWork.get(item.work_id) || [];
    list.push(item);
    byWork.set(item.work_id, list);
  }
  return { passagePack, rawPassagesById, byWork };
}

const TEST_INVOCATION_AUDIT: ProviderInvocationAudit = {
  provider: "google-gemini",
  api_surface: "interactions-v1beta",
  requested_model: "gemini-4-neon",
  resolved_model: "gemini-4-neon",
  actual_model_invoked: "gemini-4-neon",
  pinned_settings: {
    thinking_level: "low",
    thinking_level_note: null,
    temperature: 0,
    max_output_tokens: 16384,
    timeout_ms: 240000,
    store: false,
  },
  prompt_version: "reg24-grounded-llm-legal-application-v1.1",
  live_provider_called: true,
  silent_fallback_disabled: true,
  provider_interaction_id: "mock.c12.c5",
  provider_response_status: "completed",
  failure_classification: "NONE",
  latency_ms: 120,
  input_tokens: 100,
  output_tokens: 100,
  thought_tokens: 10,
  total_tokens: 210,
  estimated_cost_usd: 0.001,
  attempts: [],
  error_summary: null,
};

const TEST_ACTOR: Actor = {
  actor_id: "usr.c12.authority_test",
  tenant_id: "PUBLIC",
  role: "legal_reviewer",
  authorized_scopes: ["PUBLIC"],
};

describe("REG24 C12 Workstream C — Authority model, C2 sentence withholding, C3 sibling context, C4 immovable guard, C0 non-leak", () => {
  it("C1 + C3 (DEF-C11-1): Lot C transition citing RD 807 in contrast_mentions publishes cleanly and attaches RD 807 §1–2/§3 as context_passage_ids", () => {
    const store = TEST_STORE;
    const state = store.getState();
    const { passagePack, rawPassagesById, byWork } = buildPackFromStore(
      [
        "prov.th.rc.78",
        "prov.th.rc.80",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
        "subreg.th.rd.vat_local_tax_guide",
      ],
      ["2026-09-29", "2026-09-30", "2026-10-01"]
    );

    const p78 = byWork.get("prov.th.rc.78")![0].passage_id;
    const pGuide = byWork.get("subreg.th.rd.vat_local_tax_guide")![0].passage_id;
    const p799 = byWork.get("subreg.th.rc.royal_decree.799")!.map((p) => p.passage_id);
    const p807 = byWork.get("subreg.th.rc.royal_decree.807")!.map((p) => p.passage_id);

    const turn1 =
      "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศ 3 ล็อต รวมมูลค่าก่อน VAT 50,000 บาท คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท โดยโอนกรรมสิทธิ์ล็อต A วันที่ 29 กันยายน 2569 และส่งมอบสินค้าทุกล็อตวันที่ 1 ตุลาคม 2569 แต่รับชำระราคาและออกใบกำกับภาษีครบเต็มจำนวนวันที่ 2 ตุลาคม 2569";
    const turn2 =
      "ขอแก้ไขเฉพาะล็อต C: มีการรับชำระราคาและออกใบกำกับภาษีสำหรับล็อต C ล่วงหน้าวันที่ 30 กันยายน 2569 ส่วนข้อเท็จจริงอื่นคงเดิม";

    const factLedger = buildStructuredCaseFactLedger({
      question: turn2,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: turn1 }],
    });
    expect(factLedger.temporal_facts.vat_portion_allocation_record?.allocation_status).toBe("RESOLVED");

    const lotAIssueIds = [p78, ...p799, pGuide];
    const lotCIssueIds = [p78, ...p799, pGuide];
    const lotBIssueIds = [p78, ...p807, pGuide];

    const draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "จัดสรรวันเกิดความรับผิดแยกตามล็อต A, C (พ.ร.ฎ. 799) และล็อต B (พ.ร.ฎ. 807)",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_1_LOT_A_2026_09_29",
          issue_title_th: "ภาษีมูลค่าเพิ่ม ล็อต A (20,000 บาท)",
          party_or_scope_th: "ล็อต A — โอนกรรมสิทธิ์ 29 กันยายน 2569",
          conclusion_th:
            "ล็อต A เกิดความรับผิดวันที่ 29 กันยายน 2569 ตามมาตรา 78 (1) (ก) อยู่ภายใต้พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 7 (6.3% + ภาษีท้องถิ่น 0.7%) ฐานภาษี 20,000 บาท ภาษีมูลค่าเพิ่ม 1,400 บาท",
          material_facts_relied_on: ["ล็อต A มูลค่า 20,000 บาท โอนกรรมสิทธิ์ 29 กันยายน 2569"],
          governing_passage_ids: lotAIssueIds,
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.799" },
            { work_id: "subreg.th.rd.vat_local_tax_guide" },
          ],
          contrast_mentions: [],
          application_explanation_th:
            "ตามมาตรา 78 (1) (ก) และพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 ฐานภาษี 20,000 บาท คิด VAT ร้อยละ 7 เป็นเงิน 1,400 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "20,000 × 7% = 1,400 บาท",
            tax_base_thb: 20_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 20_000,
            rate_pct: 7,
            computed_tax_thb: 1_400,
            missing_inputs_th: [],
            steps_th: ["20,000 × 7% = 1,400 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
        {
          issue_id: "ISSUE_2_LOT_C_2026_09_30",
          issue_title_th: "ภาษีมูลค่าเพิ่ม ล็อต C (10,000 บาท)",
          party_or_scope_th: "ล็อต C — รับชำระราคาและออกใบกำกับภาษี 30 กันยายน 2569",
          // Exact C0 forensic failing sentence from DEF-C11-1 + English paraphrase ("moved from RD 807 to RD 799")
          conclusion_th:
            "จากการแก้ไขข้อเท็จจริงในเทิร์นที่ 2 ความรับผิดในการเสียภาษีมูลค่าเพิ่มของล็อต C เปลี่ยนมาเกิดขึ้นในวันที่ 30 กันยายน 2569 (วันรับชำระราคาและออกใบกำกับภาษีก่อนส่งมอบ) ตามมาตรา 78 (1) (ข) และ (ค) และเปลี่ยนกฎหมายควบคุมจากพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 มาอยู่ภายใต้พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 แทน (moved from RD 807 to RD 799) อัตราร้อยละ 7 ฐานภาษี 10,000 บาท ภาษีมูลค่าเพิ่ม 700 บาท",
          material_facts_relied_on: ["ล็อต C มูลค่า 10,000 บาท รับชำระราคาและออกใบกำกับภาษี 30 กันยายน 2569"],
          governing_passage_ids: lotCIssueIds,
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.799" },
            { work_id: "subreg.th.rd.vat_local_tax_guide" },
          ],
          contrast_mentions: [
            {
              work_id: "subreg.th.rc.royal_decree.807",
              role: "superseded",
            },
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) (ข) และ (ค) ประกอบพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 ฐานภาษี 10,000 บาท อัตรา 7% (6.3% + 0.7%) คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "10,000 × 7% = 700 บาท",
            tax_base_thb: 10_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 10_000,
            rate_pct: 7,
            computed_tax_thb: 700,
            missing_inputs_th: [],
            steps_th: ["10,000 × 7% = 700 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
        {
          issue_id: "ISSUE_3_LOT_B_2026_10_01",
          issue_title_th: "ภาษีมูลค่าเพิ่ม ล็อต B (20,000 บาท)",
          party_or_scope_th: "ล็อต B — ส่งมอบ 1 ตุลาคม 2569",
          conclusion_th:
            "ล็อต B เกิดความรับผิดวันที่ 1 ตุลาคม 2569 (วันส่งมอบสินค้า) ตามมาตรา 78 (1) อยู่ภายใต้พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 อัตราร้อยละ 7 ฐานภาษี 20,000 บาท ภาษีมูลค่าเพิ่ม 1,400 บาท",
          material_facts_relied_on: ["ล็อต B มูลค่า 20,000 บาท ส่งมอบ 1 ตุลาคม 2569"],
          governing_passage_ids: lotBIssueIds,
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.807" },
            { work_id: "subreg.th.rd.vat_local_tax_guide" },
          ],
          contrast_mentions: [],
          application_explanation_th:
            "ตามมาตรา 78 (1) และพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 ฐานภาษี 20,000 บาท คิด VAT ร้อยละ 7 เป็นเงิน 1,400 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "20,000 × 7% = 1,400 บาท",
            tax_base_thb: 20_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 20_000,
            rate_pct: 7,
            computed_tax_thb: 1_400,
            missing_inputs_th: [],
            steps_th: ["20,000 × 7% = 1,400 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const outcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.c12.c1_c3_lot_c",
      factLedger,
      passagePack,
      rawPassagesById,
      state,
      llmOk: true,
      draft,
      invocationAudit: TEST_INVOCATION_AUDIT,
      stagingFlagActive: true,
    });

    // DEF-C11-1 fixed: ALL 3 claims publish cleanly, zero rejected claims!
    expect(outcome.audit_trace.rejected_claims).toEqual([]);
    expect(outcome.audit_trace.rejected_calculations).toEqual([]);
    expect(outcome.coverage_warnings_th).toEqual([]);
    expect(outcome.status).toBe("ANSWERED");
    expect(outcome.verified_issues).toHaveLength(3);

    const lotCClaim = outcome.claims.find((c) => c.statement.includes("ล็อต C"))!;
    expect(lotCClaim).toBeDefined();
    expect(lotCClaim.bound_calculation?.outputs.computed_tax_thb).toBe(700);
    // Governing passages stay strictly RD 799 (never polluted with RD 807!)
    expect(lotCClaim.supporting_passage_ids.every((pid) => !p807.includes(pid))).toBe(true);
    // C3: Sibling decree RD 807 §1–2 and §3 passages attached strictly as `context_passage_ids`!
    expect(lotCClaim.context_passage_ids && lotCClaim.context_passage_ids.length).toBeGreaterThan(0);
    expect(lotCClaim.context_passage_ids!.every((pid) => p807.includes(pid))).toBe(true);

    // Cross-check log captured regex-vs-structured contrast agreement
    expect(
      outcome.audit_trace.authority_surface_auditor_crosscheck?.some(
        (x) =>
          x.issue_id === "ISSUE_2_LOT_C_2026_09_30" &&
          x.structured_contrast_allowed.includes("พรฎ.807")
      )
    ).toBe(true);

    // Attach traceable envelope: verify C3 `support_role: "context"` links and B1 consistency invariant pass!
    const grounded: GroundedAnswer = {
      release_id: "rel.B01.rc8",
      knowledge_snapshot_at: new Date().toISOString(),
      status: outcome.status,
      answer: outcome.rendered_answer_th,
      claims: outcome.claims,
      evidence: outcome.evidence_cards,
      assumptions: outcome.assumptions_th,
      clarification_questions: outcome.clarification_questions_th,
      coverage_warnings: outcome.coverage_warnings_th,
      applicable_date: null,
      model_policy_version: "gemini-4-neon",
      trace_id: "trc.c12.c1_c3_lot_c",
      latency_ms: 150,
      llm_audit_trace: outcome.audit_trace as unknown as Record<string, unknown>,
    };
    const attached = attachTraceableEnvelopeToGroundedAnswer(store, grounded, {
      question: turn2,
      actor: TEST_ACTOR,
      channel: "chat",
      persist: false,
    });
    expect(attached.status).toBe("complete");
    expect(attached.grounded_answer_status).toBe("ANSWERED");
    expect(attached.claims).toHaveLength(3);
    const publishedLotC = attached.claims.find((c) => c.text.includes("ล็อต C"))!;
    expect(publishedLotC.verification_decision).toBe("supported");
    const contextLinks = publishedLotC.evidence_references.filter((r) => r.support_role === "context");
    const governingLinks = publishedLotC.evidence_references.filter((r) => r.support_role !== "context");
    expect(contextLinks.length).toBeGreaterThan(0);
    expect(contextLinks.every((r) => r.doc_id === "subreg.th.rc.royal_decree.807")).toBe(true);
    expect(governingLinks.every((r) => r.doc_id !== "subreg.th.rc.royal_decree.807")).toBe(true);
  });

  it("C1 + C0 negative control: asserting RD 790 for 2026 is withheld with internal diagnostic that never leaks via HTTP sanitizer", () => {
    const store = TEST_STORE;
    const state = store.getState();
    const { passagePack, rawPassagesById, byWork } = buildPackFromStore([
      "prov.th.rc.78",
      "subreg.th.rc.royal_decree.799",
      "subreg.th.rd.vat_local_tax_guide",
    ]);
    const p78 = byWork.get("prov.th.rc.78")![0].passage_id;
    const pGuide = byWork.get("subreg.th.rd.vat_local_tax_guide")![0].passage_id;
    const p799 = byWork.get("subreg.th.rc.royal_decree.799")!.map((p) => p.passage_id);

    const q =
      "ผู้ประกอบการ VAT ขายสินค้าในประเทศ 50,000 บาท ส่งมอบและชำระเงินวันที่ 30 กันยายน 2569";
    const factLedger = buildStructuredCaseFactLedger({ question: q, applicableDate: null });

    const draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "VAT 3,500 บาท",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_ASSERTED_RD790",
          issue_title_th: "ภาษีมูลค่าเพิ่มขายสินค้า",
          party_or_scope_th: "ผู้ขาย",
          conclusion_th:
            "เกิดความรับผิดวันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) และพระราชกฤษฎีกา (ฉบับที่ 790) พ.ศ. 2567 คิดภาษี 3,500 บาท",
          material_facts_relied_on: ["ส่งมอบ 30 กันยายน 2569"],
          governing_passage_ids: [p78, ...p799, pGuide],
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.790" },
          ],
          contrast_mentions: [],
          application_explanation_th: "อ้างใช้ พ.ร.ฎ. 790 เป็นกฎหมายควบคุม",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "50,000 × 7% = 3,500 บาท",
            tax_base_thb: 50_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 50_000,
            rate_pct: 7,
            computed_tax_thb: 3_500,
            missing_inputs_th: [],
            steps_th: ["50,000 × 7% = 3,500 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const outcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.c12.c1_neg_wrong_decree",
      factLedger,
      passagePack,
      rawPassagesById,
      state,
      llmOk: true,
      draft,
      invocationAudit: TEST_INVOCATION_AUDIT,
      stagingFlagActive: true,
    });

    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(outcome.verified_issues).toHaveLength(0);
    expect(outcome.audit_trace.rejected_claims).toHaveLength(1);
    const rej = outcome.audit_trace.rejected_claims[0];
    expect(rej.rejection_code).toBe("UNGROUNDED_OR_CONTRADICTED_CLAIM");
    expect(rej.rejection_detail_internal?.offending_identifier).toBe("พรฎ.790");
    expect(rej.rejection_detail_internal?.rule_name).toBe(
      "grounded-llm-verifier:validateStructuredAssertedAndContrastAuthorities"
    );

    // C0 security boundary: public HTTP sanitizer MUST strip rejection_detail_internal & never leak 790!
    const publicHttpTrace = sanitizePublicLlmAuditTraceForHttp(outcome.audit_trace);
    const serializedPublic = JSON.stringify(publicHttpTrace);
    expect(serializedPublic).not.toContain("rejection_detail_internal");
    expect(serializedPublic).not.toContain("พรฎ.790");
    expect(serializedPublic).not.toContain("ฉบับที่ 790");
    expect(outcome.rendered_answer_th).not.toContain("790");
  });

  it("C2: unsupported authority in a side sentence WITHOUT bound numbers drops ONLY that sentence and keeps the verified claim with a coverage note", () => {
    const store = TEST_STORE;
    const state = store.getState();
    const { passagePack, rawPassagesById, byWork } = buildPackFromStore([
      "prov.th.rc.78",
      "subreg.th.rc.royal_decree.799",
      "subreg.th.rd.vat_local_tax_guide",
    ]);
    const p78 = byWork.get("prov.th.rc.78")![0].passage_id;
    const pGuide = byWork.get("subreg.th.rd.vat_local_tax_guide")![0].passage_id;
    const p799 = byWork.get("subreg.th.rc.royal_decree.799")!.map((p) => p.passage_id);

    const q = "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศมูลค่า 20,000 บาท โอนกรรมสิทธิ์และส่งมอบวันที่ 30 กันยายน 2569";
    const factLedger = buildStructuredCaseFactLedger({ question: q, applicableDate: null });

    const draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "VAT 1,400 บาท",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_C2_SIDE_DROP",
          issue_title_th: "ภาษีมูลค่าเพิ่มขายสินค้า",
          party_or_scope_th: "ผู้ขาย",
          conclusion_th:
            "เกิดความรับผิดวันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) และพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 7 ฐานภาษี 20,000 บาท ภาษีมูลค่าเพิ่ม 1,400 บาท",
          material_facts_relied_on: ["มูลค่า 20,000 บาท ส่งมอบ 30 กันยายน 2569"],
          governing_passage_ids: [p78, ...p799, pGuide],
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.799" },
            { work_id: "subreg.th.rd.vat_local_tax_guide" },
          ],
          contrast_mentions: [],
          // Two sentences: sentence 1 is fully grounded with numbers; sentence 2 is a pure side sentence with NO bound numbers!
          application_explanation_th:
            "ตามมาตรา 78 (1) และพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 คำนวณ VAT ร้อยละ 7 จากฐานภาษี 20,000 บาท เป็นเงิน 1,400 บาท. อนึ่ง คำสั่งกรมสรรพากรที่ ป.999/2599 เคยกล่าวถึงแนวทางปฏิบัติทั่วไปในลักษณะคล้ายคลึงกัน",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "20,000 × 7% = 1,400 บาท",
            tax_base_thb: 20_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 20_000,
            rate_pct: 7,
            computed_tax_thb: 1_400,
            missing_inputs_th: [],
            steps_th: ["20,000 × 7% = 1,400 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const outcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.c12.c2_side_drop",
      factLedger,
      passagePack,
      rawPassagesById,
      state,
      llmOk: true,
      draft,
      invocationAudit: TEST_INVOCATION_AUDIT,
      stagingFlagActive: true,
    });

    // Side sentence dropped; verified claim preserved with coverage note!
    expect(outcome.verified_issues).toHaveLength(1);
    expect(outcome.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(1_400);
    expect(outcome.rendered_answer_th).not.toContain("999/2599");
    expect(outcome.coverage_warnings_th.some((w) => w.includes("ตัดประโยคเสริม"))).toBe(true);
    expect(outcome.audit_trace.dropped_side_sentences).toHaveLength(1);
    expect(outcome.audit_trace.dropped_side_sentences![0].unsupported_identifiers).toContain("ป.999/2599");

    // Public HTTP trace MUST strip `dropped_side_sentences` and never leak `999/2599`!
    const publicHttpTrace = sanitizePublicLlmAuditTraceForHttp(outcome.audit_trace);
    const serializedPublic = JSON.stringify(publicHttpTrace);
    expect(serializedPublic).not.toContain("999/2599");
    expect(serializedPublic).not.toContain("dropped_side_sentences\"");
    expect((publicHttpTrace as Record<string, unknown>).dropped_side_sentences_count).toBe(1);
  });

  it("C2 strict guard: unsupported authority inside a sentence WITH bound numbers withholds the entire claim", () => {
    const store = TEST_STORE;
    const state = store.getState();
    const { passagePack, rawPassagesById, byWork } = buildPackFromStore([
      "prov.th.rc.78",
      "subreg.th.rc.royal_decree.799",
      "subreg.th.rd.vat_local_tax_guide",
    ]);
    const p78 = byWork.get("prov.th.rc.78")![0].passage_id;
    const pGuide = byWork.get("subreg.th.rd.vat_local_tax_guide")![0].passage_id;
    const p799 = byWork.get("subreg.th.rc.royal_decree.799")!.map((p) => p.passage_id);

    const q = "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศมูลค่า 20,000 บาท โอนกรรมสิทธิ์และส่งมอบวันที่ 30 กันยายน 2569";
    const factLedger = buildStructuredCaseFactLedger({ question: q, applicableDate: null });

    const draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "VAT 1,400 บาท",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_C2_WITH_BOUND_NUMBER",
          issue_title_th: "ภาษีมูลค่าเพิ่มขายสินค้า",
          party_or_scope_th: "ผู้ขาย",
          conclusion_th:
            "เกิดความรับผิดวันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) และพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 7 ฐานภาษี 20,000 บาท ภาษีมูลค่าเพิ่ม 1,400 บาท",
          material_facts_relied_on: ["มูลค่า 20,000 บาท ส่งมอบ 30 กันยายน 2569"],
          governing_passage_ids: [p78, ...p799, pGuide],
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.799" },
            { work_id: "subreg.th.rd.vat_local_tax_guide" },
          ],
          contrast_mentions: [],
          // Unsupported authority sits in a sentence carrying bound numbers `20,000` and `1,400` -> MUST withhold!
          application_explanation_th:
            "ตามมาตรา 78 (1) และพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 อัตราภาษีร้อยละ 7. ทั้งนี้ คำสั่งกรมสรรพากรที่ ป.999/2599 ยืนยันฐานภาษี 20,000 บาท และภาษีมูลค่าเพิ่ม 1,400 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "20,000 × 7% = 1,400 บาท",
            tax_base_thb: 20_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 20_000,
            rate_pct: 7,
            computed_tax_thb: 1_400,
            missing_inputs_th: [],
            steps_th: ["20,000 × 7% = 1,400 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const outcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.c12.c2_bound_num_withhold",
      factLedger,
      passagePack,
      rawPassagesById,
      state,
      llmOk: true,
      draft,
      invocationAudit: TEST_INVOCATION_AUDIT,
      stagingFlagActive: true,
    });

    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(outcome.verified_issues).toHaveLength(0);
    expect(outcome.audit_trace.rejected_claims).toHaveLength(1);
    expect(outcome.audit_trace.rejected_claims[0].rejection_code).toBe(
      "UNGROUNDED_OR_CONTRADICTED_CLAIM"
    );
  });

  it("C4: immovable-property guard skips K2 cash gifts (฿30M -> ฿500,000 under §42(27)/§48(6)) even with contrast land wording, while STILL firing on actual land/immovable gifts", () => {
    const store = TEST_STORE;
    const state = store.getState();
    const { passagePack, rawPassagesById, byWork } = buildPackFromStore([
      "prov.th.rc.42",
      "prov.th.rc.48",
    ]);
    const p42 = byWork.get("prov.th.rc.42")!.map((p) => p.passage_id);
    const p48 = byWork.get("prov.th.rc.48")!.map((p) => p.passage_id);

    // 1) K2 cash gift (฿30,000,000 cash from father to legitimate child)
    const cashQuestion =
      "บิดาให้เงินสดจำนวน 30,000,000 บาท แก่บุตรโดยชอบด้วยกฎหมายโดยเสน่หา บุตรผู้รับต้องเสียภาษีเงินได้บุคคลธรรมดาอย่างไร";
    const cashLedger = buildStructuredCaseFactLedger({ question: cashQuestion, applicableDate: null });
    expect(
      cashLedger.material_facts.find((f) => f.fact_key === "asset")?.normalized_category
    ).toBe("MOVABLE_PROPERTY_CASH_OR_OTHER");

    const cashDraft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "บุตรได้รับยกเว้น 20,000,000 บาท และเสียภาษีร้อยละ 5 จากส่วนเกิน 10,000,000 บาท เท่ากับ 500,000 บาท",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_K2_CASH_30M",
          issue_title_th: "ภาษีเงินได้บุคคลธรรมดาผู้รับเงินสดโดยเสน่หา",
          party_or_scope_th: "บุตรผู้รับ (เงินสด 30,000,000 บาท)",
          conclusion_th:
            "บุตรผู้รับเงินสด 30,000,000 บาท จากบุพการี ได้รับยกเว้นภาษีเงินได้ส่วนที่ไม่เกิน 20,000,000 บาท ตามมาตรา 42 (27) ส่วนที่เกิน 10,000,000 บาท เลือกเสียภาษีในอัตราร้อยละ 5 ตามมาตรา 48 (6) เป็นเงิน 500,000 บาท",
          material_facts_relied_on: ["บิดาให้เงินสด 30,000,000 บาท แก่บุตร"],
          governing_passage_ids: [...p42, ...p48],
          asserted_authorities: [
            { work_id: "prov.th.rc.42" },
            { work_id: "prov.th.rc.48" },
          ],
          contrast_mentions: [],
          // Explicitly mentions "มิใช่การโอนอสังหาริมทรัพย์หรือที่ดิน" as a contrast — C4 MUST NOT false-trigger!
          application_explanation_th:
            "เนื่องจากทรัพย์สินที่ให้คือเงินสด มิใช่การโอนกรรมสิทธิ์อสังหาริมทรัพย์หรือที่ดินตามมาตรา 42 (26) จึงพิจารณาตามมาตรา 42 (27) ยกเว้น 20,000,000 บาท และส่วนเกิน 10,000,000 บาท เสียภาษีร้อยละ 5 ตามมาตรา 48 (6) เท่ากับ 500,000 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "(30,000,000 - 20,000,000) × 5% = 500,000 บาท",
            tax_base_thb: 30_000_000,
            exempt_amount_thb: 20_000_000,
            taxable_amount_thb: 10_000_000,
            rate_pct: 5,
            computed_tax_thb: 500_000,
            missing_inputs_th: [],
            steps_th: ["ส่วนเกิน = 10,000,000 บาท", "10,000,000 × 5% = 500,000 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const cashOutcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.c12.c4_k2_cash",
      factLedger: cashLedger,
      passagePack,
      rawPassagesById,
      state,
      llmOk: true,
      draft: cashDraft,
      invocationAudit: TEST_INVOCATION_AUDIT,
      stagingFlagActive: true,
    });

    expect(cashOutcome.status).toBe("ANSWERED");
    expect(cashOutcome.verified_issues).toHaveLength(1);
    expect(cashOutcome.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(500_000);
    expect(cashOutcome.audit_trace.rejected_calculations).toHaveLength(0);

    // 2) Same facts on LAND (immovable property) -> immovable guard MUST fire on §48(6) / recipient calculation!
    const landQuestion =
      "บิดาโอนที่ดินมูลค่า 30,000,000 บาท ให้บุตรโดยชอบด้วยกฎหมายโดยไม่มีค่าตอบแทน บุตรผู้รับต้องเสียภาษีเงินได้บุคคลธรรมดาอย่างไร";
    const landLedger = buildStructuredCaseFactLedger({ question: landQuestion, applicableDate: null });
    expect(
      landLedger.material_facts.find((f) => f.fact_key === "asset")?.normalized_category
    ).toBe("IMMOVABLE_PROPERTY_LAND");

    const landDraft: GroundedLlmDraftResponse = {
      ...cashDraft,
      issues: [
        {
          ...cashDraft.issues[0],
          issue_id: "ISSUE_C4_LAND_30M",
          issue_title_th: "ภาษีเงินได้บุคคลธรรมดาผู้รับโอนที่ดิน",
          party_or_scope_th: "บุตรผู้รับโอนที่ดิน (30,000,000 บาท)",
          conclusion_th:
            "บุตรผู้รับโอนที่ดิน 30,000,000 บาท ได้รับยกเว้น 20,000,000 บาท ตามมาตรา 42 (26) ส่วนที่เกิน 10,000,000 บาท เสียภาษีร้อยละ 5 ตามมาตรา 48 (6) เป็นเงิน 500,000 บาท",
          application_explanation_th:
            "ผู้รับโอนที่ดินได้รับยกเว้น 20,000,000 บาท ตามมาตรา 42 (26) ส่วนที่เกิน 10,000,000 บาท เสียภาษี 5% ตามมาตรา 48 (6) เท่ากับ 500,000 บาท",
        },
      ],
    };

    const landOutcome = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.c12.c4_land_guard",
      factLedger: landLedger,
      passagePack,
      rawPassagesById,
      state,
      llmOk: true,
      draft: landDraft,
      invocationAudit: TEST_INVOCATION_AUDIT,
      stagingFlagActive: true,
    });

    expect(
      landOutcome.audit_trace.rejected_calculations.some(
        (rc) => rc.rejection_code === "UNSUPPORTED_IMMOVABLE_RECIPIENT_CALCULATION"
      )
    ).toBe(true);
  });

  it("C1 + VAT multi-lot breakdown regression: natural Thai contrast wording (สิ้นสุดช่วงความรับผิด / ยังไม่อยู่ในบังคับ / ไม่ใช้ พ.ร.ฎ.) and per-lot breakdown inside a bucket claim pass cleanly", () => {
    const store = TEST_STORE;
    const state = store.getState();
    const { passagePack, rawPassagesById, byWork } = buildPackFromStore(
      [
        "prov.th.rc.78",
        "prov.th.rc.80",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
        "subreg.th.rd.vat_local_tax_guide",
      ],
      ["2026-09-29", "2026-10-01"]
    );
    const p78 = byWork.get("prov.th.rc.78")![0].passage_id;
    const p80 = byWork.get("prov.th.rc.80")![0].passage_id;
    const pGuide = byWork.get("subreg.th.rd.vat_local_tax_guide")![0].passage_id;
    const p799 = byWork.get("subreg.th.rc.royal_decree.799")!.map((p) => p.passage_id);
    const p807 = byWork.get("subreg.th.rc.royal_decree.807")!.map((p) => p.passage_id);

    const q =
      "บริษัท ทดสอบนกแก้ว จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อรายเดียว ราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ในล็อต A เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เท่านั้น ส่วนเหตุการณ์อื่นทั้งหมด ได้แก่ การโอนกรรมสิทธิ์ การรับชำระราคา และการออกใบกำกับภาษีของล็อต B และล็อต C รวมทั้งการส่งมอบสินค้าทั้ง 3 ล็อต เกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C ก่อนวันที่ 1 ตุลาคม 2569";
    const factLedger = buildStructuredCaseFactLedger({ question: q, applicableDate: null });

    const draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "ล็อต A 1,400 บาท (29 ก.ย. 2569, พ.ร.ฎ. 799) และล็อต B+C 2,100 บาท (1 ต.ค. 2569, พ.ร.ฎ. 807)",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_1_LOT_A_2026_09_29",
          issue_title_th: "ส่วนที่ 1: ล็อต A (29 กันยายน 2569)",
          party_or_scope_th: "ล็อต A มูลค่า 20,000 บาท",
          conclusion_th:
            "ล็อต A เกิดความรับผิดวันที่ 29 กันยายน 2569 ตามมาตรา 78 (1) (ก) ภายใต้พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
          material_facts_relied_on: ["โอนกรรมสิทธิ์ล็อต A วันที่ 29 กันยายน 2569"],
          governing_passage_ids: [p78, p80, ...p799, pGuide],
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.799" },
            { work_id: "subreg.th.rd.vat_local_tax_guide" },
          ],
          contrast_mentions: [{ work_id: "subreg.th.rc.royal_decree.807", role: "not_applicable" }],
          application_explanation_th:
            "ตามมาตรา 78 (1) และพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 คงจัดเก็บภาษีมูลค่าเพิ่มร้อยละ 6.3 ถึงวันที่ 30 กันยายน 2569 (โดยยังไม่อยู่ในบังคับและยังไม่ถึงกำหนดใช้บังคับของพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 ซึ่งเริ่มใช้บังคับวันที่ 1 ตุลาคม 2569) เมื่อรวมภาษีท้องถิ่นร้อยละ 0.7 รวมร้อยละ 7.0 เป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "20,000 × 7% = 1,400 บาท",
            tax_base_thb: 20_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 20_000,
            rate_pct: 7,
            computed_tax_thb: 1_400,
            missing_inputs_th: [],
            steps_th: ["20,000 × 7% = 1,400 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
        {
          issue_id: "ISSUE_2_LOT_B_C_2026_10_01",
          issue_title_th: "ส่วนที่ 2: ล็อต B และล็อต C (1 ตุลาคม 2569)",
          party_or_scope_th: "ล็อต B 20,000 บาท และล็อต C 10,000 บาท (รวม 30,000 บาท)",
          conclusion_th:
            "ล็อต B และล็อต C รวมมูลค่า 30,000 บาท เกิดความรับผิดวันที่ 1 ตุลาคม 2569 ตามมาตรา 78 (1) ภายใต้พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 อัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่มรวม 2,100 บาท (แยกเป็นล็อต B เท่ากับ 1,400 บาท และล็อต C เท่ากับ 700 บาท ยอดรวมทั้งสิ้น 32,100 บาท)",
          material_facts_relied_on: ["ส่งมอบล็อต B และล็อต C วันที่ 1 ตุลาคม 2569"],
          governing_passage_ids: [p78, p80, ...p807, pGuide],
          asserted_authorities: [
            { work_id: "prov.th.rc.78" },
            { work_id: "subreg.th.rc.royal_decree.807" },
            { work_id: "subreg.th.rd.vat_local_tax_guide" },
          ],
          contrast_mentions: [{ work_id: "subreg.th.rc.royal_decree.799", role: "not_applicable" }],
          application_explanation_th:
            "ในวันที่ 1 ตุลาคม 2569 พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 สิ้นสุดช่วงความรับผิดที่ครอบคลุมไปแล้ว (ไม่ใช้พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568) จึงใช้พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 ลดอัตราเหลือร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่มรวม 2,100 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            is_computable_from_stated_facts: true,
            formula_description_th: "30,000 × 7% = 2,100 บาท",
            tax_base_thb: 30_000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 30_000,
            rate_pct: 7,
            computed_tax_thb: 2_100,
            missing_inputs_th: [],
            steps_th: ["30,000 × 7% = 2,100 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const out = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.c12.contrast_and_breakdown",
      factLedger,
      passagePack,
      rawPassagesById,
      state,
      llmOk: true,
      draft,
      invocationAudit: TEST_INVOCATION_AUDIT,
      stagingFlagActive: true,
    });

    expect(out.audit_trace.rejected_claims).toEqual([]);
    expect(out.status).toBe("ANSWERED");
    expect(out.verified_issues).toHaveLength(2);
  });
});
