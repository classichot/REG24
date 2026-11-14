import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import {
  assembleDocument,
  runResumableDocumentOcrTasks,
} from "../../src/core/knowledge/page-assembly";

describe("Audit Page Assembly, Resumable 50-Page OCR Windows & Page Equation Contract (AT24, AT26)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-kn-asm-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("AT24: 120-page scanned book interrupted after first 50-page OCR task resumes without rebilling cached pages and blocks premature publication until all 120 pages complete", async () => {
    const store1 = new DurableKnowledgeStore(tempDir);
    let providerBilledCalls = 0;

    const fakeOcrProvider = async (pageIndex: number) => {
      providerBilledCalls += 1;
      return `เนื้อหากฎหมายภาษีอากร หน้าที่ ${pageIndex + 1} มาตรา 65`;
    };

    // First run: interrupt after window 0 (first 50 pages)
    const partialRun = await runResumableDocumentOcrTasks({
      store: store1,
      artifact_id: "art_book_120p",
      total_physical_pages: 120,
      ocr_page_indices: Array.from({ length: 120 }, (_, i) => i),
      max_pages_per_task: 50,
      stop_after_tasks: 1,
      ocrProvider: fakeOcrProvider,
    });

    expect(partialRun.completed_all_tasks).toBe(false);
    expect(providerBilledCalls).toBe(50);

    // Attempt premature assembly while 70 pages remain unresolved -> MUST block complete publication!
    const prematureDoc = await assembleDocument({
      artifact_id: "art_book_120p",
      total_physical_pages: 120,
      measurement_basis: "pdf_physical_pages",
      pages: partialRun.current_page_outcomes,
    });
    expect(prematureDoc.complete_and_publishable).toBe(false);
    expect(prematureDoc.page_accounting.unresolved).toBe(70);
    expect(prematureDoc.page_accounting.sum_matches).toBe(true);

    // Simulate process restart with new store instance on disk -> resume remaining 70 pages (50 + 20)
    const store2 = new DurableKnowledgeStore(tempDir);
    const resumedRun = await runResumableDocumentOcrTasks({
      store: store2,
      artifact_id: "art_book_120p",
      total_physical_pages: 120,
      ocr_page_indices: Array.from({ length: 120 }, (_, i) => i),
      max_pages_per_task: 50,
      ocrProvider: fakeOcrProvider,
    });

    expect(resumedRun.completed_all_tasks).toBe(true);
    // Total billed calls MUST be exactly 120 (first 50 cached on disk, zero rebilling!)
    expect(providerBilledCalls).toBe(120);

    const completeDoc = await assembleDocument({
      artifact_id: "art_book_120p",
      total_physical_pages: 120,
      measurement_basis: "pdf_physical_pages",
      pages: resumedRun.current_page_outcomes,
    });
    expect(completeDoc.complete_and_publishable).toBe(true);
    expect(completeDoc.page_accounting.ocr).toBe(120);
    expect(completeDoc.page_accounting.unresolved).toBe(0);
    expect(completeDoc.page_accounting.sum_matches).toBe(true);
  });

  it("AT26: Mutually exclusive final page outcomes sum strictly to physical_pages while unique OCR-invoked pages and multi-region/retry OCR calls are reported separately", async () => {
    const doc = await assembleDocument({
      artifact_id: "art_at26_eq",
      total_physical_pages: 6,
      measurement_basis: "pdf_physical_pages",
      pages: [
        {
          page_id: "art_at26_eq:0",
          physical_page_index: 0,
          printed_page_label: "1",
          initial_route: "NATIVE",
          final_outcome: "accepted_native",
          potentially_material: true,
          ocr_invoked: false,
          ocr_region_calls: 0,
          ocr_retry_attempts: 0,
          final_text: "หน้า 1 ข้อความปกติ",
          raw_native_text: "หน้า 1 ข้อความปกติ",
          output_sha256: "h0",
        },
        {
          page_id: "art_at26_eq:1",
          physical_page_index: 1,
          printed_page_label: "2",
          initial_route: "REPAIR",
          final_outcome: "accepted_repaired",
          potentially_material: true,
          ocr_invoked: false,
          ocr_region_calls: 0,
          ocr_retry_attempts: 0,
          final_text: "หน้า 2 ซ่อมฟอนต์สำเร็จ",
          raw_native_text: "garbled",
          output_sha256: "h1",
        },
        {
          page_id: "art_at26_eq:2",
          physical_page_index: 2,
          printed_page_label: "3",
          initial_route: "OCR",
          final_outcome: "accepted_ocr",
          potentially_material: true,
          ocr_invoked: true,
          ocr_region_calls: 1,
          ocr_retry_attempts: 1, // 1 initial + 1 retry = 2 provider calls
          final_text: "หน้า 3 สแกนเต็มหน้า",
          raw_native_text: "",
          output_sha256: "h2",
        },
        {
          page_id: "art_at26_eq:3",
          physical_page_index: 3,
          printed_page_label: "4",
          initial_route: "MIXED",
          final_outcome: "accepted_mixed",
          potentially_material: true,
          ocr_invoked: true,
          ocr_region_calls: 2, // 2 table regions OCR'd on one mixed page
          ocr_retry_attempts: 0,
          final_text: "หน้า 4 ผสมข้อความและตารางสแกน",
          raw_native_text: "หน้า 4",
          output_sha256: "h3",
        },
        {
          page_id: "art_at26_eq:4",
          physical_page_index: 4,
          printed_page_label: null,
          initial_route: "NONCONTENT_CONFIRMED",
          final_outcome: "confirmed_noncontent",
          potentially_material: false,
          ocr_invoked: false,
          ocr_region_calls: 0,
          ocr_retry_attempts: 0,
          final_text: "",
          raw_native_text: "",
          output_sha256: "h4",
        },
        {
          page_id: "art_at26_eq:5",
          physical_page_index: 5,
          printed_page_label: "6",
          initial_route: "MIXED",
          final_outcome: "accepted_mixed",
          potentially_material: true,
          ocr_invoked: true,
          ocr_region_calls: 1,
          ocr_retry_attempts: 2, // 1 + 2 retries = 3 provider calls
          final_text: "หน้า 6 ผสมส่วนท้าย",
          raw_native_text: "หน้า 6",
          output_sha256: "h5",
        },
      ],
    });

    expect(doc.complete_and_publishable).toBe(true);
    expect(doc.page_accounting).toEqual({
      total_source_pages: 6,
      native: 1,
      repaired: 1,
      ocr: 1,
      mixed: 2,
      noncontent_confirmed: 1,
      unresolved: 0,
      unique_ocr_invoked_pages: 3, // pages 2, 3, 5
      ocr_calls_including_retries: 7, // (1+1) + (2+0) + (1+2) = 7
      sum_matches: true,
    });
  });
});
