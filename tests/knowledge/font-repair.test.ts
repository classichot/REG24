import { describe, it, expect } from "vitest";
import { classifyPage } from "../../src/core/knowledge/page-routing";
import { repairPage } from "../../src/core/knowledge/font-repair";

describe("Audit Font Repair & Duplicate Span Cleanup Contract (AT19, AT21)", () => {
  it("AT19: TISI-like page with garbled native glyphs fails NATIVE route; font-bound repair succeeds ONLY for benchmarked font fingerprint, while unknown font falls back to OCR/REVIEW", async () => {
    // TISI Latin-1 shifted Thai: "มาตรา 65" where Thai chars U+0E21.. shifted by -3424 into 0xA1..0xFB
    const shiftToLatin1 = (thai: string) =>
      Array.from(thai)
        .map((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 0x0e01 && code <= 0x0e5b ? String.fromCharCode(code - 3424) : ch;
        })
        .join("");

    const garbledTisiText = shiftToLatin1("มาตรา 65 การคำนวณกำไรสุทธิ");

    const decision = await classifyPage({
      artifact_id: "art_tisi_01",
      actual_bytes_sha256: "d".repeat(64),
      source_file_id: "drv_tisi_01",
      source_revision: "r1",
      total_physical_pages: 1,
      physical_page_index: 0,
      printed_page_label: "1",
      native_spans: [
        {
          span_id: "sp_tisi_1",
          text: garbledTisiText,
          bbox: [72, 100, 500, 140],
          font_fingerprint: "fp.tisi_legacy_tis620_latin1_shift_v1",
        },
      ],
      image_regions: [],
      config_version: "route.v1.1",
    });

    expect(decision.route).not.toBe("NATIVE");
    expect(decision.route).toBe("REPAIR");

    // Known benchmarked font fingerprint -> deterministic verified repair, preserving raw text
    const repairedKnown = await repairPage({
      page_id: "art_tisi_01:0",
      artifact_id: "art_tisi_01",
      physical_page_index: 0,
      raw_spans: [
        {
          span_id: "sp_tisi_1",
          text: garbledTisiText,
          bbox: [72, 100, 500, 140],
          font_fingerprint: "fp.tisi_legacy_tis620_latin1_shift_v1",
        },
      ],
      font_registry_version: "font-map.v1.1.0",
    });

    expect(repairedKnown.status).toBe("REPAIRED_VERIFIED");
    expect(repairedKnown.raw_text_preserved).toBe(garbledTisiText);
    expect(repairedKnown.repaired_text).toBe("มาตรา 65 การคำนวณกำไรสุทธิ");

    // Unverified / unknown font fingerprint -> MUST NOT blindly substitute; falls back to OCR
    const repairedUnknown = await repairPage({
      page_id: "art_tisi_unknown:0",
      artifact_id: "art_tisi_unknown",
      physical_page_index: 0,
      raw_spans: [
        {
          span_id: "sp_unmapped",
          text: garbledTisiText,
          bbox: [72, 100, 500, 140],
          font_fingerprint: "fp.unregistered_mystery_font_99",
        },
      ],
      font_registry_version: "font-map.v1.1.0",
    });

    expect(repairedUnknown.status).toBe("FALLBACK_TO_OCR");
    expect(repairedUnknown.repaired_text).toBeNull();
  });

  it("AT21: Coordinate-aware duplicate-span cleanup removes overlapping extraction shadows while preserving genuine repeated Thai legal wording", async () => {
    const res = await repairPage({
      page_id: "art_cos_dup:0",
      artifact_id: "art_cos_dup",
      physical_page_index: 0,
      raw_spans: [
        // Overlapping bold-shadow duplicate at identical coordinates [72, 100, 300, 120] and [72.5, 100.2, 300.5, 120.2]
        {
          span_id: "sp_shadow_1",
          text: "มาตรา 77/1",
          bbox: [72, 100, 300, 120],
          font_fingerprint: "fp.thsarabun_clean",
        },
        {
          span_id: "sp_shadow_2",
          text: "มาตรา 77/1",
          bbox: [72.5, 100.2, 300.5, 120.2],
          font_fingerprint: "fp.thsarabun_clean",
        },
        // Genuine repeated Thai wording "เป็นไปตามหลักเกณฑ์และเงื่อนไข ... เป็นไปตามหลักเกณฑ์และเงื่อนไข" at distinct non-overlapping lines!
        {
          span_id: "sp_line_2",
          text: "ทั้งนี้ ให้เป็นไปตามหลักเกณฑ์และเงื่อนไขที่อธิบดีประกาศกำหนด",
          bbox: [72, 150, 520, 170],
          font_fingerprint: "fp.thsarabun_clean",
        },
        {
          span_id: "sp_line_3",
          text: "ทั้งนี้ ให้เป็นไปตามหลักเกณฑ์และเงื่อนไขที่อธิบดีประกาศกำหนดสำหรับผู้ส่งออก",
          bbox: [72, 190, 540, 210],
          font_fingerprint: "fp.thsarabun_clean",
        },
      ],
      font_registry_version: "font-map.v1.1.0",
    });

    expect(res.duplicate_spans_removed).toBe(1);
    expect(res.legitimate_repeats_preserved).toBeGreaterThanOrEqual(1);
    // "มาตรา 77/1" appears ONCE, while both distinct lines with repeated legal phrasing survive intact!
    expect(res.repaired_text?.match(/มาตรา 77\/1/g)?.length).toBe(1);
    expect(res.repaired_text).toContain("ที่อธิบดีประกาศกำหนด ทั้งนี้ ให้เป็นไปตามหลักเกณฑ์และเงื่อนไขที่อธิบดีประกาศกำหนดสำหรับผู้ส่งออก");
  });
});
