"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

type ThemeMode = "dark" | "light";
type AccentMode = "electric" | "chartreuse" | "highlighter" | "volt";
type LayoutMode = "min" | "max";
type LangMode = "th" | "en";
type NavKey =
  | "research"
  | "workspace"
  | "databases"
  | "notebook"
  | "mcp"
  | "developer"
  | "control"
  | "modules";
type ScopeMode = "all" | "rd" | "dika";
type ProviderKey = "chatgpt" | "claude" | "gemini" | "qwen" | "deepseek";
type PriorityKey = "best" | "balanced" | "cost";
type ModelKey = "auto" | "gemini" | "claude" | "gpt";

interface CitationItem {
  law: string;
  section: string;
}

interface ResearchResultState {
  q: string;
  loading?: boolean;
  done?: boolean;
  answer?: string;
  citations?: CitationItem[];
  note?: string;
}

const T = {
  th: {
    research: "ค้นคว้า",
    workspace: "พื้นที่ทำงาน",
    databases: "ฐานข้อมูล",
    mcp: "เชื่อมต่อ AI (MCP)",
    developer: "นักพัฒนา",
    control: "ผู้ดูแล",
    modules: "16 โมดูล",
    dark: "มืด",
    light: "สว่าง",
    views: "มุมมอง",
    heading: "มีคำถามกฎหมายเรื่องใดให้ช่วย?",
    sub: "ข้อมูลกฎหมายองค์กร การค้า และการกำกับดูแลของไทย",
    placeholder: "ถามเกี่ยวกับกฎหมาย คำวินิจฉัย คดี สัญญา หรือประเด็นธุรกิจ…",
    thailand: "ประเทศไทย",
    current: "กฎหมายปัจจุบัน",
    asOf: "กฎหมาย ณ ปี",
    upload: "อัปโหลดเอกสาร",
    notebook: "เชื่อมต่อ NotebookLM ของฉัน",
    llm: "เชื่อมต่อ ChatGPT · Claude · Gemini · Qwen · DeepSeek",
    ask: "ถาม REG24",
    qFind: "ค้นหากฎหมาย",
    qRuling: "วิเคราะห์คำวินิจฉัย",
    qResearch: "ค้นคว้าประเด็นกฎหมาย",
    dbList: "รายการฐานข้อมูลกฎหมาย (19 อุตสาหกรรม · 38 กฎหมาย)",
    gemini: "เชื่อมต่อ Gemini แล้ว (AQ.Ab8...SqEw)",
    footer: "REG24 · โครงสร้างพื้นฐานข้อมูลกฎหมาย",
    answer: "คำตอบ",
    clear: "ล้าง",
    loading: "กำลังค้นในกราฟกฎหมาย…",
    dbTitle: "โมดูลกฎหมายไทย P0",
    simple: "Simple Admin",
    simpleSub: "มุมมองเรียบง่ายสำหรับผู้ใช้ทั่วไป",
    expert: "Expert Engineering",
    expertSub: "แสดงรายละเอียดเชิงเทคนิคทั้งหมด",
    pFind: "กฎหมายใดกำหนดเรื่องการถือหุ้นของคนต่างด้าวในธุรกิจบริการ",
    pRuling: "สรุปแนวคำพิพากษาศาลฎีกาเรื่องความรับผิดของกรรมการบริษัทจำกัด",
    pResearch: "บริษัทจำกัดต้องมีผู้เริ่มก่อการอย่างน้อยกี่คน",
    cmdSearch: "ค้นกฎหมาย มาตรา คำพิพากษา หรือไปยังหน้าใดก็ได้…",
    nowBtn: "ปัจจุบัน",
    colLaw: "กฎหมาย",
    colSection: "มาตรา",
    colStatus: "สถานะ",
    colTitle: "ชื่อ",
    colCat: "หมวด",
    inForce: "มีผลบังคับใช้",
    recent: "งานค้นคว้าล่าสุด",
    srcTitle: "แหล่งข้อมูลที่ใช้ตอบ",
    sysTitle: "สถานะระบบ",
    aiTitle: "AI ที่เชื่อมต่อ",
    gResearch: "ค้นคว้า",
    gPlatform: "แพลตฟอร์ม",
    minimal: "เรียบง่าย",
    maximum: "เต็มรูปแบบ",
    m: [
      "กฎหมายบริษัท",
      "กฎหมายสัญญา",
      "ประมวลกฎหมายแพ่งและพาณิชย์",
      "กฎหมายภาษี",
      "กฎหมายแรงงาน",
      "การส่งเสริมการลงทุน (BOI)",
    ],
  },
  en: {
    research: "Research",
    workspace: "Workspace",
    databases: "Databases",
    mcp: "Connect AI (MCP)",
    developer: "Developer",
    control: "Control",
    modules: "16 Modules",
    dark: "Dark",
    light: "Light",
    views: "Views",
    heading: "What legal question can I help with?",
    sub: "Thai corporate, commercial and regulatory intelligence",
    placeholder: "Ask about a regulation, ruling, case, contract, or business issue…",
    thailand: "Thailand",
    current: "Current law",
    asOf: "Law as of",
    upload: "Upload document",
    notebook: "Connect My NotebookLM",
    llm: "Connect ChatGPT · Claude · Gemini · Qwen · DeepSeek",
    ask: "Ask REG24",
    qFind: "Find regulations",
    qRuling: "Analyze a ruling",
    qResearch: "Research a legal issue",
    dbList: "Legal Database List (19 Industries & 38 Laws)",
    gemini: "Gemini Connected (AQ.Ab8...SqEw)",
    footer: "REG24 · Legal Intelligence Infrastructure",
    answer: "Answer",
    clear: "Clear",
    loading: "Searching the legal graph…",
    dbTitle: "P0 Thai legal modules",
    simple: "Simple Admin",
    simpleSub: "Clean view for everyday users",
    expert: "Expert Engineering",
    expertSub: "Show full technical detail",
    pFind: "Which law governs foreign shareholding in service businesses?",
    pRuling: "Summarise Supreme Court rulings on director liability in limited companies",
    pResearch: "How many promoters does a Thai limited company need?",
    cmdSearch: "Search laws, sections, rulings, or jump to any page…",
    nowBtn: "Now",
    colLaw: "Law",
    colSection: "Section",
    colStatus: "Status",
    colTitle: "Title",
    colCat: "Category",
    inForce: "In force",
    recent: "Recent research",
    srcTitle: "Sources used to answer",
    sysTitle: "System status",
    aiTitle: "Connected AI",
    gResearch: "Research",
    gPlatform: "Platform",
    minimal: "Minimal",
    maximum: "Maximum",
    m: [
      "Corporate Law",
      "Contract Law",
      "Civil & Commercial Code",
      "Tax Law",
      "Labor Law",
      "BOI Investment Promotion",
    ],
  },
} as const;

const L = (th: string, en: string) => ({ th, en });

const P = {
  wsTitle: L("งานวิจัยที่บันทึกไว้", "Saved research, exports & handoff"),
  wsSub: L(
    "ประวัติการค้นคว้า โฟลเดอร์โครงการ ส่งออกรายงาน PDF/DOCX และส่งต่องานไปยัง LAW24",
    "Conversation history, project folders, bookmarks, PDF/DOCX exports, and LAW24 handoff."
  ),
  exportReady: L("พร้อมส่งออก", "Export ready"),
  reopen: L("เปิดอีกครั้ง", "Reopen"),
  handoffTitle: L("ส่งต่องานไปยัง LAW24", "Hand off to LAW24"),
  handoffSub: L(
    "ส่งผลการค้นคว้าที่ตรวจสอบแล้ว มาตราอ้างอิง และหน้าที่ตามกฎหมาย เข้าสู่ขั้นตอนงานกฎหมายใน LAW24",
    "Transfer verified findings, statutory citations, and compliance obligations into a LAW24 legal workflow."
  ),
  selected: L("งานที่เลือก", "Selected session"),
  handedOff: L("ส่งต่อแล้ว", "Handed off"),
  handoffBtn: L("ส่งต่องานนี้ไปยัง LAW24", "Hand off session to LAW24"),
  dbPageTitle: L("ฐานข้อมูลกฎหมายและข้อบังคับไทย", "Legal databases & regulatory directory"),
  dbPageSub: L(
    "เชื่อมโยงหน่วยงานกำกับดูแล พระราชบัญญัติ มาตรากฎหมาย คำพิพากษา และหน้าที่ตามกฎหมายครบทุกกลุ่ม",
    "Each database links official regulators, primary statutes, canonical provisions, and compliance obligations."
  ),
  dbSearch: L(
    "ค้นหาชื่อกฎหมาย เลขมาตรา หน่วยงาน (เช่น พ.ร.บ. ธุรกิจคนต่างด้าว, มาตรา 74, ฎีกา)…",
    "Filter by title, section, code, or keyword (e.g. Foreign Business Act, Section 74)…"
  ),
  dbEmpty: L("ไม่พบรายการที่ตรงกับตัวกรอง", "No records match this filter."),
  nbTitle: L("NotebookLM ของฉัน", "My NotebookLM"),
  nbSub: L(
    "เชื่อมสมุดบันทึกและแฟ้มเอกสารของคุณ ให้ทุกคำถามในหน้าค้นคว้าอ้างอิงเอกสารของคุณร่วมกับกฎหมายไทย",
    "Link your notebooks and legal binders so every Research query cross-references them alongside Thai law."
  ),
  nbNot: L("ยังไม่ได้เชื่อมต่อ NotebookLM", "NotebookLM not connected yet"),
  nbNotSub: L(
    "เปิดใช้งาน REG24 Connect เพื่อเชื่อมสมุดบันทึก NotebookLM และแฟ้มกฎหมายของคุณกับ REG24",
    "Activate REG24 Connect to link your NotebookLM notebooks and local legal binders with REG24."
  ),
  nbSupports: L(
    "รองรับ Chrome, Edge, Brave, Arc • และ iOS / Android PWA",
    "Supports Chrome, Edge, Brave, Arc • plus iOS / Android PWA"
  ),
  nbPaste: L(
    "หรือวางลิงก์สมุดบันทึกโดยตรง (มือถือและแท็บเล็ต)",
    "Or paste a shared notebook URL (phone & tablet)"
  ),
  nbConnectUrl: L("เชื่อมต่อลิงก์", "Connect URL"),
  nbActiveSub: L(
    "ทุกคำถามในหน้าค้นคว้าจะอ้างอิงสมุดบันทึกที่เปิดใช้งานโดยอัตโนมัติ",
    "Every Research query now cross-references your active binders."
  ),
  nbDisconnect: L("ตัดการเชื่อมต่อ", "Disconnect"),
  nbActiveAi: L("ใช้ร่วมกับ AI", "Active in AI"),
  nbNew: L("+ สร้างสมุดบันทึกใหม่", "+ New notebook binder"),
  mcpTitle: L("เชื่อมต่อ REG24 เข้ากับ AI ที่คุณใช้งาน", "Use REG24 legal intelligence in your preferred AI"),
  mcpSub: L(
    "ปัญญากฎหมายชุดเดียวกันผ่านทุก AI — รองรับ OAuth 2.1 + PKCE และส่งชุดหลักฐานที่ตรวจสอบได้ทุกครั้ง",
    "Same legal intelligence, different AI interfaces — OAuth 2.1 + PKCE ready, with a verified evidence package on every call."
  ),
  approach: L("แนวทางการเชื่อมต่อ", "Integration approach"),
  endpoint: L("Endpoint ที่ใช้งานจริง", "Live endpoint"),
  config: L("การตั้งค่า", "Config"),
  tools10: L("10 เครื่องมือกฎหมาย MCP", "10 universal legal MCP tools"),
  devTitle: L("API Gateway เครื่องมือ MCP และความสามารถของโมดูล", "API gateway, MCP tools & module capabilities"),
  devSub: L(
    "แยกจากหน้าค้นคว้าของนักกฎหมาย สำหรับทีมพัฒนาและผู้ดูแลระบบ",
    "Separated from the lawyer research interface — for engineering and platform teams."
  ),
  devPlayground: L("เปิด MCP & REST Playground (61 เครื่องมือ)", "Open MCP & REST Playground (61 tools)"),
  liveNodes: L("โหนดใน AuraDB", "Live AuraDB nodes"),
  orphan: L("โหนดกำพร้า", "Orphan nodes"),
  primaryModel: L("โมเดลหลัก", "Primary model"),
  reviewer: L("ผู้ตรวจข้ามผู้ให้บริการ", "Cross-provider reviewer"),
  ctlKicker: L("REG24 DIRECT / โหมดใช้งานง่าย", "REG24 DIRECT / EASY MODE"),
  ctlTitle: L("เลือกจุดเริ่มต้นของคุณ", "Choose a starting point"),
  ctlSub: L(
    "เลือกหนึ่งภารกิจ ระบบจะพาท่านไปยังเครื่องมือพร้อมหลักฐานอ้างอิงทันที",
    "Pick one task. REG24 takes you straight to it."
  ),
  modTitle: L("โครงสร้างพื้นฐาน 16 โมดูล", "16-module infrastructure"),
  modSub: L(
    "มุมมองผู้เชี่ยวชาญ — คอนโซล เกตเวย์ และภารกิจเฉพาะทางทั้งหมดของ REG24",
    "Expert view — every REG24 console, gateway and specialised mission."
  ),
} as const;

const CATS: Array<[string, string, string]> = [
  ["all", "ทั้งหมด", "All"],
  ["authorities", "หน่วยงาน", "Authorities"],
  ["industries", "อุตสาหกรรม", "Industries"],
  ["modules", "โมดูล", "Modules"],
  ["statutes", "ตัวบทกฎหมาย", "Statutes"],
  ["cases", "คำพิพากษาและข้อหารือ", "Cases & rulings"],
  ["temporal", "กราฟเวลา", "Temporal graph"],
];

const RECS: Array<[string, string, string, string, "f" | "s" | "a"]> = [
  ["FBA-2542", "statutes", "พ.ร.บ. การประกอบธุรกิจของคนต่างด้าว พ.ศ. 2542", "Foreign Business Act B.E. 2542 (1999)", "f"],
  ["CCC-B3", "statutes", "ประมวลกฎหมายแพ่งและพาณิชย์ บรรพ 3", "Civil and Commercial Code, Book III", "f"],
  ["PLCA-2535", "statutes", "พ.ร.บ. บริษัทมหาชนจำกัด พ.ศ. 2535", "Public Limited Companies Act B.E. 2535", "f"],
  ["RC", "statutes", "ประมวลรัษฎากร", "Revenue Code", "f"],
  ["PDPA-2562", "statutes", "พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562", "Personal Data Protection Act B.E. 2562", "f"],
  ["DBD", "authorities", "กรมพัฒนาธุรกิจการค้า", "Department of Business Development", "a"],
  ["RD", "authorities", "กรมสรรพากร", "Revenue Department", "a"],
  ["BOI", "authorities", "สำนักงานคณะกรรมการส่งเสริมการลงทุน", "Board of Investment", "a"],
  ["IND-ENERGY", "industries", "อุตสาหกรรมพลังงาน — กกพ. BOI ใบอนุญาต", "Energy — ERC licensing, BOI, permits", "a"],
  ["reg24.corporate.th", "modules", "โมดูลกฎหมายบริษัท (P0-01)", "Corporate Law module (P0-01)", "a"],
  ["reg24.tax.th", "modules", "โมดูลกฎหมายภาษี (P0-04)", "Tax Law module (P0-04)", "a"],
  [
    "case.th.dika.2845_2564",
    "cases",
    "คำพิพากษาศาลฎีกาที่ 2845/2564 — รายจ่ายต้องห้าม มาตรา 65 ตรี",
    "Supreme Court Dika 2845/2564 — non-deductible expenses, Sec. 65 ter",
    "f",
  ],
  ["ruling.th.rd.462_2569", "cases", "ข้อหารือกรมสรรพากร 462/2569", "Revenue Department ruling 462/2569", "f"],
  ["ccc1097.v2023", "temporal", "ป.พ.พ. มาตรา 1097 — ผู้เริ่มก่อการ (ฉบับแก้ไข)", "CCC Sec. 1097 — promoters (amended version)", "f"],
  ["ccc1097.v1", "temporal", "ป.พ.พ. มาตรา 1097 — ผู้เริ่มก่อการ (ฉบับเดิม)", "CCC Sec. 1097 — promoters (original version)", "s"],
];

const ST = {
  f: L("มีผลบังคับใช้", "Active in force"),
  s: L("ถูกแก้ไขทับแล้ว", "Superseded / amended"),
  a: L("เปิดใช้งาน", "Active"),
} as const;

const SESS: Array<[string, string, string, string, string, number, number]> = [
  [
    "WS-0142",
    "legal_due_diligence",
    "2026-10-20",
    "ซื้อกิจการโรงไฟฟ้าพลังงานแสงอาทิตย์: BOI ใบอนุญาต กกพ. แรงงาน และ PDPA",
    "Solar power plant acquisition: BOI, ERC licensing, labor & PDPA",
    8,
    12,
  ],
  [
    "WS-0139",
    "tax_precedent",
    "2026-10-18",
    "ภาษีมูลค่าเพิ่มและหัก ณ ที่จ่าย ค่าบริการซอฟต์แวร์ต่างประเทศ (มาตรา 70)",
    "VAT & WHT on foreign software services (Sec. 70)",
    5,
    7,
  ],
  [
    "WS-0131",
    "restructuring",
    "2026-10-15",
    "ซื้อหุ้นหรือซื้อทรัพย์สิน — การควบรวม A+B=A",
    "Share vs. asset acquisition — merger A+B=A",
    11,
    15,
  ],
  [
    "WS-0127",
    "labor",
    "2026-10-12",
    "เลิกจ้างโดยไม่จ่ายค่าชดเชยได้หรือไม่ — พ.ร.บ.คุ้มครองแรงงาน มาตรา 118",
    "Can a company terminate without severance? — LPA Sec. 118",
    4,
    6,
  ],
];

const NB: Array<[string, string, number]> = [
  ["แฟ้มสัญญาเช่าที่ดินและโรงงาน EEC 2569", "EEC Industrial Lease & Tax Binder 2026", 14],
  ["ห้องข้อมูลซื้อกิจการโรงไฟฟ้าโซลาร์", "Solar plant acquisition data room", 22],
  ["ภาษีค่าบริการซอฟต์แวร์ต่างประเทศ ม.70", "Foreign software services tax — Sec. 70", 6],
];

const NBSTEPS: Array<[string, string, string, string, string]> = [
  [
    "01",
    "เชื่อมต่อผ่าน REG24 Connect",
    "Connect via REG24 Connect",
    "ซิงก์สมุดบันทึก NotebookLM ของคุณบน Chrome, Edge, Brave หรือ Arc",
    "Sync your NotebookLM binders on Chrome, Edge, Brave, or Arc.",
  ],
  [
    "02",
    "วางลิงก์หรือเพิ่มเอกสารโดยตรง",
    "Direct URL or clause import",
    "บนมือถือและแท็บเล็ต วางลิงก์ NotebookLM หรือเพิ่มข้อความสัญญาได้ทันที ไม่ต้องใช้ส่วนขยาย",
    "On phone or tablet, paste a NotebookLM share link or add clauses directly — no extension needed.",
  ],
  [
    "03",
    "วิเคราะห์ร่วมกับกฎหมายไทย",
    "Dual-evidence legal analysis",
    "AI ตรวจข้อเท็จจริงในเอกสารของคุณเทียบกับประมวลรัษฎากร พ.ร.บ. และข้อหารือกรมสรรพากร 3,643 ฉบับ",
    "REG24 cross-examines your clauses against 3,643 Revenue Department rulings and Thai statutes.",
  ],
];

const MCP_URL = "https://reg24-theta.vercel.app/api/mcp";

const PROV: Record<ProviderKey, [string, string, string, string, string]> = {
  chatgpt: [
    "OpenAI ChatGPT",
    "OpenAI",
    "Direct remote MCP; OpenAI Responses API",
    MCP_URL,
    `tools: [\n  {\n    "type": "mcp",\n    "server_label": "reg24",\n    "server_url": "${MCP_URL}",\n    "require_approval": "never"\n  }\n]`,
  ],
  claude: [
    "Claude",
    "Anthropic",
    "Direct remote MCP; Claude API & Claude Desktop/Web",
    MCP_URL,
    `{\n  "mcpServers": {\n    "reg24": {\n      "type": "http",\n      "url": "${MCP_URL}"\n    }\n  }\n}`,
  ],
  gemini: [
    "Google Gemini",
    "Google",
    "Remote MCP on compatible endpoints/models; Gemini SDK",
    MCP_URL,
    `mcp_servers: [\n  {\n    "name": "reg24",\n    "url": "${MCP_URL}"\n  }\n]`,
  ],
  qwen: [
    "Qwen",
    "Alibaba Cloud",
    "Model Studio Responses API supports MCP via SSE",
    MCP_URL,
    `tools: [\n  {\n    "type": "mcp",\n    "server_label": "reg24",\n    "server_url": "${MCP_URL}",\n    "transport": "sse"\n  }\n]`,
  ],
  deepseek: [
    "DeepSeek",
    "DeepSeek",
    "Function calling through application orchestration",
    `${MCP_URL}?format=deepseek_tools`,
    `{\n  "model": "deepseek-reasoner",\n  "tools_schema_endpoint":\n    "${MCP_URL}?format=deepseek_tools"\n}`,
  ],
};

const TOOLS: Array<[string, string, string]> = [
  ["reg24_search_law", "ค้นหากฎหมาย", "Search statutes"],
  ["reg24_get_provision", "ดึงข้อความมาตรา ณ วันที่", "Get a provision as of a date"],
  ["reg24_search_cases", "ค้นคำพิพากษาและข้อหารือ", "Search cases & rulings"],
  ["reg24_graph_reason", "ให้เหตุผลบนกราฟกฎหมาย", "Reason over the legal graph"],
  ["reg24_check_compliance", "ตรวจสอบการปฏิบัติตามกฎหมาย", "Check compliance"],
  ["reg24_verify_citation", "ยืนยันแหล่งอ้างอิง", "Verify a citation"],
  ["reg24_analyze_contract", "วิเคราะห์สัญญา", "Analyze a contract"],
  ["reg24_corporate_advisor", "ที่ปรึกษากฎหมายบริษัท", "Corporate advisor"],
  ["reg24_tax_advisor", "ที่ปรึกษาภาษี", "Tax advisor"],
  ["reg24_regulatory_watch", "ติดตามการเปลี่ยนแปลงกฎหมาย", "Regulatory watch"],
];

const DEVCAPS: Array<[string, string, string, string, string]> = [
  [
    "REST API และการยืนยันตัวตน",
    "REST API & authentication",
    "API key แยกตามเทนแนนต์ จำกัดอัตราการเรียก และให้ผลตรงกับหน้าค้นคว้า",
    "Tenant-scoped API keys, rate limiting, and deterministic parity with REG24 Research.",
    "REST /api/v1",
  ],
  [
    "Model Context Protocol (MCP)",
    "Model Context Protocol (MCP)",
    "เซิร์ฟเวอร์ MCP แบบ JSON-RPC 2.0 สำหรับเอเจนต์ AI ภายนอกและการมอบหมายงาน A2A",
    "JSON-RPC 2.0 MCP server for third-party AI agents and A2A task delegation.",
    "POST /api/mcp",
  ],
  [
    "การเชื่อมต่อระบบนิเวศ VIBE24",
    "VIBE24 ecosystem integrations",
    "ปัญญากฎหมายชุดเดียวกันสำหรับทุกผลิตภัณฑ์ในตระกูล 24",
    "Shared legal intelligence for every product in the 24 family.",
    "LAW24 · CFO24 · ACC24 · TP24 · GOV24 · TRACE24",
  ],
];

const PRIO: Array<[PriorityKey, string, string]> = [
  ["best", "คุณภาพที่ตรวจสอบได้สูงสุด (ค่าเริ่มต้น)", "Best verified legal quality (default)"],
  ["balanced", "สมดุลคุณภาพและต้นทุน", "Balanced quality & cost"],
  ["cost", "ต้นทุนต่ำสุดที่ผ่านเกณฑ์", "Lowest cost meeting threshold"],
];

const TASKS: Array<[string, string, string, string, string, string, string, string, NavKey | "timemachine"]> = [
  [
    "01 / การมองเห็นและวิจัยกฎหมาย AI",
    "01 / VISIBILITY",
    "ตรวจสอบว่ากฎหมายไทยมีผลต่อธุรกิจของฉันอย่างไร",
    "Check how Thai law sees my business",
    "ถามข้อกฎหมายภาษาไทยหรืออังกฤษ และตรวจสอบคำพิพากษาพร้อมล็อกแหล่งอ้างอิง",
    "Check your statutory exposure, court precedents, and saved AI legal answers.",
    "เริ่มวิจัยข้อกฎหมาย",
    "Check visibility",
    "research",
  ],
  [
    "02 / คลังตัวบทกฎหมายและคำพิพากษา",
    "02 / STATUTES, CASES & RULINGS",
    "ค้นหากฎหมาย คำพิพากษาศาลฎีกา และข้อหารือภาษี",
    "Search statutes, cases, and tax rulings",
    "ค้นหา 7 หมวดหมู่และเปิดอ่านตัวบทต้นฉบับเทียบกับคำอธิบาย AI",
    "Search 7 legal categories and inspect original text vs AI interpretation.",
    "ค้นหาคลังกฎหมาย",
    "Search corpus",
    "databases",
  ],
  [
    "03 / ตรวจสอบข้อเท็จจริง",
    "03 / FIX INFORMATION",
    "แก้ไขข้อเท็จจริงหรือเทียบเวลา",
    "Fix wrong or missing facts",
    "ตรวจสอบช่องว่างข้อเท็จจริงและเปรียบเทียบกฎหมายย้อนหลังกับปัจจุบัน",
    "Review missing-fact gaps and compare historical vs current provisions.",
    "ตรวจสอบการแก้ไข",
    "Review fixes",
    "timemachine",
  ],
  [
    "04 / ผลลัพธ์และรายงาน",
    "04 / RESULTS",
    "ดูหน้าที่ตามกฎหมายและส่งออก",
    "See compliance & export memo",
    "ดูรายการหน้าที่ตามกฎหมาย กราฟความสัมพันธ์ และส่งออก PDF/DOCX",
    "See recorded obligations, graph links, and PDF/DOCX legal evidence.",
    "ดูผลลัพธ์",
    "See outcomes",
    "workspace",
  ],
];

const CTLSTATS: Array<[string, string, string]> = [
  ["องค์กร / เทนแนนต์", "Business", "tenant.law24.prod"],
  ["การตรวจสอบแหล่งอ้างอิงล่าสุด", "Last statutory & case scan", "2026-10-20"],
  ["แหล่งข้อมูลกฎหมายใน REG24", "REG24 hosted authorities", "17"],
  ["รายการที่ต้องตรวจสอบ", "Drafts needing attention", "0"],
];

const TILES: Array<[string, string, string, NavKey?]> = [
  ["START", "หน้าหลักเลือกภารกิจ (REG24 Direct)", "Starting point hub", "control"],
  ["WEB-001", "ระบบค้นคว้าและวิจัยกฎหมายทางเว็บ", "Web research studio", "research"],
  ["PRD-V2", "ปัญญากฎหมายธุรกิจและอุตสาหกรรม", "v2.0 corporate & industry hub", "databases"],
  ["SCR-M", "คลังคำพิพากษาศาลฎีกาและบรรทัดฐาน", "Court case intelligence", "databases"],
  ["SCR-L", "คุ้มครองข้อมูลส่วนบุคคล PDPA & สคส. 2569", "PDPA & 2026 DSAR", "databases"],
  ["SCR-K", "ข้อหารือกรมสรรพากร & กฎหมายลำดับรอง", "Tax rulings & sub-regs", "databases"],
  ["SCR-J", "ปรับโครงสร้างหนี้ & ตลาดทุน", "Capital markets & restructuring", "databases"],
  ["SCR-A", "ทะเบียนโมดูลกฎหมาย P0", "Module registry", "databases"],
  ["SCR-B", "สร้างและติดตั้งโมดูลใหม่", "Module factory", "developer"],
  ["SCR-C", "แหล่งข้อมูลและหลักฐานอ้างอิง", "Legal sources", "databases"],
  ["SCR-D", "ไฮบริด GraphRAG 3R และกราฟกฎหมาย", "3R GraphRAG & graph", "developer"],
  ["SCR-E", "กฎคำนวณอัตโนมัติ (Law-as-Code)", "Rule studio", "research"],
  ["SCR-F", "ตรวจจับการแก้ไขกฎหมาย", "Change intelligence", "control"],
  ["SCR-G", "เกตเวย์ MCP 2026 & REST", "MCP & API gateway", "mcp"],
  ["SCR-I", "การมอบหมายงานข้ามเอเจนต์ (A2A)", "A2A agent hub", "developer"],
  ["SCR-H", "ตรวจสอบย้อนกลับ TRACE24", "Trace & audit", "workspace"],
];

const MODS: Array<[string, string]> = [
  ["P0-01", "reg24.corporate.th"],
  ["P0-02", "reg24.contract.th"],
  ["P0-03", "reg24.civil.th"],
  ["P0-04", "reg24.tax.th"],
  ["P0-05", "reg24.labor.th"],
  ["P0-06", "reg24.boi.th"],
];

export default function Reg24ModernistPage() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [accent] = useState<AccentMode>("electric");
  const [lang, setLang] = useState<LangMode>("th");
  const [nav, setNav] = useState<NavKey>("research");
  const [mode, setMode] = useState<LayoutMode>("min");
  const [query, setQuery] = useState<string>("");
  const [chips, setChips] = useState<{
    upload: boolean;
    notebook: boolean;
    llm: boolean;
    tm: boolean;
    tech: boolean;
  }>({
    upload: false,
    notebook: false,
    llm: false,
    tm: false,
    tech: true,
  });
  const [year, setYear] = useState<number>(2026);
  const [dbOpen, setDbOpen] = useState<boolean>(false);
  const [result, setResult] = useState<ResearchResultState | null>(null);
  const [traceN, setTraceN] = useState<number>(0);
  const [traceMs, setTraceMs] = useState<number>(0);
  const [sel, setSel] = useState<number>(0);
  const [exportFile, setExportFile] = useState<string | null>(null);
  const [handed, setHanded] = useState<Record<string, boolean>>({});
  const [dbQuery, setDbQuery] = useState<string>("");
  const [dbCat, setDbCat] = useState<string>("all");
  const [nbState, setNbState] = useState<"off" | "connecting" | "on">("off");
  const [nbOn, setNbOn] = useState<boolean[]>([true, true, false]);
  const [prov, setProv] = useState<ProviderKey>("claude");
  const [copied, setCopied] = useState<boolean>(false);
  const [diag, setDiag] = useState<"idle" | "running" | "done">("idle");
  const [prio, setPrio] = useState<PriorityKey>("best");
  const [scope, setScope] = useState<ScopeMode>("all");
  const [srcOn, setSrcOn] = useState<boolean[]>([true, true, true, true, true, true]);
  const [model, setModel] = useState<ModelKey>("auto");

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const taMaxRef = useRef<HTMLTextAreaElement | null>(null);
  const trIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = T[lang];
  const isTh = lang === "th";
  const isMax = mode === "max";
  const isMin = !isMax;

  const scopePh =
    scope === "rd"
      ? isTh
        ? "ค้นเฉพาะข้อหารือกรมสรรพากร เช่น ภาษีหัก ณ ที่จ่าย ค่าบริการต่างประเทศ…"
        : "Search RD rulings only, e.g. WHT on foreign services…"
      : scope === "dika"
      ? isTh
        ? "ค้นเฉพาะคำพิพากษาศาลฎีกา เช่น ความรับผิดของกรรมการ…"
        : "Search Supreme Court (Dika) only, e.g. director liability…"
      : t.placeholder;

  const goto = useCallback((k: NavKey) => {
    setNav(k);
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  }, []);

  const focusInput = useCallback(
    (targetMode?: LayoutMode) => {
      setTimeout(() => {
        const activeMode = targetMode ?? mode;
        const el = activeMode === "max" ? taMaxRef.current : taRef.current;
        if (el) el.focus();
      }, 40);
    },
    [mode]
  );

  const focusSearch = useCallback(() => {
    goto("research");
    setTimeout(() => {
      const el = mode === "max" ? taMaxRef.current : taRef.current;
      if (el) el.focus();
    }, 60);
  }, [goto, mode]);

  // Sync document root theme class
  useEffect(() => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (theme === "dark") {
        root.classList.add("dark");
        root.classList.remove("light");
        root.style.colorScheme = "dark";
      } else {
        root.classList.add("light");
        root.classList.remove("dark");
        root.style.colorScheme = "light";
      }
    }
  }, [theme]);

  // Global Cmd/Ctrl + K shortcut
  useEffect(() => {
    const onKeyK = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKeyK);
    return () => window.removeEventListener("keydown", onKeyK);
  }, [focusSearch]);

  // Animated placeholder typer from REG24 Redesign v2.dc.html
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let pi = 0;
    let ci = 0;
    let dir = 1;

    const step = () => {
      const el = taRef.current;
      const tt = T[lang];
      const list = [tt.pResearch, tt.pFind, tt.pRuling];
      let delay = 45;

      if (el && !query && scope === "all" && document.activeElement !== el) {
        const full = list[pi % list.length];
        if (ci > full.length) ci = full.length;
        if (dir === 1) {
          ci++;
          if (ci >= full.length) {
            dir = 0;
            delay = 2200;
          }
        } else if (dir === 0) {
          dir = -1;
          delay = 30;
        } else {
          ci -= 2;
          delay = 16;
          if (ci <= 0) {
            ci = 0;
            dir = 1;
            pi++;
            delay = 450;
          }
        }
        el.placeholder = full.slice(0, ci) + (dir === 1 ? "▍" : "");
      } else if (el) {
        el.placeholder = scopePh;
      }
      typeTimeoutRef.current = setTimeout(step, delay);
    };

    typeTimeoutRef.current = setTimeout(step, 1200);
    return () => {
      if (typeTimeoutRef.current) clearTimeout(typeTimeoutRef.current);
    };
  }, [lang, query, scope, scopePh]);

  const runAsk = useCallback(
    async (overrideQuery?: string) => {
      const tt = T[lang];
      const q = (overrideQuery ?? query).trim() || tt.pResearch;
      const asOfDate = chips.tm ? `${year}-05-01` : "2026-10-22";
      const t0 = Date.now();

      if (trIntervalRef.current) clearInterval(trIntervalRef.current);
      setResult({ q, loading: true });
      setTraceN(0);

      trIntervalRef.current = setInterval(() => {
        setTraceN((prev) => Math.min(prev + 1, 4));
      }, 440);

      const isPre2023PromoterQuery =
        chips.tm &&
        year < 2023 &&
        (q.includes("ผู้เริ่มก่อการ") || q.toLowerCase().includes("promoter") || q.includes("1097"));

      const fallback: { answer: string; citations: CitationItem[]; note: string } =
        lang === "th"
          ? {
              answer: isPre2023PromoterQuery
                ? ` ณ ปี ค.ศ. ${year} (ก่อนการแก้ไข ป.พ.พ. พ.ศ. 2565 มีผล 7 ก.พ. 2566) บริษัทจำกัดต้องมีผู้เริ่มก่อการอย่างน้อย 3 คนขึ้นไปเข้าชื่อกันทำหนังสือบริคณห์สนธิ`
                : "บริษัทจำกัดต้องมีผู้เริ่มก่อการอย่างน้อย 2 คน ตามประมวลกฎหมายแพ่งและพาณิชย์ที่แก้ไขเพิ่มเติม (เดิมกำหนด 3 คน)",
              citations: [{ law: "ป.พ.พ.", section: "มาตรา 1097" }],
              note: "ตัวอย่างคำตอบ — ไม่ใช่คำปรึกษาทางกฎหมาย",
            }
          : {
              answer: isPre2023PromoterQuery
                ? `As of ${year} (prior to the Civil and Commercial Code Amendment Act B.E. 2565 effective 7 Feb 2023), a Thai limited company required at least 3 promoters.`
                : "A Thai limited company needs at least 2 promoters under the amended Civil and Commercial Code (previously 3).",
              citations: [{ law: "CCC", section: "Sec. 1097" }],
              note: "Sample answer — not legal advice.",
            };

      if (scope === "rd") {
        fallback.answer =
          lang === "th"
            ? "ค้นเฉพาะข้อหารือกรมสรรพากร: พบข้อหารือที่เกี่ยวข้องกับคำถามนี้ ดูเลขที่ข้อหารือด้านล่าง"
            : "RD rulings only: found Revenue Department rulings related to this question — see ruling numbers below.";
        fallback.citations = [{ law: lang === "th" ? "ข้อหารือกรมสรรพากร" : "RD ruling", section: "462/2569" }];
      } else if (scope === "dika") {
        fallback.answer =
          lang === "th"
            ? "ค้นเฉพาะคำพิพากษาศาลฎีกา: พบคำพิพากษาที่เกี่ยวข้องกับคำถามนี้ ดูเลขที่คำพิพากษาด้านล่าง"
            : "Dika only: found Supreme Court judgments related to this question — see judgment numbers below.";
        fallback.citations = [
          { law: lang === "th" ? "คำพิพากษาศาลฎีกา" : "Supreme Court (Dika)", section: "2845/2564" },
        ];
      }

      let finalPayload = fallback;

      try {
        const res = await fetch("/api/v1/legal/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            as_of_date: asOfDate,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const hits = data?.result?.hits;
          if (Array.isArray(hits) && hits.length > 0 && scope === "all") {
            const top = hits[0];
            const text = lang === "th" ? top.text_th || top.summary_th : top.text_en || top.summary_en;
            if (text && q !== tt.pResearch) {
              finalPayload = {
                answer: text,
                citations: hits.slice(0, 3).map((h: { instrument_title_th?: string; instrument_title_en?: string; section_label?: string; provision_id?: string }) => ({
                  law:
                    (lang === "th" ? h.instrument_title_th : h.instrument_title_en) ||
                    (lang === "th" ? "กฎหมายไทย" : "Thai Law"),
                  section: h.section_label || h.provision_id || "Section",
                })),
                note:
                  lang === "th"
                    ? `ตรวจสอบแหล่งอ้างอิง SHA-256 แล้ว · ข้อมูล ณ ${asOfDate}`
                    : `SHA-256 provenance verified · Law as of ${asOfDate}`,
              };
            }
          }
        }
      } catch {
        // Fallback to deterministic design response
      }

      const wait = Math.max(0, 1200 - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
      if (trIntervalRef.current) clearInterval(trIntervalRef.current);

      setResult({
        q,
        done: true,
        answer: finalPayload.answer,
        citations: finalPayload.citations,
        note: finalPayload.note,
      });
      setTraceN(5);
      setTraceMs(Date.now() - t0);
    },
    [chips.tm, lang, query, scope, year]
  );

  const askWith = useCallback(
    (qText: string) => {
      setNav("research");
      setQuery(qText);
      if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
      }
      runAsk(qText);
    },
    [runAsk]
  );

  // Derived values matching REG24 Redesign v2.dc.html `renderVals()`
  const tint = "color-mix(in srgb,var(--color-text) 6%,transparent)";
  const MUT = "color-mix(in srgb,var(--color-text) 62%,transparent)";
  const pill = (on: boolean) => ({
    bg: on ? "var(--color-accent)" : tint,
    fg: on ? "var(--on-accent)" : "var(--color-text)",
  });

  const curSession = SESS[sel] || SESS[0];
  const qFilter = dbQuery.trim().toLowerCase();
  const dbRows = RECS.filter(
    (r) =>
      (dbCat === "all" || r[1] === dbCat) &&
      (!qFilter || (r[0] + r[2] + r[3]).toLowerCase().includes(qFilter))
  ).map((r) => {
    const catTuple = CATS.find((c) => c[0] === r[1]) || CATS[0];
    return {
      code: r[0],
      title: isTh ? r[2] : r[3],
      cat: catTuple[isTh ? 1 : 2],
      status: ST[r[4]][lang],
      tagCls: r[4] === "s" ? "tag-neutral" : "tag-accent",
      ask: () => askWith(isTh ? `สรุปสาระสำคัญของ ${r[2]}` : `Summarise the key points of ${r[3]}`),
    };
  });

  const pv = PROV[prov];
  const asOfD = chips.tm ? `${year}-01-01` : "2026-10-22";
  const TR = isTh
    ? [
        "แยกเจตนาคำถาม → reg24.corporate.th",
        `ค้นกราฟกฎหมายสองมิติเวลา · as_of ${asOfD}`,
        scope === "rd"
          ? "ค้นเฉพาะข้อหารือกรมสรรพากร · 3,643 ฉบับ"
          : scope === "dika"
          ? "ค้นเฉพาะคำพิพากษาศาลฎีกา · Dika"
          : "ดึงมาตราและคำพิพากษา · 3R GraphRAG",
        "ตรวจแหล่งอ้างอิง · SHA-256 provenance",
        "สรุปคำตอบพร้อมมาตราอ้างอิง",
      ]
    : [
        "Parse intent → reg24.corporate.th",
        `Traverse bi-temporal graph · as_of ${asOfD}`,
        scope === "rd"
          ? "Search RD rulings only · 3,643 rulings"
          : scope === "dika"
          ? "Search Supreme Court (Dika) only"
          : "Retrieve provisions & rulings · 3R GraphRAG",
        "Verify citations · SHA-256 provenance",
        "Compose cited answer",
      ];

  const ncit = result?.citations?.length ?? 0;
  const trace = TR.map((x, i) => ({
    text: x,
    mark: i < traceN ? "✓" : i === traceN ? "›" : "·",
    color:
      i < traceN
        ? "var(--color-text)"
        : i === traceN
        ? "var(--color-accent)"
        : "color-mix(in srgb,var(--color-text) 38%,transparent)",
  }));

  const traceSummary = `trace · parse → graph → retrieve → verify → compose · ${((traceMs || 0) / 1000).toFixed(1)}s · ${ncit} ${
    isTh ? "แหล่งอ้างอิง" : "citations"
  }`;

  const TMOD = ["intent.router", "graph.bitemporal", "rag.3r", "verify.sha256", "compose.llm"];
  const TW = [0.06, 0.2, 0.34, 0.12, 0.28];
  const traceRows = TR.map((x, i) => ({
    n: String(i + 1).padStart(2, "0"),
    text: x,
    mod: TMOD[i],
    ms: traceMs ? String(Math.round(traceMs * TW[i])) : "—",
  }));

  const navItem = (k: NavKey) => ({
    go: () => goto(k),
    on: nav === k,
    bg: nav === k ? "color-mix(in srgb,var(--accent-ink) 13%,transparent)" : "transparent",
    fg: nav === k ? "var(--color-accent-700)" : MUT,
  });

  const sideItem = (k: NavKey, num: string, count: string) => ({
    num,
    count,
    label: k === "notebook" ? "NotebookLM" : t[k],
    go: () => goto(k),
    bg: nav === k ? "color-mix(in srgb,var(--accent-ink) 13%,transparent)" : "transparent",
    fg: nav === k ? "var(--color-accent-700)" : "var(--color-text)",
    numFg: nav === k ? "var(--accent-ink)" : MUT,
  });

  const sideGroups = [
    {
      label: t.gResearch,
      items: [
        sideItem("research", "01", ""),
        sideItem("workspace", "02", String(SESS.length)),
        sideItem("databases", "03", "38"),
      ],
    },
    {
      label: "AI",
      items: [
        sideItem("notebook", "04", String(NB.length)),
        sideItem("mcp", "05", String(Object.keys(PROV).length)),
      ],
    },
    {
      label: t.gPlatform,
      items: [
        sideItem("developer", "06", ""),
        sideItem("control", "07", ""),
        sideItem("modules", "08", "16"),
      ],
    },
  ];

  const PM: Record<NavKey, string> = {
    research: "WEB-001",
    workspace: "WS-15",
    databases: "SCR-A",
    notebook: "NB-LM",
    mcp: "SCR-G",
    developer: "REG-NEO-014",
    control: "START",
    modules: "ALL-16",
  };
  const GRP: Record<NavKey, string> = {
    research: t.gResearch,
    workspace: t.gResearch,
    databases: t.gResearch,
    notebook: "AI",
    mcp: "AI",
    developer: t.gPlatform,
    control: t.gPlatform,
    modules: t.gPlatform,
  };
  const pageMeta = {
    code: PM[nav],
    group: GRP[nav],
    title: nav === "notebook" ? "NotebookLM" : t[nav],
  };

  const shell = {
    rootBg: isMax ? "var(--canvas)" : "var(--color-bg)",
    panelMargin: isMax ? "0 10px 0 0" : "0",
    panelShadow: isMax ? "var(--shadow-sm)" : "none",
    mainMax: isMax ? "none" : "1200px",
    mainPad: isMax
      ? "24px clamp(16px,2.5vw,32px) 48px"
      : "clamp(40px,7vh,72px) clamp(16px,4vw,40px) 64px",
    strip: isMax && (nav === "research" || nav === "databases"),
  };

  const scopeBtns = (
    [
      [
        "rd",
        isTh ? "ค้นข้อหารือสรรพากร" : "RD rulings only",
        isTh ? "ค้นเฉพาะข้อหารือกรมสรรพากร (3,643 ฉบับ)" : "Search Revenue Department rulings only (3,643)",
      ],
      [
        "dika",
        isTh ? "ค้นคำพิพากษาฎีกา" : "Dika only",
        isTh ? "ค้นเฉพาะคำพิพากษาศาลฎีกา" : "Search Supreme Court (Dika) judgments only",
      ],
    ] as const
  ).map(([v, label, hint]) => ({
    v,
    label,
    hint,
    isRd: v === "rd",
    isDika: v === "dika",
    on: scope === v,
    bg: scope === v ? "var(--color-accent)" : tint,
    fg: scope === v ? "var(--on-accent)" : "var(--color-text)",
    pick: () => {
      setScope((prev) => (prev === v ? "all" : v));
      focusInput();
    },
  }));

  const scopeTag =
    scope === "rd"
      ? isTh
        ? "ข้อหารือกรมสรรพากร"
        : "RD RULINGS"
      : scope === "dika"
      ? isTh
        ? "คำพิพากษาศาลฎีกา"
        : "DIKA"
      : t.thailand;

  const ctxLabel = `${scope === "all" ? t.thailand : scopeTag} · ${
    chips.tm ? `${t.asOf} ${year}` : t.current
  }`;
  const asOfLabel = chips.tm ? `${t.asOf} ${year}` : t.current;

  const chipV = (k: keyof typeof chips) => ({
    toggle: () => setChips((prev) => ({ ...prev, [k]: !prev[k] })),
    bg: chips[k] ? "color-mix(in srgb,var(--accent-ink) 14%,transparent)" : "transparent",
    fg: chips[k] ? "var(--color-accent-700)" : "color-mix(in srgb,var(--color-text) 60%,transparent)",
  });

  const chipTitle = {
    upload: t.upload,
    notebook: t.notebook,
    llm: t.llm,
    tm: "Bi-Temporal Graph Time-Machine (2001–2026)",
    tech: "12-Tech Legal AI (REG-AI-01..12 + UAT A–G)",
  };

  const chipKeys: Array<keyof typeof chips> = ["upload", "notebook", "llm", "tm", "tech"];
  const chipLbl: Record<keyof typeof chips, string> = {
    upload: t.upload,
    notebook: t.notebook,
    llm: t.llm,
    tm: "Bi-Temporal Graph Time-Machine",
    tech: "12-Tech Legal AI (REG-AI-01..12)",
  };
  const chipRows = chipKeys.map((k) => ({
    key: k,
    label: chipLbl[k],
    state: chips[k] ? "ON" : "OFF",
    toggle: () => setChips((prev) => ({ ...prev, [k]: !prev[k] })),
    bg: chips[k]
      ? "color-mix(in srgb,var(--accent-ink) 14%,transparent)"
      : "color-mix(in srgb,var(--color-text) 5%,transparent)",
    fg: chips[k] ? "var(--color-accent-700)" : MUT,
    dot: chips[k] ? "var(--accent-ink)" : "var(--color-neutral-400)",
  }));

  const modeOpts = (
    [
      ["min", t.minimal],
      ["max", t.maximum],
    ] as const
  ).map(([v, label]) => ({
    v,
    label,
    on: mode === v,
    isMin: v === "min",
    isMax: v === "max",
    pick: () => setMode(v),
    bg: mode === v ? "var(--color-bg)" : "transparent",
    fg: mode === v ? "var(--color-text)" : MUT,
  }));

  const MODELS: Array<[ModelKey, string]> = [
    ["auto", "Auto"],
    ["gemini", "Gemini"],
    ["claude", "Claude"],
    ["gpt", "GPT"],
  ];
  const modelLabel =
    model === "auto" ? "Auto · Gemini" : MODELS.find((m) => m[0] === model)?.[1] || "Auto · Gemini";

  const catCount = (c: string) => (c === "all" ? RECS.length : RECS.filter((r) => r[1] === c).length);

  return (
    <div
      data-theme={theme}
      data-accent={accent}
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: shell.rootBg,
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        fontSize: "15px",
        lineHeight: 1.6,
      }}
    >
      {/* ════════════════════════════════════════════════════════════════════
          MINIMAL MODE HEADER
          ════════════════════════════════════════════════════════════════════ */}
      {isMin && (
        <header
          data-screen-label="Header"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: "var(--color-bg)",
          }}
        >
          <div
            style={{
              maxWidth: "1440px",
              margin: "0 auto",
              padding: "12px clamp(16px,3vw,40px)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: "none" }}>
              <span
                style={{
                  width: "30px",
                  height: "30px",
                  display: "grid",
                  placeItems: "center",
                  background: "var(--color-accent)",
                  color: "var(--on-accent)",
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: "12px",
                }}
              >
                24
              </span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: "18px",
                  letterSpacing: "-0.02em",
                }}
              >
                REG24
              </span>
              <span
                title="AI READY"
                style={{
                  width: "6px",
                  height: "6px",
                  flex: "none",
                  background: "var(--accent-ink)",
                  animation: "rgPulse 1.6s ease-in-out infinite",
                }}
              />
            </div>

            <nav
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                display: "flex",
                overflowX: "auto",
                scrollbarWidth: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "2px", margin: "0 auto" }}>
                {/* Research */}
                <button
                  type="button"
                  onClick={navItem("research").go}
                  title={t.research}
                  aria-label={t.research}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("research").bg,
                    color: navItem("research").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  {navItem("research").on && <span>{t.research}</span>}
                </button>

                {/* Workspace */}
                <button
                  type="button"
                  onClick={navItem("workspace").go}
                  title={t.workspace}
                  aria-label={t.workspace}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("workspace").bg,
                    color: navItem("workspace").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z" />
                  </svg>
                  {navItem("workspace").on && <span>{t.workspace}</span>}
                </button>

                {/* Databases */}
                <button
                  type="button"
                  onClick={navItem("databases").go}
                  title={t.databases}
                  aria-label={t.databases}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("databases").bg,
                    color: navItem("databases").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                    <path d="M3 12a9 3 0 0 0 18 0" />
                  </svg>
                  {navItem("databases").on && <span>{t.databases}</span>}
                </button>

                <span style={{ width: "14px", flex: "none" }} />

                {/* NotebookLM */}
                <button
                  type="button"
                  onClick={navItem("notebook").go}
                  title="NotebookLM"
                  aria-label="NotebookLM"
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("notebook").bg,
                    color: navItem("notebook").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                  {navItem("notebook").on && <span>NotebookLM</span>}
                </button>

                {/* Connect AI (MCP) */}
                <button
                  type="button"
                  onClick={navItem("mcp").go}
                  title={t.mcp}
                  aria-label={t.mcp}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("mcp").bg,
                    color: navItem("mcp").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="4" y="4" width="16" height="16" />
                    <rect x="9" y="9" width="6" height="6" />
                    <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
                  </svg>
                  {navItem("mcp").on && <span>{t.mcp}</span>}
                </button>

                <span style={{ width: "14px", flex: "none" }} />

                {/* Developer */}
                <button
                  type="button"
                  onClick={navItem("developer").go}
                  title={t.developer}
                  aria-label={t.developer}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("developer").bg,
                    color: navItem("developer").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m18 16 4-4-4-4" />
                    <path d="m6 8-4 4 4 4" />
                    <path d="m14.5 4-5 16" />
                  </svg>
                  {navItem("developer").on && <span>{t.developer}</span>}
                </button>

                {/* Control */}
                <button
                  type="button"
                  onClick={navItem("control").go}
                  title={t.control}
                  aria-label={t.control}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("control").bg,
                    color: navItem("control").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
                  </svg>
                  {navItem("control").on && <span>{t.control}</span>}
                </button>

                {/* 16 Modules */}
                <button
                  type="button"
                  onClick={navItem("modules").go}
                  title={t.modules}
                  aria-label={t.modules}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    padding: "0 10px",
                    border: 0,
                    cursor: "pointer",
                    flex: "none",
                    font: "600 13px var(--font-body)",
                    background: navItem("modules").bg,
                    color: navItem("modules").fg,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z" />
                    <path d="m2 12 9.2 4.2a2 2 0 0 0 1.6 0L22 12" />
                    <path d="m2 17 9.2 4.2a2 2 0 0 0 1.6 0L22 17" />
                  </svg>
                  {navItem("modules").on && <span>{t.modules}</span>}
                </button>
              </div>
            </nav>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                flex: "none",
                position: "relative",
              }}
            >
              <button
                type="button"
                onClick={() => setLang((prev) => (prev === "th" ? "en" : "th"))}
                title="TH / EN"
                className="rg-hover-text"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: "36px",
                  height: "36px",
                  border: 0,
                  cursor: "pointer",
                  background: "transparent",
                  color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                  font: "600 12px var(--font-body)",
                  letterSpacing: ".04em",
                }}
              >
                {lang === "th" ? "TH" : "EN"}
              </button>

              <button
                type="button"
                onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                title={theme === "dark" ? t.dark : t.light}
                aria-label={theme === "dark" ? t.dark : t.light}
                className="rg-hover-text"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: "36px",
                  height: "36px",
                  border: 0,
                  cursor: "pointer",
                  background: "transparent",
                  color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                }}
              >
                {theme !== "dark" ? (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                  </svg>
                ) : (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
                  </svg>
                )}
              </button>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                  padding: "2px",
                  background: "color-mix(in srgb,var(--color-text) 6%,transparent)",
                  flex: "none",
                }}
              >
                {modeOpts.map((mo) => (
                  <button
                    key={mo.v}
                    type="button"
                    onClick={mo.pick}
                    title={mo.label}
                    aria-label={mo.label}
                    aria-pressed={mo.on}
                    className="rg-hover-text"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      height: "32px",
                      padding: "0 9px",
                      border: 0,
                      cursor: "pointer",
                      font: "600 12px var(--font-body)",
                      whiteSpace: "nowrap",
                      background: mo.bg,
                      color: mo.fg,
                    }}
                  >
                    {mo.isMin && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="4" y="4" width="16" height="16" />
                      </svg>
                    )}
                    {mo.isMax && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="7" height="9" />
                        <rect x="14" y="3" width="7" height="5" />
                        <rect x="14" y="12" width="7" height="9" />
                        <rect x="3" y="16" width="7" height="5" />
                      </svg>
                    )}
                    {mo.on && <span>{mo.label}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          MAXIMUM MODE TOP BAR
          ════════════════════════════════════════════════════════════════════ */}
      {isMax && (
        <header
          data-screen-label="Max · Top bar"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 6,
            background: "var(--canvas)",
            display: "flex",
            alignItems: "stretch",
            minHeight: "56px",
          }}
        >
          <div
            style={{
              flex: "0 0 232px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "0 18px",
            }}
          >
            <span
              style={{
                width: "30px",
                height: "30px",
                display: "grid",
                placeItems: "center",
                background: "var(--color-accent)",
                color: "var(--on-accent)",
                fontFamily: "var(--font-heading)",
                fontWeight: 800,
                fontSize: "12px",
              }}
            >
              24
            </span>
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 800,
                fontSize: "18px",
                letterSpacing: "-0.02em",
              }}
            >
              REG24
            </span>
            <span
              style={{
                font: "600 10px ui-monospace,Menlo,monospace",
                letterSpacing: ".08em",
                padding: "2px 6px",
                background: "color-mix(in srgb,var(--color-text) 5%,transparent)",
                color: MUT,
              }}
            >
              MAX
            </span>
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "0 clamp(16px,2.5vw,32px)",
            }}
          >
            <button
              type="button"
              onClick={focusSearch}
              className="rg-hover-tint-strong"
              style={{
                flex: 1,
                maxWidth: "560px",
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: "10px",
                height: "36px",
                padding: "0 12px",
                border: 0,
                background: "color-mix(in srgb,var(--color-text) 5%,transparent)",
                color: MUT,
                cursor: "pointer",
                font: "400 13px var(--font-body)",
                textAlign: "left",
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.cmdSearch}
              </span>
              <span
                style={{
                  font: "600 11px ui-monospace,Menlo,monospace",
                  padding: "1px 6px",
                  background: "color-mix(in srgb,var(--color-text) 8%,transparent)",
                }}
              >
                ⌘K
              </span>
            </button>

            <span style={{ flex: 1 }} />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "2px",
                padding: "2px",
                background: "color-mix(in srgb,var(--color-text) 6%,transparent)",
                flex: "none",
              }}
            >
              {modeOpts.map((mo) => (
                <button
                  key={mo.v}
                  type="button"
                  onClick={mo.pick}
                  title={mo.label}
                  aria-label={mo.label}
                  aria-pressed={mo.on}
                  className="rg-hover-text"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    height: "32px",
                    padding: "0 9px",
                    border: 0,
                    cursor: "pointer",
                    font: "600 12px var(--font-body)",
                    whiteSpace: "nowrap",
                    background: mo.bg,
                    color: mo.fg,
                  }}
                >
                  {mo.isMin && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="4" y="4" width="16" height="16" />
                    </svg>
                  )}
                  {mo.isMax && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="7" height="9" />
                      <rect x="14" y="3" width="7" height="5" />
                      <rect x="14" y="12" width="7" height="9" />
                      <rect x="3" y="16" width="7" height="5" />
                    </svg>
                  )}
                  {mo.on && <span>{mo.label}</span>}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setLang((prev) => (prev === "th" ? "en" : "th"))}
              title="TH / EN"
              className="rg-hover-text"
              style={{
                display: "grid",
                placeItems: "center",
                width: "36px",
                height: "36px",
                border: 0,
                cursor: "pointer",
                background: "transparent",
                color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                font: "600 12px var(--font-body)",
                letterSpacing: ".04em",
              }}
            >
              {lang === "th" ? "TH" : "EN"}
            </button>

            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? t.dark : t.light}
              aria-label={theme === "dark" ? t.dark : t.light}
              className="rg-hover-text"
              style={{
                display: "grid",
                placeItems: "center",
                width: "36px",
                height: "36px",
                border: 0,
                cursor: "pointer",
                background: "transparent",
                color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
              }}
            >
              {theme !== "dark" ? (
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              ) : (
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
                </svg>
              )}
            </button>
          </div>
        </header>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          BODY SHELL (MAX SIDEBAR + MAIN PANEL)
          ════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "stretch",
          minWidth: 0,
        }}
      >
        {isMax && (
          <aside
            data-screen-label="Max · Sidebar"
            style={{
              flex: "0 0 232px",
              padding: "6px 0",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {sideGroups.map((g, gi) => (
              <div key={gi} style={{ padding: "14px 0 10px" }}>
                <div
                  style={{
                    padding: "0 18px 6px",
                    font: "600 11px ui-monospace,Menlo,monospace",
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: MUT,
                  }}
                >
                  {g.label}
                </div>
                {g.items.map((it) => (
                  <button
                    key={it.num}
                    type="button"
                    onClick={it.go}
                    className="rg-hover-tint"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "26px minmax(0,1fr) auto",
                      alignItems: "center",
                      gap: "6px",
                      width: "100%",
                      padding: "8px 18px",
                      border: 0,
                      cursor: "pointer",
                      textAlign: "left",
                      font: "600 13.5px var(--font-body)",
                      background: it.bg,
                      color: it.fg,
                    }}
                  >
                    <span
                      style={{
                        font: "600 11px ui-monospace,Menlo,monospace",
                        color: it.numFg,
                      }}
                    >
                      {it.num}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {it.label}
                    </span>
                    <span
                      style={{
                        font: "11px ui-monospace,Menlo,monospace",
                        color: MUT,
                      }}
                    >
                      {it.count}
                    </span>
                  </button>
                ))}
              </div>
            ))}

            <div
              style={{
                marginTop: "auto",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                fontSize: "12px",
                color: MUT,
              }}
            >
              <span
                style={{
                  font: "600 11px ui-monospace,Menlo,monospace",
                  letterSpacing: ".06em",
                }}
              >
                TENANT
              </span>
              <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
                tenant.law24.prod
              </span>
              <span>Platform Administrator</span>
            </div>
          </aside>
        )}

        <div
          style={{
            flex: "1 1 560px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            background: "var(--color-bg)",
            margin: shell.panelMargin,
            boxShadow: shell.panelShadow,
          }}
        >
          {/* Max Mode Page Header Strip */}
          {shell.strip && (
            <div
              data-screen-label="Max · Page header"
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: "16px",
                flexWrap: "wrap",
                padding: "18px clamp(16px,2.5vw,32px) 14px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    font: "600 11px ui-monospace,Menlo,monospace",
                    letterSpacing: ".06em",
                    color: MUT,
                  }}
                >
                  REG24 / {pageMeta.group} /{" "}
                  <span style={{ color: "var(--accent-ink)" }}>{pageMeta.code}</span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "22px",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.3,
                    marginTop: "4px",
                  }}
                >
                  {pageMeta.title}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  flexWrap: "wrap",
                  font: "12px ui-monospace,Menlo,monospace",
                  color: MUT,
                }}
              >
                <span>as_of {asOfD}</span>
                <span>{t.thailand}</span>
                <span>{lang === "th" ? "TH" : "EN"}</span>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 1A: RESEARCH (MINIMAL MODE)
              ════════════════════════════════════════════════════════════════ */}
          {nav === "research" && isMin && (
            <main
              data-screen-label="Research"
              style={{
                flex: 1,
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: "clamp(48px,10vh,120px) clamp(16px,4vw,40px)",
              }}
            >
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: "100%",
                  maxWidth: "760px",
                  margin: "0 auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "28px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "16px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        padding: "4px 10px",
                        background: "var(--color-accent-100)",
                        color: "var(--color-accent-800)",
                      }}
                    >
                      REG24
                    </span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        padding: "4px 10px",
                        background: tint,
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          flex: "none",
                          background: "var(--accent-ink)",
                          animation: "rgPulse 1.6s ease-in-out infinite",
                        }}
                      />
                      AI READY
                    </span>
                  </div>
                  <h1
                    style={{
                      fontSize: "clamp(28px,3.2vw,38px)",
                      lineHeight: 1.25,
                      letterSpacing: "-0.025em",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    {t.heading}
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                    }}
                  >
                    {t.sub}
                  </p>
                </div>

                <div style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-sm)" }}>
                  <textarea
                    ref={taRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        runAsk();
                      }
                    }}
                    placeholder={scopePh}
                    rows={3}
                    style={{
                      display: "block",
                      width: "100%",
                      border: 0,
                      outline: "none",
                      resize: "none",
                      background: "transparent",
                      color: "var(--color-text)",
                      font: "400 17px/1.6 var(--font-body)",
                      padding: "20px 22px 12px",
                      minHeight: "104px",
                    }}
                  />

                  {chips.tm && (
                    <div
                      style={{
                        margin: "4px 16px 4px",
                        padding: "14px 16px",
                        background: "var(--color-bg)",
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          letterSpacing: ".08em",
                          textTransform: "uppercase",
                          color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                        }}
                      >
                        {t.asOf}
                      </span>
                      <span style={{ fontSize: "12px" }}>2001</span>
                      <input
                        type="range"
                        min={2001}
                        max={2026}
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        style={{
                          flex: 1,
                          minWidth: "160px",
                          accentColor: "var(--accent-ink)",
                        }}
                      />
                      <span style={{ fontSize: "12px" }}>2026</span>
                      <span
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "22px",
                          color: "var(--accent-ink)",
                          minWidth: "56px",
                          textAlign: "right",
                        }}
                      >
                        {year}
                      </span>
                    </div>
                  )}

                  <div
                    style={{
                      padding: "6px 14px 14px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: "2px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={chipV("upload").toggle}
                      title={chipTitle.upload}
                      aria-label={chipTitle.upload}
                      className="rg-hover-text"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: "36px",
                        height: "36px",
                        border: 0,
                        cursor: "pointer",
                        background: chipV("upload").bg,
                        color: chipV("upload").fg,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={chipV("notebook").toggle}
                      title={chipTitle.notebook}
                      aria-label={chipTitle.notebook}
                      className="rg-hover-text"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: "36px",
                        height: "36px",
                        border: 0,
                        cursor: "pointer",
                        background: chipV("notebook").bg,
                        color: chipV("notebook").fg,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={chipV("llm").toggle}
                      title={chipTitle.llm}
                      aria-label={chipTitle.llm}
                      className="rg-hover-text"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: "36px",
                        height: "36px",
                        border: 0,
                        cursor: "pointer",
                        background: chipV("llm").bg,
                        color: chipV("llm").fg,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m4 17 6-6-6-6" />
                        <path d="M12 19h8" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={chipV("tm").toggle}
                      title={chipTitle.tm}
                      aria-label={chipTitle.tm}
                      className="rg-hover-text"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: "36px",
                        height: "36px",
                        border: 0,
                        cursor: "pointer",
                        background: chipV("tm").bg,
                        color: chipV("tm").fg,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={chipV("tech").toggle}
                      title={chipTitle.tech}
                      aria-label={chipTitle.tech}
                      className="rg-hover-text"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: "36px",
                        height: "36px",
                        border: 0,
                        cursor: "pointer",
                        background: chipV("tech").bg,
                        color: chipV("tech").fg,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="4" y="4" width="16" height="16" />
                        <rect x="9" y="9" width="6" height="6" />
                      </svg>
                    </button>

                    <span style={{ flex: 1 }} />

                    <span
                      style={{
                        fontSize: "12px",
                        color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                      }}
                    >
                      {ctxLabel}
                    </span>

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => runAsk()}
                      title={`${t.ask} (⌘/Ctrl + Enter)`}
                      aria-label={t.ask}
                      style={{
                        width: "40px",
                        height: "40px",
                        padding: 0,
                        justifyContent: "center",
                        marginLeft: "10px",
                        flex: "none",
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 12 7-7 7 7" />
                        <path d="M12 19V5" />
                      </svg>
                    </button>
                  </div>
                </div>

                {result && (
                  <section
                    style={{
                      padding: "4px 2px 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        alignItems: "baseline",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          letterSpacing: ".08em",
                          textTransform: "uppercase",
                          color: "var(--color-accent-700)",
                        }}
                      >
                        {t.answer} · {asOfLabel}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setResult(null)}
                        style={{ fontSize: "13px" }}
                      >
                        {t.clear}
                      </button>
                    </div>

                    <h2 style={{ fontSize: "20px", lineHeight: 1.4, margin: 0 }}>{result.q}</h2>

                    {result.loading && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          padding: "14px 16px",
                          background: "var(--color-surface)",
                          font: "12.5px/1.7 ui-monospace,Menlo,monospace",
                        }}
                      >
                        {trace.map((tr, idx) => (
                          <div key={idx} style={{ display: "flex", gap: "10px", color: tr.color }}>
                            <span style={{ width: "14px", flex: "none" }}>{tr.mark}</span>
                            <span>{tr.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {result.done && (
                      <>
                        <div
                          style={{
                            font: "12px ui-monospace,Menlo,monospace",
                            color: "color-mix(in srgb,var(--color-text) 55%,transparent)",
                          }}
                        >
                          {traceSummary}
                        </div>
                        <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.8 }}>
                          {result.answer}
                        </p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                          {(result.citations || []).map((c, idx) => (
                            <span
                              key={idx}
                              className="tag tag-outline"
                              style={{ fontSize: "12px", padding: "4px 10px" }}
                            >
                              {c.law} · {c.section}
                            </span>
                          ))}
                        </div>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "13px",
                            color: MUT,
                          }}
                        >
                          {result.note}
                        </p>
                      </>
                    )}
                  </section>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px" }}>
                  {scopeBtns.map((sb) => (
                    <button
                      key={sb.v}
                      type="button"
                      onClick={sb.pick}
                      aria-pressed={sb.on}
                      title={sb.hint}
                      className="rg-hover-opacity"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        height: "34px",
                        padding: "0 12px",
                        border: 0,
                        cursor: "pointer",
                        font: "600 13px var(--font-body)",
                        whiteSpace: "nowrap",
                        background: sb.bg,
                        color: sb.fg,
                      }}
                    >
                      {sb.isRd && (
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
                          <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                          <path d="M12 17.5v-11" />
                        </svg>
                      )}
                      {sb.isDika && (
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8" />
                          <path d="m16 16 6-6" />
                          <path d="m8 8 6-6" />
                          <path d="m9 7 8 8" />
                          <path d="m21 11-8-8" />
                        </svg>
                      )}
                      <span>{sb.label}</span>
                      {sb.on && <span style={{ opacity: 0.8 }}>×</span>}
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "6px 22px",
                    fontSize: "13px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setQuery(t.pFind)}
                    className="rg-hover-accent"
                    style={{
                      border: 0,
                      background: "transparent",
                      color: MUT,
                      cursor: "pointer",
                      font: "inherit",
                      padding: "4px 0",
                    }}
                  >
                    {t.qFind}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuery(t.pRuling)}
                    className="rg-hover-accent"
                    style={{
                      border: 0,
                      background: "transparent",
                      color: MUT,
                      cursor: "pointer",
                      font: "inherit",
                      padding: "4px 0",
                    }}
                  >
                    {t.qRuling}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuery(t.pResearch)}
                    className="rg-hover-accent"
                    style={{
                      border: 0,
                      background: "transparent",
                      color: MUT,
                      cursor: "pointer",
                      font: "inherit",
                      padding: "4px 0",
                    }}
                  >
                    {t.qResearch}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDbOpen(true)}
                    className="rg-hover-accent"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      border: 0,
                      background: "transparent",
                      color: MUT,
                      cursor: "pointer",
                      font: "inherit",
                      padding: "4px 0",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                      <path d="M3 12a9 3 0 0 0 18 0" />
                    </svg>
                    {lang === "th" ? "19 อุตสาหกรรม · 38 กฎหมาย" : "19 industries · 38 laws"}
                  </button>
                </div>
              </div>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 1B: RESEARCH WORKBENCH (MAXIMUM MODE)
              ════════════════════════════════════════════════════════════════ */}
          {nav === "research" && isMax && (
            <main
              data-screen-label="Max · Research workbench"
              style={{
                flex: 1,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "stretch",
              }}
            >
              <section
                style={{
                  flex: "1 1 520px",
                  minWidth: 0,
                  padding: "24px clamp(16px,2.5vw,32px) 48px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "28px",
                }}
              >
                <div style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-sm)" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "9px 14px",
                      font: "600 11px ui-monospace,Menlo,monospace",
                      letterSpacing: ".06em",
                      color: MUT,
                    }}
                  >
                    <span>QUERY · {scopeTag}</span>
                    <span>{asOfLabel}</span>
                  </div>

                  <textarea
                    ref={taMaxRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        runAsk();
                      }
                    }}
                    placeholder={scopePh}
                    rows={4}
                    style={{
                      display: "block",
                      width: "100%",
                      border: 0,
                      outline: "none",
                      resize: "vertical",
                      background: "transparent",
                      color: "var(--color-text)",
                      font: "400 16px/1.6 var(--font-body)",
                      padding: "16px 14px",
                      minHeight: "116px",
                    }}
                  />

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))",
                      gap: "4px",
                      padding: "2px 10px 6px",
                    }}
                  >
                    {chipRows.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={c.toggle}
                        className="rg-hover-text"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 14px",
                          border: 0,
                          cursor: "pointer",
                          textAlign: "left",
                          font: "600 12.5px var(--font-body)",
                          background: c.bg,
                          color: c.fg,
                        }}
                      >
                        <span style={{ width: "8px", height: "8px", flex: "none", background: c.dot }} />
                        <span style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>{c.label}</span>
                        <span
                          style={{
                            font: "600 10.5px ui-monospace,Menlo,monospace",
                            letterSpacing: ".06em",
                          }}
                        >
                          {c.state}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 14px 4px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        font: "600 11px ui-monospace,Menlo,monospace",
                        letterSpacing: ".06em",
                        color: MUT,
                        marginRight: "6px",
                      }}
                    >
                      SCOPE
                    </span>
                    {scopeBtns.map((sb) => (
                      <button
                        key={sb.v}
                        type="button"
                        onClick={sb.pick}
                        aria-pressed={sb.on}
                        title={sb.hint}
                        className="rg-hover-opacity"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          height: "34px",
                          padding: "0 12px",
                          border: 0,
                          cursor: "pointer",
                          font: "600 13px var(--font-body)",
                          whiteSpace: "nowrap",
                          background: sb.bg,
                          color: sb.fg,
                        }}
                      >
                        {sb.isRd && (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
                            <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                            <path d="M12 17.5v-11" />
                          </svg>
                        )}
                        {sb.isDika && (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8" />
                            <path d="m16 16 6-6" />
                            <path d="m8 8 6-6" />
                            <path d="m9 7 8 8" />
                            <path d="m21 11-8-8" />
                          </svg>
                        )}
                        <span>{sb.label}</span>
                        {sb.on && <span style={{ opacity: 0.8 }}>×</span>}
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                      padding: "12px 14px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        font: "600 11px ui-monospace,Menlo,monospace",
                        letterSpacing: ".06em",
                        color: MUT,
                      }}
                    >
                      AS_OF
                    </span>
                    <span style={{ font: "11px ui-monospace,Menlo,monospace", color: MUT }}>
                      2001
                    </span>
                    <input
                      type="range"
                      min={2001}
                      max={2026}
                      value={year}
                      onChange={(e) => {
                        setYear(Number(e.target.value));
                        setChips((prev) => ({ ...prev, tm: true }));
                      }}
                      style={{
                        flex: 1,
                        minWidth: "160px",
                        accentColor: "var(--accent-ink)",
                      }}
                    />
                    <span style={{ font: "11px ui-monospace,Menlo,monospace", color: MUT }}>
                      2026
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "20px",
                        color: "var(--accent-ink)",
                        minWidth: "64px",
                        textAlign: "right",
                      }}
                    >
                      {chips.tm ? year : 2026}
                    </span>
                    {chips.tm && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setYear(2026);
                          setChips((prev) => ({ ...prev, tm: false }));
                        }}
                        style={{ fontSize: "12px", padding: "4px 8px" }}
                      >
                        {t.nowBtn}
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 14px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        font: "600 11px ui-monospace,Menlo,monospace",
                        letterSpacing: ".06em",
                        color: MUT,
                      }}
                    >
                      MODEL
                    </span>
                    <div className="seg">
                      {MODELS.map(([v, label]) => (
                        <label
                          key={v}
                          className="seg-opt"
                          style={{ padding: "6px 10px", fontSize: "12px" }}
                        >
                          <input
                            type="radio"
                            name="model"
                            checked={model === v}
                            onChange={() => setModel(v)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <span style={{ flex: 1 }} />
                    <span style={{ font: "11px ui-monospace,Menlo,monospace", color: MUT }}>
                      ⌘ ↵
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => runAsk()}
                      style={{
                        padding: "10px 14px",
                        minWidth: "170px",
                        justifyContent: "space-between",
                        fontSize: "14px",
                      }}
                    >
                      {t.ask}
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))",
                    gap: "6px",
                  }}
                >
                  {(
                    [
                      ["Q1", t.pFind],
                      ["Q2", t.pRuling],
                      ["Q3", t.pResearch],
                    ] as const
                  ).map(([n, label]) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQuery(label)}
                      className="rg-hover-accent"
                      style={{
                        display: "flex",
                        gap: "10px",
                        alignItems: "flex-start",
                        padding: "12px 14px",
                        border: 0,
                        background: "color-mix(in srgb,var(--color-text) 5%,transparent)",
                        color: "var(--color-text)",
                        cursor: "pointer",
                        textAlign: "left",
                        font: "400 13.5px/1.5 var(--font-body)",
                      }}
                    >
                      <span
                        style={{
                          font: "600 11px/1.9 ui-monospace,Menlo,monospace",
                          color: "var(--accent-ink)",
                        }}
                      >
                        {n}
                      </span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {result ? (
                  <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        alignItems: "center",
                        paddingBottom: "8px",
                      }}
                    >
                      <span
                        style={{
                          font: "600 11px ui-monospace,Menlo,monospace",
                          letterSpacing: ".08em",
                          color: "var(--color-accent-700)",
                        }}
                      >
                        ANSWER · {asOfLabel}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setResult(null)}
                        style={{ fontSize: "12px", padding: "4px 8px" }}
                      >
                        {t.clear}
                      </button>
                    </div>
                    <h2 style={{ fontSize: "20px", lineHeight: 1.4, margin: 0 }}>{result.q}</h2>

                    {result.loading && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          font: "12.5px/1.8 ui-monospace,Menlo,monospace",
                        }}
                      >
                        {trace.map((tr, idx) => (
                          <div key={idx} style={{ display: "flex", gap: "10px", color: tr.color }}>
                            <span style={{ width: "14px", flex: "none" }}>{tr.mark}</span>
                            <span>{tr.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {result.done && (
                      <>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "16px",
                            lineHeight: 1.8,
                            maxWidth: "72ch",
                          }}
                        >
                          {result.answer}
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          {(result.citations || []).map((c, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "14px",
                                padding: "10px 14px",
                                background: "var(--color-surface)",
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ fontWeight: 600, flex: 1, minWidth: "160px" }}>
                                {c.law}
                              </span>
                              <span style={{ font: "12.5px ui-monospace,Menlo,monospace" }}>
                                {c.section}
                              </span>
                              <span className="tag tag-accent">{t.inForce}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ overflowX: "auto", background: "var(--color-surface)" }}>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px",
                              padding: "12px 14px",
                              font: "12px/1.8 ui-monospace,Menlo,monospace",
                              minWidth: "520px",
                            }}
                          >
                            {traceRows.map((tr) => (
                              <div
                                key={tr.n}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "28px minmax(0,1fr) 140px 52px",
                                  gap: "10px",
                                }}
                              >
                                <span style={{ color: "var(--accent-ink)" }}>{tr.n}</span>
                                <span style={{ fontFamily: "var(--font-body)" }}>{tr.text}</span>
                                <span style={{ color: MUT }}>{tr.mod}</span>
                                <span style={{ textAlign: "right" }}>{tr.ms}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <p style={{ margin: 0, fontSize: "12.5px", color: MUT }}>{result.note}</p>
                      </>
                    )}
                  </section>
                ) : (
                  <section style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        paddingBottom: "8px",
                      }}
                    >
                      <span
                        style={{
                          font: "600 11px ui-monospace,Menlo,monospace",
                          letterSpacing: ".08em",
                          color: MUT,
                        }}
                      >
                        {t.recent}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => goto("workspace")}
                        style={{ fontSize: "12px", padding: "4px 8px" }}
                      >
                        {t.workspace} →
                      </button>
                    </div>
                    {SESS.map((x, idx) => (
                      <div
                        key={x[0]}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "76px minmax(0,1fr) auto",
                          gap: "14px",
                          alignItems: "center",
                          padding: "12px 14px",
                          background: "var(--color-surface)",
                        }}
                      >
                        <span
                          style={{
                            font: "600 11.5px ui-monospace,Menlo,monospace",
                            color: "var(--color-accent-700)",
                          }}
                        >
                          {x[0]}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "14px", lineHeight: 1.45 }}>
                            {isTh ? x[3] : x[4]}
                          </div>
                          <div
                            style={{
                              font: "11.5px ui-monospace,Menlo,monospace",
                              color: MUT,
                            }}
                          >
                            {x[1]} · {x[2]} ·{" "}
                            {isTh
                              ? `${x[5]} รอบสนทนา · ${x[6]} แหล่งอ้างอิง`
                              : `${x[5]} turns · ${x[6]} bookmarked sources`}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setSel(idx);
                            askWith(isTh ? x[3] : x[4]);
                          }}
                          style={{ fontSize: "12px", padding: "4px 8px" }}
                        >
                          {P.reopen[lang]} →
                        </button>
                      </div>
                    ))}
                  </section>
                )}
              </section>

              {/* Max Mode Right Inspector */}
              <aside
                data-screen-label="Max · Inspector"
                style={{
                  flex: "0 1 340px",
                  minWidth: "280px",
                  padding: "24px clamp(16px,2.5vw,24px) 24px 0",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    background: "var(--color-surface)",
                  }}
                >
                  <div
                    style={{
                      font: "600 11px ui-monospace,Menlo,monospace",
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: MUT,
                    }}
                  >
                    <span style={{ color: "var(--accent-ink)" }}>01</span>&nbsp;&nbsp;{t.srcTitle}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {MODS.map(([id], i) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          setSrcOn((prev) => {
                            const next = prev.slice();
                            next[i] = !next[i];
                            return next;
                          })
                        }
                        style={{
                          display: "grid",
                          gridTemplateColumns: "14px 48px minmax(0,1fr)",
                          gap: "10px",
                          alignItems: "center",
                          padding: "7px 0",
                          border: 0,
                          background: "transparent",
                          color: "var(--color-text)",
                          cursor: "pointer",
                          textAlign: "left",
                          font: "400 13px var(--font-body)",
                        }}
                      >
                        <span
                          style={{
                            width: "12px",
                            height: "12px",
                            boxSizing: "border-box",
                            border: `2px solid ${
                              srcOn[i] ? "var(--accent-ink)" : "var(--color-neutral-500)"
                            }`,
                            background: srcOn[i] ? "var(--accent-ink)" : "transparent",
                          }}
                        />
                        <span
                          style={{
                            font: "600 11px ui-monospace,Menlo,monospace",
                            color: "var(--color-accent-700)",
                          }}
                        >
                          {id}
                        </span>
                        <span style={{ opacity: srcOn[i] ? 1 : 0.5 }}>{t.m[i]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    background: "var(--color-surface)",
                  }}
                >
                  <div
                    style={{
                      font: "600 11px ui-monospace,Menlo,monospace",
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: MUT,
                    }}
                  >
                    <span style={{ color: "var(--accent-ink)" }}>02</span>&nbsp;&nbsp;{t.sysTitle}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "16px" }}>
                    <div style={{ padding: "10px 0" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "24px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.15,
                        }}
                      >
                        3,995
                      </div>
                      <div style={{ fontSize: "11.5px", color: MUT }}>AuraDB nodes</div>
                    </div>
                    <div style={{ padding: "10px 0" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "24px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.15,
                        }}
                      >
                        0
                      </div>
                      <div style={{ fontSize: "11.5px", color: MUT }}>orphan nodes</div>
                    </div>
                    <div style={{ padding: "10px 0" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "24px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.15,
                        }}
                      >
                        100%
                      </div>
                      <div style={{ fontSize: "11.5px", color: MUT }}>provenance</div>
                    </div>
                    <div style={{ padding: "10px 0" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "24px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.15,
                          color: "var(--accent-ink)",
                        }}
                      >
                        9/9
                      </div>
                      <div style={{ fontSize: "11.5px", color: MUT }}>P0 gates</div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    background: "var(--color-surface)",
                  }}
                >
                  <div
                    style={{
                      font: "600 11px ui-monospace,Menlo,monospace",
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: MUT,
                    }}
                  >
                    <span style={{ color: "var(--accent-ink)" }}>03</span>&nbsp;&nbsp;Model24 · LLM
                    Router
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {PRIO.map((x) => (
                      <button
                        key={x[0]}
                        type="button"
                        onClick={() => setPrio(x[0])}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "7px 10px",
                          border: 0,
                          cursor: "pointer",
                          textAlign: "left",
                          font: "600 12.5px var(--font-body)",
                          background: prio === x[0] ? "var(--color-accent-100)" : "transparent",
                          color: prio === x[0] ? "var(--color-accent-800)" : "var(--color-text)",
                        }}
                      >
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            flex: "none",
                            background:
                              prio === x[0] ? "var(--accent-ink)" : "var(--color-neutral-400)",
                          }}
                        />
                        {isTh ? x[1] : x[2]}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                      <span style={{ color: MUT }}>{P.primaryModel[lang]}</span>
                      <b>{modelLabel}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                      <span style={{ color: MUT }}>{P.reviewer[lang]}</span>
                      <b>Claude</b>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    background: "var(--color-surface)",
                  }}
                >
                  <div
                    style={{
                      font: "600 11px ui-monospace,Menlo,monospace",
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: MUT,
                    }}
                  >
                    <span style={{ color: "var(--accent-ink)" }}>04</span>&nbsp;&nbsp;{t.aiTitle}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {(Object.keys(PROV) as ProviderKey[]).map((k) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "6px 0",
                          fontSize: "13px",
                        }}
                      >
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            flex: "none",
                            background:
                              k === "gemini" ? "var(--accent-ink)" : "var(--color-neutral-400)",
                          }}
                        />
                        <span style={{ flex: 1 }}>{PROV[k][0]}</span>
                        <span
                          style={{
                            font: "11px ui-monospace,Menlo,monospace",
                            color: MUT,
                          }}
                        >
                          {k === "gemini" ? "connected" : "ready"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => goto("mcp")}
                    style={{ alignSelf: "flex-start", fontSize: "12px", padding: "4px 0" }}
                  >
                    {t.mcp} →
                  </button>
                </div>
              </aside>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 2: WORKSPACE
              ════════════════════════════════════════════════════════════════ */}
          {nav === "workspace" && (
            <main
              data-screen-label="Workspace"
              style={{
                flex: 1,
                width: "100%",
                maxWidth: shell.mainMax,
                margin: "0 auto",
                padding: shell.mainPad,
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  gap: "24px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--color-accent-700)",
                    }}
                  >
                    Workspace
                  </span>
                  <h1
                    style={{
                      fontSize: "clamp(24px,2.5vw,32px)",
                      lineHeight: 1.3,
                      letterSpacing: "-0.02em",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    {P.wsTitle[lang]}
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "14px",
                      maxWidth: "62ch",
                      color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                    }}
                  >
                    {P.wsSub[lang]}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="btn rg-hover-tint-strong"
                    onClick={() =>
                      setExportFile(`reg24-${curSession[0].toLowerCase()}-${curSession[2]}.pdf`)
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "13px",
                      background: tint,
                    }}
                  >
                    Export PDF
                  </button>
                  <button
                    type="button"
                    className="btn rg-hover-tint-strong"
                    onClick={() =>
                      setExportFile(`reg24-${curSession[0].toLowerCase()}-${curSession[2]}.docx`)
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "13px",
                      background: tint,
                    }}
                  >
                    Export DOCX
                  </button>
                </div>
              </div>

              {exportFile && (
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--color-accent-100)",
                    color: "var(--color-accent-800)",
                    fontSize: "14px",
                    fontWeight: 600,
                  }}
                >
                  ✓ {P.exportReady[lang]}: {exportFile}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "24px",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    flex: "2 1 460px",
                    minWidth: 0,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,280px),1fr))",
                    gap: "12px",
                  }}
                >
                  {SESS.map((x, i) => (
                    <div
                      key={x[0]}
                      onClick={() => setSel(i)}
                      style={{
                        background: "var(--color-surface)",
                        padding: "20px",
                        cursor: "pointer",
                        outline: `2px solid ${i === sel ? "var(--color-accent)" : "transparent"}`,
                        outlineOffset: "-2px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        minHeight: "170px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "8px",
                          fontSize: "12px",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "var(--color-accent-700)" }}>
                          {x[0]}
                        </span>
                        <span style={{ color: "color-mix(in srgb,var(--color-text) 60%,transparent)" }}>
                          {x[1]} · {x[2]}
                        </span>
                      </div>
                      <h3 style={{ fontSize: "17px", lineHeight: 1.45, margin: 0 }}>
                        {isTh ? x[3] : x[4]}
                      </h3>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "8px",
                          marginTop: "auto",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "12px",
                            color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                          }}
                        >
                          {isTh
                            ? `${x[5]} รอบสนทนา · ${x[6]} แหล่งอ้างอิง`
                            : `${x[5]} turns · ${x[6]} bookmarked sources`}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            askWith(isTh ? x[3] : x[4]);
                          }}
                          style={{ fontSize: "13px" }}
                        >
                          {P.reopen[lang]} →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <aside
                  style={{
                    flex: "1 1 280px",
                    background: "var(--color-surface)",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--color-accent-700)",
                    }}
                  >
                    LAW24 Matter Handoff
                  </span>
                  <h2 style={{ fontSize: "20px", lineHeight: 1.4, margin: 0 }}>
                    {P.handoffTitle[lang]}
                  </h2>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "14px",
                      color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                    }}
                  >
                    {P.handoffSub[lang]}
                  </p>
                  <div
                    style={{
                      fontSize: "13px",
                      padding: "12px 14px",
                      background: "var(--color-bg)",
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: "color-mix(in srgb,var(--color-text) 60%,transparent)" }}>
                      {P.selected[lang]}
                    </span>
                    <br />
                    <b>{isTh ? curSession[3] : curSession[4]}</b>
                  </div>
                  {handed[curSession[0]] && (
                    <div
                      style={{
                        fontSize: "13px",
                        color: "var(--color-accent-700)",
                        fontWeight: 600,
                      }}
                    >
                      ✓ {P.handedOff[lang]} · LAW24-H-{curSession[0]}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      setHanded((prev) => ({ ...prev, [curSession[0]]: true }))
                    }
                    style={{
                      padding: "12px 14px",
                      justifyContent: "space-between",
                      fontSize: "14px",
                    }}
                  >
                    {P.handoffBtn[lang]}
                    <span>→</span>
                  </button>
                </aside>
              </div>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 3A: DATABASES (MINIMAL MODE)
              ════════════════════════════════════════════════════════════════ */}
          {nav === "databases" && isMin && (
            <main
              data-screen-label="Databases"
              style={{
                flex: 1,
                width: "100%",
                maxWidth: shell.mainMax,
                margin: "0 auto",
                padding: shell.mainPad,
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  gap: "24px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--color-accent-700)",
                    }}
                  >
                    {t.databases}
                  </span>
                  <h1
                    style={{
                      fontSize: "clamp(24px,2.5vw,32px)",
                      lineHeight: 1.3,
                      letterSpacing: "-0.02em",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    {P.dbPageTitle[lang]}
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "14px",
                      maxWidth: "62ch",
                      color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                    }}
                  >
                    {P.dbPageSub[lang]}
                  </p>
                </div>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    background: tint,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      flex: "none",
                      background: "var(--accent-ink)",
                    }}
                  />
                  Synced to Live Neo4j AuraDB
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "0 16px",
                    background: "var(--color-surface)",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    value={dbQuery}
                    onChange={(e) => setDbQuery(e.target.value)}
                    placeholder={P.dbSearch[lang]}
                    style={{
                      flex: 1,
                      border: 0,
                      outline: "none",
                      background: "transparent",
                      color: "var(--color-text)",
                      font: "400 15px var(--font-body)",
                      minHeight: "52px",
                      minWidth: 0,
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {CATS.map((c) => {
                    const p = pill(dbCat === c[0]);
                    return (
                      <button
                        key={c[0]}
                        type="button"
                        onClick={() => setDbCat(c[0])}
                        style={{
                          padding: "7px 12px",
                          border: 0,
                          cursor: "pointer",
                          font: "600 13px var(--font-body)",
                          background: p.bg,
                          color: p.fg,
                        }}
                      >
                        {isTh ? c[1] : c[2]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {dbRows.map((r) => (
                  <div
                    key={r.code}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(110px,190px) minmax(0,1fr) auto",
                      gap: "20px",
                      alignItems: "center",
                      padding: "16px 20px",
                      background: "var(--color-surface)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "ui-monospace,Menlo,monospace",
                        fontSize: "12px",
                        color: "var(--color-accent-700)",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {r.code}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "15px", lineHeight: 1.45 }}>
                        {r.title}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                        }}
                      >
                        {r.cat} · {r.status}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn rg-hover-accent-bg"
                      onClick={r.ask}
                      style={{
                        padding: "7px 12px",
                        fontSize: "13px",
                        background: tint,
                      }}
                    >
                      AI →
                    </button>
                  </div>
                ))}
                {dbRows.length === 0 && (
                  <div
                    style={{
                      padding: "32px 20px",
                      background: "var(--color-surface)",
                      color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                    }}
                  >
                    {P.dbEmpty[lang]}
                  </div>
                )}
              </div>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 3B: DATABASES (MAXIMUM MODE)
              ════════════════════════════════════════════════════════════════ */}
          {nav === "databases" && isMax && (
            <main
              data-screen-label="Max · Databases"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "20px clamp(16px,2.5vw,32px) 48px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: "240px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "0 12px",
                    background: "var(--color-surface)",
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    value={dbQuery}
                    onChange={(e) => setDbQuery(e.target.value)}
                    placeholder={P.dbSearch[lang]}
                    style={{
                      flex: 1,
                      border: 0,
                      outline: "none",
                      background: "transparent",
                      color: "var(--color-text)",
                      font: "400 14px var(--font-body)",
                      minHeight: "40px",
                      minWidth: 0,
                    }}
                  />
                </div>
                <span style={{ font: "12px ui-monospace,Menlo,monospace", color: MUT }}>
                  {(isTh ? "แสดง " : "Showing ") + dbRows.length + " / " + RECS.length}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    font: "12px ui-monospace,Menlo,monospace",
                    color: MUT,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      flex: "none",
                      background: "var(--accent-ink)",
                    }}
                  />
                  Neo4j AuraDB · synced
                </span>
              </div>

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {CATS.map((c) => {
                  const active = dbCat === c[0];
                  return (
                    <button
                      key={c[0]}
                      type="button"
                      onClick={() => setDbCat(c[0])}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "6px",
                        padding: "7px 12px",
                        border: 0,
                        background: active
                          ? "var(--color-accent)"
                          : "color-mix(in srgb,var(--color-text) 5%,transparent)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        font: "600 13px var(--font-body)",
                        color: active ? "var(--on-accent)" : "var(--color-text)",
                      }}
                    >
                      {isTh ? c[1] : c[2]}
                      <span
                        style={{
                          font: "11px ui-monospace,Menlo,monospace",
                          opacity: 0.75,
                        }}
                      >
                        {catCount(c[0])}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div style={{ overflowX: "auto" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "520px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(100px,130px) minmax(0,1fr) 120px 52px",
                      gap: "16px",
                      padding: "0 14px 6px",
                      font: "600 11px ui-monospace,Menlo,monospace",
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: MUT,
                    }}
                  >
                    <span>Code</span>
                    <span>{t.colTitle}</span>
                    <span>{t.colStatus}</span>
                    <span />
                  </div>
                  {dbRows.map((r) => (
                    <div
                      key={r.code}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(100px,130px) minmax(0,1fr) 120px 52px",
                        gap: "16px",
                        alignItems: "center",
                        padding: "11px 14px",
                        background: "var(--color-surface)",
                        fontSize: "13.5px",
                      }}
                    >
                      <span
                        style={{
                          font: "12px ui-monospace,Menlo,monospace",
                          color: "var(--color-accent-700)",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {r.code}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600, lineHeight: 1.45 }}>
                          {r.title}
                        </span>
                        <span style={{ display: "block", fontSize: "12px", color: MUT }}>
                          {r.cat}
                        </span>
                      </span>
                      <span>
                        <span className={`tag ${r.tagCls}`}>{r.status}</span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={r.ask}
                        style={{ fontSize: "12px", padding: "4px 8px" }}
                      >
                        AI →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              {dbRows.length === 0 && (
                <div style={{ padding: "24px 0", color: MUT }}>{P.dbEmpty[lang]}</div>
              )}
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 4: NOTEBOOKLM
              ════════════════════════════════════════════════════════════════ */}
          {nav === "notebook" && (
            <main
              data-screen-label="NotebookLM"
              style={{
                flex: 1,
                width: "100%",
                maxWidth: shell.mainMax,
                margin: "0 auto",
                padding: shell.mainPad,
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  gap: "24px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--color-accent-700)",
                    }}
                  >
                    NotebookLM
                  </span>
                  <h1
                    style={{
                      fontSize: "clamp(24px,2.5vw,32px)",
                      lineHeight: 1.3,
                      letterSpacing: "-0.02em",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    {P.nbTitle[lang]}
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "14px",
                      maxWidth: "62ch",
                      color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                    }}
                  >
                    {P.nbSub[lang]}
                  </p>
                </div>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: tint,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      background:
                        nbState === "on" ? "var(--accent-ink)" : "var(--color-neutral-500)",
                    }}
                  />
                  {nbState === "on"
                    ? isTh
                      ? "เชื่อมต่อแล้ว"
                      : "Connected"
                    : isTh
                    ? "พร้อมเชื่อมต่อ"
                    : "Ready to connect"}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))",
                  gap: "12px",
                }}
              >
                {NBSTEPS.map((st) => (
                  <div
                    key={st[0]}
                    style={{
                      background: "var(--color-surface)",
                      padding: "22px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "14px",
                        color: "var(--accent-ink)",
                      }}
                    >
                      {st[0]}
                    </span>
                    <h3 style={{ fontSize: "16px", lineHeight: 1.45, margin: 0 }}>
                      {isTh ? st[1] : st[2]}
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "14px",
                        color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                      }}
                    >
                      {isTh ? st[3] : st[4]}
                    </p>
                  </div>
                ))}
              </div>

              {nbState !== "on" ? (
                <div
                  style={{
                    background: "var(--color-surface)",
                    padding: "28px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    maxWidth: "720px",
                  }}
                >
                  <h2 style={{ fontSize: "22px", lineHeight: 1.35, margin: 0 }}>
                    {P.nbNot[lang]}
                  </h2>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                    }}
                  >
                    {P.nbNotSub[lang]}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (nbState !== "off") return;
                      setNbState("connecting");
                      setTimeout(() => setNbState("on"), 900);
                    }}
                    style={{
                      alignSelf: "flex-start",
                      padding: "12px 14px",
                      minWidth: "260px",
                      justifyContent: "space-between",
                      fontSize: "14px",
                    }}
                  >
                    {nbState === "connecting"
                      ? isTh
                        ? "กำลังเชื่อมต่อ REG24 Connect…"
                        : "Connecting REG24 Connect…"
                      : isTh
                      ? "ติดตั้งและเชื่อมต่อ REG24 Connect"
                      : "Install & connect REG24 Connect"}
                    <span>→</span>
                  </button>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                    }}
                  >
                    {P.nbSupports[lang]}
                  </span>
                  <div style={{ fontSize: "13px", fontWeight: 600, marginTop: "8px" }}>
                    {P.nbPaste[lang]}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      placeholder="https://notebooklm.google.com/notebook/…"
                      style={{
                        flex: 1,
                        minWidth: "220px",
                        border: 0,
                        outline: "none",
                        background: "var(--color-bg)",
                        color: "var(--color-text)",
                        font: "400 14px var(--font-body)",
                        padding: "0 12px",
                        minHeight: "42px",
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (nbState !== "off") return;
                        setNbState("connecting");
                        setTimeout(() => setNbState("on"), 900);
                      }}
                      style={{
                        padding: "10px 14px",
                        fontSize: "13px",
                        background: "color-mix(in srgb,var(--color-text) 8%,transparent)",
                      }}
                    >
                      {P.nbConnectUrl[lang]}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "16px",
                      flexWrap: "wrap",
                      padding: "18px 20px",
                      background: "var(--color-accent-100)",
                      color: "var(--color-accent-900)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontFamily: "var(--font-heading)" }}>
                        ✓ REG24 Connect × NotebookLM Active
                      </div>
                      <div style={{ fontSize: "13px", marginTop: "2px" }}>
                        {P.nbActiveSub[lang]}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setNbState("off")}
                      style={{ fontSize: "13px" }}
                    >
                      {P.nbDisconnect[lang]}
                    </button>
                  </div>

                  {NB.map((b, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "16px",
                        padding: "16px 20px",
                        background: "var(--color-surface)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{isTh ? b[0] : b[1]}</div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                          }}
                        >
                          {isTh ? `${b[2]} เอกสารอ้างอิง` : `${b[2]} sources`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setNbOn((prev) => {
                            const next = prev.slice();
                            next[i] = !next[i];
                            return next;
                          })
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          border: 0,
                          background: "transparent",
                          color: "var(--color-text)",
                          cursor: "pointer",
                          font: "600 12px var(--font-body)",
                        }}
                      >
                        {P.nbActiveAi[lang]}
                        <span
                          style={{
                            width: "36px",
                            height: "20px",
                            padding: "3px",
                            display: "flex",
                            justifyContent: nbOn[i] ? "flex-end" : "flex-start",
                            background: nbOn[i]
                              ? "var(--accent-ink)"
                              : "var(--color-neutral-400)",
                          }}
                        >
                          <span style={{ width: "14px", height: "14px", background: "#fff" }} />
                        </span>
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn"
                    style={{
                      alignSelf: "flex-start",
                      padding: "10px 14px",
                      fontSize: "13px",
                      background: tint,
                    }}
                  >
                    {P.nbNew[lang]}
                  </button>
                </div>
              )}
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 5: CONNECT AI (UNIVERSAL MCP)
              ════════════════════════════════════════════════════════════════ */}
          {nav === "mcp" && (
            <main
              data-screen-label="Connect AI (MCP)"
              style={{
                flex: 1,
                width: "100%",
                maxWidth: shell.mainMax,
                margin: "0 auto",
                padding: shell.mainPad,
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--color-accent-700)",
                  }}
                >
                  Universal MCP · 2026-07-28
                </span>
                <h1
                  style={{
                    fontSize: "clamp(24px,2.5vw,32px)",
                    lineHeight: 1.3,
                    letterSpacing: "-0.02em",
                    fontWeight: 600,
                    margin: 0,
                    maxWidth: "22ch",
                  }}
                >
                  {P.mcpTitle[lang]}
                </h1>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    maxWidth: "62ch",
                    color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                  }}
                >
                  {P.mcpSub[lang]}
                </p>
              </div>

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(Object.keys(PROV) as ProviderKey[]).map((k) => {
                  const p = pill(prov === k);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setProv(k);
                        setCopied(false);
                      }}
                      style={{
                        padding: "9px 14px",
                        border: 0,
                        cursor: "pointer",
                        font: "600 13px var(--font-body)",
                        background: p.bg,
                        color: p.fg,
                      }}
                    >
                      {PROV[k][0]}
                    </button>
                  );
                })}
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "24px",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    flex: "3 1 460px",
                    minWidth: 0,
                    background: "var(--color-surface)",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                    }}
                  >
                    <h2 style={{ fontSize: "24px", margin: 0 }}>{pv[0]}</h2>
                    <span
                      style={{
                        fontSize: "13px",
                        color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                      }}
                    >
                      {pv[1]}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                      }}
                    >
                      {P.approach[lang]}
                    </span>
                    <span style={{ fontSize: "15px" }}>{pv[2]}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                      }}
                    >
                      {P.endpoint[lang]}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        background: "var(--color-bg)",
                        padding: "8px 8px 8px 12px",
                      }}
                    >
                      <code
                        style={{
                          flex: 1,
                          font: "13px ui-monospace,Menlo,monospace",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {pv[3]}
                      </code>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(pv[3]);
                          } catch {}
                          setCopied(true);
                        }}
                        style={{
                          padding: "7px 12px",
                          fontSize: "12px",
                          background: "color-mix(in srgb,var(--color-text) 8%,transparent)",
                          flex: "none",
                        }}
                      >
                        {copied ? (isTh ? "คัดลอกแล้ว ✓" : "Copied ✓") : isTh ? "คัดลอก" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "color-mix(in srgb,var(--color-text) 60%,transparent)",
                      }}
                    >
                      {P.config[lang]}
                    </span>
                    <div
                      style={{
                        background: "var(--color-text)",
                        color: "var(--color-bg)",
                        font: "13px/1.75 ui-monospace,Menlo,monospace",
                        padding: "18px 20px",
                        whiteSpace: "pre",
                        overflowX: "auto",
                      }}
                    >
                      {pv[4]}
                    </div>
                  </div>
                </div>

                <aside
                  style={{
                    flex: "2 1 300px",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--color-accent-700)",
                      marginBottom: "10px",
                    }}
                  >
                    {P.tools10[lang]}
                  </span>
                  {TOOLS.map((tl) => (
                    <div
                      key={tl[0]}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        padding: "11px 14px",
                        background: "var(--color-surface)",
                      }}
                    >
                      <code style={{ font: "600 12.5px ui-monospace,Menlo,monospace" }}>
                        {tl[0]}
                      </code>
                      <span style={{ fontSize: "12px", color: MUT }}>
                        {isTh ? tl[1] : tl[2]}
                      </span>
                    </div>
                  ))}
                </aside>
              </div>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 6: DEVELOPER
              ════════════════════════════════════════════════════════════════ */}
          {nav === "developer" && (
            <main
              data-screen-label="Developer"
              style={{
                flex: 1,
                width: "100%",
                maxWidth: shell.mainMax,
                margin: "0 auto",
                padding: shell.mainPad,
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  gap: "24px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--color-accent-700)",
                    }}
                  >
                    {t.developer}
                  </span>
                  <h1
                    style={{
                      fontSize: "clamp(24px,2.5vw,32px)",
                      lineHeight: 1.3,
                      letterSpacing: "-0.02em",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    {P.devTitle[lang]}
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "14px",
                      maxWidth: "62ch",
                      color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                    }}
                  >
                    {P.devSub[lang]}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => goto("mcp")}
                  style={{
                    padding: "12px 14px",
                    minWidth: "260px",
                    justifyContent: "space-between",
                    fontSize: "14px",
                  }}
                >
                  {P.devPlayground[lang]}
                  <span>→</span>
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))",
                  gap: "12px",
                }}
              >
                {DEVCAPS.map((d) => (
                  <div
                    key={d[4]}
                    style={{
                      background: "var(--color-surface)",
                      padding: "24px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <h3 style={{ fontSize: "17px", margin: 0 }}>{isTh ? d[0] : d[1]}</h3>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "14px",
                        color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                      }}
                    >
                      {isTh ? d[2] : d[3]}
                    </p>
                    <code
                      style={{
                        marginTop: "auto",
                        font: "12px ui-monospace,Menlo,monospace",
                        color: "var(--color-accent-700)",
                      }}
                    >
                      {d[4]}
                    </code>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "stretch" }}>
                <section
                  style={{
                    flex: "3 1 460px",
                    minWidth: 0,
                    background: "var(--color-surface)",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          letterSpacing: ".08em",
                          textTransform: "uppercase",
                          color: "var(--color-accent-700)",
                        }}
                      >
                        REG-NEO-014
                      </span>
                      <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                        Graph Database · Neo4j AuraDB
                      </h2>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (diag === "running") return;
                        setDiag("running");
                        setTimeout(() => setDiag("done"), 1200);
                      }}
                      style={{
                        padding: "9px 14px",
                        fontSize: "13px",
                        background: "color-mix(in srgb,var(--color-text) 8%,transparent)",
                      }}
                    >
                      {diag === "running"
                        ? isTh
                          ? "กำลังตรวจสอบ…"
                          : "Running…"
                        : isTh
                        ? "ตรวจสอบระบบ"
                        : "Run diagnostics"}
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
                      gap: "20px",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "34px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.1,
                        }}
                      >
                        3,995
                      </div>
                      <div style={{ fontSize: "12px", color: MUT }}>{P.liveNodes[lang]}</div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "34px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.1,
                        }}
                      >
                        0
                      </div>
                      <div style={{ fontSize: "12px", color: MUT }}>{P.orphan[lang]}</div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "34px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.1,
                        }}
                      >
                        100%
                      </div>
                      <div style={{ fontSize: "12px", color: MUT }}>Provenance</div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "34px",
                          letterSpacing: "-0.03em",
                          lineHeight: 1.1,
                          color: "var(--accent-ink)",
                        }}
                      >
                        9/9
                      </div>
                      <div style={{ fontSize: "12px", color: MUT }}>P0 Gates passed</div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      fontSize: "12px",
                      padding: "10px 12px",
                      background: "var(--color-bg)",
                    }}
                  >
                    <code style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>
                      GET /api/v1/infrastructure/graph/health
                    </code>
                    <span style={{ color: MUT }}>
                      {diag === "done"
                        ? isTh
                          ? "ผ่านทุกเกต · เมื่อสักครู่"
                          : "All gates passed · just now"
                        : isTh
                        ? "ตรวจสอบล่าสุด 2026-10-20"
                        : "Last check 2026-10-20"}
                    </span>
                  </div>
                </section>

                <section
                  style={{
                    flex: "2 1 300px",
                    minWidth: 0,
                    background: "var(--color-surface)",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        color: "var(--color-accent-700)",
                      }}
                    >
                      REG-LLM-01..07
                    </span>
                    <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                      Model24 · LLM Router
                    </h2>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {PRIO.map((x) => (
                      <button
                        key={x[0]}
                        type="button"
                        onClick={() => setPrio(x[0])}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "9px 12px",
                          border: 0,
                          cursor: "pointer",
                          textAlign: "left",
                          font: "600 13px var(--font-body)",
                          background: prio === x[0] ? "var(--color-accent-100)" : "transparent",
                          color: prio === x[0] ? "var(--color-accent-800)" : "var(--color-text)",
                        }}
                      >
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            background:
                              prio === x[0] ? "var(--accent-ink)" : "var(--color-neutral-400)",
                          }}
                        />
                        {isTh ? x[1] : x[2]}
                      </button>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      fontSize: "13px",
                      marginTop: "4px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                      <span style={{ color: MUT }}>{P.primaryModel[lang]}</span>
                      <b>Google Gemini</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                      <span style={{ color: MUT }}>{P.reviewer[lang]}</span>
                      <b>Claude</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                      <span style={{ color: MUT }}>Embedding + Reranker</span>
                      <b>TE3-Legal + BGE-M3</b>
                    </div>
                  </div>
                </section>
              </div>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 7: CONTROL (REG24 DIRECT / EASY MODE)
              ════════════════════════════════════════════════════════════════ */}
          {nav === "control" && (
            <main
              data-screen-label="Control"
              style={{
                flex: 1,
                width: "100%",
                maxWidth: shell.mainMax,
                margin: "0 auto",
                padding: shell.mainPad,
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--color-accent-700)",
                  }}
                >
                  {P.ctlKicker[lang]}
                </span>
                <h1
                  style={{
                    fontSize: "clamp(24px,2.5vw,32px)",
                    lineHeight: 1.3,
                    letterSpacing: "-0.02em",
                    fontWeight: 600,
                    margin: 0,
                  }}
                >
                  {P.ctlTitle[lang]}
                </h1>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    maxWidth: "62ch",
                    color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                  }}
                >
                  {P.ctlSub[lang]}
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))",
                  gap: "12px",
                }}
              >
                {TASKS.map((x, i) => (
                  <div
                    key={x[1]}
                    onClick={() => {
                      const target = x[8];
                      if (target === "timemachine") {
                        setChips((prev) => ({ ...prev, tm: true }));
                        goto("research");
                      } else {
                        goto(target);
                      }
                    }}
                    style={{
                      background: i === 0 ? "var(--color-accent)" : "var(--color-surface)",
                      color: i === 0 ? "var(--on-accent)" : "var(--color-text)",
                      padding: "24px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                      minHeight: "240px",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        opacity: 0.9,
                      }}
                    >
                      {isTh ? x[0] : x[1]}
                    </span>
                    <h3 style={{ fontSize: "20px", lineHeight: 1.35, margin: 0 }}>
                      {isTh ? x[2] : x[3]}
                    </h3>
                    <p style={{ margin: 0, fontSize: "14px", opacity: 0.9 }}>
                      {isTh ? x[4] : x[5]}
                    </p>
                    <span
                      style={{
                        marginTop: "auto",
                        fontWeight: 600,
                        fontSize: "14px",
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      {isTh ? x[6] : x[7]}
                      <span>→</span>
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,200px),1fr))",
                  gap: "24px",
                  paddingTop: "8px",
                }}
              >
                {CTLSTATS.map((cs) => (
                  <div key={cs[1]}>
                    <div style={{ fontSize: "12px", color: MUT }}>{isTh ? cs[0] : cs[1]}</div>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "22px",
                        letterSpacing: "-0.02em",
                        marginTop: "4px",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {cs[2]}
                    </div>
                  </div>
                ))}
              </div>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              SCREEN 8: 16 MODULES
              ════════════════════════════════════════════════════════════════ */}
          {nav === "modules" && (
            <main
              data-screen-label="16 Modules"
              style={{
                flex: 1,
                width: "100%",
                maxWidth: shell.mainMax,
                margin: "0 auto",
                padding: shell.mainPad,
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--color-accent-700)",
                  }}
                >
                  Professional view
                </span>
                <h1
                  style={{
                    fontSize: "clamp(24px,2.5vw,32px)",
                    lineHeight: 1.3,
                    letterSpacing: "-0.02em",
                    fontWeight: 600,
                    margin: 0,
                  }}
                >
                  {P.modTitle[lang]}
                </h1>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    maxWidth: "62ch",
                    color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                  }}
                >
                  {P.modSub[lang]}
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,220px),1fr))",
                  gap: "8px",
                }}
              >
                {TILES.map((tl, i) => (
                  <div
                    key={tl[0]}
                    onClick={() => {
                      if (tl[3]) goto(tl[3]);
                    }}
                    style={{
                      background: i === 0 ? "var(--color-accent)" : "var(--color-surface)",
                      color: i === 0 ? "var(--on-accent)" : "var(--color-text)",
                      padding: "20px",
                      minHeight: "140px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "16px",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        font: "600 11px ui-monospace,Menlo,monospace",
                        letterSpacing: ".04em",
                        opacity: 0.9,
                      }}
                    >
                      {tl[0]}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "16px",
                        lineHeight: 1.4,
                      }}
                    >
                      {isTh ? tl[1] : tl[2]}
                    </span>
                  </div>
                ))}
              </div>
            </main>
          )}

          {/* ════════════════════════════════════════════════════════════════
              MINIMAL MODE FOOTER
              ════════════════════════════════════════════════════════════════ */}
          {isMin && (
            <footer
              style={{
                maxWidth: "1440px",
                width: "100%",
                margin: "0 auto",
                padding: "0 clamp(16px,3vw,40px)",
              }}
            >
              <div
                style={{
                  padding: "24px 0 32px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "16px",
                  flexWrap: "wrap",
                  fontSize: "13px",
                  color: "color-mix(in srgb,var(--color-text) 70%,transparent)",
                }}
              >
                <span>{t.footer}</span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    font: "12px ui-monospace,Menlo,monospace",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      flex: "none",
                      background: "var(--accent-ink)",
                      animation: "rgPulse 1.6s ease-in-out infinite",
                    }}
                  />
                  MCP 2026-07-28 · graph 3,995 nodes · P0 gates 9/9 · Gemini ✓
                </span>
                <span style={{ display: "flex", gap: "10px", fontWeight: 600 }}>
                  <a
                    href="#th"
                    onClick={(e) => {
                      e.preventDefault();
                      setLang("th");
                    }}
                    style={{
                      textDecoration: "none",
                      color:
                        lang === "th"
                          ? "var(--color-text)"
                          : "color-mix(in srgb,var(--color-text) 55%,transparent)",
                    }}
                  >
                    TH
                  </a>
                  <span>/</span>
                  <a
                    href="#en"
                    onClick={(e) => {
                      e.preventDefault();
                      setLang("en");
                    }}
                    style={{
                      textDecoration: "none",
                      color:
                        lang === "en"
                          ? "var(--color-text)"
                          : "color-mix(in srgb,var(--color-text) 55%,transparent)",
                    }}
                  >
                    EN
                  </a>
                </span>
              </div>
            </footer>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          MAXIMUM MODE STICKY BOTTOM STATUS BAR
          ════════════════════════════════════════════════════════════════════ */}
      {isMax && (
        <div
          data-screen-label="Max · Status bar"
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 6,
            minHeight: "30px",
            display: "flex",
            alignItems: "center",
            gap: "18px",
            padding: "0 18px",
            background: "var(--canvas)",
            font: "11.5px ui-monospace,Menlo,monospace",
            color: MUT,
            overflowX: "auto",
            whiteSpace: "nowrap",
            scrollbarWidth: "none",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              color: "var(--color-text)",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                flex: "none",
                background: "var(--accent-ink)",
                animation: "rgPulse 1.6s ease-in-out infinite",
              }}
            />
            AI READY
          </span>
          <span>MCP 2026-07-28</span>
          <span>graph 3,995 · 0 orphan</span>
          <span>P0 9/9</span>
          <span>as_of {asOfD}</span>
          <span>model {modelLabel} → Claude</span>
          <span>{traceMs ? `last ${(traceMs / 1000).toFixed(1)}s` : "idle"}</span>
          <span style={{ marginLeft: "auto" }}>tenant.law24.prod</span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          P0 THAI LEGAL MODULES DIALOG
          ════════════════════════════════════════════════════════════════════ */}
      {dbOpen && (
        <div
          className="dialog-backdrop"
          onClick={() => setDbOpen(false)}
          style={{ zIndex: 20 }}
        >
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(640px,100%)",
              padding: "28px",
              gap: "16px",
              borderTop: "4px solid var(--color-accent)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
              }}
            >
              <div>
                <div className="dialog-title" style={{ fontSize: "24px", lineHeight: 1.3 }}>
                  {t.dbTitle}
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                  }}
                >
                  P0 Thailand · MCP &amp; REST
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={() => setDbOpen(false)}
                aria-label="close"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div style={{ borderTop: "2px solid var(--color-text)" }}>
              {MODS.map(([id, tid], i) => (
                <div
                  key={id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px minmax(0,1fr) auto",
                    gap: "12px",
                    alignItems: "baseline",
                    padding: "12px 0",
                    borderBottom: "1px solid var(--color-divider)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "13px",
                      color: "var(--accent-ink)",
                    }}
                  >
                    {id}
                  </span>
                  <span style={{ fontWeight: 600 }}>{t.m[i]}</span>
                  <span
                    style={{
                      fontFamily: "ui-monospace,Menlo,monospace",
                      fontSize: "12px",
                      color: "color-mix(in srgb,var(--color-text) 65%,transparent)",
                    }}
                  >
                    {tid}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
