/**
 * REG24 — Unified MCP Gateway Endpoint (REG-MCP-001 to 005)
 * Compliant with the July 28, 2026 MCP Specification (Streamable HTTP + JSON-RPC 2.0)
 * Exposes all 12 mandatory reg24.* tools through a single remote gateway.
 */

import { NextRequest, NextResponse } from "next/server";
import { reg24Core, MCPCommonInput } from "@/core/engine/reg24-core";
import {
  universalMcpGateway,
  UNIVERSAL_MCP_10_TOOLS_CATALOG,
  UniversalMCPToolName,
  UniversalAIProviderId,
} from "@/core/mcp/universal-mcp-gateway";
import {
  agenticLegalResearchOrchestrator,
  verifyLegalCitationsAndClaims,
  type RequestedResearchModeInput,
  type DeliverableOutputFormat,
} from "@/core/agentic-rag/agentic-legal-research-engine";
import {
  reusableLegalKnowledgeLibrary,
  type ConsumingApplicationId,
} from "@/core/library/legal-knowledge-library";

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
  // Court Case Intelligence & Legal Precedent Module (v1.0 — Module REG24-CASE / reg24.case.th) MCP Services (SDR Section 11)
  {
    name: "reg24_search_cases",
    description: "REG24-CASE: Unified 4-method hybrid legal search (Keyword, Semantic, Graph, Metadata) across Thai Supreme Court judgments, Specialist Courts, and Revenue Department rulings",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" }, result_limit: { type: "number" } } },
  },
  {
    name: "reg24_get_case",
    description: "REG24-CASE: Retrieve canonical LegalCase record with verbatim source passages, SHA-256 fingerprint, authority distinction, and rights/licensing status",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "reg24_find_similar_cases",
    description: "REG24-CASE: Retrieve explicitly connected decisions (CASE_CITES_CASE, CASE_DISTINGUISHES_CASE, CASE_RELATED_TO_CASE) and issue-similar cases while quarantining AI-inferred edges",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "reg24_compare_cases",
    description: "REG24-CASE: Side-by-side factual and legal comparison between two or more Thai judgments, explaining material distinctions and conflicting outcomes",
    inputSchema: { type: "object", properties: { facts: { type: "object" } } },
  },
  {
    name: "reg24_get_statute_case_links",
    description: "REG24-CASE: Retrieve all judicial decisions and administrative rulings interpreting a statutory provision or historical version",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, query: { type: "string" } } },
  },
  {
    name: "reg24_search_tax_rulings",
    description: "REG24-CASE: Search Revenue Department tax consultation letters (ข้อหารือภาษีอากร) and Tax Ruling Committee decisions linked to judicial precedents",
    inputSchema: { type: "object", properties: { query: { type: "string" }, provision_id: { type: "string" } } },
  },
  {
    name: "reg24_analyze_legal_issue",
    description: "REG24-CASE: Execute the 8-step agentic legal research workflow with mandatory 8-part output structure, epistemic classification, and deterministic citation verification",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "reg24_verify_case_citation",
    description: "REG24-CASE: Deterministically verify judgment numbers, statutory sections, verbatim quotations, and overruling claims to prevent AI hallucinations",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "reg24_get_historical_law",
    description: "REG24-CASE: Point-in-time historical law resolver distinguishing transaction date, assessment date, filing date, and judgment date (e.g., 2018 vs. 2019+ Transfer Pricing)",
    inputSchema: { type: "object", properties: { as_of_date: { type: "string" }, provision_id: { type: "string" }, facts: { type: "object" } } },
  },
  // PRD v2.0 Section 12.1 Corporate & Commercial Legal Intelligence MCP Tools
  {
    name: "reg24.get_document_version",
    description: "PRD v2.0 Section 12.1: Retrieve point-in-time source document version, SHA-256 checksum, Source Reliability Tier (A–E), and Section 24 Data Quality status",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, as_of_date: { type: "string" } } },
  },
  {
    name: "reg24.search_court_cases",
    description: "PRD v2.0 Section 12.1: Hybrid 4-method search across verified Thai Supreme Court & Specialist Court judgments",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "reg24.search_tax_rulings",
    description: "PRD v2.0 Section 12.1: Search Revenue Department consultation letters and Tax Ruling Committee interpretations",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "reg24.analyze_legal_question",
    description: "PRD v2.0 Section 7.2 & 12.1: Execute LEG-AI-01..10 Corporate & Commercial Legal Intelligence analysis returning the Structured Answer Contract",
    inputSchema: { type: "object", properties: { query: { type: "string" }, as_of_date: { type: "string" }, facts: { type: "object" } } },
  },
  {
    name: "reg24.analyze_industry_regulation",
    description: "PRD v2.0 Section 5 & 12.1: Analyze industry-specific legal applicability, business activities, licenses, and obligations (IND-CORP, IND-FIN, IND-ENERGY, IND-PROPERTY, IND-MFG, etc.)",
    inputSchema: { type: "object", properties: { query: { type: "string" }, facts: { type: "object" }, as_of_date: { type: "string" } } },
  },
  {
    name: "reg24.query_legal_graph",
    description: "PRD v2.0 Section 6 & 12.1: Traverse the 20-entity, 16-relationship Regulatory Knowledge Graph with provenance and AI-inferred edge quarantine",
    inputSchema: { type: "object", properties: { query: { type: "string" }, as_of_date: { type: "string" } } },
  },
  {
    name: "reg24.extract_obligations",
    description: "PRD v2.0 Section 9 & 12.1: Extract structured compliance obligations, deadlines, evidence requirements, and execution controls by industry and legal domain",
    inputSchema: { type: "object", properties: { facts: { type: "object" } } },
  },
  {
    name: "reg24.compare_legal_versions",
    description: "PRD v2.0 Section 12.1: Compare historical and current versions of a legal provision across effective dates",
    inputSchema: { type: "object", properties: { provision_id: { type: "string" }, as_of_date: { type: "string" } } },
  },
  {
    name: "reg24.generate_legal_memo",
    description: "PRD v2.0 Section 10.5 & 12.1: Generate a verified Research Report Studio legal memorandum or due diligence report with 100% resolved citations",
    inputSchema: { type: "object", properties: { query: { type: "string" }, language: { type: "string" }, facts: { type: "object" } } },
  },
  // REG24-UNIVERSAL-MCP-001 (Section 2B): 10 Canonical Universal Legal MCP Tools for ChatGPT, Claude, Gemini, Qwen & DeepSeek
  ...UNIVERSAL_MCP_10_TOOLS_CATALOG.filter((ut) => ut.name !== "reg24_search_cases").map((ut) => ({
    name: ut.name,
    description: `[Universal MCP ${ut.priority}] ${ut.purpose_en} — ${ut.purpose_th}`,
    inputSchema: ut.inputSchema,
  })),
  // REG24-PRD-AGENTRAG-001 (AGR-014): Agentic Legal Research MCP Tools
  {
    name: "reg24.search_case_law",
    description: "AGR-014: Search Thai Supreme Court (Dika), Tax Court, and Revenue Department tax rulings with structured provenance",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        as_of_date: { type: "string" },
        result_limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "reg24.get_law_version",
    description: "AGR-006 & AGR-014: Retrieve point-in-time historical or current version of a statutory provision or subordinate regulation",
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
    name: "reg24.start_legal_research",
    description: "AGR-001..AGR-014: Start and execute an Agentic Legal Research mission across Fast (Mode A), Advanced (Mode B), or Deep Agentic (Mode C) pipelines",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["AUTO", "FAST_LEGAL_LOOKUP", "ADVANCED_LEGAL_RESEARCH", "DEEP_AGENTIC_RESEARCH"], default: "AUTO" },
        jurisdiction: { type: "string", default: "TH" },
        as_of_date: { type: "string" },
        practice_areas: { type: "array", items: { type: "string" } },
        include_case_law: { type: "boolean", default: true },
        include_tax_rulings: { type: "boolean", default: true },
        include_subordinate_legislation: { type: "boolean", default: true },
        max_iterations: { type: "number", default: 4 },
        budget_tier: { type: "string", enum: ["ECONOMY", "STANDARD", "HIGH_RIGOR"], default: "STANDARD" },
        response_format: { type: "string", enum: ["EXECUTIVE_MEMO", "STRUCTURED_JSON", "FULL_LEGAL_OPINION_DRAFT"], default: "EXECUTIVE_MEMO" },
        citation_strictness: { type: "string", enum: ["STRICT", "STANDARD"], default: "STRICT" },
        tenant_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24.get_research_status",
    description: "AGR-014: Inspect status, routing mode, iteration count, and trace summary of a legal research mission",
    inputSchema: {
      type: "object",
      required: ["mission_id"],
      properties: {
        mission_id: { type: "string" },
        tenant_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24.get_research_result",
    description: "AGR-010 & AGR-014: Retrieve the full 14-section structured legal research deliverable, citation verification report, and trace",
    inputSchema: {
      type: "object",
      required: ["mission_id"],
      properties: {
        mission_id: { type: "string" },
        tenant_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24.verify_legal_citations",
    description: "AGR-008 & AGR-014: Execute the 10-point citation and legal claim verification gate before response publication",
    inputSchema: {
      type: "object",
      required: ["claims"],
      properties: {
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim_id: { type: "string" },
              statement: { type: "string" },
              cited_ids: { type: "array", items: { type: "string" } },
            },
          },
        },
        mission_id: { type: "string" },
        as_of_date: { type: "string" },
        strictness: { type: "string", enum: ["STRICT", "STANDARD"], default: "STRICT" },
        tenant_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24.get_legal_evidence",
    description: "AGR-009 & AGR-014: Retrieve normalized legal provenance evidence items (AGR-009 schema) for a mission or query",
    inputSchema: {
      type: "object",
      properties: {
        mission_id: { type: "string" },
        query: { type: "string" },
        as_of_date: { type: "string" },
        tenant_id: { type: "string" },
      },
    },
  },
  // REG24-KL-001 (LIB-14): Expert Legal Commentary & Reusable Knowledge Library MCP Tools
  {
    name: "reg24_search_legal_commentary",
    description: "REG24-KL-001 (LIB-14): Authority-aware hybrid search across secondary legal commentaries, textbooks, journals, and primary authorities with tenant/license enforcement",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        as_of_date: { type: "string" },
        tenant_id: { type: "string" },
        consuming_app: { type: "string", enum: ["REG24", "LAW24", "TP24", "ACC24", "CFO24"] },
      },
    },
  },
  {
    name: "reg24_get_legal_opinions",
    description: "REG24-KL-001 (LIB-14): Retrieve structured secondary legal opinions and propositions attributed to authors with page-level provenance and non-binding classification",
    inputSchema: {
      type: "object",
      properties: {
        legal_issue_id: { type: "string" },
        document_id: { type: "string" },
        tenant_id: { type: "string" },
        consuming_app: { type: "string" },
      },
    },
  },
  {
    name: "reg24_compare_legal_interpretations",
    description: "REG24-KL-001 (LIB-12 & LIB-14): Compare competing academic and practitioner secondary opinions alongside judicial/administrative positions and detect contradictions",
    inputSchema: {
      type: "object",
      properties: {
        legal_issue_id: { type: "string" },
        tenant_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24_find_related_authorities",
    description: "REG24-KL-001 (LIB-07 & LIB-14): Traverse Knowledge Graph relationships (INTERPRETS, DISCUSSES_CASE, SUPPORTS_POSITION, DISPUTES_POSITION, CITES_SOURCE, SUPERSEDED_BY) with license checks",
    inputSchema: {
      type: "object",
      required: ["entity_id"],
      properties: {
        entity_id: { type: "string" },
        include_unverified: { type: "boolean", default: false },
        tenant_id: { type: "string" },
      },
    },
  },
  {
    name: "reg24_get_verified_citations",
    description: "REG24-KL-001 (LIB-09 & LIB-14): Verify page-level citation provenance, printed vs PDF page index, SHA-256 content hash, and excerpt license permissions",
    inputSchema: {
      type: "object",
      required: ["citation_id"],
      properties: {
        citation_id: { type: "string" },
        tenant_id: { type: "string" },
        consuming_app: { type: "string" },
      },
    },
  },
  {
    name: "reg24_check_legal_freshness",
    description: "REG24-KL-001 (LIB-08 & LIB-14): Validate temporal freshness (CURRENT_VERIFIED, POTENTIALLY_OUTDATED, HISTORICAL_ONLY, UNVERIFIED) of secondary commentary against statutory amendments",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        as_of_date: { type: "string" },
      },
    },
  },
];

const KNOWLEDGE_LIBRARY_MCP_TOOL_NAMES = new Set<string>([
  "reg24_search_legal_commentary",
  "reg24_get_legal_opinions",
  "reg24_compare_legal_interpretations",
  "reg24_find_related_authorities",
  "reg24_get_verified_citations",
  "reg24_check_legal_freshness",
]);

function executeKnowledgeLibraryMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  tenantId: string
): Record<string, unknown> {
  const effectiveTenant = String(args.tenant_id || tenantId || "tenant.law24.prod");
  const consumingApp = (args.consuming_app || "REG24") as ConsumingApplicationId;

  switch (toolName) {
    case "reg24_search_legal_commentary": {
      const answer = reusableLegalKnowledgeLibrary.searchAndSynthesizeAuthorityAwareAnswer({
        query: String(args.query || "Management fee deductibility under Section 65 ter"),
        asOfDate: String(args.as_of_date || "2026-10-22"),
        tenantId: effectiveTenant,
        consumingApp,
      });
      return {
        status: "ok",
        specification_id: "REG24-KL-001",
        tool: toolName,
        answer,
      };
    }
    case "reg24_get_legal_opinions": {
      const snap = reusableLegalKnowledgeLibrary.getLibrarySnapshot(effectiveTenant, consumingApp);
      const docId = args.document_id ? String(args.document_id) : undefined;
      if (docId) {
        const perm = reusableLegalKnowledgeLibrary.checkAccessPermission({
          documentId: docId,
          tenantId: effectiveTenant,
          consumingApp,
          requestedOperation: "SEARCH",
        });
        if (!perm.allowed) {
          return {
            status: "blocked_permission",
            specification_id: "REG24-KL-001",
            tool: toolName,
            allowed: false,
            reason: perm.reason,
          };
        }
      }
      const opinions = snap.opinions.filter((o) =>
        docId ? o.documentId === docId : args.legal_issue_id ? o.legalIssueId === String(args.legal_issue_id) : true
      );
      return {
        status: "ok",
        specification_id: "REG24-KL-001",
        tool: toolName,
        authority_separation_notice: "All returned items are SECONDARY_OPINION (isBindingAuthority: false).",
        opinions,
      };
    }
    case "reg24_compare_legal_interpretations": {
      const comparison = reusableLegalKnowledgeLibrary.compareLegalOpinions(
        String(args.legal_issue_id || "issue.kl.tax.management_fee_deductibility")
      );
      return {
        status: "ok",
        specification_id: "REG24-KL-001",
        tool: toolName,
        comparison,
      };
    }
    case "reg24_find_related_authorities": {
      const graph = reusableLegalKnowledgeLibrary.getKnowledgeGraphForEntity({
        entityId: String(args.entity_id || "prov.th.rev.65ter"),
        tenantId: effectiveTenant,
        consumingApp,
        includeUnverifiedAiEdges: Boolean(args.include_unverified),
      });
      return {
        status: "ok",
        specification_id: "REG24-KL-001",
        tool: toolName,
        ...graph,
      };
    }
    case "reg24_get_verified_citations": {
      return reusableLegalKnowledgeLibrary.getVerifiedCitationById({
        citationOrDocumentId: String(args.citation_id || "doc.kl.tax.treatise.2026.ed9"),
        tenantId: effectiveTenant,
        consumingApp,
      });
    }
    case "reg24_check_legal_freshness": {
      return {
        status: "ok",
        specification_id: "REG24-KL-001",
        tool: toolName,
        ...reusableLegalKnowledgeLibrary.checkLegalFreshness({
          documentOrOpinionId: args.document_id ? String(args.document_id) : undefined,
          asOfDate: args.as_of_date ? String(args.as_of_date) : "2026-10-22",
        }),
      };
    }
    default:
      return { status: "error", error: `Unsupported Knowledge Library MCP tool: ${toolName}` };
  }
}

const UNIVERSAL_10_TOOL_NAMES = new Set<string>(
  UNIVERSAL_MCP_10_TOOLS_CATALOG.map((t) => t.name)
);

const AGENTIC_RAG_MCP_TOOL_NAMES = new Set<string>([
  "reg24.search_case_law",
  "reg24.get_law_version",
  "reg24.start_legal_research",
  "reg24.get_research_status",
  "reg24.get_research_result",
  "reg24.verify_legal_citations",
  "reg24.get_legal_evidence",
]);

async function executeAgenticRagMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  tenantId: string
): Promise<Record<string, unknown>> {
  const effectiveTenant = String(args.tenant_id || tenantId || "PUBLIC");
  const asOfDate = String(args.as_of_date || "2026-10-21");

  switch (toolName) {
    case "reg24.search_case_law": {
      const mission = agenticLegalResearchOrchestrator.executeResearchMission({
        question: String(args.query || args.question || "Supreme Court Dika & Revenue Department rulings"),
        research_mode: "FAST_LEGAL_LOOKUP",
        as_of_date: asOfDate,
        tenant_id: effectiveTenant,
      });
      const caseAndRulings = mission.evidence.filter(
        (ev) =>
          ev.source_type === "judicial_decision" ||
          ev.source_type === "tax_ruling"
      );
      return {
        status: "ok",
        prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-014: reg24.search_case_law)",
        mission_id: mission.mission_id,
        as_of_date: asOfDate,
        results: caseAndRulings.length > 0 ? caseAndRulings : mission.evidence,
      };
    }

    case "reg24.get_law_version": {
      const provId = String(args.provision_id || "prov.th.rc.65_bis");
      const coreRes = reg24Core.executeMCPTool("reg24.get_provision", {
        provision_id: provId,
        as_of_date: asOfDate,
        tenant_context: { tenant_id: effectiveTenant, role: "Legal Reviewer" },
      });
      return {
        status: "ok",
        prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-006 & AGR-014: reg24.get_law_version)",
        provision_id: provId,
        as_of_date: asOfDate,
        version_record: coreRes.result,
      };
    }

    case "reg24.start_legal_research": {
      const mission = agenticLegalResearchOrchestrator.executeResearchMission({
        question: String(args.question || args.query || "Analyze Thai corporate and tax legal framework"),
        research_mode: (args.research_mode || args.mode || "auto") as RequestedResearchModeInput,
        jurisdiction: String(args.jurisdiction || "TH"),
        as_of_date: asOfDate,
        max_iterations: typeof args.max_iterations === "number" ? args.max_iterations : 3,
        budget_limit_usd: typeof args.budget_limit_usd === "number" ? args.budget_limit_usd : 2.0,
        output_format: (args.output_format || "structured_report") as DeliverableOutputFormat,
        tenant_id: effectiveTenant,
      });
      return {
        status: "ok",
        prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-014: reg24.start_legal_research)",
        mission_id: mission.mission_id,
        mission_status: mission.status,
        selected_mode: mission.router_decision.selected_mode,
        router_decision: mission.router_decision,
        report: mission.report,
        citation_verification: mission.citation_verification,
        cost_ledger: mission.cost_ledger,
      };
    }

    case "reg24.get_research_status": {
      const missionId = String(args.mission_id || "");
      const mission = agenticLegalResearchOrchestrator.getMission(missionId, effectiveTenant);
      if (!mission) {
        return {
          status: "error",
          error: `Mission '${missionId}' not found or unauthorized for tenant '${effectiveTenant}'.`,
        };
      }
      return {
        status: "ok",
        prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-014: reg24.get_research_status)",
        mission_id: mission.mission_id,
        mission_status: mission.status,
        selected_mode: mission.router_decision.selected_mode,
        iterations_executed: mission.trace.evidence_evaluation_rounds.length,
        evidence_count: mission.evidence.length,
        cost_ledger: mission.cost_ledger,
      };
    }

    case "reg24.get_research_result": {
      const missionId = String(args.mission_id || "");
      const mission = agenticLegalResearchOrchestrator.getMission(missionId, effectiveTenant);
      if (!mission) {
        return {
          status: "error",
          error: `Mission '${missionId}' not found or unauthorized for tenant '${effectiveTenant}'.`,
        };
      }
      return {
        status: "ok",
        prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-010 & AGR-014: reg24.get_research_result)",
        mission_id: mission.mission_id,
        report: mission.report,
        citation_verification: mission.citation_verification,
        trace: mission.trace,
      };
    }

    case "reg24.verify_legal_citations": {
      const rawClaims = Array.isArray(args.claims)
        ? (args.claims as Array<{ statement?: string; citation_text?: string }>).map((c) => ({
            citation_text: String(c.citation_text || c.statement || ""),
            asserted_proposition: c.statement,
            as_of_date: asOfDate,
          }))
        : [{ citation_text: String(args.statement || args.query || ""), as_of_date: asOfDate }];
      const missionId = args.mission_id ? String(args.mission_id) : undefined;
      const mission = missionId
        ? agenticLegalResearchOrchestrator.getMission(missionId, effectiveTenant)
        : undefined;
      const verification = verifyLegalCitationsAndClaims({
        citations_to_verify: rawClaims,
        evidence_pool: mission?.evidence || [],
      });
      return {
        status: "ok",
        prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-008 & AGR-014: reg24.verify_legal_citations)",
        verification,
      };
    }

    case "reg24.get_legal_evidence": {
      const missionId = args.mission_id ? String(args.mission_id) : undefined;
      if (missionId) {
        const mission = agenticLegalResearchOrchestrator.getMission(missionId, effectiveTenant);
        if (!mission) {
          return {
            status: "error",
            error: `Mission '${missionId}' not found or unauthorized for tenant '${effectiveTenant}'.`,
          };
        }
        return {
          status: "ok",
          prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-009 & AGR-014: reg24.get_legal_evidence)",
          mission_id: mission.mission_id,
          evidence: mission.evidence,
        };
      }
      const fallbackMission = agenticLegalResearchOrchestrator.executeResearchMission({
        question: String(args.query || args.question || "Thai corporate and tax provisions"),
        research_mode: "FAST_LEGAL_LOOKUP",
        as_of_date: asOfDate,
        tenant_id: effectiveTenant,
      });
      return {
        status: "ok",
        prd_reference: "REG24-PRD-AGENTRAG-001 (AGR-009 & AGR-014: reg24.get_legal_evidence)",
        mission_id: fallbackMission.mission_id,
        evidence: fallbackMission.evidence,
      };
    }

    default:
      return { status: "error", error: `Unsupported Agentic RAG MCP tool: ${toolName}` };
  }
}

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get("format");

  if (format === "deepseek_tools" || format === "openai_functions") {
    return NextResponse.json({
      prd_id: "REG24-UNIVERSAL-MCP-001",
      adapter: "DeepSeek / OpenAI Function-Calling Tool Schema Bridge",
      execution_endpoint: "POST https://reg24-theta.vercel.app/api/mcp",
      tools: universalMcpGateway.getOpenAIFunctionsSchema(),
    });
  }

  if (format === "gemini_declarations") {
    return NextResponse.json({
      prd_id: "REG24-UNIVERSAL-MCP-001",
      adapter: "Google Gemini Function Declarations Fallback Adapter",
      execution_endpoint: "POST https://reg24-theta.vercel.app/api/mcp",
      ...universalMcpGateway.getGeminiFunctionDeclarations(),
    });
  }

  return NextResponse.json({
    protocol: "Model Context Protocol (MCP)",
    prd_id: "REG24-UNIVERSAL-MCP-001",
    positioning: "REG24 — The Legal Intelligence Layer for Every AI",
    specification_version: "2026-07-28",
    transport: "Streamable HTTP (JSON-RPC 2.0) + SSE Compatibility (/api/mcp/sse)",
    server_info: {
      name: "reg24-universal-mcp-gateway",
      version: "3.0.0",
      jurisdiction: "TH",
      supported_ai_providers: ["OpenAI ChatGPT", "Anthropic Claude", "Google Gemini", "Alibaba Qwen", "DeepSeek"],
      connected_consumers: [
        "ChatGPT",
        "Claude",
        "Gemini",
        "Qwen",
        "DeepSeek",
        "LAW24",
        "CFO24",
        "ACC24",
        "TP24",
        "GMT24",
        "ESG24",
        "COP24",
        "TRADE24",
        "HOTEL24",
        "DRUG24",
        "RISK24",
      ],
    },
    universal_mcp_gateway: universalMcpGateway.getGatewaySnapshot(),
    tools: MCP_TOOLS_CATALOG,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = (body.provider ||
      req.headers.get("x-reg24-ai-provider") ||
      "claude") as UniversalAIProviderId;
    const tenantId =
      body.tenant_id ||
      body.params?.arguments?.tenant_context?.tenant_id ||
      req.headers.get("x-reg24-tenant") ||
      "tenant.law24.prod";

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
              name: "reg24-universal-mcp-gateway",
              version: "3.0.0",
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
        const toolName = String(params?.name || "");
        const toolArgs: MCPCommonInput = params?.arguments || {};

        if (UNIVERSAL_10_TOOL_NAMES.has(toolName)) {
          const evPkg = universalMcpGateway.executeUniversalTool(
            toolName as UniversalMCPToolName,
            toolArgs as Record<string, unknown>,
            provider,
            tenantId
          );
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(evPkg, null, 2),
                },
              ],
              structuredContent: evPkg,
              isError: false,
            },
          });
        }

        if (AGENTIC_RAG_MCP_TOOL_NAMES.has(toolName)) {
          const agOut = await executeAgenticRagMcpTool(
            toolName,
            toolArgs as Record<string, unknown>,
            tenantId
          );
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(agOut, null, 2),
                },
              ],
              structuredContent: agOut,
              isError: agOut.status === "error",
            },
          });
        }

        if (KNOWLEDGE_LIBRARY_MCP_TOOL_NAMES.has(toolName)) {
          const klOut = executeKnowledgeLibraryMcpTool(
            toolName,
            toolArgs as Record<string, unknown>,
            tenantId
          );
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(klOut, null, 2),
                },
              ],
              structuredContent: klOut,
              isError: klOut.status === "error" || klOut.status === "blocked_permission",
            },
          });
        }

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
    const toolName = String(body.tool || body.name || "reg24.list_modules");
    const input: MCPCommonInput = body.input || body.arguments || body;

    if (UNIVERSAL_10_TOOL_NAMES.has(toolName)) {
      const evPkg = universalMcpGateway.executeUniversalTool(
        toolName as UniversalMCPToolName,
        input as Record<string, unknown>,
        provider,
        tenantId
      );
      return NextResponse.json({
        status: "ok",
        verified_evidence_package: evPkg,
      });
    }

    if (AGENTIC_RAG_MCP_TOOL_NAMES.has(toolName)) {
      const agOut = await executeAgenticRagMcpTool(
        toolName,
        input as Record<string, unknown>,
        tenantId
      );
      return NextResponse.json(agOut);
    }

    if (KNOWLEDGE_LIBRARY_MCP_TOOL_NAMES.has(toolName)) {
      const klOut = executeKnowledgeLibraryMcpTool(
        toolName,
        input as Record<string, unknown>,
        tenantId
      );
      return NextResponse.json(klOut);
    }

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
