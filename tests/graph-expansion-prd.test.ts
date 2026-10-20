import { describe, it, expect } from "vitest";
import {
  analyzeCrossModuleCorporateScenario,
  BENCHMARK_200_EVALUATION_DISTRIBUTION,
  getGraphExpansionPrdSnapshot,
  GRAPH_EXPANSION_ROADMAP_MILESTONES,
  INGESTION_15_STAGE_PIPELINE,
  MCP_12_EXTERNAL_AI_SERVICES,
  SOURCE_TRUST_CLASSIFICATION_MATRIX,
  STANDARDIZED_PRD_NODE_CLASSES,
  STANDARDIZED_PRD_RELATIONSHIP_SPECS,
  verifyLiveProductionGraphAudit,
} from "../src/core/graph/graph-expansion-prd";

describe("REG24 — Legal Knowledge Graph Infrastructure Expansion (DEV-001..DEV-028)", () => {
  it("DEV-001: verifies the 352-node graph programmatically with zero orphan nodes, zero duplicate IDs, and 100% provenance", async () => {
    const audit = await verifyLiveProductionGraphAudit();
    expect(audit.graph_inventory.total_nodes).toBe(352);
    expect(audit.graph_inventory.total_relationships).toBeGreaterThanOrEqual(412);
    expect(audit.data_integrity_audit.orphan_nodes_count).toBe(0);
    expect(audit.data_integrity_audit.duplicate_canonical_ids_count).toBe(0);
    expect(audit.data_integrity_audit.missing_provenance_records_count).toBe(0);
    expect(audit.data_integrity_audit.provenance_completeness_pct).toBe(100);
    expect(audit.graph_inventory.node_structural_granularity.arbitrary_unstructured_text_chunks).toBe(0);
    expect(audit.graphrag_active_in_legal_answers.verified).toBe(true);
  });

  it("DEV-003..010: enforces standardized 12 node classes, 16 semantic relationships, 15-stage ingestion pipeline, and L1–L5 source trust levels", () => {
    expect(STANDARDIZED_PRD_NODE_CLASSES.length).toBe(12);
    expect(STANDARDIZED_PRD_RELATIONSHIP_SPECS.length).toBe(16);
    expect(INGESTION_15_STAGE_PIPELINE.length).toBe(15);
    expect(SOURCE_TRUST_CLASSIFICATION_MATRIX.length).toBe(5);

    const l5 = SOURCE_TRUST_CLASSIFICATION_MATRIX.find((s) => s.level === "L5");
    expect(l5?.independent_legal_authority).toBe(false);
  });

  it("DEV-012: provides Cross-Module Intelligence distinguishing confirmed statutory requirements from transaction-specific facts", () => {
    const scenario = analyzeCrossModuleCorporateScenario();
    expect(scenario.participating_modules.length).toBe(6);
    expect(scenario.confirmed_legal_requirements.length).toBe(6);
    expect(
      scenario.matters_requiring_transaction_facts_or_professional_judgment.length
    ).toBeGreaterThanOrEqual(3);
  });

  it("DEV-013..024: defines the 352->10k->100k->500k+ expansion roadmap, 12 MCP services, 200-question benchmark, 9 P0 release gates, and 4-pillar Operations Dashboard", async () => {
    expect(GRAPH_EXPANSION_ROADMAP_MILESTONES.length).toBe(4);
    expect(MCP_12_EXTERNAL_AI_SERVICES.length).toBe(12);

    const totalBenchmarkQuestions = BENCHMARK_200_EVALUATION_DISTRIBUTION.reduce(
      (sum, d) => sum + d.question_count,
      0
    );
    expect(totalBenchmarkQuestions).toBe(200);

    const snapshot = await getGraphExpansionPrdSnapshot();
    expect(snapshot.dev_021_023_benchmark_and_quality_gates.p0_acceptance_gates.all_gates_passed).toBe(true);
    expect(snapshot.dev_024_operations_dashboard.quality.orphan_nodes).toBe(0);
    expect(snapshot.dev_024_operations_dashboard.coverage.laws_count).toBe(38);
  });
});
