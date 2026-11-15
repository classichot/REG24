/**
 * REG24 — Strictly Read-Only Verification & Isolated-Restore Audit Tool for Neo4j `374f4f7e`
 *
 * SAFETY & GOVERNANCE GUARANTEES (Owner Instruction 1 — 2026-11-15):
 * 1. NEVER resumes, deletes, resets, overwrites, imports into, migrates, upgrades, or promotes any Neo4j instance.
 * 2. Strict Target Validation (`validateAuditTarget`):
 *    - In `live-374f4f7e` mode (default): requires explicit `NEO4J_URI` / `--bolt-uri` (zero silent fallback to
 *      `374f4f7e.databases.neo4j.io`), enforces TLS scheme (`neo4j+s://` or `bolt+s://`), strictly verifies
 *      Aura instance ID === `374f4f7e` AND configured database === `374f4f7e`, and verifies server-reported
 *      database identity via `CALL db.info() YIELD name RETURN name` inside a read transaction.
 *    - In `isolated-restore` mode (`--target-mode isolated-restore --bolt-uri bolt://127.0.0.1:7687`):
 *      strictly enforces loopback host (`127.0.0.1`, `localhost`, `[::1]`) and hard-blocks `*.databases.neo4j.io`
 *      so an audit against an isolated restored copy can NEVER connect to live Aura. Also computes & verifies
 *      SHA-256 checksums for exported `.backup` / `.dump` files (`--backup-file`, `--expected-sha256`).
 * 3. Strict Read-Only Execution:
 *    - Uses `defaultAccessMode: neo4j.session.READ` + `session.executeRead(...)` + `assertStrictlyReadOnlyCypher`
 *      blocking all write, DDL, admin, multi-statement, and mutating procedure tokens.
 * 4. Honest Dynamic Failure Classification (`classifyAuditFailure`):
 *    - Reports the ACTUAL observed failure stage and sanitized error message (`TARGET_VALIDATION_FAILED`,
 *      `DNS_RESOLUTION_FAILED`, `TCP_CONNECT_FAILED`, `BOLT_AUTHENTICATION_FAILED`, `BOLT_TLS_ERROR`,
 *      `DATABASE_IDENTITY_MISMATCH`, `CYPHER_READ_QUERY_FAILED`, `BACKUP_FILE_VERIFICATION_FAILED`) —
 *      never emitting a hardcoded explanation.
 */
import * as dns from "node:dns/promises";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import neo4j, { type Driver } from "neo4j-driver";
import { sanitizeGraphError } from "../src/core/graph/neo4j-client";

export const EXPECTED_AURA_INSTANCE_ID = "374f4f7e";
export const EXPECTED_AURA_HOST = "374f4f7e.databases.neo4j.io";

export type AuditTargetMode = "live-374f4f7e" | "isolated-restore";

export type AuditFailureCode =
  | "TARGET_VALIDATION_FAILED"
  | "BACKUP_FILE_VERIFICATION_FAILED"
  | "DNS_RESOLUTION_FAILED"
  | "TCP_CONNECT_FAILED"
  | "BOLT_AUTHENTICATION_FAILED"
  | "BOLT_TLS_ERROR"
  | "DATABASE_IDENTITY_MISMATCH"
  | "BOLT_ROUTING_OR_PROTOCOL_FAILED"
  | "CYPHER_READ_QUERY_FAILED";

export interface ValidatedAuditTarget {
  valid: boolean;
  target_mode: AuditTargetMode;
  uri: string | null;
  scheme: string | null;
  host: string | null;
  port: number;
  aura_instance_id: string | null;
  expected_database: string | null;
  username_configured: boolean;
  password_configured: boolean;
  validation_errors: string[];
}

export interface BackupVerificationReceipt {
  verified: boolean;
  backup_path: string;
  file_exists: boolean;
  format: "neo4j_backup" | "neo4j_dump" | "archive" | "unknown";
  size_bytes: number | null;
  actual_sha256: string | null;
  expected_sha256: string | null;
  checksum_matches: boolean | null;
  error: string | null;
}

export interface LiveReadOnlyGraphAudit {
  verification_status: "VERIFIED_LIVE_READ" | "VERIFIED_ISOLATED_RESTORE_READ";
  verified_server_database_name: string;
  dbms_components: Array<Record<string, unknown>>;
  total_nodes: number;
  total_relationships: number;
  counts_by_label: Record<string, number>;
  counts_by_relationship_type: Record<string, number>;
  counts_by_migration_batch_id: Record<string, number>;
  b01_release_nodes_count: number;
  b01_knowledge_work_th_rd_nodes_count: number;
  legacy_seed_tax_ruling_nodes_count: number;
  lrm_chunk_nodes_count: number;
  orphan_nodes_count: number;
}

export interface DynamicFailureReport {
  verification_status: AuditFailureCode;
  failure_stage:
    | "target_validation"
    | "backup_checksum_verification"
    | "dns_resolution"
    | "tcp_reachability"
    | "bolt_handshake_or_auth"
    | "database_identity_check"
    | "cypher_read_query";
  observed_error_code: string | null;
  observed_sanitized_message: string;
  diagnostic_summary: string;
}

const FORBIDDEN_WRITE_OR_ADMIN_CYPHER =
  /\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|ALTER|RENAME|FOREACH|LOAD\s+CSV|GRANT|DENY|REVOKE|START\s+DATABASE|STOP\s+DATABASE|CREATE\s+DATABASE|CREATE\s+USER|ALTER\s+USER|DROP\s+USER|apoc\.|dbms\.security|dbms\.cluster|gds\.)\b/i;

const ALLOWED_CALL_PROCEDURES =
  /^\s*CALL\s+(?:db\.info\(\)|dbms\.components\(\)|db\.labels\(\)|db\.relationshipTypes\(\))(?:\s|$)/i;

export function assertStrictlyReadOnlyCypher(cypher: string): void {
  const trimmed = cypher.trim();
  if (!trimmed) {
    throw new Error("READ_ONLY_FIREWALL_BLOCKED: Empty Cypher query is not allowed.");
  }
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error(
      `READ_ONLY_FIREWALL_BLOCKED: Multi-statement Cypher is forbidden: ${trimmed}`
    );
  }
  if (FORBIDDEN_WRITE_OR_ADMIN_CYPHER.test(trimmed)) {
    throw new Error(
      `READ_ONLY_FIREWALL_BLOCKED: Refusing non-read or administrative Cypher statement: ${trimmed}`
    );
  }
  if (/\bCALL\b/i.test(trimmed) && !ALLOWED_CALL_PROCEDURES.test(trimmed)) {
    throw new Error(
      `READ_ONLY_FIREWALL_BLOCKED: Procedure call outside read-only allowlist (db.info, dbms.components, db.labels, db.relationshipTypes): ${trimmed}`
    );
  }
}

export function validateAuditTarget(input: {
  targetMode: AuditTargetMode;
  uri: string;
  username: string;
  password: string;
  database: string;
  expectedInstanceId?: string;
}): ValidatedAuditTarget {
  const errors: string[] = [];
  const rawUri = (input.uri || "").trim();
  const username = (input.username || "").trim();
  const password = (input.password || "").trim();
  const database = (input.database || "").trim();
  const expectedId = (input.expectedInstanceId || EXPECTED_AURA_INSTANCE_ID).trim().toLowerCase();
  const expectedHost = `${expectedId}.databases.neo4j.io`;

  if (!rawUri) {
    errors.push(
      input.targetMode === "live-374f4f7e"
        ? "Missing NEO4J_URI (or --bolt-uri). Target validator refuses to substitute a default hostname."
        : "Missing --bolt-uri for isolated-restore verification."
    );
  }
  if (!username) {
    errors.push("Missing Neo4j username (NEO4J_USERNAME or --username).");
  }
  if (!password) {
    errors.push("Missing Neo4j password (NEO4J_PASSWORD or --password).");
  }
  if (!database) {
    errors.push("Missing Neo4j database name (NEO4J_DATABASE or --database).");
  }

  let scheme: string | null = null;
  let host: string | null = null;
  let port = 7687;
  let auraInstanceId: string | null = null;

  if (rawUri) {
    const schemeMatch = rawUri.match(/^([a-zA-Z0-9+.-]+):\/\//);
    if (!schemeMatch) {
      errors.push(`Invalid Neo4j URI (missing scheme): ${sanitizeGraphError(rawUri)}`);
    } else {
      scheme = schemeMatch[1].toLowerCase();
      const allowedSchemes =
        input.targetMode === "live-374f4f7e"
          ? ["neo4j+s", "bolt+s"]
          : ["bolt", "neo4j", "bolt+s", "neo4j+s", "bolt+ssc", "neo4j+ssc"];
      if (!allowedSchemes.includes(scheme)) {
        errors.push(
          `Disallowed URI scheme '${scheme}' for mode '${input.targetMode}'. Allowed: ${allowedSchemes.join(", ")}.`
        );
      }
      try {
        const normalizedHttp = rawUri.replace(/^[a-zA-Z0-9+.-]+:\/\//, "https://");
        const parsed = new URL(normalizedHttp);
        host = parsed.hostname.toLowerCase();
        port = parsed.port ? Number(parsed.port) : 7687;
      } catch (err) {
        errors.push(`Malformed Neo4j URI: ${sanitizeGraphError(err)}`);
      }
    }
  }

  if (host) {
    const auraMatch = host.match(/^([a-z0-9-]+)\.databases\.neo4j\.io$/i);
    auraInstanceId = auraMatch ? auraMatch[1].toLowerCase() : null;

    if (input.targetMode === "live-374f4f7e") {
      if (host !== expectedHost || auraInstanceId !== expectedId) {
        errors.push(
          `Target host '${host}' (instance='${auraInstanceId ?? "non-aura"}') does NOT match authorized Aura instance '${expectedId}' ('${expectedHost}').`
        );
      }
      const allowedDbNames = input.expectedInstanceId
        ? new Set([expectedId, "neo4j"])
        : new Set([expectedId]);
      if (database && !allowedDbNames.has(database)) {
        errors.push(
          `Configured database '${database}' does NOT match authorized Aura database '${expectedId}'.`
        );
      }
    } else {
      // isolated-restore mode: MUST be loopback and MUST NEVER point to *.databases.neo4j.io
      const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
      if (host.endsWith(".databases.neo4j.io") || auraInstanceId !== null) {
        errors.push(
          `Refusing live Aura host '${host}' in 'isolated-restore' mode. Isolated restore verification must target a local loopback container/DBMS.`
        );
      } else if (!loopbackHosts.has(host)) {
        errors.push(
          `Non-loopback host '${host}' rejected in 'isolated-restore' mode. Allowed hosts: 127.0.0.1, localhost, ::1.`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    target_mode: input.targetMode,
    uri: rawUri || null,
    scheme,
    host,
    port,
    aura_instance_id: auraInstanceId,
    expected_database: database || null,
    username_configured: Boolean(username),
    password_configured: Boolean(password),
    validation_errors: errors,
  };
}

export function verifyBackupFileChecksum(
  backupFilePath: string,
  expectedSha256?: string | null
): BackupVerificationReceipt {
  const resolved = path.resolve(backupFilePath);
  if (!fs.existsSync(resolved)) {
    return {
      verified: false,
      backup_path: resolved,
      file_exists: false,
      format: "unknown",
      size_bytes: null,
      actual_sha256: null,
      expected_sha256: expectedSha256 ? expectedSha256.toLowerCase() : null,
      checksum_matches: null,
      error: `Backup file does not exist at path: ${resolved}`,
    };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size === 0) {
    return {
      verified: false,
      backup_path: resolved,
      file_exists: stat.isFile(),
      format: "unknown",
      size_bytes: stat.size,
      actual_sha256: null,
      expected_sha256: expectedSha256 ? expectedSha256.toLowerCase() : null,
      checksum_matches: null,
      error: `Backup artifact at ${resolved} is empty or not a regular file (size=${stat.size}).`,
    };
  }

  const ext = path.extname(resolved).toLowerCase();
  const format: BackupVerificationReceipt["format"] =
    ext === ".backup"
      ? "neo4j_backup"
      : ext === ".dump"
        ? "neo4j_dump"
        : ext === ".tar" || ext === ".gz" || ext === ".tgz"
          ? "archive"
          : "unknown";

  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(resolved, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  const actualSha = hash.digest("hex");
  const normalizedExpected = expectedSha256 ? expectedSha256.trim().toLowerCase() : null;
  const matches = normalizedExpected ? actualSha === normalizedExpected : null;

  return {
    verified: matches !== false,
    backup_path: resolved,
    file_exists: true,
    format,
    size_bytes: stat.size,
    actual_sha256: actualSha,
    expected_sha256: normalizedExpected,
    checksum_matches: matches,
    error:
      matches === false
        ? `Backup SHA-256 mismatch: expected ${normalizedExpected}, got ${actualSha}`
        : null,
  };
}

export async function runReadOnlyGraphAuditWithDriver(
  driver: Driver,
  expectedDatabase: string,
  targetMode: AuditTargetMode
): Promise<LiveReadOnlyGraphAudit> {
  const runRead = async <T extends Record<string, unknown>>(
    cypher: string
  ): Promise<{ rows: T[]; summaryDatabaseName: string | null }> => {
    assertStrictlyReadOnlyCypher(cypher);
    const session = driver.session({
      database: expectedDatabase,
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      const res = await session.executeRead((tx) => tx.run(cypher));
      const rows = res.records.map((r) => {
        const obj: Record<string, unknown> = {};
        for (const k of r.keys) {
          const val = r.get(k);
          obj[String(k)] = neo4j.isInt(val) ? val.toNumber() : val;
        }
        return obj as T;
      });
      const summaryDbName =
        res.summary && res.summary.database && typeof res.summary.database.name === "string"
          ? res.summary.database.name
          : null;
      return { rows, summaryDatabaseName: summaryDbName };
    } finally {
      await session.close();
    }
  };

  // 1. Strictly verify server-reported database identity first
  const dbInfoRes = await runRead<{ name: string }>("CALL db.info() YIELD name RETURN name");
  const reportedDbName =
    dbInfoRes.rows[0]?.name || dbInfoRes.summaryDatabaseName || "";
  if (!reportedDbName || reportedDbName !== expectedDatabase) {
    const mismatchErr = new Error(
      `DATABASE_IDENTITY_MISMATCH: Expected database '${expectedDatabase}', server reported '${reportedDbName || "empty"}'.`
    );
    (mismatchErr as Error & { code?: string }).code = "DATABASE_IDENTITY_MISMATCH";
    throw mismatchErr;
  }

  // 2. Read-only DBMS component & graph inventory queries
  const dbmsComponentsRes = await runRead(
    "CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition"
  );
  const totNodesRes = await runRead<{ cnt: number }>("MATCH (n) RETURN count(n) AS cnt");
  const totRelsRes = await runRead<{ cnt: number }>("MATCH ()-[r]->() RETURN count(r) AS cnt");
  const labelRes = await runRead<{ label: string; cnt: number }>(
    "MATCH (n) UNWIND labels(n) AS label RETURN label, count(n) AS cnt ORDER BY cnt DESC"
  );
  const relTypeRes = await runRead<{ relType: string; cnt: number }>(
    "MATCH ()-[r]->() RETURN type(r) AS relType, count(r) AS cnt ORDER BY cnt DESC"
  );
  const batchRes = await runRead<{ batchId: string; cnt: number }>(
    "MATCH (n) RETURN coalesce(n.migration_batch_id, n.release_id, 'UNSET') AS batchId, count(n) AS cnt ORDER BY cnt DESC"
  );
  const b01RelNodesRes = await runRead<{ cnt: number }>(
    "MATCH (n) WHERE n.release_id STARTS WITH 'rel.B01' OR n.canonical_id STARTS WITH 'asrt.' OR n.canonical_id STARTS WITH 'psg.' RETURN count(n) AS cnt"
  );
  const b01WorkNodesRes = await runRead<{ cnt: number }>(
    "MATCH (n) WHERE n.canonical_id STARTS WITH 'work.th.rd.' OR n.work_id STARTS WITH 'work.th.rd.' RETURN count(n) AS cnt"
  );
  const seedTaxRulingsRes = await runRead<{ cnt: number }>(
    "MATCH (n:TaxRuling) RETURN count(n) AS cnt"
  );
  const lrmChunksRes = await runRead<{ cnt: number }>(
    "MATCH (n) WHERE n.canonical_id STARTS WITH 'inst.lrm.' OR n.migration_batch_id STARTS WITH 'mig.lrm.chunks.' RETURN count(n) AS cnt"
  );
  const orphanRes = await runRead<{ cnt: number }>(
    "MATCH (n) WHERE NOT (n)--() RETURN count(n) AS cnt"
  );

  const byLabel: Record<string, number> = {};
  for (const r of labelRes.rows) byLabel[r.label] = r.cnt;
  const byRel: Record<string, number> = {};
  for (const r of relTypeRes.rows) byRel[r.relType] = r.cnt;
  const byBatch: Record<string, number> = {};
  for (const r of batchRes.rows) byBatch[r.batchId] = r.cnt;

  return {
    verification_status:
      targetMode === "isolated-restore"
        ? "VERIFIED_ISOLATED_RESTORE_READ"
        : "VERIFIED_LIVE_READ",
    verified_server_database_name: reportedDbName,
    dbms_components: dbmsComponentsRes.rows,
    total_nodes: totNodesRes.rows[0]?.cnt ?? 0,
    total_relationships: totRelsRes.rows[0]?.cnt ?? 0,
    counts_by_label: byLabel,
    counts_by_relationship_type: byRel,
    counts_by_migration_batch_id: byBatch,
    b01_release_nodes_count: b01RelNodesRes.rows[0]?.cnt ?? 0,
    b01_knowledge_work_th_rd_nodes_count: b01WorkNodesRes.rows[0]?.cnt ?? 0,
    legacy_seed_tax_ruling_nodes_count: seedTaxRulingsRes.rows[0]?.cnt ?? 0,
    lrm_chunk_nodes_count: lrmChunksRes.rows[0]?.cnt ?? 0,
    orphan_nodes_count: orphanRes.rows[0]?.cnt ?? 0,
  };
}

export function classifyAuditFailure(params: {
  targetValidation: ValidatedAuditTarget;
  backupVerification?: BackupVerificationReceipt | null;
  dnsResolvedAny: boolean;
  dnsErrors: string[];
  tcpBolt: { reachable: boolean; error: string | null } | null;
  boltError: unknown;
}): DynamicFailureReport {
  if (!params.targetValidation.valid) {
    const joined = params.targetValidation.validation_errors.join(" | ");
    return {
      verification_status: "TARGET_VALIDATION_FAILED",
      failure_stage: "target_validation",
      observed_error_code: "TARGET_VALIDATION_FAILED",
      observed_sanitized_message: sanitizeGraphError(joined),
      diagnostic_summary: `Audit aborted before network connection because target validation failed: ${sanitizeGraphError(joined)}`,
    };
  }

  if (params.backupVerification && !params.backupVerification.verified) {
    const msg = params.backupVerification.error || "Backup verification failed.";
    return {
      verification_status: "BACKUP_FILE_VERIFICATION_FAILED",
      failure_stage: "backup_checksum_verification",
      observed_error_code: "BACKUP_FILE_VERIFICATION_FAILED",
      observed_sanitized_message: sanitizeGraphError(msg),
      diagnostic_summary: `Audit aborted because backup file verification failed: ${sanitizeGraphError(msg)}`,
    };
  }

  const rawBoltMsg =
    params.boltError instanceof Error
      ? params.boltError.message
      : params.boltError
        ? String(params.boltError)
        : "";
  const boltCode =
    params.boltError &&
    typeof params.boltError === "object" &&
    "code" in params.boltError &&
    typeof (params.boltError as { code?: unknown }).code === "string"
      ? ((params.boltError as { code: string }).code)
      : null;
  const sanitizedBolt = sanitizeGraphError(rawBoltMsg);

  if (
    boltCode === "DATABASE_IDENTITY_MISMATCH" ||
    rawBoltMsg.includes("DATABASE_IDENTITY_MISMATCH")
  ) {
    return {
      verification_status: "DATABASE_IDENTITY_MISMATCH",
      failure_stage: "database_identity_check",
      observed_error_code: boltCode || "DATABASE_IDENTITY_MISMATCH",
      observed_sanitized_message: sanitizedBolt,
      diagnostic_summary: `Connected over Bolt, but server database identity check failed: ${sanitizedBolt}`,
    };
  }

  if (!params.dnsResolvedAny && params.dnsErrors.length > 0) {
    const dnsSummary = params.dnsErrors.join("; ");
    return {
      verification_status: "DNS_RESOLUTION_FAILED",
      failure_stage: "dns_resolution",
      observed_error_code: dnsSummary.includes("ENOTFOUND") ? "ENOTFOUND" : "DNS_ERROR",
      observed_sanitized_message: sanitizeGraphError(dnsSummary),
      diagnostic_summary: `DNS lookup for '${params.targetValidation.host}' failed (${sanitizeGraphError(dnsSummary)}). Live graph contents could not be queried from this host.`,
    };
  }

  if (params.tcpBolt && !params.tcpBolt.reachable) {
    const tcpErr = sanitizeGraphError(params.tcpBolt.error || "TCP connection failed");
    return {
      verification_status: "TCP_CONNECT_FAILED",
      failure_stage: "tcp_reachability",
      observed_error_code: tcpErr,
      observed_sanitized_message: tcpErr,
      diagnostic_summary: `DNS resolved '${params.targetValidation.host}', but TCP connection to port ${params.targetValidation.port} failed with '${tcpErr}'.${sanitizedBolt ? ` Bolt error: ${sanitizedBolt}` : ""}`,
    };
  }

  if (
    /Unauthorized|authentication\s+failure|Neo\.ClientError\.Security\.Unauthorized|credentials/i.test(
       `${boltCode || ""} ${rawBoltMsg}`
    )
  ) {
    return {
      verification_status: "BOLT_AUTHENTICATION_FAILED",
      failure_stage: "bolt_handshake_or_auth",
      observed_error_code: boltCode || "Neo.ClientError.Security.Unauthorized",
      observed_sanitized_message: sanitizedBolt,
      diagnostic_summary: `TCP port ${params.targetValidation.port} accepted connection, but Neo4j rejected credentials: ${sanitizedBolt}`,
    };
  }

  if (/TLS|SSL|certificate|CERT_|ERR_TLS/i.test(`${boltCode || ""} ${rawBoltMsg}`)) {
    return {
      verification_status: "BOLT_TLS_ERROR",
      failure_stage: "bolt_handshake_or_auth",
      observed_error_code: boltCode || "TLS_HANDSHAKE_ERROR",
      observed_sanitized_message: sanitizedBolt,
      diagnostic_summary: `TLS/certificate negotiation with '${params.targetValidation.host}:${params.targetValidation.port}' failed: ${sanitizedBolt}`,
    };
  }

  if (
    /ServiceUnavailable|SessionExpired|Could not perform discovery|routing/i.test(
      `${boltCode || ""} ${rawBoltMsg}`
    )
  ) {
    return {
      verification_status: "BOLT_ROUTING_OR_PROTOCOL_FAILED",
      failure_stage: "bolt_handshake_or_auth",
      observed_error_code: boltCode || "ServiceUnavailable",
      observed_sanitized_message: sanitizedBolt,
      diagnostic_summary: `Bolt routing/protocol handshake with '${params.targetValidation.host}:${params.targetValidation.port}' failed: ${sanitizedBolt}`,
    };
  }

  return {
    verification_status: "CYPHER_READ_QUERY_FAILED",
    failure_stage: "cypher_read_query",
    observed_error_code: boltCode || "CYPHER_READ_ERROR",
    observed_sanitized_message: sanitizedBolt || "Unknown Bolt/Cypher read failure",
    diagnostic_summary: `Read-only Cypher audit failed with error: ${sanitizedBolt || "Unknown Bolt/Cypher read failure"}`,
  };
}

function loadDotEnvLocalReadOnly(): Record<string, string> {
  const out: Record<string, string> = {};
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return out;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

async function probeTcpPort(
  host: string,
  port: number,
  timeoutMs = 4000
): Promise<{ reachable: boolean; error: string | null }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ reachable, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, null));
    socket.once("timeout", () => finish(false, `TCP_TIMEOUT_${timeoutMs}MS`));
    socket.once("error", (err) => finish(false, err.message));
    socket.connect(port, host);
  });
}

function getCliArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  return undefined;
}

export async function runCliAudit(argv = process.argv.slice(2)): Promise<Record<string, unknown>> {
  const fileEnv = loadDotEnvLocalReadOnly();
  const modeArg = (getCliArg(argv, "--target-mode") || "live-374f4f7e").trim() as AuditTargetMode;
  const targetMode: AuditTargetMode =
    modeArg === "isolated-restore" ? "isolated-restore" : "live-374f4f7e";

  const uri =
    targetMode === "isolated-restore"
      ? (getCliArg(argv, "--bolt-uri") || "").trim()
      : (getCliArg(argv, "--bolt-uri") || process.env.NEO4J_URI || fileEnv.NEO4J_URI || "").trim();
  const username = (
    getCliArg(argv, "--username") ||
    process.env.NEO4J_USERNAME ||
    fileEnv.NEO4J_USERNAME ||
    ""
  ).trim();
  const password = (
    getCliArg(argv, "--password") ||
    process.env.NEO4J_PASSWORD ||
    fileEnv.NEO4J_PASSWORD ||
    ""
  ).trim();
  const database = (
    getCliArg(argv, "--database") ||
    process.env.NEO4J_DATABASE ||
    fileEnv.NEO4J_DATABASE ||
    ""
  ).trim();

  const backupFileArg = getCliArg(argv, "--backup-file");
  const expectedShaArg = getCliArg(argv, "--expected-sha256");
  const expectedInstanceArg = getCliArg(argv, "--expected-instance-id");

  const hasAuraCloudApiCreds = Boolean(
    process.env.AURA_CLI_CLIENT_ID ||
      process.env.NEO4J_AURA_CLIENT_ID ||
      fileEnv.AURA_CLI_CLIENT_ID ||
      fileEnv.NEO4J_AURA_CLIENT_ID
  );

  const targetValidation = validateAuditTarget({
    targetMode,
    uri,
    username,
    password,
    database,
    expectedInstanceId: expectedInstanceArg,
  });

  const backupVerification = backupFileArg
    ? verifyBackupFileChecksum(backupFileArg, expectedShaArg)
    : null;

  const dnsResults: Record<string, { resolved: boolean; records: unknown; error: string | null }> = {};
  const dnsErrors: string[] = [];
  let dnsResolvedAny = false;
  let tcpBolt: { reachable: boolean; error: string | null } | null = null;
  let tcp443: { reachable: boolean; error: string | null } | null = null;
  let boltConnected = false;
  let boltCaughtError: unknown = null;
  let liveGraphAudit: LiveReadOnlyGraphAudit | null = null;

  if (
    targetValidation.valid &&
    targetValidation.host &&
    (!backupVerification || backupVerification.verified)
  ) {
    const host = targetValidation.host;
    if (net.isIP(host.replace(/^\[|\]$/g, "")) !== 0 || host === "localhost") {
      dnsResolvedAny = true;
      dnsResults.LOOPBACK = { resolved: true, records: [host], error: null };
    } else {
      for (const rrtype of ["A", "AAAA"] as const) {
        try {
          const recs = rrtype === "A" ? await dns.resolve4(host) : await dns.resolve6(host);
          dnsResults[rrtype] = { resolved: true, records: recs, error: null };
          if (recs.length > 0) dnsResolvedAny = true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          dnsResults[rrtype] = { resolved: false, records: [], error: msg };
          dnsErrors.push(`${rrtype}: ${msg}`);
        }
      }
      try {
        const srv = await dns.resolveSrv(`_neo4j._tcp.${host}`);
        dnsResults.SRV = { resolved: true, records: srv, error: null };
        if (srv.length > 0) dnsResolvedAny = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        dnsResults.SRV = { resolved: false, records: [], error: msg };
        dnsErrors.push(`SRV: ${msg}`);
      }
    }

    if (dnsResolvedAny) {
      const cleanHost = host.replace(/^\[|\]$/g, "");
      tcpBolt = await probeTcpPort(cleanHost, targetValidation.port);
      if (targetMode === "live-374f4f7e") {
        tcp443 = await probeTcpPort(cleanHost, 443);
      }
    }

    if (dnsResolvedAny && tcpBolt?.reachable) {
      const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
        connectionTimeout: 6000,
        maxTransactionRetryTime: 0,
      });
      try {
        liveGraphAudit = await runReadOnlyGraphAuditWithDriver(driver, database, targetMode);
        boltConnected = true;
      } catch (err: unknown) {
        boltConnected = false;
        boltCaughtError = err;
      } finally {
        await driver.close();
      }
    }
  }

  const failureReport = liveGraphAudit
    ? null
    : classifyAuditFailure({
        targetValidation,
        backupVerification,
        dnsResolvedAny,
        dnsErrors,
        tcpBolt,
        boltError: boltCaughtError,
      });

  const report: Record<string, unknown> = {
    verified_at: new Date().toISOString(),
    mode: "STRICT_READ_ONLY_NO_MUTATION",
    target_validation: {
      valid: targetValidation.valid,
      target_mode: targetValidation.target_mode,
      expected_aura_instance_id:
        targetMode === "live-374f4f7e" ? EXPECTED_AURA_INSTANCE_ID : null,
      observed_aura_instance_id: targetValidation.aura_instance_id,
      bolt_uri_redacted:
        targetValidation.scheme && targetValidation.host
          ? `${targetValidation.scheme}://${targetValidation.host}:${targetValidation.port}`
          : null,
      expected_database_name: targetValidation.expected_database,
      username_configured: targetValidation.username_configured,
      password_configured: targetValidation.password_configured,
      aura_cloud_management_api_credentials_present: hasAuraCloudApiCreds,
      validation_errors: targetValidation.validation_errors,
    },
    backup_verification: backupVerification,
    connectivity_probes: {
      dns: dnsResults,
      tcp_bolt_port: tcpBolt,
      tcp_443_https: tcp443,
      bolt_read_session_connected: boltConnected,
      bolt_sanitized_error: boltCaughtError ? sanitizeGraphError(boltCaughtError) : null,
    },
    live_database_content_verification: liveGraphAudit ?? failureReport,
  };

  const outPathArg = getCliArg(argv, "--out");
  if (outPathArg) {
    const outPath = path.resolve(outPathArg);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const json = JSON.stringify(report, null, 2);
    const receiptWithHash = {
      ...report,
      report_sha256: crypto.createHash("sha256").update(json).digest("hex"),
    };
    fs.writeFileSync(outPath, JSON.stringify(receiptWithHash, null, 2), "utf8");
    console.log(`Saved read-only Neo4j verification receipt -> ${outPath}`);
    return receiptWithHash;
  }

  console.log(JSON.stringify(report, null, 2));
  return report;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  runCliAudit().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
