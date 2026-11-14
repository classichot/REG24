/**
 * REG24 — Audit-Driven Safe Archive Unpacking, Multi-Record Text Parsing & Three-Ledger Reconciliation
 * Implements 03_OCR_AUDIT_ADJUSTMENTS.md Section 4 (AT23, AT25).
 */

import * as path from "node:path";
import * as zlib from "node:zlib";
import { sha256Bytes } from "./identity";
import { ingestCandidateIdempotent } from "./inventory";
import type { DurableKnowledgeStore } from "./store";
import type { Actor, BatchId } from "./contracts";

export interface ArchiveIntakeLimits {
  max_nesting_depth: number;
  max_member_count: number;
  max_total_expanded_bytes: number;
  max_compression_ratio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveIntakeLimits = {
  max_nesting_depth: 1,
  max_member_count: 5000,
  max_total_expanded_bytes: 512 * 1024 * 1024, // 512 MiB
  max_compression_ratio: 100,
};

export interface ThreeLedgerResult {
  physical_drive_files: number;
  expanded_members: number;
  expanded_logical_records: number;
  canonical_works_created: number;
  canonical_works_reused: number;
}

export interface ContainerIntakeOutcome {
  status: "COMPLETED" | "PAUSED_OR_REJECTED";
  detected_format: "ZIP" | "GZIP" | "PDF" | "UTF8_TEXT" | "UNKNOWN";
  container_sha256: string;
  reason_code: string | null;
  ocr_calls_invoked: number;
  ledgers: ThreeLedgerResult;
  member_manifest: Array<{
    member_path: string;
    member_sha256: string;
    byte_length: number;
    records_parsed: number;
    outcome: "PROCESSED_TEXT" | "ROUTED_TO_PAGE_ROUTER" | "BLOCKED";
  }>;
}

/**
 * Helper to create a valid uncompressed (STORE method 0) ZIP archive buffer for deterministic tests
 * without requiring external binary tools.
 */
export function createStoredZipBufferForTesting(
  entries: Array<{ name: string; data: Buffer }>,
  opts?: { simulateEncryptedFlag?: boolean }
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const gpFlag = opts?.simulateEncryptedFlag ? 0x0001 : 0x0000;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = entry.data;

    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHdr.writeUInt16LE(20, 4); // Version needed
    localHdr.writeUInt16LE(gpFlag, 6); // General purpose bit flag
    localHdr.writeUInt16LE(0, 8); // Compression method 0 = STORE
    localHdr.writeUInt32LE(0, 14); // CRC32 (0 in test fixture)
    localHdr.writeUInt32LE(dataBuf.length, 18); // Compressed size
    localHdr.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    const localRecord = Buffer.concat([localHdr, nameBuf, dataBuf]);
    localParts.push(localRecord);

    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(gpFlag, 8);
    centralHdr.writeUInt16LE(0, 10);
    centralHdr.writeUInt32LE(dataBuf.length, 20);
    centralHdr.writeUInt32LE(dataBuf.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([centralHdr, nameBuf]));

    offset += localRecord.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

export function detectTrueContentFormat(bytes: Buffer): "ZIP" | "GZIP" | "PDF" | "UTF8_TEXT" | "UNKNOWN" {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) return "ZIP";
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "GZIP";
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "PDF";
  // Check UTF-8 text plausibility (zero NUL bytes)
  if (!bytes.includes(0x00)) return "UTF8_TEXT";
  return "UNKNOWN";
}

function isSafeRelativeArchiveMemberPath(memberPath: string): boolean {
  if (!memberPath || memberPath.startsWith("/") || memberPath.startsWith("\\") || /^[a-zA-Z]:/.test(memberPath)) {
    return false;
  }
  const normalized = path.posix.normalize(memberPath.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    return false;
  }
  return true;
}

function isBlockedExecutableMember(memberPath: string, data: Buffer): boolean {
  if (/\.(exe|dll|bat|cmd|ps1|vbs|js|msi|sh|docm|xlsm)$/i.test(memberPath)) {
    return true;
  }
  if (data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a) {
    return true; // MZ PE header
  }
  return false;
}

function unpackZipBufferSafely(
  zipBytes: Buffer,
  limits: ArchiveIntakeLimits
): {
  ok: boolean;
  reason_code?: string;
  entries: Array<{ name: string; data: Buffer }>;
} {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let cursor = 0;
  let totalExpanded = 0;

  while (cursor + 4 <= zipBytes.length) {
    const sig = zipBytes.readUInt32LE(cursor);
    if (sig !== 0x04034b50) break; // Reached central directory
    if (cursor + 30 > zipBytes.length) {
      return { ok: false, reason_code: "CORRUPT_ZIP_HEADER", entries: [] };
    }

    const gpFlag = zipBytes.readUInt16LE(cursor + 6);
    if ((gpFlag & 0x0001) !== 0) {
      return { ok: false, reason_code: "ENCRYPTED_CONTAINER_PAUSED", entries: [] };
    }

    const method = zipBytes.readUInt16LE(cursor + 8);
    const compSize = zipBytes.readUInt32LE(cursor + 18);
    const uncompSize = zipBytes.readUInt32LE(cursor + 22);
    const nameLen = zipBytes.readUInt16LE(cursor + 26);
    const extraLen = zipBytes.readUInt16LE(cursor + 28);

    const nameStart = cursor + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > zipBytes.length) {
      return { ok: false, reason_code: "TRUNCATED_ZIP_ENTRY", entries: [] };
    }

    const memberName = zipBytes.subarray(nameStart, nameStart + nameLen).toString("utf8");
    if (!isSafeRelativeArchiveMemberPath(memberName)) {
      return { ok: false, reason_code: "ARCHIVE_PATH_TRAVERSAL_BLOCKED", entries: [] };
    }

    if (entries.length + 1 > limits.max_member_count) {
      return { ok: false, reason_code: "MEMBER_COUNT_LIMIT_EXCEEDED", entries: [] };
    }

    const rawSlice = zipBytes.subarray(dataStart, dataEnd);
    let expanded: Buffer;
    if (method === 0) {
      expanded = Buffer.from(rawSlice);
    } else if (method === 8) {
      expanded = zlib.inflateRawSync(rawSlice, { maxOutputLength: limits.max_total_expanded_bytes });
    } else {
      return { ok: false, reason_code: `UNSUPPORTED_ZIP_METHOD_${method}`, entries: [] };
    }

    const ratio = compSize > 0 ? expanded.length / compSize : 1;
    if (ratio > limits.max_compression_ratio || uncompSize > limits.max_total_expanded_bytes) {
      return { ok: false, reason_code: "COMPRESSION_RATIO_EXCEEDED", entries: [] };
    }

    totalExpanded += expanded.length;
    if (totalExpanded > limits.max_total_expanded_bytes) {
      return { ok: false, reason_code: "EXPANDED_BYTE_LIMIT_EXCEEDED", entries: [] };
    }

    if (isBlockedExecutableMember(memberName, expanded)) {
      return { ok: false, reason_code: "EXECUTABLE_MEMBER_BLOCKED", entries: [] };
    }

    if (detectTrueContentFormat(expanded) === "ZIP" || detectTrueContentFormat(expanded) === "GZIP") {
      return { ok: false, reason_code: "NESTED_ARCHIVE_PAUSED", entries: [] };
    }

    entries.push({ name: memberName, data: expanded });
    cursor = dataEnd;
  }

  return { ok: true, entries };
}

export function splitValidatedTextCorpusRecords(text: string): Array<{
  official_id: string;
  date: string | null;
  source_url: string | null;
  body: string;
  byte_start: number;
  byte_end: number;
}> {
  const markerRe =
    /===\s*RECORD START\s*\|\s*ID:\s*([^|]+)\|\s*DATE:\s*([^|]+)\|\s*URL:\s*([^=]+)===\r?\n([\s\S]*?)\r?\n===\s*RECORD END\s*===/g;
  const records: Array<{
    official_id: string;
    date: string | null;
    source_url: string | null;
    body: string;
    byte_start: number;
    byte_end: number;
  }> = [];

  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text)) !== null) {
    const byteStart = Buffer.byteLength(text.slice(0, m.index), "utf8");
    const byteEnd = byteStart + Buffer.byteLength(m[0], "utf8");
    records.push({
      official_id: m[1].trim(),
      date: m[2].trim() || null,
      source_url: m[3].trim() || null,
      body: m[4].trim(),
      byte_start: byteStart,
      byte_end: byteEnd,
    });
  }

  if (records.length === 0 && text.trim().length > 0) {
    records.push({
      official_id: "",
      date: null,
      source_url: null,
      body: text.trim(),
      byte_start: 0,
      byte_end: Buffer.byteLength(text, "utf8"),
    });
  }

  return records;
}

const SYSTEM_OPERATOR: Actor = {
  actor_id: "system.archive_intake@reg24.th",
  role: "data_operator",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

export async function ingestContainerOrTextDataset(
  store: DurableKnowledgeStore,
  input: {
    batch_id: BatchId;
    physical_file_id: string;
    file_name: string;
    bytes: Buffer;
    access_scope: string;
    download_incomplete?: boolean;
    limitsOverride?: Partial<ArchiveIntakeLimits>;
  }
): Promise<ContainerIntakeOutcome> {
  const containerSha = sha256Bytes(input.bytes);
  const limits: ArchiveIntakeLimits = {
    ...DEFAULT_ARCHIVE_LIMITS,
    ...(input.limitsOverride || {}),
  };

  if (input.download_incomplete) {
    return {
      status: "PAUSED_OR_REJECTED",
      detected_format: detectTrueContentFormat(input.bytes),
      container_sha256: containerSha,
      reason_code: "INCOMPLETE_DOWNLOAD",
      ocr_calls_invoked: 0,
      ledgers: {
        physical_drive_files: 1,
        expanded_members: 0,
        expanded_logical_records: 0,
        canonical_works_created: 0,
        canonical_works_reused: 0,
      },
      member_manifest: [],
    };
  }

  const fmt = detectTrueContentFormat(input.bytes);
  let members: Array<{ name: string; data: Buffer }> = [];

  if (fmt === "ZIP") {
    const unpacked = unpackZipBufferSafely(input.bytes, limits);
    if (!unpacked.ok) {
      return {
        status: "PAUSED_OR_REJECTED",
        detected_format: "ZIP",
        container_sha256: containerSha,
        reason_code: unpacked.reason_code || "ARCHIVE_VALIDATION_FAILED",
        ocr_calls_invoked: 0,
        ledgers: {
          physical_drive_files: 1,
          expanded_members: 0,
          expanded_logical_records: 0,
          canonical_works_created: 0,
          canonical_works_reused: 0,
        },
        member_manifest: [],
      };
    }
    members = unpacked.entries;
  } else if (fmt === "GZIP") {
    let inflated: Buffer;
    try {
      inflated = zlib.gunzipSync(input.bytes, { maxOutputLength: limits.max_total_expanded_bytes });
    } catch {
      return {
        status: "PAUSED_OR_REJECTED",
        detected_format: "GZIP",
        container_sha256: containerSha,
        reason_code: "GZIP_DECOMPRESSION_OR_LIMIT_FAILED",
        ocr_calls_invoked: 0,
        ledgers: {
          physical_drive_files: 1,
          expanded_members: 0,
          expanded_logical_records: 0,
          canonical_works_created: 0,
          canonical_works_reused: 0,
        },
        member_manifest: [],
      };
    }
    const ratio = input.bytes.length > 0 ? inflated.length / input.bytes.length : 1;
    if (ratio > limits.max_compression_ratio) {
      return {
        status: "PAUSED_OR_REJECTED",
        detected_format: "GZIP",
        container_sha256: containerSha,
        reason_code: "COMPRESSION_RATIO_EXCEEDED",
        ocr_calls_invoked: 0,
        ledgers: {
          physical_drive_files: 1,
          expanded_members: 0,
          expanded_logical_records: 0,
          canonical_works_created: 0,
          canonical_works_reused: 0,
        },
        member_manifest: [],
      };
    }
    members = [{ name: input.file_name.replace(/\.gz$/i, ""), data: inflated }];
  } else if (fmt === "UTF8_TEXT") {
    members = [{ name: input.file_name, data: input.bytes }];
  } else {
    return {
      status: "PAUSED_OR_REJECTED",
      detected_format: fmt,
      container_sha256: containerSha,
      reason_code: "NON_TEXT_BINARY_REQUIRES_PAGE_ROUTER",
      ocr_calls_invoked: 0,
      ledgers: {
        physical_drive_files: 1,
        expanded_members: 1,
        expanded_logical_records: 0,
        canonical_works_created: 0,
        canonical_works_reused: 0,
      },
      member_manifest: [],
    };
  }

  let totalRecords = 0;
  let worksCreated = 0;
  let worksReused = 0;
  const memberManifest: ContainerIntakeOutcome["member_manifest"] = [];

  for (const m of members) {
    const memberSha = sha256Bytes(m.data);
    const memberFmt = detectTrueContentFormat(m.data);
    if (memberFmt === "PDF") {
      memberManifest.push({
        member_path: m.name,
        member_sha256: memberSha,
        byte_length: m.data.length,
        records_parsed: 0,
        outcome: "ROUTED_TO_PAGE_ROUTER",
      });
      continue;
    }

    const decoded = m.data.toString("utf8");
    const records = splitValidatedTextCorpusRecords(decoded);
    totalRecords += records.length;

    for (let idx = 0; idx < records.length; idx++) {
      const rec = records[idx];
      const recBytes = Buffer.from(rec.body, "utf8");
      const idemKey = `idem.txt.${containerSha.slice(0, 12)}.${memberSha.slice(0, 8)}.${idx}`;
      const res = await ingestCandidateIdempotent(
        store,
        {
          idempotency_key: idemKey,
          batch_id: input.batch_id,
          source_file_id: `${input.physical_file_id}#${m.name}#${idx}`,
          original_name: `${m.name}#record_${idx + 1}`,
          mime_type: "text/plain",
          bytes: recBytes,
          official_identifier: rec.official_id,
          issue_date: rec.date,
          doc_type: /^กค/.test(rec.official_id) ? "TaxRuling" : "CourtDecision",
          issuer_id: /^กค/.test(rec.official_id) ? "reg.th.rd" : "reg.th.court",
          access_scope: input.access_scope,
          extractor_version: "utf8-text-record-parser-v1",
        },
        SYSTEM_OPERATOR
      );
      if (res.identity_action === "CREATE_NEW_WORK") {
        worksCreated += 1;
      } else {
        worksReused += 1;
      }
    }

    memberManifest.push({
      member_path: m.name,
      member_sha256: memberSha,
      byte_length: m.data.length,
      records_parsed: records.length,
      outcome: "PROCESSED_TEXT",
    });
  }

  return {
    status: "COMPLETED",
    detected_format: fmt,
    container_sha256: containerSha,
    reason_code: null,
    ocr_calls_invoked: 0, // Validated plain text NEVER invokes image OCR (AT23)
    ledgers: {
      physical_drive_files: 1,
      expanded_members: members.length,
      expanded_logical_records: totalRecords,
      canonical_works_created: worksCreated,
      canonical_works_reused: worksReused,
    },
    member_manifest: memberManifest,
  };
}
