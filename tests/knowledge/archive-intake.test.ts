import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as zlib from "node:zlib";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import {
  ingestContainerOrTextDataset,
  createStoredZipBufferForTesting,
} from "../../src/core/knowledge/archive-intake";

describe("Audit Archive & Multi-Record Text Intake Contract (AT23, AT25)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-kn-arch-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("AT23: Same corpus in plain TXT, GZIP, and ZIP preserves record boundaries/provenance, creates zero duplicate accepted works, and invokes ZERO OCR calls on validated plain text", async () => {
    const store = new DurableKnowledgeStore(tempDir);
    const multiRecordTxt = [
      "=== RECORD START | ID: กค 0702/636 | DATE: 5 กุมภาพันธ์ 2569 | URL: https://www.rd.go.th/68302.html ===",
      "เรื่อง ภาษีมูลค่าเพิ่ม กรณีเงินสนับสนุนจากองค์การ A แนววินิจฉัย ได้รับสิทธิเสียภาษีมูลค่าเพิ่มร้อยละ 0 ตามมาตรา 80/1 (4)",
      "=== RECORD END ===",
      "=== RECORD START | ID: กค 0702/634 | DATE: 5 กุมภาพันธ์ 2569 | URL: https://www.rd.go.th/68308.html ===",
      "เรื่อง ภาษีมูลค่าเพิ่ม กรณีการนำเข้าทองรูปพรรณ ต้องเสียภาษีมูลค่าเพิ่มตามมาตรา 77/1 (12)",
      "=== RECORD END ===",
    ].join("\n");

    const txtBytes = Buffer.from(multiRecordTxt, "utf8");
    const gzBytes = zlib.gzipSync(txtBytes);
    const zipBytes = createStoredZipBufferForTesting([
      { name: "rulings_2569.txt", data: txtBytes },
    ]);

    const rTxt = await ingestContainerOrTextDataset(store, {
      batch_id: "B01",
      physical_file_id: "drv_txt_01",
      file_name: "rulings_2569.txt",
      bytes: txtBytes,
      access_scope: "scope.platform.public",
    });

    expect(rTxt.status).toBe("COMPLETED");
    expect(rTxt.ocr_calls_invoked).toBe(0);
    expect(rTxt.ledgers.physical_drive_files).toBe(1);
    expect(rTxt.ledgers.expanded_logical_records).toBe(2);
    expect(rTxt.ledgers.canonical_works_created).toBe(2);

    const rGz = await ingestContainerOrTextDataset(store, {
      batch_id: "B01",
      physical_file_id: "drv_gz_01",
      file_name: "rulings_2569.txt.gz",
      bytes: gzBytes,
      access_scope: "scope.platform.public",
    });

    const rZip = await ingestContainerOrTextDataset(store, {
      batch_id: "B01",
      physical_file_id: "drv_zip_01",
      file_name: "rulings_2569_archive.zip",
      bytes: zipBytes,
      access_scope: "scope.platform.public",
    });

    expect(rGz.ocr_calls_invoked).toBe(0);
    expect(rZip.ocr_calls_invoked).toBe(0);
    // Zero duplicate accepted works across TXT, GZ, and ZIP copies!
    expect(store.getAcceptedCounts().works).toBe(2);
    expect(rZip.ledgers.canonical_works_reused).toBe(2);
  });

  it("AT25: Incomplete download, path traversal (../), executable member, encrypted archive, or over-limit ratio fails/pauses cleanly with full ledger and zero escaping writes", async () => {
    const store = new DurableKnowledgeStore(tempDir);

    const incompleteRes = await ingestContainerOrTextDataset(store, {
      batch_id: "B10",
      physical_file_id: "drv_inc_01",
      file_name: "พิกัด_ภาษี_เรือ.pdf",
      bytes: Buffer.from("%PDF-1.4 truncated", "utf8"),
      download_incomplete: true,
      access_scope: "scope.platform.public",
    });
    expect(incompleteRes.status).toBe("PAUSED_OR_REJECTED");
    expect(incompleteRes.reason_code).toBe("INCOMPLETE_DOWNLOAD");

    const traversalZip = createStoredZipBufferForTesting([
      { name: "../../etc/passwd", data: Buffer.from("malicious", "utf8") },
    ]);
    const travRes = await ingestContainerOrTextDataset(store, {
      batch_id: "B10",
      physical_file_id: "drv_zip_trav",
      file_name: "bad_traversal.zip",
      bytes: traversalZip,
      access_scope: "scope.platform.public",
    });
    expect(travRes.status).toBe("PAUSED_OR_REJECTED");
    expect(travRes.reason_code).toBe("ARCHIVE_PATH_TRAVERSAL_BLOCKED");

    const exeZip = createStoredZipBufferForTesting([
      { name: "setup_macro.exe", data: Buffer.from("MZ9000", "utf8") },
    ]);
    const exeRes = await ingestContainerOrTextDataset(store, {
      batch_id: "B10",
      physical_file_id: "drv_zip_exe",
      file_name: "exe_payload.zip",
      bytes: exeZip,
      access_scope: "scope.platform.public",
    });
    expect(exeRes.status).toBe("PAUSED_OR_REJECTED");
    expect(exeRes.reason_code).toBe("EXECUTABLE_MEMBER_BLOCKED");

    const encryptedRes = await ingestContainerOrTextDataset(store, {
      batch_id: "B10",
      physical_file_id: "drv_zip_enc",
      file_name: "encrypted_archive.zip",
      bytes: createStoredZipBufferForTesting(
        [{ name: "secret.txt", data: Buffer.from("abc", "utf8") }],
        { simulateEncryptedFlag: true }
      ),
      access_scope: "scope.platform.public",
    });
    expect(encryptedRes.status).toBe("PAUSED_OR_REJECTED");
    expect(encryptedRes.reason_code).toBe("ENCRYPTED_CONTAINER_PAUSED");

    const overLimitGz = zlib.gzipSync(Buffer.alloc(200_000, "A"));
    const ratioRes = await ingestContainerOrTextDataset(store, {
      batch_id: "B10",
      physical_file_id: "drv_gz_bomb",
      file_name: "high_ratio.gz",
      bytes: overLimitGz,
      access_scope: "scope.platform.public",
      limitsOverride: { max_compression_ratio: 10 },
    });
    expect(ratioRes.status).toBe("PAUSED_OR_REJECTED");
    expect(ratioRes.reason_code).toBe("COMPRESSION_RATIO_EXCEEDED");
  });
});
