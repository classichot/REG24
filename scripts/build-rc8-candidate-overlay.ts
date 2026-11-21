/**
 * REG24 Batch 1 (`feat/b01-thai-legal-index-retrieval-rc10.3`) —
 * Isolated `rel.B01.rc8` (`mfst.b01.rc8_thai_legal_index`) Overlay & Projection Builder
 *
 * Preserves `rel.B01.rc6` and `rel.B01.rc7` (RC10.2 baseline) 100% untouched for comparison and rollback.
 * Implements RC10.3 P0-1:
 *   1. Archives and SHA-256 verifies official Royal Gazette PDFs for RD 780, 790, 799, 807 plus RD's
 *      consolidated compilation PDF for RD 646 (explicitly labeled `CONSOLIDATED_DERIVED` with base window
 *      2017-10-01..2018-09-30 so superseded RD 646 text NEVER governs post-2018-09-30 transactions).
 *   2. Labels each amending decree's `มาตรา ๓` (`sec_3_amending_clause`) SEPARATELY from the quoted
 *      replacement text of Decree 646 `มาตรา ๔` (`sec_3_quoted_rd646_sec_4`).
 *   3. Distinguishes direct amendment of Decree 646 §4 (`AMENDS -> subreg.th.rc.royal_decree.646`) from
 *      predecessor history (`SUPERSEDES -> subreg.th.rc.royal_decree.{780|790|799}`), superseding
 *      `asrt.rc7.rd*.amends.prev` cleanly inside `rel.B01.rc8` while keeping `rel.B01.rc7` untouched.
 *   4. Rebuilds manifest-pinned projections for `rel.B01.rc8` using the single-engine pinned TypeScript
 *      tokenizer (`ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0`) with vectors `deliberately_disabled`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { sha256Bytes } from "../src/core/knowledge/identity";
import {
  buildReleaseProjectionsFromOutbox,
  inspectReleaseProjectionDiagnostics,
  runTokenizerParityProbe,
} from "../src/core/knowledge/projections";
import {
  extractCompositeLegalTokens,
  extractPreservedNegationTokens,
  getThaiLegalDictionarySha256,
  normalizeTextForThaiLegalSearchField,
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
const ARTIFACTS_DIR = path.join(STORE_DIR, "artifacts");
const SCRATCH_PDF_DIR =
  process.env.RC8_PDF_DIR ||
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch";

const RC8_RELEASE_ID = "rel.B01.rc8";
const RC8_MANIFEST_ID = "mfst.b01.rc8_thai_legal_index";

interface VerifiedAmendingDecreeSpec {
  decreeNo: "780" | "790" | "799" | "807";
  workId: string;
  versionId: string;
  versionLabel: string;
  supersedesVersionIds: string[];
  expectedSha256: string;
  scratchFileName?: string;
  originUri: string;
  titleTh: string;
  royalGazetteRef: string;
  enactmentDate: string;
  publicationDate: string;
  commencementDate: string;
  coveredTxFrom: string;
  coveredTxTo: string;
  governingWindowFrom: string;
  governingWindowTo: string;
  predecessorDecreeWorkId: string | null;
  supersedesRc7AmendsRd646Id?: string;
  supersedesRc7AmendsPrevId?: string;
  supersedesRc7MadeUnderId?: string;
  sections: Array<{
    sectionKey: "sec_1_2" | "sec_3_amending_clause" | "sec_3_quoted_rd646_sec_4" | "note";
    sectionHeadingTh: string;
    pageZeroBased: number;
    printedPageLabel: string;
    statementRole: Passage["statement_role"];
    verbatimTextTh: string;
  }>;
}

const VERIFIED_AMENDING_DECREES: VerifiedAmendingDecreeSpec[] = [
  {
    decreeNo: "780",
    workId: "subreg.th.rc.royal_decree.780",
    versionId: "ver.th.rc.royal_decree.780.v2",
    versionLabel: "v2_gazette_verified_rc8",
    supersedesVersionIds: ["ver.th.rc.royal_decree.780.v1"],
    expectedSha256: "26f4a13406bea41d938b0cb1819e2c75885669b0f9bc77db1110a8e78e91d421",
    scratchFileName: "dc780.pdf",
    originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc780.pdf",
    titleTh:
      "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๘๐) พ.ศ. ๒๕๖๖",
    royalGazetteRef: "ราชกิจจานุเบกษา เล่ม ๑๔๐ ตอนที่ ๕๕ ก หน้า ๑–๓ วันที่ ๑๖ กันยายน ๒๕๖๖",
    enactmentDate: "2023-09-15",
    publicationDate: "2023-09-16",
    commencementDate: "2023-10-01",
    coveredTxFrom: "2017-10-01",
    coveredTxTo: "2024-09-30",
    governingWindowFrom: "2023-10-01",
    governingWindowTo: "2024-09-30",
    predecessorDecreeWorkId: null,
    sections: [
      {
        sectionKey: "sec_1_2",
        sectionHeadingTh: "ชื่อกฎหมายและวันเริ่มใช้บังคับ (มาตรา ๑ – มาตรา ๒)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๘๐) พ.ศ. ๒๕๖๖\nให้ไว้ ณ วันที่ ๑๕ กันยายน พ.ศ. ๒๕๖๖ เป็นปีที่ ๘ ในรัชกาลปัจจุบัน\nอาศัยอำนาจตามความในมาตรา ๑๗๕ ของรัฐธรรมนูญแห่งราชอาณาจักรไทย และมาตรา ๘๐ แห่งประมวลรัษฎากร ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ๓๐) พ.ศ. ๒๕๓๔ จึงทรงพระกรุณาโปรดเกล้าฯ ให้ตราพระราชกฤษฎีกาขึ้นไว้ ดังต่อไปนี้\nมาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๘๐) พ.ศ. ๒๕๖๖”\nมาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๖ เป็นต้นไป",
      },
      {
        sectionKey: "sec_3_amending_clause",
        sectionHeadingTh:
          "มาตรา ๓ แห่ง พ.ร.ฎ. (ฉบับที่ ๗๘๐) พ.ศ. ๒๕๖๖ (บทบัญญัติแก้ไขเพิ่มเติม พ.ร.ฎ. ฉบับที่ ๖๔๖ มาตรา ๔)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๑–๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "มาตรา ๓ ให้ยกเลิกความในมาตรา ๔ แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๒๔) พ.ศ. ๒๕๖๔ และให้ใช้ความต่อไปนี้แทน",
      },
      {
        sectionKey: "sec_3_quoted_rd646_sec_4",
        sectionHeadingTh:
          "ข้อความแก้ไขแทนที่ในมาตรา ๓: มาตรา ๔ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ (คงจัดเก็บ VAT ร้อยละ ๖.๓ ถึง ๓๐ กันยายน ๒๕๖๗)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๗”\nผู้รับสนองพระบรมราชโองการ เศรษฐา ทวีสิน นายกรัฐมนตรี",
      },
      {
        sectionKey: "note",
        sectionHeadingTh: "หมายเหตุ (เหตุผลในการประกาศใช้ พ.ร.ฎ. ฉบับที่ ๗๘๐ พ.ศ. ๒๕๖๖)",
        pageZeroBased: 2,
        printedPageLabel: "หน้า ๓",
        statementRole: "official_reasoning",
        verbatimTextTh:
          "หมายเหตุ :- เหตุผลในการประกาศใช้พระราชกฤษฎีกาฉบับนี้ คือ โดยที่พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๒๔) พ.ศ. ๒๕๖๔ ได้กำหนดให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร เหลืออัตราร้อยละหกจุดสามเป็นการชั่วคราว สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๖ สมควรขยายเวลาการลดอัตราภาษีมูลค่าเพิ่มเหลือร้อยละหกจุดสาม ออกไปจนถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๗ จึงจำเป็นต้องตราพระราชกฤษฎีกานี้",
      },
    ],
  },
  {
    decreeNo: "790",
    workId: "subreg.th.rc.royal_decree.790",
    versionId: "ver.th.rc.royal_decree.790.v2",
    versionLabel: "v2_gazette_verified_rc8",
    supersedesVersionIds: ["ver.th.rc.royal_decree.790.v1"],
    expectedSha256: "8cee8f1d3715313f0538e99b1f6cb6887945e943ade089022a5d9d2bc8c5a14e",
    originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
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
    predecessorDecreeWorkId: "subreg.th.rc.royal_decree.780",
    supersedesRc7AmendsRd646Id: "asrt.rc7.rd790.amends.rd646",
    supersedesRc7AmendsPrevId: "asrt.rc7.rd790.amends.prev",
    supersedesRc7MadeUnderId: "asrt.rc7.rd790.made_under.rc80",
    sections: [
      {
        sectionKey: "sec_1_2",
        sectionHeadingTh: "ชื่อกฎหมายและวันเริ่มใช้บังคับ (มาตรา ๑ – มาตรา ๒)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗\nให้ไว้ ณ วันที่ ๑๙ กันยายน พ.ศ. ๒๕๖๗ เป็นปีที่ ๙ ในรัชกาลปัจจุบัน\nอาศัยอำนาจตามความในมาตรา ๑๗๕ ของรัฐธรรมนูญแห่งราชอาณาจักรไทย และมาตรา ๘๐ แห่งประมวลรัษฎากร ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ๓๐) พ.ศ. ๒๕๓๔ จึงทรงพระกรุณาโปรดเกล้าฯ ให้ตราพระราชกฤษฎีกาขึ้นไว้ ดังต่อไปนี้\nมาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗”\nมาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๗ เป็นต้นไป",
      },
      {
        sectionKey: "sec_3_amending_clause",
        sectionHeadingTh:
          "มาตรา ๓ แห่ง พ.ร.ฎ. (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗ (บทบัญญัติแก้ไขเพิ่มเติม พ.ร.ฎ. ฉบับที่ ๖๔๖ มาตรา ๔)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "มาตรา ๓ ให้ยกเลิกความในมาตรา ๔ แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๘๐) พ.ศ. ๒๕๖๖ และให้ใช้ความต่อไปนี้แทน",
      },
      {
        sectionKey: "sec_3_quoted_rd646_sec_4",
        sectionHeadingTh:
          "ข้อความแก้ไขแทนที่ในมาตรา ๓: มาตรา ๔ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ (คงจัดเก็บ VAT ร้อยละ ๖.๓ ถึง ๓๐ กันยายน ๒๕๖๘)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๘”\nผู้รับสนองพระบรมราชโองการ แพทองธาร ชินวัตร นายกรัฐมนตรี",
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
    versionId: "ver.th.rc.royal_decree.799.v3",
    versionLabel: "v3_gazette_verified_rc8",
    supersedesVersionIds: ["ver.th.rc.royal_decree.799.v1", "ver.th.rc.royal_decree.799.v2"],
    expectedSha256: "796b9aff527081720587dcf5b378833eb09bac731c3cc941fea382ce18302ba3",
    originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
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
    predecessorDecreeWorkId: "subreg.th.rc.royal_decree.790",
    supersedesRc7AmendsRd646Id: "asrt.rc7.rd799.amends.rd646",
    supersedesRc7AmendsPrevId: "asrt.rc7.rd799.amends.prev",
    supersedesRc7MadeUnderId: "asrt.rc7.rd799.made_under.rc80",
    sections: [
      {
        sectionKey: "sec_1_2",
        sectionHeadingTh: "ชื่อกฎหมายและวันเริ่มใช้บังคับ (มาตรา ๑ – มาตรา ๒)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘\nให้ไว้ ณ วันที่ ๑๓ กันยายน พ.ศ. ๒๕๖๘ เป็นปีที่ ๑๐ ในรัชกาลปัจจุบัน\nอาศัยอำนาจตามความในมาตรา ๑๗๕ ของรัฐธรรมนูญแห่งราชอาณาจักรไทย และมาตรา ๘๐ แห่งประมวลรัษฎากร ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ๓๐) พ.ศ. ๒๕๓๔ จึงทรงพระกรุณาโปรดเกล้าฯ ให้ตราพระราชกฤษฎีกาขึ้นไว้ ดังต่อไปนี้\nมาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘”\nมาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๘ เป็นต้นไป",
      },
      {
        sectionKey: "sec_3_amending_clause",
        sectionHeadingTh:
          "มาตรา ๓ แห่ง พ.ร.ฎ. (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘ (บทบัญญัติแก้ไขเพิ่มเติม พ.ร.ฎ. ฉบับที่ ๖๔๖ มาตรา ๔)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "มาตรา ๓ ให้ยกเลิกความในมาตรา ๔ แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗ และให้ใช้ความต่อไปนี้แทน",
      },
      {
        sectionKey: "sec_3_quoted_rd646_sec_4",
        sectionHeadingTh:
          "ข้อความแก้ไขแทนที่ในมาตรา ๓: มาตรา ๔ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ (คงจัดเก็บ VAT ร้อยละ ๖.๓ ถึง ๓๐ กันยายน ๒๕๖๙)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒",
        statementRole: "statutory_text",
        verbatimTextTh:
          "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๙”\nผู้รับสนองพระบรมราชโองการ ภูมิธรรม เวชยชัย รองนายกรัฐมนตรี",
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
    versionId: "ver.th.rc.royal_decree.807.v3",
    versionLabel: "v3_gazette_verified_rc8",
    supersedesVersionIds: ["ver.th.rc.royal_decree.807.v1", "ver.th.rc.royal_decree.807.v2"],
    expectedSha256: "a4e0c55a2324397af4079317d2a5138fa075fcd87eb9348771742ed7ad6dab70",
    originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf",
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
    predecessorDecreeWorkId: "subreg.th.rc.royal_decree.799",
    supersedesRc7AmendsRd646Id: "asrt.rc7.rd807.amends.rd646",
    supersedesRc7AmendsPrevId: "asrt.rc7.rd807.amends.prev",
    supersedesRc7MadeUnderId: "asrt.rc7.rd807.made_under.rc80",
    sections: [
      {
        sectionKey: "sec_1_2",
        sectionHeadingTh: "ชื่อกฎหมายและวันเริ่มใช้บังคับ (มาตรา ๑ – มาตรา ๒)",
        pageZeroBased: 0,
        printedPageLabel: "หน้า ๒๐",
        statementRole: "statutory_text",
        verbatimTextTh:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙\nให้ไว้ ณ วันที่ ๒๐ สิงหาคม พ.ศ. ๒๕๖๙ เป็นปีที่ ๑๑ ในรัชกาลปัจจุบัน\nอาศัยอำนาจตามความในมาตรา ๑๗๕ ของรัฐธรรมนูญแห่งราชอาณาจักรไทย และมาตรา ๘๐ แห่งประมวลรัษฎากร ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ๓๐) พ.ศ. ๒๕๓๔ จึงทรงพระกรุณาโปรดเกล้าฯ ให้ตราพระราชกฤษฎีกาขึ้นไว้ ดังต่อไปนี้\nมาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙”\nมาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙ เป็นต้นไป",
      },
      {
        sectionKey: "sec_3_amending_clause",
        sectionHeadingTh:
          "มาตรา ๓ แห่ง พ.ร.ฎ. (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙ (บทบัญญัติแก้ไขเพิ่มเติม พ.ร.ฎ. ฉบับที่ ๖๔๖ มาตรา ๔)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "มาตรา ๓ ให้ยกเลิกความในมาตรา ๔ แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ ซึ่งแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘ และให้ใช้ความต่อไปนี้แทน",
      },
      {
        sectionKey: "sec_3_quoted_rd646_sec_4",
        sectionHeadingTh:
          "ข้อความแก้ไขแทนที่ในมาตรา ๓: มาตรา ๔ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ (คงจัดเก็บ VAT ร้อยละ ๖.๓ ถึง ๓๐ กันยายน ๒๕๗๐)",
        pageZeroBased: 1,
        printedPageLabel: "หน้า ๒๑",
        statementRole: "statutory_text",
        verbatimTextTh:
          "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๗๐”\nผู้รับสนองพระบรมราชโองการ อนุทิน ชาญวีรกูล นายกรัฐมนตรี",
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

function loadVerifiedPdfBytes(expectedSha256: string, scratchFileName?: string): Buffer {
  const archivedBin = path.join(ARTIFACTS_DIR, `${expectedSha256}.bin`);
  if (fs.existsSync(archivedBin)) {
    const buf = fs.readFileSync(archivedBin);
    if (sha256Bytes(buf) === expectedSha256) return buf;
  }
  if (scratchFileName) {
    const scratchPath = path.join(SCRATCH_PDF_DIR, scratchFileName);
    if (fs.existsSync(scratchPath)) {
      const buf = fs.readFileSync(scratchPath);
      if (sha256Bytes(buf) === expectedSha256) return buf;
    }
  }
  throw new Error(
    `MISSING_VERIFIED_PDF: expected sha256=${expectedSha256} (checked ${archivedBin} and ${scratchFileName || "n/a"})`
  );
}

async function main() {
  const store = new DurableKnowledgeStore(STORE_DIR);
  const nowIso = new Date().toISOString();
  const beforeState = store.getState();

  const rc7Rel = beforeState.releases["rel.B01.rc7"];
  if (!rc7Rel) {
    throw new Error("Pinned comparison baseline rel.B01.rc7 not found in canonical store!");
  }

  const createdArtifacts: Artifact[] = [];
  const createdWorks: LegalWork[] = [];
  const createdVersions: LegalVersion[] = [];
  const createdExtractions: Extraction[] = [];
  const createdPassages: Passage[] = [];
  const createdAssertions: Assertion[] = [];

  const manifestFingerprintParts: string[] = [
    `parent:${rc7Rel.release_id}:${rc7Rel.manifest_hash}`,
    `dict:${THAI_LEGAL_DICTIONARY_VERSION}:${getThaiLegalDictionarySha256()}`,
    `rc8_graph_semantics:AMENDS_646_vs_SUPERSEDES_predecessor+split_sec3_vs_quoted_sec4`,
  ];

  // 1. Re-version Royal Decree 646 cleanly in `rel.B01.rc8` (`ver.th.rc.royal_decree.646.v2`, superseding `v1` ONLY in rc8!)
  //    Honest provenance: `www.rd.go.th/.../dc646.pdf` is RD's consolidated compilation (base enacted window 2017-10-01..2018-09-30,
  //    superseded from 2018-10-01 onwards by amending decrees 669..807 so it CANNOT govern post-2018-09-30 transactions!).
  const rd646Sha = "a7591ae8a8fbee647b1c9ee3f8ccaff56eb8cd82f9c094e0d62c445866d30776";
  const rd646Bytes = loadVerifiedPdfBytes(rd646Sha, "dc646.pdf");
  const rd646Stored = store.storeImmutableArtifactBytes(rd646Bytes);
  const rd646ArtifactId = `art.rd.consolidated.rd646.${rd646Sha.slice(0, 12)}`;
  manifestFingerprintParts.push(`subreg.th.rc.royal_decree.646:ver.th.rc.royal_decree.646.v2:${rd646Sha}`);

  createdArtifacts.push({
    artifact_id: rd646ArtifactId,
    actual_bytes_sha256: rd646Stored.sha256,
    size: rd646Stored.size,
    MIME: "application/pdf",
    immutable_uri: rd646Stored.immutable_uri,
    fetched_at: nowIso,
    origin_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc646.pdf",
    authenticity_status: "verified_corpus_mirror",
    access_scope: "scope.platform.public",
    rights_status: "approved_public",
    is_derivative: true,
  });

  createdVersions.push({
    version_id: "ver.th.rc.royal_decree.646.v2",
    work_id: "subreg.th.rc.royal_decree.646",
    version_label: "v2_base_window_2017_2018_rd_consolidated_pdf",
    enactment_date: "2017-09-30",
    publication_date: "2017-10-01",
    commencement_date: "2017-10-01",
    covered_transaction_period: {
      from: "2017-10-01",
      to: "2018-09-30",
      basis: "TRANSACTION_OR_EVENT_DATE",
      is_temporary_rule: true,
    },
    royal_gazette_ref: "พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560 (ให้ไว้ ณ วันที่ 30 กันยายน พ.ศ. 2560; ไฟล์ PDF ของกรมสรรพากรเป็นฉบับประมวลแก้ไขเพิ่มเติมถึง พ.ร.ฎ. ฉบับที่ 807)",
    supersedes_version_ids: ["ver.th.rc.royal_decree.646.v1"],
    legal_applicability: [
      {
        valid_from: "2017-10-01",
        valid_to: "2018-09-30",
        conditions: [
          "ช่วงเดิมตาม พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560 คือ 2017-10-01 ถึง 2018-09-30; สำหรับธุรกรรมตั้งแต่ 2018-10-01 เป็นต้นไป มาตรา 4 ถูกยกเลิกและแทนที่โดยพระราชกฤษฎีกาแก้ไขเพิ่มเติมรายปี (เช่น ฉบับที่ 780/790/799/807) จึงใช้เป็นประวัติกฎหมายเท่านั้น ไม่ใช่กฎหมายหลักแทนฉบับแก้ไขล่าสุด",
        ],
        date_status: "verified",
        applicability_basis: "TRANSACTION_OR_EVENT_DATE",
        enactment_effective_date: "2017-10-01",
        is_temporary_rule: true,
      },
    ],
    decision_date: null,
    raw_date_text:
      "ให้ไว้ ณ วันที่ 30 กันยายน พ.ศ. 2560 | ใช้บังคับ 2017-10-01 | ช่วงเดิมก่อนแก้ไขเพิ่มเติม: 2017-10-01 ถึง 2018-09-30 (ฉบับประมวลกรมสรรพากรรวมการแก้ไขโดย พ.ร.ฎ. 807)",
    temporal_evidence_ids: [rd646ArtifactId],
    known_from: nowIso,
    known_to: null,
    is_consolidated_derived: true,
    draft_or_enacted_status: "CONSOLIDATED_DERIVED",
    access_scope: "scope.platform.public",
  });

  const rd646Sec13Text =
    "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐\nให้ไว้ ณ วันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๐ เป็นปีที่ ๒ ในรัชกาลปัจจุบัน\nมาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐”\nมาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ เป็นต้นไป\nมาตรา ๓ ให้ยกเลิกคำสั่งหัวหน้าคณะรักษาความสงบแห่งชาติ ที่ ๖๕/๒๕๕๙ เรื่อง การลดอัตราภาษีมูลค่าเพิ่ม ลงวันที่ ๑ พฤศจิกายน พุทธศักราช ๒๕๕๙";
  const rd646Sec4CompiledText =
    "“มาตรา ๔ ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา ๘๐ แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ๓๐ กันยายน พ.ศ. ๒๕๗๐”\n(หมายเหตุฉบับประมวลกรมสรรพากร: ข้อความมาตรา ๔ นี้เป็นฉบับแก้ไขเพิ่มเติมโดยพระราชกฤษฎีกา (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙ ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙ เป็นต้นไป; ช่วงเดิมของ พ.ร.ฎ. ๖๔๖ คือ ๑ ตุลาคม ๒๕๖๐ – ๓๐ กันยายน ๒๕๖๑)\nมาตรา ๕ ให้รัฐมนตรีว่าการกระทรวงการคลังรักษาการตามพระราชกฤษฎีกานี้";

  const rd646ExtId = `ext.rc8.rd646.${rd646Sha.slice(0, 12)}`;
  const rd646FullText = `${rd646Sec13Text}\n\n${rd646Sec4CompiledText}`;
  createdExtractions.push({
    extraction_id: rd646ExtId,
    artifact_id: rd646ArtifactId,
    work_id: "subreg.th.rc.royal_decree.646",
    version_id: "ver.th.rc.royal_decree.646.v2",
    extractor_version: "reg24-gazette-visual-pdf-v2.0-rc8",
    model_version: "visual-pdf-qa-verified",
    configuration_version: "rc8-gazette-strict-v2",
    raw_text_uri: rd646Stored.immutable_uri,
    raw_text: rd646FullText,
    normalized_text: normalizeTextForThaiLegalSearchField(rd646FullText),
    normalization_log: [
      "Explicitly classified www.rd.go.th dc646.pdf as CONSOLIDATED_DERIVED (embeds RD 807 amendment) with base window 2017-10-01..2018-09-30 so superseded base text never governs post-2018-09-30 transactions",
    ],
    quality_status: "VALIDATED",
    accepted_revision: 1,
    created_at: nowIso,
  });

  const rd646Specs = [
    ["sec_1_3", "มาตรา ๑ – มาตรา ๓ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ (กฎหมายแม่บทฐานเดิม)", rd646Sec13Text],
    ["sec_4_compiled", "มาตรา ๔ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ (ฉบับประมวลกรมสรรพากร — ช่วงเดิม 2017-10-01..2018-09-30)", rd646Sec4CompiledText],
  ] as const;

  for (let i = 0; i < rd646Specs.length; i++) {
    const [key, heading, text] = rd646Specs[i];
    const header = `พระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 — ${heading} (หน้า ๑)`;
    createdPassages.push({
      passage_id: `psg.rc8.rd646.${key}`,
      release_id: RC8_RELEASE_ID,
      work_id: "subreg.th.rc.royal_decree.646",
      version_id: "ver.th.rc.royal_decree.646.v2",
      extraction_id: rd646ExtId,
      statement_role: "statutory_text",
      structural_path: ["พระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560", "v2_base_window_2017_2018_rd_consolidated_pdf", heading],
      exact_text: text,
      contextualized_header: header,
      parent_id: null,
      adjacent_ids: {
        previous_id: i > 0 ? `psg.rc8.rd646.${rd646Specs[i - 1][0]}` : null,
        next_id: i < rd646Specs.length - 1 ? `psg.rc8.rd646.${rd646Specs[i + 1][0]}` : null,
      },
      language: "th",
      token_count: Math.ceil(text.length / 4),
      critical_tokens_flagged: ["6.3", "ร้อยละหกจุดสาม", "ฉบับที่ 646", "2018-09-30"],
      contains_untrusted_instruction_like_text: false,
      search_fields: {
        normalized_identifiers: ["พ.ร.ฎ. (ฉบับที่ 646)", "พระราชกฤษฎีกา ฉบับที่ 646", "rd:646"],
        composite_section_tokens: Array.from(
          new Set(["rd:646", ...extractCompositeLegalTokens(`${header} ${text}`)])
        ),
        normalized_text_arabic: normalizeTextForThaiLegalSearchField(text),
        preserved_negation_tokens: extractPreservedNegationTokens(text),
        legal_field_role: "statutory_text",
      },
      real_locator: {
        kind: "pdf_page",
        artifact_id: rd646ArtifactId,
        origin_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc646.pdf",
        physical_page_index: 0,
        printed_page_label: "หน้า ๑",
      },
      access_scope: "scope.platform.public",
    });
  }

  // 2. Re-version Royal Decrees 780, 790, 799, 807 with split §3 vs quoted RD 646 §4 AND AMENDS vs SUPERSEDES graph edges!
  for (const spec of VERIFIED_AMENDING_DECREES) {
    const bytes = loadVerifiedPdfBytes(spec.expectedSha256, spec.scratchFileName);
    const stored = store.storeImmutableArtifactBytes(bytes);
    const artifactId = `art.gazette.rd${spec.decreeNo}.${spec.expectedSha256.slice(0, 12)}`;
    manifestFingerprintParts.push(`${spec.workId}:${spec.versionId}:${spec.expectedSha256}`);

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

    const existingWork = beforeState.works[spec.workId];
    const arabicTitle = normalizeTextForThaiLegalSearchField(spec.titleTh);
    if (existingWork) {
      createdWorks.push({
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
      });
    }

    createdVersions.push({
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
            `ประกาศใน${spec.royalGazetteRef}; มาตรา ๒ ให้ใช้บังคับตั้งแต่ ${spec.commencementDate}; มาตรา ๓ แก้ไขแทนที่มาตรา ๔ แห่ง พ.ร.ฎ. (ฉบับที่ ๖๔๖) พ.ศ. ๒๕๖๐ คงจัดเก็บภาษีมูลค่าเพิ่มร้อยละ ๖.๓ สำหรับความรับผิดตั้งแต่ ${spec.coveredTxFrom} ถึง ${spec.coveredTxTo} (ช่วงขยายเวลาเฉพาะฉบับนี้: ${spec.governingWindowFrom} ถึง ${spec.governingWindowTo})`,
          ],
          date_status: "verified",
          applicability_basis: "TRANSACTION_OR_EVENT_DATE",
          enactment_effective_date: spec.commencementDate,
          is_temporary_rule: true,
        },
      ],
      decision_date: null,
      raw_date_text: `${spec.royalGazetteRef} | ให้ไว้ ณ วันที่ ${spec.enactmentDate} | ประกาศราชกิจจาฯ ${spec.publicationDate} | ใช้บังคับ ${spec.commencementDate} | ครอบคลุมความรับผิด ${spec.coveredTxFrom} ถึง ${spec.coveredTxTo}`,
      temporal_evidence_ids: [artifactId],
      known_from: nowIso,
      known_to: null,
      is_consolidated_derived: false,
      draft_or_enacted_status: "ENACTED_AMENDMENT",
      access_scope: "scope.platform.public",
    });

    const extractionId = `ext.rc8.gazette.rd${spec.decreeNo}.${spec.expectedSha256.slice(0, 12)}`;
    const fullVerbatim = spec.sections.map((s) => s.verbatimTextTh).join("\n\n");
    createdExtractions.push({
      extraction_id: extractionId,
      artifact_id: artifactId,
      work_id: spec.workId,
      version_id: spec.versionId,
      extractor_version: "reg24-gazette-visual-pdf-v2.0-rc8",
      model_version: "visual-pdf-qa-verified",
      configuration_version: "rc8-gazette-strict-v2",
      raw_text_uri: stored.immutable_uri,
      raw_text: fullVerbatim,
      normalized_text: normalizeTextForThaiLegalSearchField(fullVerbatim),
      normalization_log: [
        "Separately labeled amending decree §3 (`sec_3_amending_clause`) from quoted replacement text of RD 646 §4 (`sec_3_quoted_rd646_sec_4`); preserved verbatim Thai numerals in exact_text and stored normalizations in search_fields",
      ],
      quality_status: "VALIDATED",
      accepted_revision: 1,
      created_at: nowIso,
    });

    const passageByKey: Record<string, string> = {};
    const orderedPids = spec.sections.map((s) => `psg.rc8.rd${spec.decreeNo}.${s.sectionKey}`);
    for (let sIdx = 0; sIdx < spec.sections.length; sIdx++) {
      const sec = spec.sections[sIdx];
      const pid = orderedPids[sIdx];
      passageByKey[sec.sectionKey] = pid;
      const header = `${spec.titleTh} — ${sec.sectionHeadingTh} (${spec.royalGazetteRef})`;
      const compositeToks = Array.from(
        new Set([
          `rd:${spec.decreeNo}`,
          ...extractCompositeLegalTokens(`${header} ${sec.verbatimTextTh}`),
        ])
      );
      createdPassages.push({
        passage_id: pid,
        release_id: RC8_RELEASE_ID,
        work_id: spec.workId,
        version_id: spec.versionId,
        extraction_id: extractionId,
        statement_role: sec.statementRole,
        structural_path: [
          `พระราชกฤษฎีกา (ฉบับที่ ${spec.decreeNo})`,
          spec.versionLabel,
          sec.sectionHeadingTh,
        ],
        exact_text: sec.verbatimTextTh,
        contextualized_header: header,
        parent_id: null,
        adjacent_ids: {
          previous_id: sIdx > 0 ? orderedPids[sIdx - 1] : null,
          next_id: sIdx < orderedPids.length - 1 ? orderedPids[sIdx + 1] : null,
        },
        language: "th",
        token_count: Math.ceil(sec.verbatimTextTh.length / 4),
        critical_tokens_flagged: ["6.3", "ร้อยละหกจุดสาม", spec.coveredTxTo, `ฉบับที่ ${spec.decreeNo}`],
        contains_untrusted_instruction_like_text: false,
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
        real_locator: {
          kind: "pdf_page",
          artifact_id: artifactId,
          origin_uri: spec.originUri,
          physical_page_index: sec.pageZeroBased,
          printed_page_label: sec.printedPageLabel,
        },
        access_scope: "scope.platform.public",
      });
    }

    // Verified RC8 Graph Assertions:
    //   1) MADE_UNDER -> prov.th.rc.80
    //   2) AMENDS -> subreg.th.rc.royal_decree.646 (direct amendment of Decree 646 §4)
    //   3) SUPERSEDES -> predecessor decree (780/790/799 — traceable history ONLY, NEVER governing via link!)
    createdAssertions.push({
      assertion_id: `asrt.rc8.rd${spec.decreeNo}.made_under.rc80`,
      release_id: RC8_RELEASE_ID,
      subject: spec.workId,
      subject_type: "SubordinateLegislation",
      predicate: "MADE_UNDER",
      object: "prov.th.rc.80",
      object_type: "ProvisionVersion",
      qualifications: {
        conditions: [`ออกตามความในประมวลรัษฎากร มาตรา 80 (${spec.governingWindowFrom}..${spec.governingWindowTo})`],
        exceptions: [],
        tax_types: ["VAT"],
        applicable_period: `${spec.governingWindowFrom}..${spec.governingWindowTo}`,
      },
      evidence_ids: [passageByKey.sec_1_2],
      statement_role: "statutory_text",
      state: "ACCEPTED",
      review_id: null,
      validity: { valid_from: spec.governingWindowFrom, valid_to: spec.governingWindowTo },
      confidence: 1.0,
      legal_certainty: "settled_statutory",
      scope: "scope.platform.public",
      ...(spec.supersedesRc7MadeUnderId
        ? { supersedes_assertion_ids: [spec.supersedesRc7MadeUnderId] }
        : {}),
    });

    createdAssertions.push({
      assertion_id: `asrt.rc8.rd${spec.decreeNo}.amends.rd646`,
      release_id: RC8_RELEASE_ID,
      subject: spec.workId,
      subject_type: "SubordinateLegislation",
      predicate: "AMENDS",
      object: "subreg.th.rc.royal_decree.646",
      object_type: "SubordinateLegislation",
      qualifications: {
        conditions: [
          `มาตรา 3 แห่ง พ.ร.ฎ. (ฉบับที่ ${spec.decreeNo}) แก้ไขแทนที่มาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560 ขยายเวลาถึง ${spec.coveredTxTo} (direct amendment of Decree 646 §4)`,
        ],
        exceptions: [],
        tax_types: ["VAT"],
        applicable_period: `${spec.governingWindowFrom}..${spec.governingWindowTo}`,
      },
      evidence_ids: [passageByKey.sec_3_amending_clause, passageByKey.sec_3_quoted_rd646_sec_4],
      statement_role: "statutory_text",
      state: "ACCEPTED",
      review_id: null,
      validity: { valid_from: spec.governingWindowFrom, valid_to: spec.governingWindowTo },
      confidence: 1.0,
      legal_certainty: "settled_statutory",
      scope: "scope.platform.public",
      ...(spec.supersedesRc7AmendsRd646Id
        ? { supersedes_assertion_ids: [spec.supersedesRc7AmendsRd646Id] }
        : {}),
    });

    if (spec.predecessorDecreeWorkId) {
      createdAssertions.push({
        assertion_id: `asrt.rc8.rd${spec.decreeNo}.supersedes.prev`,
        release_id: RC8_RELEASE_ID,
        subject: spec.workId,
        subject_type: "SubordinateLegislation",
        predicate: "SUPERSEDES",
        object: spec.predecessorDecreeWorkId,
        object_type: "SubordinateLegislation",
        qualifications: {
          conditions: [
            `ประวัติกฎหมายเดิมที่ถูกแก้ไขแทนที่ (predecessor history): พ.ร.ฎ. (ฉบับที่ ${spec.decreeNo}) แทนความเดิมในมาตรา 4 แห่ง พ.ร.ฎ. 646 ซึ่งเคยแก้ไขโดย ${spec.predecessorDecreeWorkId} — เก็บไว้เพื่อการอ้างอิงประวัติเท่านั้น ไม่ทำให้ฉบับเดิมเป็นกฎหมายหลักที่ใช้บังคับเมื่อพ้นช่วงเวลา`,
          ],
          exceptions: [],
          tax_types: ["VAT"],
          applicable_period: `${spec.governingWindowFrom}..${spec.governingWindowTo}`,
        },
        evidence_ids: [passageByKey.sec_3_amending_clause],
        statement_role: "statutory_text",
        state: "ACCEPTED",
        review_id: null,
        validity: { valid_from: spec.governingWindowFrom, valid_to: spec.governingWindowTo },
        confidence: 1.0,
        legal_certainty: "settled_statutory",
        scope: "scope.platform.public",
        ...(spec.supersedesRc7AmendsPrevId
          ? { supersedes_assertion_ids: [spec.supersedesRc7AmendsPrevId] }
          : {}),
      });
    }
  }

  const manifestHash = sha256Bytes(manifestFingerprintParts.sort().join("|"));

  await store.transact("CREATE_OR_REFRESH_RC8_CANDIDATE_OVERLAY", (draft) => {
    for (const a of createdArtifacts) draft.artifacts[a.artifact_id] = a;
    for (const w of createdWorks) draft.works[w.work_id] = w;
    for (const v of createdVersions) draft.versions[v.version_id] = v;
    for (const e of createdExtractions) draft.extractions[e.extraction_id] = e;
    for (const p of createdPassages) draft.passages[p.passage_id] = p;
    for (const asrt of createdAssertions) draft.assertions[asrt.assertion_id] = asrt;

    draft.releases[RC8_RELEASE_ID] = {
      release_id: RC8_RELEASE_ID,
      batch_id: "B01",
      manifest_id: RC8_MANIFEST_ID,
      manifest_hash: manifestHash,
      code_commit: "rc10.3-staging-candidate",
      state: "READY_FOR_UAT",
      revision: 8,
      previous_accepted_release_id: "rel.B01.rc7",
      rollback_target_release_id: "rel.B01.rc7",
      supersession_lineage: {
        supersedes_release_id: "rel.B01.rc7",
        supersedes_manifest_id: rc7Rel.manifest_id,
        supersedes_manifest_hash: rc7Rel.manifest_hash,
        prior_release_preserved_state: rc7Rel.state,
        prior_chat_approval_preserved: false,
        explanation:
          "Isolated RC10.3 candidate (rel.B01.rc8) preserving rel.B01.rc6 and rel.B01.rc7 untouched. Distinguishes direct AMENDS of RD 646 §4 from SUPERSEDES predecessor history (780->790->799->807), labels each amending decree's §3 separately from quoted replacement text of RD 646 §4, verifies RD 780 Gazette PDF (2023-10-01..2024-09-30), and bounds RD 646 consolidated text to its base 2017-10-01..2018-09-30 window so superseded base text cannot govern post-2018-09-30 dates.",
      },
      created_work_ids: [],
      created_version_ids: createdVersions.map((v) => v.version_id),
      created_passage_ids: createdPassages.map((p) => p.passage_id),
      created_assertion_ids: createdAssertions.map((a) => a.assertion_id),
      reused_work_ids: [
        "subreg.th.rc.royal_decree.646",
        "subreg.th.rc.royal_decree.780",
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
      coverage_gaps: [
        "Historical VAT reduction decrees between 2018-10-01 and 2023-09-30 (RD 669, 684, 709, 724, 744, 766) are not individually ingested; queries in that window abstain cleanly rather than substituting RD 646/780/790/799/807.",
      ],
      transitions: [
        {
          from: null,
          to: "READY_FOR_UAT",
          actor_id: "engineering.rc10_3@reg24.th",
          at: nowIso,
          revision: 8,
          note: "Built isolated rel.B01.rc8 candidate from rel.B01.rc7 without mutating RC6 or RC7",
        },
      ],
      created_at: beforeState.releases[RC8_RELEASE_ID]?.created_at || nowIso,
      updated_at: nowIso,
    };

    // Pin active_release_id to rel.B01.rc8 for RC10.3 staging candidate
    draft.active_release_id = RC8_RELEASE_ID;
  });

  // 3. Build manifest-pinned projections for rel.B01.rc8 ONLY (preserving rel.B01.rc6 & rel.B01.rc7 projections untouched!)
  const rc8Receipts = await buildReleaseProjectionsFromOutbox(store, RC8_RELEASE_ID, "durable_disk", {
    vectorMode: "deliberately_disabled",
  });
  const diagRc7 = inspectReleaseProjectionDiagnostics(store, "rel.B01.rc7");
  const diagRc8 = inspectReleaseProjectionDiagnostics(store, RC8_RELEASE_ID);
  const parityProbeRc8 = runTokenizerParityProbe(store, RC8_RELEASE_ID);

  // Verify RC7 and RC6 remained untouched!
  const rc7Passages = store.getPassagesForRelease("rel.B01.rc7");
  const rc8Passages = store.getPassagesForRelease(RC8_RELEASE_ID);
  const rc7Assertions = store.getAcceptedAssertionsForRelease("rel.B01.rc7");
  const rc8Assertions = store.getAcceptedAssertionsForRelease(RC8_RELEASE_ID);

  const sourceMapOut = {
    schema_version: "1.0-rc8-legal-source-and-graph-map",
    generated_at: nowIso,
    release_id: RC8_RELEASE_ID,
    manifest_id: RC8_MANIFEST_ID,
    manifest_hash: manifestHash,
    preserved_comparison_baseline: {
      release_id: "rel.B01.rc7",
      manifest_id: diagRc7.manifest_id,
      manifest_hash: diagRc7.manifest_hash,
      rc7_has_rd790_v1: rc7Passages.some((p) => p.version_id === "ver.th.rc.royal_decree.790.v1"),
      rc7_has_rd807_v2: rc7Passages.some((p) => p.version_id === "ver.th.rc.royal_decree.807.v2"),
      rc7_has_rd646_v1: rc7Passages.some((p) => p.version_id === "ver.th.rc.royal_decree.646.v1"),
      rc7_has_old_amends_prev_edges: rc7Assertions.some((a) => a.assertion_id === "asrt.rc7.rd807.amends.prev"),
    },
    rc8_projections: {
      receipts: rc8Receipts,
      lexical_index_sha256: diagRc8.lexical.lexical_index_sha256,
      tokenizer_engine: diagRc8.lexical.tokenizer_engine,
      tokenizer_contract_sha256: diagRc8.lexical.tokenizer_contract_sha256,
      legal_dictionary_sha256: diagRc8.lexical.legal_dictionary_sha256,
      vector_status: diagRc8.vector.status,
      tokenizer_parity_passed:
        parityProbeRc8.contract_parity_ok && parityProbeRc8.all_probes_ok,
    },
    rc8_graph_distinction: {
      direct_amendment_edges: rc8Assertions
        .filter((a) => a.predicate === "AMENDS" && /royal_decree\.(780|790|799|807)$/.test(a.subject))
        .map((a) => ({
          assertion_id: a.assertion_id,
          subject: a.subject,
          predicate: a.predicate,
          object: a.object,
          evidence_ids: a.evidence_ids,
          applicable_period: a.qualifications.applicable_period,
        })),
      predecessor_history_edges: rc8Assertions
        .filter((a) => a.predicate === "SUPERSEDES" && /royal_decree\.(790|799|807)$/.test(a.subject))
        .map((a) => ({
          assertion_id: a.assertion_id,
          subject: a.subject,
          predicate: a.predicate,
          object: a.object,
          evidence_ids: a.evidence_ids,
          applicable_period: a.qualifications.applicable_period,
        })),
      zero_legacy_amends_prev_edges_in_rc8: !rc8Assertions.some((a) =>
        /^asrt\.rc7\.rd\d+\.amends\.prev$/.test(a.assertion_id)
      ),
    },
    decrees: [
      {
        work_id: "subreg.th.rc.royal_decree.646",
        version_id: "ver.th.rc.royal_decree.646.v2",
        status: "CONSOLIDATED_DERIVED (base window 2017-10-01..2018-09-30; superseded history for post-2018-09-30)",
        official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc646.pdf",
        repo_archived_pdf_path: `data/knowledge-store-b01-rc2-staging/artifacts/${rd646Sha}.bin`,
        sha256: rd646Sha,
        enactment_date: "2017-09-30",
        publication_date: "2017-10-01",
        commencement_date: "2017-10-01",
        active_governing_window: { valid_from: "2017-10-01", valid_to: "2018-09-30", is_temporary_rule: true },
        passages: ["psg.rc8.rd646.sec_1_3", "psg.rc8.rd646.sec_4_compiled"],
      },
      ...VERIFIED_AMENDING_DECREES.map((d) => ({
        work_id: d.workId,
        version_id: d.versionId,
        status: "ENACTED_AMENDMENT (official Royal Gazette original)",
        official_url: d.originUri,
        repo_archived_pdf_path: `data/knowledge-store-b01-rc2-staging/artifacts/${d.expectedSha256}.bin`,
        sha256: d.expectedSha256,
        royal_gazette_ref: d.royalGazetteRef,
        enactment_date: d.enactmentDate,
        publication_date: d.publicationDate,
        commencement_date: d.commencementDate,
        covered_transaction_period: { from: d.coveredTxFrom, to: d.coveredTxTo },
        active_governing_window: {
          valid_from: d.governingWindowFrom,
          valid_to: d.governingWindowTo,
          is_temporary_rule: true,
        },
        separately_labeled_passages: d.sections.map((s) => ({
          passage_id: `psg.rc8.rd${d.decreeNo}.${s.sectionKey}`,
          section_key: s.sectionKey,
          heading_th: s.sectionHeadingTh,
          pdf_page_zero_based: s.pageZeroBased,
          printed_page: s.printedPageLabel,
        })),
      })),
    ],
    counts: {
      rc7_passages: rc7Passages.length,
      rc8_passages: rc8Passages.length,
      rc7_assertions: rc7Assertions.length,
      rc8_assertions: rc8Assertions.length,
    },
  };

  const outDir = path.resolve(process.cwd(), "docs/batch1-rc10.3-evidence");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "verified_royal_decrees_rc8_source_and_graph_map.json");
  fs.writeFileSync(outPath, JSON.stringify(sourceMapOut, null, 2), "utf8");
  console.log(JSON.stringify(sourceMapOut, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
