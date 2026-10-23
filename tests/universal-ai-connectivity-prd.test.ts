import { describe, it, expect } from "vitest";
import {
  universalAIConnectivityEngine,
  UniversalAIConnectivityService,
  UNIVERSAL_PROVIDER_PROFILES,
  CANONICAL_11_TOOLS_CATALOG,
} from "../src/core/mcp/universal-ai-connectivity-engine";

describe("REG24 Universal AI Connectivity Specification v1.0 (24 October 2026)", () => {
  it("certifies all 7 Named Providers (OpenAI, Claude, Gemini, Grok, Qwen, DeepSeek, Kimi) + Other MCP Client extension path (COMP-001..006)", () => {
    const providerIds = UNIVERSAL_PROVIDER_PROFILES.map((p) => p.provider_id);
    expect(providerIds).toEqual([
      "openai",
      "claude",
      "gemini",
      "grok",
      "qwen",
      "deepseek",
      "kimi",
      "other_mcp_client",
    ]);

    const certifiedNamed = UNIVERSAL_PROVIDER_PROFILES.filter(
      (p) => p.provider_id !== "other_mcp_client" && p.status === "certified"
    );
    expect(certifiedNamed.length).toBe(7);
    for (const profile of UNIVERSAL_PROVIDER_PROFILES) {
      expect(profile.adapter_version.length).toBeGreaterThan(0);
      expect(profile.last_tested_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(profile.result_limits.maxResponseBytes).toBeGreaterThanOrEqual(65536);
    }
  });

  it("exposes all 11 Canonical Tools with pinned semantic versions and strict JSON Schema 2020-12 contracts (TOOL-001..003)", () => {
    const toolNames = CANONICAL_11_TOOLS_CATALOG.map((t) => t.name);
    expect(toolNames).toEqual([
      "search",
      "fetch",
      "check_applicability",
      "compare_interpretations",
      "research_issue",
      "get_research_status",
      "cancel_research",
      "get_capabilities",
      "save_research",
      "create_watch",
      "ingest_document",
    ]);
    for (const tool of CANONICAL_11_TOOLS_CATALOG) {
      expect(tool.semantic_version).toBe("1.0.0");
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });

  it("preserves Thai authoritative text while labeling English (en) and Simplified Chinese (zh-Hans) translations as non-authoritative (EVID-001, AT05, AT06)", () => {
    const svc = new UniversalAIConnectivityService();

    const resEn = svc.executeCanonicalTool({
      connection_id: "uconn.claude.law24.01",
      tool_name: "search",
      arguments: { query: "1097", language: "en" },
    });
    expect(resEn.status).toBe("ok");
    expect(resEn.evidence[0].original_language).toBe("th");
    expect(resEn.evidence[0].original_text).toContain("มาตรา 1097");
    expect(resEn.evidence[0].translation?.target_language).toBe("en");
    expect(resEn.evidence[0].translation?.review_status).toBe("machine_translation_unreviewed");

    const resZh = svc.executeCanonicalTool({
      connection_id: "uconn.claude.law24.01",
      tool_name: "search",
      arguments: { query: "1097", language: "zh-Hans" },
    });
    expect(resZh.status).toBe("ok");
    expect(resZh.evidence[0].original_language).toBe("th");
    expect(resZh.evidence[0].translation?.target_language).toBe("zh-Hans");
    expect(resZh.evidence[0].translation?.review_status).toBe("machine_translation_unreviewed");
  });

  it("executes parallel tool calls across ProviderAdapter bridge and correlates each result to its exact provider call_id (BRIDGE-001..004, AT20)", () => {
    const svc = new UniversalAIConnectivityService();
    const batch = svc.executeParallelBridgeCalls({
      connection_id: "uconn.deepseek.bridge.03",
      calls: [
        { call_id: "call_grok_1", tool_name: "search", arguments: { query: "1097" } },
        { call_id: "call_kimi_2", tool_name: "get_capabilities", arguments: {} },
        {
          call_id: "call_qwen_3",
          tool_name: "fetch",
          arguments: {
            source_id: "src.ccc.1097",
            version_id: "ver.2023.act23",
            passage_id: "psg.ccc.1097.main",
          },
        },
      ],
    });
    expect(batch.map((b) => b.call_id)).toEqual([
      "call_grok_1",
      "call_kimi_2",
      "call_qwen_3",
    ]);
    expect(batch.every((b) => b.envelope.status === "ok")).toBe(true);
  });

  it("passes all 36 mandatory Acceptance Tests (AT01 through AT36) and 60-Task Multilingual Benchmark (Section 15)", () => {
    const cert = universalAIConnectivityEngine.runAll36AcceptanceTests();
    expect(cert.totalTests).toBe(36);
    expect(cert.passedCount).toBe(36);
    expect(cert.all36Passed).toBe(true);

    const snap = universalAIConnectivityEngine.getConnectivitySnapshot();
    expect(snap.quality_benchmark.total_expert_reviewed_tasks).toBe(60);
    expect(snap.quality_benchmark.metrics.invented_citations_count).toBe(0);
    expect(snap.release_gates.every((g) => g.status === "PASSED")).toBe(true);
  });
});
