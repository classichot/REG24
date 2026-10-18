/**
 * REG24 — Unified MCP Gateway Endpoint (REG-MCP-001 to 005)
 * Compliant with the July 28, 2026 MCP Specification (Streamable HTTP + JSON-RPC 2.0)
 * Exposes all 12 mandatory reg24.* tools through a single remote gateway.
 */

import { NextRequest, NextResponse } from "next/server";
import { reg24Core, MCPCommonInput } from "@/core/engine/reg24-core";

export const MCP_TOOLS_CATALOG = [
  {
    name: "reg24.list_modules",
    description: "Discover supported and published legal modules on REG24 Core",
    inputSchema: {
      type: "object",
      properties: {
        jurisdiction: { type: "string", default: "TH" },
      },
    },
  },
  {
    name: "reg24.get_module_coverage",
    description: "Inspect scope, provision boundary accuracy, and known limitations for one or more modules",
    inputSchema: {
      type: "object",
      properties: {
        module_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "reg24.search_law",
    description: "Hybrid RAG24 statutory search across one or multiple modules with exact identifier priority and temporal version resolution",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        module_ids: { type: "array", items: { type: "string" } },
        as_of_date: { type: "string", description: "ISO date for historical legal effective time (YYYY-MM-DD)" },
        known_at_date: { type: "string", description: "ISO date for system knowledge time" },
        language: { type: "string", enum: ["th", "en", "bilingual"] },
        result_limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "reg24.get_provision",
    description: "Retrieve canonical statutory text, effective version, and cross-module references",
    inputSchema: {
      type: "object",
      required: ["provision_id"],
      properties: {
        provision_id: { type: "string" },
        as_of_date: { type: "string" },
        known_at_date: { type: "string" },
      },
    },
  },
  {
    name: "reg24.find_related_laws",
    description: "Traverse the version-sensitive cross-module Legal Knowledge Graph and surface conflict flags",
    inputSchema: {
      type: "object",
      required: ["provision_id"],
      properties: {
        provision_id: { type: "string" },
        as_of_date: { type: "string" },
      },
    },
  },
  {
    name: "reg24.resolve_applicability",
    description: "Identify potentially applicable regulations given structured business facts",
    inputSchema: {
      type: "object",
      properties: {
        module_ids: { type: "array", items: { type: "string" } },
        facts: { type: "object" },
        as_of_date: { type: "string" },
      },
    },
  },
  {
    name: "reg24.get_obligations",
    description: "Retrieve structured legal obligations, prerequisites, filing deadlines, and statutory vs. constitutional distinctions",
    inputSchema: {
      type: "object",
      properties: {
        module_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "reg24.evaluate_rule",
    description: "Execute human-approved deterministic legal rules (blocks unapproved draft rules in production)",
    inputSchema: {
      type: "object",
      required: ["rule_id", "facts"],
      properties: {
        rule_id: { type: "string" },
        facts: { type: "object" },
        as_of_date: { type: "string" },
      },
    },
  },
  {
    name: "reg24.compare_versions",
    description: "Compare historical legal versions and effective intervals of a canonical provision",
    inputSchema: {
      type: "object",
      required: ["provision_id"],
      properties: {
        provision_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24.get_regulatory_changes",
    description: "Retrieve amendment events, impact analysis, and affected downstream modules/rules",
    inputSchema: {
      type: "object",
      properties: {
        module_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "reg24.verify_citation",
    description: "Validate SHA-256 source evidence hash, immutable lock status, and legal version provenance",
    inputSchema: {
      type: "object",
      required: ["provision_id"],
      properties: {
        provision_id: { type: "string" },
        as_of_date: { type: "string" },
      },
    },
  },
  {
    name: "reg24.get_rule_explanation",
    description: "Explain a deterministic rule evaluation with supporting statutory evidence and human reviewer attribution",
    inputSchema: {
      type: "object",
      required: ["rule_id"],
      properties: {
        rule_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24.graphrag_3r_query",
    description:
      "Execute REG24 3R Hybrid GraphRAG pipeline (R1: Vector + Keyword + Multi-Hop Graph Traversal -> R2: Legal AI Statutory & Rule Reasoning -> R3: Independent Legal Verification Engine with AI-inferred edge quarantine)",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        module_ids: { type: "array", items: { type: "string" } },
        as_of_date: { type: "string" },
        known_at_date: { type: "string" },
        facts: { type: "object" },
      },
    },
  },
];

export async function GET() {
  return NextResponse.json({
    protocol: "Model Context Protocol (MCP)",
    specification_version: "2026-07-28",
    transport: "Streamable HTTP (JSON-RPC 2.0)",
    server_info: {
      name: "reg24-unified-mcp-gateway",
      version: "1.0.0",
      jurisdiction: "TH",
      connected_consumers: ["LAW24", "TRACE24", "VIBE24", "Third-Party AI Agents"],
    },
    tools: MCP_TOOLS_CATALOG,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Support both JSON-RPC 2.0 (initialize, tools/list, tools/call) and direct tool invocation
    if (body.jsonrpc === "2.0") {
      const { id, method, params } = body;

      if (method === "initialize") {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2026-07-28",
            capabilities: {
              tools: { listChanged: true },
            },
            serverInfo: {
              name: "reg24-unified-mcp-gateway",
              version: "1.0.0",
            },
          },
        });
      }

      if (method === "tools/list") {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: MCP_TOOLS_CATALOG,
          },
        });
      }

      if (method === "tools/call") {
        const toolName = params?.name || "";
        const toolArgs: MCPCommonInput = params?.arguments || {};
        const output = reg24Core.executeMCPTool(toolName, toolArgs);
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(output, null, 2),
              },
            ],
            structuredContent: output,
            isError: output.status === "error" || output.status === "blocked_security",
          },
        });
      }
    }

    // Direct REST-style MCP tool call
    const toolName = body.tool || body.name || "reg24.list_modules";
    const input: MCPCommonInput = body.input || body.arguments || body;
    const output = reg24Core.executeMCPTool(toolName, input);

    return NextResponse.json(output);
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Invalid MCP request payload",
      },
      { status: 400 }
    );
  }
}
