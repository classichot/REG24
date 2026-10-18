import { NextResponse } from "next/server";
import { MCP_TOOLS_CATALOG } from "@/app/api/mcp/route";

export async function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "REG24 — Modular Regulatory Infrastructure API & MCP Gateway",
      version: "1.0.0",
      description:
        "Machine-readable regulatory intelligence infrastructure for AI agents, LAW24, TRACE24, and VIBE24. Serves Thailand P0 modules (Corporate, Contract, Civil & Commercial Code, Tax, Labor, BOI) from a single canonical legal store.",
      contact: {
        name: "REG24 Platform Engineering",
      },
    },
    servers: [
      {
        url: "/api",
        description: "Unified REG24 REST & MCP Gateway",
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
      "/v1/platform": {
        get: {
          summary: "Retrieve full REG24 Core canonical snapshot (modules, provisions, versions, rules, graph, changes, traces)",
        },
        post: {
          summary: "Execute administrative lifecycle operations (Module Factory install, upgrade, rollback, rule approval, amendment simulation)",
        },
      },
    },
    "x-mcp-tools": MCP_TOOLS_CATALOG,
  });
}
