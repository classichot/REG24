/**
 * REG24 — Isolated Batch 1 Candidate Release Builder (`rel.B01.rc7` / `mfst.b01.rc7_thai_legal_index`)
 *
 * Strictly preserves `rel.B01.rc1`, `rel.B01.rc5`, and `rel.B01.rc6` (`mfst.b01.rc6_core_auth`) intact!
 * NEVER reruns the old importer over RC6.
 *
 * What this idempotent builder does:
 *   1. Archives the 3 visually-verified official Royal Gazette PDFs (`dc790.pdf`, `dc799.pdf`, `dc807.pdf`)
 *      into the canonical store's `artifacts/<sha256>.bin` with exact verified SHA-256 hashes & `official_original`.
 *   2. Adds Royal Decree 790 (`subreg.th.rc.royal_decree.790`, `v1`) and Gazette-revalidated versions for
 *      Royal Decree 799 (`v2`, superseding `v1` in `rc7` while preserving `v1` for `rc6` rollback!) and
 *      Royal Decree 807 (`v2`, superseding `v1` in `rc7` with explicit `valid_to: "2027-09-30"`, NEVER `null`!).
 *   3. Stores `enactment_date`, `publication_date`, `commencement_date`, and `covered_transaction_period`
 *      separately, indexed by instrument -> version -> section (`มาตรา ๑`, `มาตรา ๒`, `มาตรา ๓-๔`, `หมายเหตุ`)
 *      with real `pdf_page` locators and original verbatim Thai text (with Thai numerals intact) + separate
 *      normalized `search_fields`.
 *   4. Adds verified graph edges (`AMENDS`, `MADE_UNDER`, `HAS_EXCEPTION`, `HAS_CONDITION`) connecting
 *      the VAT reduction decrees, Revenue Code §80 / §80/1 / §81 / §78 / §78/1, and local-tax authority.
 *   5. Builds Fielded BM25 Lexical + Graph + Deliberately-Disabled Vector projections from the SAME immutable
 *      manifest for BOTH `rel.B01.rc6` (for clean rollback!) AND `rel.B01.rc7`, using real Python PyThaiNLP `newmm`
 *      + `reg24-th-legal-dict-v1.0` when `.venv-nlp` is present.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256Bytes } from "../src/core/knowledge/identity";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import {
  buildReleaseProjectionsFromOutbox,
  inspectReleaseProjectionDiagnostics,
} from "../src/core/knowledge/projections";
import {
  extractCompositeLegalTokens,
  extractPreservedNegationTokens,
  getThaiLegalDictionarySha256,
  normalizeTextForThaiLegalSearchField,
  THAI_LEGAL_COMPOUND_TERMS,
  THAI_LEGAL_DICTIONARY_VERSION,
} from "../src/core/knowledge/thai-legal-dictionary-v1";
import type {
  Artifact,
  Assertion,
  Extraction,
  LegalVersion,
  LegalWork,
  Passage,
} from "../src/core/knowledge/contracts";

const STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const PDF_SOURCE_DIR =
  process.env.REG24_OFFICIAL_PDF_DIR ||
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/official_pdfs";
const PYTHON_EXE = path.resolve(process.cwd(), ".venv-nlp/Scripts/python.exe");
const PY_TOKENIZER_SCRIPT = path.resolve(process.cwd(), "scripts/tokenize-corpus-pythainlp.py");
const RC7_RELEASE_ID = "rel.B01.rc7";
const RC7_MANIFEST_ID = "mfst.b01.rc7_thai_legal_index";

interface VerifiedDecreeSpec {
  decreeNo: "790" | "799" | "807";
  workId: string;
  versionId: string;
  versionLabel: string;
  supersedesVersionIds: string[];
  pdfFileName: string;
  originUri: string;
  expectedSha256: string;
  titleTh: string;
  royalGazetteRef: string;
  enactmentDate: string;
  publicationDate: string;
  commencementDate: string;
  coveredTxFrom: string;
  coveredTxTo: string;
  governingWindowFrom: string;
  governingWindowTo: string;
  amendsPrevDecreeWorkId: string;
  sections: Array<{
    sectionKey: string;
    sectionHeadingTh: string;
    pageZeroBased: number;
    printedPageLabel: string;
    statementRole: "statutory_text" | "official_reasoning";
    verbatimTextTh: string;
  }>;
}

const VERIFIED_DECREES: VerifiedDecreeSpec[] = [
  {
    decreeNo: "790",
    workId: "subreg.th.rc.royal_decree.790",
    versionId: "ver.th.rc.royal_decree.790.v1",
    versionLabel: "v1_gazette_verified",
    supersedesVersionIds: [],
    pdfFileName: "dc790.pdf",
    originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
    expectedSha256: "8cee8f1d3715313f0538e99b1f6cb6887945e943ade089022a5d9d2bc8c5a14e",
    titleTh:
      "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗",
    royalGazetteRef: "ราชกิจจานุเบกษา เล่ม ๑๔๑ ตอนที่ ๕๗ ก หน้า ๑–๓ วันที่ ๒๐ กันยายน ๒๕๖๗",
    enactmentDate: "2024-09-19",
    publicationDate: "2024-09-20",
    commencementDate: "2024-10-01",
    coveredTxFrom: "2017-10-01",
    coveredTxTo: "2025-09-30",
    governingWindowFrom: "2024-10-01",
    governingWindowTo: "2025-09-30",
    amendsPrevDecreeWorkId: "subreg.th.rc.royal_decree.780",
    sections: [
      {
        sectionKey: "sec_1_2",
        sectionHeadingTh: "ชื่อกฎหมายและวันเริ่มใช้บังคับ (มาตรา ๑ – มาตรา ๒)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗\n" +
          "ให้ไว้ ณ วันที่ ๑๙ กันยายน พ.ศ. ๒๕๖๗ เป็นปีที่ ๙ ในรัชกาลปัจจุบัน\n" +
          "อาศัยอำนาจตามความในมาตรา ๑๗๕ ของรัฐธรรมนูญแห่งราชอาณาจักรไทย และมาตรา ๘๐ แห่งประมวลรัษฎากร ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ๓๐) พ.ศ. ๒๕๓๔ จึงทรงพระกรุณาโปรดเกล้าฯ ให้ตราพระราชกฤษฎีกาขึ้นไว้ ดังต่อไปนี้\n" +
          "มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗”\n" +
          "มาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๗ เป็นต้นไป",
      },
      {
        sectionKey: "sec_3_4",
        sectionHeadingTh: "มาตรา ๓ และมาตรา ๔ (แก้ไขเพิ่มเติมการลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บร้อยละ ๖.๓ ถึง ๓๐ กันยายน ๒๕๖๘)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "มาตรา ๓ ให้ยกเลิกความในมาตรา ๔ แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๘๐) พ.ศ. ๒๕๖๖ และให้ใช้ความต่อไปนี้แทน\n" +
          "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๘”\n" +
          "ผู้รับสนองพระบรมราชโองการ แพทองธาร ชินวัตร นายกรัฐมนตรี",
      },
      {
        sectionKey: "note",
        sectionHeadingTh: "หมายเหตุ (เหตุผลในการประกาศใช้ พ.ร.ฎ. ฉบับที่ ๗๙๐ พ.ศ. ๒๕๖๗)",
        pageZeroBased: 2,
        printedPageLabel: "หน้า ๓",
        statementRole: "official_reasoning",
        verbatimTextTh:
          "หมายเหตุ :- เหตุผลในการประกาศใช้พระราชกฤษฎีกาฉบับนี้ คือ โดยที่พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๘๐) พ.ศ. ๒๕๖๖ ได้กำหนดให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร เหลืออัตราร้อยละหกจุดสามเป็นการชั่วคราว สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๗ เพื่อรักษาระดับการขยายตัวของการอุปโภคบริโภคภายในประเทศ อันจะส่งผลให้เศรษฐกิจไทยขยายตัวได้ตามเป้าหมาย สมควรขยายเวลาการลดอัตราภาษีมูลค่าเพิ่มเหลือร้อยละหกจุดสามออกไปจนถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๘ จึงจำเป็นต้องตราพระราชกฤษฎีกานี้",
      },
    ],
  },
  {
    decreeNo: "799",
    workId: "subreg.th.rc.royal_decree.799",
    versionId: "ver.th.rc.royal_decree.799.v2",
    versionLabel: "v2_gazette_verified",
    supersedesVersionIds: ["ver.th.rc.royal_decree.799.v1"],
    pdfFileName: "dc799.pdf",
    originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
    expectedSha256: "796b9aff527081720587dcf5b378833eb09bac731c3cc941fea382ce18302ba3",
    titleTh:
      "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘",
    royalGazetteRef: "ราชกิจจานุเบกษา เล่ม ๑๔๒ ตอนที่ ๕๙ ก หน้า ๑–๓ วันที่ ๑๔ กันยายน ๒๕๖๘",
    enactmentDate: "2025-09-13",
    publicationDate: "2025-09-14",
    commencementDate: "2025-10-01",
    coveredTxFrom: "2017-10-01",
    coveredTxTo: "2026-09-30",
    governingWindowFrom: "2025-10-01",
    governingWindowTo: "2026-09-30",
    amendsPrevDecreeWorkId: "subreg.th.rc.royal_decree.790",
    sections: [
      {
        sectionKey: "sec_1_2",
        sectionHeadingTh: "ชื่อกฎหมายและวันเริ่มใช้บังคับ (มาตรา ๑ – มาตรา ๒)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘\n" +
          "ให้ไว้ ณ วันที่ ๑๓ กันยายน พ.ศ. ๒๕๖๘ เป็นปีที่ ๑๐ ในรัชกาลปัจจุบัน\n" +
          "อาศัยอำนาจตามความในมาตรา ๑๗๕ ของรัฐธรรมนูญแห่งราชอาณาจักรไทย และมาตรา ๘๐ แห่งประมวลรัษฎากร ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ๓๐) พ.ศ. ๒๕๓๔ จึงทรงพระกรุณาโปรดเกล้าฯ ให้ตราพระราชกฤษฎีกาขึ้นไว้ ดังต่อไปนี้\n" +
          "มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘”\n" +
          "มาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๘ เป็นต้นไป",
      },
      {
        sectionKey: "sec_3_4",
        sectionHeadingTh: "มาตรา ๓ และมาตรา ๔ (แก้ไขเพิ่มเติมการลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บร้อยละ ๖.๓ ถึง ๓๐ กันยายน ๒๕๖๙)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "มาตรา ๓ ให้ยกเลิกความในมาตรา ๔ แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗ และให้ใช้ความต่อไปนี้แทน\n" +
          "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๙”\n" +
          "ผู้รับสนองพระบรมราชโองการ ภูมิธรรม เวชยชัย รองนายกรัฐมนตรี",
      },
      {
        sectionKey: "note",
        sectionHeadingTh: "หมายเหตุ (เหตุผลในการประกาศใช้ พ.ร.ฎ. ฉบับที่ ๗๙๙ พ.ศ. ๒๕๖๘)",
        pageZeroBased: 2,
        printedPageLabel: "หน้า ๓",
        statementRole: "official_reasoning",
        verbatimTextTh:
          "หมายเหตุ :- เหตุผลในการประกาศใช้พระราชกฤษฎีกาฉบับนี้ คือ โดยที่พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗ ได้กำหนดให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร เหลืออัตราร้อยละหกจุดสามเป็นการชั่วคราว สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๘ เพื่อรักษาระดับการขยายตัวของการอุปโภคบริโภคภายในประเทศ อันจะส่งผลให้เศรษฐกิจไทยขยายตัวได้ตามเป้าหมาย สมควรขยายเวลาการลดอัตราภาษีมูลค่าเพิ่มเหลือร้อยละหกจุดสามออกไปจนถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๙ จึงจำเป็นต้องตราพระราชกฤษฎีกานี้",
      },
    ],
  },
  {
    decreeNo: "807",
    workId: "subreg.th.rc.royal_decree.807",
    versionId: "ver.th.rc.royal_decree.807.v2",
    versionLabel: "v2_gazette_verified",
    supersedesVersionIds: ["ver.th.rc.royal_decree.807.v1"],
    pdfFileName: "dc807.pdf",
    originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf",
    expectedSha256: "a4e0c55a2324397af4079317d2a5138fa075fcd87eb9348771742ed7ad6dab70",
    titleTh:
      "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙",
    royalGazetteRef: "ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนที่ ๕๐ ก หน้า ๒๐–๒๒ วันที่ ๒๓ สิงหาคม ๒๕๖๙",
    enactmentDate: "2026-08-20",
    publicationDate: "2026-08-23",
    commencementDate: "2026-10-01",
    coveredTxFrom: "2017-10-01",
    coveredTxTo: "2027-09-30",
    governingWindowFrom: "2026-10-01",
    governingWindowTo: "2027-09-30",
    amendsPrevDecreeWorkId: "subreg.th.rc.royal_decree.799",
    sections: [
      {
        sectionKey: "sec_1_2",
        sectionHeadingTh: "ชื่อกฎหมายและวันเริ่มใช้บังคับ (มาตรา ๑ – มาตรา ๒)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๒๐",
        statementRole: "statutory_text",
        verbatimTextTh:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙\n" +
          "ให้ไว้ ณ วันที่ ๒๐ สิงหาคม พ.ศ. ๒๕๖๙ เป็นปีที่ ๑๑ ในรัชกาลปัจจุบัน\n" +
          "อาศัยอำนาจตามความในมาตรา ๑๗๕ ของรัฐธรรมนูญแห่งราชอาณาจักรไทย และมาตรา ๘๐ แห่งประมวลรัษฎากร ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ๓๐) พ.ศ. ๒๕๓๔ จึงทรงพระกรุณาโปรดเกล้าฯ ให้ตราพระราชกฤษฎีกาขึ้นไว้ ดังต่อไปนี้\n" +
          "มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙”\n" +
          "มาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙ เป็นต้นไป",
      },
      {
        sectionKey: "sec_3_4",
        sectionHeadingTh: "มาตรา ๓ และมาตรา ๔ (แก้ไขเพิ่มเติมการลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บร้อยละ ๖.๓ ถึง ๓๐ กันยายน ๒๕๗๐)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "มาตรา ๓ ให้ยกเลิกความในมาตรา ๔ แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘ และให้ใช้ความต่อไปนี้แทน\n" +
          "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๗๐”\n" +
          "ผู้รับสนองพระบรมราชโองการ อนุทิน ชาญวีรกูล นายกรัฐมนตรี",
      },
      {
        sectionKey: "note",
        sectionHeadingTh: "หมายเหตุ (เหตุผลในการประกาศใช้ พ.ร.ฎ. ฉบับที่ ๘๐๗ พ.ศ. ๒๕๖๙)",
        pageZeroBased: 2,
        printedPageLabel: "หน้า ๒๒",
        statementRole: "official_reasoning",
        verbatimTextTh:
          "หมายเหตุ :- เหตุผลในการประกาศใช้พระราชกฤษฎีกาฉบับนี้ คือ โดยที่พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘ ได้กำหนดให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร เหลืออัตราร้อยละหกจุดสามเป็นการชั่วคราว สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๙ เพื่อรักษาระดับการขยายตัวของการอุปโภคบริโภคภายในประเทศ อันจะส่งผลให้เศรษฐกิจไทยขยายตัวได้ตามเป้าหมาย สมควรขยายเวลาการลดอัตราภาษีมูลค่าเพิ่มเหลือร้อยละหกจุดสามออกไปจนถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๗๐ จึงจำเป็นต้องตราพระราชกฤษฎีกานี้",
      },
    ],
  },
];

function runPyThaiNlpTokenizerForRelease(
  store: DurableKnowledgeStore,
  releaseId: string
):
  | {
      tokenizer_engine: string;
      legal_dictionary_version: string;
      legal_dictionary_sha256: string;
      passages: Record<string, { title_tokens: string[]; body_tokens: string[] }>;
    }
  | undefined {
  if (!fs.existsSync(PYTHON_EXE) || !fs.existsSync(PY_TOKENIZER_SCRIPT)) {
    console.warn("Python PyThaiNLP venv not found; falling back to runtime TS dictionary tokenizer.");
    return undefined;
  }
  const st = store.getState();
  const passages = store.getPassagesForRelease(releaseId);
  const tmpDir = path.join(store.dataDir, "reports");
  fs.mkdirSync(tmpDir, { recursive: true });
  const inPath = path.join(tmpDir, `_tmp_pythainlp_in_${releaseId}.json`);
  const outPath = path.join(tmpDir, `_tmp_pythainlp_out_${releaseId}.json`);

  const payload = {
    legal_dictionary_version: THAI_LEGAL_DICTIONARY_VERSION,
    legal_dictionary_sha256: getThaiLegalDictionarySha256(),
    legal_dictionary_terms: Array.from(THAI_LEGAL_COMPOUND_TERMS),
    passages: passages.map((p) => {
      const w = st.works[p.work_id];
      return {
        passage_id: p.passage_id,
        title_text: `${w?.title_th || ""} ${p.contextualized_header || ""} ${(p.structural_path || []).join(" ")}`,
        body_text: p.exact_text,
      };
    }),
  };
  fs.writeFileSync(inPath, JSON.stringify(payload), "utf8");
  try {
    execFileSync(PYTHON_EXE, [PY_TOKENIZER_SCRIPT, "--input", inPath, "--output", outPath], {
      stdio: "inherit",
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    return JSON.parse(fs.readFileSync(outPath, "utf8"));
  } finally {
    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
}

async function main() {
  const store = new DurableKnowledgeStore(STORE_DIR);
  const nowIso = new Date().toISOString();
  const beforeState = store.getState();

  const rc6Rel = beforeState.releases["rel.B01.rc6"];
  if (!rc6Rel) {
    throw new Error("Pinned baseline release rel.B01.rc6 not found in canonical store!");
  }
  console.log("Preserved baseline rel.B01.rc6:", {
    manifest_id: rc6Rel.manifest_id,
    manifest_hash: rc6Rel.manifest_hash,
    passages: store.getPassagesForRelease("rel.B01.rc6").length,
  });

  // 1. Archive & hash-verify official Gazette PDFs for 790, 799, 807
  const createdArtifacts: Artifact[] = [];
  const createdWorks: LegalWork[] = [];
  const createdVersions: LegalVersion[] = [];
  const createdExtractions: Extraction[] = [];
  const createdPassages: Passage[] = [];
  const createdAssertions: Assertion[] = [];

  const manifestFingerprintParts: string[] = [
    `parent:${rc6Rel.release_id}:${rc6Rel.manifest_hash}`,
    `dict:${THAI_LEGAL_DICTIONARY_VERSION}:${getThaiLegalDictionarySha256()}`,
  ];

  for (const spec of VERIFIED_DECREES) {
    const pdfPath = path.join(PDF_SOURCE_DIR, spec.pdfFileName);
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Missing official Gazette PDF: ${pdfPath}`);
    }
    const bytes = fs.readFileSync(pdfPath);
    const actualSha = sha256Bytes(bytes);
    if (actualSha !== spec.expectedSha256) {
      throw new Error(
        `SHA-256 mismatch for ${spec.pdfFileName}: got ${actualSha}, expected ${spec.expectedSha256}`
      );
    }

    const stored = store.storeImmutableArtifactBytes(bytes);
    const artifactId = `art.gazette.rd${spec.decreeNo}.${actualSha.slice(0, 12)}`;
    manifestFingerprintParts.push(`${spec.workId}:${spec.versionId}:${actualSha}`);

    createdArtifacts.push({
      artifact_id: artifactId,
      actual_bytes_sha256: stored.sha256,
      size: stored.size,
      MIME: "application/pdf",
      immutable_uri: stored.immutable_uri,
      fetched_at: nowIso,
      origin_uri: spec.originUri,
      authenticity_status: "official_original",
      access_scope: "scope.platform.public",
      rights_status: "approved_public",
      is_derivative: false,
    });

    // Only create LegalWork if new (790); for 799 & 807 preserve existing work_id & add verified aliases/identifiers
    const existingWork = beforeState.works[spec.workId];
    const arabicTitle = normalizeTextForThaiLegalSearchField(spec.titleTh);
    const workObj: LegalWork = existingWork
      ? {
          ...existingWork,
          aliases: Array.from(
            new Set([
              ...(existingWork.aliases || []),
              spec.titleTh,
              arabicTitle,
              `พ.ร.ฎ. ฉบับที่ ${spec.decreeNo}`,
              `พ.ร.ฎ. ${spec.decreeNo}`,
              `พระราชกฤษฎีกา ฉบับที่ ${spec.decreeNo}`,
            ])
          ),
          official_identifiers: Array.from(
            new Map(
              [
                ...(existingWork.official_identifiers || []),
                {
                  raw: `พ.ร.ฎ. (ฉบับที่ ${spec.decreeNo})`,
                  normalized: `พ.ร.ฎ. (ฉบับที่ ${spec.decreeNo})`,
                  kind: "royal_decree_no" as const,
                },
                {
                  raw: spec.titleTh,
                  normalized: arabicTitle,
                  kind: "statute_code" as const,
                },
              ].map((o) => [`${o.kind}:${o.normalized}`, o])
            ).values()
          ),
        }
      : {
          work_id: spec.workId,
          type: "SubordinateLegislation",
          issuer_id: "issuer.th.rd",
          jurisdiction: "TH",
          title_th: arabicTitle,
          title_en: `Royal Decree Issued under the Revenue Code Governing Reduction of Value Added Tax Rate (No. ${spec.decreeNo})`,
          official_identifiers: [
            {
              raw: `พ.ร.ฎ. (ฉบับที่ ${spec.decreeNo})`,
              normalized: `พ.ร.ฎ. (ฉบับที่ ${spec.decreeNo})`,
              kind: "royal_decree_no",
            },
            {
              raw: spec.titleTh,
              normalized: arabicTitle,
              kind: "statute_code",
            },
          ],
          identity_evidence: [artifactId],
          aliases: [
            spec.titleTh,
            arabicTitle,
            `พ.ร.ฎ. ฉบับที่ ${spec.decreeNo}`,
            `พ.ร.ฎ. ${spec.decreeNo}`,
            `พระราชกฤษฎีกา ฉบับที่ ${spec.decreeNo}`,
          ],
          owner_batch_id: "B01",
          first_loaded_by_batch_id: "B01",
          instrument_code: `RD_${spec.decreeNo}`,
        };
    createdWorks.push(workObj);

    const verObj: LegalVersion = {
      version_id: spec.versionId,
      work_id: spec.workId,
      version_label: spec.versionLabel,
      enactment_date: spec.enactmentDate,
      publication_date: spec.publicationDate,
      commencement_date: spec.commencementDate,
      covered_transaction_period: {
        from: spec.coveredTxFrom,
        to: spec.coveredTxTo,
        basis: "TRANSACTION_OR_EVENT_DATE",
        is_temporary_rule: true,
      },
      royal_gazette_ref: spec.royalGazetteRef,
      supersedes_version_ids: spec.supersedesVersionIds,
      legal_applicability: [
        {
          valid_from: spec.governingWindowFrom,
          valid_to: spec.governingWindowTo,
          conditions: [
            `ประกาศใน${spec.royalGazetteRef}; มาตรา ๒ ให้ใช้บังคับตั้งแต่ ${spec.commencementDate}; แก้ไขมาตรา ๔ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ คงจัดเก็บภาษีมูลค่าเพิ่มร้อยละ ๖.๓ สำหรับความรับผิดตั้งแต่ ${spec.coveredTxFrom} ถึง ${spec.coveredTxTo} (ช่วงขยายเวลาเฉพาะฉบับนี้: ${spec.governingWindowFrom} ถึง ${spec.governingWindowTo})`,
          ],
          date_status: "verified",
          applicability_basis: "TRANSACTION_OR_EVENT_DATE",
          enactment_effective_date: spec.commencementDate,
          is_temporary_rule: true,
        },
      ],
      decision_date: null,
      raw_date_text: `${spec.royalGazetteRef} | ให้ไว้ ณ วันที่ ${spec.enactmentDate} | ใช้บังคับ ${spec.commencementDate} | ครอบคลุมความรับผิด ${spec.coveredTxFrom} ถึง ${spec.coveredTxTo}`,
      temporal_evidence_ids: [artifactId],
      known_from: nowIso,
      known_to: null,
      is_consolidated_derived: false,
      draft_or_enacted_status: "ENACTED_AMENDMENT",
      access_scope: "scope.platform.public",
    };
    createdVersions.push(verObj);

    const extractionId = `ext.gazette.rd${spec.decreeNo}.${actualSha.slice(0, 12)}`;
    const fullVerbatim = spec.sections.map((s) => s.verbatimTextTh).join("\n\n");
    createdExtractions.push({
      extraction_id: extractionId,
      artifact_id: artifactId,
      work_id: spec.workId,
      version_id: spec.versionId,
      extractor_version: "reg24-gazette-visual-verified-v1.0",
      model_version: "pymupdf-visual-qa-verified",
      configuration_version: "rc7-gazette-strict-v1",
      raw_text_uri: stored.immutable_uri,
      raw_text: fullVerbatim,
      normalized_text: normalizeTextForThaiLegalSearchField(fullVerbatim),
      normalization_log: [
        "Verified directly against rendered pages of official Royal Gazette PDF from rd.go.th",
        "Preserved original Thai numerals verbatim in exact_text; stored Arabic/abbreviation normalizations in search_fields",
      ],
      quality_status: "VALIDATED",
      accepted_revision: 1,
      created_at: nowIso,
    });

    const sectionPassageIds: string[] = [];
    for (let sIdx = 0; sIdx < spec.sections.length; sIdx++) {
      const sec = spec.sections[sIdx];
      const passageId = `psg.rc7.rd${spec.decreeNo}.${sec.sectionKey}`;
      sectionPassageIds.push(passageId);
    }

    for (let sIdx = 0; sIdx < spec.sections.length; sIdx++) {
      const sec = spec.sections[sIdx];
      const passageId = sectionPassageIds[sIdx];
      const header = `${spec.titleTh} — ${sec.sectionHeadingTh} (${spec.royalGazetteRef})`;
      const compositeToks = Array.from(
        new Set([
          `rd:${spec.decreeNo}`,
          ...extractCompositeLegalTokens(`${header} ${sec.verbatimTextTh}`),
        ])
      );
      createdPassages.push({
        passage_id: passageId,
        work_id: spec.workId,
        version_id: spec.versionId,
        extraction_id: extractionId,
        release_id: RC7_RELEASE_ID,
        exact_text: sec.verbatimTextTh,
        contextualized_header: header,
        real_locator: {
          kind: "pdf_page",
          artifact_id: artifactId,
          origin_uri: spec.originUri,
          physical_page_index: sec.pageZeroBased,
          printed_page_label: sec.printedPageLabel,
        },
        structural_path: [
          `พระราชกฤษฎีกา (ฉบับที่ ${spec.decreeNo})`,
          spec.versionLabel,
          sec.sectionHeadingTh,
        ],
        parent_id: null,
        adjacent_ids: {
          previous_id: sIdx > 0 ? sectionPassageIds[sIdx - 1] : null,
          next_id: sIdx < sectionPassageIds.length - 1 ? sectionPassageIds[sIdx + 1] : null,
        },
        language: "th",
        statement_role: sec.statementRole,
        token_count: Math.ceil(sec.verbatimTextTh.length / 4),
        critical_tokens_flagged: ["6.3", "ร้อยละหกจุดสาม", spec.coveredTxTo, `ฉบับที่ ${spec.decreeNo}`],
        contains_untrusted_instruction_like_text: false,
        access_scope: "scope.platform.public",
        search_fields: {
          normalized_identifiers: [
            `พ.ร.ฎ. (ฉบับที่ ${spec.decreeNo})`,
            `พระราชกฤษฎีกา ฉบับที่ ${spec.decreeNo}`,
            `rd:${spec.decreeNo}`,
          ],
          composite_section_tokens: compositeToks,
          normalized_text_arabic: normalizeTextForThaiLegalSearchField(sec.verbatimTextTh),
          preserved_negation_tokens: extractPreservedNegationTokens(sec.verbatimTextTh),
          legal_field_role: sec.statementRole,
        },
      });
    }

    // Verified graph assertions: MADE_UNDER §80, AMENDS RD 646, AMENDS prior RD (780/790/799)
    const operativePassageId = sectionPassageIds[1]; // sec_3_4
    const preamblePassageId = sectionPassageIds[0]; // sec_1_2

    const addAsrt = (
      idSuffix: string,
      subject: string,
      subjectType: Assertion["subject_type"],
      predicate: Assertion["predicate"],
      object: string,
      objectType: Assertion["object_type"],
      evidenceIds: string[],
      conditions: string[]
    ) => {
      createdAssertions.push({
        assertion_id: `asrt.rc7.${idSuffix}`,
        release_id: RC7_RELEASE_ID,
        subject,
        subject_type: subjectType,
        predicate,
        object,
        object_type: objectType,
        qualifications: {
          conditions,
          exceptions: [],
          tax_types: ["VAT"],
          applicable_period: `${spec.governingWindowFrom}..${spec.governingWindowTo}`,
        },
        evidence_ids: evidenceIds,
        statement_role: "statutory_text",
        state: "ACCEPTED",
        review_id: null,
        validity: {
          valid_from: spec.governingWindowFrom,
          valid_to: spec.governingWindowTo,
        },
        confidence: 1.0,
        legal_certainty: "settled_statutory",
        scope: "scope.platform.public",
      });
    };

    addAsrt(
      `rd${spec.decreeNo}.made_under.rc80`,
      spec.workId,
      "SubordinateLegislation",
      "MADE_UNDER",
      "prov.th.rc.80",
      "ProvisionVersion",
      [preamblePassageId],
      [`ออกตามความในประมวลรัษฎากร มาตรา 80 (${spec.governingWindowFrom}..${spec.governingWindowTo})`]
    );
    addAsrt(
      `rd${spec.decreeNo}.amends.rd646`,
      spec.workId,
      "SubordinateLegislation",
      "AMENDS",
      "subreg.th.rc.royal_decree.646",
      "SubordinateLegislation",
      [operativePassageId],
      [`แก้ไขมาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560 ขยายเวลาถึง ${spec.coveredTxTo}`]
    );
    addAsrt(
      `rd${spec.decreeNo}.amends.prev`,
      spec.workId,
      "SubordinateLegislation",
      "AMENDS",
      spec.amendsPrevDecreeWorkId,
      "SubordinateLegislation",
      [operativePassageId],
      [`แทนความเดิมที่แก้ไขโดย ${spec.amendsPrevDecreeWorkId}`]
    );
  }

  // Verified statutory exception/condition graph edges keeping VAT regimes distinct (zero-rating §80/1, exemption §81, tax points §78/§78/1, local tax)
  const rc80Psgs = Object.values(beforeState.passages)
    .filter((p) => p.work_id === "prov.th.rc.80" && !p.extraction_id.startsWith("ext.dep."))
    .map((p) => p.passage_id);
  const rc80_1Psgs = Object.values(beforeState.passages)
    .filter((p) => p.work_id === "prov.th.rc.80/1" && !p.extraction_id.startsWith("ext.dep."))
    .map((p) => p.passage_id);
  const rc81Psgs = Object.values(beforeState.passages)
    .filter((p) => p.work_id === "prov.th.rc.81" && !p.extraction_id.startsWith("ext.dep."))
    .map((p) => p.passage_id);
  const localTaxPsgs = Object.values(beforeState.passages)
    .filter((p) => p.work_id === "subreg.th.rd.vat_local_tax_guide")
    .map((p) => p.passage_id);

  if (rc80Psgs.length > 0 && rc80_1Psgs.length > 0) {
    createdAssertions.push({
      assertion_id: "asrt.rc7.rc80.has_exception.rc80_1",
      release_id: RC7_RELEASE_ID,
      subject: "prov.th.rc.80",
      subject_type: "ProvisionVersion",
      predicate: "HAS_EXCEPTION",
      object: "prov.th.rc.80/1",
      object_type: "ProvisionVersion",
      qualifications: {
        conditions: ["การส่งออกสินค้าหรือการให้บริการในราชอาณาจักรและใช้บริการในต่างประเทศใช้อัตราร้อยละ 0 ตามมาตรา 80/1"],
        exceptions: ["มาตรา 80/1 แยกต่างหากจากอัตราทั่วไปตามมาตรา 80"],
        tax_types: ["VAT"],
      },
      evidence_ids: [rc80_1Psgs[0]],
      statement_role: "statutory_text",
      state: "ACCEPTED",
      review_id: null,
      validity: { valid_from: "1992-01-01", valid_to: null },
      confidence: 1.0,
      legal_certainty: "settled_statutory",
      scope: "scope.platform.public",
    });
  }
  if (rc80Psgs.length > 0 && rc81Psgs.length > 0) {
    createdAssertions.push({
      assertion_id: "asrt.rc7.rc80.has_exception.rc81",
      release_id: RC7_RELEASE_ID,
      subject: "prov.th.rc.80",
      subject_type: "ProvisionVersion",
      predicate: "HAS_EXCEPTION",
      object: "prov.th.rc.81",
      object_type: "ProvisionVersion",
      qualifications: {
        conditions: ["กิจการที่ได้รับยกเว้นภาษีมูลค่าเพิ่มตามมาตรา 81 ไม่ต้องเรียกเก็บภาษีมูลค่าเพิ่มตามมาตรา 80"],
        exceptions: ["มาตรา 81 ยกเว้น VAT แยกต่างหากจากอัตราศูนย์มาตรา 80/1"],
        tax_types: ["VAT"],
      },
      evidence_ids: [rc81Psgs[0]],
      statement_role: "statutory_text",
      state: "ACCEPTED",
      review_id: null,
      validity: { valid_from: "1992-01-01", valid_to: null },
      confidence: 1.0,
      legal_certainty: "settled_statutory",
      scope: "scope.platform.public",
    });
  }
  if (rc80Psgs.length > 0 && localTaxPsgs.length > 0) {
    createdAssertions.push({
      assertion_id: "asrt.rc7.rc80.has_condition.vat_local_tax",
      release_id: RC7_RELEASE_ID,
      subject: "prov.th.rc.80",
      subject_type: "ProvisionVersion",
      predicate: "HAS_CONDITION",
      object: "subreg.th.rd.vat_local_tax_guide",
      object_type: "SubordinateLegislation",
      qualifications: {
        conditions: ["ภาษีท้องถิ่น 1 ใน 9 (ร้อยละ 0.7) รวมกับอัตราลดตาม พ.ร.ฎ. (ร้อยละ 6.3) เป็นอัตรารวมร้อยละ 7.0"],
        exceptions: [],
        tax_types: ["VAT"],
      },
      evidence_ids: [localTaxPsgs[0]],
      statement_role: "statutory_text",
      state: "ACCEPTED",
      review_id: null,
      validity: { valid_from: "2017-10-01", valid_to: null },
      confidence: 1.0,
      legal_certainty: "settled_statutory",
      scope: "scope.platform.public",
    });
  }

  const manifestHash = sha256Bytes(manifestFingerprintParts.sort().join("|"));

  await store.transact("CREATE_OR_REFRESH_RC7_CANDIDATE_OVERLAY", (draft) => {
    for (const a of createdArtifacts) draft.artifacts[a.artifact_id] = a;
    for (const w of createdWorks) draft.works[w.work_id] = w;
    for (const v of createdVersions) draft.versions[v.version_id] = v;
    for (const e of createdExtractions) draft.extractions[e.extraction_id] = e;
    for (const p of createdPassages) draft.passages[p.passage_id] = p;
    for (const asrt of createdAssertions) draft.assertions[asrt.assertion_id] = asrt;

    draft.releases[RC7_RELEASE_ID] = {
      release_id: RC7_RELEASE_ID,
      batch_id: "B01",
      manifest_id: RC7_MANIFEST_ID,
      manifest_hash: manifestHash,
      code_commit: "7089e3b9d1cdd2c7e24024482f322b38ca3c87ef",
      state: "READY_FOR_UAT",
      revision: 7,
      previous_accepted_release_id: "rel.B01.rc6",
      rollback_target_release_id: "rel.B01.rc6",
      supersession_lineage: {
        supersedes_release_id: "rel.B01.rc6",
        supersedes_manifest_id: rc6Rel.manifest_id,
        supersedes_manifest_hash: rc6Rel.manifest_hash,
        prior_release_preserved_state: rc6Rel.state,
        prior_chat_approval_preserved: false,
        explanation:
          "Isolated Batch 1 candidate adding Gazette-verified Royal Decree 790 (2024-10-01..2025-09-30), revalidating Gazette originals & explicit end dates for 799 (2025-10-01..2026-09-30) and 807 (2026-10-01..2027-09-30), and building manifest-pinned Thai legal fielded BM25 projections (PyThaiNLP newmm + reg24-th-legal-dict-v1.0) with legacy char-hash vectors deliberately disabled.",
      },
      created_work_ids: ["subreg.th.rc.royal_decree.790"],
      created_version_ids: createdVersions.map((v) => v.version_id),
      created_passage_ids: createdPassages.map((p) => p.passage_id),
      created_assertion_ids: createdAssertions.map((a) => a.assertion_id),
      reused_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
      coverage_gaps: [
        "Pre-2023-10-01 historical VAT reduction decrees (prior to RD 780) are not yet individually Gazette-reverified with separate enactment/publication/commencement fields.",
      ],
      transitions: [
        {
          from: null,
          to: "READY_FOR_UAT",
          actor_id: "engineering.rc10@reg24.th",
          at: nowIso,
          revision: 7,
          note: "Built isolated rel.B01.rc7 candidate from rel.B01.rc6 without mutating RC6",
        },
      ],
      created_at: beforeState.releases[RC7_RELEASE_ID]?.created_at || nowIso,
      updated_at: nowIso,
    };
  });

  // 2. Build matching projections for BOTH rel.B01.rc6 (clean rollback!) AND rel.B01.rc7
  console.log("\n=== Tokenizing & building Fielded BM25 + Graph projections for rel.B01.rc6 (rollback set) ===");
  const rc6PyTok = runPyThaiNlpTokenizerForRelease(store, "rel.B01.rc6");
  const rc6Receipts = await buildReleaseProjectionsFromOutbox(store, "rel.B01.rc6", "durable_disk", {
    vectorMode: "deliberately_disabled",
    externalTokenizerOutput: rc6PyTok,
  });
  console.log("rel.B01.rc6 receipts:", rc6Receipts.map((r) => `${r.projection_kind}:${r.completion_state}:${r.item_count}:${r.vector_status || "ok"}`));

  console.log("\n=== Tokenizing & building Fielded BM25 + Graph projections for rel.B01.rc7 (new candidate) ===");
  const rc7PyTok = runPyThaiNlpTokenizerForRelease(store, RC7_RELEASE_ID);
  const rc7Receipts = await buildReleaseProjectionsFromOutbox(store, RC7_RELEASE_ID, "durable_disk", {
    vectorMode: "deliberately_disabled",
    externalTokenizerOutput: rc7PyTok,
  });
  console.log("rel.B01.rc7 receipts:", rc7Receipts.map((r) => `${r.projection_kind}:${r.completion_state}:${r.item_count}:${r.vector_status || "ok"}`));

  const diagRc6 = inspectReleaseProjectionDiagnostics(store, "rel.B01.rc6");
  const diagRc7 = inspectReleaseProjectionDiagnostics(store, RC7_RELEASE_ID);
  console.log("\n=== PROJECTION DIAGNOSTICS ===");
  console.log("rel.B01.rc6:", JSON.stringify(diagRc6, null, 2));
  console.log("rel.B01.rc7:", JSON.stringify(diagRc7, null, 2));

  // Verify idempotency & rollback separation
  const rc6PsgIds = store.getPassagesForRelease("rel.B01.rc6").map((p) => p.passage_id);
  const rc7PsgIds = store.getPassagesForRelease(RC7_RELEASE_ID).map((p) => p.passage_id);
  const rc7Unique = new Set(rc7PsgIds).size;
  console.log("\n=== INTEGRITY CHECKS ===");
  console.log({
    rc6_passage_count: rc6PsgIds.length,
    rc7_passage_count: rc7PsgIds.length,
    rc7_unique_passages: rc7Unique,
    rc7_zero_duplicates: rc7PsgIds.length === rc7Unique,
    rc6_still_has_rd799_v1: store.getPassagesForRelease("rel.B01.rc6").some((p) => p.version_id === "ver.th.rc.royal_decree.799.v1"),
    rc6_does_not_have_rd790: !store.getPassagesForRelease("rel.B01.rc6").some((p) => p.work_id === "subreg.th.rc.royal_decree.790"),
    rc7_has_rd790_v1: store.getPassagesForRelease(RC7_RELEASE_ID).some((p) => p.version_id === "ver.th.rc.royal_decree.790.v1"),
    rc7_has_rd799_v2_only:
      store.getPassagesForRelease(RC7_RELEASE_ID).some((p) => p.version_id === "ver.th.rc.royal_decree.799.v2") &&
      !store.getPassagesForRelease(RC7_RELEASE_ID).some((p) => p.version_id === "ver.th.rc.royal_decree.799.v1"),
    rc7_has_rd807_v2_only:
      store.getPassagesForRelease(RC7_RELEASE_ID).some((p) => p.version_id === "ver.th.rc.royal_decree.807.v2") &&
      !store.getPassagesForRelease(RC7_RELEASE_ID).some((p) => p.version_id === "ver.th.rc.royal_decree.807.v1"),
  });
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
