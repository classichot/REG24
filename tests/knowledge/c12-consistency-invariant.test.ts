import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFactDelta,
  buildStructuredCaseFactLedger,
  computeLedgerStateHash,
} from "../../src/core/knowledge/case-fact-ledger";
import {
  attachTraceableEnvelopeToGroundedAnswer,
  checkAllocationToClaimConsistencyInvariant,
} from "../../src/core/knowledge/claim-traceability-engine";
import { verifyAndRenderGroundedLlmDraft } from "../../src/core/knowledge/grounded-llm-verifier";
import {
  buildGroundedPassagePack,
  type GroundedLlmDraftResponse,
  type ProviderInvocationAudit,
} from "../../src/core/knowledge/grounded-llm-drafter";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import type { Actor, GroundedAnswer, Passage } from "../../src/core/knowledge/contracts";

const STORE = new DurableKnowledgeStore(
  path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging")
);
const ACTOR: Actor = {
  actor_id: "c12.invariant.test@reg24.th",
  tenant_id: "PUBLIC",
  role: "legal_reviewer",
  authorized_scopes: ["PUBLIC"],
};

const SF_C11_3A_R1 =
  "บริษัท ทดสอบนกแก้ว จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อรายเดียว ราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ในล็อต A เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เท่านั้น ส่วนเหตุการณ์อื่นทั้งหมด ได้แก่ การโอนกรรมสิทธิ์ การรับชำระราคา และการออกใบกำกับภาษีของล็อต B และล็อต C รวมทั้งการส่งมอบสินค้าทั้ง 3 ล็อต เกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C ก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const SF_C11_3B_R2 =
  "ขอเปลี่ยนข้อเท็จจริงว่า เหตุการณ์ทั้งหมดที่เดิมเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 ให้เปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 2 ตุลาคม 2569 แทน ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด วันเกิดความรับผิด พระราชกฤษฎีกา และภาษีมูลค่าเพิ่มของแต่ละส่วนเป็นอย่างไร";

const R3_EXACT_EN =
  "Correction: the 30 September payment and tax invoice covered lot B only. Keep all other facts unchanged.";

const VAT_PASSAGE_IDS = [
  "psg.aa853373203223", // §78
  "psg.1b1abb8e7e22df", // §80
  "psg.rc8.rd799.sec_1_2",
  "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
  "psg.rc8.rd807.sec_1_2",
  "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
  "psg.3d0eb5636faa0e", // local tax guide
];

const MOCK_AUDIT: ProviderInvocationAudit = {
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
  provider_interaction_id: "mock.b4",
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
};

function loadVatPackAndRaw(splitDates: string[]) {
  const state = STORE.getState();
  const rawList: Passage[] = VAT_PASSAGE_IDS.map((pid) => state.passages[pid]).filter(Boolean);
  const rawById = new Map(rawList.map((p) => [p.passage_id, p]));
  const pack = buildGroundedPassagePack({
    passages: rawList,
    state,
    controllingDateIso: null,
    splitPaymentTaxPointDates: splitDates,
  });
  return { state, rawById, pack };
}

function makeLotIssue(opts: {
  id: string;
  lotLabel: string;
  dateTh: string;
  base: number;
  vat: number;
  decreeNum: "799" | "807";
}) {
  const decPids =
    opts.decreeNum === "799"
      ? ["psg.rc8.rd799.sec_1_2", "psg.rc8.rd799.sec_3_quoted_rd646_sec_4"]
      : ["psg.rc8.rd807.sec_1_2", "psg.rc8.rd807.sec_3_quoted_rd646_sec_4"];
  const decYear = opts.decreeNum === "799" ? "2568" : "2569";
  const commTh = opts.decreeNum === "799" ? "1 ตุลาคม 2568" : "1 ตุลาคม 2569";
  return {
    issue_id: opts.id,
    issue_title_th: `ภาระภาษีมูลค่าเพิ่มสำหรับ${opts.lotLabel} (${opts.dateTh})`,
    party_or_scope_th: `สินค้า${opts.lotLabel} มูลค่า ${opts.base.toLocaleString("en-US")} บาท`,
    conclusion_th: `ความรับผิดในการเสียภาษีมูลค่าเพิ่มของ${opts.lotLabel} เกิดขึ้นเมื่อวันที่ ${opts.dateTh} ตามมาตรา 78 (1) อยู่ภายใต้พระราชกฤษฎีกา (ฉบับที่ ${opts.decreeNum}) พ.ศ. ${decYear} เสียภาษีมูลค่าเพิ่มร้อยละ 7.0 เป็นเงิน ${opts.vat.toLocaleString("en-US")} บาท`,
    material_facts_relied_on: [`${opts.lotLabel} มูลค่า ${opts.base.toLocaleString("en-US")} บาท วันที่ ${opts.dateTh}`],
    governing_passage_ids: [
      "psg.aa853373203223",
      "psg.1b1abb8e7e22df",
      ...decPids,
      "psg.3d0eb5636faa0e",
    ],
    application_explanation_th: `ตามประมวลรัษฎากร มาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ ${opts.decreeNum}) พ.ศ. ${decYear} (ใช้บังคับตั้งแต่วันที่ ${commTh} ตามมาตรา 2) และแนวทางกรมสรรพากรเรื่องภาษีท้องถิ่น คิดเป็นภาษีมูลค่าเพิ่ม ${opts.vat.toLocaleString("en-US")} บาท`,
    authority_distinction_note_th: `มาตรา 78, มาตรา 80 และ พ.ร.ฎ. ฉบับที่ ${opts.decreeNum}`,
    proposed_calculation: {
      formula_description_th: `${opts.base.toLocaleString("en-US")} x 7%`,
      tax_base_thb: opts.base,
      exempt_amount_thb: 0,
      taxable_amount_thb: opts.base,
      rate_pct: 7,
      computed_tax_thb: opts.vat,
      is_computable_from_stated_facts: true,
      missing_inputs_th: [],
      steps_th: [`${opts.base.toLocaleString("en-US")} x 7% = ${opts.vat.toLocaleString("en-US")} บาท`],
    },
    missing_facts_or_uncertainties_th: [],
  };
}

function buildGroundedFromVerified(
  traceId: string,
  outcome: ReturnType<typeof verifyAndRenderGroundedLlmDraft>
): GroundedAnswer {
  return {
    release_id: "rel.B01.rc8",
    knowledge_snapshot_at: new Date().toISOString(),
    generated_at: new Date().toISOString(),
    status: outcome.status,
    answer: outcome.rendered_answer_th,
    claims: outcome.claims,
    evidence: outcome.evidence_cards,
    assumptions: outcome.assumptions_th,
    clarification_questions: outcome.clarification_questions_th,
    coverage_warnings: outcome.coverage_warnings_th,
    applicable_date: null,
    model_policy_version: "reg24-grounded-llm-legal-application-v1.1",
    trace_id: traceId,
    latency_ms: 20,
    execution_provenance: {
      git_commit_sha: "c12test",
      release_id: "rel.B01.rc8",
      manifest_id: "mfst.b01.rc8_thai_legal_index",
      manifest_hash: "test",
      model_id: "google-gemini:gemini-4-neon",
      model_policy_version: "reg24-grounded-llm-legal-application-v1.1",
      claim_verifier_version: "reg24-claim-verifier-v2.1",
      calculation_verifier_version: "reg24-tax-calc-verifier-v1.0",
      ruleset_version: "th-official-traceability-2026.11.2",
      query_kind: "LEGAL_FACT_APPLICATION",
      generation_mode: "llm_grounded",
      execution_mode: "llm_invoked",
      configuration: {
        store_topology_mode: "test",
        hierarchy_of_authority_retrieval: true,
        separate_calculation_verification: true,
        negated_fact_stripping_enabled: true,
        grounded_llm_staging_enabled: true,
        template_fallback_disabled: true,
      },
    },
    llm_audit_trace: outcome.audit_trace as unknown as Record<string, unknown>,
  };
}

describe("C12 Workstream B — Allocation-to-Claim Consistency Invariant & Stale-Record Guard", () => {
  it("B4.1: injecting stale r2 allocation record into r3 envelope -> NEEDS_CLARIFICATION, NO record rendered, stale_allocation_record logged", () => {
    const r2Ledger = buildStructuredCaseFactLedger({
      question: SF_C11_3B_R2,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: SF_C11_3A_R1 }],
    });
    const r3Ledger = applyFactDelta(
      r2Ledger,
      {
        is_correction: true,
        confidence: "high",
        changes: [
          {
            op: "reassign_lots",
            event_type: "PAYMENT",
            lots: ["LOT_B"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: "covered lot B only",
          },
          {
            op: "reassign_lots",
            event_type: "INVOICE",
            lots: ["LOT_B"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: "covered lot B only",
          },
        ],
        unchanged_scope: "all_other_facts",
      },
      { userTurnText: R3_EXACT_EN }
    );

    // Inject r2's stale allocation record (with r2's ledger_after_hash) into r3's ledger!
    const poisonedLedger = {
      ...r3Ledger,
      temporal_facts: {
        ...r3Ledger.temporal_facts,
        vat_portion_allocation_record: {
          ...r2Ledger.temporal_facts.vat_portion_allocation_record!,
        },
      },
    };
    expect(poisonedLedger.temporal_facts.vat_portion_allocation_record!.ledger_after_hash).not.toBe(
      r3Ledger.ledger_state_hash
    );

    const { state, rawById, pack } = loadVatPackAndRaw(["2026-09-29", "2026-09-30", "2026-10-02"]);
    const draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "สรุป",
      case_facts_used: [],
      issues: [
        makeLotIssue({ id: "I1", lotLabel: "ล็อต A", dateTh: "29 กันยายน 2569", base: 20000, vat: 1400, decreeNum: "799" }),
        makeLotIssue({ id: "I2", lotLabel: "ล็อต B", dateTh: "30 กันยายน 2569", base: 20000, vat: 1400, decreeNum: "799" }),
        makeLotIssue({ id: "I3", lotLabel: "ล็อต C", dateTh: "2 ตุลาคม 2569", base: 10000, vat: 700, decreeNum: "807" }),
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const verified = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.b4.stale",
      factLedger: poisonedLedger,
      passagePack: pack,
      rawPassagesById: rawById,
      state,
      llmOk: true,
      draft,
      invocationAudit: MOCK_AUDIT,
      stagingFlagActive: true,
    });
    // B3: Renderer NEVER renders a stale allocation record!
    expect(verified.rendered_answer_th).not.toContain("Verified VAT Allocation Record");
    expect(verified.audit_trace.stale_allocation_record).toBe(true);

    const grounded = buildGroundedFromVerified("trc.b4.stale", verified);
    const envelope = attachTraceableEnvelopeToGroundedAnswer(STORE, grounded, {
      question: R3_EXACT_EN,
      actor: ACTOR,
    });

    expect(envelope.grounded_answer_status).toBe("NEEDS_CLARIFICATION");
    expect(grounded.status).toBe("NEEDS_CLARIFICATION");
    expect(envelope.rendered_answer_th).not.toContain("Verified VAT Allocation Record");
    expect(grounded.answer).not.toContain("Verified VAT Allocation Record");
    expect(envelope.clarification_questions_th?.length).toBeGreaterThanOrEqual(1);
    expect(envelope.coverage_warnings_th?.some((w) => w.includes("stale_allocation_record"))).toBe(true);
  });

  it("B4.2: injecting a claim whose decree differs from its lot's record -> invariant fires -> NEEDS_CLARIFICATION", () => {
    const r2Ledger = buildStructuredCaseFactLedger({
      question: SF_C11_3B_R2,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: SF_C11_3A_R1 }],
    });
    const r3Ledger = applyFactDelta(
      r2Ledger,
      {
        is_correction: true,
        confidence: "high",
        changes: [
          {
            op: "reassign_lots",
            event_type: "PAYMENT",
            lots: ["LOT_B"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: "covered lot B only",
          },
        ],
        unchanged_scope: "all_other_facts",
      },
      { userTurnText: R3_EXACT_EN }
    );

    const { state, rawById, pack } = loadVatPackAndRaw(["2026-09-29", "2026-09-30", "2026-10-02"]);
    // Draft cleanly first, then tamper with Lot B's evidence reference to RD 807 to test the B1 invariant directly!
    const draft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "สรุป",
      case_facts_used: [],
      issues: [
        makeLotIssue({ id: "I1", lotLabel: "ล็อต A", dateTh: "29 กันยายน 2569", base: 20000, vat: 1400, decreeNum: "799" }),
        makeLotIssue({ id: "I2", lotLabel: "ล็อต B", dateTh: "30 กันยายน 2569", base: 20000, vat: 1400, decreeNum: "799" }),
        makeLotIssue({ id: "I3", lotLabel: "ล็อต C", dateTh: "2 ตุลาคม 2569", base: 10000, vat: 700, decreeNum: "807" }),
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };
    const verified = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.b4.wrongdec",
      factLedger: r3Ledger,
      passagePack: pack,
      rawPassagesById: rawById,
      state,
      llmOk: true,
      draft,
      invocationAudit: MOCK_AUDIT,
      stagingFlagActive: true,
    });
    const grounded = buildGroundedFromVerified("trc.b4.wrongdec", verified);
    const cleanEnv = attachTraceableEnvelopeToGroundedAnswer(STORE, grounded, {
      question: R3_EXACT_EN,
      actor: ACTOR,
    });
    expect(cleanEnv.grounded_answer_status).toBe("ANSWERED");

    // Mutate Lot B's governing decree reference to RD 807 (contradicting record's RD 799)
    const tamperedClaims = cleanEnv.claims.map((c) => {
      if (!c.text.includes("ล็อต B")) return c;
      return {
        ...c,
        evidence_references: c.evidence_references.map((r) =>
          r.doc_id === "subreg.th.rc.royal_decree.799"
            ? {
                ...r,
                doc_id: "subreg.th.rc.royal_decree.807",
                version_id: "ver.th.rc.royal_decree.807.v3",
              }
            : r
        ),
      };
    });

    const inv = checkAllocationToClaimConsistencyInvariant({
      factLedger: r3Ledger,
      publishedClaims: tamperedClaims,
      unresolvedIssues: [],
      isLlmGrounded: true,
    });
    expect(inv.ok).toBe(false);
    expect(inv.violations.some((v) => v.code === "CLAIM_DECREE_VERSION_MISMATCH")).toBe(true);
    expect(inv.clarification_question_th).toContain("ล็อต B");
    expect(inv.clarification_question_th).toContain("2026-09-30");
  });

  it("B4.3: silently omitted lot (DEF-C11-1 / DEF-C11-2 failure shape) triggers B1 invariant -> NEEDS_CLARIFICATION, no allocation record", () => {
    const r2Ledger = buildStructuredCaseFactLedger({
      question: SF_C11_3B_R2,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: SF_C11_3A_R1 }],
    });
    const r3Ledger = applyFactDelta(
      r2Ledger,
      {
        is_correction: true,
        confidence: "high",
        changes: [
          {
            op: "reassign_lots",
            event_type: "PAYMENT",
            lots: ["LOT_B"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: "covered lot B only",
          },
        ],
        unchanged_scope: "all_other_facts",
      },
      { userTurnText: R3_EXACT_EN }
    );

    const { state, rawById, pack } = loadVatPackAndRaw(["2026-09-29", "2026-09-30", "2026-10-02"]);
    // Only Lot A and Lot C drafted/survived — Lot B silently missing!
    const draftMissingLotB: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "สรุป",
      case_facts_used: [],
      issues: [
        makeLotIssue({ id: "I1", lotLabel: "ล็อต A", dateTh: "29 กันยายน 2569", base: 20000, vat: 1400, decreeNum: "799" }),
        makeLotIssue({ id: "I3", lotLabel: "ล็อต C", dateTh: "2 ตุลาคม 2569", base: 10000, vat: 700, decreeNum: "807" }),
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };
    const verified = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.b4.missingB",
      factLedger: r3Ledger,
      passagePack: pack,
      rawPassagesById: rawById,
      state,
      llmOk: true,
      draft: draftMissingLotB,
      invocationAudit: MOCK_AUDIT,
      stagingFlagActive: true,
    });
    const grounded = buildGroundedFromVerified("trc.b4.missingB", verified);
    const envelope = attachTraceableEnvelopeToGroundedAnswer(STORE, grounded, {
      question: R3_EXACT_EN,
      actor: ACTOR,
    });

    expect(envelope.grounded_answer_status).toBe("NEEDS_CLARIFICATION");
    expect(grounded.status).toBe("NEEDS_CLARIFICATION");
    expect(envelope.rendered_answer_th).not.toContain("Verified VAT Allocation Record");
    expect(envelope.clarification_questions_th?.[0]).toContain("ล็อต B");
  });

  it("B4.4: zero false positives across C9–C11 passing VAT fixtures (distinct lots, same lot, sets, items, r1, r2, r3)", () => {
    const cases: Array<{
      name: string;
      question: string;
      history?: Array<{ role: "user"; content: string }>;
      splitDates: string[];
      issues: GroundedLlmDraftResponse["issues"];
    }> = [
      {
        name: "SF-C9-1 distinct lots (A+B 30 Sep 40k/2,800; C 1 Oct 10k/700)",
        question:
          "ขายสินค้าทั่วไปในประเทศ ราคารวม 50,000 บาท แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท โอนกรรมสิทธิ์ล็อต A วันที่ 30 กันยายน 2569 และรับชำระราคาและออกใบกำกับภาษีล็อต B วันที่ 30 กันยายน 2569 ส่วนล็อต C และการส่งมอบทั้ง 3 ล็อตเกิดขึ้นวันที่ 1 ตุลาคม 2569 ผู้ขายจดทะเบียน VAT",
        splitDates: ["2026-09-30", "2026-10-01"],
        issues: [
          makeLotIssue({ id: "I1", lotLabel: "ล็อต A และล็อต B", dateTh: "30 กันยายน 2569", base: 40000, vat: 2800, decreeNum: "799" }),
          makeLotIssue({ id: "I2", lotLabel: "ล็อต C", dateTh: "1 ตุลาคม 2569", base: 10000, vat: 700, decreeNum: "807" }),
        ],
      },
      {
        name: "SF-C11-3A r1 (A 29 Sep 20k/1,400; B+C 1 Oct 30k/2,100)",
        question: SF_C11_3A_R1,
        splitDates: ["2026-09-29", "2026-10-01"],
        issues: [
          makeLotIssue({ id: "I1", lotLabel: "ล็อต A", dateTh: "29 กันยายน 2569", base: 20000, vat: 1400, decreeNum: "799" }),
          makeLotIssue({ id: "I2", lotLabel: "ล็อต B และล็อต C", dateTh: "1 ตุลาคม 2569", base: 30000, vat: 2100, decreeNum: "807" }),
        ],
      },
      {
        name: "SF-C11-3B r2 (A 29 Sep 20k/1,400; B+C 2 Oct 30k/2,100)",
        question: SF_C11_3B_R2,
        history: [{ role: "user", content: SF_C11_3A_R1 }],
        splitDates: ["2026-09-29", "2026-10-02"],
        issues: [
          makeLotIssue({ id: "I1", lotLabel: "ล็อต A", dateTh: "29 กันยายน 2569", base: 20000, vat: 1400, decreeNum: "799" }),
          makeLotIssue({ id: "I2", lotLabel: "ล็อต B และล็อต C", dateTh: "2 ตุลาคม 2569", base: 30000, vat: 2100, decreeNum: "807" }),
        ],
      },
      {
        name: "SF-C11-1A ชุดที่ 1+2 30 Sep; ชุดที่ 3 1 Oct",
        question:
          "บริษัทจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศ ราคารวม 50,000 บาท แบ่งเป็น 3 ชุด คือ ชุดที่ 1 มูลค่า 20,000 บาท ชุดที่ 2 มูลค่า 20,000 บาท และชุดที่ 3 มูลค่า 10,000 บาท โอนกรรมสิทธิ์ชุดที่ 1 วันที่ 30 กันยายน 2569 และรับชำระราคาและออกใบกำกับภาษีชุดที่ 2 วันที่ 30 กันยายน 2569 ส่วนชุดที่ 3 และการส่งมอบทั้ง 3 ชุดเกิดขึ้นวันที่ 1 ตุลาคม 2569",
        splitDates: ["2026-09-30", "2026-10-01"],
        issues: [
          makeLotIssue({ id: "I1", lotLabel: "ชุดที่ 1 และชุดที่ 2", dateTh: "30 กันยายน 2569", base: 40000, vat: 2800, decreeNum: "799" }),
          makeLotIssue({ id: "I2", lotLabel: "ชุดที่ 3", dateTh: "1 ตุลาคม 2569", base: 10000, vat: 700, decreeNum: "807" }),
        ],
      },
      {
        name: "SF-C11-1B รายการที่ 1+2 30 Sep; รายการที่ 3 1 Oct",
        question:
          "บริษัทจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศ ราคารวม 50,000 บาท แบ่งเป็น 3 รายการ คือ รายการที่ 1 มูลค่า 20,000 บาท รายการที่ 2 มูลค่า 20,000 บาท และรายการที่ 3 มูลค่า 10,000 บาท โอนกรรมสิทธิ์รายการที่ 1 วันที่ 30 กันยายน 2569 และรับชำระราคาและออกใบกำกับภาษีรายการที่ 2 วันที่ 30 กันยายน 2569 ส่วนรายการที่ 3 และการส่งมอบทั้ง 3 รายการเกิดขึ้นวันที่ 1 ตุลาคม 2569",
        splitDates: ["2026-09-30", "2026-10-01"],
        issues: [
          makeLotIssue({ id: "I1", lotLabel: "รายการที่ 1 และรายการที่ 2", dateTh: "30 กันยายน 2569", base: 40000, vat: 2800, decreeNum: "799" }),
          makeLotIssue({ id: "I2", lotLabel: "รายการที่ 3", dateTh: "1 ตุลาคม 2569", base: 10000, vat: 700, decreeNum: "807" }),
        ],
      },
    ];

    for (let idx = 0; idx < cases.length; idx++) {
      const tc = cases[idx];
      const ledger = buildStructuredCaseFactLedger({
        question: tc.question,
        applicableDate: null,
        conversationHistory: tc.history || [],
      });
      expect(ledger.temporal_facts.vat_portion_allocation_record?.ledger_after_hash).toBe(
        computeLedgerStateHash(ledger)
      );
      const { state, rawById, pack } = loadVatPackAndRaw(tc.splitDates);
      const verified = verifyAndRenderGroundedLlmDraft({
        traceId: `trc.b4.ctrl.${idx}`,
        factLedger: ledger,
        passagePack: pack,
        rawPassagesById: rawById,
        state,
        llmOk: true,
        draft: {
          answer_status: "ANSWERED",
          overall_summary_th: "สรุป",
          case_facts_used: [],
          issues: tc.issues,
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        },
        invocationAudit: MOCK_AUDIT,
        stagingFlagActive: true,
      });
      const grounded = buildGroundedFromVerified(`trc.b4.ctrl.${idx}`, verified);
      const env = attachTraceableEnvelopeToGroundedAnswer(STORE, grounded, {
        question: tc.question,
        actor: ACTOR,
      });
      expect(
        env.grounded_answer_status,
        `Fixture '${tc.name}' unexpectedly triggered invariant: ${JSON.stringify(env.coverage_warnings_th)}`
      ).toBe("ANSWERED");
      expect(env.claims.filter((c) => c.published)).toHaveLength(tc.issues.length);
      expect(grounded.answer).toContain("Verified VAT Allocation Record");
    }
  });

  it("B4.5: non-double-taxation disclaimer mentioning sibling sets in claim header does not trigger false LOT_NOT_COVERED_OR_UNRESOLVED", () => {
    const q =
      "บริษัท ทดสอบหงส์ขาว จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แยกสินค้าเป็น 3 ชุด คือ ชุดที่ 1 ราคา 20,000 บาท ชุดที่ 2 ราคา 20,000 บาท และชุดที่ 3 ราคา 10,000 บาท เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์สำหรับชุดที่ 1 และในวันเดียวกันได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับชุดที่ 2 โดยชุดที่ 3 ยังไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อน จากนั้นบริษัทส่งมอบสินค้าทั้ง 3 ชุดพร้อมกันเมื่อวันที่ 1 ตุลาคม 2569";
    const ledger = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
    const { state, rawById, pack } = loadVatPackAndRaw(["2026-09-30", "2026-10-01"]);

    const i1 = makeLotIssue({
      id: "ISSUE_1_VAT_PORTION_1_2026_09_30",
      lotLabel: "ชุดที่ 1 และชุดที่ 2",
      dateTh: "30 กันยายน 2569",
      base: 40000,
      vat: 2800,
      decreeNum: "799",
    });
    const i2 = {
      ...makeLotIssue({
        id: "ISSUE_2_VAT_PORTION_2_2026_10_01",
        lotLabel: "ชุดที่ 3",
        dateTh: "1 ตุลาคม 2569",
        base: 10000,
        vat: 700,
        decreeNum: "807",
      }),
      issue_title_th:
        "วันเกิดความรับผิด กฎหมายที่ใช้บังคับ และภาษีมูลค่าเพิ่มสำหรับส่วนที่ 2 (สินค้าชุดที่ 3) และการไม่เก็บภาษีซ้ำจากการส่งมอบชุดที่ 1 และชุดที่ 2",
      party_or_scope_th: "สินค้าชุดที่ 3 ฐานภาษี 10,000 บาท",
    };

    const verified = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.b4.nondouble_header",
      factLedger: ledger,
      passagePack: pack,
      rawPassagesById: rawById,
      state,
      llmOk: true,
      draft: {
        answer_status: "ANSWERED",
        overall_summary_th: "สรุป",
        case_facts_used: [],
        issues: [i1, i2],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
      invocationAudit: MOCK_AUDIT,
      stagingFlagActive: true,
    });
    const grounded = buildGroundedFromVerified("trc.b4.nondouble_header", verified);
    const env = attachTraceableEnvelopeToGroundedAnswer(STORE, grounded, {
      question: q,
      actor: ACTOR,
    });
    expect(env.grounded_answer_status).toBe("ANSWERED");
    expect(env.claims.filter((c) => c.published)).toHaveLength(2);
    expect(grounded.answer).toContain("Verified VAT Allocation Record");
  });
});
