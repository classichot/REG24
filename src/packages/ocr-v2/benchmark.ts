/**
 * REG24 Thai Legal OCR Benchmark, Quality Gates & Legal Safety Evaluation (`REG-006` / Section 10)
 *
 * Implements:
 * - Raw CER: Unicode code-point Levenshtein distance / ground-truth code-point count
 * - Normalized CER: Levenshtein under shared `thai-legal-norm/2.0.0`
 * - Extended-grapheme-cluster error rate (`Intl.Segmenter` pinned Unicode segmentation)
 * - Secondary Thai WER (`Intl.Segmenter('th', { granularity: 'word' })`)
 * - Critical-field exact match, Citation Span Precision/Recall/F1, Resolved-Target Precision
 * - Canonical Table TEDS (Full TEDS + Structure-Only TEDS) & Cell-Text Exact Match
 * - Document-family split verifier (prevents split leakage across pages/revisions of the same document/family)
 * - Strict Honesty Gate: NEVER reports a 300-doc / 3,000-page release threshold as "passed" unless a frozen
 *   corpus >= 300 documents and >= 3,000 pages is evaluated.
 */

import { LegalSourceCategory, OCRTable } from "./contract";
import {
  THAI_NORMALIZATION_RULESET_V2,
  normalizeThaiLegalTextV2,
} from "./thai-normalizer";

export const BENCHMARK_SCORER_REVISION = "reg24-ocr-bench-scorer/2.0.0";
export const PINNED_UNICODE_SEGMENTER_ID = "icu-intl-segmenter-th-v2026.1";

// ============================================================================
// 1. SEQUENCE LEVENSHTEIN DISTANCE (CODE POINTS, GRAPHEMES, WORDS)
// ============================================================================

export function sequenceLevenshteinDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Int32Array(n + 1);
  let curr = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

export function computeRawCer(hypothesisRaw: string, groundTruthRaw: string): {
  edit_distance: number;
  ground_truth_code_points: number;
  cer: number;
} {
  const hyp = Array.from(hypothesisRaw);
  const gt = Array.from(groundTruthRaw);
  if (gt.length === 0) {
    return {
      edit_distance: hyp.length,
      ground_truth_code_points: 0,
      cer: hyp.length === 0 ? 0 : 1,
    };
  }
  const dist = sequenceLevenshteinDistance(hyp, gt);
  return {
    edit_distance: dist,
    ground_truth_code_points: gt.length,
    cer: dist / gt.length,
  };
}

export function computeNormalizedCer(hypothesisRaw: string, groundTruthRaw: string): {
  ruleset: typeof THAI_NORMALIZATION_RULESET_V2;
  edit_distance: number;
  ground_truth_code_points: number;
  cer: number;
} {
  const hypNorm = normalizeThaiLegalTextV2(hypothesisRaw).normalized_text;
  const gtNorm = normalizeThaiLegalTextV2(groundTruthRaw).normalized_text;
  const res = computeRawCer(hypNorm, gtNorm);
  return {
    ruleset: THAI_NORMALIZATION_RULESET_V2,
    ...res,
  };
}

export function segmentThaiGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const seg = new Intl.Segmenter("th", { granularity: "grapheme" });
    return Array.from(seg.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

export function segmentThaiWords(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const seg = new Intl.Segmenter("th", { granularity: "word" });
    return Array.from(seg.segment(text))
      .filter((s) => s.isWordLike || s.segment.trim().length > 0)
      .map((s) => s.segment);
  }
  return text.trim().split(/\s+/).filter(Boolean);
}

export function computeGraphemeClusterErrorRate(hypothesis: string, groundTruth: string): number {
  const hyp = segmentThaiGraphemes(hypothesis);
  const gt = segmentThaiGraphemes(groundTruth);
  if (gt.length === 0) return hyp.length === 0 ? 0 : 1;
  return sequenceLevenshteinDistance(hyp, gt) / gt.length;
}

export function computeThaiWer(hypothesis: string, groundTruth: string): number {
  const hyp = segmentThaiWords(hypothesis);
  const gt = segmentThaiWords(groundTruth);
  if (gt.length === 0) return hyp.length === 0 ? 0 : 1;
  return sequenceLevenshteinDistance(hyp, gt) / gt.length;
}

// ============================================================================
// 2. CANONICAL TABLE TEDS (FULL TEDS & STRUCTURE-ONLY TEDS)
// ============================================================================

export interface TableEvaluationScores {
  cell_exact_match_rate: number;
  structure_only_teds: number;
  full_teds: number;
  canonical_html_hypothesis: string;
  canonical_html_ground_truth: string;
}

export function serializeCanonicalTableTokens(
  table: Pick<OCRTable, "cells">,
  includeCellText: boolean
): { html: string; tokens: string[] } {
  const sorted = [...table.cells].sort((a, b) =>
    a.row !== b.row ? a.row - b.row : a.column - b.column
  );
  const rowsMap = new Map<number, typeof sorted>();
  for (const cell of sorted) {
    const list = rowsMap.get(cell.row) ?? [];
    list.push(cell);
    rowsMap.set(cell.row, list);
  }

  const rowNums = Array.from(rowsMap.keys()).sort((a, b) => a - b);
  const tokens: string[] = ["<table>"];
  for (const r of rowNums) {
    tokens.push("<tr>");
    for (const c of rowsMap.get(r) ?? []) {
      const attrs = `td[r=${c.row_span},c=${c.column_span}]`;
      tokens.push(`<${attrs}>`);
      if (includeCellText) {
        const normCell = normalizeThaiLegalTextV2(c.raw_text).normalized_text.trim();
        for (const cp of Array.from(normCell)) {
          tokens.push(`txt:${cp}`);
        }
      }
      tokens.push(`</${attrs}>`);
    }
    tokens.push("</tr>");
  }
  tokens.push("</table>");

  return {
    html: tokens.filter((t) => !t.startsWith("txt:")).join(""),
    tokens,
  };
}

export function computeTableTeds(
  hypothesis: Pick<OCRTable, "cells">,
  groundTruth: Pick<OCRTable, "cells">
): TableEvaluationScores {
  const structHyp = serializeCanonicalTableTokens(hypothesis, false);
  const structGt = serializeCanonicalTableTokens(groundTruth, false);
  const structMax = Math.max(structHyp.tokens.length, structGt.tokens.length, 1);
  const structDist = sequenceLevenshteinDistance(structHyp.tokens, structGt.tokens);
  const structureOnlyTeds = Math.max(0, 1 - structDist / structMax);

  const fullHyp = serializeCanonicalTableTokens(hypothesis, true);
  const fullGt = serializeCanonicalTableTokens(groundTruth, true);
  const fullMax = Math.max(fullHyp.tokens.length, fullGt.tokens.length, 1);
  const fullDist = sequenceLevenshteinDistance(fullHyp.tokens, fullGt.tokens);
  const fullTeds = Math.max(0, 1 - fullDist / fullMax);

  // Cell-by-cell exact match keyed by `(row, column, row_span, column_span)`
  const hypMap = new Map<string, string>();
  for (const c of hypothesis.cells) {
    hypMap.set(
      `${c.row}:${c.column}:${c.row_span}:${c.column_span}`,
      normalizeThaiLegalTextV2(c.raw_text).normalized_text.trim()
    );
  }
  let exactCells = 0;
  for (const gtCell of groundTruth.cells) {
    const key = `${gtCell.row}:${gtCell.column}:${gtCell.row_span}:${gtCell.column_span}`;
    const gtVal = normalizeThaiLegalTextV2(gtCell.raw_text).normalized_text.trim();
    if (hypMap.get(key) === gtVal) {
      exactCells += 1;
    }
  }
  const cellExactRate =
    groundTruth.cells.length > 0 ? exactCells / groundTruth.cells.length : 1;

  return {
    cell_exact_match_rate: Number(cellExactRate.toFixed(6)),
    structure_only_teds: Number(structureOnlyTeds.toFixed(6)),
    full_teds: Number(fullTeds.toFixed(6)),
    canonical_html_hypothesis: structHyp.html,
    canonical_html_ground_truth: structGt.html,
  };
}

// ============================================================================
// 3. CITATION SPAN F1, CRITICAL FIELDS & SPLIT ISOLATION VERIFIER
// ============================================================================

export function computeCitationSpanF1(
  predictedCitationKeys: string[],
  groundTruthCitationKeys: string[]
): { precision: number; recall: number; f1: number } {
  const predSet = new Set(predictedCitationKeys);
  const gtSet = new Set(groundTruthCitationKeys);
  if (predSet.size === 0 && gtSet.size === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  let tp = 0;
  for (const p of predSet) {
    if (gtSet.has(p)) tp += 1;
  }
  const precision = predSet.size > 0 ? tp / predSet.size : 0;
  const recall = gtSet.size > 0 ? tp / gtSet.size : 0;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision: Number(precision.toFixed(6)),
    recall: Number(recall.toFixed(6)),
    f1: Number(f1.toFixed(6)),
  };
}

export interface BenchmarkFixtureDocument {
  document_id: string;
  family_group_id: string; // Related case / instrument / Gazette group for leak-free split verification
  split: "train" | "dev" | "held_out_test";
  source_category: LegalSourceCategory;
  scan_condition: "clean_printed" | "challenging_scan";
  expected_page_count: number;
  returned_page_count: number;
  hypothesis_raw_text: string;
  ground_truth_raw_text: string;
  critical_fields_hypothesis: Record<string, string>;
  critical_fields_ground_truth: Record<string, string>;
  predicted_citations: string[];
  ground_truth_citations: string[];
  resolved_targets_predicted: Array<{ key: string; target_id: string }>;
  resolved_targets_ground_truth: Record<string, string>;
  unsupported_hallucinated_critical_tokens: number;
  tables?: Array<{ hypothesis: Pick<OCRTable, "cells">; ground_truth: Pick<OCRTable, "cells"> }>;
  latency_ms: number;
  cost_micros_thb: number;
}

export function verifyCorpusSplitIsolation(docs: BenchmarkFixtureDocument[]): {
  leak_free: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  const docSplits = new Map<string, string>();
  const familySplits = new Map<string, string>();

  for (const d of docs) {
    const prevDocSplit = docSplits.get(d.document_id);
    if (prevDocSplit && prevDocSplit !== d.split) {
      violations.push(
        `Document ${d.document_id} appears across multiple splits (${prevDocSplit} vs ${d.split})`
      );
    }
    docSplits.set(d.document_id, d.split);

    const prevFamSplit = familySplits.get(d.family_group_id);
    if (prevFamSplit && prevFamSplit !== d.split) {
      violations.push(
        `Family group ${d.family_group_id} leaks across splits (${prevFamSplit} vs ${d.split})`
      );
    }
    familySplits.set(d.family_group_id, d.split);
  }

  return { leak_free: violations.length === 0, violations };
}

// ============================================================================
// 4. PROPOSED SECTION 10 RELEASE THRESHOLDS & STRATIFIED REPORT
// ============================================================================

export const PROPOSED_SECTION_10_THRESHOLDS = {
  minimum_corpus_documents: 300,
  minimum_corpus_pages: 3000,
  completeness_rate: 1.0,
  clean_printed_raw_cer_max: 0.01,
  clean_printed_normalized_cer_max: 0.008,
  challenging_scan_raw_cer_max: 0.03,
  critical_fields_pre_review_min: 0.995,
  citation_f1_min: 0.98,
  target_resolution_precision_min: 0.995,
  table_cell_exact_match_min: 0.97,
  table_structure_teds_min: 0.95,
  max_hallucinated_critical_tokens: 0,
} as const;

export interface StratumBenchmarkSummary {
  source_category: LegalSourceCategory;
  document_count: number;
  page_count: number;
  macro_raw_cer: number;
  macro_normalized_cer: number;
  macro_grapheme_error_rate: number;
  macro_thai_wer: number;
  critical_field_exact_match: number;
  citation_f1: number;
  automatic_clearance_eligible_on_fixture: boolean;
}

export interface ThaiOcrBenchmarkReport {
  scorer_revision: string;
  unicode_segmenter_revision: string;
  normalization_ruleset: string;
  evaluated_at: string;
  corpus_status:
    | "frozen_release_corpus_qualified"
    | "golden_fixture_suite_measured__frozen_300_doc_3000_page_corpus_pending";
  release_gate_decision:
    | "eligible_for_owner_signoff"
    | "not_passed__requires_frozen_300_doc_3000_page_corpus_and_owner_signoff";
  honesty_notice: string;
  total_documents: number;
  total_pages: number;
  split_isolation: { leak_free: boolean; violations: string[] };
  macro_metrics: {
    completeness_rate: number;
    clean_printed_raw_cer: number;
    clean_printed_normalized_cer: number;
    challenging_scan_raw_cer: number;
    grapheme_cluster_error_rate: number;
    thai_wer_secondary: number;
    worst_decile_raw_cer: number;
    raw_cer_95ci: [number, number];
    critical_field_exact_match: number;
    citation_f1: number;
    target_resolution_precision: number;
    table_cell_exact_match: number | null;
    table_structure_only_teds: number | null;
    table_full_teds: number | null;
    hallucinated_critical_tokens: number;
    median_latency_ms: number;
    p95_latency_ms: number;
    mean_cost_micros_thb: number;
  };
  strata: StratumBenchmarkSummary[];
  proposed_thresholds: typeof PROPOSED_SECTION_10_THRESHOLDS;
}

function deterministicBootstrap95Ci(values: number[]): [number, number] {
  if (values.length === 0) return [0, 0];
  if (values.length === 1) return [values[0], values[0]];
  const n = values.length;
  const means: number[] = [];
  let seed = 20261114;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let b = 0; b < 200; b++) {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += values[Math.floor(nextRand() * n)];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [
    Number(means[Math.floor(0.025 * means.length)].toFixed(6)),
    Number(means[Math.floor(0.975 * means.length)].toFixed(6)),
  ];
}

export function evaluateThaiOcrBenchmarkSuite(
  fixtures: BenchmarkFixtureDocument[]
): ThaiOcrBenchmarkReport {
  const splitCheck = verifyCorpusSplitIsolation(fixtures);
  const heldOut = fixtures.filter((f) => f.split === "held_out_test");
  const evalDocs = heldOut.length > 0 ? heldOut : fixtures;

  const totalDocs = fixtures.length;
  const totalPages = fixtures.reduce((acc, d) => acc + d.expected_page_count, 0);

  let accountedDocs = 0;
  const rawCers: number[] = [];
  const cleanRawCers: number[] = [];
  const cleanNormCers: number[] = [];
  const challengingRawCers: number[] = [];
  const graphemeRates: number[] = [];
  const werRates: number[] = [];
  const citationF1s: number[] = [];
  const tableCellScores: number[] = [];
  const tableStructScores: number[] = [];
  const tableFullScores: number[] = [];

  let critMatched = 0;
  let critTotal = 0;
  let resolvedCorrect = 0;
  let resolvedTotal = 0;
  let hallucinatedTotal = 0;

  const byStratum = new Map<LegalSourceCategory, BenchmarkFixtureDocument[]>();

  for (const doc of evalDocs) {
    if (doc.returned_page_count === doc.expected_page_count) {
      accountedDocs += 1;
    }
    const rCer = computeRawCer(doc.hypothesis_raw_text, doc.ground_truth_raw_text).cer;
    const nCer = computeNormalizedCer(doc.hypothesis_raw_text, doc.ground_truth_raw_text).cer;
    const gErr = computeGraphemeClusterErrorRate(doc.hypothesis_raw_text, doc.ground_truth_raw_text);
    const wErr = computeThaiWer(doc.hypothesis_raw_text, doc.ground_truth_raw_text);

    rawCers.push(rCer);
    graphemeRates.push(gErr);
    werRates.push(wErr);
    if (doc.scan_condition === "clean_printed") {
      cleanRawCers.push(rCer);
      cleanNormCers.push(nCer);
    } else {
      challengingRawCers.push(rCer);
    }

    for (const [k, gtVal] of Object.entries(doc.critical_fields_ground_truth)) {
      critTotal += 1;
      if (doc.critical_fields_hypothesis[k] === gtVal) {
        critMatched += 1;
      }
    }

    const cit = computeCitationSpanF1(doc.predicted_citations, doc.ground_truth_citations);
    citationF1s.push(cit.f1);

    for (const pred of doc.resolved_targets_predicted) {
      resolvedTotal += 1;
      if (doc.resolved_targets_ground_truth[pred.key] === pred.target_id) {
        resolvedCorrect += 1;
      }
    }

    hallucinatedTotal += doc.unsupported_hallucinated_critical_tokens;

    for (const tbl of doc.tables ?? []) {
      const tScore = computeTableTeds(tbl.hypothesis, tbl.ground_truth);
      tableCellScores.push(tScore.cell_exact_match_rate);
      tableStructScores.push(tScore.structure_only_teds);
      tableFullScores.push(tScore.full_teds);
    }

    const list = byStratum.get(doc.source_category) ?? [];
    list.push(doc);
    byStratum.set(doc.source_category, list);
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? 0 : Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(6));

  const sortedRaw = [...rawCers].sort((a, b) => b - a);
  const decileCount = Math.max(1, Math.ceil(sortedRaw.length * 0.1));
  const worstDecileRawCer = avg(sortedRaw.slice(0, decileCount));

  const sortedLat = evalDocs.map((d) => d.latency_ms).sort((a, b) => a - b);
  const medianLatency = sortedLat.length > 0 ? sortedLat[Math.floor(sortedLat.length * 0.5)] : 0;
  const p95Latency = sortedLat.length > 0 ? sortedLat[Math.floor(sortedLat.length * 0.95)] : 0;

  const strata: StratumBenchmarkSummary[] = [];
  for (const [cat, docs] of byStratum.entries()) {
    const sRaw = avg(docs.map((d) => computeRawCer(d.hypothesis_raw_text, d.ground_truth_raw_text).cer));
    const sNorm = avg(
      docs.map((d) => computeNormalizedCer(d.hypothesis_raw_text, d.ground_truth_raw_text).cer)
    );
    const sGraph = avg(
      docs.map((d) => computeGraphemeClusterErrorRate(d.hypothesis_raw_text, d.ground_truth_raw_text))
    );
    const sWer = avg(docs.map((d) => computeThaiWer(d.hypothesis_raw_text, d.ground_truth_raw_text)));
    const sCit = avg(
      docs.map((d) => computeCitationSpanF1(d.predicted_citations, d.ground_truth_citations).f1)
    );

    let scMatch = 0;
    let scTot = 0;
    for (const d of docs) {
      for (const [k, v] of Object.entries(d.critical_fields_ground_truth)) {
        scTot += 1;
        if (d.critical_fields_hypothesis[k] === v) scMatch += 1;
      }
    }
    const critRate = scTot > 0 ? Number((scMatch / scTot).toFixed(6)) : 1;

    strata.push({
      source_category: cat,
      document_count: docs.length,
      page_count: docs.reduce((s, d) => s + d.expected_page_count, 0),
      macro_raw_cer: sRaw,
      macro_normalized_cer: sNorm,
      macro_grapheme_error_rate: sGraph,
      macro_thai_wer: sWer,
      critical_field_exact_match: critRate,
      citation_f1: sCit,
      automatic_clearance_eligible_on_fixture:
        sRaw <= PROPOSED_SECTION_10_THRESHOLDS.challenging_scan_raw_cer_max &&
        critRate >= PROPOSED_SECTION_10_THRESHOLDS.critical_fields_pre_review_min &&
        sCit >= PROPOSED_SECTION_10_THRESHOLDS.citation_f1_min,
    });
  }

  const meetsCorpusScale =
    totalDocs >= PROPOSED_SECTION_10_THRESHOLDS.minimum_corpus_documents &&
    totalPages >= PROPOSED_SECTION_10_THRESHOLDS.minimum_corpus_pages;

  return {
    scorer_revision: BENCHMARK_SCORER_REVISION,
    unicode_segmenter_revision: PINNED_UNICODE_SEGMENTER_ID,
    normalization_ruleset: THAI_NORMALIZATION_RULESET_V2,
    evaluated_at: new Date().toISOString(),
    corpus_status: meetsCorpusScale
      ? "frozen_release_corpus_qualified"
      : "golden_fixture_suite_measured__frozen_300_doc_3000_page_corpus_pending",
    release_gate_decision: meetsCorpusScale
      ? "eligible_for_owner_signoff"
      : "not_passed__requires_frozen_300_doc_3000_page_corpus_and_owner_signoff",
    honesty_notice: meetsCorpusScale
      ? "Frozen >=300-document / >=3,000-page corpus evaluated; requires product and legal-owner sign-off."
      : `Measured on ${totalDocs} repository golden fixture documents (${totalPages} pages). Per Section 10 & 12, proposed release thresholds require an independently annotated frozen corpus of >=300 documents and >=3,000 pages before claiming release-gate clearance.`,
    total_documents: totalDocs,
    total_pages: totalPages,
    split_isolation: splitCheck,
    macro_metrics: {
      completeness_rate: evalDocs.length > 0 ? Number((accountedDocs / evalDocs.length).toFixed(6)) : 1,
      clean_printed_raw_cer: avg(cleanRawCers),
      clean_printed_normalized_cer: avg(cleanNormCers),
      challenging_scan_raw_cer: avg(challengingRawCers),
      grapheme_cluster_error_rate: avg(graphemeRates),
      thai_wer_secondary: avg(werRates),
      worst_decile_raw_cer: worstDecileRawCer,
      raw_cer_95ci: deterministicBootstrap95Ci(rawCers),
      critical_field_exact_match: critTotal > 0 ? Number((critMatched / critTotal).toFixed(6)) : 1,
      citation_f1: avg(citationF1s),
      target_resolution_precision:
        resolvedTotal > 0 ? Number((resolvedCorrect / resolvedTotal).toFixed(6)) : 1,
      table_cell_exact_match: tableCellScores.length > 0 ? avg(tableCellScores) : null,
      table_structure_only_teds: tableStructScores.length > 0 ? avg(tableStructScores) : null,
      table_full_teds: tableFullScores.length > 0 ? avg(tableFullScores) : null,
      hallucinated_critical_tokens: hallucinatedTotal,
      median_latency_ms: medianLatency,
      p95_latency_ms: p95Latency,
      mean_cost_micros_thb: avg(evalDocs.map((d) => d.cost_micros_thb)),
    },
    strata,
    proposed_thresholds: PROPOSED_SECTION_10_THRESHOLDS,
  };
}
