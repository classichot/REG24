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
  // CORE-07 Capital Markets, Corporate Restructuring & Insolvency MCP Services
  {
    name: "search_regulations",
    description: "CORE-07: Hybrid full-text and semantic regulatory search across all 10 P0 Thailand legal modules",
    inputSchema: { type: "object", properties: { query: { type: "string" }, as_of_date: { type: "string" } } },
  },
  {
    name: "get_applicable_law",
    description: "CORE-07: Identify applicable SEC, SET, Restructuring, Insolvency, Corporate, and Tax regulations from transaction facts",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "get_law_at_date",
    description: "CORE-07: Point-in-time legal version retrieval (e.g., SET MT/RPT Pre-July 2026 vs. Revised 1 July 2026 rules)",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, as_of_date: { type: "string" } } },
  },
  {
    name: "explain_legal_provision",
    description: "CORE-07: Explain a legal provision with official citations, regulator provenance, and cross-module references",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, as_of_date: { type: "string" } } },
  },
  {
    name: "analyze_sec_transaction",
    description: "SEC-03/04: Evaluate SEA Sec. 246 (5% reporting), Sec. 247 (25%/50%/75% MTO), Whitewash, and TorJor. 42/2563 rehab offerings",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "check_set_compliance",
    description: "SET-02/04: Evaluate SET Material Transaction (MT) & Related-Party Transaction (RPT) rules with 1 July 2026 temporal version selection",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "calculate_regulatory_threshold",
    description: "CORE-05: Execute deterministic regulatory threshold calculators (MTO, MT/RPT Size Test, Debt-to-Equity, Sec. 90/46 Voting)",
    inputSchema: { type: "object", properties: { rule_id: { type: "string" }, facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "analyze_restructuring",
    description: "RESTRUCT-02/03: Execute 6-module cross-law restructuring analysis (REG-INSOLV + REG-RESTRUCT + REG-SEC + REG-SET + REG-TAX + REG-CORP)",
    inputSchema: { type: "object", properties: { as_of_date: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "assess_rehabilitation_pathway",
    description: "INSOLV-03/06: Evaluate Bankruptcy Act Sec. 90/3 eligibility (>=10M THB), Sec. 90/12 Automatic Stay, Sec. 90/46 voting & SET listing preservation",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "generate_legal_workflow",
    description: "RESTRUCT-04: Generate dependency-based corporate restructuring and court rehabilitation execution workflow",
    inputSchema: { type: "object", properties: { as_of_date: { type: "string" } } },
  },
  {
    name: "draft_regulatory_document",
    description: "SET-05 / RESTRUCT-05 / INSOLV-05: Generate SETLink disclosure drafts, board resolutions, and rehabilitation plan term sheets (human approval required)",
    inputSchema: { type: "object", properties: { as_of_date: { type: "string" } } },
  },
  {
    name: "validate_legal_citations",
    description: "CORE-04: Validate official source SHA-256 hashes, effective dates, and non-binding consultation separation",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, as_of_date: { type: "string" } } },
  },
  {
    name: "get_regulation_changes",
    description: "CORE-03/04: Retrieve regulatory change events, including the 1 July 2026 SET MT/RPT amendment and impacted modules",
    inputSchema: { type: "object", properties: { module_ids: { type: "array", items: { type: "string" } } } },
  },
];

export async function GET() {
  return NextResponse.json({
    protocol: "Model Context Protocol (MCP)",
    specification_version: "2026-07-28",
    transport: "Streamable HTTP (JSON-RPC 2.0)",
    server_info: {
      name: "reg24-unified-mcp-gateway",
      version: "2.0.0",
      jurisdiction: "TH",
      connected_consumers: ["LAW24", "CFO24", "ACC24", "TP24", "TRACE24", "VIBE24", "External AI Agents"],
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
