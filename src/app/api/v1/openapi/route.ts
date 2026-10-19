import { NextResponse } from "next/server";
import { MCP_TOOLS_CATALOG } from "@/app/api/mcp/route";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "REG24 — Corporate & Commercial Legal Intelligence Infrastructure API (PRD v2.0)",
      version: "2.0.0",
      description:
        "Machine-readable Corporate & Commercial Legal Intelligence Infrastructure for Thailand (VIBE24 Ecosystem: LAW24, CFO24, ACC24, TP24, GMT24, ESG24, COP24, TRADE24, HOTEL24, DRUG24, RISK24). Implements the 7-Layer Architecture, 9 Core Legal Domains (LEG-*), 9 Industry Intelligence Modules (IND-*), 11-Step Graph RAG, Single/Team/Swarm Agents, Research Report Studio, and Section 24 Data Quality Gates.",
      contact: {
        name: "VIBE24 / REG24 Platform Engineering",
      },
    },
    servers: [
      {
        url: "/api",
        description: "Unified REG24 REST v1, MCP 2026 & A2A v1.0 Gateway",
      },
    ],
    paths: {
      "/v1/legal/search": {
        get: { summary: "Legal Search API (P0): Hybrid keyword, semantic, and exact statutory search" },
        post: { summary: "Legal Search API (P0): Retrieve verified legal documents and provisions" },
      },
      "/v1/legal/analyze": {
        get: { summary: "Legal Analysis API (P0): Answer source-grounded legal questions using Structured Answer Contract" },
        post: { summary: "Legal Analysis API (P0): Execute LEG-AI-01..10 Corporate & Commercial Legal Intelligence" },
      },
      "/v1/legal/citations/verify": {
        post: { summary: "Citation Verification API (P0): Deterministically validate statutory & case citations" },
      },
      "/v1/legal/graph/query": {
        get: { summary: "Legal Graph API (P0): Traverse 20-entity, 16-relationship Regulatory Knowledge Graph" },
        post: { summary: "Legal Graph API (P0): Execute 3R / 11-step Graph RAG traversal with AI-edge quarantine" },
      },
      "/v1/legal/documents/{id}": {
        get: { summary: "Source Metadata API (P0): Retrieve original document provenance, SHA-256 hash & Tier A–E reliability" },
      },
      "/v1/legal/provisions/{id}": {
        get: { summary: "Source Metadata API (P0): Retrieve provision, clause hierarchy, and point-in-time version" },
      },
      "/v1/modules": {
        get: { summary: "Module Registry API (P0): Discover 16 P0 legal modules, 9 Core Domains (LEG-*), and 9 Industry Modules (IND-*)" },
      },
      "/v1/modules/register": {
        post: { summary: "Module Registry API (P0): Register a new Industry Intelligence Module (IND-*) or Legal Domain Module" },
      },
      "/v1/industry/analyze": {
        get: { summary: "Industry Intelligence API (P1): Analyze industry-specific legal applicability, licenses, and obligations" },
        post: { summary: "Industry Intelligence API (P1): Map business activities to applicable legal requirements" },
      },
      "/v1/obligations/extract": {
        get: { summary: "Obligation API (P1): Retrieve structured regulatory obligations and execution controls" },
        post: { summary: "Obligation API (P1): Extract obligations filtered by industry and legal domain" },
      },
      "/v1/regulatory/impact": {
        get: { summary: "Regulatory Change API (P1): Retrieve detected regulatory amendments and effective dates" },
        post: { summary: "Regulatory Change API (P1): Simulate cross-module and enterprise amendment impact" },
      },
      "/v1/agents/missions": {
        get: { summary: "Agent Execution API (P1): List Legal Agent Registry and executed Single/Team/Swarm missions" },
        post: { summary: "Agent Execution API (P1): Launch an authorized Single-Agent, Team-Agent, or Swarm-Agent mission" },
      },
      "/v1/agents/missions/{id}": {
        get: { summary: "Agent Execution API (P1): Retrieve mission status, budget telemetry, and approval checkpoints" },
      },
      "/v1/reports/generate": {
        get: { summary: "Report Generation API (P1): List generated Research Report Studio memoranda and due diligence reports" },
        post: { summary: "Report Generation API (P1): Generate a structured bilingual legal report with 100% verified citations" },
      },
      "/v1/reports/{id}": {
        get: { summary: "Report Generation API (P1): Retrieve a specific Research Studio Report by ID" },
      },
      "/v1/enterprise/profile": {
        get: { summary: "Enterprise Compliance API (P2) & Section 24 Data Quality Dashboard: Retrieve multi-entity compliance profile, VIBE24 ecosystem targets, and 15 Data Quality KPIs" },
      },
      "/v1/cases/search": {
        get: { summary: "REG24-CASE: 4-Method Hybrid Case Search" },
        post: { summary: "REG24-CASE: 4-Method Hybrid Case Search" },
      },
      "/mcp": {
        get: { summary: "Discover MCP 2026-07-28 server metadata and all 61 reg24.* tools" },
        post: { summary: "Execute any MCP tool via JSON-RPC 2.0 or direct REST payload" },
      },
      "/a2a": {
        get: { summary: "Discover REG24 Legal Task Agent Card (A2A v1.0) and list durable A2A tasks" },
        post: { summary: "Delegate multi-domain legal tasks to reg24.legal_task_agent" },
      },
    },
    "x-mcp-tools": MCP_TOOLS_CATALOG,
    "x-a2a-agent-card": reg24Core.getA2AAgentCard(),
  });
}
