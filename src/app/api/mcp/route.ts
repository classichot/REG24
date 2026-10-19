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
  // TAX-API-01 (Expansion v1.1): 12 Tax Rulings & Revenue Code Sub-Regulations MCP Services
  {
    name: "search_tax_rulings",
    description: "TAX-API-01: Search Revenue Department tax consultation letters (2540–2569 archive) and Tax Ruling Committee decisions by keyword, tax type, or Revenue Code section",
    inputSchema: { type: "object", properties: { query: { type: "string" }, tax_type: { type: "string" }, provision_id: { type: "string" } } },
  },
  {
    name: "get_tax_ruling",
    description: "TAX-API-01: Retrieve full structured RD ruling record (e.g. กค 0702(กม.)/462 or กค 0702(กม.)/453) with 7-tier authority classification and non-override warning",
    inputSchema: { type: "object", properties: { ruling_id: { type: "string" }, document_number: { type: "string" } } },
  },
  {
    name: "find_similar_tax_rulings",
    description: "TAX-RULING-02 / TAX-API-01: Execute fact-specific precedent comparison between a taxpayer scenario and RD rulings, flagging material factual differences and legal applicability warnings",
    inputSchema: { type: "object", properties: { ruling_id: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "get_revenue_code_section",
    description: "TAX-SUB-02 / TAX-API-01: Retrieve a Revenue Code section together with its complete Article-to-Regulation-to-Ruling-to-Case hierarchy",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" } } },
  },
  {
    name: "get_related_subregulations",
    description: "TAX-SUB-01 / TAX-API-01: Retrieve Royal Decrees, Ministerial Regulations, MOF/DG Notifications, and RD Departmental Orders (ท.ป./ป.) implementing a Revenue Code provision",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, category: { type: "string" } } },
  },
  {
    name: "get_applicable_tax_law_at_date",
    description: "TAX-SUB-03 / TAX-API-01: Reconstruct the exact Revenue Code provisions, sub-regulations, Top-up Tax B.E. 2567 rules, and active RD rulings in force on a specific transaction date",
    inputSchema: { type: "object", properties: { as_of_date: { type: "string" }, provision_id: { type: "string" } } },
  },
  {
    name: "get_related_court_decisions",
    description: "TAX-CASE-01 / TAX-API-01: Retrieve Supreme Court Tax Division and Central Tax Court decisions interpreting or overruling administrative tax positions",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" } } },
  },
  {
    name: "compare_tax_interpretations",
    description: "TAX-QUALITY-01 / TAX-API-01: Compare binding statutes and Royal Decrees against Tax Ruling Committee interpretations, RD consultation letters, and Supreme Court judgments",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "analyze_restructuring_tax",
    description: "TAX-API-01: Analyze corporate merger or EBT tax neutrality under CCC Sec. 1238/1243, Revenue Code Sec. 73/74/77/1(8), Royal Decree No. 10, Ministerial Regulation No. 126, and RD Ruling กค 0702(กม.)/462",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "check_tax_exemption_eligibility",
    description: "TAX-SUB-01 / TAX-API-01: Deterministic eligibility evaluation for Royal Decree No. 10, Ministerial Regulation No. 126 Clause 2(50), and RD Ruling กค 0702(กม.)/462 conditions",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "trace_tax_legal_basis",
    description: "TAX-RULING-03 / TAX-API-01: Traverse the Article-to-Regulation-to-Ruling Knowledge Graph across CCC Sec. 1238, RC Sec. 73/74, RD Ruling 462/2569, RD Opinion 453/2568, and Supreme Court 5412/2565",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, ruling_id: { type: "string" } } },
  },
  {
    name: "get_recent_tax_rule_changes",
    description: "REG-TAX-CHANGE / TAX-API-01: Retrieve statutory amendments, Top-up Tax B.E. 2567 updates, and new RD consultation letters affecting TP24, CFO24, ACC24, GMT24, and LAW24",
    inputSchema: { type: "object", properties: { module_ids: { type: "array", items: { type: "string" } } } },
  },
  // PDPA Scope Expansion (v1.2 — Module REG24-PDPA / reg24.pdpa.th) MCP Services
  {
    name: "assess_pdpa_applicability_and_basis",
    description: "REG24-PDPA: Deterministically evaluate PDPA territorial/extraterritorial scope (Sec. 3–5), consent validity (Sec. 19), general lawful bases (Sec. 24), and sensitive personal data protection (Sec. 26)",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "evaluate_pdpa_dsar_and_breach",
    description: "REG24-PDPA: Evaluate compliance with the 2026 PDPC Access-Request Notification (30-day DSAR window & identity minimization) and 72-hour breach reporting (Sec. 37(4))",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "check_pdpa_cross_border_and_dpo",
    description: "REG24-PDPA: Verify mandatory DPO designation (Sec. 41) and cross-border personal data transfer mechanisms (Adequacy, BCRs, SCCs under Sec. 28–29)",
    inputSchema: { type: "object", properties: { facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "get_pdpa_subordinate_regulations",
    description: "REG24-PDPA: Retrieve verified PDPC notifications (including the 2026 Access-Request Notification B.E. 2569) and PDPC Expert Committee administrative enforcement orders",
    inputSchema: { type: "object", properties: { as_of_date: { type: "string" } } },
  },
  {
    name: "run_pdpa_compliance_assessment",
    description: "REG24-PDPA: Execute end-to-end PDPA B.E. 2562 & 2026 Access-Request Notification compliance assessment with Privacy-by-Design PII minimization and cross-module GraphRAG dependencies",
    inputSchema: { type: "object", properties: { as_of_date: { type: "string" }, facts: { type: "object" } } },
  },
];

export async function GET() {
  return NextResponse.json({
    protocol: "Model Context Protocol (MCP)",
    specification_version: "2026-07-28",
    transport: "Streamable HTTP (JSON-RPC 2.0)",
    server_info: {
      name: "reg24-unified-mcp-gateway",
      version: "2.1.0",
      jurisdiction: "TH",
      connected_consumers: ["LAW24", "CFO24", "ACC24", "TP24", "GMT24", "TRACE24", "VIBE24", "External AI Agents"],
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
