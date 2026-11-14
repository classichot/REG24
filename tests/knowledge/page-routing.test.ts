import { describe, it, expect } from "vitest";
import { classifyPage } from "../../src/core/knowledge/page-routing";

describe("Audit Page Routing Contract (AT10, AT20, AT22)", () => {
  it("AT20: Mixed PDF with good opening native pages and scan/corrupt tail classifies every page individually and invokes OCR only on failing regions/pages", async () => {
    const p0 = await classifyPage({
      artifact_id: "art_mixed_01",
      actual_bytes_sha256: "a".repeat(64),
      source_file_id: "drv_mixed_01",
      source_revision: "r1",
      total_physical_pages: 3,
      physical_page_index: 0,
      printed_page_label: "1",
      native_spans: [
        {
          span_id: "sp_01",
          text: "มาตรา 80/1 ให้ใช้อัตราภาษีร้อยละ 0 ในการคำนวณภาษีมูลค่าเพิ่ม สำหรับการส่งออกสินค้า",
          bbox: [72, 100, 520, 220],
          font_fingerprint: "fp.thsarabun_clean",
        },
      ],
      image_regions: [],
      config_version: "route.v1.1",
    });

    const p1Mixed = await classifyPage({
      artifact_id: "art_mixed_01",
      actual_bytes_sha256: "a".repeat(64),
      source_file_id: "drv_mixed_01",
      source_revision: "r1",
      total_physical_pages: 3,
      physical_page_index: 1,
      printed_page_label: "2",
      native_spans: [
        {
          span_id: "sp_02_hdr",
          text: "ข้อ 2 หลักเกณฑ์และเงื่อนไขการส่งผลของการบริการไปใช้ในต่างประเทศ",
          bbox: [72, 80, 520, 140],
          font_fingerprint: "fp.thsarabun_clean",
        },
      ],
      image_regions: [
        {
          region_id: "img_tbl_01",
          bbox: [72, 180, 520, 680],
          kind: "table_image",
        },
      ],
      config_version: "route.v1.1",
    });

    const p2ScanTail = await classifyPage({
      artifact_id: "art_mixed_01",
      actual_bytes_sha256: "a".repeat(64),
      source_file_id: "drv_mixed_01",
      source_revision: "r1",
      total_physical_pages: 3,
      physical_page_index: 2,
      printed_page_label: "3",
      native_spans: [],
      image_regions: [
        {
          region_id: "img_scan_03",
          bbox: [0, 0, 595, 842],
          kind: "scanned_body",
        },
      ],
      config_version: "route.v1.1",
    });

    expect(p0.page_id).toBe("art_mixed_01:0");
    expect(p0.route).toBe("NATIVE");
    expect(p0.region_decisions.every((d) => d.action !== "INVOKE_OCR")).toBe(true);

    expect(p1Mixed.route).toBe("MIXED");
    expect(p1Mixed.region_decisions).toEqual(
      expect.arrayContaining([
        { region_or_span_id: "sp_02_hdr", action: "KEEP_NATIVE" },
        { region_or_span_id: "img_tbl_01", action: "INVOKE_OCR" },
      ])
    );

    expect(p2ScanTail.route).toBe("OCR");
  });

  it("AT22: Blank page, substantive cover/seal, and image-only legal text — NONCONTENT_CONFIRMED applies ONLY to confirmed blank/decorative pages, never seals, signatures, or handwriting", async () => {
    const confirmedBlank = await classifyPage({
      artifact_id: "art_at22",
      actual_bytes_sha256: "b".repeat(64),
      source_file_id: "drv_at22",
      source_revision: "r1",
      total_physical_pages: 3,
      physical_page_index: 0,
      printed_page_label: null,
      native_spans: [],
      image_regions: [
        {
          region_id: "dec_1",
          bbox: [10, 10, 585, 832],
          kind: "decorative_border",
        },
      ],
      is_visually_blank_canvas: true,
      config_version: "route.v1.1",
    });

    const coverWithSealAndSignature = await classifyPage({
      artifact_id: "art_at22",
      actual_bytes_sha256: "b".repeat(64),
      source_file_id: "drv_at22",
      source_revision: "r1",
      total_physical_pages: 3,
      physical_page_index: 1,
      printed_page_label: "ปก",
      native_spans: [],
      image_regions: [
        {
          region_id: "seal_1",
          bbox: [200, 100, 380, 260],
          kind: "seal_or_stamp",
        },
        {
          region_id: "sig_1",
          bbox: [320, 620, 500, 700],
          kind: "signature",
        },
      ],
      is_visually_blank_canvas: false,
      config_version: "route.v1.1",
    });

    const imageOnlyLegalText = await classifyPage({
      artifact_id: "art_at22",
      actual_bytes_sha256: "b".repeat(64),
      source_file_id: "drv_at22",
      source_revision: "r1",
      total_physical_pages: 3,
      physical_page_index: 2,
      printed_page_label: "1",
      native_spans: [],
      image_regions: [
        {
          region_id: "scan_legal_1",
          bbox: [40, 40, 555, 800],
          kind: "scanned_body",
        },
      ],
      config_version: "route.v1.1",
    });

    expect(confirmedBlank.route).toBe("NONCONTENT_CONFIRMED");
    expect(coverWithSealAndSignature.route).not.toBe("NONCONTENT_CONFIRMED");
    expect(["OCR", "REVIEW"]).toContain(coverWithSealAndSignature.route);
    expect(imageOnlyLegalText.route).toBe("OCR");
  });

  it("AT10: Critical negation/number uncertainty routes page to REVIEW quarantine rather than NATIVE acceptance", async () => {
    const uncertainPage = await classifyPage({
      artifact_id: "art_at10",
      actual_bytes_sha256: "c".repeat(64),
      source_file_id: "drv_at10",
      source_revision: "r1",
      total_physical_pages: 1,
      physical_page_index: 0,
      printed_page_label: "1",
      native_spans: [
        {
          span_id: "sp_uncertain",
          text: "บริษัท ก. ไม่ได้รับยกเว้นภาษีมูลค่าเพิ่มร้อยละ 7 ตามมาตรา 81",
          bbox: [72, 120, 520, 200],
          font_fingerprint: "fp.thsarabun_clean",
        },
      ],
      image_regions: [],
      has_uncertain_critical_tokens: true,
      config_version: "route.v1.1",
    });

    expect(uncertainPage.route).toBe("REVIEW");
    expect(uncertainPage.requires_review).toBe(true);
    expect(uncertainPage.quality_measurements.critical_tokens_detected).toEqual(
      expect.arrayContaining(["ไม่ได้", "ร้อยละ 7", "มาตรา 81"])
    );
  });
});
