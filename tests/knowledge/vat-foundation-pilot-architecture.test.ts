import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  COMMENTARY_EDITION_CUTOFF_ISO,
  consultVatTaxFoundationLayer,
  evaluateCommentaryPageTextQuality,
  resolveFoundationLinksAgainstCanonicalStore,
  VOLUME_2_PART_1_DRIVE_FILE_ID,
} from "../../src/core/knowledge/tax-foundation-layer";
import { verifyClaimAgainstPassages } from "../../src/core/knowledge/answer-verification";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import { runVatFoundationPilotIntake } from "../../scripts/ingest-vat-foundation-pilot";
import type { Actor, Passage } from "../../src/core/knowledge/contracts";

const LEGAL_TEST_ACTOR: Actor = {
  actor_id: "legal.vat.pilot@reg24.th",
  role: "reader",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Separate Mission: Thai Tax Foundation (VAT Pilot) Isolation, Dual Locators, Non-Controlling Guard & A/B Benefit", () => {
  let stagingStore: DurableKnowledgeStore;
  const protectedStoreGz = path.resolve(
    process.cwd(),
    "data/knowledge-store/canonical-state.json.gz"
  );

  beforeAll(() => {
    stagingStore = new DurableKnowledgeStore(
      path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging")
    );
    runVatFoundationPilotIntake({
      stagingStoreDir: path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging"),
    });
  }, 60_000);

  afterEach(() => {
    setDefaultKnowledgeStoreForTesting(null);
  });

  it("1. Source Prep: Routes clean native Thai PDF text to NATIVE_TEXT (0 OCR) and triggers SELECTIVE_OCR only on image-scanned/garbled pages", () => {
    const cleanPage = evaluateCommentaryPageTextQuality({
      pdfPageNumber: 27,
      rawNativeText:
        "บทที่ 4 ภาษีมูลค่าเพิ่ม หน้า 4-001 ผู้ประกอบการที่ขายสินค้าหรือให้บริการในทางธุรกิจหรือวิชาชีพในราชอาณาจักร มีหน้าที่เสียภาษีมูลค่าเพิ่มตามมาตรา 77/2 แห่งประมวลรัษฎากร",
    });
    expect(cleanPage.recommended_route).toBe("NATIVE_TEXT");
    expect(cleanPage.printed_page_detected).toBe("4-001");
    expect(cleanPage.pdf_page_number).toBe(27);

    const scannedPage = evaluateCommentaryPageTextQuality({
      pdfPageNumber: 28,
      rawNativeText: "   ",
    });
    expect(scannedPage.recommended_route).toBe("SELECTIVE_OCR");
  });

  it("2. Dual Locators & Link Classification: Preserves chapter, section, printed page (4-001) and PDF page (27) separately; separates VERIFIED_LINK from CANDIDATE_LINK and flags post-May-2018 amendments", () => {
    const state = stagingStore.getState();
    const locator = {
      volume_no: 2,
      part_no: 1,
      chapter_no: "4",
      chapter_title_th: "ภาษีมูลค่าเพิ่ม",
      section_code: "4.3",
      section_title_th: "อัตราภาษีมูลค่าเพิ่มและการส่งออกบริการ",
      subsection_path: ["บทที่ 4", "4.3"],
      printed_page: "4-032",
      pdf_file_id: VOLUME_2_PART_1_DRIVE_FILE_ID,
      pdf_filename: "Volume_2_Part_1.pdf",
      pdf_page_number: 58,
      extraction_method: "NATIVE_TEXT" as const,
    };

    const resolved = resolveFoundationLinksAgainstCanonicalStore({
      state,
      rawLinks: [
        {
          target_kind: "REVENUE_CODE_PROVISION",
          raw_authority_label_th: "ประมวลรัษฎากร มาตรา 80/1",
          candidate_work_id: "prov.th.rc.80/1",
          link_source_locator: locator,
          source_excerpt_text: "มาตรา 80/1 อัตราร้อยละ 0",
          link_rationale_th: "บทบัญญัติหลักอัตราร้อยละ 0",
        },
        {
          target_kind: "SUBORDINATE_REGULATION",
          raw_authority_label_th: "ประกาศอธิบดีฯ VAT (ฉบับที่ 40)",
          candidate_work_id: "subreg.th.rd.dg_vat.40_not_yet_onboarded",
          link_source_locator: locator,
          source_excerpt_text: "ประกาศอธิบดีฯ (ฉบับที่ 40)",
          link_rationale_th: "ของแถมไม่เกินมูลค่าสินค้าที่ขาย",
        },
      ],
    });

    expect(resolved[0].verification_status).toBe("VERIFIED_LINK");
    expect(resolved[0].post_2018_05_status).toBe("AMENDED_OR_EXTENDED_POST_2018_05");
    expect(resolved[0].post_2018_05_override_work_ids).toContain("statute.th.rc_amendment_49_2562");
    expect(resolved[0].link_source_locator.printed_page).toBe("4-032");
    expect(resolved[0].link_source_locator.pdf_page_number).toBe(58);
    expect(resolved[0].link_source_locator.chapter_no).toBe("4");

    expect(resolved[1].verification_status).toBe("CANDIDATE_LINK");
    expect(resolved[1].verified_version_id).toBeNull();
    expect(COMMENTARY_EDITION_CUTOFF_ISO).toBe("2018-05-31");
  });

  it("3. Non-Controlling Commentary Guard: Blocks any claim supported solely by secondary_commentary without a primary official authority", () => {
    const commentaryPassage: Passage = {
      passage_id: "psg.commentary.vat.4_001",
      work_id: "commentary.th.rc_explained.v2p1",
      version_id: "ver.commentary.2018_05",
      extraction_id: "ext.commentary.1",
      release_id: "rel.B01.rc6",
      exact_text: "การส่งออกบริการต้องเป็นการใช้บริการในต่างประเทศทั้งหมดจึงจะได้สิทธิอัตราร้อยละ 0",
      contextualized_header: "คำอธิบายประมวลรัษฎากร เล่ม 2 ตอนที่ 1 หน้า 4-032 (PDF หน้า 58)",
      real_locator: {
        kind: "pdf_page",
        artifact_id: "art.commentary.v2p1",
        origin_uri: `https://drive.google.com/file/d/${VOLUME_2_PART_1_DRIVE_FILE_ID}/view`,
        physical_page_index: 57,
        printed_page_label: "4-032",
      },
      structural_path: ["บทที่ 4", "4.3", "4-032"],
      parent_id: null,
      adjacent_ids: { previous_id: null, next_id: null },
      language: "th",
      statement_role: "secondary_commentary",
      token_count: 25,
      critical_tokens_flagged: [],
      contains_untrusted_instruction_like_text: false,
      access_scope: "scope.platform.public",
    };

    const outcome = verifyClaimAgainstPassages(
      {
        statement: "การส่งออกบริการต้องเป็นการใช้บริการในต่างประเทศทั้งหมดจึงจะได้สิทธิอัตราร้อยละ 0",
        supporting_passage_ids: [commentaryPassage.passage_id],
      },
      [commentaryPassage]
    );
    expect(outcome.allow_confident_answer).toBe(false);
    expect(outcome.reason).toBe("COMMENTARY_CANNOT_SERVE_AS_CONTROLLING_AUTHORITY");
  });

  it("4. Controlled Staging A/B Comparison: Proves measurable benefit on ambiguous & compound unseen VAT cases without mutating canonical store or citing commentary as law", async () => {
    setDefaultKnowledgeStoreForTesting(stagingStore);

    // Unseen Case A: Cross-border service where taxpayer omits WHERE the service output is used!
    const ambiguousExportQ =
      "บริษัท เทคสเฟียร์ จำกัด (ผู้ประกอบการจดทะเบียน VAT ในไทย) รับจ้างออกแบบระบบซอฟต์แวร์จากกรุงเทพฯ ให้แก่บริษัทแม่ในประเทศญี่ปุ่นเมื่อวันที่ 5 เมษายน 2569 สามารถใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 0 สำหรับการส่งออกบริการได้ทันทีหรือไม่";

    const withoutFoundation = await queryKnowledge(
      { question: ambiguousExportQ, enable_tax_foundation_pilot: false },
      LEGAL_TEST_ACTOR
    );
    const withFoundation = await queryKnowledge(
      { question: ambiguousExportQ, enable_tax_foundation_pilot: true },
      LEGAL_TEST_ACTOR
    );

    // With VAT foundation enabled, REG24 catches the missing decisive territoriality condition (place of use!) and asks for clarification while citing primary official law `prov.th.rc.80/1` + `subreg.th.rd.dg_vat.105`!
    expect(withFoundation.status).toBe("NEEDS_CLARIFICATION");
    expect(withFoundation.clarification_questions.join(" ")).toContain("ใช้ในต่างประเทศทั้งหมด");
    expect(withFoundation.evidence.map((e) => e.work_id)).toEqual(
      expect.arrayContaining(["prov.th.rc.80/1", "subreg.th.rd.dg_vat.105"])
    );
    expect(
      withFoundation.evidence.some((e) => e.statement_role === "secondary_commentary")
    ).toBe(false);
    expect(withoutFoundation.execution_provenance?.configuration.tax_foundation_pilot_enabled).toBe(
      false
    );
    expect(withFoundation.execution_provenance?.configuration.tax_foundation_pilot_enabled).toBe(
      true
    );

    // Unseen Case B: Promotional free goods bundled with sale (`มาตรา 77/1` + `มาตรา 79`, while quarantining unverified `ฉบับที่ 40` as CANDIDATE_LINK!)
    const promoQ =
      "บริษัทผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม นำสินค้าของบริษัทไปแถมสินค้าให้ลูกค้าพร้อมกับการขายสินค้าตามปกติในเดือนพฤษภาคม 2568 ต้องนำมูลค่าของแถมมารวมคำนวณฐานภาษีมูลค่าเพิ่มหรือไม่";
    const promoWithFoundation = await queryKnowledge(
      { question: promoQ, enable_tax_foundation_pilot: true },
      LEGAL_TEST_ACTOR
    );
    const citedPromoWorks = promoWithFoundation.evidence.map((e) => e.work_id);
    expect(citedPromoWorks).toEqual(expect.arrayContaining(["prov.th.rc.77/1", "prov.th.rc.79"]));
    expect(citedPromoWorks).not.toContain("subreg.th.rd.dg_vat.40_unverified_candidate");

    // Protected baseline store remains byte-identical
    const sha = crypto
      .createHash("sha256")
      .update(fs.readFileSync(protectedStoreGz))
      .digest("hex");
    expect(sha).toBe("08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9");
  });
});
