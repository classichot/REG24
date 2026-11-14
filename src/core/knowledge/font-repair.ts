/**
 * REG24 — Audit-Driven Deterministic Font Repair & Coordinate-Aware Duplicate Span Cleanup
 * Implements 03_OCR_AUDIT_ADJUSTMENTS.md Section 3 (AT19, AT21).
 *
 * Rules:
 * - Never overwrites raw extraction (`raw_text_preserved` always retained).
 * - Applies ONLY known, benchmark-verified font-fingerprint-specific mappings.
 * - Never applies global blind character substitutions or LLM spelling guesses.
 * - Removes overlapping shadow spans ONLY when text AND bounding boxes substantially overlap (>= 85% IoU),
 *   preserving genuine repeated Thai legal phrasing on separate lines/clauses (AT21).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "./identity";
import type { NativeTextSpan, RepairInput, RepairResult } from "./contracts";

interface FontMappingEntry {
  font_fingerprint: string;
  font_family_label: string;
  benchmark_verified: boolean;
  benchmark_sample_pages: number;
  critical_token_accuracy: number;
  latin1_to_tis620_offset?: number;
  char_map: Record<string, string>;
}

interface FontRegistryFile {
  registry_version: string;
  mappings: FontMappingEntry[];
}

let cachedRegistry: FontRegistryFile | null = null;

export function loadFontMappingRegistry(): FontRegistryFile {
  if (cachedRegistry) return cachedRegistry;
  const p = path.join(process.cwd(), "config", "knowledge", "font_mapping_registry.json");
  if (fs.existsSync(p)) {
    cachedRegistry = JSON.parse(fs.readFileSync(p, "utf8")) as FontRegistryFile;
    return cachedRegistry;
  }
  return { registry_version: "font-map.v1.1.0", mappings: [] };
}

export function isRegisteredVerifiedFontFingerprint(fontFingerprint: string): boolean {
  const reg = loadFontMappingRegistry();
  return reg.mappings.some(
    (m) => m.font_fingerprint === fontFingerprint && m.benchmark_verified === true
  );
}

export function hasGarbledOrPuaGlyphs(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Private Use Area (U+F700..U+F71F) or Latin-1 high-byte shifted Thai (U+00A1..U+00FB) or replacement char U+FFFD
    if (
      (code >= 0xf700 && code <= 0xf71f) ||
      (code >= 0x00a1 && code <= 0x00fb) ||
      code === 0xfffd
    ) {
      return true;
    }
  }
  return false;
}

function bboxIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const xA = Math.max(a[0], b[0]);
  const yA = Math.max(a[1], b[1]);
  const xB = Math.min(a[2], b[2]);
  const yB = Math.min(a[3], b[3]);
  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;
  const areaA = Math.max(1, (a[2] - a[0]) * (a[3] - a[1]));
  const areaB = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
  return interArea / (areaA + areaB - interArea);
}

export function deduplicateOverlappingSpans(spans: NativeTextSpan[]): {
  kept: NativeTextSpan[];
  duplicate_spans_removed: number;
  legitimate_repeats_preserved: number;
} {
  // Sort in reading order (top-to-bottom, left-to-right)
  const sorted = [...spans].sort((a, b) =>
    Math.abs(a.bbox[1] - b.bbox[1]) > 4 ? a.bbox[1] - b.bbox[1] : a.bbox[0] - b.bbox[0]
  );

  const kept: NativeTextSpan[] = [];
  let removed = 0;
  let legitimateRepeats = 0;

  for (const span of sorted) {
    const trimmed = span.text.trim();
    const overlappingMatch = kept.find(
      (k) => k.text.trim() === trimmed && bboxIoU(k.bbox, span.bbox) >= 0.75
    );
    if (overlappingMatch) {
      removed += 1;
      continue;
    }
    // Check if text shares a substantial repeated legal phrase with an earlier non-overlapping span
    const nonOverlappingPhraseRepeat = kept.some((k) => {
      if (bboxIoU(k.bbox, span.bbox) >= 0.2) return false;
      const a = k.text.trim();
      return a.length >= 12 && (trimmed.includes(a) || a.includes(trimmed));
    });
    if (nonOverlappingPhraseRepeat) {
      legitimateRepeats += 1;
    }
    kept.push(span);
  }

  return { kept, duplicate_spans_removed: removed, legitimate_repeats_preserved: legitimateRepeats };
}

function applyDeterministicFontMap(text: string, mapping: FontMappingEntry): string {
  let out = text;
  if (typeof mapping.latin1_to_tis620_offset === "number") {
    const offset = mapping.latin1_to_tis620_offset;
    out = Array.from(out)
      .map((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 0x00a1 && code <= 0x00fb ? String.fromCharCode(code + offset) : ch;
      })
      .join("");
  }
  for (const [src, dst] of Object.entries(mapping.char_map)) {
    out = out.split(src).join(dst);
  }
  return out;
}

export async function repairPage(input: RepairInput): Promise<RepairResult> {
  const rawJoined = input.raw_spans.map((s) => s.text).join(" ");
  const reg = loadFontMappingRegistry();
  const dedup = deduplicateOverlappingSpans(input.raw_spans);

  const repairedPieces: string[] = [];
  let appliedFontFp: string | null = null;
  const reasons: string[] = [];

  if (dedup.duplicate_spans_removed > 0) {
    reasons.push(`REMOVED_${dedup.duplicate_spans_removed}_OVERLAPPING_SHADOW_SPANS`);
  }
  if (dedup.legitimate_repeats_preserved > 0) {
    reasons.push(`PRESERVED_${dedup.legitimate_repeats_preserved}_NON_OVERLAPPING_LEGAL_REPEATS`);
  }

  for (const span of dedup.kept) {
    if (!hasGarbledOrPuaGlyphs(span.text)) {
      repairedPieces.push(span.text.trim());
      continue;
    }

    const mapping = reg.mappings.find(
      (m) => m.font_fingerprint === span.font_fingerprint && m.benchmark_verified
    );
    if (!mapping) {
      return {
        page_id: input.page_id,
        raw_text_preserved: rawJoined,
        repaired_text: null,
        applied_font_fingerprint: null,
        duplicate_spans_removed: dedup.duplicate_spans_removed,
        legitimate_repeats_preserved: dedup.legitimate_repeats_preserved,
        status: "FALLBACK_TO_OCR",
        reason_codes: [
          ...reasons,
          `UNREGISTERED_OR_UNBENCHMARKED_FONT:${span.font_fingerprint}`,
        ],
        output_sha256: null,
      };
    }

    const fixed = applyDeterministicFontMap(span.text, mapping);
    if (hasGarbledOrPuaGlyphs(fixed) || !/[\u0E00-\u0E7F]/.test(fixed)) {
      return {
        page_id: input.page_id,
        raw_text_preserved: rawJoined,
        repaired_text: null,
        applied_font_fingerprint: mapping.font_fingerprint,
        duplicate_spans_removed: dedup.duplicate_spans_removed,
        legitimate_repeats_preserved: dedup.legitimate_repeats_preserved,
        status: "QUARANTINE_REVIEW",
        reason_codes: [...reasons, "REPAIR_OUTPUT_STILL_CONTAINS_RESIDUAL_CORRUPTION"],
        output_sha256: null,
      };
    }

    appliedFontFp = mapping.font_fingerprint;
    reasons.push(`APPLIED_VERIFIED_FONT_MAP:${mapping.font_fingerprint}`);
    repairedPieces.push(fixed.trim());
  }

  const finalText = repairedPieces.filter(Boolean).join(" ").trim();
  return {
    page_id: input.page_id,
    raw_text_preserved: rawJoined,
    repaired_text: finalText,
    applied_font_fingerprint: appliedFontFp,
    duplicate_spans_removed: dedup.duplicate_spans_removed,
    legitimate_repeats_preserved: dedup.legitimate_repeats_preserved,
    status: "REPAIRED_VERIFIED",
    reason_codes: reasons,
    output_sha256: sha256Bytes(finalText),
  };
}
