import { NextResponse } from "next/server";
import { MCP_TOOLS_CATALOG } from "@/app/api/mcp/route";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "REG24 — Data, MCP & A2A Regulatory Infrastructure API",
      version: "1.1.0",
      description:
        "Machine-readable regulatory intelligence infrastructure for AI agents, LAW24, CFO24, TRACE24, and VIBE24. Combines REG24 Data Infrastructure (Canonical Store), REG24 MCP Infrastructure (July 28, 2026 spec), and REG24 A2A Infrastructure (A2A Protocol v1.0 Legal Task Agent).",
      contact: {
        name: "REG24 Platform Engineering",
      },
    },
    servers: [
      {
        url: "/api",
        description: "Unified REG24 REST, MCP & A2A Gateway",
      },
    ],
    paths: {
      "/mcp": {
        get: {
          summary: "Discover MCP 2026-07-28 server metadata and all 12 reg24.* tools",
          responses: {
            "200": { description: "MCP Server Manifest & Tools List" },
          },
        },
        post: {
          summary: "Execute any of the 12 reg24.* MCP tools via JSON-RPC 2.0 or direct REST payload",
          responses: {
            "200": { description: "Standard REG24 Legal Tool Response Contract (REG-MCP-004)" },
          },
        },
      },
      "/a2a": {
        get: {
          summary: "Discover REG24 Legal Task Agent Card (A2A v1.0) and list durable A2A tasks",
          responses: {
            "200": { description: "A2A Agent Card & Durable Task Ledger" },
          },
        },
        post: {
          summary: "Delegate multi-domain legal tasks (tasks/send, tasks/get, tasks/cancel) to reg24.legal_task_agent",
          responses: {
            "200": { description: "Durable A2ATaskContract with unified A2AEvidenceEnvelope" },
          },
        },
      },
      "/.well-known/agent.json": {
        get: {
          summary: "Official A2A v1.0 Agent Card discovery endpoint (REG-A2A-005)",
          responses: {
            "200": { description: "A2AAgentCard JSON" },
          },
        },
      },
      "/v1/platform": {
        get: {
          summary: "Retrieve full REG24 Core canonical snapshot (modules, provisions, versions, rules, graph, changes, traces, a2aTasks)",
        },
        post: {
          summary: "Execute administrative lifecycle operations (Module Factory install, upgrade, rollback, rule approval, amendment simulation)",
        },
      },
    },
    "x-mcp-tools": MCP_TOOLS_CATALOG,
    "x-a2a-agent-card": reg24Core.getA2AAgentCard(),
  });
}
