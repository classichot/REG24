/**
 * REG24 — Advanced Legal Intelligence & Execution Infrastructure API
 * Developer PRD v1.0 (REG-AI-01 through REG-AI-12, Section 6 Orchestrator, Section 7.1/7.3 Contract & Section 14 UAT A-G)
 *
 * GET  /api/v1/legal/intelligence?uat_scenario_id=TEST_A_HISTORICAL_ANALYSIS&scenario_pair_id=SHARE_VS_ASSET_ACQUISITION
 * POST /api/v1/legal/intelligence { action: "run_uat_scenario" | "evaluate_rule_as_code" | "compare_scenarios" }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  advancedLegalIntelligenceEngine,
  MandatoryUatScenarioId,
} from "@/core/intelligence/advanced-legal-intelligence-engine";

export async function GET(req: NextRequest) {
  const uatId = (req.nextUrl.searchParams.get("uat_scenario_id") ||
    "TEST_A_HISTORICAL_ANALYSIS") as MandatoryUatScenarioId;
  const scenarioPairId =
    req.nextUrl.searchParams.get("scenario_pair_id") || "SHARE_VS_ASSET_ACQUISITION";

  const analysis = advancedLegalIntelligenceEngine.executeUatScenarioOrOrchestration({
    uat_scenario_id: uatId,
  });

  return NextResponse.json({
    status: "ok",
    prd_version: "1.0",
    positioning: "REG24 — Legal Intelligence & Execution Infrastructure for Enterprise AI",
    fundamental_principle:
      "REG24 strictly distinguishes between LEGAL_INFORMATION, LEGAL_INTERPRETATION, EXECUTABLE_LEGAL_RULE, and AUTHORIZED_LEGAL_ACTION.",
    three_pillars: [
      {
        pillar_id: "LEGAL_KNOWLEDGE_ENGINE",
        title_en: "Legal Knowledge Engine",
        title_th: "เอนจินความรู้กฎหมาย (Find, Connect, Version & Verify)",
        technologies: ["REG-AI-01", "REG-AI-03", "REG-AI-05", "REG-AI-08"],
      },
      {
        pillar_id: "LEGAL_DECISION_ENGINE",
        title_en: "Legal Decision Engine",
        title_th: "เอนจินวินิจฉัยและตัดสินใจทางกฎหมาย (Applicability, Rules-as-Code, Authority & Scenarios)",
        technologies: ["REG-AI-02", "REG-AI-04", "REG-AI-06", "REG-AI-09", "REG-AI-10"],
      },
      {
        pillar_id: "LEGAL_EXECUTION_ENGINE",
        title_en: "Legal Execution Engine",
        title_th: "เอนจินปฏิบัติการและกำกับดูแลองค์กร (Change Impact, 6-Agent Verification & QA Gates)",
        technologies: ["REG-AI-07", "REG-AI-11", "REG-AI-12"],
      },
    ],
    twelve_technologies: advancedLegalIntelligenceEngine.getTwelveTechnologiesCatalog(),
    rules_as_code_registry: advancedLegalIntelligenceEngine.getRulesAsCodeRegistry(),
    scenario_comparison: advancedLegalIntelligenceEngine.getScenarioComparison(scenarioPairId),
    evaluation_qa_dashboard: advancedLegalIntelligenceEngine.getContinuousEvaluationDashboard(),
    universal_analysis_response: analysis,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "run_uat_scenario");

    if (action === "evaluate_rule_as_code") {
      const ruleId = String(body.rule_id || "rac.th.corp.ccc1097.promoters.v2023");
      const verifiedFacts = (body.verified_facts || {}) as Record<string, unknown>;
      const llmInferredFacts = (body.llm_inferred_facts || {}) as Record<string, unknown>;
      const result = advancedLegalIntelligenceEngine.evaluateRuleAsCode(
        ruleId,
        verifiedFacts,
        llmInferredFacts
      );
      return NextResponse.json({
        status: "ok",
        action,
        rule_execution: result,
      });
    }

    if (action === "compare_scenarios") {
      const pairId = String(body.scenario_pair_id || "SHARE_VS_ASSET_ACQUISITION");
      const comparison = advancedLegalIntelligenceEngine.getScenarioComparison(pairId);
      return NextResponse.json({
        status: "ok",
        action,
        scenario_comparison: comparison,
      });
    }

    const uatId = (body.uat_scenario_id ||
      "TEST_A_HISTORICAL_ANALYSIS") as MandatoryUatScenarioId;
    const analysis = advancedLegalIntelligenceEngine.executeUatScenarioOrOrchestration({
      uat_scenario_id: uatId,
      query: body.query ? String(body.query) : undefined,
      legal_as_of: body.legal_as_of ? String(body.legal_as_of) : undefined,
      tenant_id: body.tenant_id ? String(body.tenant_id) : undefined,
    });

    return NextResponse.json({
      status: "ok",
      action: "run_uat_scenario",
      universal_analysis_response: analysis,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Invalid legal intelligence request",
      },
      { status: 400 }
    );
  }
}
