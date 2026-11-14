/**
 * REG24 — Audit-Driven 5-Route Page Classifier (`classifyPage`)
 * Implements 03_OCR_AUDIT_ADJUSTMENTS.md Section 3 (AT10, AT19, AT20, AT21, AT22).
 */

import type { PageProbeInput, PageRouteDecision } from "./contracts";
import {
  deduplicateOverlappingSpans,
  hasGarbledOrPuaGlyphs,
  isRegisteredVerifiedFontFingerprint,
} from "./font-repair";

export function detectCriticalLegalTokens(text: string): string[] {
  const found = new Set<string>();
  const patterns: RegExp[] = [
    /ไม่ได้|มิได้|มิให้|ไม่ต้อง|เว้นแต่|ยกเว้น/g,
    /ร้อยละ\s*[0-9๐-๙]+(?:\.[0-9๐-๙]+)?/g,
    /มาตรา\s*[0-9๐-๙]+(?:\/[0-9๐-๙]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?/g,
    /กค\s*[0-9๐-๙]{4}(?:\([^)]+\))?\s*\/\s*(?:พ\.\s*)?[0-9๐-๙]+/g,
    /พ\.ศ\.\s*[0-9๐-๙]{4}/g,
  ];
  for (const re of patterns) {
    const matches = text.match(re) || [];
    for (const m of matches) {
      found.add(m.replace(/\s+/g, " ").trim());
    }
  }
  return Array.from(found);
}

function measureTextQuality(text: string): {
  thai_char_ratio: number;
  corrupt_glyph_ratio: number;
} {
  const nonWs = Array.from(text).filter((c) => !/\s/.test(c));
  if (nonWs.length === 0) {
    return { thai_char_ratio: 0, corrupt_glyph_ratio: 0 };
  }
  let thaiCount = 0;
  let corruptCount = 0;
  for (const ch of nonWs) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0e00 && code <= 0x0e7f) thaiCount += 1;
    if (
      (code >= 0xf700 && code <= 0xf71f) ||
      (code >= 0x00a1 && code <= 0x00fb) ||
      code === 0xfffd
    ) {
      corruptCount += 1;
    }
  }
  return {
    thai_char_ratio: Number((thaiCount / nonWs.length).toFixed(4)),
    corrupt_glyph_ratio: Number((corruptCount / nonWs.length).toFixed(4)),
  };
}

export async function classifyPage(input: PageProbeInput): Promise<PageRouteDecision> {
  const pageId = `${input.artifact_id}:${input.physical_page_index}`;
  const fullRawText = input.native_spans.map((s) => s.text).join(" ").trim();
  const quality = measureTextQuality(fullRawText);
  const criticalTokens = detectCriticalLegalTokens(fullRawText);
  const dedup = deduplicateOverlappingSpans(input.native_spans);

  const substantiveImageRegions = input.image_regions.filter(
    (r) => r.kind !== "decorative_border"
  );
  const hasSealSigOrHandwriting = substantiveImageRegions.some(
    (r) => r.kind === "seal_or_stamp" || r.kind === "signature" || r.kind === "handwriting"
  );

  // 1. NONCONTENT_CONFIRMED: ONLY when visually blank or purely decorative, with zero native text and zero seals/signatures/handwriting/body scans (AT22)
  if (
    fullRawText.length === 0 &&
    substantiveImageRegions.length === 0 &&
    input.is_visually_blank_canvas === true
  ) {
    return {
      page_id: pageId,
      artifact_id: input.artifact_id,
      physical_page_index: input.physical_page_index,
      route: "NONCONTENT_CONFIRMED",
      reason_codes: ["CONFIRMED_BLANK_OR_DECORATIVE_ONLY"],
      region_decisions: input.image_regions.map((r) => ({
        region_or_span_id: r.region_id,
        action: "SKIP_DECORATIVE" as const,
      })),
      quality_measurements: {
        ...quality,
        duplicate_overlap_spans: 0,
        critical_tokens_detected: [],
      },
      matched_font_fingerprint: null,
      requires_review: false,
      config_version: input.config_version,
    };
  }

  // 2. No native text at all -> check for seals/signatures vs body scans (AT20, AT22)
  if (fullRawText.length === 0) {
    if (substantiveImageRegions.length === 0) {
      // Unconfirmed empty text without blank-canvas confirmation -> REVIEW (never silently skip!)
      return {
        page_id: pageId,
        artifact_id: input.artifact_id,
        physical_page_index: input.physical_page_index,
        route: "REVIEW",
        reason_codes: ["EMPTY_TEXT_WITHOUT_BLANK_CONFIRMATION"],
        region_decisions: [],
        quality_measurements: {
          ...quality,
          duplicate_overlap_spans: 0,
          critical_tokens_detected: [],
        },
        matched_font_fingerprint: null,
        requires_review: true,
        config_version: input.config_version,
      };
    }

    return {
      page_id: pageId,
      artifact_id: input.artifact_id,
      physical_page_index: input.physical_page_index,
      route: "OCR",
      reason_codes: hasSealSigOrHandwriting
        ? ["NO_NATIVE_TEXT_WITH_SEAL_OR_SIGNATURE_REQUIRES_OCR"]
        : ["IMAGE_ONLY_LEGAL_CONTENT_REQUIRES_OCR"],
      region_decisions: substantiveImageRegions.map((r) => ({
        region_or_span_id: r.region_id,
        action: "INVOKE_OCR" as const,
      })),
      quality_measurements: {
        ...quality,
        duplicate_overlap_spans: 0,
        critical_tokens_detected: [],
      },
      matched_font_fingerprint: null,
      requires_review: hasSealSigOrHandwriting,
      config_version: input.config_version,
    };
  }

  // 3. Critical token uncertainty flag -> REVIEW quarantine (AT10)
  if (input.has_uncertain_critical_tokens) {
    return {
      page_id: pageId,
      artifact_id: input.artifact_id,
      physical_page_index: input.physical_page_index,
      route: "REVIEW",
      reason_codes: ["CRITICAL_NEGATION_OR_NUMERIC_TOKEN_UNCERTAIN"],
      region_decisions: input.native_spans.map((s) => ({
        region_or_span_id: s.span_id,
        action: "QUARANTINE_REVIEW" as const,
      })),
      quality_measurements: {
        ...quality,
        duplicate_overlap_spans: dedup.duplicate_spans_removed,
        critical_tokens_detected: criticalTokens,
      },
      matched_font_fingerprint: null,
      requires_review: true,
      config_version: input.config_version,
    };
  }

  // 4. Inspect spans for corrupt/legacy glyphs vs clean native spans
  const corruptSpans = input.native_spans.filter((s) => hasGarbledOrPuaGlyphs(s.text));
  const cleanSpans = input.native_spans.filter((s) => !hasGarbledOrPuaGlyphs(s.text));

  if (corruptSpans.length > 0) {
    const allHaveVerifiedFontMap = corruptSpans.every((s) =>
      isRegisteredVerifiedFontFingerprint(s.font_fingerprint)
    );
    if (allHaveVerifiedFontMap && substantiveImageRegions.length === 0) {
      return {
        page_id: pageId,
        artifact_id: input.artifact_id,
        physical_page_index: input.physical_page_index,
        route: "REPAIR",
        reason_codes: ["GARBLED_NATIVE_GLYPHS_WITH_BENCHMARKED_FONT_MAP"],
        region_decisions: input.native_spans.map((s) => ({
          region_or_span_id: s.span_id,
          action: hasGarbledOrPuaGlyphs(s.text)
            ? ("FONT_REPAIR" as const)
            : ("KEEP_NATIVE" as const),
        })),
        quality_measurements: {
          ...quality,
          duplicate_overlap_spans: dedup.duplicate_spans_removed,
          critical_tokens_detected: criticalTokens,
        },
        matched_font_fingerprint: corruptSpans[0].font_fingerprint,
        requires_review: false,
        config_version: input.config_version,
      };
    }

    if (cleanSpans.length > 0) {
      return {
        page_id: pageId,
        artifact_id: input.artifact_id,
        physical_page_index: input.physical_page_index,
        route: "MIXED",
        reason_codes: ["MIXED_CLEAN_SPANS_AND_UNMAPPED_CORRUPT_SPANS"],
        region_decisions: input.native_spans.map((s) => ({
          region_or_span_id: s.span_id,
          action: hasGarbledOrPuaGlyphs(s.text)
            ? ("INVOKE_OCR" as const)
            : ("KEEP_NATIVE" as const),
        })),
        quality_measurements: {
          ...quality,
          duplicate_overlap_spans: dedup.duplicate_spans_removed,
          critical_tokens_detected: criticalTokens,
        },
        matched_font_fingerprint: null,
        requires_review: false,
        config_version: input.config_version,
      };
    }

    return {
      page_id: pageId,
      artifact_id: input.artifact_id,
      physical_page_index: input.physical_page_index,
      route: "OCR",
      reason_codes: ["CORRUPT_GLYPHS_WITHOUT_VERIFIED_FONT_MAP"],
      region_decisions: corruptSpans.map((s) => ({
        region_or_span_id: s.span_id,
        action: "INVOKE_OCR" as const,
      })),
      quality_measurements: {
        ...quality,
        duplicate_overlap_spans: dedup.duplicate_spans_removed,
        critical_tokens_detected: criticalTokens,
      },
      matched_font_fingerprint: null,
      requires_review: false,
      config_version: input.config_version,
    };
  }

  // 5. Clean native spans + overlapping duplicate shadows -> REPAIR (coordinate-backed cleanup)
  if (dedup.duplicate_spans_removed > 0 && substantiveImageRegions.length === 0) {
    const keptIds = new Set(dedup.kept.map((k) => k.span_id));
    return {
      page_id: pageId,
      artifact_id: input.artifact_id,
      physical_page_index: input.physical_page_index,
      route: "REPAIR",
      reason_codes: ["OVERLAPPING_DUPLICATE_EXTRACTION_SPANS_DETECTED"],
      region_decisions: input.native_spans.map((s) => ({
        region_or_span_id: s.span_id,
        action: keptIds.has(s.span_id)
          ? ("KEEP_NATIVE" as const)
          : ("DROP_DUPLICATE_OVERLAP" as const),
      })),
      quality_measurements: {
        ...quality,
        duplicate_overlap_spans: dedup.duplicate_spans_removed,
        critical_tokens_detected: criticalTokens,
      },
      matched_font_fingerprint: null,
      requires_review: false,
      config_version: input.config_version,
    };
  }

  // 6. Clean native spans + substantive image regions (e.g., scanned table/annex on same page) -> MIXED (AT20)
  if (substantiveImageRegions.length > 0) {
    return {
      page_id: pageId,
      artifact_id: input.artifact_id,
      physical_page_index: input.physical_page_index,
      route: "MIXED",
      reason_codes: ["CLEAN_NATIVE_TEXT_PLUS_IMAGE_REGION"],
      region_decisions: [
        ...input.native_spans.map((s) => ({
          region_or_span_id: s.span_id,
          action: "KEEP_NATIVE" as const,
        })),
        ...substantiveImageRegions.map((r) => ({
          region_or_span_id: r.region_id,
          action: "INVOKE_OCR" as const,
        })),
      ],
      quality_measurements: {
        ...quality,
        duplicate_overlap_spans: 0,
        critical_tokens_detected: criticalTokens,
      },
      matched_font_fingerprint: null,
      requires_review: false,
      config_version: input.config_version,
    };
  }

  // 7. Validated NATIVE text
  return {
    page_id: pageId,
    artifact_id: input.artifact_id,
    physical_page_index: input.physical_page_index,
    route: "NATIVE",
    reason_codes: ["VALIDATED_THAI_ENGLISH_NATIVE_SPANS"],
    region_decisions: input.native_spans.map((s) => ({
      region_or_span_id: s.span_id,
      action: "KEEP_NATIVE" as const,
    })),
    quality_measurements: {
      ...quality,
      duplicate_overlap_spans: 0,
      critical_tokens_detected: criticalTokens,
    },
    matched_font_fingerprint: null,
    requires_review: false,
    config_version: input.config_version,
  };
}
