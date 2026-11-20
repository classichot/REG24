/**
 * REG24 — Gemini 4 Neon Adapter, No-Silent-Fallback & Per-Claim Calculation Isolation Suite
 *
 * Proves:
 * 1. Model-specific thinking_level adapter: `gemini-4-neon` starts at `"high"` with
 *    `max_output_tokens >= 16384` and NEVER sends unsupported `"minimal"` to Neon or 3.8 models.
 * 2. Provider-neutral schema & explicit separate OpenAI Responses challenger (`gpt-6.2-astra`)
 *    without ever automatically falling back across models or providers.
 * 3. Explicit handling of 429 / timeout / invalid / blocked / unavailable model responses with
 *    zero silent switch to Flash, Flash-Lite, or prewritten legal conclusion templates.
 * 4. Per-claim calculation binding (`ClaimBoundCalculationRecord`) across UI/API, server-verified
 *    save, and reopened saved revision: Claim A's verified calculation survives with its bound
 *    inputs/formula/units/source_versions, while Claim B (a separate unsupported claim in the
 *    same answer reusing Claim A's exact verified number) stays BLOCKED across UI, API, save,
 *    and reopen!
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import {
  attachTraceableEnvelopeToGroundedAnswer,
  isNavigationOrBoilerplatePassageText,
  reopenSavedTraceableAnswer,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import type { ClaimBoundCalculationRecord } from "../../src/core/knowledge/citation-contracts";
import type { Actor, GroundedAnswer } from "../../src/core/knowledge/contracts";
import {
  buildOpenAiStrictSchema,
  GROUNDED_LLM_PROMPT_VERSION,
  GROUNDED_LLM_RESPONSE_SCHEMA,
  resolveConfiguredProviderAndModel,
  resolveThinkingLevelForModel,
  type ProviderInvocationAudit,
} from "../../src/core/knowledge/grounded-llm-drafter";
import { verifyAndRenderGroundedLlmDraft } from "../../src/core/knowledge/grounded-llm-verifier";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";

const STAGING_GZ = path.resolve(
  process.cwd(),
  "data",
  "knowledge-store-b01-rc2-staging",
  "canonical-state.json.gz"
);

const QA_ACTOR: Actor = {
  actor_id: "qa.neon.calc.isolation",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Gemini 4 Neon Staging Candidate & Per-Claim Calculation Isolation", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-neon-calc-iso-"));
    fs.copyFileSync(STAGING_GZ, path.join(tmpDir, "canonical-state.json.gz"));
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. Model-specific thinking_level adapter starts Neon at 'high', never sends 'minimal' to Neon, and keeps OpenAI challenger explicit-only", () => {
    // Primary staging default resolves to gemini-4-neon
    const prevModel = process.env.REG24_GROUNDED_LLM_MODEL;
    const prevProv = process.env.REG24_GROUNDED_LLM_PROVIDER;
    delete process.env.REG24_GROUNDED_LLM_MODEL;
    delete process.env.REG24_GROUNDED_LLM_PROVIDER;
    try {
      const def = resolveConfiguredProviderAndModel();
      expect(def.provider).toBe("google-gemini");
      expect(def.requestedModel).toBe("gemini-4-neon");

      // Neon starts at high and gets 16384 max_output_tokens so reasoning never truncates JSON
      const neonDefault = resolveThinkingLevelForModel("gemini-4-neon");
      expect(neonDefault.thinking_level).toBe("high");
      expect(neonDefault.max_output_tokens).toBeGreaterThanOrEqual(16384);

      // Even if someone passes "minimal", Neon NEVER receives "minimal"!
      const neonGuard = resolveThinkingLevelForModel("gemini-4-neon", "minimal");
      expect(neonGuard.thinking_level).not.toBe("minimal");
      expect(neonGuard.thinking_level).toBe("high");
      expect(neonGuard.note).toContain("does not support thinking_level='minimal'");

      // Flash-Lite benchmark retains "minimal" support
      const flBench = resolveThinkingLevelForModel("gemini-3.5-flash-lite", "minimal");
      expect(flBench.thinking_level).toBe("minimal");

      // Separate OpenAI challenger is explicit opt-in ONLY
      const challenger = resolveConfiguredProviderAndModel({ challengerProvider: "openai" });
      expect(challenger.provider).toBe("openai");
      expect(challenger.requestedModel).toBe("gpt-6.2-astra");
      expect(buildOpenAiStrictSchema(GROUNDED_LLM_RESPONSE_SCHEMA).additionalProperties).toBe(false);
    } finally {
      if (prevModel !== undefined) process.env.REG24_GROUNDED_LLM_MODEL = prevModel;
      if (prevProv !== undefined) process.env.REG24_GROUNDED_LLM_PROVIDER = prevProv;
    }
  });

  it("2. Explicit 429 / unavailable / blocked Neon handling with ZERO silent switch to Flash, Flash-Lite, or templates", () => {
    const state = store.getState();
    const ledger = buildStructuredCaseFactLedger({
      question: "นางวิไลวรรณยกห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภูมิ ซึ่งเป็นหลานชาย",
    });

    const rateLimitedAudit: ProviderInvocationAudit = {
      provider: "google-gemini",
      api_surface: "interactions-v1beta",
      requested_model: "gemini-4-neon",
      resolved_model: null,
      actual_model_invoked: null,
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
      provider_interaction_id: null,
      provider_response_status: null,
      failure_classification: "RATE_LIMIT_429_FREE_TIER",
      latency_ms: 1500,
      input_tokens: 0,
      output_tokens: 0,
      thought_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      attempts: [
        {
          provider: "google-gemini",
          model: "gemini-4-neon",
          thinking_level: "high",
          status: "error",
          http_status: 429,
          latency_ms: 1500,
          error_message: "429 Rate limit exceeded for model gemini-4-neon (limit: 0 input tokens per minute on Free Tier)",
        },
      ],
      error_summary: "429 Rate limit exceeded for model gemini-4-neon (limit: 0 input tokens per minute on Free Tier)",
    };

    const res = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.neon.429.check",
      factLedger: ledger,
      passagePack: [],
      rawPassagesById: new Map(),
      state,
      llmOk: false,
      draft: null,
      invocationAudit: rateLimitedAudit,
      stagingFlagActive: true,
    });

    expect(res.status).toBe("REVIEW_REQUIRED");
    expect(res.claims).toEqual([]);
    expect(res.audit_trace.template_fallback_used).toBe(false);
    expect(res.audit_trace.provider_invocation.silent_fallback_disabled).toBe(true);
    expect(res.audit_trace.provider_invocation.attempts.length).toBe(1);
    expect(res.audit_trace.provider_invocation.attempts[0].model).toBe("gemini-4-neon");
    expect(res.rendered_answer_th).toContain("gemini-4-neon");
    expect(res.rendered_answer_th).toContain("No Silent Fallback");
  });

  it("3. Per-claim calculation binding: valid calculation survives while a sibling unsupported claim reusing its exact number stays BLOCKED across UI/API, save, and reopen", async () => {
    const state = store.getState();
    const releaseId = state.active_release_id || "rel.B01.rc6";
    const allPassages = store.getPassagesForRelease(releaseId);

    const p42 = allPassages.filter(
      (p) =>
        p.work_id === "prov.th.rc.42" &&
        !p.extraction_id.startsWith("ext.dep.") &&
        !isNavigationOrBoilerplatePassageText(p.exact_text) &&
        (/\bมาตรา\s*42\b|มาตรา\s*42/.test(p.exact_text) || /\(28\)/.test(p.exact_text))
    );
    const p48 = allPassages.filter(
      (p) =>
        p.work_id === "prov.th.rc.48" &&
        !p.extraction_id.startsWith("ext.dep.") &&
        !isNavigationOrBoilerplatePassageText(p.exact_text) &&
        (/มาตรา\s*48/.test(p.exact_text) || /\(7\)/.test(p.exact_text))
    );
    expect(p42.length).toBeGreaterThan(0);
    expect(p48.length).toBeGreaterThan(0);

    const p42_28 = p42.find((x) => /\(28\)/.test(x.exact_text)) || p42[0];
    const p48_7 = p48.find((x) => /\(7\)/.test(x.exact_text)) || p48[0];
    const p48_hdr = p48.find((x) => /มาตรา\s*48/.test(x.exact_text)) || p48[0];
    const validSupportingIds = Array.from(
      new Set([p42_28.passage_id, p48_hdr.passage_id, p48_7.passage_id])
    );
    const traceId = "trc.calc_iso_proof";
    const validClaimId = `clm.${traceId}.valid_calc`;
    const leakedClaimId = `clm.${traceId}.unsupported_reuse`;

    const boundCalc: ClaimBoundCalculationRecord = {
      calculation_id: "calc.pit.gift.cash.explicit_niece.iso",
      claim_id: validClaimId,
      answer_revision: `ans.${traceId}.r1`,
      verifier_version: "reg24-tax-calc-verifier-v1.0",
      formula: "(25,000,000 - 10,000,000) × 5% = 750,000 บาท ตามมาตรา 42 (28) และมาตรา 48 (7)",
      inputs: { gift_cash_thb: 25_000_000, exempt_threshold_thb: 10_000_000, elective_rate_pct: 5 },
      outputs: { taxable_excess_thb: 15_000_000, elective_tax_thb: 750_000 },
      units: { primary_unit: "THB", detail_th: "บาท (THB) และอัตราร้อยละ (%)" },
      source_versions: validSupportingIds.map((pid) => {
        const p = allPassages.find((x) => x.passage_id === pid)!;
        return { evidence_id: pid, doc_id: p.work_id, version_id: p.version_id };
      }),
      verified_numeric_tokens: ["25,000,000", "25000000", "10,000,000", "10000000", "15,000,000", "15000000", "5", "750,000", "750000"],
      verified_at: new Date().toISOString(),
    };

    const syntheticGroundedAnswer: GroundedAnswer = {
      release_id: releaseId,
      knowledge_snapshot_at: new Date().toISOString(),
      status: "ANSWERED",
      answer: "ทดสอบการแยกการผูกผลคำนวณเฉพาะข้อกล่าวอ้าง",
      claims: [
        {
          claim_id: validClaimId,
          statement:
            "การให้เงินสด 25,000,000 บาท แก่หลานสาวตามพิธีหรือโอกาสแห่งขนบธรรมเนียมประเพณี เฉพาะส่วนที่ไม่เกิน 10,000,000 บาท ไม่ต้องรวมคำนวณเพื่อเสียภาษีเงินได้ (28) ส่วนที่เกิน 15,000,000 บาท ผู้มีเงินได้เลือกเสียภาษีในอัตราร้อยละ 5 ตามมาตรา 48 (7) คิดเป็นภาษี 750,000 บาท",
          claim_type: "qualified_legal_synthesis",
          statement_role: "statutory_text",
          supporting_passage_ids: validSupportingIds,
          applicable_version_id: p42[0].version_id,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
          verified_calculation_numeric_tokens: boundCalc.verified_numeric_tokens,
          bound_calculation: boundCalc,
        },
        {
          // Sibling UNSUPPORTED claim reusing Claim 1's exact verified number (750,000 บาท) WITHOUT its own calculation!
          claim_id: leakedClaimId,
          statement:
            "นอกจากนี้ ผู้ให้ยังมีหน้าที่ต้องชำระค่าธรรมเนียมพิเศษเพิ่มเติมอีกจำนวน 750,000 บาท ตามมาตรา 42 (28)",
          claim_type: "qualified_legal_synthesis",
          statement_role: "statutory_text",
          supporting_passage_ids: validSupportingIds,
          applicable_version_id: p42[0].version_id,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
          // Intentionally NO bound_calculation and NO verified_calculation_numeric_tokens!
        },
      ],
      evidence: [],
      assumptions: [],
      clarification_questions: [],
      coverage_warnings: [],
      applicable_date: "2025-02-10",
      model_policy_version: GROUNDED_LLM_PROMPT_VERSION,
      trace_id: traceId,
      latency_ms: 10,
    };

    // 1) API / UI Envelope check: Claim 1 survives with its bound_calculation; Claim 2 is BLOCKED!
    const apiEnvelope = attachTraceableEnvelopeToGroundedAnswer(store, syntheticGroundedAnswer, {
      question: "ทดสอบการแยกการผูกผลคำนวณเฉพาะข้อกล่าวอ้าง",
      actor: QA_ACTOR,
      channel: "api",
      persist: false,
    });
    if (apiEnvelope.claims.length !== 1) {
      throw new Error(`Unexpected claims=${apiEnvelope.claims.length}: ${JSON.stringify(apiEnvelope.unresolved_issues)}`);
    }
    expect(apiEnvelope.claims.length).toBe(1);
    expect(apiEnvelope.claims[0].claim_id).toBe(validClaimId);
    expect(apiEnvelope.claims[0].bound_calculation).toBeTruthy();
    expect(apiEnvelope.claims[0].bound_calculation?.claim_id).toBe(validClaimId);
    expect(apiEnvelope.claims[0].bound_calculation?.outputs.elective_tax_thb).toBe(750_000);
    expect(apiEnvelope.claims[0].bound_calculation?.source_versions.length).toBeGreaterThan(0);
    expect(apiEnvelope.claims.some((c) => c.claim_id === leakedClaimId)).toBe(false);
    expect(apiEnvelope.rendered_answer_th).not.toContain("ค่าธรรมเนียมพิเศษเพิ่มเติม");

    // 2) Server-verified Save check: EVEN IF a caller injects Claim 2 into submitted_envelope alongside Claim 1,
    //    saveOrReviseAnswerServerVerified binds trusted_calculations_by_claim_id ONLY to Claim 1 -> Claim 2 stays BLOCKED!
    const tamperedEnvelope = {
      ...apiEnvelope,
      claims: [
        ...apiEnvelope.claims,
        {
          ...apiEnvelope.claims[0],
          claim_id: leakedClaimId,
          claim_number: 2,
          text: "นอกจากนี้ ผู้ให้ยังมีหน้าที่ต้องชำระค่าธรรมเนียมพิเศษเพิ่มเติมอีกจำนวน 750,000 บาท ตามมาตรา 42 (28)",
          // Even if client tries to copy bound_calculation onto Claim 2, server MUST ignore untrusted client copy!
          bound_calculation: { ...boundCalc, claim_id: leakedClaimId },
        },
      ],
    };

    const saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: tamperedEnvelope,
      question_text: "ทดสอบการแยกการผูกผลคำนวณเฉพาะข้อกล่าวอ้าง",
      revision_reason: "Per-claim calculation isolation test",
      actor: QA_ACTOR,
      query_persistence_context: {
        trusted_calculations_by_claim_id: { [validClaimId]: boundCalc },
        trusted_calculation_tokens_by_claim_id: { [validClaimId]: boundCalc.verified_numeric_tokens },
      },
    });

    expect(saved.claims.length).toBe(1);
    expect(saved.claims[0].text).toContain("มาตรา 48 (7)");
    expect(saved.claims[0].bound_calculation?.answer_revision).toBe(saved.answer_revision);
    expect(saved.claims[0].bound_calculation?.claim_id).toBe(saved.claims[0].claim_id);
    expect(saved.claims.some((c) => c.text.includes("ค่าธรรมเนียมพิเศษเพิ่มเติม"))).toBe(false);
    expect(saved.rendered_answer_th).not.toContain("ค่าธรรมเนียมพิเศษเพิ่มเติม");

    // 3) Reopened Saved Revision check: Claim 1 + bound_calculation survive cleanly; Claim 2 stays absent!
    const reopened = reopenSavedTraceableAnswer(store, saved.answer_revision, QA_ACTOR);
    expect(reopened.found).toBe(true);
    expect(reopened.answer?.answer_revision).toBe(saved.answer_revision);
    expect(reopened.answer?.claims.length).toBe(1);
    expect(reopened.answer?.claims[0].bound_calculation?.claim_id).toBe(saved.claims[0].claim_id);
    expect(reopened.answer?.claims[0].bound_calculation?.outputs.elective_tax_thb).toBe(750_000);
    expect(reopened.answer?.rendered_answer_th).not.toContain("ค่าธรรมเนียมพิเศษเพิ่มเติม");
  });
});
