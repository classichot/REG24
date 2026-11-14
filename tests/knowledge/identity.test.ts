import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import {
  captureBaselineSnapshot,
  restoreBaselineSnapshotIsolated,
  buildLegacyIdCrosswalk,
} from "../../src/core/knowledge/baseline";
import {
  sha256Bytes,
  normalizeOfficialRulingIdentifier,
  resolveCanonicalWorkIdentity,
} from "../../src/core/knowledge/identity";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { KnowledgeJobManager } from "../../src/core/knowledge/jobs";
import {
  freezeInventory,
  planReconciliation,
  ingestCandidateIdempotent,
} from "../../src/core/knowledge/inventory";
import type { Actor } from "../../src/core/knowledge/contracts";

const TEST_ENGINEER: Actor = {
  actor_id: "eng.lead@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Tasks F1 & F2 — Baseline Protection, Cryptographic Identity, Durable Jobs & Inventory (AT01-AT04, AT17)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-kn-f1f2-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("F1 / SH-06 & SH-07: captures deployed baseline, builds legacy crosswalk without deleting duplicates, and restores isolated snapshot with exact checksums", async () => {
    const snap = await captureBaselineSnapshot({ outputDir: tempDir });
    expect(snap.code_commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(snap.canonical_counts.thai_tax_rulings_rows).toBe(3643);
    expect(snap.canonical_counts.resource_master_rows).toBe(2312);
    expect(snap.duplicate_ruling_candidates.length).toBeGreaterThanOrEqual(7);

    const crosswalk = buildLegacyIdCrosswalk();
    expect(crosswalk.entries.length).toBeGreaterThan(3600);
    const sample = crosswalk.byLegacyId.get("ruling.th.rd.68302");
    expect(sample).toBeDefined();
    expect(sample?.canonical_work_id).toMatch(/^work\.th\.rd\./);

    const restoreDir = path.join(tempDir, "isolated-restore");
    const restored = await restoreBaselineSnapshotIsolated(snap.snapshot_uri, restoreDir);
    expect(restored.checksum_matches).toBe(true);
    expect(restored.restored_counts.thai_tax_rulings_rows).toBe(
      snap.canonical_counts.thai_tax_rulings_rows
    );
  });

  it("SH-08: computes real cryptographic SHA-256 over original bytes and normalizes Thai/Arabic official identifiers", () => {
    const rawBytes = Buffer.from("เลขที่หนังสือ กค 0702/636 ลงวันที่ 5 กุมภาพันธ์ 2569", "utf8");
    const expected = crypto.createHash("sha256").update(rawBytes).digest("hex");
    expect(sha256Bytes(rawBytes)).toBe(expected);

    const norm1 = normalizeOfficialRulingIdentifier("กค 0702/636");
    const norm2 = normalizeOfficialRulingIdentifier("กค  ๐๗๐๒ / ๖๓๖");
    expect(norm1).toBe("กค 0702/636");
    expect(norm2).toBe("กค 0702/636");
  });

  it("AT01: exact replay across same worker, fresh store restart on disk, and two concurrent workers produces zero extra canonical works, passages, assertions, or active vectors", async () => {
    const store1 = new DurableKnowledgeStore(tempDir);
    const payload = {
      idempotency_key: "idem-at01-ruling-636",
      batch_id: "B01" as const,
      source_file_id: "drv_rd_68302",
      original_name: "กค_0702_636__68302.pdf",
      mime_type: "application/pdf",
      bytes: Buffer.from(
        "เลขที่หนังสือ กค 0702/636 วันที่ 5 กุมภาพันธ์ 2569 เรื่อง ภาษีมูลค่าเพิ่ม กรณีเงินสนับสนุนจากองค์การ A ข้อเท็จจริง หน่วยงานของรัฐ ก. แนววินิจฉัย ได้รับสิทธิเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 ตามมาตรา 80/1 (4) แห่งประมวลรัษฎากร",
        "utf8"
      ),
      official_identifier: "กค 0702/636",
      issue_date: "2026-02-05",
      doc_type: "TaxRuling" as const,
      issuer_id: "reg.th.rd",
      access_scope: "scope.platform.public",
    };

    // 1. First import
    const first = await ingestCandidateIdempotent(store1, payload, TEST_ENGINEER);
    expect(first.http_status).toBe(201);
    const baselineCounts = store1.getAcceptedCounts();
    expect(baselineCounts.works).toBe(1);
    expect(baselineCounts.passages).toBeGreaterThanOrEqual(1);

    // 2. Same worker replay
    const second = await ingestCandidateIdempotent(store1, payload, TEST_ENGINEER);
    expect(second.http_status).toBe(200);
    expect(store1.getAcceptedCounts()).toEqual(baselineCounts);

    // 3. Simulated process restart: brand new store instance reading real persisted state from disk
    const storeAfterRestart = new DurableKnowledgeStore(tempDir);
    const afterRestartCounts = storeAfterRestart.getAcceptedCounts();
    expect(afterRestartCounts).toEqual(baselineCounts);

    // 4. Two concurrent workers replaying simultaneously
    const [wA, wB] = await Promise.all([
      ingestCandidateIdempotent(storeAfterRestart, payload, TEST_ENGINEER),
      ingestCandidateIdempotent(storeAfterRestart, payload, TEST_ENGINEER),
    ]);
    expect(wA.work_id).toBe(first.work_id);
    expect(wB.work_id).toBe(first.work_id);
    expect(storeAfterRestart.getAcceptedCounts()).toEqual(baselineCounts);
  });

  it("AT02: reusing the same idempotency key with changed source bytes or scope/config returns 409 Conflict with zero overwrite", async () => {
    const store = new DurableKnowledgeStore(tempDir);
    const baseReq = {
      idempotency_key: "idem-at02-conflict",
      batch_id: "B01" as const,
      source_file_id: "drv_rd_68308",
      original_name: "กค_0702_634.pdf",
      mime_type: "application/pdf",
      bytes: Buffer.from("กค 0702/634 ทองรูปพรรณ ต้องเสียภาษีมูลค่าเพิ่ม มาตรา 77/1", "utf8"),
      official_identifier: "กค 0702/634",
      issue_date: "2026-02-05",
      doc_type: "TaxRuling" as const,
      issuer_id: "reg.th.rd",
      access_scope: "scope.platform.public",
    };

    const ok = await ingestCandidateIdempotent(store, baseReq, TEST_ENGINEER);
    expect(ok.http_status).toBe(201);

    const changedBytes = await ingestCandidateIdempotent(
      store,
      {
        ...baseReq,
        bytes: Buffer.from("กค 0702/634 เนื้อหาเปลี่ยนแปลงได้รับยกเว้น", "utf8"),
      },
      TEST_ENGINEER
    );
    expect(changedBytes.http_status).toBe(409);

    const changedScope = await ingestCandidateIdempotent(
      store,
      {
        ...baseReq,
        access_scope: "scope.tenant.alpha.private",
      },
      TEST_ENGINEER
    );
    expect(changedScope.http_status).toBe(409);
  });

  it("AT03: PDF copy, HTML mirror, renamed copy, and improved OCR of one verified ruling resolve to the SAME LegalWork with separate representations/extraction revisions and no invented amendment", async () => {
    const store = new DurableKnowledgeStore(tempDir);

    const pdfRes = await ingestCandidateIdempotent(
      store,
      {
        idempotency_key: "idem-at03-pdf",
        batch_id: "B01",
        source_file_id: "drv_pdf_1248",
        original_name: "2026-03-05_Ruling_0702-1248.pdf",
        mime_type: "application/pdf",
        bytes: Buffer.from("เลขที่หนังสือ กค 0702/1248 วันที่ 5 มีนาคม 2569 มาตรา 65 วรรคสอง สัญญาเช่า 30 ปี", "utf8"),
        official_identifier: "กค 0702/1248",
        issue_date: "2026-03-05",
        doc_type: "TaxRuling",
        issuer_id: "reg.th.rd",
        access_scope: "scope.platform.public",
        extractor_version: "pdf-native-v1",
      },
      TEST_ENGINEER
    );

    const htmlRes = await ingestCandidateIdempotent(
      store,
      {
        idempotency_key: "idem-at03-html",
        batch_id: "B01",
        source_file_id: "rd_web_68464",
        original_name: "renamed_completely_different_filename.html",
        mime_type: "text/html",
        bytes: Buffer.from("<html><body>กค 0702/1248 ลงวันที่ 5 มีนาคม 2569 มาตรา 65 วรรคสอง สัญญาเช่า 30 ปี</body></html>", "utf8"),
        official_identifier: "กค ๐๗๐๒/๑๒๔๘",
        issue_date: "2026-03-05",
        doc_type: "TaxRuling",
        issuer_id: "reg.th.rd",
        access_scope: "scope.platform.public",
        extractor_version: "html-struct-v1",
      },
      TEST_ENGINEER
    );

    const improvedOcrRes = await ingestCandidateIdempotent(
      store,
      {
        idempotency_key: "idem-at03-ocr-v2",
        batch_id: "B01",
        source_file_id: "drv_pdf_1248",
        original_name: "copy_of_1248 (1).pdf",
        mime_type: "application/pdf",
        bytes: Buffer.from("เลขที่หนังสือ กค 0702/1248 วันที่ 5 มีนาคม 2569 มาตรา 65 วรรคสอง สัญญาเช่า 30 ปี", "utf8"),
        official_identifier: "กค 0702/1248",
        issue_date: "2026-03-05",
        doc_type: "TaxRuling",
        issuer_id: "reg.th.rd",
        access_scope: "scope.platform.public",
        extractor_version: "thai-ocr-v2.1-calibrated",
        extracted_text_override:
          "เลขที่หนังสือ กค 0702/1248 วันที่ 5 มีนาคม 2569 มาตรา 65 วรรคสอง สัญญาเช่าที่ดินระยะยาว 30 ปี",
      },
      TEST_ENGINEER
    );

    expect(htmlRes.work_id).toBe(pdfRes.work_id);
    expect(htmlRes.identity_action).toBe("ATTACH_REPRESENTATION");
    expect(improvedOcrRes.work_id).toBe(pdfRes.work_id);
    expect(improvedOcrRes.identity_action).toBe("NEW_EXTRACTION_REVISION");

    expect(store.getAcceptedCounts().works).toBe(1);
    const versions = store.getVersionsForWork(pdfRes.work_id!);
    expect(versions.length).toBe(1); // OCR improvement does NOT invent a new legal amendment/version!
    const extractions = store.getExtractionsForWork(pdfRes.work_id!);
    expect(extractions.length).toBeGreaterThanOrEqual(2);
  });

  it("AT04: keeps same section number under different statutes or ambiguous similar titles as distinct identities and flags ambiguity for review", () => {
    const store = new DurableKnowledgeStore(tempDir);

    const rcSec25 = resolveCanonicalWorkIdentity(store, {
      doc_type: "Provision",
      issuer_id: "reg.th.parliament",
      instrument_code: "พระราชบัญญัติให้ใช้บทบัญญัติแห่งประมวลรัษฎากร พ.ศ. 2481",
      official_identifier: "มาตรา 25",
      title: "มาตรา 25 แห่งประมวลรัษฎากร",
      issue_date: "1938-04-01",
      access_scope: "scope.platform.public",
    });

    const expropSec25 = resolveCanonicalWorkIdentity(store, {
      doc_type: "Provision",
      issuer_id: "reg.th.parliament",
      instrument_code: "พระราชบัญญัติว่าด้วยการเวนคืนอสังหาริมทรัพย์ พ.ศ. 2562",
      official_identifier: "มาตรา 25",
      title: "มาตรา 25 แห่งพระราชบัญญัติว่าด้วยการเวนคืนอสังหาริมทรัพย์ พ.ศ. 2562",
      issue_date: "2019-05-26",
      access_scope: "scope.platform.public",
    });

    expect(rcSec25.work_id).not.toBe(expropSec25.work_id);

    // Register first ruling and test ambiguous near-duplicate ruling number/title collision
    store.upsertWork({
      work_id: "work.th.rd.0702_500_2568",
      type: "TaxRuling",
      issuer_id: "reg.th.rd",
      jurisdiction: "TH",
      title_th: "ภาษีมูลค่าเพิ่ม กรณีการให้บริการคลาวด์",
      official_identifiers: [{ raw: "กค 0702/500", normalized: "กค 0702/500", kind: "rd_letter_no" }],
      identity_evidence: ["ev_1"],
      aliases: [],
      owner_batch_id: "B01",
      first_loaded_by_batch_id: "B01",
    });

    const ambiguous = resolveCanonicalWorkIdentity(store, {
      doc_type: "TaxRuling",
      issuer_id: "reg.th.rd",
      official_identifier: "", // missing official number, similar title!
      title: "ภาษีมูลค่าเพิ่ม กรณีการให้บริการคลาวด์ (ฉบับเพิ่มเติม)",
      issue_date: null,
      access_scope: "scope.platform.public",
    });

    expect(ambiguous.identity_action).toBe("REVIEW_IDENTITY_CONFLICT");
    expect(ambiguous.requires_review).toBe(true);
  });

  it("F2 Lease Fencing & AT17: rejects stale worker fencing tokens and safely handles empty folders, index/file mismatches, shortcut cycles, and oversized compilations", async () => {
    const store = new DurableKnowledgeStore(tempDir);
    const jobs = new KnowledgeJobManager(store);

    const job = jobs.createJob({
      batch_id: "B01",
      kind: "BATCH_RUN",
      created_by: TEST_ENGINEER.actor_id,
    });
    const lease1 = jobs.acquireLease(job.job_id, "worker-1");
    const lease2 = jobs.acquireLease(job.job_id, "worker-2");
    expect(lease2.fencing_token).toBeGreaterThan(lease1.fencing_token);

    expect(() =>
      jobs.checkpointJob(job.job_id, lease1.fencing_token, { cursor: 10 })
    ).toThrow(/STALE_WORKER_FENCING_TOKEN/);

    // AT17: Empty folder, index/file mismatch, cyclic Drive shortcut, and 1,400-page compilation
    const frozen = await freezeInventory(
      "B01",
      TEST_ENGINEER,
      {
        store,
        syntheticInventoryOverride: {
          folders: [
            { folder_id: "fld_root", parent_id: null, title: "RD Rulings", shortcut_target_id: null },
            { folder_id: "fld_empty", parent_id: "fld_root", title: "Empty Year 2540", shortcut_target_id: null },
            { folder_id: "fld_shortcut_loop", parent_id: "fld_root", title: "Loop Shortcut", shortcut_target_id: "fld_root" },
          ],
          files: [
            {
              file_id: "file_1",
              folder_id: "fld_root",
              name: "กค_0702_636.pdf",
              mime_type: "application/pdf",
              size_bytes: 42000,
              page_count: 2,
              downloadable: true,
              shortcut_target_id: null,
            },
            {
              file_id: "file_1_shortcut",
              folder_id: "fld_root",
              name: "Shortcut to กค_0702_636.pdf",
              mime_type: "application/vnd.google-apps.shortcut",
              size_bytes: 0,
              page_count: null,
              downloadable: true,
              shortcut_target_id: "file_1",
            },
            {
              file_id: "file_huge_comp",
              folder_id: "fld_root",
              name: "รวมแนววินิจฉัยภาษีอากร_1450_หน้า.pdf",
              mime_type: "application/pdf",
              size_bytes: 88_000_000,
              page_count: 1450,
              downloadable: true,
              shortcut_target_id: null,
            },
          ],
          index_rows: [
            { row_id: "idx_1", official_id: "กค 0702/636", file_id: "file_1" },
            { row_id: "idx_2_missing", official_id: "กค 0702/9999", file_id: "file_missing_on_drive" },
          ],
        },
      }
    );

    expect(frozen.manifest.empty_folders_detected).toContain("fld_empty");
    expect(frozen.manifest.shortcut_cycles_prevented).toContain("fld_shortcut_loop->fld_root");
    expect(frozen.manifest.index_mismatches.length).toBe(1);
    expect(frozen.manifest.dedicated_oversized_runs_required).toContain("file_huge_comp");
    // Accounting must include file_1, deduplicated shortcut, huge compilation, and missing index entry without silent drops!
    const plan = await planReconciliation(frozen.manifest.inventory_snapshot_id, TEST_ENGINEER, { store });
    expect(plan.accounting_matches_total).toBe(true);
    expect(plan.silent_drops).toBe(0);
  });
});
