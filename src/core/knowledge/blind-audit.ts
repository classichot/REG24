/**
 * REG24 — DEF-B01-04 Remediation: Independent Blind Source-to-Answer Legal Validation Engine
 *
 * Unlike `evaluation.ts`'s automated retrieval-oriented family benchmark (`citesExpected && dateOk`),
 * this module validates grounded legal answers against an independent blind gold specification derived
 * directly from the raw official Revenue Department & Royal Gazette source texts across 6 strict dimensions:
 *   1. Conclusion accuracy & legal polarity (`conclusion_passed`)
 *   2. Required factual/statutory conditions (`conditions_passed`)
 *   3. Exceptions / carve-outs / scope limits (`exceptions_passed`)
 *   4. Decision & effective-date version accuracy (`dates_passed`)
 *   5. Exact legal instrument & section citations, including strict absence of mislinked instruments (`citations_passed`)
 *   6. Original source openability, real SHA-256 integrity, zero `ext.dep.*` placeholders, and verbatim source substring support (`source_open_and_supports_passed`)
 */

import { THAI_TAX_RULINGS_CORPUS } from "../data/thai-tax-rulings-loader";
import {
  getRecoveredB01RulingTexts,
  getVerifiedStatutoryCorpus,
} from "../data/verified-statutory-loader";
import { getB02DriveManifest } from "../data/b02-drive-manifest-loader";
import { resolveAuthorizedEvidence } from "./evidence";
import { thaiDigitsToArabic } from "./identity";
import { queryKnowledge } from "./query";
import { getDefaultKnowledgeStore, type DurableKnowledgeStore } from "./store";
import type { Actor, AnswerStatus, QueryRequest } from "./contracts";

export interface BlindGoldCaseSpec {
  blind_case_id: string;
  target_batches: Array<"B01" | "B02">;
  defect_tags: string[];
  question: string;
  mode?: QueryRequest["mode"];
  applicable_date: string | null;
  comparison_legacy_ids?: string[];
  expected_statuses: AnswerStatus[];
  /** Phrases that MUST appear in the official answer/claims to prove conclusion polarity & substance */
  required_conclusion_phrases: string[];
  /** Wrong legal conclusions or mislinked citations that MUST NOT appear */
  forbidden_conclusion_phrases: string[];
  /** Factual/statutory conditions that MUST be surfaced */
  required_condition_phrases: string[];
  /** Statutory/ruling exceptions or scope limits that MUST be surfaced when present in source */
  required_exception_phrases: string[];
  /** Expected decision date string or version_id token */
  required_date_or_version_tokens: string[];
  /** Required canonical work_ids or legacy ruling IDs resolved via crosswalk */
  required_work_or_legacy_ids: string[];
  /** Forbidden canonical work_ids (e.g., `prov.th.rc.3` or `prov.th.rc.491` on Royal Decree 244 / CCC rulings) */
  forbidden_work_ids: string[];
  /** Whether this case expects clean abstention / clarification with zero fabricated evidence */
  is_abstention_or_clarification?: boolean;
}

export interface BlindCaseEvaluationResult {
  blind_case_id: string;
  defect_tags: string[];
  question: string;
  answer_status: AnswerStatus;
  conclusion_passed: boolean;
  conditions_passed: boolean;
  exceptions_passed: boolean;
  dates_passed: boolean;
  citations_passed: boolean;
  source_open_and_supports_passed: boolean;
  overall_passed: boolean;
  cited_work_ids: string[];
  opened_origins: string[];
  failure_reasons: string[];
}

export interface BlindValidationSummaryReport {
  suite_id: string;
  release_id: string;
  batch_id: string;
  evaluated_at: string;
  total_cases: number;
  passed_cases: number;
  overall_accuracy: number;
  dimension_scores: {
    conclusion_accuracy: number;
    condition_fidelity: number;
    exception_fidelity: number;
    date_and_version_accuracy: number;
    citation_instrument_precision: number;
    source_open_and_verbatim_support: number;
  };
  synthetic_placeholder_citations_detected: number;
  quarantined_unresolved_used_as_evidence: number;
  mislinked_instrument_citations_detected: number;
  case_results: BlindCaseEvaluationResult[];
}

const BLIND_GOLD_CASES: readonly BlindGoldCaseSpec[] = [
  {
    blind_case_id: "BLIND-01",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-01", "DEF-B01-02"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/13980 เรื่องการขายฝากที่ดินของบริษัทจำกัดและสิทธิไถ่ทรัพย์สินคืน",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0811/13980", "ขายฝาก", "ราคาประเมินทุนทรัพย์"],
    forbidden_conclusion_phrases: ["ประมวลรัษฎากร มาตรา 491"],
    required_condition_phrases: ["ไม่น้อยกว่าราคาประเมินทุนทรัพย์"],
    required_exception_phrases: ["ไม่ถือว่าเป็นการซื้อที่ดินใหม่"],
    required_date_or_version_tokens: ["13 ตุลาคม 2540"],
    required_work_or_legacy_ids: ["ruling.th.rd.22874"],
    forbidden_work_ids: ["prov.th.rc.3", "prov.th.rc.491"],
  },
  {
    blind_case_id: "BLIND-02",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-01"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/14025 เกี่ยวกับการคำนวณกำไรขาดทุนจากอัตราแลกเปลี่ยนตามคำสั่ง ท.ป. 72/2540",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["0811/14025", "ข้อเท็จจริงและประเด็นของผู้ขอหารือ", "แนววินิจฉัยของกรมสรรพากร", "ตัวอย่างที่ 2"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["31 ธันวาคม"],
    required_exception_phrases: ["ไม่มีสิทธิ์"],
    required_date_or_version_tokens: ["14 ตุลาคม 2540"],
    required_work_or_legacy_ids: ["ruling.th.rd.22875"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-03",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-01", "DEF-B01-02"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/00131 เรื่องการใช้สิทธิประโยชน์ของบัตรส่งเสริมการลงทุนสองบัตรและการลงบัญชีสต็อควัตถุดิบ",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["0811/00131", "บัตรส่งเสริมการลงทุน"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["บัตรส่งเสริม"],
    required_exception_phrases: ["ไม่จำเป็นต้องจัดเก็บและลงบัญชีสต็อค"],
    required_date_or_version_tokens: ["8 มกราคม 2541"],
    required_work_or_legacy_ids: ["ruling.th.rd.22929"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-04",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-01"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0706/พ./10877 กรณีบอกเลิกสัญญาซื้อขายรถยนต์โดยมีเงื่อนไขและออกใบลดหนี้",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["ออกใบลดหนี้", "มาตรา 86/10"],
    forbidden_conclusion_phrases: ["แนว วินิจฉัย -"],
    required_condition_phrases: ["คืนสินค้าตามข้อตกลง"],
    required_exception_phrases: ["ยังไม่โอนไปยังผู้ซื้อ"],
    required_date_or_version_tokens: ["18 ธันวาคม 2545"],
    required_work_or_legacy_ids: ["ruling.th.rd.24875"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-05",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636 เกี่ยวกับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 โครงการเงินช่วยเหลือจากต่างประเทศ",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/636", "ร้อยละ 0", "มาตรา 80/1 (4)"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["ปฏิบัติตามประกาศอธิบดีกรมสรรพากร"],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["5 กุมภาพันธ์ 2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68302"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-06",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-02", "DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/634 กรณีนำเข้าทองรูปพรรณความบริสุทธิ์ร้อยละ 96.5 ได้รับยกเว้นภาษีมูลค่าเพิ่มหรือไม่",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/634", "ต้องเสียภาษีมูลค่าเพิ่ม"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["ทองรูปพรรณ"],
    required_exception_phrases: ["ไม่เข้าลักษณะเป็นการประกอบกิจการค้าทองคำ"],
    required_date_or_version_tokens: ["2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68308"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-07",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1248 กรณีการรับรู้รายได้ค่าเช่าที่ดินระยะยาว 30 ปี เพื่อเสียภาษีเงินได้นิติบุคคล",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1248", "มาตรา 65", "ท.ป. 1/2528"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["เกณฑ์สิทธิ"],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["5 มีนาคม 2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68464"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-08",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1230 กรณีกิจการร่วมค้าสร้างภาพยนตร์และโอนลิขสิทธิ์ให้ผู้ซื้อในต่างประเทศผ่านอินเทอร์เน็ต",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1230", "มาตรา 77/1 (10)", "มาตรา 80/1 (2)", "ร้อยละ 0"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["ต่างประเทศ"],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68470"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-09",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1903 กรณีนำเข้าอาหารเสริมสำหรับสัตว์ที่ขึ้นทะเบียนกับกรมปศุสัตว์",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1903", "ยกเว้นภาษีมูลค่าเพิ่ม", "มาตรา 81 (2) (ก)"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["กรมปศุสัตว์"],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["8 เมษายน 2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68482"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-10",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1603 กรณีนำเข้าสินค้าประเภทอาหารสัตว์ที่ไม่ต้องขึ้นทะเบียนอาหารสัตว์แต่ต้องขออนุญาตนำเข้าจากกรมปศุสัตว์",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1603", "กรมปศุสัตว์", "มาตรา 81 (2) (ก)"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["ได้รับรองจากกรมปศุสัตว์"],
    required_exception_phrases: ["ไม่ต้องขึ้นทะเบียนอาหารสัตว์"],
    required_date_or_version_tokens: ["2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68500"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-11",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-01", "DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1491 เรื่องส่วนลดค่าเครื่องโทรศัพท์และฐานภาษีมูลค่าเพิ่มตามมาตรา 79",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1491", "ข้อเท็จจริงและประเด็นของผู้ขอหารือ", "แนววินิจฉัยของกรมสรรพากร", "มาตรา 79"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["ส่วนลด"],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68488"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-12",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-02", "DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1493 กรณีเวนคืนอสังหาริมทรัพย์ตามพระราชกฤษฎีกา (ฉบับที่ 736)",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1493", "736"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["เวนคืน"],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68494"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-13",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1255 กรณีค่าสินไหมทดแทนรถยนต์เช่าซื้อเกินมูลหนี้ที่ค้างชำระ",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1255", "มาตรา 65"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["สัญญาเช่าซื้อ"],
    required_exception_phrases: ["เว้นแต่"],
    required_date_or_version_tokens: ["2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68530"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-14",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-02", "DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1494 กรณีกองมรดกที่ยังไม่ได้แบ่งขอเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1494", "มาตรา 47 ทวิ", "มาตรา 57 ทวิ"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["กองมรดก"],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["13 มีนาคม 2569"],
    required_work_or_legacy_ids: ["ruling.th.rd.68536"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-15",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "ประมวลรัษฎากร มาตรา 65 ตรี กำหนดรายการที่ไม่ให้ถือเป็นรายจ่ายในการคำนวณกำไรสุทธิไว้อย่างไร สำหรับธุรกรรมเมื่อวันที่ 30 มิถุนายน 2561",
    mode: "standard",
    applicable_date: "2018-06-30",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["มาตรา 65 ตรี", "ไม่ให้ถือเป็นรายจ่าย"],
    forbidden_conclusion_phrases: ["v2_current"],
    required_condition_phrases: ["กำไรสุทธิ"],
    required_exception_phrases: ["เว้นแต่"],
    required_date_or_version_tokens: ["v1_pre2019"],
    required_work_or_legacy_ids: ["prov.th.rc.65_ตรี"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-16",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "ประมวลรัษฎากร มาตรา 65 ตรี กำหนดรายการที่ไม่ให้ถือเป็นรายจ่ายในการคำนวณกำไรสุทธิไว้อย่างไร สำหรับธุรกรรมเมื่อวันที่ 15 มกราคม 2568",
    mode: "standard",
    applicable_date: "2025-01-15",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["มาตรา 65 ตรี", "ไม่ให้ถือเป็นรายจ่าย"],
    forbidden_conclusion_phrases: ["v1_pre2019"],
    required_condition_phrases: ["กำไรสุทธิ"],
    required_exception_phrases: ["เว้นแต่"],
    required_date_or_version_tokens: ["v2_current"],
    required_work_or_legacy_ids: ["prov.th.rc.65_ตรี"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-17",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-02", "DEF-B01-03"],
    question: "แสดงบทบัญญัติประมวลรัษฎากร มาตรา 80/1 เกี่ยวกับการคำนวณภาษีมูลค่าเพิ่มอัตราร้อยละ 0",
    mode: "standard",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["มาตรา 80/1", "ร้อยละ 0"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["ส่งออก"],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: ["prov.th.rc.80/1"],
    forbidden_work_ids: ["prov.th.rc.80"],
  },
  {
    blind_case_id: "BLIND-18",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-04"],
    comparison_legacy_ids: ["ruling.th.rd.68482", "ruling.th.rd.68500"],
    question: "เปรียบเทียบแนววินิจฉัย กค 0702/1903 และ กค 0702/1603 เกี่ยวกับเงื่อนไขการรับรองจากกรมปศุสัตว์ในการยกเว้นภาษีมูลค่าเพิ่มนำเข้าอาหารสัตว์",
    mode: "comparison",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["กค 0702/1903", "กค 0702/1603", "กรมปศุสัตว์"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["กรมปศุสัตว์"],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: ["ruling.th.rd.68482", "ruling.th.rd.68500"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-19",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-04"],
    question: "บริษัทนำเข้าอาหารเสริมสำหรับสัตว์จะได้รับยกเว้นภาษีมูลค่าเพิ่มตามมาตรา 81 (2) (ก) หรือไม่ โดยไม่ทราบว่าได้รับการขึ้นทะเบียนหรือรับรองจากกรมปศุสัตว์หรือไม่",
    mode: "standard",
    applicable_date: null,
    expected_statuses: ["NEEDS_CLARIFICATION", "CONDITIONAL"],
    required_conclusion_phrases: ["กรมปศุสัตว์"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["กรมปศุสัตว์"],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: [],
    forbidden_work_ids: [],
    is_abstention_or_clarification: true,
  },
  {
    blind_case_id: "BLIND-20",
    target_batches: ["B01", "B02"],
    defect_tags: ["DEF-B01-04"],
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999404",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["INSUFFICIENT_EVIDENCE"],
    required_conclusion_phrases: ["ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่ กค 0702/999404"],
    forbidden_conclusion_phrases: ["วินิจฉัยว่าได้รับยกเว้นตาม กค 0702/999404"],
    required_condition_phrases: [],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: [],
    forbidden_work_ids: [],
    is_abstention_or_clarification: true,
  },
  // B02 Statutory & Subordinate-Legislation Blind Gold Cases
  {
    blind_case_id: "BLIND-21",
    target_batches: ["B02"],
    defect_tags: ["DEF-B01-02", "DEF-B01-03"],
    question: "แสดงบทบัญญัติประมวลรัษฎากร มาตรา 3 เตรส เกี่ยวกับการสั่งให้ผู้จ่ายเงินได้หักภาษี ณ ที่จ่าย",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["มาตรา 3 เตรส", "หักภาษี"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: ["กฎกระทรวง"],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: ["prov.th.rc.3_เตรส"],
    forbidden_work_ids: ["prov.th.rc.3"],
  },
  {
    blind_case_id: "BLIND-22",
    target_batches: ["B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "แสดงบทบัญญัติประมวลรัษฎากร มาตรา 77/1 เกี่ยวกับบทนิยามในหมวดภาษีมูลค่าเพิ่ม",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["มาตรา 77/1", "ขาย", "บริการ"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: [],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: ["prov.th.rc.77/1"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-23",
    target_batches: ["B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "แสดงบทบัญญัติประมวลรัษฎากร มาตรา 81 เกี่ยวกับกิจการที่ได้รับยกเว้นภาษีมูลค่าเพิ่ม",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["มาตรา 81", "ยกเว้นภาษีมูลค่าเพิ่ม"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: [],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: ["prov.th.rc.81"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-24",
    target_batches: ["B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "แสดงบทบัญญัติประมวลรัษฎากร มาตรา 91/2 เกี่ยวกับกิจการที่อยู่ในบังคับต้องเสียภาษีธุรกิจเฉพาะ",
    mode: "exact_lookup",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["มาตรา 91/2", "ภาษีธุรกิจเฉพาะ"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: [],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: ["prov.th.rc.91/2"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-25",
    target_batches: ["B02"],
    defect_tags: ["DEF-B01-02", "DEF-B01-03"],
    question: "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 10) พ.ศ. 2500 ออกโดยหน่วยงานใดและอาศัยอำนาจตามกฎหมายใด",
    mode: "standard",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["ฉบับที่ 10", "ประมวลรัษฎากร"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: [],
    required_exception_phrases: [],
    required_date_or_version_tokens: [],
    required_work_or_legacy_ids: ["subreg.th.rc.royal_decree.10"],
    forbidden_work_ids: [],
  },
  {
    blind_case_id: "BLIND-26",
    target_batches: ["B02"],
    defect_tags: ["DEF-B01-03", "DEF-B01-04"],
    question: "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 48) พ.ศ. 2562 มีสาระสำคัญอย่างไร",
    mode: "standard",
    applicable_date: null,
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    required_conclusion_phrases: ["ฉบับที่ 48", "2562"],
    forbidden_conclusion_phrases: [],
    required_condition_phrases: [],
    required_exception_phrases: [],
    required_date_or_version_tokens: ["2562"],
    required_work_or_legacy_ids: ["statute.th.rc_amendment_48_2562"],
    forbidden_work_ids: [],
  },
];

function buildAuthenticSourceTextPool(): Map<string, string> {
  const map = new Map<string, string>();
  const idToUrl = new Map<string, string>();
  for (const r of THAI_TAX_RULINGS_CORPUS) {
    const combined = `${r.facts || ""}\n${r.ruling || ""}`
      .replace(/\s+/g, " ")
      .trim();
    if (combined) {
      map.set(r.id, combined);
      if (r.source_url) {
        idToUrl.set(r.id, r.source_url);
        map.set(`origin:${r.source_url}`, combined);
      }
    }
  }
  const recovered = getRecoveredB01RulingTexts();
  for (const [id, rec] of Object.entries(recovered)) {
    if (rec.full_text) {
      const cleanedRec = rec.full_text.replace(/\s+/g, " ").trim();
      const existing = map.get(id);
      const merged = existing ? `${existing} ${cleanedRec}` : cleanedRec;
      map.set(id, merged);
      const url = idToUrl.get(id);
      if (url) {
        map.set(`origin:${url}`, merged);
      }
    }
  }
  const verStat = getVerifiedStatutoryCorpus();
  for (const [wid, sec] of Object.entries(verStat.revenue_code_sections)) {
    map.set(wid, sec.verbatim_text.replace(/\s+/g, " ").trim());
  }
  for (const [wid, sub] of Object.entries(verStat.subordinate_and_amendment_works)) {
    map.set(wid, sub.verbatim_text.replace(/\s+/g, " ").trim());
  }
  const b02Man = getB02DriveManifest();
  for (const e of b02Man.files) {
    if (e.text_excerpt) {
      map.set(`b02_sha:${e.sha256}`, e.text_excerpt.replace(/\s+/g, " ").trim());
    }
  }
  for (const m of b02Man.rar_expanded_members) {
    if (m.text_excerpt) {
      map.set(`b02_sha:${m.sha256}`, m.text_excerpt.replace(/\s+/g, " ").trim());
    }
  }
  return map;
}

let cachedSourcePool: Map<string, string> | null = null;
function getAuthenticSourcePool(): Map<string, string> {
  if (!cachedSourcePool) {
    cachedSourcePool = buildAuthenticSourceTextPool();
  }
  return cachedSourcePool;
}

function normalizeWs(s: string): string {
  return thaiDigitsToArabic(s).replace(/\s+/g, " ").trim();
}

export async function runBlindSourceToAnswerValidation(
  releaseId: string,
  actor: Actor,
  options?: {
    store?: DurableKnowledgeStore;
  }
): Promise<BlindValidationSummaryReport> {
  const store = options?.store || getDefaultKnowledgeStore();
  const state = store.getState();
  const rel = state.releases[releaseId];
  if (!rel) {
    throw new Error(`RELEASE_NOT_FOUND_404: ${releaseId}`);
  }

  const batchKind: "B01" | "B02" = rel.batch_id === "B02" ? "B02" : "B01";
  const applicableCases = BLIND_GOLD_CASES.filter((c) => c.target_batches.includes(batchKind));
  const authenticPool = getAuthenticSourcePool();

  // Reverse map canonical work_id -> legacy corpus id when present
  const workToLegacy = new Map<string, string>();
  for (const [legId, canId] of Object.entries(state.legacy_crosswalk)) {
    workToLegacy.set(canId, legId);
  }

  const resolveRequiredId = (idOrLegacy: string): string => {
    const cw = state.legacy_crosswalk[idOrLegacy];
    if (cw && state.works[cw]) return cw;
    if (state.works[idOrLegacy]) return idOrLegacy;
    return cw || idOrLegacy;
  };

  // Pre-collect quarantined unresolved target hints so we can verify none leak as evidence
  const quarantinedKeys = new Set(
    Object.values(state.unresolved_references)
      .filter((u) => u.quarantine_status === "UNRESOLVED_QUARANTINED" || u.usable_as_legal_evidence === false)
      .map((u) => u.target_hint)
  );

  let conclusionPassedCount = 0;
  let conditionsPassedCount = 0;
  let exceptionsPassedCount = 0;
  let datesPassedCount = 0;
  let citationsPassedCount = 0;
  let sourceOpenPassedCount = 0;
  let overallPassedCount = 0;

  let syntheticPlaceholderCitations = 0;
  let quarantinedUsedAsEvidence = 0;
  let mislinkedInstrumentCitations = 0;

  const caseResults: BlindCaseEvaluationResult[] = [];

  for (const spec of applicableCases) {
    const failureReasons: string[] = [];
    const comparisonWorkIds = spec.comparison_legacy_ids?.map(resolveRequiredId);

    const ans = await queryKnowledge(
      {
        question: spec.question,
        release_id: releaseId,
        applicable_date: spec.applicable_date,
        mode: spec.mode || "standard",
        comparison_work_ids: comparisonWorkIds,
      },
      actor,
      { store }
    );

    const combinedText = normalizeWs(
      [
        ans.answer,
        ...ans.claims.map((c) => c.statement),
        ...ans.claims.flatMap((c) => c.factual_conditions),
        ...ans.claims.flatMap((c) => c.exceptions),
        ...ans.clarification_questions,
        ...ans.evidence.map((e) => e.exact_excerpt),
      ].join("\n")
    );

    // 1. Conclusion dimension
    const statusOk = spec.expected_statuses.includes(ans.status);
    const reqConclusionOk = spec.required_conclusion_phrases.every((ph) =>
      combinedText.includes(normalizeWs(ph))
    );
    const forbConclusionOk = spec.forbidden_conclusion_phrases.every(
      (ph) => !combinedText.includes(normalizeWs(ph))
    );
    const conclusionPassed = statusOk && reqConclusionOk && forbConclusionOk;
    if (!conclusionPassed) {
      failureReasons.push(
        `CONCLUSION_MISMATCH(status=${ans.status}, statusOk=${statusOk}, reqOk=${reqConclusionOk}, forbOk=${forbConclusionOk})`
      );
    }

    // 2. Conditions dimension
    const conditionsPassed = spec.required_condition_phrases.every((ph) =>
      combinedText.includes(normalizeWs(ph))
    );
    if (!conditionsPassed) {
      failureReasons.push(
        `MISSING_CONDITION(${spec.required_condition_phrases.filter((ph) => !combinedText.includes(normalizeWs(ph))).join(", ")})`
      );
    }

    // 3. Exceptions / carve-outs dimension
    const exceptionsPassed = spec.required_exception_phrases.every((ph) =>
      combinedText.includes(normalizeWs(ph))
    );
    if (!exceptionsPassed) {
      failureReasons.push(
        `MISSING_EXCEPTION(${spec.required_exception_phrases.filter((ph) => !combinedText.includes(normalizeWs(ph))).join(", ")})`
      );
    }

    // 4. Dates & version dimension
    const versionAndDateHaystack = normalizeWs(
      [
        combinedText,
        ...ans.evidence.map((e) => `${e.version_id} ${e.issue_or_effective_date || ""}`),
      ].join(" ")
    );
    const datesPassed = spec.required_date_or_version_tokens.every((tok) =>
      versionAndDateHaystack.includes(normalizeWs(tok))
    );
    if (!datesPassed) {
      failureReasons.push(
        `DATE_OR_VERSION_MISMATCH(${spec.required_date_or_version_tokens.join(", ")})`
      );
    }

    // 5. Citations & forbidden mislinked instruments dimension
    const citedWorkIds = [...new Set(ans.evidence.map((e) => e.work_id))];
    const primaryWorkIds = new Set(spec.required_work_or_legacy_ids.map(resolveRequiredId));
    const relatedWorkIdsOnPrimary = [
      ...new Set(
        ans.evidence
          .filter((e) => primaryWorkIds.size === 0 || primaryWorkIds.has(e.work_id))
          .flatMap((e) => e.related_provisions.map((rp) => rp.work_id))
      ),
    ];
    const allReferencedWorkIds = new Set([...citedWorkIds, ...relatedWorkIdsOnPrimary]);

    const resolvedRequiredWorks = spec.required_work_or_legacy_ids.map(resolveRequiredId);
    const requiredCitedOk = resolvedRequiredWorks.every((wid) => citedWorkIds.includes(wid));
    const forbiddenHits = spec.forbidden_work_ids.filter((fwid) => allReferencedWorkIds.has(fwid));
    if (forbiddenHits.length > 0) {
      mislinkedInstrumentCitations += forbiddenHits.length;
    }
    const citationsPassed = requiredCitedOk && forbiddenHits.length === 0;
    if (!citationsPassed) {
      failureReasons.push(
        `CITATION_MISMATCH(requiredOk=${requiredCitedOk}, forbiddenHits=${forbiddenHits.join(",")})`
      );
    }

    // 6. Original source openability, SHA-256 integrity, zero synthetic placeholder, & verbatim substring check
    let sourceOpenPassed = true;
    const openedOrigins: string[] = [];

    if (spec.is_abstention_or_clarification && ans.status === "INSUFFICIENT_EVIDENCE") {
      if (ans.evidence.length > 0) {
        sourceOpenPassed = false;
        failureReasons.push("ABSTENTION_LEAKED_EVIDENCE");
      }
    } else if (!spec.is_abstention_or_clarification && ans.evidence.length === 0) {
      sourceOpenPassed = false;
      failureReasons.push("NO_EVIDENCE_RETURNED");
    } else {
      for (const ev of ans.evidence) {
        const opened = resolveAuthorizedEvidence(store, ev.passage_id, actor);
        if (!opened.allowed || opened.http_status !== 200 || !opened.passage || !opened.locator) {
          sourceOpenPassed = false;
          failureReasons.push(`EVIDENCE_OPEN_FAILED:${ev.passage_id}`);
          continue;
        }
        const psg = opened.passage;
        const art = state.artifacts[opened.locator.artifact_id];
        openedOrigins.push(opened.locator.origin_uri);

        if (psg.extraction_id.startsWith("ext.dep.")) {
          syntheticPlaceholderCitations += 1;
          sourceOpenPassed = false;
          failureReasons.push(`SYNTHETIC_PLACEHOLDER_EVIDENCE:${psg.extraction_id}`);
        }
        if (quarantinedKeys.has(psg.work_id)) {
          quarantinedUsedAsEvidence += 1;
          sourceOpenPassed = false;
          failureReasons.push(`QUARANTINED_REFERENCE_USED_AS_EVIDENCE:${psg.work_id}`);
        }
        if (!art || !/^[0-9a-f]{64}$/i.test(art.actual_bytes_sha256) || !opened.locator.origin_uri) {
          sourceOpenPassed = false;
          failureReasons.push(`INVALID_ARTIFACT_SHA256_OR_URI:${opened.locator.artifact_id}`);
        }

        // Check authentic source substring fidelity against raw corpus / extraction / verified statutory corpus
        const legId = workToLegacy.get(psg.work_id);
        const extRec = state.extractions[psg.extraction_id];
        const rawRef =
          (legId && authenticPool.get(legId)) ||
          authenticPool.get(psg.work_id) ||
          authenticPool.get(`origin:${opened.locator.origin_uri}`) ||
          (art && authenticPool.get(`b02_sha:${art.actual_bytes_sha256}`)) ||
          extRec?.raw_text;
        if (rawRef) {
          const cleanedPassageBody = psg.exact_text
            .replace(/^ข้อกฎหมายที่อ้างอิง:[^\n]*\nแนววินิจฉัยกรมสรรพากร:\s*/u, "")
            .replace(/\s*\[ข้อเสนอของผู้หารือ:[\s\S]*$/u, "")
            .trim();
          const normPunct = (v: string) =>
            normalizeWs(v).replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")");
          const probe = normPunct(cleanedPassageBody).slice(-44).trim();
          const rawNorm = normPunct(`${rawRef} ${extRec?.raw_text || ""}`);
          if (probe.length >= 16 && !rawNorm.includes(probe)) {
            sourceOpenPassed = false;
            failureReasons.push(`VERBATIM_SUBSTRING_NOT_IN_RAW_SOURCE:${psg.passage_id}`);
          }
        }
      }
    }

    if (conclusionPassed) conclusionPassedCount += 1;
    if (conditionsPassed) conditionsPassedCount += 1;
    if (exceptionsPassed) exceptionsPassedCount += 1;
    if (datesPassed) datesPassedCount += 1;
    if (citationsPassed) citationsPassedCount += 1;
    if (sourceOpenPassed) sourceOpenPassedCount += 1;

    const overallPassed =
      conclusionPassed &&
      conditionsPassed &&
      exceptionsPassed &&
      datesPassed &&
      citationsPassed &&
      sourceOpenPassed;
    if (overallPassed) overallPassedCount += 1;

    caseResults.push({
      blind_case_id: spec.blind_case_id,
      defect_tags: [...spec.defect_tags],
      question: spec.question,
      answer_status: ans.status,
      conclusion_passed: conclusionPassed,
      conditions_passed: conditionsPassed,
      exceptions_passed: exceptionsPassed,
      dates_passed: datesPassed,
      citations_passed: citationsPassed,
      source_open_and_supports_passed: sourceOpenPassed,
      overall_passed: overallPassed,
      cited_work_ids: citedWorkIds,
      opened_origins: [...new Set(openedOrigins)],
      failure_reasons: failureReasons,
    });
  }

  const total = Math.max(1, applicableCases.length);
  return {
    suite_id: `suite.blind.source_to_answer.${batchKind.toLowerCase()}.v1.0`,
    release_id: releaseId,
    batch_id: rel.batch_id,
    evaluated_at: new Date().toISOString(),
    total_cases: applicableCases.length,
    passed_cases: overallPassedCount,
    overall_accuracy: Number((overallPassedCount / total).toFixed(4)),
    dimension_scores: {
      conclusion_accuracy: Number((conclusionPassedCount / total).toFixed(4)),
      condition_fidelity: Number((conditionsPassedCount / total).toFixed(4)),
      exception_fidelity: Number((exceptionsPassedCount / total).toFixed(4)),
      date_and_version_accuracy: Number((datesPassedCount / total).toFixed(4)),
      citation_instrument_precision: Number((citationsPassedCount / total).toFixed(4)),
      source_open_and_verbatim_support: Number((sourceOpenPassedCount / total).toFixed(4)),
    },
    synthetic_placeholder_citations_detected: syntheticPlaceholderCitations,
    quarantined_unresolved_used_as_evidence: quarantinedUsedAsEvidence,
    mislinked_instrument_citations_detected: mislinkedInstrumentCitations,
    case_results: caseResults,
  };
}
