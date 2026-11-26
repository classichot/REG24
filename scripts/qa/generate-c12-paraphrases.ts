#!/usr/bin/env npx tsx
/**
 * REG24 — Candidate 12 Workstream D3: Deterministic Non-Sealed VAT Allocation Paraphrase Generator
 *
 * Generates 16 synthetic paraphrases for each of the 4 core non-sealed VAT allocation fixtures
 * (64 total variants across Thai, English, mixed, swapped clause order, negation before/after,
 * lot labels ล็อต / ชุดที่ / รายการที่ / Lot, Thai & Arabic digits, and short & long dates).
 *
 * Strictly separate from the sealed 22; zero sealed prompts referenced or derived from.
 * Outputs `scripts/qa/c12-paraphrase-suite.yaml` (deterministic & ready to freeze + SHA-256 hash).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExpectedLotCheck, ReplayCaseSpec, ReplaySuiteFile } from "./hosted-replay";

const LOTS_AB_30SEP_C_1OCT: ExpectedLotCheck[] = [
  { label: "ล็อต\\s*A|ชุดที่\\s*1|ชุด\\s*1|รายการที่\\s*1|รายการ\\s*1|lot\\s*A|lot\\s*1|set\\s*1|item\\s*1", date_iso: "2026-09-30", decree_num: "799", base_thb: 20000, vat_thb: 1400 },
  { label: "ล็อต\\s*B|ชุดที่\\s*2|ชุด\\s*2|รายการที่\\s*2|รายการ\\s*2|lot\\s*B|lot\\s*2|set\\s*2|item\\s*2", date_iso: "2026-09-30", decree_num: "799", base_thb: 20000, vat_thb: 1400 },
  { label: "ล็อต\\s*C|ชุดที่\\s*3|ชุด\\s*3|รายการที่\\s*3|รายการ\\s*3|lot\\s*C|lot\\s*3|set\\s*3|item\\s*3", date_iso: "2026-10-01", decree_num: "807", base_thb: 10000, vat_thb: 700 },
];

const LOTS_A_29SEP_BC_1OCT: ExpectedLotCheck[] = [
  { label: "ล็อต\\s*A|ชุดที่\\s*1|ชุด\\s*1|รายการที่\\s*1|รายการ\\s*1|lot\\s*A|lot\\s*1|set\\s*1|item\\s*1", date_iso: "2026-09-29", decree_num: "799", base_thb: 20000, vat_thb: 1400 },
  { label: "ล็อต\\s*B|ชุดที่\\s*2|ชุด\\s*2|รายการที่\\s*2|รายการ\\s*2|lot\\s*B|lot\\s*2|set\\s*2|item\\s*2", date_iso: "2026-10-01", decree_num: "807", base_thb: 20000, vat_thb: 1400 },
  { label: "ล็อต\\s*C|ชุดที่\\s*3|ชุด\\s*3|รายการที่\\s*3|รายการ\\s*3|lot\\s*C|lot\\s*3|set\\s*3|item\\s*3", date_iso: "2026-10-01", decree_num: "807", base_thb: 10000, vat_thb: 700 },
];

const LOTS_A_29SEP_B_30SEP_C_2OCT: ExpectedLotCheck[] = [
  { label: "ล็อต\\s*A|ชุดที่\\s*1|ชุด\\s*1|รายการที่\\s*1|รายการ\\s*1|lot\\s*A|lot\\s*1|set\\s*1|item\\s*1", date_iso: "2026-09-29", decree_num: "799", base_thb: 20000, vat_thb: 1400 },
  { label: "ล็อต\\s*B|ชุดที่\\s*2|ชุด\\s*2|รายการที่\\s*2|รายการ\\s*2|lot\\s*B|lot\\s*2|set\\s*2|item\\s*2", date_iso: "2026-09-30", decree_num: "799", base_thb: 20000, vat_thb: 1400 },
  { label: "ล็อต\\s*C|ชุดที่\\s*3|ชุด\\s*3|รายการที่\\s*3|รายการ\\s*3|lot\\s*C|lot\\s*3|set\\s*3|item\\s*3", date_iso: "2026-10-02", decree_num: "807", base_thb: 10000, vat_thb: 700 },
];

const R1_BASE_TH =
  "บริษัท ทดสอบนกแก้ว จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อรายเดียว ราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ในล็อต A เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เท่านั้น ส่วนเหตุการณ์อื่นทั้งหมด ได้แก่ การโอนกรรมสิทธิ์ การรับชำระราคา และการออกใบกำกับภาษีของล็อต B และล็อต C รวมทั้งการส่งมอบสินค้าทั้ง 3 ล็อต เกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C ก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const R2_BASE_TH =
  "ขอเปลี่ยนข้อเท็จจริงว่า เหตุการณ์ทั้งหมดที่เดิมเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 ให้เปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 2 ตุลาคม 2569 แทน ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด วันเกิดความรับผิด พระราชกฤษฎีกา และภาษีมูลค่าเพิ่มของแต่ละส่วนเป็นอย่างไร";

function buildParaphraseSuite(): ReplaySuiteFile {
  const cases: ReplayCaseSpec[] = [];

  // ==========================================================================
  // FIXTURE P1: Distinct Lots Same Day (A+B 30 Sep RD 799 ฿2,800; C 1 Oct RD 807 ฿700) — 16 variants
  // ==========================================================================
  const p1Prompts: Array<[string, string]> = [
    ["P1-01-TH-LOTS", "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศมูลค่ารวม 50,000 บาทก่อน VAT แบ่งเป็น 3 ล็อต คือ ล็อต A 20,000 บาท ล็อต B 20,000 บาท และล็อต C 10,000 บาท วันที่ 30 กันยายน 2569 โอนกรรมสิทธิ์ล็อต A และในวันเดียวกันรับชำระราคาพร้อมออกใบกำกับภาษีเฉพาะล็อต B ส่วนล็อต C ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อน จากนั้นส่งมอบสินค้าทั้ง 3 ล็อตวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด กฎหมาย และ VAT ของแต่ละส่วนคือเท่าใด"],
    ["P1-02-TH-SETS", "บริษัทจดทะเบียน VAT ขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท (ไม่รวม VAT) แยกเป็น 3 ชุด ได้แก่ ชุดที่ 1 ราคา 20,000 บาท ชุดที่ 2 ราคา 20,000 บาท และชุดที่ 3 ราคา 10,000 บาท วันที่ 30 กันยายน 2569 โอนกรรมสิทธิ์ชุดที่ 1 และรับชำระราคาพร้อมออกใบกำกับภาษีสำหรับชุดที่ 2 ส่วนชุดที่ 3 ไม่มีเหตุการณ์ใดก่อนหน้า ต่อมาส่งมอบสินค้าครบทั้ง 3 ชุดวันที่ 1 ตุลาคม 2569 ต้องเสีย VAT แต่ละส่วนวันใด กี่บาท และใช้ พ.ร.ฎ. ฉบับใด"],
    ["P1-03-TH-ITEMS", "ผู้ขายที่จดทะเบียนภาษีมูลค่าเพิ่มจำหน่ายสินค้าในประเทศรวม 50,000 บาทก่อน VAT แบ่งเป็น 3 รายการ คือ รายการที่ 1 มูลค่า 20,000 บาท รายการที่ 2 มูลค่า 20,000 บาท และรายการที่ 3 มูลค่า 10,000 บาท โดยโอนกรรมสิทธิ์รายการที่ 1 วันที่ 30 กันยายน 2569 และออกใบกำกับภาษีพร้อมรับชำระเงินรายการที่ 2 ในวันที่ 30 กันยายน 2569 เช่นกัน ไม่มีเหตุการณ์ใดของรายการที่ 3 ก่อนวันส่งมอบ และส่งมอบครบทั้ง 3 รายการวันที่ 1 ตุลาคม 2569 ภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเท่าใด"],
    ["P1-04-TH-DIGITS", "บริษัทจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศมูลค่ารวม ๕๐,๐๐๐ บาท (ก่อนภาษีมูลค่าเพิ่ม) แบ่งเป็น ๓ ล็อต คือ ล็อต A ๒๐,๐๐๐ บาท ล็อต B ๒๐,๐๐๐ บาท และล็อต C ๑๐,๐๐๐ บาท เมื่อวันที่ ๓๐ กันยายน ๒๕๖๙ โอนกรรมสิทธิ์ล็อต A และวันเดียวกันรับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต B โดยเฉพาะ ส่วนล็อต C ไม่มีการกระทำใดก่อนหน้า และส่งมอบทั้ง ๓ ล็อตวันที่ ๑ ตุลาคม ๒๕๖๙ วันเกิดความรับผิด พ.ร.ฎ. และ VAT ของแต่ละส่วนคือเท่าใด"],
    ["P1-05-SHORT-DATE", "ร้านค้าจด VAT ขายสินค้าในไทยรวม 50,000 บาทก่อนบวก VAT แบ่งเป็น ล็อต A 20,000 บาท ล็อต B 20,000 บาท ล็อต C 10,000 บาท วันที่ 30 ก.ย. 69 โอนกรรมสิทธิ์ล็อต A และรับเงินพร้อมออกใบกำกับภาษีล็อต B ส่วนล็อต C ไม่มีเหตุการณ์ใดก่อนวันที่ 1 ต.ค. 69 โดยส่งของทั้ง 3 ล็อตพร้อมกันวันที่ 1 ต.ค. 69 ต้องคำนวณ VAT แต่ละส่วนเท่าไร ใช้ พ.ร.ฎ. ฉบับใด"],
    ["P1-06-DELIVERY-FIRST", "บริษัทจดทะเบียน VAT ขายสินค้าในประเทศรวม 50,000 บาทก่อน VAT แยกเป็น 3 ล็อต ได้แก่ ล็อต A 20,000 บาท ล็อต B 20,000 บาท และล็อต C 10,000 บาท โดยส่งมอบสินค้าทั้ง 3 ล็อตพร้อมกันวันที่ 1 ตุลาคม 2569 ทั้งนี้ก่อนวันส่งมอบ เมื่อวันที่ 30 กันยายน 2569 บริษัทได้โอนกรรมสิทธิ์ล็อต A และได้รับชำระราคาพร้อมออกใบกำกับภาษีเฉพาะล็อต B ส่วนล็อต C ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดและ VAT แต่ละส่วนคือเท่าใด"],
    ["P1-07-NEGATION-BEFORE", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศรวม 50,000 บาทก่อน VAT แบ่งเป็น ล็อต A 20,000 บาท ล็อต B 20,000 บาท และล็อต C 10,000 บาท สำหรับล็อต C ไม่มีการโอนกรรมสิทธิ์ รับชำระราคา หรือออกใบกำกับภาษีก่อนวันที่ 1 ตุลาคม 2569 แต่เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์ล็อต A และรับชำระราคาพร้อมออกใบกำกับภาษีล็อต B จากนั้นส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 สรุปวันเกิดความรับผิด พ.ร.ฎ. และ VAT แต่ละส่วน"],
    ["P1-08-EN-FULL", "A VAT-registered Thai seller makes an ordinary domestic sale of goods totaling 50,000 THB before VAT, divided into 3 distinct lots: Lot A (20,000 THB), Lot B (20,000 THB), and Lot C (10,000 THB). On 30 September 2026, ownership transfers for Lot A, and on the same day (30 September 2026) payment is received and a tax invoice is issued for Lot B only. No transfer, payment, or tax invoice occurs for Lot C prior to delivery. All 3 lots are delivered on 1 October 2026. Determine the VAT tax point, governing Royal Decree, and VAT amount for each portion."],
    ["P1-09-MIXED-TH-EN", "บริษัทผู้ขายจดทะเบียน VAT ขายสินค้าในประเทศรวม 50,000 บาท (excl. VAT) แบ่งเป็น Lot A 20,000 บาท, Lot B 20,000 บาท และ Lot C 10,000 บาท โดยวันที่ 30 September 2026 โอนกรรมสิทธิ์ Lot A และรับชำระราคาพร้อมออกใบกำกับภาษีสำหรับ Lot B เท่านั้น (no early event for Lot C before 1 October 2026) แล้วส่งมอบทั้ง 3 lots วันที่ 1 October 2026 วันเกิดความรับผิด พระราชกฤษฎีกา และ VAT แต่ละส่วนคือเท่าใด"],
    ["P1-10-REVERSE-LOT-ORDER", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศรวม 50,000 บาท (ยังไม่รวม VAT) ประกอบด้วย ล็อต C ราคา 10,000 บาท ล็อต B ราคา 20,000 บาท และล็อต A ราคา 20,000 บาท เมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต B และโอนกรรมสิทธิ์สำหรับล็อต A ส่วนล็อต C ยังไม่มีเหตุการณ์ใดก่อนวันที่ 1 ตุลาคม 2569 โดยส่งมอบทั้ง 3 ล็อตวันที่ 1 ตุลาคม 2569 จงคำนวณ VAT และระบุ พ.ร.ฎ. ของแต่ละส่วน"],
    ["P1-11-PAY-BEFORE-TITLE", "บริษัทจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศรวม 50,000 บาทก่อนภาษีมูลค่าเพิ่ม แยกเป็น 3 ล็อต: ล็อต A 20,000 บาท, ล็อต B 20,000 บาท, ล็อต C 10,000 บาท เมื่อวันที่ 30 กันยายน 2569 บริษัทออกใบกำกับภาษีและรับชำระราคาสำหรับล็อต B และในวันเดียวกันโอนกรรมสิทธิ์ในล็อต A ให้ผู้ซื้อ โดยล็อต C ไม่มีการโอนกรรมสิทธิ์ ชำระเงิน หรือออกใบกำกับภาษีก่อน และมีการส่งมอบสินค้าทั้งหมดวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดและ VAT ของแต่ละส่วนคือเท่าใด"],
    ["P1-12-EN-SETS", "A VAT-registered seller in Thailand sells domestic goods for 50,000 THB (before VAT) split into 3 separate sets: Set 1 (20,000 THB), Set 2 (20,000 THB), and Set 3 (10,000 THB). On 30 September 2569 (2026-09-30), title passes for Set 1, and payment plus tax invoice occur for Set 2 only. There are no earlier acts for Set 3 before 1 October 2569. Delivery of all 3 sets occurs on 1 October 2569 (2026-10-01). What are the tax point, Royal Decree, and VAT for each portion?"],
    ["P1-13-CONCISE-TH", "ขายสินค้าในไทยโดยผู้ประกอบการจด VAT ยอดก่อน VAT 50,000 บาท แบ่งเป็น ชุดที่ 1 (20,000 บาท) ชุดที่ 2 (20,000 บาท) ชุดที่ 3 (10,000 บาท) วันที่ 30 ก.ย. 69 โอนกรรมสิทธิ์ชุดที่ 1 และรับเงิน+ออกใบกำกับภาษีชุดที่ 2 ส่วนชุดที่ 3 ไม่มีเหตุการณ์ก่อน 1 ต.ค. 69 ส่งของครบทั้ง 3 ชุดวันที่ 1 ต.ค. 69 คิด VAT แต่ละส่วนเท่าไร ตาม พ.ร.ฎ. ใด"],
    ["P1-14-BULLET-STYLE", "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศรวม 50,000 บาทก่อน VAT รายละเอียดดังนี้: - ล็อต A 20,000 บาท: โอนกรรมสิทธิ์ 30 กันยายน 2569 - ล็อต B 20,000 บาท: รับชำระราคาและออกใบกำกับภาษี 30 กันยายน 2569 - ล็อต C 10,000 บาท: ไม่มีเหตุการณ์ก่อน 1 ตุลาคม 2569 - ส่งมอบสินค้าทั้ง 3 ล็อตพร้อมกันวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด พระราชกฤษฎีกา และ VAT แต่ละส่วนเป็นเท่าใด"],
    ["P1-15-ISO-DATES", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าทั่วไปในประเทศ 50,000 บาทก่อน VAT แบ่งเป็น รายการที่ 1 (20,000 บาท) รายการที่ 2 (20,000 บาท) และรายการที่ 3 (10,000 บาท) วันที่ 2026-09-30 โอนกรรมสิทธิ์รายการที่ 1 และได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับรายการที่ 2 ส่วนรายการที่ 3 ไม่มีการโอนกรรมสิทธิ์ ชำระเงิน หรือออกใบกำกับภาษีก่อน 2026-10-01 และส่งมอบทั้ง 3 รายการวันที่ 2026-10-01 วันเกิดความรับผิดและ VAT แต่ละส่วนคือเท่าใด"],
    ["P1-16-TH-FORMAL", "บริษัทผู้ขายซึ่งจดทะเบียนภาษีมูลค่าเพิ่มตกลงขายสินค้าทั่วไปในราชอาณาจักรมูลค่ารวม 50,000 บาท (ไม่รวมภาษีมูลค่าเพิ่ม) โดยจำแนกเป็น 3 ล็อต ได้แก่ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท ปรากฏข้อเท็จจริงว่า ณ วันที่ 30 กันยายน 2569 บริษัทได้โอนกรรมสิทธิ์ล็อต A และได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต B เป็นการเฉพาะ ส่วนล็อต C มิได้มีการโอนกรรมสิทธิ์ รับชำระราคา หรือออกใบกำกับภาษีก่อนหน้า ต่อมาได้ส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 ขอทราบวันเกิดความรับผิด พ.ร.ฎ. และยอด VAT ของแต่ละส่วน"],
  ];

  for (const [id, prompt] of p1Prompts) {
    cases.push({
      id,
      category: "paraphrase_p1",
      source: "D3 synthetic paraphrase of SF-C9-1 (distinct lots same day)",
      turns: [
        {
          turn_id: "r1",
          turn_mode: "fresh",
          prompt,
          expected: {
            status_in: ["ANSWERED"],
            min_claims: 2,
            expected_lots: LOTS_AB_30SEP_C_1OCT,
          },
        },
      ],
    });
  }

  // ==========================================================================
  // FIXTURE P2: Same Lot Across Days (A 29 Sep RD 799 ฿1,400; B+C 1 Oct RD 807 ฿2,100) — 16 variants
  // ==========================================================================
  const p2Prompts: Array<[string, string]> = [
    ["P2-01-TH-LOTS", "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศราคารวม 50,000 บาทก่อน VAT แบ่งเป็น 3 ล็อต คือ ล็อต A 20,000 บาท ล็อต B 20,000 บาท และล็อต C 10,000 บาท บริษัทโอนกรรมสิทธิ์ล็อต A วันที่ 29 กันยายน 2569 และวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เท่านั้น (ไม่ใช่ล็อต B หรือ C) ส่วนล็อต B และ C ไม่มีการโอนกรรมสิทธิ์ รับชำระราคา หรือออกใบกำกับภาษีก่อนวันที่ 1 ตุลาคม 2569 และส่งมอบสินค้าทั้ง 3 ล็อตวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด พ.ร.ฎ. และ VAT ของแต่ละส่วนคือเท่าใด"],
    ["P2-02-TH-SETS", "บริษัทจดทะเบียน VAT ขายสินค้าทั่วไปในประเทศรวม 50,000 บาทก่อน VAT แยกเป็น 3 ชุด: ชุดที่ 1 (20,000 บาท) ชุดที่ 2 (20,000 บาท) และชุดที่ 3 (10,000 บาท) โอนกรรมสิทธิ์ชุดที่ 1 วันที่ 29 กันยายน 2569 ต่อมาวันที่ 30 กันยายน 2569 รับชำระราคาและออกใบกำกับภาษีสำหรับชุดที่ 1 เดิมเท่านั้น ส่วนชุดที่ 2 และชุดที่ 3 ไม่มีเหตุการณ์ใดก่อนวันที่ 1 ตุลาคม 2569 และส่งมอบครบทั้ง 3 ชุดเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดและ VAT แต่ละส่วนคือเท่าใด"],
    ["P2-03-TH-ITEMS", "ผู้ขายจดทะเบียน VAT ขายสินค้าในประเทศรวม 50,000 บาท (ไม่รวม VAT) แบ่งเป็น 3 รายการ คือ รายการที่ 1 (20,000 บาท) รายการที่ 2 (20,000 บาท) และรายการที่ 3 (10,000 บาท) รายการที่ 1 โอนกรรมสิทธิ์วันที่ 29 กันยายน 2569 และรับชำระราคาพร้อมออกใบกำกับภาษีสำหรับรายการที่ 1 เท่านั้นในวันที่ 30 กันยายน 2569 ส่วนรายการที่ 2 และรายการที่ 3 ไม่มีการโอนกรรมสิทธิ์ รับเงิน หรือออกใบกำกับภาษีก่อนวันส่งมอบวันที่ 1 ตุลาคม 2569 คำนวณ VAT และ พ.ร.ฎ. ของแต่ละส่วน"],
    ["P2-04-TH-DIGITS", "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศรวม ๕๐,๐๐๐ บาทก่อน VAT แบ่งเป็น ๓ ล็อต คือ ล็อต A ๒๐,๐๐๐ บาท ล็อต B ๒๐,๐๐๐ บาท และล็อต C ๑๐,๐๐๐ บาท โอนกรรมสิทธิ์ล็อต A วันที่ ๒๙ กันยายน ๒๕๖๙ และรับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต A เท่านั้นเมื่อวันที่ ๓๐ กันยายน ๒๕๖๙ ส่วนล็อต B และล็อต C ไม่มีเหตุการณ์ใดก่อนวันที่ ๑ ตุลาคม ๒๕๖๙ โดยส่งมอบสินค้าทั้ง ๓ ล็อตวันที่ ๑ ตุลาคม ๒๕๖๙ วันเกิดความรับผิดและ VAT ของแต่ละส่วนเป็นเท่าใด"],
    ["P2-05-SHORT-DATE", "บริษัทจด VAT ขายสินค้าในไทย 50,000 บาทก่อน VAT แยกเป็น ล็อต A 20,000 บาท ล็อต B 20,000 บาท ล็อต C 10,000 บาท วันที่ 29 ก.ย. 69 โอนกรรมสิทธิ์ล็อต A และวันที่ 30 ก.ย. 69 รับชำระเงินพร้อมออกใบกำกับภาษีของล็อต A เดิมเท่านั้น (ล็อต B กับ C ไม่มีเหตุการณ์ก่อน 1 ต.ค. 69) ส่งมอบทั้ง 3 ล็อตวันที่ 1 ต.ค. 69 คิด VAT แต่ละส่วนเท่าไร ใช้ พ.ร.ฎ. ฉบับใด"],
    ["P2-06-DELIVERY-FIRST", "บริษัทจดทะเบียน VAT ขายสินค้าในประเทศมูลค่ารวม 50,000 บาทก่อน VAT แบ่งเป็น ล็อต A 20,000 บาท ล็อต B 20,000 บาท และล็อต C 10,000 บาท โดยส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 ทั้งนี้เฉพาะล็อต A มีการโอนกรรมสิทธิ์ก่อนเมื่อวันที่ 29 กันยายน 2569 และรับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต A เดิมอีกครั้งวันที่ 30 กันยายน 2569 ส่วนล็อต B และล็อต C ไม่มีการกระทำใดก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด พ.ร.ฎ. และ VAT ของแต่ละส่วนคือเท่าใด"],
    ["P2-07-NEGATION-BEFORE", "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศรวม 50,000 บาทก่อน VAT แบ่งเป็น 3 ล็อต: ล็อต A 20,000 บาท, ล็อต B 20,000 บาท, ล็อต C 10,000 บาท โดยล็อต B และล็อต C ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อนวันที่ 1 ตุลาคม 2569 ส่วนล็อต A โอนกรรมสิทธิ์วันที่ 29 กันยายน 2569 และรับชำระราคาพร้อมออกใบกำกับภาษีของล็อต A เท่านั้นในวันที่ 30 กันยายน 2569 จากนั้นส่งมอบสินค้าทั้ง 3 ล็อตวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดและ VAT แต่ละส่วนคือเท่าใด"],
    ["P2-08-EN-FULL", "A VAT-registered Thai seller sells domestic goods for 50,000 THB before VAT, divided into 3 lots: Lot A (20,000 THB), Lot B (20,000 THB), and Lot C (10,000 THB). Title to Lot A transfers on 29 September 2026, and on 30 September 2026 payment is received and a tax invoice is issued for that same Lot A only (not Lot B or Lot C). There are no earlier transfers, payments, or tax invoices for Lot B or Lot C before 1 October 2026. All 3 lots are delivered on 1 October 2026. State the VAT tax point, Royal Decree, and VAT for each portion."],
    ["P2-09-MIXED-TH-EN", "บริษัทจดทะเบียน VAT ขายสินค้าในประเทศ 50,000 บาทก่อน VAT แบ่งเป็น Lot A 20,000 บาท, Lot B 20,000 บาท, Lot C 10,000 บาท โดยโอนกรรมสิทธิ์ Lot A วันที่ 29 September 2026 แล้ววันที่ 30 September 2026 รับชำระราคาและออกใบกำกับภาษีสำหรับ Lot A only (ไม่ใช่ Lot B/C) ส่วน Lot B และ Lot C ไม่มีเหตุการณ์ก่อน 1 October 2026 และส่งมอบครบทั้ง 3 lots วันที่ 1 October 2026 วันเกิดความรับผิด กฎหมาย และ VAT แต่ละส่วนคือเท่าใด"],
    ["P2-10-REVERSE-LOT-ORDER", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศรวม 50,000 บาท (ไม่รวม VAT) ได้แก่ ล็อต C 10,000 บาท ล็อต B 20,000 บาท และล็อต A 20,000 บาท ล็อต A โอนกรรมสิทธิ์วันที่ 29 กันยายน 2569 และวันที่ 30 กันยายน 2569 รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต A เท่านั้น ส่วนล็อต B และล็อต C ไม่มีเหตุการณ์ก่อนวันที่ 1 ตุลาคม 2569 และส่งมอบสินค้าทั้ง 3 ล็อตวันที่ 1 ตุลาคม 2569 ภาษีมูลค่าเพิ่มของแต่ละส่วนเป็นเท่าใด"],
    ["P2-11-EN-SETS", "A VAT-registered seller in Thailand sells domestic goods for 50,000 THB (before VAT) split into Set 1 (20,000 THB), Set 2 (20,000 THB), and Set 3 (10,000 THB). Ownership of Set 1 passes on 29 September 2026, and payment plus tax invoice for that same Set 1 only occur on 30 September 2026. No earlier acts occur for Set 2 or Set 3 before 1 October 2026, when all 3 sets are delivered. What are the tax point, Royal Decree, and VAT for each portion?"],
    ["P2-12-ISO-DATES", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าทั่วไปในประเทศรวม 50,000 บาทก่อน VAT แบ่งเป็น รายการที่ 1 (20,000 บาท) รายการที่ 2 (20,000 บาท) และรายการที่ 3 (10,000 บาท) รายการที่ 1 โอนกรรมสิทธิ์วันที่ 2026-09-29 และรับชำระราคาพร้อมออกใบกำกับภาษีสำหรับรายการที่ 1 เท่านั้นในวันที่ 2026-09-30 ส่วนรายการที่ 2 และรายการที่ 3 ไม่มีการโอนกรรมสิทธิ์ ชำระเงิน หรือออกใบกำกับภาษีก่อน 2026-10-01 และส่งมอบทั้ง 3 รายการวันที่ 2026-10-01 วันเกิดความรับผิดและ VAT แต่ละส่วนคือเท่าใด"],
    ["P2-13-CONCISE-TH", "ขายสินค้าในไทยโดยบริษัทจด VAT ยอดก่อน VAT 50,000 บาท: ชุดที่ 1 (20,000 บาท) ชุดที่ 2 (20,000 บาท) ชุดที่ 3 (10,000 บาท) วันที่ 29 ก.ย. 69 โอนกรรมสิทธิ์ชุดที่ 1 และ 30 ก.ย. 69 รับเงิน+ออกใบกำกับภาษีเฉพาะชุดที่ 1 เดิม ส่วนชุดที่ 2 กับ 3 ไม่มีเหตุการณ์ก่อน 1 ต.ค. 69 ส่งมอบครบทั้ง 3 ชุดวันที่ 1 ต.ค. 69 คิด VAT แต่ละส่วนกี่บาท ตาม พ.ร.ฎ. ฉบับใด"],
    ["P2-14-BULLET-STYLE", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าทั่วไปในประเทศ 50,000 บาทก่อน VAT: - ล็อต A 20,000 บาท: โอนกรรมสิทธิ์ 29 กันยายน 2569 และรับชำระราคา+ออกใบกำกับภาษีสำหรับล็อต A เดิมวันที่ 30 กันยายน 2569 - ล็อต B 20,000 บาท และล็อต C 10,000 บาท: ไม่มีเหตุการณ์ใดก่อนวันที่ 1 ตุลาคม 2569 - ส่งมอบทั้ง 3 ล็อตวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด พ.ร.ฎ. และ VAT ของแต่ละส่วนคือเท่าใด"],
    ["P2-15-NO-DOUBLE-TAX-EXPLICIT", "บริษัทจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศรวม 50,000 บาทก่อน VAT แบ่งเป็น 3 ล็อต คือ ล็อต A 20,000 บาท ล็อต B 20,000 บาท ล็อต C 10,000 บาท วันที่ 29 กันยายน 2569 โอนกรรมสิทธิ์ล็อต A ต่อมาวันที่ 30 กันยายน 2569 ผู้ซื้อจ่ายเงินและบริษัทออกใบกำกับภาษีให้เฉพาะล็อต A ตัวเดิม (มิใช่ล็อตอื่น) โดยล็อต B และล็อต C ไม่มีการโอนกรรมสิทธิ์ จ่ายเงิน หรือออกใบกำกับภาษีก่อน 1 ตุลาคม 2569 และส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 ต้องเสีย VAT วันใดและจำนวนเท่าใดสำหรับแต่ละส่วน"],
    ["P2-16-TH-FORMAL", "บริษัทผู้ขายซึ่งจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในราชอาณาจักรมูลค่ารวม 50,000 บาท (ไม่รวมภาษีมูลค่าเพิ่ม) แยกเป็น 3 ล็อต ได้แก่ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ล็อต A เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต A เดิมเท่านั้น ส่วนล็อต B และล็อต C มิได้มีการกระทำใดก่อนวันที่ 1 ตุลาคม 2569 และส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด พ.ร.ฎ. และ VAT แต่ละส่วนคือเท่าใด"],
  ];

  for (const [id, prompt] of p2Prompts) {
    cases.push({
      id,
      category: "paraphrase_p2",
      source: "D3 synthetic paraphrase of SF-C9-2 (same lot across days)",
      turns: [
        {
          turn_id: "r1",
          turn_mode: "fresh",
          prompt,
          expected: {
            status_in: ["ANSWERED"],
            min_claims: 2,
            expected_lots: LOTS_A_29SEP_BC_1OCT,
          },
        },
      ],
    });
  }

  // ==========================================================================
  // FIXTURE P3: Follow-up r3 Lot B 30 Sep Correction (A 29 Sep RD 799; B 30 Sep RD 799; C 2 Oct RD 807) — 16 variants
  // ==========================================================================
  const p3R3Prompts: Array<[string, string]> = [
    ["P3-01-EN-EXACT", "Correction: the 30 September payment and tax invoice covered lot B only. Keep all other facts unchanged."],
    ["P3-02-EN-TERSE", "Update: 30 Sep 2026 payment and invoice were for Lot B only, not Lot A. Everything else stays the same."],
    ["P3-03-EN-PASSIVE", "Please note a correction: Lot B alone was covered by the payment and tax invoice issued on 30 September 2026. All other facts remain unchanged."],
    ["P3-04-EN-ACTUALLY", "Actually, the 30 September 2569 payment and tax invoice applied solely to lot B (not lot A); keep all other dates and facts unchanged."],
    ["P3-05-EN-CLAUSE-SWAP", "For lot B only (not lot A), payment was received and the tax invoice was issued on 30 September 2026. Keep every other fact the same."],
    ["P3-06-TH-FORMAL", "ขอแก้ไขข้อเท็จจริงว่า การรับชำระราคาและออกใบกำกับภาษีเมื่อวันที่ 30 กันยายน 2569 ครอบคลุมเฉพาะล็อต B เท่านั้น ไม่ใช่ล็อต A ส่วนข้อเท็จจริงอื่นทั้งหมดคงเดิม"],
    ["P3-07-TH-CASUAL", "แก้ข้อเท็จจริงนิดนึงครับ ยอดรับเงินกับใบกำกับภาษีวันที่ 30 กันยายน 2569 เป็นของล็อต B อย่างเดียว ไม่ใช่ล็อต A อย่างอื่นเหมือนเดิมหมดเลยครับ"],
    ["P3-08-TH-SHORT-DATE", "ขอเปลี่ยนข้อเท็จจริง: การรับชำระเงินและออกใบกำกับภาษีวันที่ 30 ก.ย. 69 เป็นของล็อต B เท่านั้น ข้อเท็จจริงอื่นทั้งหมดเหมือนเดิม"],
    ["P3-09-TH-DIGITS", "ขอแก้ไขข้อเท็จจริงว่า การรับชำระราคาและออกใบกำกับภาษีเมื่อวันที่ ๓๐ กันยายน ๒๕๖๙ เป็นของล็อต B เท่านั้น ส่วนข้อเท็จจริงอื่นคงเดิมทั้งหมด"],
    ["P3-10-MIXED-TH-EN", "Correction ครับ: การรับชำระราคาและออก tax invoice วันที่ 30 September 2026 ครอบคลุมเฉพาะ Lot B only ส่วน facts อื่นทั้งหมดคงเดิม"],
    ["P3-11-TH-LOT-FIRST", "เฉพาะล็อต B เท่านั้นที่ได้รับการชำระราคาและออกใบกำกับภาษีเมื่อวันที่ 30 กันยายน 2569 (ไม่ใช่ล็อต A) ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด ภาระ VAT เปลี่ยนเป็นอย่างไร"],
    ["P3-12-TH-ISO-DATE", "ขอแก้ไขข้อมูล: เหตุการณ์รับชำระราคาและออกใบกำกับภาษีวันที่ 2026-09-30 เป็นของล็อต B เท่านั้น ข้อเท็จจริงอื่นทั้งหมดคงเดิม"],
    ["P3-13-EN-ISO-DATE", "Correction: the payment and tax invoice on 2026-09-30 covered Lot B exclusively (not Lot A). All other facts are unchanged."],
    ["P3-14-TH-REASSIGN", "ขอแก้ให้การรับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569 ย้ายจากล็อต A ไปเป็นของล็อต B เท่านั้น ส่วนวันโอนกรรมสิทธิ์ล็อต A และวันส่งมอบทุกล็อตคงเดิม"],
    ["P3-15-EN-REASSIGN", "Reassign the 30 September payment and tax invoice from Lot A to Lot B only. Keep Lot A's 29 September title transfer and all 2 October events unchanged."],
    ["P3-16-MIXED-SHORT", "แก้เป็น 30 ก.ย. 69 payment และใบกำกับภาษี covered lot B only (ไม่ใช่ล็อต A) ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด"],
  ];

  for (const [id, r3Prompt] of p3R3Prompts) {
    cases.push({
      id,
      category: "paraphrase_p3",
      source: "D3 synthetic paraphrase of DEF-C11-2 r3 Lot B correction",
      turns: [
        {
          turn_id: "r1",
          turn_mode: "fresh",
          prompt: R1_BASE_TH,
          expected: { status_in: ["ANSWERED"], min_claims: 2 },
        },
        {
          turn_id: "r2",
          turn_mode: "same",
          prompt: R2_BASE_TH,
          expected: { status_in: ["ANSWERED"], min_claims: 2 },
        },
        {
          turn_id: "r3",
          turn_mode: "fresh_tab_reopen",
          prompt: r3Prompt,
          expected: {
            status_in: ["ANSWERED"],
            min_claims: 2,
            require_fact_delta_change: true,
            expected_lots: LOTS_A_29SEP_B_30SEP_C_2OCT,
          },
        },
      ],
    });
  }

  // ==========================================================================
  // FIXTURE P4: Negated Boundary + Short Dates (1 Oct or 5 Nov RD 807 ฿3,500, zero phantom events) — 16 variants
  // ==========================================================================
  const p4NegPrompts: Array<[string, string, string[], string[]]> = [
    ["P4-01-TH-NEG-AFTER", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศ 50,000 บาทก่อน VAT โอนกรรมสิทธิ์และส่งมอบทั้งหมดวันที่ 1 ตุลาคม 2569 ออกใบกำกับภาษีวันที่ 2 ตุลาคม 2569 และรับชำระราคาวันที่ 3 ตุลาคม 2569 โดยไม่มีการโอนกรรมสิทธิ์ รับชำระราคา หรือออกใบกำกับภาษีใดๆ ก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด พ.ร.ฎ. และ VAT คือเท่าใด", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-02-TH-NEG-BEFORE", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศ 50,000 บาทก่อน VAT ก่อนวันที่ 1 ตุลาคม 2569 ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีใดๆ ทั้งสิ้น ต่อมาโอนกรรมสิทธิ์และส่งมอบวันที่ 1 ตุลาคม 2569 ออกใบกำกับภาษีวันที่ 2 ตุลาคม 2569 และรับชำระเงินวันที่ 3 ตุลาคม 2569 วันเกิดความรับผิดและ VAT คือเท่าใด", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-03-EN-NEG-AFTER", "A VAT-registered Thai seller sells domestic goods for 50,000 THB before VAT. Title transfer and delivery occur on 1 October 2026, the tax invoice is issued on 2 October 2026, and full payment is received on 3 October 2026, with no ownership transfer, payment, or tax invoice before 1 October 2026. What are the VAT tax point, Royal Decree, and VAT amount?", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-04-EN-NEG-BEFORE", "A VAT-registered Thai seller makes a 50,000 THB (before VAT) domestic sale of goods. No invoice, payment, or title transfer took place prior to 1 October 2026. Ownership transferred and goods were delivered on 1 October 2026, the tax invoice was issued on 2 October 2026, and payment was received on 3 October 2026. Determine the tax point, Royal Decree, and VAT.", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-05-MIXED-NEG", "บริษัทจดทะเบียน VAT ขายสินค้าในประเทศ 50,000 บาท (before VAT) โอนกรรมสิทธิ์และส่งมอบวันที่ 1 October 2026, issue tax invoice วันที่ 2 October 2026 และรับชำระเงินวันที่ 3 October 2026 (no invoice or payment before 1 October 2026) วันเกิดความรับผิด พ.ร.ฎ. และ VAT คือเท่าใด", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-06-TH-DIGITS-NEG", "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศ ๕๐,๐๐๐ บาทก่อน VAT โอนกรรมสิทธิ์และส่งมอบสินค้าทั้งหมดวันที่ ๑ ตุลาคม ๒๕๖๙ ออกใบกำกับภาษีวันที่ ๒ ตุลาคม ๒๕๖๙ และรับชำระราคาเต็มจำนวนวันที่ ๓ ตุลาคม ๒๕๖๙ โดยไม่มีการรับชำระราคาหรือออกใบกำกับภาษีก่อนวันที่ ๑ ตุลาคม ๒๕๖๙ วันเกิดความรับผิดและ VAT คือเท่าใด", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-07-SHORT-DATE-NEG", "บริษัทจด VAT ขายสินค้าในไทย 50,000 บาทก่อน VAT โอนกรรมสิทธิ์และส่งมอบวันที่ 1 ต.ค. 69 ออกใบกำกับภาษีวันที่ 2 ต.ค. 69 และรับชำระเงินวันที่ 3 ต.ค. 69 โดยไม่มีการออกใบกำกับภาษีหรือรับเงินก่อน 1 ต.ค. 69 ต้องคิด VAT เท่าไร ตาม พ.ร.ฎ. ฉบับใด", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-08-SWAPPED-CLAUSE-NEG", "บริษัทจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศราคา 50,000 บาทก่อน VAT โดยได้รับชำระเงินวันที่ 3 ตุลาคม 2569 และออกใบกำกับภาษีวันที่ 2 ตุลาคม 2569 ทั้งนี้ไม่มีการโอนกรรมสิทธิ์ รับเงิน หรือออกใบกำกับภาษีก่อนวันที่ 1 ตุลาคม 2569 ซึ่งมีการโอนกรรมสิทธิ์และส่งมอบสินค้าทั้งหมดเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดและ VAT คือเท่าใด", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-09-SHORT-5NOV69-TH", "บริษัทจดทะเบียน VAT ขายสินค้าทั่วไปในประเทศ 50,000 บาทก่อน VAT ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ 5 พ.ย. 69 ไม่มีการกระทำใดก่อนหน้านั้น ต้องคิด VAT กี่บาท ตาม พ.ร.ฎ. ฉบับใด", ["807", "3,500", "2026-11-05|5 พฤศจิกายน 2569|5 พ\\.ย\\. 69"], []],
    ["P4-10-SHORT-5NOV69-THDIG", "ร้านค้าจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในไทยมูลค่า ๕๐,๐๐๐ บาทก่อนภาษีมูลค่าเพิ่ม ส่งมอบสินค้าพร้อมออกใบกำกับภาษีเมื่อวันที่ ๕ พ.ย. ๖๙ ไม่มีเหตุการณ์ก่อนหน้า ต้องเรียกเก็บ VAT เท่าไร ใช้ พ.ร.ฎ. ฉบับใด", ["807", "3,500", "2026-11-05|5 พฤศจิกายน 2569|5 พ\\.ย\\. 69"], []],
    ["P4-11-LONG-5NOV-EN", "A VAT-registered Thai business sells domestic goods for 50,000 THB before VAT, delivering the goods and issuing the tax invoice on 5 November 2026 with no prior payment or title transfer. Which Royal Decree applies and what is the VAT?", ["807", "3,500", "2026-11-05|5 พฤศจิกายน 2569|5 November 2026"], []],
    ["P4-12-ISO-NEG", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศ 50,000 บาทก่อน VAT โอนกรรมสิทธิ์และส่งมอบวันที่ 2026-10-01 ออกใบกำกับภาษีวันที่ 2026-10-02 รับชำระเงินวันที่ 2026-10-03 โดยไม่มีใบกำกับภาษีหรือการชำระเงินก่อนวันที่ 2026-10-01 วันเกิดความรับผิด พ.ร.ฎ. และ VAT คือเท่าใด", ["807", "3,500"], ["PAYMENT:[^·\\n]*2026-10-01", "INVOICE:[^·\\n]*2026-10-01"]],
    ["P4-13-EARLY-TITLE-EN", "An ordinary domestic sale of goods by a VAT-registered seller in Thailand totals 50,000 THB before VAT. Full ownership transfers on 30 September 2026, while delivery, full payment, and tax invoice issuance all take place on 1 October 2026 with no earlier payment or invoice. What is the VAT tax point, Royal Decree, and VAT amount?", ["799", "3,500", "2026-09-30|30 กันยายน 2569"], []],
    ["P4-14-EARLY-TITLE-SHORT", "บริษัทจด VAT ขายสินค้าในไทย 50,000 บาทก่อน VAT โอนกรรมสิทธิ์ทั้งหมดวันที่ 30 ก.ย. 69 ส่วนส่งมอบ รับเงิน และออกใบกำกับภาษีทำพร้อมกันวันที่ 1 ต.ค. 69 (ไม่มีรับเงินหรือใบกำกับภาษีก่อนหน้านั้น) วันเกิดความรับผิด พ.ร.ฎ. และ VAT คือเท่าไร", ["799", "3,500", "2026-09-30|30 กันยายน 2569"], []],
    ["P4-15-EARLY-TITLE-THDIG", "ผู้ประกอบการจดทะเบียน VAT ขายสินค้าทั่วไปในประเทศ ๕๐,๐๐๐ บาทก่อน VAT โอนกรรมสิทธิ์ทั้งหมดให้ผู้ซื้อเมื่อวันที่ ๓๐ กันยายน ๒๕๖๙ ส่วนการส่งมอบสินค้า การรับชำระราคาเต็มจำนวน และการออกใบกำกับภาษีเกิดขึ้นพร้อมกันวันที่ ๑ ตุลาคม ๒๕๖๙ วันเกิดความรับผิด พ.ร.ฎ. และ VAT คือเท่าใด", ["799", "3,500", "2026-09-30|30 กันยายน 2569"], []],
    ["P4-16-EARLY-TITLE-MIXED", "ผู้ขายจดทะเบียน VAT ขายสินค้าในประเทศ 50,000 บาท (excl. VAT) โดย full ownership transferred วันที่ 30 September 2026 แต่ delivery, payment และ tax invoice เกิดขึ้นวันที่ 1 October 2026 ทั้งหมด (no earlier payment or invoice) วันเกิดความรับผิด พ.ร.ฎ. และ VAT เป็นเท่าใด", ["799", "3,500", "2026-09-30|30 กันยายน 2569"], []],
  ];

  for (const [id, prompt, mustContain, mustNotContain] of p4NegPrompts) {
    cases.push({
      id,
      category: "paraphrase_p4",
      source: "D3 synthetic paraphrase of SF-C9-3A / short-date / early-title controls",
      turns: [
        {
          turn_id: "r1",
          turn_mode: "fresh",
          prompt,
          expected: {
            status_in: ["ANSWERED"],
            min_claims: 1,
            expected_tax_amounts_thb: [3500],
            must_contain_regex: mustContain,
            ...(mustNotContain.length > 0 ? { must_not_contain_regex: mustNotContain } : {}),
          },
        },
      ],
    });
  }

  return {
    suite_id: "reg24-c12-d3-paraphrase-suite",
    suite_version: "1.0.0",
    non_sealed_attestation:
      "100% synthetic non-sealed VAT allocation paraphrase suite (64 variants = 16 per fixture across P1..P4). Strictly separate from the sealed 22; never derived from sealed prompts.",
    cases,
  };
}

function serializeYamlString(s: string): string {
  return JSON.stringify(s);
}

function renderSuiteToYaml(suite: ReplaySuiteFile): string {
  const out: string[] = [
    "# REG24 Candidate 12 — Workstream D3 Frozen Synthetic Paraphrase Suite (64 variants = 16 x 4 VAT fixtures)",
    "# Generated deterministically by scripts/qa/generate-c12-paraphrases.ts",
    "# STRICTLY NON-SEALED: zero overlap with or derivation from the sealed 22.",
    "",
    `suite_id: ${serializeYamlString(suite.suite_id)}`,
    `suite_version: ${serializeYamlString(suite.suite_version)}`,
    `non_sealed_attestation: ${serializeYamlString(suite.non_sealed_attestation)}`,
    "",
    "cases:",
  ];

  for (const c of suite.cases) {
    out.push(`  - id: ${serializeYamlString(c.id)}`);
    out.push(`    category: ${serializeYamlString(c.category)}`);
    out.push(`    source: ${serializeYamlString(c.source)}`);
    out.push("    turns:");
    for (const t of c.turns) {
      out.push(`      - turn_id: ${serializeYamlString(t.turn_id)}`);
      out.push(`        turn_mode: ${serializeYamlString(t.turn_mode)}`);
      out.push(`        prompt: ${serializeYamlString(t.prompt)}`);
      out.push("        expected:");
      out.push(`          status_in: ${JSON.stringify(t.expected.status_in)}`);
      if (typeof t.expected.min_claims === "number") {
        out.push(`          min_claims: ${t.expected.min_claims}`);
      }
      if (t.expected.require_fact_delta_change) {
        out.push(`          require_fact_delta_change: true`);
      }
      if (t.expected.expected_tax_amounts_thb) {
        out.push(`          expected_tax_amounts_thb: ${JSON.stringify(t.expected.expected_tax_amounts_thb)}`);
      }
      if (t.expected.must_contain_regex) {
        out.push(`          must_contain_regex: ${JSON.stringify(t.expected.must_contain_regex)}`);
      }
      if (t.expected.must_not_contain_regex) {
        out.push(`          must_not_contain_regex: ${JSON.stringify(t.expected.must_not_contain_regex)}`);
      }
      if (t.expected.expected_lots && t.expected.expected_lots.length > 0) {
        out.push("          expected_lots:");
        for (const lot of t.expected.expected_lots) {
          out.push(`            - label: ${serializeYamlString(lot.label)}`);
          out.push(`              date_iso: ${serializeYamlString(lot.date_iso)}`);
          out.push(`              decree_num: ${serializeYamlString(lot.decree_num)}`);
          out.push(`              base_thb: ${lot.base_thb}`);
          out.push(`              vat_thb: ${lot.vat_thb}`);
        }
      }
    }
  }
  out.push("");
  return out.join("\n");
}

const suite = buildParaphraseSuite();
const yamlText = renderSuiteToYaml(suite);
const targetPath = path.resolve(process.cwd(), "scripts/qa/c12-paraphrase-suite.yaml");
fs.writeFileSync(targetPath, yamlText, "utf8");
const sha256 = crypto.createHash("sha256").update(yamlText, "utf8").digest("hex");
console.log(`Generated ${targetPath} (${suite.cases.length} cases, sha256=${sha256})`);
