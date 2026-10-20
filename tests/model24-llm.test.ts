import { describe, it, expect, beforeEach } from "vitest";
import {
  Model24OrchestrationEngine,
  TASK_ROUTING_POLICIES,
  THAI_LEGAL_BENCHMARK_1000_ALLOCATION,
} from "../src/core/llm/model24-engine";

describe("REG24-INFRA-LLM-001: Model24 Intelligent LLM Integration & Model Routing Engine", () => {
  let engine: Model24OrchestrationEngine;

  beforeEach(() => {
    engine = new Model24OrchestrationEngine();
  });

  it("REG-LLM-01: supports 3+ LLM providers, private sovereign model, separate embedding/reranker models, and runtime model registration", () => {
    const models = engine.getModelRegistry();
    const providers = new Set(models.map((m) => m.provider));
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("google")).toBe(true);
    expect(providers.has("private_self_hosted")).toBe(true);

    // Separate embedding and reranker models
    const embeddingModels = models.filter((m) => m.tier === "embedding");
    const rerankerModels = models.filter((m) => m.tier === "reranker");
    expect(embeddingModels.length).toBeGreaterThanOrEqual(1);
    expect(rerankerModels.length).toBeGreaterThanOrEqual(1);

    // Runtime model registration without rewriting business logic
    engine.registerModel({
      ...models[0],
      model_id: "openai/gpt-6.2-legal-preview",
      display_name: "GPT-6.2 Legal Preview",
    });
    expect(
      engine.getModelRegistry().some((m) => m.model_id === "openai/gpt-6.2-legal-preview")
    ).toBe(true);
  });

  it("REG-LLM-02: classifies all 13 legal tasks, applies hard eligibility gates (500-page book context window), and routes dynamically", () => {
    expect(Object.keys(TASK_ROUTING_POLICIES).length).toBe(13);

    // 1. Search legislation -> structured extraction
    const legTask = engine.classifyLegalTask(
      "Extract section 65 bis of the Revenue Code (สกัดมาตรา 65 ทวิ)"
    );
    expect(legTask.task_type).toBe("thai_legislation_extraction");

    // 2. Complex tax restructuring -> frontier reasoning + cross-provider review
    const taxDecision = engine.routeTaskToModels({
      task_type: "tax_planning_restructuring",
    });
    expect(taxDecision.selected_primary.tier).toBe("premium_reasoning");
    expect(taxDecision.selected_independent_reviewer).not.toBeNull();
    expect(taxDecision.selected_independent_reviewer?.provider).not.toBe(
      taxDecision.selected_primary.provider
    );

    // 3. 500-page legal book -> requires >= 500,000 token context window (selects Gemini 4 Argon / 3.8 Flash)
    const bookDecision = engine.routeTaskToModels({
      task_type: "analyzing_large_legal_textbooks",
      required_context_tokens: 650_000,
    });
    expect(bookDecision.selected_primary.context_window_tokens).toBeGreaterThanOrEqual(500_000);
  });

  it("REG-LLM-02 & REG-LLM-06: supports runtime admin policy updates and automatic provider outage failover with confidentiality gates", () => {
    const initialDecision = engine.routeTaskToModels({
      task_type: "tax_planning_restructuring",
    });
    const initialProvider = initialDecision.selected_primary.provider;

    // Simulate outage of the primary provider
    const failoverDecision = engine.routeTaskToModels({
      task_type: "tax_planning_restructuring",
      simulated_outage_providers: [initialProvider],
    });
    expect(failoverDecision.selected_primary.provider).not.toBe(initialProvider);
    expect(
      failoverDecision.fallback_events.some((e) => e.outcome === "failed_over_outage")
    ).toBe(true);

    // Runtime policy update by Platform Administrator
    const updatedPolicy = engine.updateControlPolicy(
      { optimization_priority: "lowest_cost_meeting_threshold" },
      "Platform Administrator"
    );
    expect(updatedPolicy.optimization_priority).toBe("lowest_cost_meeting_threshold");

    // Enforce Thailand-only sovereign jurisdiction -> routes to Typhoon Legal TH 70B
    const sovereignDecision = engine.routeTaskToModels({
      task_type: "thai_legislation_extraction",
      required_jurisdiction: "TH",
    });
    expect(sovereignDecision.selected_primary.provider).toBe("private_self_hosted");
  });

  it("REG-LLM-04: defines the 1,000-case Thai Legal Benchmark across all 8 required legal domains", () => {
    const snapshot = engine.getDashboardSnapshot();
    expect(snapshot.benchmark_1000_suite.total_target_cases).toBe(1000);
    expect(THAI_LEGAL_BENCHMARK_1000_ALLOCATION.length).toBe(8);

    const sum = THAI_LEGAL_BENCHMARK_1000_ALLOCATION.reduce(
      (acc, d) => acc + d.allocated_cases,
      0
    );
    expect(sum).toBe(1000);
  });

  it("REG-LLM-05, REG-LLM-06 & REG-LLM-07: executes end-to-end orchestration, strips fabricated citations, redacts Thai PII, and records trace/cost", () => {
    const response = engine.executeLegalLLMTaskSync({
      query:
        "วิเคราะห์แผนควบรวมกิจการ (EBT) ของผู้เสียภาษีเลขประจำตัวประชาชน 1100400592831 อีเมล cfo@company.co.th ตามมาตรา 74 แห่งประมวลรัษฎากร",
      task_type: "tax_planning_restructuring",
      data_sensitivity: "PRIVILEGED_LEGAL_OPINION",
      candidate_citations_to_verify: [
        "prov.th.rc.73_74_77_1",
        "prov.th.fake.space_tax.999",
      ],
    });

    // Security & PDPA Redaction (REG-LLM-06)
    expect(response.trace.pii_redacted_before_dispatch).toBe(true);
    expect(response.trace.redacted_fields).toContain("thai_national_id_13_digit");
    expect(response.trace.redacted_fields).toContain("email_address");

    // 6-Point Citation Verification Gate (REG-LLM-05): Zero unverified citations allowed in published output
    expect(response.published_citations.length).toBe(1);
    expect(response.trace.verification_results.rejected_unverified_citations).toContain(
      "prov.th.fake.space_tax.999"
    );
    expect(response.trace.verification_results.all_published_citations_verified).toBe(true);

    // Multi-Model Cross-Provider Review (REG-LLM-03)
    expect(response.trace.independent_review.triggered).toBe(true);
    expect(response.trace.independent_review.primary_provider).not.toBe(
      response.trace.independent_review.reviewer_provider
    );

    // Trace & Cost Attribution (REG-LLM-07)
    expect(response.trace.trace_id).toMatch(/^trace\.model24\./);
    expect(response.trace.token_usage_latency_cost.estimated_cost_usd).toBeGreaterThan(0);
  });
});
