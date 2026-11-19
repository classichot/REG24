/**
 * REG24 — Full 30-Case Legal Team Retest + 14 Unseen & Changed-Fact Journey Verifier
 *
 * Runs against isolated staging store (`data/knowledge-store-b01-rc2-staging`, `rel.B01.rc6`),
 * recording complete `execution_provenance` (`git_commit_sha`, `release_id`, `manifest_id`,
 * `manifest_hash`, `model_id`, `calculation_verifier_version`, `configuration`) and verifying:
 *   1. All 30 Legal Team test cases (including the 5 prior passes and 9 multi-turn changed-fact pairs).
 *   2. 14 brand-new unseen Thai & English tax cases + changed-fact variants.
 *   3. Claim-level substantive support (`verifyClaimAgainstPassages` + `traceable_answer`).
 *
 * Writes receipt to `docs/audit/dodo-review-rc2-b02/legal_30case_retest_and_unseen_journey_receipt.json`.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
process.env.REG24_KNOWLEDGE_DATA_DIR = STAGING_STORE_DIR;

import type { AnswerStatus, ConversationTurnInput } from "../src/core/knowledge/contracts";

interface JourneyCaseSpec {
  case_id: string;
  suite: "LEGAL_TEAM_30_CASE_RETEST" | "UNSEEN_AND_CHANGED_FACT_PACK";
  prior_turn_case_id?: string;
  mode?: "standard" | "exact_lookup" | "comparison";
  question: string;
  expected_statuses: AnswerStatus[];
  must_cite_any_work_ids?: string[];
  must_cite_all_work_ids?: string[];
  must_not_cite_work_ids?: string[];
  must_include_patterns: RegExp[];
  must_not_include_patterns?: RegExp[];
  require_verified_law_application_claim?: boolean;
}

const LEGAL_TEAM_30_CASES: JourneyCaseSpec[] = [
  {
    case_id: "B1-01",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท แสงตะวัน อุตสาหกรรม จำกัด เป็นบริษัทจำกัดจดทะเบียนในไทย ประกอบกิจการผลิตสินค้าทั่วไป รอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2568 มีกำไรสุทธิที่คำนวณตามมาตรา 65 ทวิ และ 65 ตรี แล้ว 8,000,000 บาท ไม่ใช่ SME และไม่ได้รับสิทธิส่งเสริมการลงทุน ต้องเสียภาษีเงินได้นิติบุคคลในอัตราเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.65", "sched.th.rc.income_tax_rate"],
    must_include_patterns: [/ร้อยละ\s*20/, /1,600,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-02",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "นายอรุณ มีเงินได้สุทธิหลังหักค่าใช้จ่ายและค่าลดหย่อนแล้ว 900,000 บาท ประจำปีภาษี 2568 เขาเป็นบุคคลธรรมดาผู้มีถิ่นที่อยู่ในไทย ไม่มีเงินได้ที่เลือกเสียแบบสุดท้ายเป็นพิเศษ อัตราและภาษีเงินได้บุคคลธรรมดาที่ต้องเสียเป็นเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.48", "sched.th.rc.income_tax_rate", "subreg.th.rc.royal_decree.470"],
    must_include_patterns: [/150,000/, /ร้อยละ\s*20/, /95,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-03",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท คลองสาน เทรดดิ้ง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในราชอาณาจักรเมื่อวันที่ 15 พฤศจิกายน 2569 ความรับผิดใน VAT เกิดวันเดียวกัน ต้องคิด VAT กี่ร้อยละ",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807"],
    must_include_patterns: [/807/, /6\.3/, /0\.7/, /ร้อยละ\s*7/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-04",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "นายภิญโญรับจ้างทำซอฟต์แวร์ให้บริษัทไทยแห่งหนึ่ง ทำสัญญาจ้างทำของเป็นหนังสือ กำหนดสินจ้าง 2,000,000 บาท สัญญาทำและปฏิบัติในไทย ต้องปิดอากรแสตมป์เท่าใด และใครเป็นผู้มีหน้าที่เสียอากร",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.104", "sched.th.rc.stamp_duty", "subreg.th.rd.dg_stamp.37"],
    must_include_patterns: [/2,000\s*บาท/, /ผู้รับจ้าง/, /ฉบับที่\s*37/, /ตัวเงิน/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-05",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท ปากน้ำ ซัพพลาย จำกัด (นิติบุคคลไทย) จ่ายค่าจ้างทำของ 1,200,000 บาท ให้บริษัท บางนา เซอร์วิส จำกัด (นิติบุคคลไทย ไม่ใช่มูลนิธิหรือสมาคม) เมื่อวันที่ 15 มิถุนายน 2568 และนำส่งภาษีหัก ณ ที่จ่ายผ่านระบบ e-Withholding Tax ตามมาตรา 3 ปัณรส ต้องหักในอัตราเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.3_เตรส", "prov.th.rc.3_ปัณรส", "subreg.th.rc.min_reg.389"],
    must_include_patterns: [/ร้อยละ\s*1/, /12,000\s*บาท/, /389/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-05F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-05",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-05: วันที่จ่ายค่าจ้างทำของจริงคือ 15 มกราคม 2569 ไม่ใช่ 15 มิถุนายน 2568 บริษัทยังนำส่งผ่านระบบ e-Withholding Tax อัตราหัก ณ ที่จ่ายเป็นเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.3_เตรส", "prov.th.rc.3_ปัณรส", "subreg.th.rc.min_reg.402"],
    must_include_patterns: [/2026-01-15/, /402/, /389/, /ร้อยละ\s*1/, /12,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-06",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท นภา โฮลดิ้ง จำกัด ซึ่งตั้งขึ้นตามกฎหมายไทย จ่ายให้บริษัทต่างประเทศแห่งหนึ่งที่ไม่มีสถานประกอบการในไทยเมื่อวันที่ 15 มีนาคม 2569 สองรายการ คือ (1) เงินปันผล 5,000,000 บาท และ (2) ค่าบริหารจัดการ (management fee) 1,000,000 บาท สำหรับงานบริหารที่ให้จากต่างประเทศ ไม่มีข้อมูลอนุสัญญาภาษีซ้อน บริษัทต้องหักภาษี ณ ที่จ่ายอย่างไรในแต่ละรายการ",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.70", "sched.th.rc.income_tax_rate", "prov.th.rc.40"],
    must_include_patterns: [/ร้อยละ\s*10/, /500,000\s*บาท/, /ร้อยละ\s*15/, /40\s*\(8\)/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-07",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "นายวิชัยขายที่ดินสองแปลงในเดือนมิถุนายน 2568 แปลงที่หนึ่งได้รับมรดกจากภริยาตั้งแต่ปี 2560 ถือครองมา 8 ปี แปลงที่สองซื้อจากบุคคลภายนอกในเดือนมีนาคม 2568 ถือครองได้ 3 เดือน เขามิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรืออากรแสตมป์อย่างไรในแต่ละแปลง",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.91/2", "subreg.th.rc.royal_decree.342", "sched.th.rc.stamp_duty"],
    must_include_patterns: [/แปลงที่หนึ่ง[\s\S]{0,240}ไม่ต้องเสียภาษีธุรกิจเฉพาะ/, /0\.5/, /แปลงที่สอง[\s\S]{0,340}3\.3/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-07F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-07",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-07: แปลงที่หนึ่งไม่ได้มาทางมรดก นายวิชัยซื้อมาจากบุคคลภายนอกตั้งแต่ปี 2560 และถือครองเกิน 5 ปีก่อนขายในเดือนมิถุนายน 2568 ยังไม่ได้ประกอบธุรกิจค้าอสังหาริมทรัพย์เป็นปกติ ผลทางภาษีธุรกิจเฉพาะของแปลงนี้เปลี่ยนหรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.91/2", "subreg.th.rc.royal_decree.342"],
    must_include_patterns: [/ไม่เปลี่ยนแปลง|ไม่ต้องเสียภาษีธุรกิจเฉพาะ/, /เกิน\s*5\s*ปี/, /0\.5/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-08",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท ชลบุรี แพ็กเกจจิ้ง จำกัด มีกำไรสุทธิก่อนรายจ่ายบริจาค 20,000,000 บาท ในรอบบัญชีที่เริ่ม 1 มกราคม 2568 บริจาคเงิน 1,000,000 บาท ให้แก่องค์การสาธารณกุศลตามที่อธิบดีประกาศกำหนด หักเป็นรายจ่ายได้เท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.65_ตรี", "subreg.th.rd.order_p.52_2537"],
    must_include_patterns: [/2\/102|2\s*\/\s*102/, /392,156\.86\s*บาท/, /607,843\.14\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-09",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.42", "prov.th.rc.48", "statute.th.rc_amendment_40_2558"],
    must_include_patterns: [/20,000,000\s*บาท/, /5,000,000\s*บาท/, /ร้อยละ\s*5/, /250,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-09F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-09",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวของนายสมชาย และการให้ที่ดินมูลค่า 25,000,000 บาท เป็นการให้เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของหลานสาวเปลี่ยนอย่างไร",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: [
      "prov.th.rc.40",
      "prov.th.rc.41_ทวิ",
      "prov.th.rc.42",
      "prov.th.rc.49_ทวิ",
      "prov.th.rc.50",
      "prov.th.rc.54",
      "statute.th.rc_amendment_40_2558",
    ],
    must_include_patterns: [
      /ฝั่งผู้รับโอน/,
      /ส่งต่อฝ่ายกฎหมาย/,
      /มาตรา\s*54/,
      /ฝั่งผู้โอน/,
      /มาตรา\s*41\s*ทวิ/,
      /มาตรา\s*50\s*\(5\)/,
      /มาตรา\s*49\s*ทวิ/,
      /ราคาประเมินทุนทรัพย์/,
    ],
    must_not_include_patterns: [/750,000\s*บาท/, /250,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-10",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "นางดาวขายของชำเป็นบุคคลธรรมดา มีรายรับจากการขายสินค้าในปีปฏิทิน 2568 รวม 1,500,000 บาท ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่มโดยสมัครใจ และไม่ได้ขายสินค้าที่ได้รับยกเว้นเป็นอย่างอื่น ต้องจดทะเบียน VAT หรือไม่",
    expected_statuses: ["ANSWERED"],
    must_cite_all_work_ids: ["prov.th.rc.81/1", "prov.th.rc.85/1", "subreg.th.rc.royal_decree.432"],
    must_include_patterns: [/1,800,000\s*บาท/, /ไม่ต้องจดทะเบียนภาษีมูลค่าเพิ่ม/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-11",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.80/1", "subreg.th.rd.dg_vat.105"],
    must_include_patterns: [/ร้อยละ\s*0/, /80\/1/, /ฉบับที่\s*105/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-11F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-11",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-11: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.80", "prov.th.rc.77/2", "prov.th.rc.80/1"],
    must_include_patterns: [/ไม่เข้าเงื่อนไขใช้อัตราร้อยละ\s*0/, /ร้อยละ\s*7/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-12",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท คิริ จำกัด มีรอบระยะเวลาบัญชี 1 กรกฎาคม 2561 – 30 มิถุนายน 2562 บริจาคให้พรรคการเมืองตามกฎหมายประกอบรัฐธรรมนูญว่าด้วยพรรคการเมือง เป็นเงิน 80,000 บาท หักเป็นรายจ่ายได้หรือไม่ และได้เท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.65_ตรี", "statute.th.rc_amendment_51_2562"],
    must_include_patterns: [/50,000\s*บาท/, /30,000\s*บาท/, /ฉบับที่\s*51/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-12F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-12",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-12: รอบระยะเวลาบัญชีของบริษัท คิริ จำกัด คือ 1 กรกฎาคม 2560 – 30 มิถุนายน 2561 ไม่ใช่เริ่ม 1 กรกฎาคม 2561 บริษัทยังอ้างหักเงินบริจาคพรรคการเมือง 80,000 บาท ตามมาตรา 65 ตรี (3)(ก) ที่แก้ไขโดยพ.ร.บ. ฉบับที่ 51 ได้หรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["statute.th.rc_amendment_51_2562"],
    must_include_patterns: [/2017-07-01/, /ไม่สามารถนำเงินบริจาคพรรคการเมือง[\s\S]{0,80}มาหักเป็นรายจ่าย/, /1\s*มกราคม\s*พ\.ศ\.\s*2561/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-13",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "นางสาวพิมพ์ได้รับเงินเดือนตามมาตรา 40(1) ในปีภาษี 2568 และไม่มีเงินได้ตามมาตรา 40(2) เธอจะหักค่าใช้จ่ายเป็นการเหมาตามมาตรา 42 ทวิ ได้ในอัตราและเพดานเท่าใด ถ้ามีคนอ้างข้อหารือเก่าที่ว่าหักได้ร้อยละ 40 ไม่เกิน 60,000 บาท ต้องใช้ตัวเลขนั้นหรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.42_ทวิ", "statute.th.rc_amendment_44_2560"],
    must_include_patterns: [/ร้อยละ\s*50/, /100,000\s*บาท/, /(?:ไม่นำเพดานเดิม|ไม่อาจนำมาใช้กับปีภาษี\s*2560)/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-14",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท สยามเฟอร์นิเจอร์ จำกัด เป็นบริษัททั่วไป (ไม่ใช่ SME) มีรอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2559 กรรมการเข้าใจว่าอัตราภาษีเงินได้นิติบุคคลยังเป็นร้อยละ 30 อยู่จริงหรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.65", "statute.th.rc_amendment_42_2559"],
    must_include_patterns: [/ไม่ใช่อัตราร้อยละ\s*30/, /ร้อยละ\s*20/, /ฉบับที่\s*42/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-14F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-14",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-14: รอบระยะเวลาบัญชีคือ 1 กรกฎาคม 2558 – 30 มิถุนายน 2559 ไม่ใช่เริ่ม 1 มกราคม 2559 บริษัททั่วไปที่ไม่ใช่ SME ต้องใช้อัตราตามพ.ร.บ. ฉบับที่ 42 หรือไม่ แล้วอัตราที่ถูกต้องของรอบนี้คืออะไร",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["statute.th.rc_amendment_42_2559", "subreg.th.rc.royal_decree.577"],
    must_include_patterns: [/2015-07-01/, /ไม่อยู่ในบังคับของพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร\s*\(ฉบับที่\s*42\)/, /577/, /ร้อยละ\s*20/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-15",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท คลองสาน เทรดดิ้ง จำกัด (ผู้ประกอบการจดทะเบียน VAT) ส่งมอบสินค้าในราชอาณาจักรและมีความรับผิดใน VAT เกิดวันที่ 20 ตุลาคม 2570 ต้องคิดอัตราเท่าใด มีพระราชกฤษฎีกาฉบับที่ 807 ขยายอัตราลดอยู่หรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807"],
    must_include_patterns: [/30\s*กันยายน\s*พ\.ศ\.\s*2570/, /ไม่ได้(?:ขยายอัตราลด)?ครอบคลุม(?:ถึง)?วันที่\s*`?2027-10-20`?/, /ร้อยละ\s*10/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-15F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-15",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-15: ความรับผิดใน VAT เกิดวันที่ 20 กันยายน 2570 ไม่ใช่ 20 ตุลาคม 2570 อัตราที่ต้องใช้เป็นเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807"],
    must_include_patterns: [/807/, /6\.3/, /0\.7/, /ร้อยละ\s*7/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-16",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท ลมทะเล จำกัด จ่าย 'ค่าที่ปรึกษา' 2,000,000 บาท เมื่อวันที่ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายเท่าใด",
    expected_statuses: ["NEEDS_CLARIFICATION"],
    must_cite_any_work_ids: ["prov.th.rc.3_เตรส", "prov.th.rc.70"],
    must_include_patterns: [/ผู้รับเงิน/, /ร้อยละ\s*3/, /ร้อยละ\s*15/],
  },
  {
    case_id: "B1-16F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-16",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-16: ผู้รับค่าที่ปรึกษา 2,000,000 บาท คือบริษัทที่ตั้งขึ้นตามกฎหมายต่างประเทศ ไม่มีสถานประกอบการในไทย งานบริหารจัดการทำจากต่างประเทศ จ่ายเมื่อ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายอย่างไร",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.70", "sched.th.rc.income_tax_rate", "prov.th.rc.40"],
    must_not_cite_work_ids: ["work.th.rd.gk_0811_4401_2002_ee32c418"],
    must_include_patterns: [/มาตรา\s*70/, /ร้อยละ\s*15/, /300,000\s*บาท/, /40\s*\(8\)/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-17",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท สุริยา โลจิสติกส์ จำกัด ยื่นแบบ ภ.ง.ด.50 เมื่อวันที่ 28 พฤษภาคม 2565 ต่อมาวันที่ 10 สิงหาคม 2568 ได้รับหมายเรียกของเจ้าพนักงานประเมินตามมาตรา 19 ไม่มีข้อเท็จจริงว่ามีการหลีกเลี่ยงภาษีหรือมีคำขอคืนภาษี สรรพากรออกหมายเรียกได้หรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.19"],
    must_include_patterns: [/2024-05-28/, /พ้นกำหนดเวลา\s*2\s*ปี/, /(?:ไม่อาจ|ไม่สามารถ)ออกหมายเรียกตามมาตรา\s*19\s*ได้/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-17F",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    prior_turn_case_id: "B1-17",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-17: ในหมายเรียกวันที่ 10 สิงหาคม 2568 ระบุว่าอธิบดีอนุมัติให้ขยายระยะเวลาการออกหมายเรียกแล้ว เพราะมีเหตุอันควรสงสัยว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร ผลตามมาตรา 19 เปลี่ยนหรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.19"],
    must_include_patterns: [/2027-05-28/, /มีอำนาจออกหมายเรียกได้โดยชอบด้วยประมวลรัษฎากร\s*มาตรา\s*19/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "B1-18",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    mode: "exact_lookup",
    question:
      "ขอสรุปแนววินิจฉัยในหนังสือตอบข้อหารือเลขที่ กค 0702/848421 ลงวันที่ 12 กันยายน 2568 เรื่องภาษีเงินได้นิติบุคคล กรณีค่าโฆษณาบนแพลตฟอร์มต่างประเทศ และขอเลขตู้ด้วย",
    expected_statuses: ["INSUFFICIENT_EVIDENCE"],
    must_include_patterns: [/ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่|ไม่พบเอกสารทางการเลขที่/, /848421/],
  },
  {
    case_id: "B1-19",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "ลูกจ้างอายุ 17 ปี ทำสัญญาจ้างแรงงานกับนายจ้างในไทย มีผลผูกพันตามประมวลกฎหมายแพ่งและพาณิชย์ และพระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541 หรือไม่ ผู้ปกครองต้องลงนามด้วยหรือไม่",
    expected_statuses: ["INSUFFICIENT_EVIDENCE"],
    must_include_patterns: [/อยู่นอกขอบเขตคลังข้อมูล|ไม่พบหลักฐาน/],
  },
  {
    case_id: "B1-20",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "ตามคำพิพากษาศาลฎีกาที่ 8877/2567 เรื่องภาษีธุรกิจเฉพาะ ศาลตัดสินอย่างไร และใช้กับกรณีขายที่ดินของผมได้ไหม",
    expected_statuses: ["NEEDS_CLARIFICATION", "INSUFFICIENT_EVIDENCE"],
    must_not_cite_work_ids: ["work.th.rd.gk_0811_2050_2002_b94ed885"],
    must_include_patterns: [/ไม่พบข้อมูลคำพิพากษาศาลฎีกาที่\s*`?8877\/2567`?/, /ระงับการสรุปผล/],
  },
  {
    case_id: "B1-22",
    suite: "LEGAL_TEAM_30_CASE_RETEST",
    question:
      "บริษัท เงินเชื่อแม่น้ำ จำกัด ประกอบธุรกิจเงินทุนตามกฎหมายว่าด้วยการประกอบธุรกิจเงินทุน ธุรกิจหลักทรัพย์ และธุรกิจเครดิตฟองซิเอร์ ในเดือนมีนาคม 2569 มีรายรับดอกเบี้ย 10,000,000 บาท ก่อนหักรายจ่าย ต้องเสียภาษีธุรกิจเฉพาะในอัตราเท่าใด และมีภาษีท้องถิ่นหรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.91/2", "prov.th.rc.91/5", "prov.th.rc.91/6", "subreg.th.rd.sbt_local_tax_guide"],
    must_not_cite_work_ids: ["subreg.th.rd.order_tp.4_2528"],
    must_include_patterns: [/ร้อยละ\s*3\.0|ร้อยละ\s*3/, /ภาษีท้องถิ่น/, /3\.3/, /300,000\s*บาท/, /30,000\s*บาท/, /330,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
];

const UNSEEN_AND_CHANGED_FACT_CASES: JourneyCaseSpec[] = [
  {
    case_id: "U-01",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "บริษัท ไทยสมาร์ท เทค จำกัด เป็นวิสาหกิจขนาดกลางและขนาดย่อม (SME) มีทุนชำระแล้ว 3,000,000 บาท และรายได้จากการขายสินค้าและบริการ 22,000,000 บาท ในรอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2568 มีกำไรสุทธิทางภาษี 2,500,000 บาท ต้องเสียภาษีเงินได้นิติบุคคลเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.65", "subreg.th.rc.royal_decree.530"],
    must_include_patterns: [/300,000/, /ร้อยละ\s*15/, /330,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-01F",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    prior_turn_case_id: "U-01",
    question:
      "ข้อเท็จจริงเปลี่ยน: บริษัท ไทยสมาร์ท เทค จำกัด มีทุนชำระแล้วในวันสุดท้ายของรอบบัญชี 10,000,000 บาท จึงไม่ใช่ SME โดยมีกำไรสุทธิ 2,500,000 บาท สำหรับรอบบัญชี 1 มกราคม – 31 ธันวาคม 2568 ต้องเสียภาษีเงินได้นิติบุคคลเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.65", "sched.th.rc.income_tax_rate"],
    must_include_patterns: [/ร้อยละ\s*20/, /500,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-02",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "บริษัท นครหลวง โฮลดิ้ง จำกัด ทำสัญญากู้ยืมเงินเป็นหนังสือจากบริษัทในเครือในประเทศไทย วงเงินกู้ยืม 50,000,000 บาท ต้องปิดอากรแสตมป์กี่บาท และใครเป็นผู้มีหน้าที่เสียอากร",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.104", "sched.th.rc.stamp_duty"],
    must_include_patterns: [/10,000\s*บาท/, /ผู้ให้กู้/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-03",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "บริษัท อารีย์ มีเดีย จำกัด (นิติบุคคลไทย) จ่ายค่าโฆษณา 500,000 บาท ให้บริษัท สยามแอด จำกัด (นิติบุคคลไทย) เมื่อวันที่ 10 พฤษภาคม 2568 โดยจ่ายเช็คปกติไม่ได้ผ่านระบบ e-Withholding Tax ต้องหักภาษี ณ ที่จ่ายในอัตราเท่าใดและเป็นเงินกี่บาท",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.3_เตรส", "subreg.th.rd.order_tp.4_2528"],
    must_include_patterns: [/ร้อยละ\s*2/, /10,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-03F",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    prior_turn_case_id: "U-03",
    question:
      "หากบริษัท อารีย์ มีเดีย จำกัด เปลี่ยนไปจ่ายค่าโฆษณา 500,000 บาท ให้บริษัท สยามแอด จำกัด (นิติบุคคลไทย) ผ่านระบบ e-Withholding Tax ตามมาตรา 3 ปัณรส เมื่อวันที่ 10 พฤษภาคม 2568 ต้องหักภาษี ณ ที่จ่ายกี่บาท",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.3_ปัณรส", "subreg.th.rc.min_reg.389"],
    must_include_patterns: [/ร้อยละ\s*1/, /5,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-04",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "A Thai limited company paid a royalty of THB 4,000,000 on 12 April 2026 to a foreign company with no permanent establishment in Thailand (no DTA claim). What withholding tax rate and amount apply under Section 70?",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.70", "sched.th.rc.income_tax_rate"],
    must_include_patterns: [/ร้อยละ\s*15/, /600,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-05",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "นางสาวกมลซื้อที่ดินแปลงหนึ่งจากบุคคลภายนอกเมื่อเดือนมกราคม 2566 และขายไปในเดือนเมษายน 2568 ถือครองมา 2 ปี ในราคา 4,000,000 บาท โดยไม่ได้ประกอบธุรกิจค้าอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรืออากรแสตมป์อย่างไร",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.91/2", "subreg.th.rc.royal_decree.342", "sched.th.rc.stamp_duty"],
    must_include_patterns: [/3\.3/, /ยกเว้นไม่ต้องเสียอากรแสตมป์/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-05F",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    prior_turn_case_id: "U-05",
    question:
      "ข้อเท็จจริงเปลี่ยน: นางสาวกมลซื้อที่ดินแปลงดังกล่าวตั้งแต่เดือนมกราคม 2560 และถือครองมา 8 ปีก่อนขายในเดือนเมษายน 2568 โดยไม่ได้ประกอบธุรกิจค้าอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรือไม่",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.91/2", "subreg.th.rc.royal_decree.342"],
    must_include_patterns: [/ไม่ต้องเสียภาษีธุรกิจเฉพาะ/, /0\.5/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-06",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "บริษัท ระยอง โพลีเมอร์ จำกัด มีกำไรสุทธิก่อนรายจ่ายการกุศลสาธารณะ 10,200,000 บาท ในรอบบัญชีปี 2568 บริจาคเงินให้แก่องค์การสาธารณกุศลตามประกาศอธิบดีกรมสรรพากรจำนวน 300,000 บาท หักเป็นรายจ่ายได้เท่าใด และเป็นรายจ่ายต้องห้ามเท่าใด",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.65_ตรี", "subreg.th.rd.order_p.52_2537"],
    must_include_patterns: [/200,000\s*บาท/, /100,000\s*บาท/, /2\/102|2\s*\/\s*102/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-07",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "นางสาวมณีรัตน์มีเงินได้สุทธิหลังหักค่าใช้จ่ายและค่าลดหย่อนแล้ว 2,500,000 บาท ในปีภาษี 2568 ต้องเสียภาษีเงินได้บุคคลธรรมดาเป็นเงินกี่บาท",
    expected_statuses: ["ANSWERED", "CONDITIONAL"],
    must_cite_all_work_ids: ["prov.th.rc.48", "sched.th.rc.income_tax_rate", "subreg.th.rc.royal_decree.470"],
    must_include_patterns: [/ร้อยละ\s*30/, /515,000\s*บาท/],
    require_verified_law_application_claim: true,
  },
  {
    case_id: "U-08",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศเมื่อวันที่ 31/02/2568 ได้สิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 หรือไม่",
    expected_statuses: ["NEEDS_CLARIFICATION"],
    must_include_patterns: [/ไม่มีอยู่จริงตามปฏิทิน|ไม่ถูกต้องตามปฏิทิน/],
  },
  {
    case_id: "U-09",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "In 2019, our Thai VAT-registered company sold goods to a foreign economic and trade office in Thailand. Does the 0% VAT rate under Section 80/1(5) apply?",
    expected_statuses: ["NEEDS_CLARIFICATION"],
    must_cite_any_work_ids: ["prov.th.rc.80/1", "statute.th.rc_amendment_49_2562"],
    must_include_patterns: [/2019|2562/, /วันเดือนปี/],
  },
  {
    case_id: "U-10",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    question:
      "ตามคำพิพากษาศาลฎีกาที่ 1234/2566 เรื่องภาษีเงินได้นิติบุคคล ศาลวินิจฉัยไว้อย่างไร",
    expected_statuses: ["NEEDS_CLARIFICATION", "INSUFFICIENT_EVIDENCE"],
    must_include_patterns: [/ไม่พบข้อมูลคำพิพากษาศาลฎีกาที่\s*`?1234\/2566`?/, /ระงับการสรุปผล/],
  },
  {
    case_id: "U-11",
    suite: "UNSEEN_AND_CHANGED_FACT_PACK",
    mode: "exact_lookup",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/3889 ลงวันที่ 23 มิถุนายน 2565",
    expected_statuses: ["ANSWERED"],
    must_cite_all_work_ids: ["work.th.rd.gk_0702_3889_2022_0d0a6d5b"],
    must_include_patterns: [/0702\/3889/],
  },
];

async function main() {
  const { queryKnowledge } = await import("../src/core/knowledge/query");
  const gitCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const storeBytes = fs.readFileSync(path.join(STAGING_STORE_DIR, "canonical-state.json.gz"));
  const storeSha256 = crypto.createHash("sha256").update(storeBytes).digest("hex");

  const priorOutputs = new Map<string, { question: string; answer_body: string }>();
  const allSpecs = [...LEGAL_TEAM_30_CASES, ...UNSEEN_AND_CHANGED_FACT_CASES];
  const results: Array<Record<string, unknown>> = [];
  const failures: Array<{ case_id: string; reasons: string[] }> = [];

  for (const spec of allSpecs) {
    const history: ConversationTurnInput[] = [];
    if (spec.prior_turn_case_id) {
      const prev = priorOutputs.get(spec.prior_turn_case_id);
      if (prev) {
        history.push({ role: "user", content: prev.question });
        history.push({ role: "assistant", content: prev.answer_body });
      }
    }

    const res = await queryKnowledge(
      {
        question: spec.question,
        mode: spec.mode || "standard",
        conversation_history: history.length > 0 ? history : undefined,
      },
      {
        actor_id: "public.reader@reg24.th",
        role: "reader",
        tenant_id: "PUBLIC",
        authorized_scopes: ["scope.platform.public"],
      }
    );

    priorOutputs.set(spec.case_id, {
      question: spec.question,
      answer_body: res.answer,
    });

    const citedWorkIds = Array.from(new Set(res.evidence.map((e) => e.work_id)));
    const reasons: string[] = [];

    if (!spec.expected_statuses.includes(res.status)) {
      reasons.push(
        `expected status in [${spec.expected_statuses.join(", ")}], got "${res.status}"`
      );
    }
    if (spec.must_cite_all_work_ids) {
      for (const reqWid of spec.must_cite_all_work_ids) {
        if (!citedWorkIds.includes(reqWid)) {
          reasons.push(`missing required cited work_id "${reqWid}" (cited: [${citedWorkIds.join(", ")}])`);
        }
      }
    }
    if (spec.must_cite_any_work_ids && spec.must_cite_any_work_ids.length > 0) {
      if (!spec.must_cite_any_work_ids.some((w) => citedWorkIds.includes(w))) {
        reasons.push(
          `none of [${spec.must_cite_any_work_ids.join(", ")}] cited (cited: [${citedWorkIds.join(", ")}])`
        );
      }
    }
    if (spec.must_not_cite_work_ids) {
      for (const forbiddenWid of spec.must_not_cite_work_ids) {
        if (citedWorkIds.includes(forbiddenWid)) {
          reasons.push(`cited forbidden unrelated work_id "${forbiddenWid}"`);
        }
      }
    }
    const combinedRenderedAndClarifications = `${res.answer}\n${(res.clarification_questions || []).join("\n")}`;
    for (const pat of spec.must_include_patterns) {
      if (!pat.test(combinedRenderedAndClarifications)) {
        reasons.push(`answer/clarification did not match required pattern ${String(pat)}`);
      }
    }
    if (spec.must_not_include_patterns) {
      for (const pat of spec.must_not_include_patterns) {
        if (pat.test(res.answer)) {
          reasons.push(`answer matched forbidden pattern ${String(pat)}`);
        }
      }
    }
    if (spec.require_verified_law_application_claim) {
      const lawAppClaims = res.claims.filter((c) => c.claim_id.includes(".law_application."));
      if (lawAppClaims.length === 0) {
        reasons.push(
          "expected at least one verified `.law_application.` claim in `res.claims`, but got 0 (check `verifyClaimAgainstPassages` on `calc.summary_statement_th`!)"
        );
      }
      if (res.traceable_answer && res.traceable_answer.status === "insufficient") {
        reasons.push(
          `traceable_answer status was insufficient (${res.traceable_answer.rendered_answer_th.slice(0, 120)})`
        );
      }
    }
    if (!res.execution_provenance || res.execution_provenance.release_id !== "rel.B01.rc6") {
      reasons.push(
        `missing or unexpected execution_provenance.release_id: ${JSON.stringify(res.execution_provenance)}`
      );
    }

    if (reasons.length > 0) {
      failures.push({ case_id: spec.case_id, reasons });
    }

    results.push({
      case_id: spec.case_id,
      suite: spec.suite,
      prior_turn_case_id: spec.prior_turn_case_id || null,
      passed_all_assertions: reasons.length === 0,
      failure_reasons: reasons,
      answer_status: res.status,
      release_id: res.release_id,
      manifest_hash: res.execution_provenance?.manifest_hash ?? null,
      execution_provenance: res.execution_provenance,
      cited_work_ids: citedWorkIds,
      cited_official_identifiers: Array.from(new Set(res.evidence.map((e) => e.official_identifier))),
      law_application_claim_count: res.claims.filter((c) => c.claim_id.includes(".law_application.")).length,
      traceable_answer_status: res.traceable_answer?.status ?? null,
      clarification_questions: res.clarification_questions ?? [],
      answer_preview_th: res.answer.slice(0, 520),
    });
  }

  const outPath = path.resolve(
    process.cwd(),
    "docs/audit/dodo-review-rc2-b02/legal_30case_retest_and_unseen_journey_receipt.json"
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const receipt = {
    generated_at_iso: new Date().toISOString(),
    git_base_commit_sha: gitCommit,
    staging_store_sha256: storeSha256,
    release_id: "rel.B01.rc6",
    manifest_id: "mfst.b01.rc6_core_auth",
    total_cases_executed: allSpecs.length,
    legal_team_30_cases_count: LEGAL_TEAM_30_CASES.length,
    unseen_and_changed_fact_cases_count: UNSEEN_AND_CHANGED_FACT_CASES.length,
    passed_count: allSpecs.length - failures.length,
    failed_count: failures.length,
    failures,
    governance_note:
      "Automated verification receipt for engineering & Dodo audit. Does NOT replace independent 7L Advisory Legal Team re-grading or constitute external-trial readiness.",
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        total: receipt.total_cases_executed,
        passed: receipt.passed_count,
        failed: receipt.failed_count,
        failures: receipt.failures,
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
