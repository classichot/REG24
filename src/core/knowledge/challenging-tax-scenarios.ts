/**
 * REG24 — Challenging Realistic Thai Tax Scenarios for Legal Team Review (`/legal-review`)
 *
 * Covers all 8 complex evaluation dimensions requested by the Product Owner & 7L Advisory Legal Team:
 *   1. Multi-step analysis (CIT + WHT + VAT across cross-border / domestic transactions)
 *   2. Statutory exceptions & provisos (Section 19 2-year vs 5-year summons extension, etc.)
 *   3. Changing facts (disqualifying export-of-service VAT 0% when partly used in Thailand)
 *   4. Historical law & amendments (accounting-period start vs end date, straddling quarters, pre-amendment containment)
 *   5. Missing decisive information (abstaining / asking for clarification instead of guessing)
 *   6. Multi-turn follow-up chains (2-turn / 3-turn reasoning preserving legal context while re-evaluating changed facts/dates)
 *   7. Official law or regulation provided as an attachment (verified origin + applicable version + section/page)
 *   8. Out-of-scope / unverified instruments (Labour Protection Act, quarantined Royal Decree, nonexistent ruling ID)
 */

import type { OfficialSourceFamily } from "./citation-contracts";

export type ChallengingScenarioCategory =
  | "multi_step"
  | "exceptions"
  | "changing_facts"
  | "historical_law"
  | "missing_information"
  | "follow_up_chain"
  | "verified_attachment"
  | "out_of_scope";

export interface ChallengingTaxScenario {
  scenario_id: string;
  category: ChallengingScenarioCategory;
  category_label_th: string;
  title_th: string;
  legal_focus_th: string;
  expected_behavior_th: string;
  question_th: string;
  as_of_date: string | null;
  mode?: "standard" | "exact_lookup" | "comparison";
  follow_up_turns?: Array<{
    turn_label_th: string;
    question_th: string;
    as_of_date?: string | null;
  }>;
  preset_attachment?: {
    issuer_id: string;
    source_family: OfficialSourceFamily;
    source_native_id: string;
    original_title_th: string;
    official_origin_url: string;
    royal_gazette_ref: string;
    publication_date: string;
    effective_from: string;
    section_label: string;
    physical_page_one_based: number;
    printed_page_label: string;
    attachment_text: string;
  };
}

export const CHALLENGING_THAI_TAX_SCENARIOS: ChallengingTaxScenario[] = [
  {
    scenario_id: "LSC-COMPLEX-01",
    category: "multi_step",
    category_label_th: "1. วิเคราะห์หลายขั้นตอน (Multi-Step CIT + WHT + VAT)",
    title_th: "จ่ายค่าบริการที่ปรึกษาและซอฟต์แวร์ให้บริษัทต่างประเทศ: ภาระหัก ณ ที่จ่าย และภาษีมูลค่าเพิ่ม",
    legal_focus_th:
      "วิเคราะห์แยกประเด็นภาษีเงินได้หัก ณ ที่จ่าย และภาษีมูลค่าเพิ่ม พร้อมอ้างอิงบทบัญญัติและแนววินิจฉัยกรมสรรพากรที่ตรวจสอบต้นฉบับแล้วแยกแต่ละข้อกล่าวอ้าง",
    expected_behavior_th:
      "ต้องแยกข้อกล่าวอ้างรายประเด็นพร้อมแหล่งอ้างอิงทางการ ไม่ปะปนเงื่อนไขของแต่ละประเภทภาษี และไม่สรุปเกินกว่าที่เอกสารต้นฉบับรับรอง",
    question_th:
      "บริษัทไทยว่าจ้างบริษัทที่ปรึกษาในต่างประเทศให้วิเคราะห์ข้อมูลและส่งรายงานทางอิเล็กทรอนิกส์มาใช้ในกิจการที่ประเทศไทยในปี 2568 บริษัทไทยมีหน้าที่หักภาษีเงินได้ ณ ที่จ่าย และนำส่งภาษีมูลค่าเพิ่ม (ภ.พ.36) ตามประมวลรัษฎากร มาตรา 83/6 และแนววินิจฉัยข้อหารือกรมสรรพากรอย่างไร?",
    as_of_date: "2025-06-15",
    follow_up_turns: [
      {
        turn_label_th: "คำถามต่อเนื่องที่ 2 (เพิ่มประเด็นรายจ่ายต้องห้าม ม.65 ตรี)",
        question_th:
          "แล้วค่าบริการที่จ่ายไปดังกล่าว หากไม่มีหลักฐานผู้รับเงินชัดเจน บริษัทไทยจะนำมาหักเป็นรายจ่ายในการคำนวณกำไรสุทธิได้หรือไม่ ตามมาตรา 65 ตรี?",
      },
    ],
  },
  {
    scenario_id: "LSC-COMPLEX-02",
    category: "exceptions",
    category_label_th: "2. ข้อยกเว้นทางกฎหมาย (Statutory Exceptions & Provisos)",
    title_th: "อายุความออกหมายเรียกประเมินภาษี: หลักทั่วไป 2 ปี เทียบกับข้อยกเว้นขยายเวลาไม่เกิน 5 ปี (ม.19 + บันทึกปี 2545)",
    legal_focus_th:
      "แยกข้อความตามบันทึกกองกฎหมายปี พ.ศ. 2545 (กค 0811(กม.03)/366) ออกจากข้อยกเว้นการขยายเวลาไม่เกิน 5 ปีตามมาตรา 19 แห่งประมวลรัษฎากร",
    expected_behavior_th:
      "ต้องคงข้อความอ้างอิง 2 ปีของเอกสารปี 2545 อย่างแม่นยำ แต่ไม่สรุปเหมารวมว่าเป็นกฎหมายปัจจุบันทั้งหมด และต้องแสดงข้อยกเว้นขยายเวลาไม่เกิน 5 ปีกรณีมีเหตุอันควรสงสัยว่าหลีกเลี่ยงภาษีหรือเพื่อประโยชน์ในการคืนภาษีพร้อมลิงก์มาตรา 19 แยกต่างหาก",
    question_th:
      "ตามหนังสือ กค 0811(กม.03)/366 เจ้าพนักงานประเมินต้องออกหมายเรียกภายใน 2 ปีใช่หรือไม่ และหากปรากฏหลักฐานอันควรเชื่อว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร กฎหมายปัจจุบันตามประมวลรัษฎากร มาตรา 19 กำหนดข้อยกเว้นไว้อย่างไร?",
    as_of_date: null,
  },
  {
    scenario_id: "LSC-COMPLEX-03",
    category: "changing_facts",
    category_label_th: "3. ข้อเท็จจริงเปลี่ยนแปลง (Changing Facts Disqualifying VAT 0%)",
    title_th: "ส่งออกบริการตามมาตรา 80/1 (2): เปลี่ยนข้อเท็จจริงเป็นลูกค้าต่างประเทศให้นำผลของบริการกลับมาใช้ที่สาขาในไทยบางส่วน",
    legal_focus_th:
      "ตรวจสอบว่าเมื่อข้อเท็จจริงเปลี่ยนเป็นมีการใช้บริการในราชอาณาจักรบางส่วน ระบบต้องชี้ชัดว่าขาดเงื่อนไขการใช้บริการในต่างประเทศทั้งหมดตาม ม.80/1 (2)",
    expected_behavior_th:
      "สถานะต้องเป็น CONDITIONAL หรือ NEEDS_CLARIFICATION และระบุชัดเจนว่าการนำบริการกลับมาใช้ในประเทศไทยทำให้ไม่เข้าเงื่อนไขเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0",
    question_th:
      "ตามแนววินิจฉัย กค 0702/636 และประมวลรัษฎากร มาตรา 80/1 (2) หากข้อเท็จจริงเปลี่ยนเป็นว่าผู้ว่าจ้างในต่างประเทศนำผลของการให้บริการนั้นกลับมาให้สำนักงานสาขาในประเทศไทยใช้งานด้วยบางส่วนในปี 2569 บริษัทผู้ให้บริการในไทยยังจะได้รับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 หรือไม่?",
    as_of_date: "2026-03-15",
  },
  {
    scenario_id: "LSC-COMPLEX-04",
    category: "historical_law",
    category_label_th: "4. กฎหมายย้อนหลังและรอยต่อการแก้ไข (Historical Law — Pre-Amendment Boundary)",
    title_th: "รอบระยะเวลาบัญชีเริ่ม 1 กรกฎาคม 2560 – 30 มิถุนายน 2561 กับบทบัญญัติแก้ไขเพิ่มเติม ม.65 ตรี (3)(ก) ที่ใช้กับรอบที่เริ่มในหรือหลัง 1 ม.ค. 2561",
    legal_focus_th:
      "ห้ามดูเฉพาะวันสิ้นสุดรอบระยะเวลาบัญชี (30 มิ.ย. 2561) แล้วนำบทแก้ไขเพิ่มเติมที่ใช้กับรอบที่เริ่มในหรือหลัง 1 ม.ค. 2561 มาใช้กับรอบบัญชีที่เริ่มจริงวันที่ 1 ก.ค. 2560 และห้ามเดาตัวบทรุ่นก่อนแก้ไขจากตัวบทรวมปัจจุบัน",
    expected_behavior_th:
      "ต้องตรวจสอบวันเริ่มต้นรอบระยะเวลาบัญชีจริง (1 ก.ค. 2560 < 1 ม.ค. 2561) และระงับการสรุปตัวบทย้อนหลังที่ยังไม่มีต้นฉบับรุ่นก่อนแก้ไขรับรอง (INSUFFICIENT_EVIDENCE) โดยไม่คาดเดา",
    question_th:
      "บริษัทมีรอบระยะเวลาบัญชีเริ่มวันที่ 1 กรกฎาคม 2560 ถึงวันที่ 30 มิถุนายน 2561 บริจาคเงินให้พรรคการเมือง จะนำบทบัญญัติรายจ่ายต้องห้ามตามประมวลรัษฎากร มาตรา 65 ตรี (3)(ก) ฉบับที่ใช้บังคับในรอบบัญชีดังกล่าวมาหักรายจ่ายได้อย่างไร?",
    as_of_date: null,
  },
  {
    scenario_id: "LSC-COMPLEX-05",
    category: "historical_law",
    category_label_th: "4b. วันที่กำกวมหรือระบุไม่ครบปี (Ambiguous / Partial Historical Date)",
    title_th: "ถามภาระภาษีโดยระบุวันที่ตัวเลขกำกวมหรือระบุเฉพาะเดือนโดยไม่มีปี พ.ศ.",
    legal_focus_th:
      "ทดสอบการตรวจจับวันที่ไม่สมบูรณ์ ('เมื่อวันที่ 15 มิถุนายน' โดยไม่ระบุปี หรือ 'เมื่อหลายปีก่อน') ในทุกช่องทางคำตอบ",
    expected_behavior_th:
      "ต้องคืนสถานะ NEEDS_CLARIFICATION และถามวัน เดือน ปี หรือวันเริ่มต้นรอบระยะเวลาบัญชีให้ชัดเจน แทนการสมมติว่าเป็นปีปัจจุบัน",
    question_th:
      "บริษัทจ่ายเงินบริจาคสนับสนุนการศึกษาเมื่อวันที่ 15 มิถุนายน สามารถนำมาหักรายจ่ายตามประมวลรัษฎากร มาตรา 65 ตรี ได้หรือไม่?",
    as_of_date: null,
  },
  {
    scenario_id: "LSC-COMPLEX-06",
    category: "missing_information",
    category_label_th: "5. ข้อมูลชี้ขาดขาดหาย (Missing Decisive Information)",
    title_th: "ขอฟันธงอัตราภาษีมูลค่าเพิ่ม 0% โดยยังไม่ทราบว่าผู้รับบริการในต่างประเทศนำบริการมาใช้ในไทยหรือไม่",
    legal_focus_th:
      "เมื่อผู้ถามระบุชัดว่ายังไม่ทราบข้อเท็จจริงอันเป็นเงื่อนไขชี้ขาด ระบบต้องถามข้อมูลเพิ่มเติม (NEEDS_CLARIFICATION) และไม่ฟันธงว่าร้อยละ 0 แน่นอน",
    expected_behavior_th:
      "สถานะต้องเป็น NEEDS_CLARIFICATION พร้อมคำถามเจาะจงเรื่องสถานที่ใช้ผลของบริการ และแสดงหลักเกณฑ์แบบมีเงื่อนไขตามแหล่งอ้างอิงจริงเท่านั้น",
    question_th:
      "บริษัทไทยให้บริการพัฒนาซอฟต์แวร์แก่ลูกค้าในประเทศสิงคโปร์ในปี 2568 โดยไม่ทราบว่าลูกค้าสิงคโปร์จะนำซอฟต์แวร์ดังกล่าวมาให้บริษัทย่อยในประเทศไทยใช้งานด้วยหรือไม่ บริษัทไทยสามารถใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 0 ตามมาตรา 80/1 (2) ได้ทันทีหรือไม่?",
    as_of_date: "2025-07-01",
  },
  {
    scenario_id: "LSC-COMPLEX-07",
    category: "follow_up_chain",
    category_label_th: "6. คำถามต่อเนื่องหลายลำดับ (Multi-Turn Follow-Up Reasoning)",
    title_th: "ถามต่อเนื่อง 3 ลำดับ: เริ่มจากหลักเกณฑ์ส่งออกบริการ -> เปลี่ยนข้อเท็จจริง -> เปลี่ยนช่วงเวลาย้อนหลัง",
    legal_focus_th:
      "ทดสอบการส่งประวัติบทสนทนา (conversation_history) เพื่อให้ระบบเข้าใจบริบทกฎหมายเดิม แต่ประเมินข้อเท็จจริงใหม่และวันที่ใหม่ในแต่ละรอบอย่างอิสระ",
    expected_behavior_th:
      "รอบที่ 1 แสดงแนววินิจฉัยพร้อมหลักฐาน · รอบที่ 2 จับข้อเท็จจริงที่เปลี่ยน (ใช้ในไทยบางส่วน -> CONDITIONAL) · รอบที่ 3 จับช่วงเวลาย้อนหลังที่ไม่ชัดเจน (NEEDS_CLARIFICATION / INSUFFICIENT_EVIDENCE)",
    question_th:
      "ขอทราบหลักเกณฑ์และแนววินิจฉัยตามหนังสือตอบข้อหารือ กค 0702/636 เรื่องการให้บริการที่ทำในราชอาณาจักรและใช้ในต่างประเทศ",
    as_of_date: "2026-02-15",
    follow_up_turns: [
      {
        turn_label_th: "กดถามต่อเนื่อง รอบที่ 2 (เปลี่ยนข้อเท็จจริง: นำกลับมาใช้ในไทย)",
        question_th:
          "แล้วถ้าข้อเท็จจริงเปลี่ยนเป็นลูกค้าต่างประเทศนำผลของบริการกลับมาให้สาขาในประเทศไทยใช้งานด้วยบางส่วนล่ะ ยังจะได้สิทธิอัตราร้อยละ 0 หรือไม่?",
      },
      {
        turn_label_th: "กดถามต่อเนื่อง รอบที่ 3 (เปลี่ยนเป็นช่วงเวลาย้อนหลังคลุมเครือ)",
        question_th:
          "แล้วถ้าธุรกรรมนี้เกิดขึ้นเมื่อหลายปีก่อนหน้าที่จะมีข้อหารือฉบับนี้ล่ะ จะนำข้อหารือนี้ไปใช้บังคับย้อนหลังได้ทันทีหรือไม่?",
      },
    ],
  },
  {
    scenario_id: "LSC-COMPLEX-08",
    category: "verified_attachment",
    category_label_th: "7. แนบเอกสารกฎหมายทางการ (Verified Official Law Attachment)",
    title_th: "แนบพระราชกฤษฎีกาจากราชกิจจานุเบกษา (ตรวจสอบแหล่งที่มา + รุ่นวันบังคับใช้ + มาตรา/หน้า) เพื่อใช้เป็นหลักฐาน",
    legal_focus_th:
      "ทดสอบการแนบกฎหมายลำดับรองทางการ ระบบต้องตรวจสอบทั้ง 3 เงื่อนไข (Origin, Applicable Version, Section/Page) ก่อนรับเป็นหลักฐานที่ใช้อ้างอิงได้",
    expected_behavior_th:
      "เมื่อกดยืนยันเอกสารแนบทางการแล้ว คำถามต้องตอบได้ครบถ้วน (ANSWERED / complete) พร้อมลิงก์ตัวชี้ตำแหน่ง (หน้า ๓ · มาตรา 4) มายังเอกสารแนบที่ยืนยันแล้ว",
    question_th:
      "ตามพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4 ที่แนบมานี้ สิทธิยกเว้นภาษีเงินได้นิติบุคคลสำหรับรายจ่ายลงทุนระบบอัตโนมัติกำหนดอัตราและช่วงเวลาไว้อย่างไร?",
    as_of_date: "2024-06-01",
    preset_attachment: {
      issuer_id: "reg.th.soc_ratchakitcha",
      source_family: "gazette_enactment",
      source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4",
      original_title_th:
        "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566",
      official_origin_url: "https://ratchakitcha.soc.go.th/documents/rd-779-2566.pdf",
      royal_gazette_ref: "เล่ม ๑๔๐ ตอนที่ ๔๙ ก",
      publication_date: "2023-08-17",
      effective_from: "2023-08-18",
      section_label: "มาตรา 4",
      physical_page_one_based: 3,
      printed_page_label: "๓",
      attachment_text:
        "ราชกิจจานุเบกษา เล่ม ๑๔๐ ตอนที่ ๔๙ ก พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4 ให้ยกเว้นภาษีเงินได้ตามส่วน 3 หมวด 3 ในลักษณะ 2 แห่งประมวลรัษฎากร ให้แก่บริษัทหรือห้างหุ้นส่วนนิติบุคคล สำหรับเงินได้เป็นจำนวนร้อยละหนึ่งร้อยของรายจ่ายที่ได้จ่ายไปเพื่อการลงทุนในเครื่องจักรและโปรแกรมคอมพิวเตอร์ที่เชื่อมต่อกับเครื่องจักรในระบบอัตโนมัติ ตั้งแต่วันที่ 1 มกราคม พ.ศ. 2566 ถึงวันที่ 31 ธันวาคม พ.ศ. 2568 เว้นแต่เป็นเครื่องจักรที่ได้รับสิทธิประโยชน์จากคณะกรรมการส่งเสริมการลงทุนแล้ว",
    },
  },
  {
    scenario_id: "LSC-COMPLEX-09",
    category: "out_of_scope",
    category_label_th: "8a. นอกขอบเขตคลังข้อมูลภาษี (Out-of-Scope Non-Tax Domain)",
    title_th: "ถามค่าชดเชยเลิกจ้างตามพระราชบัญญัติคุ้มครองแรงงาน (นอกขอบเขตคลังข้อมูลภาษีกรมสรรพากร)",
    legal_focus_th:
      "ตรวจสอบว่าระบบไม่แต่งคำตอบทางกฎหมายแรงงานที่ดูน่าเชื่อถือแต่ไม่มีหลักฐานในคลังข้อมูลที่รับรองแล้ว",
    expected_behavior_th:
      "ต้องคืนสถานะ INSUFFICIENT_EVIDENCE และระบุชัดเจนว่าอยู่นอกขอบเขตคลังข้อมูลภาษีอากรชุดปัจจุบัน (0 ข้อกล่าวอ้างที่อ้างว่า supported)",
    question_th:
      "ลูกจ้างทำงานติดต่อกันครบ 3 ปีแต่ไม่ครบ 6 ปี หากนายจ้างเลิกจ้างโดยลูกจ้างไม่ได้กระทำความผิด นายจ้างต้องจ่ายค่าชดเชยตามพระราชบัญญัติคุ้มครองแรงงานกี่วัน?",
    as_of_date: null,
  },
  {
    scenario_id: "LSC-COMPLEX-10",
    category: "out_of_scope",
    category_label_th: "8b. อ้างอิงเลขที่หนังสือตอบข้อหารือที่ไม่มีอยู่จริง (Nonexistent Ruling Guard)",
    title_th: "ถามเจาะจงเลขที่หนังสือตอบข้อหารือ กค 0702/999999 ที่ไม่มีอยู่ในสารบบ",
    legal_focus_th:
      "ป้องกันการนำข้อหารือฉบับอื่นที่คล้ายกันมาสวมรอยตอบแทนเลขที่ที่ผู้ถามระบุ (Zero Silent Substitution)",
    expected_behavior_th:
      "ต้องคืนสถานะ INSUFFICIENT_EVIDENCE ทันที และแจ้งว่าไม่พบ กค 0702/999999 ในคลังข้อมูลที่รับรองแล้ว",
    question_th:
      "ขอให้สรุปแนววินิจฉัยตามหนังสือตอบข้อหารือกรมสรรพากรเลขที่ กค 0702/999999 เรื่องภาษีมูลค่าเพิ่มจากการให้บริการทางอิเล็กทรอนิกส์",
    as_of_date: null,
  },
  {
    scenario_id: "LSC-COMPLEX-11",
    category: "historical_law",
    category_label_th: "4c. รหัสข้อหารือจริงแต่ระบุคำถามประยุกต์ใช้ข้ามช่วงเวลา (Ruling Applicability vs Historical Lookup)",
    title_th: "แยกการค้นหาข้อหารือจริง ออกจากคำถามว่านำข้อหารือนั้นไปใช้กับรอบบัญชีปี 2558 ย้อนหลังได้หรือไม่",
    legal_focus_th:
      "เมื่อคำถามใส่เลขที่ข้อหารือจริงมาด้วยแต่ถามว่านำไปใช้กับรอบบัญชีย้อนหลังปี 2558 ได้หรือไม่ ห้ามตอบรับรองการบังคับใช้ย้อนหลังโดยไม่ตรวจสอบตัวบทในปี 2558",
    expected_behavior_th:
      "ต้องระงับการรับรองผลย้อนหลังข้ามยุคกฎหมาย (INSUFFICIENT_EVIDENCE) หรือชี้แจงข้อจำกัดอย่างชัดเจนแทนการคาดเดา",
    question_th:
      "สามารถนำแนววินิจฉัยตามหนังสือตอบข้อหารือ กค 0702/636 ไปใช้ยืนยันสิทธิภาษีสำหรับธุรกรรมที่เกิดขึ้นในรอบระยะเวลาบัญชีปี พ.ศ. 2558 ได้โดยตรงหรือไม่?",
    as_of_date: null,
  },
  {
    scenario_id: "LSC-COMPLEX-12",
    category: "multi_step",
    category_label_th: "1b. เปรียบเทียบข้อหารือ 2 ฉบับพร้อมแยกข้อเท็จจริงผู้ขอหารือ (Multi-Ruling Comparison)",
    title_th: "เปรียบเทียบแนววินิจฉัยหนังสือตอบข้อหารือกรมสรรพากร 2 ฉบับในคลังข้อมูล B01",
    legal_focus_th:
      "ตรวจสอบการเปรียบเทียบหลายเอกสารโดยคงเลขที่หนังสือ วันที่ และลิงก์ต้นฉบับแยกแต่ละฉบับอย่างถูกต้อง",
    expected_behavior_th:
      "แสดงผลการเปรียบเทียบโดยทุกข้อกล่าวอ้างผูกกับรหัสหลักฐานของฉบับนั้นๆ โดยไม่สลับแหล่งอ้างอิง",
    question_th:
      "เปรียบเทียบแนววินิจฉัยระหว่างหนังสือตอบข้อหารือ กค 0702/636 และ กค 0811(กม.03)/366 ว่าเกี่ยวข้องกับบทบัญญัติใดและมีสาระสำคัญต่างกันอย่างไร",
    as_of_date: null,
    mode: "comparison",
  },
];
