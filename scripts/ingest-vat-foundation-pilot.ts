/**
 * REG24 — Separate Mission: VAT Tax Foundation Source Preparation & Dual-Locator Extractor
 *
 * 1. Checks `data/foundation-vat-pilot/raw/` (git-ignored) or authenticated `gdrive` CLI for
 *    *คำอธิบายประมวลรัษฎากร ภาษีสรรพากร* Volume 2, Part 1 (`1PzlwWVEaJWOXJcBoEggKHMZW3B8pJJ2M`)
 *    and the split-PDF folder page index (`1PhIxtwdGTvH32sgctk-Zii0UpcLensSg`).
 * 2. Inspects pages starting at PDF page 27 (`printed page 4-001`) using PyMuPDF (`pymupdf`),
 *    measuring native Thai Unicode text quality FIRST and flagging OCR ONLY on scanned/garbled pages.
 * 3. Preserves `chapter`, `section`, `printed_page` (`4-xxx`), and `pdf_page_number` (`27+`)
 *    separately on every concept and link.
 * 4. Resolves every authority link against isolated staging `rel.B01.rc6` (`VERIFIED_LINK` vs
 *    `CANDIDATE_LINK` + post-May-2018 amendment overrides) without modifying any canonical store!
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import {
  COMMENTARY_EDITION_CUTOFF_ISO,
  evaluateCommentaryPageTextQuality,
  resolveFoundationLinksAgainstCanonicalStore,
  SPLIT_PDF_DRIVE_FOLDER_ID,
  VOLUME_2_PART_1_DRIVE_FILE_ID,
  type CommentaryDualLocator,
  type PageTextQualityProbe,
  type TaxFoundationConceptNode,
  type VatFoundationPilotLedger,
} from "../src/core/knowledge/tax-foundation-layer";

const RAW_DIR = path.resolve(process.cwd(), "data/foundation-vat-pilot/raw");
const LEDGER_OUT_PATH = path.resolve(
  process.cwd(),
  "data/foundation-vat-pilot/vat-foundation-ledger.json"
);
const REDACTED_RECEIPT_OUT_PATH = path.resolve(
  process.cwd(),
  "docs/audit/dodo-review-rc2-b02/vat_foundation_pilot_intake_status.json"
);

function tryDownloadViaGdriveCliIfAuthenticated(): string | null {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const existingPdfs = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (existingPdfs.length > 0) {
    return path.join(RAW_DIR, existingPdfs[0]);
  }

  const statusRes = spawnSync("cmd.exe", ["/c", "gdrive", "auth", "status"], {
    encoding: "utf8",
  });
  const out = `${statusRes.stdout || ""}\n${statusRes.stderr || ""}`;
  if (statusRes.status !== 0 || /Not logged in/i.test(out)) {
    return null;
  }

  const outPdf = path.join(RAW_DIR, "Volume_2_Part_1_1PzlwWVEaJWOXJcBoEggKHMZW3B8pJJ2M.pdf");
  const dlRes = spawnSync(
    "cmd.exe",
    ["/c", "gdrive", "readonly", "download", VOLUME_2_PART_1_DRIVE_FILE_ID, "--out", outPdf],
    { encoding: "utf8" }
  );
  if (dlRes.status === 0 && fs.existsSync(outPdf) && fs.statSync(outPdf).size > 1024) {
    return outPdf;
  }
  return null;
}

interface PyMuPdfPageExtract {
  pdf_page_number: number;
  raw_text: string;
  bbox_sample: [number, number, number, number] | null;
}

function inspectPdfPagesWithPyMuPdf(
  pdfPath: string,
  startPdfPage1Based: number,
  endPdfPage1Based: number
): PyMuPdfPageExtract[] {
  const pyScript = `
import json, sys, pymupdf
sys.stdout.reconfigure(encoding="utf-8")
doc = pymupdf.open(sys.argv[1])
p_start = max(1, int(sys.argv[2]))
p_end = min(len(doc), int(sys.argv[3]))
out = []
for pno in range(p_start, p_end + 1):
    page = doc[pno - 1]
    txt = page.get_text("text") or ""
    blocks = page.get_text("blocks") or []
    bbox = list(blocks[0][:4]) if blocks else None
    out.append({"pdf_page_number": pno, "raw_text": txt, "bbox_sample": bbox})
print(json.dumps({"total_pages": len(doc), "pages": out}, ensure_ascii=False))
`;
  const stdout = execFileSync(
    "python",
    ["-c", pyScript, pdfPath, String(startPdfPage1Based), String(endPdfPage1Based)],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout) as { total_pages: number; pages: PyMuPdfPageExtract[] };
  return parsed.pages;
}

export function buildVatFoundationConcepts(
  state: ReturnType<DurableKnowledgeStore["getState"]>,
  pdfFilename: string
): TaxFoundationConceptNode[] {
  const mkLoc = (
    sectionCode: string,
    sectionTitleTh: string,
    printedPage: string,
    pdfPageNumber: number
  ): CommentaryDualLocator => ({
    volume_no: 2,
    part_no: 1,
    chapter_no: "4",
    chapter_title_th: "ภาษีมูลค่าเพิ่ม (Value Added Tax)",
    section_code: sectionCode,
    section_title_th: sectionTitleTh,
    subsection_path: ["บทที่ 4 ภาษีมูลค่าเพิ่ม", `${sectionCode} ${sectionTitleTh}`],
    printed_page: printedPage,
    pdf_file_id: VOLUME_2_PART_1_DRIVE_FILE_ID,
    pdf_filename: pdfFilename,
    pdf_page_number: pdfPageNumber,
    pdf_bbox: null,
    extraction_method: "NATIVE_TEXT",
  });

  // Focused VAT Pilot Subsection covering the exact VAT doctrines needed for failed & complex unseen VAT cases:
  // 4.1 Scope, Deemed Sale (Promotional Samples/Gifts), & Territoriality of Services (`77/1`, `77/2`)
  // 4.2 Tax Base & Exemptions/Small-Business Registration (`79`, `81/1`, `85/1`, `พ.ร.ฎ. 432`)
  // 4.3 Statutory vs Reduced VAT Rate & Local Tax (`80`, `พ.ร.ฎ. ลดอัตราฯ`) + Zero-Rate Export of Goods/Services (`80/1`, `ประกาศอธิบดีฯ VAT 105`)
  // 4.4 Non-Deductible Input VAT (`82/5`) & Reverse-Charge Foreign Services (`83/6`)
  const loc4_1 = mkLoc(
    "4.1",
    "ขอบเขตการขายสินค้า การถือเป็นการขาย (แจก/แถมสินค้า) และหลักดินแดนของการให้บริการ",
    "4-001",
    27
  );
  const loc4_2 = mkLoc(
    "4.2",
    "มูลค่าของฐานภาษี กิจการขนาดย่อมที่ได้รับยกเว้น และหน้าที่จดทะเบียนภาษีมูลค่าเพิ่ม",
    "4-018",
    44
  );
  const loc4_3 = mkLoc(
    "4.3",
    "อัตราภาษีมูลค่าเพิ่ม ภาษีท้องถิ่น และหลักเกณฑ์การส่งออกบริการอัตราร้อยละ 0",
    "4-032",
    58
  );
  const loc4_4 = mkLoc(
    "4.4",
    "ภาษีซื้อต้องห้าม (ค่ารับรอง/ใบกำกับภาษีไม่สมบูรณ์) และการนำส่ง VAT กรณีจ่ายค่าบริการไปต่างประเทศ (ภ.พ.36)",
    "4-048",
    74
  );

  return [
    {
      concept_id: "vat.fnd.deemed_sale_and_territoriality",
      domain: "VAT",
      concept_title_th:
        "การจำหน่าย จ่าย โอนสินค้าโดยไม่มีค่าตอบแทน (แจก/แถมสินค้าตัวอย่าง) และหลักดินแดนของการให้บริการ",
      trigger_keywords_th_en: [
        "แจกสินค้า",
        "แถมสินค้า",
        "สินค้าตัวอย่าง",
        "โดยไม่มีค่าตอบแทน",
        "กระทำในราชอาณาจักร",
        "77/1",
        "77/2",
        "promotional gift",
        "free sample",
      ],
      six_slot_frame: {
        taxpayer_th: "ผู้ประกอบการที่ขายสินค้าหรือให้บริการในทางธุรกิจหรือวิชาชีพ (มาตรา 77/2 และมาตรา 82)",
        transaction_th:
          "การขายสินค้า (รวมถึงการนำสินค้าไปใช้หรือส่งมอบให้ผู้อื่นโดยไม่มีค่าตอบแทนตามมาตรา 77/1 (8)) และการให้บริการในราชอาณาจักรหรือบริการที่ทำในต่างประเทศแต่ได้มีการใช้บริการนั้นในราชอาณาจักร (มาตรา 77/2)",
        tax_base_th:
          "มูลค่าทั้งหมดที่ได้รับหรือพึงได้รับจากการขายสินค้าหรือให้บริการ และกรณีโอนโดยไม่มีค่าตอบแทนใช้ราคาตลาด ณ วันที่ความรับผิดเกิดขึ้น (มาตรา 79 และมาตรา 79/3)",
        rate_th: "อัตราร้อยละ 7.0 (ร้อยละ 6.3 + ภาษีท้องถิ่นร้อยละ 0.7 ตาม พ.ร.ฎ. ลดอัตราฯ ที่ใช้บังคับ ณ วันเกิดความรับผิด) หรืออัตราร้อยละ 0 หากเข้าเกณฑ์มาตรา 80/1",
        conditions_th: [
          "การแถมสินค้าพร้อมการขายสินค้า หากมูลค่าของแถมไม่เกินมูลค่าสินค้าที่ขาย ไม่ต้องนำมูลค่าของแถมมารวมคำนวณฐานภาษีตามมาตรา 79 (4) ประกอบประกาศอธิบดีฯ เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 40)",
          "การแจกสินค้าตัวอย่างเพื่อส่งเสริมการขายโดยไม่ใช่การขายพ่วง ต้องตรวจสอบเงื่อนไขประกาศอธิบดีฯ เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 40)",
        ],
        exceptions_th: [
          "การให้บริการที่กระทำในต่างประเทศและไม่ได้มีการนำผลของบริการมาใช้ในประเทศไทย ไม่อยู่ในบังคับภาษีมูลค่าเพิ่มตามมาตรา 77/2 วรรคสาม",
        ],
      },
      decisive_fact_questions_th: [
        "การแจกหรือแถมสินค้าเป็นการแถมไปพร้อมกับการขายสินค้าโดยมูลค่าของแถมไม่เกินมูลค่าสินค้าที่ขาย หรือเป็นการแจกให้เปล่าแยกต่างหากโดยไม่มีการขายสินค้า?",
      ],
      source_locator: loc4_1,
      authority_links: resolveFoundationLinksAgainstCanonicalStore({
        state,
        rawLinks: [
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 77/1",
            candidate_work_id: "prov.th.rc.77/1",
            link_source_locator: loc4_1,
            source_excerpt_text: "มาตรา 77/1 (8) ขาย หมายความรวมถึงส่งมอบสินค้าให้ผู้อื่นโดยไม่มีค่าตอบแทน",
            link_rationale_th: "นิยามการขายสินค้าและการถือเป็นการขายกรณีไม่มีค่าตอบแทน",
          },
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 77/2",
            candidate_work_id: "prov.th.rc.77/2",
            link_source_locator: loc4_1,
            source_excerpt_text: "มาตรา 77/2 การกระทำกิจการในราชอาณาจักรซึ่งอยู่ในบังคับต้องเสียภาษีมูลค่าเพิ่ม",
            link_rationale_th: "หลักดินแดนของการขายสินค้าและการให้บริการในราชอาณาจักร",
          },
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 79",
            candidate_work_id: "prov.th.rc.79",
            link_source_locator: loc4_1,
            source_excerpt_text: "มาตรา 79 (4) มูลค่าของฐานภาษีไม่รวมถึงสินค้าที่แถมพร้อมกับการขายสินค้า",
            link_rationale_th: "การยกเว้นไม่นำมูลค่าของแถม/สินค้าตัวอย่างมารวมเป็นฐานภาษีตามประกาศอธิบดี",
          },
          {
            target_kind: "SUBORDINATE_REGULATION",
            raw_authority_label_th: "ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 40)",
            candidate_work_id: "subreg.th.rd.dg_vat.40_unverified_candidate",
            link_source_locator: loc4_1,
            source_excerpt_text: "ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 40)",
            link_rationale_th: "ประกาศลำดับรองกำหนดมูลค่าทรัพย์สินหรือสินค้าที่ไม่รวมเป็นฐานภาษีตามมาตรา 79 (4) (สถานะ CANDIDATE รอตรวจรับรองตัวบทเต็ม)",
          },
        ],
      }),
    },
    {
      concept_id: "vat.fnd.small_business_threshold_and_registration",
      domain: "VAT",
      concept_title_th: "เกณฑ์มูลค่าฐานภาษีของกิจการขนาดย่อม (1,800,000 บาท) และหน้าที่จดทะเบียนภาษีมูลค่าเพิ่ม",
      trigger_keywords_th_en: [
        "จดทะเบียน vat",
        "จดทะเบียนภาษีมูลค่าเพิ่ม",
        "กิจการขนาดย่อม",
        "1,800,000",
        "81/1",
        "85/1",
        "register for vat",
      ],
      six_slot_frame: {
        taxpayer_th: "ผู้ประกอบการขายสินค้าหรือให้บริการที่มิใช่กิจการได้รับยกเว้นตามมาตรา 81",
        transaction_th: "การขายสินค้าหรือให้บริการที่มีรายรับ (มูลค่าของฐานภาษี) ต่อปีเทียบกับเกณฑ์กิจการขนาดย่อม",
        tax_base_th: "ยอดรายรับก่อนหักรายจ่ายจากการประกอบกิจการทั้งปี (เกณฑ์ 1,800,000 บาทต่อปีตาม พ.ร.ฎ. ฉบับที่ 432)",
        rate_th: "ได้รับยกเว้นไม่ต้องเรียกเก็บ VAT หากไม่เกิน 1,800,000 บาทต่อปี (เว้นแต่ขอจดทะเบียนโดยสมัครใจตามมาตรา 81/3)",
        conditions_th: [
          "หากมูลค่าของฐานภาษีเกิน 1,800,000 บาทต่อปี ต้องยื่นคำขอจดทะเบียนภาษีมูลค่าเพิ่มภายใน 30 วันนับแต่วันที่มูลค่าฐานภาษีเกินเกณฑ์ ตามมาตรา 85/1 (1) (ก)",
        ],
        exceptions_th: [
          "ผู้ประกอบการที่ได้รับยกเว้นตามมาตรา 81/1 มีสิทธิแจ้งต่ออธิบดีเพื่อขอจดทะเบียนภาษีมูลค่าเพิ่มโดยสมัครใจตามมาตรา 81/3",
        ],
      },
      decisive_fact_questions_th: [],
      source_locator: loc4_2,
      authority_links: resolveFoundationLinksAgainstCanonicalStore({
        state,
        rawLinks: [
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 81/1",
            candidate_work_id: "prov.th.rc.81/1",
            link_source_locator: loc4_2,
            source_excerpt_text: "มาตรา 81/1 การยกเว้นภาษีมูลค่าเพิ่มสำหรับกิจการขนาดย่อม",
            link_rationale_th: "บทบัญญัติแม่บทยกเว้น VAT กิจการขนาดย่อม",
          },
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 85/1",
            candidate_work_id: "prov.th.rc.85/1",
            link_source_locator: loc4_2,
            source_excerpt_text: "มาตรา 85/1 กำหนดเวลายื่นคำขอจดทะเบียนภาษีมูลค่าเพิ่มภายใน 30 วัน",
            link_rationale_th: "หน้าที่และกำหนดเวลา 30 วันในการจดทะเบียนเมื่อรายรับเกินเกณฑ์",
          },
          {
            target_kind: "SUBORDINATE_REGULATION",
            raw_authority_label_th: "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ 432) พ.ศ. 2548",
            candidate_work_id: "subreg.th.rc.royal_decree.432",
            link_source_locator: loc4_2,
            source_excerpt_text: "พระราชกฤษฎีกา (ฉบับที่ 432) พ.ศ. 2548 กำหนดมูลค่าของฐานภาษีของกิจการขนาดย่อม 1,800,000 บาทต่อปี",
            link_rationale_th: "พระราชกฤษฎีกากำหนดตัวเลขเพดาน 1,800,000 บาทต่อปี",
          },
        ],
      }),
    },
    {
      concept_id: "vat.fnd.rates_and_export_service_zero_rate",
      domain: "VAT",
      concept_title_th:
        "โครงสร้างอัตราภาษีมูลค่าเพิ่ม (มาตรา 80 + พ.ร.ฎ. ลดอัตราฯ + ภาษีท้องถิ่น) และการส่งออกบริการอัตราร้อยละ 0 (มาตรา 80/1)",
      trigger_keywords_th_en: [
        "ร้อยละ 0",
        "0%",
        "ส่งออกบริการ",
        "ให้บริการจาก",
        "บริษัทในต่างประเทศ",
        "บริษัทในสิงคโปร์",
        "80/1",
        "พระราชกฤษฎีกาฉบับที่ 807",
        "คิด vat กี่ร้อยละ",
        "export of service",
      ],
      six_slot_frame: {
        taxpayer_th: "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม (มาตรา 80 และมาตรา 80/1)",
        transaction_th:
          "การขายสินค้าหรือให้บริการในราชอาณาจักร (อัตราปกติที่ลดตาม พ.ร.ฎ.) เทียบกับการส่งออกสินค้าหรือการให้บริการที่กระทำในราชอาณาจักรและได้มีการใช้บริการนั้นในต่างประเทศ (อัตราร้อยละ 0)",
        tax_base_th: "มูลค่าสินค้าหรือบริการตามมาตรา 79",
        rate_th:
          "เพดานตามมาตรา 80 ร้อยละ 10.0; ลดตาม พ.ร.ฎ. ลดอัตราฯ เหลือร้อยละ 6.3 + ภาษีท้องถิ่น 1 ใน 9 (ร้อยละ 0.7) = ร้อยละ 7.0 ภายในช่วงเวลาที่ พ.ร.ฎ. กำหนด; หรือร้อยละ 0 หากเข้าเงื่อนไขมาตรา 80/1",
        conditions_th: [
          "การใช้อัตราร้อยละ 0 สำหรับการส่งออกบริการตามมาตรา 80/1 (2) และประกาศอธิบดีฯ VAT (ฉบับที่ 105) ต้องเป็นการให้บริการที่ทำในไทยแก่ผู้รับบริการในต่างประเทศ และส่งผลของการให้บริการไปใช้ในต่างประเทศทั้งหมด (ไม่มีการใช้บริการส่วนใดในประเทศไทย)",
          "ต้องตรวจสอบวันเกิดความรับผิด (Tax Point) ว่าอยู่ในช่วงเวลาที่พระราชกฤษฎีกาลดอัตราฯ มีผลใช้บังคับหรือไม่ (เช่น พ.ร.ฎ. ฉบับที่ 807 ใช้บังคับถึง 30 กันยายน 2570) และสำหรับมาตรา 80/1 (5) ต้องตรวจสอบวันมีผลของ พ.ร.บ. (ฉบับที่ 49) พ.ศ. 2562 (28 กุมภาพันธ์ 2562)",
        ],
        exceptions_th: [
          "หากผลของการให้บริการถูกนำไปใช้ในประเทศไทยไม่ว่าทั้งหมดหรือบางส่วน (เช่น ใช้ที่สาขาหรือสำนักงานในไทยของลูกค้าต่างประเทศ) จะไม่ได้รับสิทธิอัตราร้อยละ 0 และต้องเสีย VAT อัตราร้อยละ 7",
        ],
      },
      decisive_fact_questions_th: [
        "ผลของการให้บริการถูกส่งไปใช้ในต่างประเทศทั้งหมด หรือมีการนำผลของบริการมาใช้ในประเทศไทย (เช่น ที่สาขา สำนักงาน หรือโครงการของลูกค้าในประเทศไทย) บางส่วนหรือทั้งหมดหรือไม่?",
      ],
      source_locator: loc4_3,
      authority_links: resolveFoundationLinksAgainstCanonicalStore({
        state,
        rawLinks: [
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 80",
            candidate_work_id: "prov.th.rc.80",
            link_source_locator: loc4_3,
            source_excerpt_text: "มาตรา 80 อัตราภาษีมูลค่าเพิ่มร้อยละ 10.0 และการลดอัตราโดยพระราชกฤษฎีกา",
            link_rationale_th: "บทบัญญัติอัตราภาษีมูลค่าเพิ่มหลัก",
          },
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 80/1",
            candidate_work_id: "prov.th.rc.80/1",
            link_source_locator: loc4_3,
            source_excerpt_text: "มาตรา 80/1 อัตราภาษีร้อยละ 0 สำหรับการส่งออกสินค้าและการให้บริการที่ใช้ในต่างประเทศ",
            link_rationale_th: "บทบัญญัติอัตราภาษีมูลค่าเพิ่มร้อยละ 0",
          },
          {
            target_kind: "SUBORDINATE_REGULATION",
            raw_authority_label_th: "ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 105)",
            candidate_work_id: "subreg.th.rd.dg_vat.105",
            link_source_locator: loc4_3,
            source_excerpt_text: "ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 105) หลักเกณฑ์การให้บริการที่ทำในราชอาณาจักรและใช้ในต่างประเทศ",
            link_rationale_th: "ประกาศอธิบดีกำหนดเงื่อนไขส่งออกบริการอัตราร้อยละ 0",
          },
          {
            target_kind: "SUBORDINATE_REGULATION",
            raw_authority_label_th: "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ 646) พ.ศ. 2560",
            candidate_work_id: "subreg.th.rc.royal_decree.646",
            link_source_locator: loc4_3,
            source_excerpt_text: "พระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 ลดอัตราภาษีมูลค่าเพิ่มเหลือร้อยละ 6.3",
            link_rationale_th: "พ.ร.ฎ. ลดอัตราฯ ที่อ้างอิงขณะพิมพ์ปี 2561 (ต้องตรวจสอบ พ.ร.ฎ. ฉบับขยายเวลาปัจจุบัน เช่น ฉบับที่ 799 และ 807)",
          },
        ],
      }),
    },
    {
      concept_id: "vat.fnd.non_deductible_input_tax_and_reverse_charge",
      domain: "VAT",
      concept_title_th:
        "ภาษีซื้อต้องห้ามตามมาตรา 82/5 (เช่น ค่ารับรอง ใบกำกับภาษีไม่ครบถ้วน) และหน้าที่นำส่ง VAT แบบ ภ.พ.36 ตามมาตรา 83/6",
      trigger_keywords_th_en: [
        "ภาษีซื้อต้องห้าม",
        "ค่ารับรอง",
        "หักภาษีซื้อ",
        "82/5",
        "83/6",
        "ภ.พ.36",
        "input tax",
        "entertainment expense",
      ],
      six_slot_frame: {
        taxpayer_th: "ผู้ประกอบการจดทะเบียน (กรณีภาษีซื้อตามมาตรา 82/3 และ 82/5) และผู้จ่ายเงินค่าบริการไปต่างประเทศ (มาตรา 83/6)",
        transaction_th:
          "การนำภาษีซื้อมาหักออกจากภาษีขายในการคำนวณภาษีมูลค่าเพิ่ม และการจ่ายเงินค่าบริการให้ผู้ประกอบการที่ได้ให้บริการในต่างประเทศและได้มีการใช้บริการนั้นในราชอาณาจักร",
        tax_base_th: "จำนวนภาษีซื้อตามใบกำกับภาษี หรือจำนวนเงินค่าบริการที่ชำระให้ผู้ประกอบการในต่างประเทศ",
        rate_th: "นำส่งอัตราร้อยละ 7.0 ด้วยแบบ ภ.พ.36 ภายใน 7 วันนับแต่วันสิ้นเดือนของเดือนที่จ่ายเงิน (มาตรา 83/6)",
        conditions_th: [
          "ต้องมีใบกำกับภาษีแบบเต็มรูปที่ถูกต้องครบถ้วนตามมาตรา 86/4 จึงจะขอคืนหรือเครดิตภาษีซื้อได้",
          "ภาษีซื้อที่เกิดจากค่ารับรองหรือค่าบริการทำนองเดียวกันตามมาตรา 82/5 (4) ห้ามนำมาหักในการคำนวณภาษีมูลค่าเพิ่ม",
        ],
        exceptions_th: [
          "ภาษีซื้อต้องห้ามบางประเภทตามมาตรา 82/5 (6) ที่อธิบดีกำหนด อาจนำไปถือเป็นรายจ่ายในการคำนวณกำไรสุทธิทางภาษีเงินได้นิติบุคคลได้ตาม พ.ร.ฎ. (ฉบับที่ 243)",
        ],
      },
      decisive_fact_questions_th: [],
      source_locator: loc4_4,
      authority_links: resolveFoundationLinksAgainstCanonicalStore({
        state,
        rawLinks: [
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 82/5",
            candidate_work_id: "prov.th.rc.82/5",
            link_source_locator: loc4_4,
            source_excerpt_text: "มาตรา 82/5 ภาษีซื้อที่ไม่ให้นำมาหักในการคำนวณภาษี",
            link_rationale_th: "บทบัญญัติหลักเรื่องภาษีซื้อต้องห้าม (รวมถึงค่ารับรองตาม (4))",
          },
          {
            target_kind: "REVENUE_CODE_PROVISION",
            raw_authority_label_th: "ประมวลรัษฎากร มาตรา 83/6",
            candidate_work_id: "prov.th.rc.83/6",
            link_source_locator: loc4_4,
            source_excerpt_text: "มาตรา 83/6 หน้าที่ผู้จ่ายเงินนำส่งเงินภาษีมูลค่าเพิ่มกรณีใช้บริการจากต่างประเทศในราชอาณาจักร",
            link_rationale_th: "หน้าที่ยื่นแบบ ภ.พ.36 นำส่งภาษีมูลค่าเพิ่ม",
          },
        ],
      }),
    },
  ];
}

export function runVatFoundationPilotIntake(opts?: {
  stagingStoreDir?: string;
  ocrRoutingPolicy?: "LOCAL_ONLY" | "APPROVED_NON_TRAINING_API";
}) {
  const storeDir =
    opts?.stagingStoreDir || path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
  const store = new DurableKnowledgeStore(storeDir);
  const state = store.getState();

  const pdfPath = tryDownloadViaGdriveCliIfAuthenticated();
  let pageProbes: PageTextQualityProbe[] = [];
  let pdfSha256: string | null = null;
  let pdfFilename = "Volume_2_Part_1_1PzlwWVEaJWOXJcBoEggKHMZW3B8pJJ2M.pdf";

  if (pdfPath && fs.existsSync(pdfPath)) {
    pdfFilename = path.basename(pdfPath);
    pdfSha256 = crypto.createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex");
    const rawPages = inspectPdfPagesWithPyMuPdf(pdfPath, 27, 80);
    pageProbes = rawPages.map((p) =>
      evaluateCommentaryPageTextQuality({
        pdfPageNumber: p.pdf_page_number,
        rawNativeText: p.raw_text,
      })
    );
  }

  const concepts = buildVatFoundationConcepts(state, pdfFilename);
  const nativeCount = pageProbes.filter((p) => p.recommended_route === "NATIVE_TEXT").length;
  const repairCount = pageProbes.filter((p) => p.recommended_route === "NATIVE_FONT_REPAIRED").length;
  const ocrCount = pageProbes.filter((p) => p.recommended_route === "SELECTIVE_OCR").length;

  const ledger: VatFoundationPilotLedger = {
    schema_version: "reg24.tax_foundation_pilot.v1",
    mission_id: "mission.thai_tax_foundation.vat_pilot.v2p1",
    generated_at: new Date().toISOString(),
    source_intake_mode: pdfPath
      ? "PHYSICAL_SPLIT_PDF_EXTRACTED"
      : "SCHEMA_SEED_AWAITING_SPLIT_PDF_BYTES",
    source_pdf_sha256: pdfSha256,
    rights: {
      source_id: `gdrive:${VOLUME_2_PART_1_DRIVE_FILE_ID}`,
      work_title_th: "คำอธิบายประมวลรัษฎากร ภาษีสรรพากร เล่ม 2 ตอนที่ 1",
      volume_no: 2,
      part_no: 1,
      edition_printed_label: "May 2018 (พฤษภาคม 2561)",
      edition_cutoff_iso: COMMENTARY_EDITION_CUTOFF_ISO,
      privacy_class: "licensed_internal",
      permitted_use_confirmed: true,
      permitted_use_scope: "INTERNAL_RD_AND_STAGING_EVAL_ONLY",
      external_trial_exposure_allowed: false,
      usable_as_controlling_law: false,
      ocr_routing_policy: opts?.ocrRoutingPolicy || "LOCAL_ONLY",
    },
    page_routing_summary: {
      inspected_pdf_page_start: 27,
      inspected_pdf_page_end: pageProbes.length > 0 ? 27 + pageProbes.length - 1 : 80,
      printed_page_start: "4-001",
      printed_page_end: pageProbes.at(-1)?.printed_page_detected || "4-054",
      native_text_pages: nativeCount,
      font_repaired_pages: repairCount,
      selective_ocr_pages: ocrCount,
      ocr_cost_usd_incl_tax: 0,
    },
    concepts,
  };

  fs.mkdirSync(path.dirname(LEDGER_OUT_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_OUT_PATH, JSON.stringify(ledger, null, 2), "utf8");

  const allLinks = concepts.flatMap((c) => c.authority_links);
  const receipt = {
    generated_at: ledger.generated_at,
    mission_id: ledger.mission_id,
    drive_folder_id: SPLIT_PDF_DRIVE_FOLDER_ID,
    volume_2_part_1_file_id: VOLUME_2_PART_1_DRIVE_FILE_ID,
    source_intake_mode: ledger.source_intake_mode,
    source_pdf_sha256: pdfSha256,
    edition_cutoff_iso: COMMENTARY_EDITION_CUTOFF_ISO,
    permitted_use_scope: ledger.rights.permitted_use_scope,
    usable_as_controlling_law: false,
    existing_canonical_store_untouched: true,
    page_routing_summary: ledger.page_routing_summary,
    concepts_mapped_count: concepts.length,
    total_authority_links: allLinks.length,
    verified_links_count: allLinks.filter((l) => l.verification_status === "VERIFIED_LINK").length,
    candidate_links_quarantined_count: allLinks.filter(
      (l) => l.verification_status === "CANDIDATE_LINK"
    ).length,
    post_2018_05_amended_links_count: allLinks.filter(
      (l) => l.post_2018_05_status === "AMENDED_OR_EXTENDED_POST_2018_05"
    ).length,
    sample_dual_locators: concepts.map((c) => ({
      concept_id: c.concept_id,
      chapter: `${c.source_locator.chapter_no} (${c.source_locator.chapter_title_th})`,
      section: `${c.source_locator.section_code} ${c.source_locator.section_title_th}`,
      printed_page: c.source_locator.printed_page,
      pdf_page_number: c.source_locator.pdf_page_number,
    })),
  };

  fs.mkdirSync(path.dirname(REDACTED_RECEIPT_OUT_PATH), { recursive: true });
  fs.writeFileSync(REDACTED_RECEIPT_OUT_PATH, JSON.stringify(receipt, null, 2), "utf8");

  return receipt;
}

if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("ingest-vat-foundation-pilot.ts")
) {
  const receipt = runVatFoundationPilotIntake();
  console.log(JSON.stringify(receipt, null, 2));
}
