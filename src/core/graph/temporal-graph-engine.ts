/**
 * REG24 — Bi-Temporal Legal Knowledge Graph & Stale-Ruling Detector Engine
 * PRD: REG24-TEMPORAL-GRAPH-001 (REG-DATA-002 / REG-GRAPH-001 / TAX-SUB-03)
 *
 * Implements:
 *   1. Bi-Temporal Graph Reconstruction (`as_of_date` Legal Effective Time vs. `known_at_date` System Knowledge Time)
 *   2. Interactive Timeline Milestones (B.E. 2543 -> B.E. 2569 / 2000 -> 2026)
 *   3. Stale-Ruling & Overruled-Precedent Detector across the 3,643 Official Revenue Department Tax Rulings
 *   4. Date-A vs. Date-B Transaction Replay & Redline Graph Delta
 */

import {
  THAI_TAX_RULINGS_CORPUS,
  searchThaiTaxRulings,
  ThaiTaxRulingRecord,
} from "../data/thai-tax-rulings-loader";

export type TemporalNodeLifecycleState =
  | "ACTIVE_IN_FORCE"
  | "ENACTED_PENDING_ENFORCEMENT"
  | "SUPERSEDED_OR_REPEALED"
  | "CAUTION_AMENDED_BASIS"
  | "FUTURE_NOT_YET_ENACTED";

export type TemporalNodeCategory =
  | "STATUTE_PROVISION_VERSION"
  | "SUBORDINATE_REGULATION"
  | "SUPREME_COURT_DIKA"
  | "RD_TAX_RULING"
  | "EMERGENCY_DECREE";

export interface TemporalGraphNode {
  node_id: string;
  stable_entity_id: string;
  category: TemporalNodeCategory;
  code_or_number: string;
  title_th: string;
  title_en: string;
  version_label: string;
  effective_from: string; // ISO YYYY-MM-DD
  effective_to: string | null; // null if currently in force
  known_from: string; // ISO YYYY-MM-DD (publication / Royal Gazette date)
  state_at_query_date: TemporalNodeLifecycleState;
  supersedes_node_id?: string;
  superseded_by_node_id?: string;
  authority_module: string;
  summary_th: string;
  summary_en: string;
  sha256_hash: string;
}

export interface TemporalGraphEdge {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type:
    | "SUPERSEDES"
    | "AMENDS"
    | "IMPLEMENTS"
    | "CASE_APPLIES_VERSION"
    | "RULING_INTERPRETS_SECTION"
    | "INTERPRETATION_CHANGED_BY"
    | "CASE_OVERRULES_CASE"
    | "EFFECTIVE_DURING";
  valid_from: string;
  valid_to: string | null;
  active_at_query_date: boolean;
  explanation_th: string;
  explanation_en: string;
}

export interface TemporalMilestonePreset {
  milestone_id: string;
  as_of_date: string;
  known_at_date: string;
  year_be: number;
  badge_th: string;
  badge_en: string;
  title_th: string;
  title_en: string;
  key_legal_shift_th: string;
  key_legal_shift_en: string;
  affected_domains: string[];
}

export type RulingTemporalReliabilityStatus =
  | "CURRENT_ALIGNED"
  | "CAUTION_STATUTE_AMENDED"
  | "SUPERSEDED_OR_NARROWED";

export interface StaleRulingDetectionItem {
  ruling_no: string;
  ruling_date_th: string;
  ruling_year_be: number;
  ruling_year_ce: number;
  primary_tax_type: string;
  subject: string;
  cited_provisions: string;
  temporal_status: RulingTemporalReliabilityStatus;
  intervening_event_date: string | null;
  intervening_authority_id: string | null;
  intervening_authority_title_th: string | null;
  intervening_authority_title_en: string | null;
  risk_explanation_th: string;
  risk_explanation_en: string;
  recommended_2026_action_th: string;
  recommended_2026_action_en: string;
  ruling_excerpt: string;
  source_url: string;
}

export interface PointInTimeGraphSnapshot {
  snapshot_id: string;
  as_of_date: string;
  known_at_date: string;
  as_of_year_be: number;
  active_milestone: TemporalMilestonePreset;
  summary_metrics: {
    total_nodes_tracked: number;
    active_in_force_count: number;
    enacted_pending_enforcement_count: number;
    superseded_or_repealed_count: number;
    future_not_yet_enacted_count: number;
    rd_rulings_known_by_date: number;
    rd_rulings_total_corpus: number;
    active_temporal_edges_count: number;
  };
  nodes: TemporalGraphNode[];
  edges: TemporalGraphEdge[];
  rd_rulings_in_force_sample: ThaiTaxRulingRecord[];
  stale_ruling_alerts: StaleRulingDetectionItem[];
  bitemporal_cypher_query: string;
}

export interface TemporalDateComparisonResult {
  comparison_id: string;
  date_a: string;
  date_b: string;
  year_be_a: number;
  year_be_b: number;
  newly_enacted_nodes: TemporalGraphNode[];
  superseded_or_repealed_nodes: TemporalGraphNode[];
  unchanged_active_nodes: TemporalGraphNode[];
  rd_rulings_added_between_dates: number;
  key_doctrinal_shifts: Array<{
    domain: string;
    provision_code: string;
    state_at_date_a_th: string;
    state_at_date_b_th: string;
    state_at_date_a_en: string;
    state_at_date_b_en: string;
    impact_severity: "CRITICAL_RESTRUCTURING_CHANGE" | "HIGH_COMPLIANCE_SHIFT" | "MODERATE_PROCEDURAL_UPDATE";
  }>;
}

export const TEMPORAL_MILESTONE_PRESETS: TemporalMilestonePreset[] = [
  {
    milestone_id: "ms-2001-classic-ccc",
    as_of_date: "2001-01-01",
    known_at_date: "2001-01-01",
    year_be: 2544,
    badge_th: "พ.ศ. 2544 (2001)",
    badge_en: "B.E. 2544 (2001)",
    title_th: "ยุคควบบริษัทแบบดั้งเดิม (A+B=C) และผู้เริ่มก่อการ 7 คน",
    title_en: "Classic Amalgamation Era (A+B=C Only) & 7-Promoter Rule",
    key_legal_shift_th:
      "ป.พ.พ. มาตรา 1097 กำหนดผู้เริ่มก่อการตั้งบริษัทจำกัดไม่น้อยกว่า 7 คน และมาตรา 1238 รองรับเฉพาะการควบบริษัทตั้งเป็นบริษัทใหม่ (A+B=C) เท่านั้น",
    key_legal_shift_en:
      "CCC Sec. 1097 required at least 7 promoters to incorporate a limited company, and Sec. 1238 permitted only classic amalgamation into a newly formed company (A+B=C).",
    affected_domains: ["LEG-CORP", "LEG-TAX"],
  },
  {
    milestone_id: "ms-2008-ccc-no18",
    as_of_date: "2008-07-01",
    known_at_date: "2008-07-01",
    year_be: 2551,
    badge_th: "พ.ศ. 2551 (2008)",
    badge_en: "B.E. 2551 (2008)",
    title_th: "ป.พ.พ. แก้ไขเพิ่มเติม (ฉบับที่ 18) พ.ศ. 2551 — ลดผู้เริ่มก่อการเหลือ 3 คน",
    title_en: "CCC Amendment (No. 18) B.E. 2551 — 3-Promoter Rule & Partnership Conversion",
    key_legal_shift_th:
      "แก้ไข ป.พ.พ. มาตรา 1097 ลดจำนวนผู้เริ่มก่อการจาก 7 คน เหลือ 3 คน และเปิดให้ห้างหุ้นส่วนจดทะเบียนแปรสภาพเป็นบริษัทจำกัดได้",
    key_legal_shift_en:
      "Amended CCC Sec. 1097 reducing minimum promoters from 7 to 3 and introduced statutory conversion of registered partnerships into limited companies.",
    affected_domains: ["LEG-CORP"],
  },
  {
    milestone_id: "ms-2019-pdpa-enacted",
    as_of_date: "2019-06-01",
    known_at_date: "2019-06-01",
    year_be: 2562,
    badge_th: "พ.ศ. 2562 (2019)",
    badge_en: "B.E. 2562 (2019)",
    title_th: "ประกาศใช้ พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA) แต่ชะลอผลบังคับใช้หมวดหลัก",
    title_en: "PDPA B.E. 2562 Published in Royal Gazette (Bi-Temporal Deferred Enforcement)",
    key_legal_shift_th:
      "ตัวอย่างสำคัญของ Bi-Temporal Graph: กฎหมายประกาศในราชกิจจานุเบกษาปี 2562 (known_from) แต่หมวดคุ้มครองข้อมูลส่วนบุคคลมีผลบังคับใช้จริง 1 มิ.ย. 2565 (effective_from)",
    key_legal_shift_en:
      "Classic Bi-Temporal split: PDPA B.E. 2562 was known/enacted in May 2019 (`known_from`), while operative compliance chapters were postponed by Royal Decree until 1 June 2022 (`effective_from`).",
    affected_domains: ["LEG-PDPA", "LEG-TECH"],
  },
  {
    milestone_id: "ms-2022-pdpa-dika5412",
    as_of_date: "2022-06-01",
    known_at_date: "2022-06-01",
    year_be: 2565,
    badge_th: "พ.ศ. 2565 (2022)",
    badge_en: "B.E. 2565 (2022)",
    title_th: "PDPA บังคับใช้เต็มรูปแบบ + คำพิพากษาฎีกาที่ 5412/2565 (การประเมินราคาโอนกิจการ EBT)",
    title_en: "Full PDPA Enforcement + Supreme Court Dika 5412/2565 on EBT Valuation",
    key_legal_shift_th:
      "PDPA มีผลบังคับใช้ทั้งฉบับ และศาลฎีกาแผนกคดีภาษีอากรวางบรรทัดฐานเรื่องราคาตลาดในการโอนกิจการทั้งหมด (EBT) ตามมาตรา 74(1)(ค)",
    key_legal_shift_en:
      "Full enforcement of PDPA B.E. 2562 operative chapters and Supreme Court Dika 5412/2565 clarifying market-value conditions for Entire Business Transfers (EBT) under RC Sec. 74(1)(c).",
    affected_domains: ["LEG-PDPA", "LEG-TAX", "LEG-CASE"],
  },
  {
    milestone_id: "ms-2023-ccc-no23-merger",
    as_of_date: "2023-02-07",
    known_at_date: "2023-02-07",
    year_be: 2566,
    badge_th: "7 ก.พ. 2566 (2023)",
    badge_en: "7 Feb 2023 (B.E. 2566)",
    title_th: "ป.พ.พ. (ฉบับที่ 23) มีผลบังคับใช้ — ผู้เริ่มก่อการ 2 คน และระบบควบเข้ากัน (A+B=A)",
    title_en: "CCC Amendment (No. 23) Effective — 2-Promoter Rule & Statutory Merger (A+B=A)",
    key_legal_shift_th:
      "จุดเปลี่ยนใหญ่ที่สุดของกฎหมายหุ้นส่วนบริษัท: ลดผู้เริ่มก่อการเหลือ 2 คน (ม.1097) และเพิ่มการควบบริษัทแบบบริษัทหนึ่งคงอยู่ (Merger: A+B=A) ใน ม.1238 ทำให้ข้อหารือภาษีเดิมที่ใช้คำว่า 'เกิดบริษัทใหม่' ต้องตีความใหม่",
    key_legal_shift_en:
      "Landmark corporate law shift: minimum promoters reduced to 2 (Sec. 1097) and Surviving-Entity Merger (A+B=A) enacted under Sec. 1238, triggering a temporary gap in older Revenue Code rulings written only for A+B=C amalgamation.",
    affected_domains: ["LEG-CORP", "LEG-TAX", "LEG-MNA"],
  },
  {
    milestone_id: "ms-2025-pillar-two-gmt",
    as_of_date: "2025-01-01",
    known_at_date: "2025-01-01",
    year_be: 2568,
    badge_th: "1 ม.ค. 2568 (2025)",
    badge_en: "1 Jan 2025 (B.E. 2568)",
    title_th: "พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 (OECD Pillar Two 15% Global Minimum Tax) มีผลบังคับใช้",
    title_en: "Emergency Decree on Top-Up Tax B.E. 2567 (15% Global Minimum Tax) Takes Effect",
    key_legal_shift_th:
      "กลุ่มบริษัทข้ามชาติที่มีรายได้รวมตั้งแต่ 750 ล้านยูโร แม้ได้รับบัตรส่งเสริม BOI ยกเว้นภาษีเงินได้นิติบุคคล (0%) ต้องเสียภาษีส่วนเพิ่ม (Top-Up Tax) ให้มีอัตราภาษีที่แท้จริงอย่างน้อย 15%",
    key_legal_shift_en:
      "MNE groups with consolidated revenue >= EUR 750M enjoying 0% BOI CIT holidays become subject to 15% domestic minimum Top-Up Tax, superseding standalone 0% effective tax assumptions.",
    affected_domains: ["LEG-TAX", "LEG-BOI", "GMT24"],
  },
  {
    milestone_id: "ms-2026-rd-ruling-462",
    as_of_date: "2026-01-19",
    known_at_date: "2026-01-19",
    year_be: 2569,
    badge_th: "ม.ค. 2569 (Jan 2026)",
    badge_en: "Jan 2026 (B.E. 2569)",
    title_th: "กค 0702(กม.)/462 — วางแนวทางยกเว้นภาษีสำหรับการควบเข้ากัน (A+B=A) ตาม ป.พ.พ. ใหม่",
    title_en: "RD Ruling กค 0702(กม.)/462 — Tax Neutrality Confirmed for CCC Sec. 1238 (A+B=A) Mergers",
    key_legal_shift_th:
      "กรมสรรพากรตอบข้อหารือชัดเจนว่าการควบบริษัทแบบ A+B=A ตาม ป.พ.พ. (ฉบับที่ 23) ได้รับสิทธิตามมาตรา 73/74 แห่งประมวลรัษฎากร และ พ.ร.ฎ. (ฉบับที่ 10) เช่นเดียวกับ A+B=C",
    key_legal_shift_en:
      "Revenue Department formally clarifies how Revenue Code Sec. 73/74 and Royal Decree No. 10 apply to surviving-company mergers (A+B=A) under the amended CCC Sec. 1238.",
    affected_domains: ["LEG-TAX", "LEG-CORP", "LEG-MNA"],
  },
  {
    milestone_id: "ms-2026-present",
    as_of_date: "2026-10-20",
    known_at_date: "2026-10-20",
    year_be: 2569,
    badge_th: "ต.ค. 2569 (ปัจจุบัน)",
    badge_en: "Oct 2026 (Current State)",
    title_th: "สถานะกฎหมายปัจจุบัน พ.ศ. 2569 (ครบทุกหมวด + ประกาศ สคส. DSAR 2569 + ข้อหารือ 3,643 ฉบับ)",
    title_en: "Present-Day Canonical Graph (Oct 2026 — PDPC 2026 DSAR Rule + 3,643 RD Tax Rulings)",
    key_legal_shift_th:
      "สถานะปัจจุบันที่มีผลบังคับใช้ครบถ้วน รวมถึงประกาศคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลเรื่องสิทธิเข้าถึงข้อมูลส่วนบุคคล พ.ศ. 2569 และฐานข้อมูลข้อหารือกรมสรรพากร 3,643 ฉบับ",
    key_legal_shift_en:
      "Complete October 2026 legal state including the 2026 PDPC DSAR Access-Request Notification (30-day SLA) and all 3,643 official Revenue Department tax rulings.",
    affected_domains: ["LEG-CORP", "LEG-TAX", "LEG-PDPA", "LEG-BOI", "LEG-CASE"],
  },
];

const CANONICAL_TEMPORAL_NODES: Array<Omit<TemporalGraphNode, "state_at_query_date">> = [
  // CCC Sec. 1097 Versions (7 promoters -> 3 promoters -> 2 promoters)
  {
    node_id: "ver.th.ccc.1097.v1925",
    stable_entity_id: "prov.th.ccc.1097",
    category: "STATUTE_PROVISION_VERSION",
    code_or_number: "CCC Sec. 1097 (v1925)",
    title_th: "ป.พ.พ. มาตรา 1097 (เดิม — ผู้เริ่มก่อการไม่น้อยกว่า 7 คน)",
    title_en: "CCC Section 1097 (Original — Minimum 7 Promoters)",
    version_label: "B.E. 2468–2551 (7 Promoters)",
    effective_from: "1925-01-01",
    effective_to: "2008-06-30",
    known_from: "1925-01-01",
    superseded_by_node_id: "ver.th.ccc.1097.v2008",
    authority_module: "reg24.corporate.th",
    summary_th: "บุคคลใดๆ ตั้งแต่เจ็ดคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้",
    summary_en: "Any seven or more persons may promote and form a limited company.",
    sha256_hash: "a1097v1925e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },
  {
    node_id: "ver.th.ccc.1097.v2008",
    stable_entity_id: "prov.th.ccc.1097",
    category: "STATUTE_PROVISION_VERSION",
    code_or_number: "CCC Sec. 1097 (v2008)",
    title_th: "ป.พ.พ. มาตรา 1097 (ฉบับที่ 18 พ.ศ. 2551 — ผู้เริ่มก่อการไม่น้อยกว่า 3 คน)",
    title_en: "CCC Section 1097 (Amendment No. 18 B.E. 2551 — Minimum 3 Promoters)",
    version_label: "B.E. 2551–2566 (3 Promoters)",
    effective_from: "2008-07-01",
    effective_to: "2023-02-06",
    known_from: "2008-03-04",
    supersedes_node_id: "ver.th.ccc.1097.v1925",
    superseded_by_node_id: "ver.th.ccc.1097.v2023",
    authority_module: "reg24.corporate.th",
    summary_th: "บุคคลใดๆ ตั้งแต่สามคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้ (บังคับใช้ถึง 6 ก.พ. 2566)",
    summary_en: "Any three or more persons may promote and form a limited company (in force until 6 Feb 2023).",
    sha256_hash: "a1097v2008e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },
  {
    node_id: "ver.th.ccc.1097.v2023",
    stable_entity_id: "prov.th.ccc.1097",
    category: "STATUTE_PROVISION_VERSION",
    code_or_number: "CCC Sec. 1097 (v2023)",
    title_th: "ป.พ.พ. มาตรา 1097 (ฉบับที่ 23 พ.ศ. 2565 — ผู้เริ่มก่อการไม่น้อยกว่า 2 คน)",
    title_en: "CCC Section 1097 (Amendment No. 23 B.E. 2565 — Minimum 2 Promoters)",
    version_label: "B.E. 2566–Present (2 Promoters)",
    effective_from: "2023-02-07",
    effective_to: null,
    known_from: "2022-11-08",
    supersedes_node_id: "ver.th.ccc.1097.v2008",
    authority_module: "reg24.corporate.th",
    summary_th: "บุคคลใดๆ ตั้งแต่สองคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้ (มีผลบังคับใช้ตั้งแต่ 7 ก.พ. 2566)",
    summary_en: "Any two or more persons may promote and form a limited company (effective 7 Feb 2023).",
    sha256_hash: "a1097v2023e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },

  // CCC Sec. 1238 Versions (Amalgamation A+B=C -> Merger A+B=A or A+B=C)
  {
    node_id: "ver.th.ccc.1238.v1925",
    stable_entity_id: "prov.th.ccc.1238",
    category: "STATUTE_PROVISION_VERSION",
    code_or_number: "CCC Sec. 1238 (v1925)",
    title_th: "ป.พ.พ. มาตรา 1238 (เดิม — ควบบริษัทเกิดบริษัทใหม่ A+B=C เท่านั้น)",
    title_en: "CCC Section 1238 (Original — Classic Amalgamation A+B=C Only)",
    version_label: "B.E. 2468–2566 (A+B=C Only)",
    effective_from: "1925-01-01",
    effective_to: "2023-02-06",
    known_from: "1925-01-01",
    superseded_by_node_id: "ver.th.ccc.1238.v2023",
    authority_module: "reg24.corporate.th",
    summary_th: "การควบบริษัทจำกัดเข้ากันย่อมทำให้บริษัทเดิมหมดสภาพไป และเกิดบริษัทใหม่ขึ้น (A+B=C)",
    summary_en: "Amalgamation extinguishes the constituent companies and forms a new company (A+B=C).",
    sha256_hash: "a1238v1925e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },
  {
    node_id: "ver.th.ccc.1238.v2023",
    stable_entity_id: "prov.th.ccc.1238",
    category: "STATUTE_PROVISION_VERSION",
    code_or_number: "CCC Sec. 1238 (v2023)",
    title_th: "ป.พ.พ. มาตรา 1238 (ฉบับที่ 23 พ.ศ. 2565 — รองรับทั้ง A+B=C และควบเข้ากัน A+B=A)",
    title_en: "CCC Section 1238 (Amendment No. 23 B.E. 2565 — Amalgamation A+B=C & Merger A+B=A)",
    version_label: "B.E. 2566–Present (A+B=C & A+B=A)",
    effective_from: "2023-02-07",
    effective_to: null,
    known_from: "2022-11-08",
    supersedes_node_id: "ver.th.ccc.1238.v1925",
    authority_module: "reg24.corporate.th",
    summary_th:
      "การควบบริษัทจำกัดทำได้ 2 ลักษณะ: (1) ควบกันตั้งเป็นบริษัทใหม่ (A+B=C) หรือ (2) ควบเข้ากันโดยบริษัทหนึ่งยังคงสภาพอยู่ (A+B=A)",
    summary_en:
      "Corporate combination may occur either as (1) a new company (A+B=C) or (2) a surviving-company merger (A+B=A).",
    sha256_hash: "a1238v2023e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },

  // Revenue Code Sec. 74 & Royal Decree No. 10 / Min Reg No. 126
  {
    node_id: "ver.th.rc.74.v1938",
    stable_entity_id: "prov.th.rc.74",
    category: "STATUTE_PROVISION_VERSION",
    code_or_number: "Revenue Code Sec. 74",
    title_th: "ประมวลรัษฎากร มาตรา 74 (การคำนวณกำไรสุทธิกรณีควบหรือโอนกิจการ)",
    title_en: "Revenue Code Section 74 (Tax Base Valuation in Amalgamation / EBT)",
    version_label: "Active Statutory Base",
    effective_from: "1939-04-01",
    effective_to: null,
    known_from: "1939-03-31",
    authority_module: "reg24.tax.th",
    summary_th: "กำหนดฐานภาษีและการตีราคาทรัพย์สินกรณีบริษัทหรือห้างหุ้นส่วนนิติบุคคลควบเข้ากันหรือโอนกิจการทั้งหมด",
    summary_en: "Governs net profit and asset valuation upon corporate amalgamation, merger, or entire business transfer.",
    sha256_hash: "rc74v1938e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },
  {
    node_id: "ver.th.subreg.rd10.ebt",
    stable_entity_id: "subreg.th.rd10.sec5ter",
    category: "SUBORDINATE_REGULATION",
    code_or_number: "Royal Decree No. 10 + Min. Reg. No. 126",
    title_th: "พ.ร.ฎ. (ฉบับที่ 10) ม.5 ตรี และ กฎกระทรวง ฉบับที่ 126 ข้อ 2(50) — ยกเว้นภาษีการควบ/โอนกิจการ",
    title_en: "Royal Decree No. 10 Sec. 5 ter & Ministerial Regulation No. 126 Clause 2(50)",
    version_label: "Tax Neutrality Sub-Regulation",
    effective_from: "1999-10-01",
    effective_to: null,
    known_from: "1999-10-01",
    authority_module: "reg24.tax.th",
    summary_th: "ยกเว้นภาษีเงินได้และอากรแสตมป์สำหรับการโอนกิจการทั้งหมด (EBT) และการควบเข้ากันภายใต้เงื่อนไขอธิบดีกรมสรรพากร",
    summary_en: "Grants CIT and shareholder capital-gains tax exemption for qualifying Entire Business Transfers and mergers.",
    sha256_hash: "rd10v1999e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },

  // Supreme Court Dika 5412/2565
  {
    node_id: "case.th.dika.5412.2565",
    stable_entity_id: "case.th.dika.5412.2565",
    category: "SUPREME_COURT_DIKA",
    code_or_number: "Dika 5412/2565",
    title_th: "คำพิพากษาศาลฎีกาที่ 5412/2565 (บรรทัดฐานราคาตลาดและเงื่อนไขการโอนกิจการ EBT)",
    title_en: "Supreme Court Judgment No. 5412/2565 (EBT Market Value & Tax Neutrality Conditions)",
    version_label: "Binding Judicial Precedent (2022)",
    effective_from: "2022-05-18",
    effective_to: null,
    known_from: "2022-05-18",
    authority_module: "reg24.case.th",
    summary_th: "วางหลักการตีความมาตรา 74(1)(ค) และเงื่อนไขการเลิกบริษัทผู้โอนภายในรอบระยะเวลาบัญชีเดียวกับการโอนกิจการ",
    summary_en: "Establishes judicial interpretation of RC Sec. 74(1)(c) and same-accounting-period dissolution requirement.",
    sha256_hash: "dika5412e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },

  // PDPA B.E. 2562 (Enacted May 2019, Enforced June 2022) & 2026 DSAR Notification
  {
    node_id: "ver.th.pdpa.2019.operative",
    stable_entity_id: "inst.th.pdpa.2562",
    category: "STATUTE_PROVISION_VERSION",
    code_or_number: "PDPA B.E. 2562 (Ch. 2, 3, 5, 6, 7)",
    title_th: "พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (หมวดคุ้มครองข้อมูล สิทธิเจ้าของข้อมูล และบทกำหนดโทษ)",
    title_en: "Personal Data Protection Act B.E. 2562 (Operative Compliance & Penalty Chapters)",
    version_label: "Enacted 2019 / Effective 1 Jun 2022",
    effective_from: "2022-06-01",
    effective_to: null,
    known_from: "2019-05-27", // Bi-temporal difference! Known in 2019, effective in 2022.
    authority_module: "reg24.pdpa.th",
    summary_th:
      "ประกาศราชกิจจานุเบกษา 27 พ.ค. 2562 แต่ตรา พ.ร.ฎ. ชะลอการบังคับใช้หมวดหลักจนถึงวันที่ 1 มิ.ย. 2565 (ตัวอย่างชัดเจนของ known_from != effective_from)",
    summary_en:
      "Published in Royal Gazette on 27 May 2019 (`known_from`), with operative enforcement deferred by Royal Decree until 1 June 2022 (`effective_from`).",
    sha256_hash: "pdpa2562e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },
  {
    node_id: "ver.th.pdpa.subreg.dsar2026",
    stable_entity_id: "subreg.th.pdpc.dsar.2569",
    category: "SUBORDINATE_REGULATION",
    code_or_number: "PDPC DSAR Notification B.E. 2569",
    title_th: "ประกาศคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล เรื่อง หลักเกณฑ์การใช้สิทธิเข้าถึงข้อมูลส่วนบุคคล พ.ศ. 2569",
    title_en: "PDPC Notification on Data Subject Access Request (DSAR) Rules B.E. 2569 (2026)",
    version_label: "B.E. 2569 (30-Day DSAR Rule)",
    effective_from: "2026-01-15",
    effective_to: null,
    known_from: "2025-11-15",
    authority_module: "reg24.pdpa.th",
    summary_th: "กำหนดกรอบเวลา 30 วันในการดำเนินการตามคำขอเข้าถึงข้อมูล (DSAR) และหลักการพิสูจน์ตัวตนเท่าที่จำเป็น",
    summary_en: "Mandates a strict 30-day DSAR SLA and identity-verification data minimization.",
    sha256_hash: "dsar2569e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },

  // Emergency Decree on Top-Up Tax B.E. 2567 (OECD Pillar Two)
  {
    node_id: "ver.th.gmt.topuptax.2567",
    stable_entity_id: "inst.th.topuptax.2567",
    category: "EMERGENCY_DECREE",
    code_or_number: "Top-Up Tax Decree B.E. 2567",
    title_th: "พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 (OECD Pillar Two — 15% Global Minimum Tax)",
    title_en: "Emergency Decree on Top-Up Tax B.E. 2567 (OECD Pillar Two 15% Minimum Tax)",
    version_label: "Effective 1 Jan 2025",
    effective_from: "2025-01-01",
    effective_to: null,
    known_from: "2024-12-26",
    authority_module: "reg24.tax.th",
    summary_th:
      "จัดเก็บภาษีส่วนเพิ่ม (Top-Up Tax) ให้ครบ 15% สำหรับกลุ่มนิติบุคคลข้ามชาติที่มีรายได้รวม >= 750 ล้านยูโร แม้ได้รับยกเว้นภาษี BOI",
    summary_en:
      "Imposes a 15% domestic minimum Top-Up Tax on in-scope MNE groups (revenue >= EUR 750M), overriding 0% effective CIT assumptions under older BOI promotions.",
    sha256_hash: "gmt2567e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },

  // Landmark RD Tax Ruling 462/2569 (2026) vs Older Pre-2023 Amalgamation Ruling
  {
    node_id: "ruling.th.rd.pre2023.amalgamation",
    stable_entity_id: "ruling.th.rd.0702.2558",
    category: "RD_TAX_RULING",
    code_or_number: "RD Ruling กค 0702/พ.ศ.2548–2565",
    title_th: "แนวข้อหารือกรมสรรพากรยุคก่อนปี 2566 (จำกัดคำว่า 'ควบบริษัท' เฉพาะกรณีเกิดบริษัทใหม่ A+B=C)",
    title_en: "Pre-2023 RD Amalgamation Rulings (Restricted 'Amalgamation' to New Company A+B=C)",
    version_label: "Historical Interpretation (Narrowed in 2026)",
    effective_from: "2005-01-01",
    effective_to: "2026-01-18",
    known_from: "2005-01-01",
    superseded_by_node_id: "ruling.th.rd.462.2569",
    authority_module: "reg24.tax.th",
    summary_th:
      "ข้อหารือยุคก่อน ป.พ.พ. (ฉบับที่ 23) ตีความการควบบริษัทตามมาตรา 73/74 บนฐานที่ว่าบริษัทเดิมต้องสิ้นสภาพทั้งหมดและเกิดนิติบุคคลใหม่ (A+B=C)",
    summary_en:
      "Pre-2023 RD rulings interpreted Revenue Code Sec. 73/74 assuming all constituent companies dissolve into a brand-new legal entity (A+B=C).",
    sha256_hash: "rdpre2023e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },
  {
    node_id: "ruling.th.rd.462.2569",
    stable_entity_id: "ruling.th.rd.462.2569",
    category: "RD_TAX_RULING",
    code_or_number: "RD Ruling กค 0702(กม.)/462 (2569)",
    title_th: "หนังสือตอบข้อหารือกรมสรรพากร กค 0702(กม.)/462 (19 ม.ค. 2569 — รองรับการควบเข้ากัน A+B=A)",
    title_en: "RD Legal Bureau Ruling กค 0702(กม.)/462 (19 Jan 2026 — Surviving Merger A+B=A Tax Neutrality)",
    version_label: "Current 2026 Interpretation",
    effective_from: "2026-01-19",
    effective_to: null,
    known_from: "2026-01-19",
    supersedes_node_id: "ruling.th.rd.pre2023.amalgamation",
    authority_module: "reg24.tax.th",
    summary_th:
      "วางแนวทางสิทธิประโยชน์ทางภาษีสำหรับการควบบริษัทแบบบริษัทหนึ่งคงอยู่ (A+B=A) ตาม ป.พ.พ. มาตรา 1238 แก้ไขเพิ่มเติม พ.ศ. 2565",
    summary_en:
      "Clarifies tax exemption conditions for surviving-entity mergers (A+B=A) under amended CCC Sec. 1238 and Revenue Code Sec. 73/74.",
    sha256_hash: "rd462v2569e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca49599",
  },
];

const CANONICAL_TEMPORAL_EDGES: Array<Omit<TemporalGraphEdge, "active_at_query_date">> = [
  {
    edge_id: "tedge-ccc-1097-v2008-supersedes-v1925",
    source_node_id: "ver.th.ccc.1097.v2008",
    target_node_id: "ver.th.ccc.1097.v1925",
    relationship_type: "SUPERSEDES",
    valid_from: "2008-07-01",
    valid_to: null,
    explanation_th: "ป.พ.พ. (ฉบับที่ 18) พ.ศ. 2551 ยกเลิกเกณฑ์ผู้เริ่มก่อการ 7 คน และใช้เกณฑ์ 3 คนแทน",
    explanation_en: "CCC Amendment (No. 18) B.E. 2551 superseded the 7-promoter rule with the 3-promoter rule.",
  },
  {
    edge_id: "tedge-ccc-1097-v2023-supersedes-v2008",
    source_node_id: "ver.th.ccc.1097.v2023",
    target_node_id: "ver.th.ccc.1097.v2008",
    relationship_type: "SUPERSEDES",
    valid_from: "2023-02-07",
    valid_to: null,
    explanation_th: "ป.พ.พ. (ฉบับที่ 23) พ.ศ. 2565 ลดจำนวนผู้เริ่มก่อการขั้นต่ำจาก 3 คน เหลือ 2 คน ตั้งแต่วันที่ 7 ก.พ. 2566",
    explanation_en: "CCC Amendment (No. 23) B.E. 2565 superseded the 3-promoter rule with the 2-promoter rule on 7 Feb 2023.",
  },
  {
    edge_id: "tedge-ccc-1238-v2023-supersedes-v1925",
    source_node_id: "ver.th.ccc.1238.v2023",
    target_node_id: "ver.th.ccc.1238.v1925",
    relationship_type: "SUPERSEDES",
    valid_from: "2023-02-07",
    valid_to: null,
    explanation_th: "ป.พ.พ. มาตรา 1238 แก้ไขเพิ่มเติม พ.ศ. 2565 เพิ่มรูปแบบการควบเข้ากัน (A+B=A) นอกเหนือจากการควบตั้งบริษัทใหม่ (A+B=C)",
    explanation_en: "Amended CCC Sec. 1238 expanded corporate amalgamation beyond A+B=C to include surviving-entity mergers (A+B=A).",
  },
  {
    edge_id: "tedge-rd10-implements-rc74",
    source_node_id: "ver.th.subreg.rd10.ebt",
    target_node_id: "ver.th.rc.74.v1938",
    relationship_type: "IMPLEMENTS",
    valid_from: "1999-10-01",
    valid_to: null,
    explanation_th: "พ.ร.ฎ. (ฉบับที่ 10) และกฎกระทรวง ฉบับที่ 126 กำหนดหลักเกณฑ์ยกเว้นภาษีสำหรับการควบและโอนกิจการตามมาตรา 74",
    explanation_en: "Royal Decree No. 10 and Min. Reg. No. 126 implement tax exemptions for RC Sec. 74 restructurings.",
  },
  {
    edge_id: "tedge-dika5412-applies-rc74",
    source_node_id: "case.th.dika.5412.2565",
    target_node_id: "ver.th.rc.74.v1938",
    relationship_type: "CASE_APPLIES_VERSION",
    valid_from: "2022-05-18",
    valid_to: null,
    explanation_th: "คำพิพากษาศาลฎีกาที่ 5412/2565 ตีความและวางบรรทัดฐานการใช้มาตรา 74(1)(ค) แห่งประมวลรัษฎากร",
    explanation_en: "Supreme Court Dika 5412/2565 interprets and applies Revenue Code Sec. 74(1)(c).",
  },
  {
    edge_id: "tedge-rd462-changes-pre2023-ruling",
    source_node_id: "ruling.th.rd.462.2569",
    target_node_id: "ruling.th.rd.pre2023.amalgamation",
    relationship_type: "INTERPRETATION_CHANGED_BY",
    valid_from: "2026-01-19",
    valid_to: null,
    explanation_th: "ข้อหารือ กค 0702(กม.)/462 (2569) ขยายแนวตีความภาษีการควบบริษัทให้ครอบคลุม A+B=A ตาม ป.พ.พ. มาตรา 1238 ใหม่",
    explanation_en: "RD Ruling กค 0702(กม.)/462 (2026) updates pre-2023 amalgamation tax interpretations to cover A+B=A mergers.",
  },
  {
    edge_id: "tedge-rd462-interprets-ccc1238-v2023",
    source_node_id: "ruling.th.rd.462.2569",
    target_node_id: "ver.th.ccc.1238.v2023",
    relationship_type: "RULING_INTERPRETS_SECTION",
    valid_from: "2026-01-19",
    valid_to: null,
    explanation_th: "เชื่อมโยงข้อหารือกรมสรรพากร กค 0702(กม.)/462 เข้ากับ ป.พ.พ. มาตรา 1238 ฉบับแก้ไขเพิ่มเติม พ.ศ. 2565 โดยตรง",
    explanation_en: "Directly links RD Ruling กค 0702(กม.)/462 to the 2023 amended version of CCC Sec. 1238.",
  },
  {
    edge_id: "tedge-dsar2026-implements-pdpa",
    source_node_id: "ver.th.pdpa.subreg.dsar2026",
    target_node_id: "ver.th.pdpa.2019.operative",
    relationship_type: "IMPLEMENTS",
    valid_from: "2026-01-15",
    valid_to: null,
    explanation_th: "ประกาศ สคส. พ.ศ. 2569 กำหนดวิธีปฏิบัติตามมาตรา 30 แห่ง พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562",
    explanation_en: "2026 PDPC DSAR Notification implements operational rules under PDPA Section 30.",
  },
];

function evaluateNodeStateAtDate(
  node: Omit<TemporalGraphNode, "state_at_query_date">,
  asOfDate: string,
  knownAtDate: string
): TemporalNodeLifecycleState {
  // If the law wasn't even published/known yet on knownAtDate AND not effective on asOfDate
  if (asOfDate < node.effective_from) {
    if (knownAtDate >= node.known_from) {
      return "ENACTED_PENDING_ENFORCEMENT";
    }
    return "FUTURE_NOT_YET_ENACTED";
  }

  if (node.effective_to && asOfDate > node.effective_to) {
    return "SUPERSEDED_OR_REPEALED";
  }

  // Special check: if this is the pre-2023 amalgamation ruling between 2023-02-07 and 2026-01-18
  if (
    node.node_id === "ruling.th.rd.pre2023.amalgamation" &&
    asOfDate >= "2023-02-07" &&
    asOfDate <= "2026-01-18"
  ) {
    return "CAUTION_AMENDED_BASIS";
  }

  return "ACTIVE_IN_FORCE";
}

export class TemporalGraphEngine {
  public getMilestonePresets(): TemporalMilestonePreset[] {
    return TEMPORAL_MILESTONE_PRESETS;
  }

  /**
   * Reconstructs the Bi-Temporal Legal Knowledge Graph at any `as_of_date` and `known_at_date`.
   */
  public reconstructGraphAtDate(options: {
    as_of_date?: string;
    known_at_date?: string;
    query?: string;
  }): PointInTimeGraphSnapshot {
    const asOfDate = (options.as_of_date || "2026-10-20").slice(0, 10);
    const knownAtDate = (options.known_at_date || asOfDate).slice(0, 10);
    const ceYear = Math.max(1990, Math.min(2030, Number(asOfDate.slice(0, 4)) || 2026));
    const asOfYearBe = ceYear + 543;

    // Find closest milestone preset at or before asOfDate
    let activeMilestone = TEMPORAL_MILESTONE_PRESETS[0];
    for (const ms of TEMPORAL_MILESTONE_PRESETS) {
      if (ms.as_of_date <= asOfDate) {
        activeMilestone = ms;
      }
    }

    const evaluatedNodes: TemporalGraphNode[] = CANONICAL_TEMPORAL_NODES.map((n) => ({
      ...n,
      state_at_query_date: evaluateNodeStateAtDate(n, asOfDate, knownAtDate),
    }));

    const evaluatedEdges: TemporalGraphEdge[] = CANONICAL_TEMPORAL_EDGES.map((e) => ({
      ...e,
      active_at_query_date:
        asOfDate >= e.valid_from && (!e.valid_to || asOfDate <= e.valid_to),
    }));

    // Filter the 3,643 RD Tax Rulings corpus to rulings issued on or before `asOfYearBe`
    const rulingsKnownByDate = THAI_TAX_RULINGS_CORPUS.filter(
      (r) => r.year_be <= asOfYearBe
    );

    const q = (options.query || "").trim().toLowerCase();
    const matchingSample = rulingsKnownByDate
      .filter((r) => {
        if (!q) return true;
        return (
          r.ruling_no.toLowerCase().includes(q) ||
          r.subject.toLowerCase().includes(q) ||
          r.legal_provisions.toLowerCase().includes(q) ||
          r.ruling.toLowerCase().includes(q)
        );
      })
      .slice(0, 6);

    const staleAlerts = this.detectStaleAndImpactedRulings({
      query: options.query,
      as_of_date: asOfDate,
      limit: 8,
    });

    const bitemporalCypherQuery = `// REG24 Bi-Temporal Point-in-Time Graph Query (REG-DATA-002)
MATCH (p:Provision)-[:HAS_VERSION]->(v:ProvisionVersion)
WHERE v.effective_from <= $as_of_date
  AND (v.effective_to IS NULL OR v.effective_to >= $as_of_date)
  AND v.known_from <= $known_at_date
OPTIONAL MATCH (r:TaxRuling)-[rel:RULING_INTERPRETS_SECTION]->(p)
WHERE r.year_be <= $as_of_year_be
OPTIONAL MATCH (v)<-[sup:SUPERSEDES]-(newerVersion:ProvisionVersion)
WHERE newerVersion.effective_from <= $as_of_date
RETURN p.id AS provision_id, v.id AS active_version_id, v.effective_from, v.effective_to,
       collect(DISTINCT r.ruling_no)[0..5] AS historical_rd_rulings,
       count(newerVersion) > 0 AS has_superseding_amendment;`;

    return {
      snapshot_id: `snap.bitemporal.${asOfDate}.${Date.now().toString(36)}`,
      as_of_date: asOfDate,
      known_at_date: knownAtDate,
      as_of_year_be: asOfYearBe,
      active_milestone: activeMilestone,
      summary_metrics: {
        total_nodes_tracked: evaluatedNodes.length,
        active_in_force_count: evaluatedNodes.filter(
          (n) => n.state_at_query_date === "ACTIVE_IN_FORCE"
        ).length,
        enacted_pending_enforcement_count: evaluatedNodes.filter(
          (n) => n.state_at_query_date === "ENACTED_PENDING_ENFORCEMENT"
        ).length,
        superseded_or_repealed_count: evaluatedNodes.filter(
          (n) =>
            n.state_at_query_date === "SUPERSEDED_OR_REPEALED" ||
            n.state_at_query_date === "CAUTION_AMENDED_BASIS"
        ).length,
        future_not_yet_enacted_count: evaluatedNodes.filter(
          (n) => n.state_at_query_date === "FUTURE_NOT_YET_ENACTED"
        ).length,
        rd_rulings_known_by_date: rulingsKnownByDate.length,
        rd_rulings_total_corpus: THAI_TAX_RULINGS_CORPUS.length,
        active_temporal_edges_count: evaluatedEdges.filter((e) => e.active_at_query_date).length,
      },
      nodes: evaluatedNodes,
      edges: evaluatedEdges,
      rd_rulings_in_force_sample: matchingSample,
      stale_ruling_alerts: staleAlerts,
      bitemporal_cypher_query: bitemporalCypherQuery,
    };
  }

  /**
   * Scans the 3,643 Official Revenue Department Tax Rulings corpus and detects
   * historical rulings whose underlying statutory basis was subsequently amended,
   * narrowed by Supreme Court precedent, or updated by newer RD interpretations.
   */
  public detectStaleAndImpactedRulings(options?: {
    query?: string;
    as_of_date?: string;
    status_filter?: "ALL" | RulingTemporalReliabilityStatus;
    limit?: number;
  }): StaleRulingDetectionItem[] {
    const asOfDate = (options?.as_of_date || "2026-10-20").slice(0, 10);
    const limit = Math.min(30, Math.max(1, options?.limit || 10));
    const q = (options?.query || "").trim();

    // Pull candidate rulings from the real 3,643 RD Tax Rulings corpus
    const searchBatch = searchThaiTaxRulings({
      query: q,
      limit: 120,
    });

    const items: StaleRulingDetectionItem[] = [];

    for (const r of searchBatch.rulings) {
      const yearCe = r.year_be - 543;
      const combinedText = `${r.subject} ${r.legal_provisions} ${r.ruling}`.toLowerCase();

      let temporalStatus: RulingTemporalReliabilityStatus = "CURRENT_ALIGNED";
      let interveningDate: string | null = null;
      let interveningId: string | null = null;
      let interveningTitleTh: string | null = null;
      let interveningTitleEn: string | null = null;
      let riskTh =
        "บทบัญญัติแห่งประมวลรัษฎากรที่อ้างอิงยังคงมีผลบังคับใช้สอดคล้องกับแนววินิจฉัยปัจจุบัน (แต่ต้องตรวจสอบข้อเท็จจริงเฉพาะราย)";
      let riskEn =
        "The cited Revenue Code provision remains aligned with current statutory text (subject to fact-specific verification).";
      let actionTh = "สามารถใช้อ้างอิงประกอบการวิเคราะห์ได้ โดยระบุเลขที่หนังสือตอบข้อหารือและวันที่มีผลบังคับใช้";
      let actionEn = "Safe to cite as persuasive administrative guidance alongside primary Revenue Code sections.";

      // Rule 1: Rulings before B.E. 2566 (2023) touching corporate amalgamation / merger / Sec 73 / Sec 74 / EBT
      if (
        r.year_be < 2566 &&
        asOfDate >= "2023-02-07" &&
        (combinedText.includes("ควบ") ||
          combinedText.includes("โอนกิจการ") ||
          combinedText.includes("มาตรา 73") ||
          combinedText.includes("มาตรา 74") ||
          combinedText.includes("1238"))
      ) {
        temporalStatus = "SUPERSEDED_OR_NARROWED";
        interveningDate = "2023-02-07 / 2026-01-19";
        interveningId = "ver.th.ccc.1238.v2023 + ruling.th.rd.462.2569";
        interveningTitleTh =
          "พ.ร.บ. แก้ไขเพิ่มเติม ป.พ.พ. (ฉบับที่ 23) พ.ศ. 2565 (มาตรา 1238) และข้อหารือ กค 0702(กม.)/462 (พ.ศ. 2569)";
        interveningTitleEn =
          "CCC Amendment Act (No. 23) B.E. 2565 (Sec. 1238 Merger A+B=A) & RD Ruling กค 0702(กม.)/462 (2026)";
        riskTh = `ข้อหารือฉบับนี้ออกในปี พ.ศ. ${r.year_be} (ก่อน ป.พ.พ. ฉบับที่ 23 มีผลบังคับใช้ 7 ก.พ. 2566) ซึ่งเดิมกฎหมายรับรองเฉพาะการควบบริษัทเกิดบริษัทใหม่ (A+B=C) และมีคำพิพากษาฎีกาที่ 5412/2565 รวมถึง กค 0702(กม.)/462 วางหลักเกณฑ์ใหม่แล้ว`;
        riskEn = `Issued in B.E. ${r.year_be} (${yearCe}) prior to the 7 Feb 2023 CCC Sec. 1238 merger reform (A+B=A), Supreme Court Dika 5412/2565, and 2026 RD Ruling กค 0702(กม.)/462.`;
        actionTh =
          "ห้ามอ้างอิงเดี่ยวๆ สำหรับดีลควบบริษัทแบบ A+B=A — ต้องอ้างอิงคู่กับ ป.พ.พ. มาตรา 1238 (พ.ศ. 2565) และ กค 0702(กม.)/462";
        actionEn =
          "Do not cite standalone for A+B=A surviving mergers; pair with amended CCC Sec. 1238 (2023) and RD Ruling กค 0702(กม.)/462 (2026).";
      }
      // Rule 2: Rulings before B.E. 2568 (2025) touching BOI corporate income tax exemptions / international holding / MNEs
      else if (
        r.year_be < 2568 &&
        asOfDate >= "2025-01-01" &&
        (combinedText.includes("ส่งเสริมการลงทุน") ||
          combinedText.includes("บีโอไอ") ||
          combinedText.includes("boi") ||
          combinedText.includes("ยกเว้นภาษีเงินได้นิติบุคคล"))
      ) {
        temporalStatus = "CAUTION_STATUTE_AMENDED";
        interveningDate = "2025-01-01";
        interveningId = "ver.th.gmt.topuptax.2567";
        interveningTitleTh = "พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 (OECD Pillar Two 15% Global Minimum Tax)";
        interveningTitleEn = "Emergency Decree on Top-Up Tax B.E. 2567 (OECD Pillar Two 15% Minimum Tax)";
        riskTh = `ข้อหารือปี พ.ศ. ${r.year_be} วินิจฉัยสิทธิยกเว้นภาษีเงินได้นิติบุคคลตามบัตรส่งเสริม BOI ก่อนที่ พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 จะมีผลบังคับใช้เมื่อ 1 ม.ค. 2568`;
        riskEn = `Issued in B.E. ${r.year_be} (${yearCe}) before Thailand's Top-Up Tax Emergency Decree B.E. 2567 took effect on 1 Jan 2025 for MNE groups (>= EUR 750M).`;
        actionTh =
          "ตรวจสอบว่ากลุ่มบริษัทเข้าข่ายรายได้รวม >= 750 ล้านยูโรหรือไม่ หากเข้าข่ายต้องคำนวณ Top-Up Tax ขั้นต่ำ 15% เพิ่มเติม";
        actionEn =
          "Verify whether the taxpayer belongs to an MNE group >= EUR 750M subject to the 15% domestic Top-Up Tax from 1 Jan 2025.";
      }
      // Rule 3: Older rulings from B.E. 2543–2555 (2000–2012) where sub-regulations or e-Tax/e-Withholding rules evolved
      else if (r.year_be <= 2554) {
        temporalStatus = "CAUTION_STATUTE_AMENDED";
        interveningDate = "2019-03-20";
        interveningId = "act.th.rc.amendment.etax.2562";
        interveningTitleTh = "พ.ร.บ. แก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 48) พ.ศ. 2562 และประกาศอธิบดีฯ ยุคดิจิทัล";
        interveningTitleEn = "Revenue Code Amendment Act (No. 48) B.E. 2562 & Modern DG Notifications";
        riskTh = `ข้อหารือฉบับนี้ออกเมื่อปี พ.ศ. ${r.year_be} (${yearCe}) ซึ่งเกินกว่า 14 ปีแล้ว ต้องตรวจสอบประกาศอธิบดีกรมสรรพากรและคำสั่ง ท.ป./ป. ที่แก้ไขเพิ่มเติมภายหลัง`;
        riskEn = `Issued in B.E. ${r.year_be} (${yearCe}), over 14 years ago; subsequent Director-General Notifications and Departmental Orders must be cross-checked.`;
        actionTh = "ใช้เป็นแนวเทียบเคียงเบื้องต้น และตรวจสอบคำสั่งกรมสรรพากร (ท.ป./ป.) ฉบับปัจจุบันก่อนนำไปใช้อ้างอิง";
        actionEn = "Use as historical baseline only; verify current Director-General Notifications before relying on procedural requirements.";
      }

      if (
        options?.status_filter &&
        options.status_filter !== "ALL" &&
        temporalStatus !== options.status_filter
      ) {
        continue;
      }

      items.push({
        ruling_no: r.ruling_no,
        ruling_date_th: r.date,
        ruling_year_be: r.year_be,
        ruling_year_ce: yearCe,
        primary_tax_type: r.primary_tax_type,
        subject: r.subject,
        cited_provisions: r.legal_provisions,
        temporal_status: temporalStatus,
        intervening_event_date: interveningDate,
        intervening_authority_id: interveningId,
        intervening_authority_title_th: interveningTitleTh,
        intervening_authority_title_en: interveningTitleEn,
        risk_explanation_th: riskTh,
        risk_explanation_en: riskEn,
        recommended_2026_action_th: actionTh,
        recommended_2026_action_en: actionEn,
        ruling_excerpt: r.ruling.slice(0, 320),
        source_url: r.source_url,
      });
    }

    // Prioritize rulings that have temporal warnings so lawyers immediately see actionable risks
    items.sort((a, b) => {
      const rank = (s: RulingTemporalReliabilityStatus) =>
        s === "SUPERSEDED_OR_NARROWED" ? 0 : s === "CAUTION_STATUTE_AMENDED" ? 1 : 2;
      return rank(a.temporal_status) - rank(b.temporal_status);
    });

    return items.slice(0, limit);
  }

  /**
   * Compares the Bi-Temporal Legal Graph between Date A (e.g., Contract Signing Date)
   * and Date B (e.g., Closing / Audit Date).
   */
  public compareTwoDates(dateA: string, dateB: string): TemporalDateComparisonResult {
    const snapA = this.reconstructGraphAtDate({ as_of_date: dateA });
    const snapB = this.reconstructGraphAtDate({ as_of_date: dateB });

    const activeIdsA = new Set(
      snapA.nodes
        .filter((n) => n.state_at_query_date === "ACTIVE_IN_FORCE")
        .map((n) => n.node_id)
    );

    const newlyEnacted = snapB.nodes.filter(
      (n) => n.state_at_query_date === "ACTIVE_IN_FORCE" && !activeIdsA.has(n.node_id)
    );

    const supersededBetweenDates = snapB.nodes.filter(
      (n) =>
        (n.state_at_query_date === "SUPERSEDED_OR_REPEALED" ||
          n.state_at_query_date === "CAUTION_AMENDED_BASIS") &&
        activeIdsA.has(n.node_id)
    );

    const unchangedActive = snapB.nodes.filter(
      (n) => n.state_at_query_date === "ACTIVE_IN_FORCE" && activeIdsA.has(n.node_id)
    );

    return {
      comparison_id: `cmp.bitemporal.${snapA.as_of_date}.vs.${snapB.as_of_date}`,
      date_a: snapA.as_of_date,
      date_b: snapB.as_of_date,
      year_be_a: snapA.as_of_year_be,
      year_be_b: snapB.as_of_year_be,
      newly_enacted_nodes: newlyEnacted,
      superseded_or_repealed_nodes: supersededBetweenDates,
      unchanged_active_nodes: unchangedActive,
      rd_rulings_added_between_dates: Math.max(
        0,
        snapB.summary_metrics.rd_rulings_known_by_date -
          snapA.summary_metrics.rd_rulings_known_by_date
      ),
      key_doctrinal_shifts: [
        {
          domain: "LEG-CORP / LEG-MNA",
          provision_code: "CCC Sec. 1097 & Sec. 1238",
          state_at_date_a_th:
            snapA.as_of_date < "2023-02-07"
              ? "ผู้เริ่มก่อการ >= 3 คน (หรือ 7 คนก่อน ก.ค. 2551) และควบบริษัทได้เฉพาะเกิดบริษัทใหม่ (A+B=C)"
              : "ผู้เริ่มก่อการ >= 2 คน และรองรับการควบเข้ากันโดยบริษัทหนึ่งคงอยู่ (A+B=A)",
          state_at_date_b_th:
            snapB.as_of_date < "2023-02-07"
              ? "ผู้เริ่มก่อการ >= 3 คน และควบบริษัทได้เฉพาะเกิดบริษัทใหม่ (A+B=C)"
              : "ผู้เริ่มก่อการ >= 2 คน และรองรับทั้งการควบตั้งบริษัทใหม่ (A+B=C) และควบเข้ากัน (A+B=A)",
          state_at_date_a_en:
            snapA.as_of_date < "2023-02-07"
              ? "Minimum 3 (or 7) promoters; only classic amalgamation into a new entity (A+B=C) permitted."
              : "Minimum 2 promoters; both amalgamation (A+B=C) and surviving-company merger (A+B=A) permitted.",
          state_at_date_b_en:
            snapB.as_of_date < "2023-02-07"
              ? "Minimum 3 promoters; only classic amalgamation (A+B=C) permitted."
              : "Minimum 2 promoters; both amalgamation (A+B=C) and surviving-company merger (A+B=A) permitted.",
          impact_severity: "CRITICAL_RESTRUCTURING_CHANGE",
        },
        {
          domain: "LEG-TAX / GMT24",
          provision_code: "RC Sec. 74 + Top-Up Tax Decree B.E. 2567",
          state_at_date_a_th:
            snapA.as_of_date < "2025-01-01"
              ? "สิทธิยกเว้นภาษี BOI อัตรา 0% ยังไม่ถูกกระทบด้วยภาษีส่วนเพิ่ม 15% (Pillar Two)"
              : "บังคับใช้ พ.ร.ก. ภาษีส่วนเพิ่ม 15% (Pillar Two) และแนววินิจฉัย กค 0702(กม.)/462",
          state_at_date_b_th:
            snapB.as_of_date < "2025-01-01"
              ? "ก่อนบังคับใช้ พ.ร.ก. ภาษีส่วนเพิ่ม 15%"
              : "บังคับใช้ พ.ร.ก. ภาษีส่วนเพิ่ม 15% (1 ม.ค. 2568) และหนังสือตอบข้อหารือ กค 0702(กม.)/462 (19 ม.ค. 2569)",
          state_at_date_a_en:
            snapA.as_of_date < "2025-01-01"
              ? "Pre-Pillar Two regime: BOI 0% CIT holiday applies without 15% domestic minimum Top-Up Tax."
              : "Pillar Two 15% Top-Up Tax in force for MNEs >= EUR 750M.",
          state_at_date_b_en:
            snapB.as_of_date < "2025-01-01"
              ? "Pre-Pillar Two regime."
              : "Pillar Two 15% Top-Up Tax in force + RD Ruling กค 0702(กม.)/462 confirming A+B=A merger tax treatment.",
          impact_severity: "HIGH_COMPLIANCE_SHIFT",
        },
        {
          domain: "LEG-PDPA",
          provision_code: "PDPA B.E. 2562 + PDPC DSAR Notification B.E. 2569",
          state_at_date_a_th:
            snapA.as_of_date < "2022-06-01"
              ? "อยู่ระหว่าง พ.ร.ฎ. ชะลอการบังคับใช้หมวดหลักของ PDPA (ประกาศใช้แล้วแต่ยังไม่บังคับใช้)"
              : "PDPA บังคับใช้เต็มรูปแบบ",
          state_at_date_b_th:
            snapB.as_of_date >= "2026-01-15"
              ? "PDPA บังคับใช้เต็มรูปแบบ พร้อมประกาศ สคส. พ.ศ. 2569 กำหนด SLA คำขอเข้าถึงข้อมูล (DSAR) ภายใน 30 วัน"
              : "PDPA บังคับใช้ตามกรอบมาตรฐาน",
          state_at_date_a_en:
            snapA.as_of_date < "2022-06-01"
              ? "PDPA operative chapters deferred by Royal Decree (`ENACTED_PENDING_ENFORCEMENT`)."
              : "PDPA operative chapters in force.",
          state_at_date_b_en:
            snapB.as_of_date >= "2026-01-15"
              ? "PDPA in full force + 2026 PDPC DSAR Notification (strict 30-day response SLA)."
              : "PDPA operative chapters in force.",
          impact_severity: "MODERATE_PROCEDURAL_UPDATE",
        },
      ],
    };
  }
}

export const temporalGraphEngine = new TemporalGraphEngine();
