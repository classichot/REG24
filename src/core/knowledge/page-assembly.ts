/**
 * REG24 — Audit-Driven Page Assembly, Completeness Barrier & Resumable <=50-Page OCR Runner
 * Implements 03_OCR_AUDIT_ADJUSTMENTS.md Sections 3 & 6 (AT24, AT26).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "./identity";
import type { DurableKnowledgeStore } from "./store";
import type {
  AssembledPageOutcome,
  DocumentEvidence,
  PageAssemblyInput,
  PageEquationAccounting,
} from "./contracts";

/**
 * Assembles a document and enforces the strict mutually exclusive page equation:
 * `physical_pages = accepted_native_pages + accepted_repaired_pages + accepted_ocr_pages + accepted_mixed_pages + confirmed_noncontent_pages + unresolved_pages`
 */
export async function assembleDocument(input: PageAssemblyInput): Promise<DocumentEvidence> {
  if (input.measurement_basis === "unpaginated_structural_records") {
    const records = input.structural_records || [];
    const invalidRecords = records.filter((r) => !r.validated);
    const blocking: string[] = [];
    if (records.length === 0) {
      blocking.push("NO_STRUCTURAL_RECORDS_PROVIDED");
    }
    if (invalidRecords.length > 0) {
      blocking.push(`UNVALIDATED_STRUCTURAL_RECORDS:${invalidRecords.length}`);
    }
    return {
      artifact_id: input.artifact_id,
      measurement_basis: "unpaginated_structural_records",
      complete_and_publishable: blocking.length === 0,
      blocking_reasons: blocking,
      page_accounting: {
        total_source_pages: 0,
        native: 0,
        repaired: 0,
        ocr: 0,
        mixed: 0,
        noncontent_confirmed: 0,
        unresolved: 0,
        unique_ocr_invoked_pages: 0,
        ocr_calls_including_retries: 0,
        sum_matches: true,
      },
      assembled_text: records.map((r) => r.text).join("\n\n"),
      page_outcomes: [],
      record_count: records.length,
    };
  }

  const providedByIdx = new Map<number, AssembledPageOutcome>();
  for (const p of input.pages || []) {
    providedByIdx.set(p.physical_page_index, p);
  }

  const fullOutcomes: AssembledPageOutcome[] = [];
  for (let i = 0; i < input.total_physical_pages; i++) {
    const existing = providedByIdx.get(i);
    if (existing) {
      fullOutcomes.push(existing);
    } else {
      fullOutcomes.push({
        page_id: `${input.artifact_id}:${i}`,
        physical_page_index: i,
        printed_page_label: null,
        initial_route: "OCR",
        final_outcome: "unresolved",
        potentially_material: true,
        ocr_invoked: false,
        ocr_region_calls: 0,
        ocr_retry_attempts: 0,
        final_text: "",
        raw_native_text: "",
        output_sha256: "",
      });
    }
  }

  let native = 0;
  let repaired = 0;
  let ocr = 0;
  let mixed = 0;
  let noncontent_confirmed = 0;
  let unresolved = 0;
  let uniqueOcrPages = 0;
  let totalOcrCallsWithRetries = 0;
  let unresolvedMaterialCount = 0;

  for (const p of fullOutcomes) {
    switch (p.final_outcome) {
      case "accepted_native":
        native += 1;
        break;
      case "accepted_repaired":
        repaired += 1;
        break;
      case "accepted_ocr":
        ocr += 1;
        break;
      case "accepted_mixed":
        mixed += 1;
        break;
      case "confirmed_noncontent":
        noncontent_confirmed += 1;
        break;
      case "unresolved":
        unresolved += 1;
        if (p.potentially_material) unresolvedMaterialCount += 1;
        break;
    }

    if (p.ocr_invoked) {
      uniqueOcrPages += 1;
      const baseCalls = Math.max(1, p.ocr_region_calls);
      totalOcrCallsWithRetries += baseCalls + Math.max(0, p.ocr_retry_attempts);
    }
  }

  const sum = native + repaired + ocr + mixed + noncontent_confirmed + unresolved;
  const sumMatches = sum === input.total_physical_pages;
  const blockingReasons: string[] = [];

  if (!sumMatches) {
    blockingReasons.push(
      `PAGE_EQUATION_IMBALANCE: sum=${sum} !== physical_pages=${input.total_physical_pages}`
    );
  }
  if (unresolvedMaterialCount > 0) {
    blockingReasons.push(
      `UNRESOLVED_MATERIAL_PAGES_BLOCK_PUBLICATION:${unresolvedMaterialCount}`
    );
  }

  const accounting: PageEquationAccounting = {
    total_source_pages: input.total_physical_pages,
    native,
    repaired,
    ocr,
    mixed,
    noncontent_confirmed,
    unresolved,
    unique_ocr_invoked_pages: uniqueOcrPages,
    ocr_calls_including_retries: totalOcrCallsWithRetries,
    sum_matches: sumMatches,
  };

  const assembledText = fullOutcomes
    .filter((p) => p.final_outcome !== "confirmed_noncontent" && p.final_outcome !== "unresolved")
    .sort((a, b) => a.physical_page_index - b.physical_page_index)
    .map((p) => p.final_text.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    artifact_id: input.artifact_id,
    measurement_basis: "pdf_physical_pages",
    complete_and_publishable: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    page_accounting: accounting,
    assembled_text: assembledText,
    page_outcomes: fullOutcomes,
    record_count: fullOutcomes.length,
  };
}

/**
 * Executes resumable <=50-page OCR task windows with durable disk page cache so interruptions
 * or restarts never re-bill already completed pages and never prematurely publish incomplete books (AT24).
 */
export async function runResumableDocumentOcrTasks(params: {
  store: DurableKnowledgeStore;
  artifact_id: string;
  total_physical_pages: number;
  ocr_page_indices: number[];
  max_pages_per_task?: number;
  stop_after_tasks?: number;
  ocr_config_version?: string;
  ocrProvider: (pageIndex: number) => Promise<string>;
}): Promise<{
  completed_all_tasks: boolean;
  windows_executed_this_call: number;
  cached_pages_reused: number;
  newly_ocr_processed_pages: number;
  current_page_outcomes: AssembledPageOutcome[];
}> {
  const maxPerTask = Math.min(50, Math.max(1, params.max_pages_per_task ?? 50));
  const cfgVer = params.ocr_config_version || "ocr-cfg.v2.0";
  const cacheDir = path.join(params.store.dataDir, "page-ocr-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(
    cacheDir,
    `${params.artifact_id.replace(/[^a-zA-Z0-9._-]/g, "_")}_${cfgVer}.json`
  );

  let pageCache: Record<string, AssembledPageOutcome> = {};
  if (fs.existsSync(cacheFile)) {
    pageCache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }

  const sortedIndices = [...new Set(params.ocr_page_indices)].sort((a, b) => a - b);
  const windows: number[][] = [];
  for (let i = 0; i < sortedIndices.length; i += maxPerTask) {
    windows.push(sortedIndices.slice(i, i + maxPerTask));
  }

  let windowsExecuted = 0;
  let cachedReused = 0;
  let newlyProcessed = 0;

  for (const win of windows) {
    const uncachedInWindow = win.filter((idx) => !pageCache[String(idx)]);
    cachedReused += win.length - uncachedInWindow.length;

    if (uncachedInWindow.length === 0) {
      continue;
    }

    if (
      typeof params.stop_after_tasks === "number" &&
      windowsExecuted >= params.stop_after_tasks
    ) {
      break;
    }

    for (const pageIdx of uncachedInWindow) {
      const text = await params.ocrProvider(pageIdx);
      const outcome: AssembledPageOutcome = {
        page_id: `${params.artifact_id}:${pageIdx}`,
        physical_page_index: pageIdx,
        printed_page_label: String(pageIdx + 1),
        initial_route: "OCR",
        final_outcome: "accepted_ocr",
        potentially_material: true,
        ocr_invoked: true,
        ocr_region_calls: 1,
        ocr_retry_attempts: 0,
        final_text: text,
        raw_native_text: "",
        output_sha256: sha256Bytes(text),
      };
      pageCache[String(pageIdx)] = outcome;
      newlyProcessed += 1;
    }

    // Persist checkpoint after each <=50-page window
    fs.writeFileSync(cacheFile, JSON.stringify(pageCache, null, 2), "utf8");
    windowsExecuted += 1;
  }

  const completedAll = sortedIndices.every((idx) => Boolean(pageCache[String(idx)]));
  return {
    completed_all_tasks: completedAll,
    windows_executed_this_call: windowsExecuted,
    cached_pages_reused: cachedReused,
    newly_ocr_processed_pages: newlyProcessed,
    current_page_outcomes: Object.values(pageCache),
  };
}
