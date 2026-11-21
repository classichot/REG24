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

  it("1. Model-specific thinking_level adapter defaults Neon explicitly to 'low' (RC10.3 P0-3), never sends 'minimal' to Neon, and keeps OpenAI challenger explicit-only", () => {
    // Primary staging default resolves to gemini-4-neon
    const prevModel = process.env.REG24_GROUNDED_LLM_MODEL;
    const prevProv = process.env.REG24_GROUNDED_LLM_PROVIDER;
    delete process.env.REG24_GROUNDED_LLM_MODEL;
    delete process.env.REG24_GROUNDED_LLM_PROVIDER;
    try {
      const def = resolveConfiguredProviderAndModel();
      expect(def.provider).toBe("google-gemini");
      expect(def.requestedModel).toBe("gemini-4-neon");

      // Neon defaults explicitly to low (RC10.3 P0-3) and gets 16384 max_output_tokens so reasoning never truncates JSON
      const neonDefault = resolveThinkingLevelForModel("gemini-4-neon");
      expect(neonDefault.thinking_level).toBe("low");
      expect(neonDefault.max_output_tokens).toBeGreaterThanOrEqual(16384);

      // Even if someone passes "minimal", Neon NEVER receives "minimal"!
      const neonGuard = resolveThinkingLevelForModel("gemini-4-neon", "minimal");
      expect(neonGuard.thinking_level).not.toBe("minimal");
      expect(neonGuard.thinking_level).toBe("low");
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

  it("4) RC9.1 Neon Postgres persistence accepts link_health='unchecked_live' and round-trips execution_provenance + bound_calculation on cold-start reopen", async () => {
    const {
      loadSavedAnswerFromPostgres,
      persistAnswerRevisionToPostgres,
      setCustomCitationDbTransportForTesting,
    } = await import("../../src/core/knowledge/citation-postgres-store");

    const ALLOWED_LINK_HEALTH = new Set([
      "verified_online",
      "unchecked_live",
      "temporarily_offline",
      "moved_verified",
      "quarantined_identity_failure",
    ]);
    const savedRows: {
      location?: Record<string, unknown>;
      answer?: Record<string, unknown>;
      claims: Record<string, unknown>[];
      links: Record<string, unknown>[];
    } = { claims: [], links: [] };

    const parseJson = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

    setCustomCitationDbTransportForTesting(async <T = Record<string, unknown>>(query: string, params: unknown[] = []) => {
      const q = query.trim();
      if (q.startsWith("INSERT INTO citation_official_location")) {
        const lh = String(params[14]);
        if (!ALLOWED_LINK_HEALTH.has(lh)) {
          throw new Error(
            `NEON_CITATION_SQL_HTTP_400: violates check constraint "citation_official_location_link_health_check" (${lh})`
          );
        }
        savedRows.location = { doc_id: params[1], link_health: lh, last_successful_verified_at: params[11] };
        return { rows: [] as T[], rowCount: 1 };
      }
      if (q.startsWith("INSERT INTO citation_published_answer")) {
        savedRows.answer = {
          answer_revision_id: params[0],
          answer_id: params[1],
          revision_number: params[2],
          supersedes_revision_id: params[3],
          channel: params[4],
          question_text: params[5],
          generated_at: params[6],
          as_of_date_raw: params[8],
          status: params[9],
          rendered_answer_th: params[10],
          ordered_claim_ids: parseJson(params[11]),
          unresolved_issues: parseJson(params[12]),
          user_supplied_facts: parseJson(params[13]),
          assumptions: parseJson(params[14]),
          legacy_warning_th: params[15],
          release_id: params[16],
          verifier_version: params[17],
          ruleset_version: params[18],
          owner_actor_id: params[19],
          owner_tenant_id: params[20],
          actor_id: params[21],
          tenant_id: params[22],
          revision_reason: params[23],
          execution_provenance: parseJson(params[25]),
        };
        return { rows: [] as T[], rowCount: 1 };
      }
      if (q.startsWith("INSERT INTO citation_atomic_claim")) {
        savedRows.claims.push({
          claim_id: params[0],
          answer_revision_id: params[1],
          display_order: params[2],
          displayed_claim_text: params[3],
          claim_type: params[4],
          premise_claim_ids: parseJson(params[5]),
          verification_decision: params[6],
          published: params[8],
          withheld_reason_th: params[9],
          bound_calculation: parseJson(params[12]),
        });
        return { rows: [] as T[], rowCount: 1 };
      }
      if (q.startsWith("INSERT INTO citation_claim_evidence_link")) {
        savedRows.links.push({
          link_id: params[0],
          claim_id: params[2],
          passage_id: params[3],
          version_id: params[4],
          support_role: params[5],
          required_group: params[6],
          citation_label_th: params[7],
          official_url: params[8],
          resolver_url: params[9],
          human_pinpoint_th: params[10],
          doc_id: "doc.test.rc9",
          extraction_revision_id: "ext.test.rc9",
          section_paragraph_path: ["มาตรา 42 (28)"],
          physical_page_start: 1,
          physical_page_end: 1,
          printed_page_start: "1",
          printed_page_end: "1",
          anchors: [],
          access_scope: "scope.platform.public",
          issuer_id: "reg.th.rd",
          source_family: "gazette_enactment",
          record_type: "full_record",
          access_permission: "public",
          access_conditions_th: null,
          effective_from: "2016-02-01",
          publication_date: "2015-08-05",
          link_health: savedRows.location?.link_health ?? "unchecked_live",
          last_successful_verified_at: null,
        });
        return { rows: [] as T[], rowCount: 1 };
      }
      if (q.startsWith("SELECT answer_revision_id, answer_id, revision_number, supersedes_revision_id,")) {
        return { rows: (savedRows.answer ? [savedRows.answer] : []) as T[], rowCount: savedRows.answer ? 1 : 0 };
      }
      if (q.startsWith("SELECT answer_revision_id, revision_number, supersedes_revision_id,")) {
        return { rows: (savedRows.answer ? [savedRows.answer] : []) as T[], rowCount: savedRows.answer ? 1 : 0 };
      }
      if (q.startsWith("SELECT claim_id, display_order, displayed_claim_text,")) {
        return { rows: savedRows.claims as T[], rowCount: savedRows.claims.length };
      }
      if (q.includes("FROM citation_claim_evidence_link l")) {
        return { rows: savedRows.links as T[], rowCount: savedRows.links.length };
      }
      return { rows: [] as T[], rowCount: 0 };
    });

    try {
      const boundCalc: ClaimBoundCalculationRecord = {
        calculation_id: "calc.pg.roundtrip.1",
        claim_id: "clm.pg.1",
        answer_revision: "ans.pg.rc9.r1",
        verifier_version: "reg24-tax-calc-verifier-v1.0",
        formula: "elective_tax_5pct = (25,000,000 - 10,000,000) * 5% = 750,000 THB",
        inputs: { gift_amount_thb: 25_000_000, exemption_thb: 10_000_000 },
        outputs: { elective_tax_thb: 750_000 },
        units: { primary_unit: "THB", detail_th: "บาท" },
        source_versions: [{ evidence_id: "psg.test.rc9", doc_id: "doc.test.rc9", version_id: "ver.test.rc9" }],
        verified_numeric_tokens: ["750000"],
        verified_at: new Date().toISOString(),
      };
      const execProv = {
        git_commit_sha: "b4b1f585764d564a877547bd446d7535fa8e467a",
        release_id: "rel.B01.rc6",
        manifest_id: "mfst.b01.rc6_core_auth",
        manifest_hash: "c539710fa3804b05f5e47729977b085993a5b5e5c109003ed71a24a7d8621ed5",
        model_id: "google-gemini:gemini-4-neon",
        model_policy_version: GROUNDED_LLM_PROMPT_VERSION,
        claim_verifier_version: "reg24-claim-verifier-v2.1",
        calculation_verifier_version: "reg24-tax-calc-verifier-v1.0",
        ruleset_version: "th-official-traceability-2026.11.2",
        query_kind: "LEGAL_FACT_APPLICATION" as const,
        generation_mode: "llm_grounded" as const,
        configuration: {
          store_topology_mode: "ephemeral_serverless_tmp" as const,
          hierarchy_of_authority_retrieval: true,
          separate_calculation_verification: true,
          negated_fact_stripping_enabled: true,
          tax_foundation_pilot_enabled: false,
          grounded_llm_staging_enabled: true,
          template_fallback_disabled: true,
        },
        provider_invocation: {
          provider: "google-gemini" as const,
          api_surface: "interactions-v1beta" as const,
          requested_model: "gemini-4-neon",
          resolved_model: "gemini-4-neon",
          actual_model_invoked: "gemini-4-neon",
          pinned_settings: {
            thinking_level: "low" as const,
            thinking_level_note: null,
            temperature: 0,
            max_output_tokens: 16384,
            timeout_ms: 120000,
            store: false as const,
          },
          prompt_version: GROUNDED_LLM_PROMPT_VERSION,
          live_provider_called: true,
          silent_fallback_disabled: true,
          provider_interaction_id: null,
          provider_response_status: "completed" as const,
          failure_classification: "NONE" as const,
          latency_ms: 30871,
          input_tokens: 20374,
          output_tokens: 1925,
          thought_tokens: 1629,
          total_tokens: 23928,
          estimated_cost_usd: 0.061,
          attempts: [],
          error_summary: null,
        },
      };

      await persistAnswerRevisionToPostgres({
        envelope: {
          schema_version: "reg24.citation-traceability.v1",
          answer_id: "ans.pg.rc9",
          answer_revision: "ans.pg.rc9.r1",
          revision_number: 1,
          supersedes_answer_revision: null,
          channel: "chat",
          generated_at: new Date().toISOString(),
          as_of_date: "2026-09-30",
          status: "complete",
          rendered_answer_th: "คำตอบที่บันทึกไว้",
          user_supplied_facts: [],
          assumptions: [],
          execution_provenance: execProv,
          claims: [
            {
              claim_id: "clm.pg.1",
              claim_number: 1,
              text: "ภาษี 750,000 บาท",
              claim_type: "interpretation",
              claim_type_label_th: "การปรับใช้ข้อกฎหมาย",
              premise_ids: [],
              verification_decision: "supported",
              published: true,
              withheld_explanation_th: null,
              bound_calculation: boundCalc,
              evidence_references: [
                {
                  link_id: "lnk.pg.1",
                  evidence_id: "psg.test.rc9",
                  doc_id: "doc.test.rc9",
                  version_id: "ver.test.rc9",
                  extraction_revision_id: "ext.test.rc9",
                  support_role: "primary_authority",
                  support_role_label_th: "หลักฐานกฎหมายหลัก",
                  required_group: "grp.1",
                  citation_label_th: "ประมวลรัษฎากร มาตรา 42 (28)",
                  issuer_name_th: "กรมสรรพากร",
                  source_family: "gazette_enactment",
                  source_family_label_th: "กฎหมาย",
                  record_type: "full_record",
                  record_type_label_th: "เอกสารฉบับเต็มทางการ",
                  date_relied_on: "2026-09-30",
                  official_url: "https://www.rd.go.th/5937.html",
                  official_url_with_anchor: "https://www.rd.go.th/5937.html",
                  resolver_url: "/api/v1/knowledge/evidence/psg.test.rc9",
                  locator: {
                    human_pinpoint_th: "มาตรา 42 (28)",
                    section_paragraph_path: ["มาตรา 42 (28)"],
                    physical_page_start: 1,
                    physical_page_end: 1,
                    printed_page_start: "1",
                    printed_page_end: "1",
                    anchors: [],
                  },
                  verification_status: "supported",
                  link_health: "unchecked_live",
                  link_health_notice_th: null,
                  last_successful_verification_at: null,
                  access_permission: "public",
                  access_conditions_th: null,
                },
              ],
            },
          ],
          unresolved_issues: [],
          legacy_warning_th: null,
          verifier_metadata: {
            verifier_version: "reg24-claim-verifier-v2.1",
            ruleset_version: "th-official-traceability-2026.11.2",
            release_id: "rel.B01.rc6",
            publication_gate_mode: "enforced",
          },
        },
        question_text: "คำถามทดสอบ",
        owner_actor_id: QA_ACTOR.actor_id,
        owner_tenant_id: QA_ACTOR.tenant_id,
        actor: QA_ACTOR,
        revision_reason: "RC9.1 cold-start reopen provenance test",
        referenced_bundles: [
          {
            doc: {
              doc_id: "doc.test.rc9",
              source_family: "gazette_enactment",
              issuer_id: "reg.th.rd",
              source_native_id: "มาตรา 42 (28)",
              reviewed_surrogate_id: null,
              is_reviewed_surrogate: false,
              original_title_th: "ประมวลรัษฎากร มาตรา 42 (28)",
              language: "th",
              record_type: "full_record",
              access_permission: "public",
              preservation_permission: "retained_artifact_permitted",
              access_scope: "scope.platform.public",
              access_conditions_th: null,
              eligible_for_citation: true,
              ineligible_reason: null,
              canonical_work_id: "work.test.rc9",
              owner_batch_id: "B01",
              created_at: new Date().toISOString(),
            },
            version: {
              version_id: "ver.test.rc9",
              doc_id: "doc.test.rc9",
              artifact_sha256: "a".repeat(64),
              captured_at: new Date().toISOString(),
              artifact_ref: "mem://test",
              mime_type: "text/plain",
              byte_size: 100,
              source_metadata: {},
              publication_date: "2015-08-05",
              publication_date_status: "known",
              effective_from: "2016-02-01",
              effective_to: null,
              effective_date_status: "open_ended",
              applicability_rules_th: [],
              affected_provisions: [],
              predecessor_version_id: null,
              amending_version_ids: [],
              byte_change_classification: "initial_capture",
              canonical_version_id: null,
              created_at: new Date().toISOString(),
            },
            location: {
              location_id: "oloc.test.rc9",
              doc_id: "doc.test.rc9",
              version_id: "ver.test.rc9",
              exact_official_url: "https://www.rd.go.th/5937.html",
              role: "primary_official",
              parent_landing_location_id: null,
              original_observed_url: "https://www.rd.go.th/5937.html",
              redirect_history: [],
              prior_urls: [],
              first_verified_at: null,
              last_verified_at: null,
              last_successful_verified_at: null,
              verification_method: "canonical_corpus_unchecked_live",
              identity_match_result: "VERIFIED_MATCH",
              link_health: "unchecked_live",
              last_http_status: null,
              failure_reason: null,
              is_active_primary: true,
            },
            extraction: {
              extraction_revision_id: "ext.test.rc9",
              version_id: "ver.test.rc9",
              parent_revision_id: null,
              parser_or_ocr_version: "v1",
              is_scanned_material: false,
              page_mapping: [],
              raw_transcription: "มาตรา 42 (28)",
              normalized_search_text: "มาตรา 42 (28)",
              alignment_map: [],
              ocr_ambiguity_detected: false,
              ocr_ambiguity_reasons: [],
              review_status: "VERIFIED_NATIVE",
              reviewer_id: null,
              reviewed_at: null,
              correction_note: null,
              created_at: new Date().toISOString(),
            },
            passages: [],
          },
        ],
      });

      const reloaded = await loadSavedAnswerFromPostgres("ans.pg.rc9.r1", QA_ACTOR);
      expect(reloaded.found).toBe(true);
      expect(reloaded.answer?.execution_provenance?.model_id).toBe("google-gemini:gemini-4-neon");
      expect(reloaded.answer?.execution_provenance?.provider_invocation?.resolved_model).toBe("gemini-4-neon");
      expect(
        (reloaded.answer?.execution_provenance?.provider_invocation?.pinned_settings as Record<string, unknown> | undefined)
          ?.thinking_level
      ).toBe("low");
      expect(reloaded.answer?.claims[0].bound_calculation?.outputs.elective_tax_thb).toBe(750_000);
      expect(reloaded.answer?.claims[0].evidence_references[0].link_health).toBe("unchecked_live");
    } finally {
      setCustomCitationDbTransportForTesting(null);
    }
  });
});
