/**
 * REG24 — Grounded LLM Answer Architecture Tests (Requirements 1, 2, 3)
 *
 * Verifies:
 * 1. Case Fact Ledger preserves original facts alongside normalized categories, tracks turn overrides,
 *    clears stale dates on new questions, and distinguishes transaction / as-of / controlling tax point dates.
 * 2. Pre-publication verifier enforces passage-ID grounding, effective-date windows, case-fact preservation,
 *    independent calculation arithmetic/input verification, and RC1 zero-leak rejection.
 * 3. Zero silent template fallback on provider outage or total claim rejection.
 * 4. Honest citation link reachability (`unchecked_live` vs `verified_online`) and transcript labeling.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import {
  buildGroundedPassagePack,
  GROUNDED_LLM_PROMPT_VERSION,
  type GroundedLlmDraftResponse,
  type ProviderInvocationAudit,
} from "../../src/core/knowledge/grounded-llm-drafter";
import { verifyAndRenderGroundedLlmDraft } from "../../src/core/knowledge/grounded-llm-verifier";
import { resolveTraceableEvidenceById } from "../../src/core/knowledge/claim-traceability-engine";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import type { Actor, Passage } from "../../src/core/knowledge/contracts";

const STAGING_GZ = path.resolve(
  process.cwd(),
  "data",
  "knowledge-store-b01-rc2-staging",
  "canonical-state.json.gz"
);

const QA_ACTOR: Actor = {
  actor_id: "qa.grounded.llm@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const MOCK_INVOCATION: ProviderInvocationAudit = {
  provider: "google-gemini",
  api_surface: "interactions-v1beta",
  requested_model: "gemini-4-neon",
  resolved_model: "gemini-4-neon",
  actual_model_invoked: "gemini-4-neon",
  pinned_settings: {
    thinking_level: "high",
    thinking_level_note: null,
    temperature: 0.0,
    max_output_tokens: 16384,
    timeout_ms: 90000,
    store: false,
  },
  prompt_version: GROUNDED_LLM_PROMPT_VERSION,
  live_provider_called: true,
  silent_fallback_disabled: true,
  provider_interaction_id: "int.test.001",
  provider_response_status: "completed",
  failure_classification: "NONE",
  latency_ms: 1200,
  input_tokens: 900,
  output_tokens: 350,
  thought_tokens: 50,
  total_tokens: 1300,
  estimated_cost_usd: 0.00127,
  attempts: [
    {
      provider: "google-gemini",
      model: "gemini-4-neon",
      thinking_level: "high",
      status: "succeeded",
      http_status: 200,
      latency_ms: 1200,
    },
  ],
  error_summary: null,
};

describe("Grounded LLM Answer Architecture (Zero Prewritten Conclusion Templates)", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-grounded-llm-"));
    fs.copyFileSync(STAGING_GZ, path.join(tmpDir, "canonical-state.json.gz"));
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. Case Fact Ledger preserves condo/nephew facts, tracks turn overrides, clears stale dates, and distinguishes 3 dates", () => {
    // T09 condo + explicit nephew
    const t09 = buildStructuredCaseFactLedger({
      question:
        "นางวิไลวรรณยกห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภูมิ ซึ่งเป็นหลานชาย (บุตรชายของน้องสาวนางวิไลวรรณ) โดยเสน่หาไม่มีค่าตอบแทน และจดทะเบียนโอนกรรมสิทธิ์เมื่อวันที่ 18 สิงหาคม 2568 หนังสือสัญญาให้ระบุมูลค่า 6,000,000 บาท แต่ราคาประเมินทุนทรัพย์ของทางราชการที่ใช้ในการจดทะเบียนคือ 7,200,000 บาท การให้ครั้งนี้ไม่ได้เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณีใด นายภูมิต้องเสียภาษีเงินได้อย่างไร และต้องหักภาษี ณ ที่จ่ายเท่าใดในวันจดทะเบียน",
      applicableDate: null,
      conversationHistory: [],
    });

    expect(t09.is_new_conversation).toBe(true);
    expect(t09.fact_preservation_guards.forbid_land_substitution).toBe(true);
    expect(t09.fact_preservation_guards.forbid_niece_substitution).toBe(true);
    expect(t09.fact_preservation_guards.recipient_kinship_category).toBe(
      "COLLATERAL_NEPHEW_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD"
    );
    expect(t09.temporal_facts.controlling_tax_point.iso_date).toBe("2025-08-18");
    expect(t09.temporal_facts.legal_as_of_date).toBeNull();
    expect(t09.material_facts.some((f) => f.fact_key === "appraised_value_thb")).toBe(true);
    expect(t09.material_facts.some((f) => f.fact_key === "stated_deed_or_agreed_value_thb")).toBe(true);

    // Multi-turn override tracking (B1-11 -> B1-11F)
    const vatFollowUp = buildStructuredCaseFactLedger({
      question:
        "ข้อมูลเพิ่มเติมจากข้อ B1-11: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร",
      applicableDate: null,
      conversationHistory: [
        {
          role: "user",
          content:
            "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
        },
        {
          role: "assistant",
          content: "อ้างอิง กค 0702/99999 (ต้องไม่ถูกอ่านเข้า Fact Ledger)",
        },
      ],
    });
    expect(vatFollowUp.turn_count).toBe(2);
    expect(vatFollowUp.overrides.some((o) => o.fact_key === "vat_place_of_use")).toBe(true);
    expect(vatFollowUp.temporal_facts.controlling_tax_point.iso_date).toBe("2026-03-10");

    // 3-way date distinction: competing §78/1(1) dates (service use 28 Sep 2569 vs invoice 2 Oct 2569 vs payment 5 Oct 2569)
    const competingDates = buildStructuredCaseFactLedger({
      question:
        "บริษัทในไทยให้บริการที่ปรึกษาและลูกค้าใช้บริการทั้งหมดในประเทศไทยเมื่อวันที่ 28 กันยายน 2569 ออกใบกำกับภาษีวันที่ 2 ตุลาคม 2569 และได้รับชำระเงินวันที่ 5 ตุลาคม 2569 ต้องเสีย VAT อัตราใด",
      applicableDate: "2026-10-15",
      conversationHistory: [],
    });
    expect(competingDates.temporal_facts.legal_as_of_date).toBe("2026-10-15");
    expect(competingDates.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-28");
    expect(competingDates.temporal_facts.transaction_or_event_dates.length).toBeGreaterThanOrEqual(3);
  });

  it("2. Pre-publication verifier blocks out-of-window decrees, fact substitutions, fabricated passage IDs, bad math, and RC1 leaks", () => {
    const state = store.getState();
    const releaseId = state.active_release_id || "rel.B01.rc6";
    const allPassages = store.getPassagesForRelease(releaseId);

    const pickByWork = (wid: string): Passage => {
      const p = allPassages.find((x) => x.work_id === wid && !x.extraction_id.startsWith("ext.dep."));
      if (!p) throw new Error(`Missing passage for ${wid}`);
      return p;
    };

    const p80 = pickByWork("prov.th.rc.80");
    const p799 = pickByWork("subreg.th.rc.royal_decree.799");
    const p41bis = pickByWork("prov.th.rc.41_ทวิ");

    const rawMap = new Map<string, Passage>([
      [p80.passage_id, p80],
      [p799.passage_id, p799],
      [p41bis.passage_id, p41bis],
    ]);

    // Case A: V1 historical date 2025-09-30 — LLM wrongly applies RD 799 (starts 2025-10-01) -> MUST BE REJECTED!
    const v1Ledger = buildStructuredCaseFactLedger({
      question:
        "บริษัทในไทยให้บริการออกแบบระบบแก่ลูกค้าในกรุงเทพมหานคร ใช้บริการทั้งหมดในประเทศไทย ออกใบกำกับภาษีและรับเงินวันที่ 30 กันยายน 2568 ต้องคิด VAT อัตราใด",
    });
    const v1Pack = buildGroundedPassagePack({
      passages: [p80, p799],
      state,
      controllingDateIso: "2025-09-30",
    });
    const badV1Draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "เสีย VAT 7% ตาม พ.ร.ฎ. 799",
      case_facts_used: [],
      issues: [
        {
          issue_id: "iss.v1.wrong_decree",
          issue_title_th: "อัตรา VAT สำหรับบริการในประเทศ",
          party_or_scope_th: "ผู้ให้บริการ",
          conclusion_th: "เสียภาษีมูลค่าเพิ่มร้อยละ 7 ตามพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568",
          material_facts_relied_on: ["วันที่ 30 กันยายน 2568"],
          governing_passage_ids: [p799.passage_id],
          application_explanation_th: "ใช้พระราชกฤษฎีกา 799 ลดอัตราเป็นร้อยละ 7",
          authority_distinction_note_th: "กฎหมายลำดับรอง",
          proposed_calculation: null,
          missing_facts_or_uncertainties_th: [],
        },
        {
          issue_id: "iss.v1.supported_rc80",
          issue_title_th: "อัตราตามประมวลรัษฎากร มาตรา 80",
          party_or_scope_th: "ผู้ให้บริการ",
          conclusion_th: "มาตรา 80 แห่งประมวลรัษฎากรกำหนดอัตราภาษีมูลค่าเพิ่มร้อยละ 10 เว้นแต่มีพระราชกฤษฎีกาลดอัตราลง",
          material_facts_relied_on: ["วันที่ 30 กันยายน 2568"],
          governing_passage_ids: [p80.passage_id],
          application_explanation_th: "การลดอัตราสำหรับวันที่ 30 กันยายน 2568 ต้องตรวจสอบพระราชกฤษฎีกาที่ใช้บังคับก่อน 1 ตุลาคม 2568",
          authority_distinction_note_th: "กฎหมายแม่บท (ประมวลรัษฎากร)",
          proposed_calculation: {
            formula_description_th: "ทดสอบเลขผิด",
            tax_base_thb: 100000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 100000,
            rate_pct: 10,
            computed_tax_thb: 99999, // Wrong math! Must be rejected!
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["100,000 x 10% = 99,999"],
          },
          missing_facts_or_uncertainties_th: ["ไม่พบตัวบทพระราชกฤษฎีกาสำหรับงวดก่อน 1 ตุลาคม 2568 ในคลัง"],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: ["คลัง rel.B01.rc6 ไม่มีตัวบทพระราชกฤษฎีกาที่ครอบคลุมวันที่ 30 กันยายน 2568"],
    };

    const resV1 = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.test.v1",
      factLedger: v1Ledger,
      passagePack: v1Pack,
      rawPassagesById: rawMap,
      state,
      llmOk: true,
      draft: badV1Draft,
      invocationAudit: MOCK_INVOCATION,
      qaSyntheticFixture: "RC1_REJECTED_CALC",
      stagingFlagActive: true,
    });

    // Out-of-window RD 799 issue was rejected; RC80 supported issue survived; bad math & RC1 rejected with ZERO leak!
    expect(resV1.audit_trace.rejected_claims.some((r) => r.rejection_code === "OUT_OF_EFFECTIVE_DATE_WINDOW")).toBe(true);
    expect(resV1.audit_trace.rejected_calculations.some((r) => r.rejection_code === "ARITHMETIC_MISMATCH")).toBe(true);
    expect(resV1.audit_trace.rejected_calculations.some((r) => r.rejection_code === "SYNTHETIC_RC1_REJECTED_FIXTURE")).toBe(true);
    expect(resV1.verified_issues.length).toBe(1);
    expect(resV1.status).toBe("CONDITIONAL");
    expect(resV1.rendered_answer_th).not.toContain("999,888");
    expect(resV1.rendered_answer_th).not.toContain("88.5");
    expect(resV1.rendered_answer_th).not.toContain("99,999");

    // Case B: T09 condo/nephew fact substitution -> MUST BE REJECTED!
    const t09Ledger = buildStructuredCaseFactLedger({
      question:
        "นางวิไลวรรณยกห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภูมิ ซึ่งเป็นหลานชาย (บุตรชายของน้องสาวนางวิไลวรรณ) โดยเสน่หาไม่มีค่าตอบแทน เมื่อวันที่ 18 สิงหาคม 2568",
    });
    const t09Pack = buildGroundedPassagePack({
      passages: [p41bis],
      state,
      controllingDateIso: "2025-08-18",
    });
    const substitutedDraft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "โอนที่ดินให้หลานสาว",
      case_facts_used: [],
      issues: [
        {
          issue_id: "iss.t09.bad_sub",
          issue_title_th: "การโอนที่ดินให้หลานสาว",
          party_or_scope_th: "ผู้โอน",
          conclusion_th: "การโอนที่ดินให้หลานสาวถือว่าผู้โอนเป็นผู้มีเงินได้ตามมาตรา 41 ทวิ",
          material_facts_relied_on: ["โอนที่ดินให้หลานสาว"],
          governing_passage_ids: [p41bis.passage_id],
          application_explanation_th: "โอนที่ดินให้หลานสาว",
          authority_distinction_note_th: "กฎหมายแม่บท",
          proposed_calculation: null,
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };
    const resSub = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.test.t09sub",
      factLedger: t09Ledger,
      passagePack: t09Pack,
      rawPassagesById: rawMap,
      state,
      llmOk: true,
      draft: substitutedDraft,
      invocationAudit: MOCK_INVOCATION,
      stagingFlagActive: true,
    });
    expect(resSub.status).toBe("REVIEW_REQUIRED");
    expect(resSub.verified_issues.length).toBe(0);
    expect(resSub.audit_trace.template_fallback_used).toBe(false);
    expect(resSub.audit_trace.rejected_claims[0].rejection_code).toBe("CASE_FACT_SUBSTITUTION_VIOLATION");
  });

  it("3. Zero silent template fallback when LLM provider is unavailable", () => {
    const state = store.getState();
    const ledger = buildStructuredCaseFactLedger({
      question: "นางวิไลวรรณยกห้องชุดให้นายภูมิ ซึ่งเป็นหลานชาย",
    });

    const outageRes = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.test.outage",
      factLedger: ledger,
      passagePack: [],
      rawPassagesById: new Map(),
      state,
      llmOk: false,
      draft: null,
      invocationAudit: {
        ...MOCK_INVOCATION,
        actual_model_invoked: null,
        error_summary: "503 Service Unavailable",
      },
      stagingFlagActive: true,
    });

    expect(outageRes.status).toBe("REVIEW_REQUIRED");
    expect(outageRes.claims).toEqual([]);
    expect(outageRes.audit_trace.template_fallback_used).toBe(false);
    expect(outageRes.rendered_answer_th).toContain("No Silent Fallback");
  });

  it("4. Evidence resolver distinguishes unchecked live URLs from verified_online and labels transcripts honestly", () => {
    const state = store.getState();
    const releaseId = state.active_release_id || "rel.B01.rc6";
    const p80 = store
      .getPassagesForRelease(releaseId)
      .find((x) => x.work_id === "prov.th.rc.80" && !x.extraction_id.startsWith("ext.dep."));
    expect(p80).toBeTruthy();

    const resolved = resolveTraceableEvidenceById(store, p80!.passage_id, QA_ACTOR, releaseId);
    expect(resolved.ok).toBe(true);
    expect(resolved.evidence?.official_location.link_health).toBe("unchecked_live");
    expect(resolved.evidence?.official_location.link_health_label_th).toContain("ยังไม่ได้ตรวจเช็ก");
    expect(resolved.evidence?.reg24_preserved_copy_label_th).toContain("Transcript");
  });
});
