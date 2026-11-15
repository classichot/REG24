import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { NextRequest } from "next/server";
import neo4j, { type Driver } from "neo4j-driver";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertStrictlyReadOnlyCypher,
  classifyAuditFailure,
  runReadOnlyGraphAuditWithDriver,
  validateAuditTarget,
  verifyBackupFileChecksum,
} from "../../scripts/verify-neo4j-374f4f7e-readonly";
import {
  isNeo4jPreservationWriteLockActive,
  neo4jConnectionManager,
} from "../../src/core/graph/neo4j-client";
import { POST as postGraphHealth } from "../../src/app/api/v1/infrastructure/graph/health/route";
import { POST as postGraphAudit } from "../../src/app/api/v1/infrastructure/graph/audit/route";
import { POST as postResourceMaster } from "../../src/app/api/v1/legal/resource-master/route";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { recordUatDecision, startBatchRun } from "../../src/core/knowledge/releases";
import { evaluateRelease } from "../../src/core/knowledge/evaluation";
import { freezeInventory } from "../../src/core/knowledge/inventory";
import { validateReleaseReport, type Actor } from "../../src/core/knowledge/contracts";

const ENG_ACTOR: Actor = {
  actor_id: "eng.lead@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const OWNER_ACTOR: Actor = {
  actor_id: "rattaroj@reg24.th",
  role: "product_owner",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Instruction 1 & 3 — Neo4j 374f4f7e Read-Only Verifier, Writer Lockout & 20/20 UAT Gate", () => {
  const originalLockEnv = process.env.NEO4J_PRESERVATION_READ_ONLY;

  afterEach(() => {
    if (originalLockEnv === undefined) {
      delete process.env.NEO4J_PRESERVATION_READ_ONLY;
    } else {
      process.env.NEO4J_PRESERVATION_READ_ONLY = originalLockEnv;
    }
  });

  it("strictly validates live-374f4f7e target and refuses missing URIs, wrong Aura instance IDs, or wrong DB names", () => {
    const emptyUri = validateAuditTarget({
      targetMode: "live-374f4f7e",
      uri: "",
      username: "374f4f7e",
      password: "secret",
      database: "374f4f7e",
    });
    expect(emptyUri.valid).toBe(false);
    expect(emptyUri.host).toBeNull();
    expect(emptyUri.validation_errors.join(" ")).toMatch(/refuses to substitute a default hostname/i);

    const wrongInstance = validateAuditTarget({
      targetMode: "live-374f4f7e",
      uri: "neo4j+s://deadbeef.databases.neo4j.io",
      username: "deadbeef",
      password: "secret",
      database: "374f4f7e",
    });
    expect(wrongInstance.valid).toBe(false);
    expect(wrongInstance.validation_errors.join(" ")).toMatch(/does NOT match authorized Aura instance '374f4f7e'/);

    const wrongDatabase = validateAuditTarget({
      targetMode: "live-374f4f7e",
      uri: "neo4j+s://374f4f7e.databases.neo4j.io",
      username: "374f4f7e",
      password: "secret",
      database: "neo4j",
    });
    expect(wrongDatabase.valid).toBe(false);
    expect(wrongDatabase.validation_errors.join(" ")).toMatch(/Configured database 'neo4j' does NOT match/);

    const validLive = validateAuditTarget({
      targetMode: "live-374f4f7e",
      uri: "neo4j+s://374f4f7e.databases.neo4j.io",
      username: "374f4f7e",
      password: "secret",
      database: "374f4f7e",
    });
    expect(validLive.valid).toBe(true);
    expect(validLive.aura_instance_id).toBe("374f4f7e");
    expect(validLive.expected_database).toBe("374f4f7e");
  });

  it("strictly enforces loopback-only host in isolated-restore mode and verifies backup SHA-256 checksums", () => {
    const rejectsLiveAuraInRestoreMode = validateAuditTarget({
      targetMode: "isolated-restore",
      uri: "neo4j+s://374f4f7e.databases.neo4j.io",
      username: "neo4j",
      password: "secret",
      database: "374f4f7e",
    });
    expect(rejectsLiveAuraInRestoreMode.valid).toBe(false);
    expect(rejectsLiveAuraInRestoreMode.validation_errors.join(" ")).toMatch(/Refusing live Aura host/);

    const acceptsLocalRestore = validateAuditTarget({
      targetMode: "isolated-restore",
      uri: "bolt://127.0.0.1:7687",
      username: "neo4j",
      password: "local_restore_password",
      database: "374f4f7e",
    });
    expect(acceptsLocalRestore.valid).toBe(true);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-backup-chk-"));
    try {
      const backupFile = path.join(tmpDir, "374f4f7e-2026-11-15.backup");
      const payload = Buffer.from("NEO4J-BACKUP-HEADER-374f4f7e-IMMUTABLE-SNAPSHOT", "utf8");
      fs.writeFileSync(backupFile, payload);
      const expectedSha = crypto.createHash("sha256").update(payload).digest("hex");

      const okReceipt = verifyBackupFileChecksum(backupFile, expectedSha);
      expect(okReceipt.verified).toBe(true);
      expect(okReceipt.format).toBe("neo4j_backup");
      expect(okReceipt.checksum_matches).toBe(true);
      expect(okReceipt.actual_sha256).toBe(expectedSha);

      const badReceipt = verifyBackupFileChecksum(backupFile, "0".repeat(64));
      expect(badReceipt.verified).toBe(false);
      expect(badReceipt.checksum_matches).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports dynamic actual failure stages rather than any hardcoded DNS-paused message", () => {
    const validTarget = validateAuditTarget({
      targetMode: "live-374f4f7e",
      uri: "neo4j+s://374f4f7e.databases.neo4j.io",
      username: "374f4f7e",
      password: "secret",
      database: "374f4f7e",
    });

    const authErr = Object.assign(
      new Error("The client is unauthorized due to authentication failure."),
      { code: "Neo.ClientError.Security.Unauthorized" }
    );
    const authReport = classifyAuditFailure({
      targetValidation: validTarget,
      dnsResolvedAny: true,
      dnsErrors: [],
      tcpBolt: { reachable: true, error: null },
      boltError: authErr,
    });
    expect(authReport.verification_status).toBe("BOLT_AUTHENTICATION_FAILED");
    expect(authReport.failure_stage).toBe("bolt_handshake_or_auth");
    expect(authReport.diagnostic_summary).not.toMatch(/DNS ENOTFOUND/i);

    const tcpReport = classifyAuditFailure({
      targetValidation: validTarget,
      dnsResolvedAny: true,
      dnsErrors: [],
      tcpBolt: { reachable: false, error: "connect ECONNREFUSED 34.87.1.2:7687" },
      boltError: null,
    });
    expect(tcpReport.verification_status).toBe("TCP_CONNECT_FAILED");
    expect(tcpReport.observed_sanitized_message).toContain("ECONNREFUSED");

    const dbMismatchReport = classifyAuditFailure({
      targetValidation: validTarget,
      dnsResolvedAny: true,
      dnsErrors: [],
      tcpBolt: { reachable: true, error: null },
      boltError: Object.assign(
        new Error("DATABASE_IDENTITY_MISMATCH: Expected database '374f4f7e', server reported 'neo4j'."),
        { code: "DATABASE_IDENTITY_MISMATCH" }
      ),
    });
    expect(dbMismatchReport.verification_status).toBe("DATABASE_IDENTITY_MISMATCH");
  });

  it("blocks every mutating Cypher construct and executes strictly in READ mode against an isolated restored copy", async () => {
    expect(() => assertStrictlyReadOnlyCypher("CREATE (n:Test) RETURN n")).toThrow(/READ_ONLY_FIREWALL_BLOCKED/);
    expect(() => assertStrictlyReadOnlyCypher("MATCH (n) DETACH DELETE n")).toThrow(/READ_ONLY_FIREWALL_BLOCKED/);
    expect(() => assertStrictlyReadOnlyCypher("MATCH (n) SET n.x = 1 RETURN n")).toThrow(/READ_ONLY_FIREWALL_BLOCKED/);
    expect(() => assertStrictlyReadOnlyCypher("CALL apoc.refactor.mergeNodes([])")).toThrow(/READ_ONLY_FIREWALL_BLOCKED/);
    expect(() => assertStrictlyReadOnlyCypher("MATCH (n) RETURN count(n); DROP DATABASE neo4j")).toThrow(
      /READ_ONLY_FIREWALL_BLOCKED/
    );
    expect(() => assertStrictlyReadOnlyCypher("CALL db.info() YIELD name RETURN name")).not.toThrow();

    const observedAccessModes: string[] = [];
    const observedReadTxCalls: string[] = [];

    const makeRecord = (obj: Record<string, unknown>) => ({
      keys: Object.keys(obj),
      get: (k: string) => {
        const v = obj[k];
        return typeof v === "number" ? neo4j.int(v) : v;
      },
    });

    const createMockDriver = (reportedServerDb: string): Driver =>
      ({
        session: (opts?: { database?: string; defaultAccessMode?: string }) => {
          observedAccessModes.push(String(opts?.defaultAccessMode));
          return {
            executeRead: async (work: (tx: { run: (q: string) => Promise<unknown> }) => Promise<unknown>) => {
              return work({
                run: async (cypher: string) => {
                  observedReadTxCalls.push(cypher);
                  if (cypher.includes("CALL db.info()")) {
                    return {
                      records: [makeRecord({ name: reportedServerDb })],
                      summary: { database: { name: reportedServerDb } },
                    };
                  }
                  if (cypher.includes("CALL dbms.components()")) {
                    return {
                      records: [makeRecord({ name: "Neo4j Kernel", versions: ["5.26-aura"], edition: "enterprise" })],
                      summary: { database: { name: reportedServerDb } },
                    };
                  }
                  if (cypher === "MATCH (n) RETURN count(n) AS cnt") {
                    return { records: [makeRecord({ cnt: 9242 })], summary: {} };
                  }
                  if (cypher === "MATCH ()-[r]->() RETURN count(r) AS cnt") {
                    return { records: [makeRecord({ cnt: 9096 })], summary: {} };
                  }
                  if (cypher.includes("UNWIND labels(n)")) {
                    return {
                      records: [
                        makeRecord({ label: "Provision", cnt: 6913 }),
                        makeRecord({ label: "LegalInstrument", cnt: 2312 }),
                        makeRecord({ label: "TaxRuling", cnt: 10 }),
                      ],
                      summary: {},
                    };
                  }
                  if (cypher.includes("RETURN type(r) AS relType")) {
                    return {
                      records: [makeRecord({ relType: "CONTAINS", cnt: 9096 })],
                      summary: {},
                    };
                  }
                  if (cypher.includes("coalesce(n.migration_batch_id")) {
                    return {
                      records: [makeRecord({ batchId: "mig.lrm.chunks.v1", cnt: 9242 })],
                      summary: {},
                    };
                  }
                  return { records: [makeRecord({ cnt: 0 })], summary: {} };
                },
              });
            },
            executeWrite: async () => {
              throw new Error("WRITE_TRANSACTION_MUST_NEVER_BE_CALLED");
            },
            run: async () => {
              throw new Error("UNSCOPED_SESSION_RUN_MUST_NEVER_BE_CALLED");
            },
            close: async () => undefined,
          };
        },
      }) as unknown as Driver;

    // 1. Mismatched DB identity must be rejected immediately
    await expect(
      runReadOnlyGraphAuditWithDriver(createMockDriver("wrong_db"), "374f4f7e", "isolated-restore")
    ).rejects.toThrow(/DATABASE_IDENTITY_MISMATCH/);

    // 2. Matching isolated-restore DB succeeds strictly via READ sessions & executeRead
    const audit = await runReadOnlyGraphAuditWithDriver(
      createMockDriver("374f4f7e"),
      "374f4f7e",
      "isolated-restore"
    );
    expect(audit.verification_status).toBe("VERIFIED_ISOLATED_RESTORE_READ");
    expect(audit.verified_server_database_name).toBe("374f4f7e");
    expect(audit.total_nodes).toBe(9242);
    expect(audit.total_relationships).toBe(9096);
    expect(observedAccessModes.every((m) => m === neo4j.session.READ)).toBe(true);
    expect(observedReadTxCalls.length).toBeGreaterThanOrEqual(10);
  });

  it("blocks unauthenticated Neo4j write HTTP endpoints (403) and enforces NEO4J_PRESERVATION_READ_ONLY (423)", async () => {
    // 1. Unauthenticated POSTs without explicit x-reg24-role header must return 403 Forbidden
    const unauthHealthRes = await postGraphHealth(
      new NextRequest("http://localhost/api/v1/infrastructure/graph/health", {
        method: "POST",
        body: JSON.stringify({ action: "run_migration" }),
      })
    );
    expect(unauthHealthRes.status).toBe(403);

    const unauthAuditRes = await postGraphAudit(
      new NextRequest("http://localhost/api/v1/infrastructure/graph/audit", {
        method: "POST",
        body: JSON.stringify({ action: "sync_and_audit_neo4j" }),
      })
    );
    expect(unauthAuditRes.status).toBe(403);

    const unauthLrmRes = await postResourceMaster(
      new NextRequest("http://localhost/api/v1/legal/resource-master", {
        method: "POST",
        body: JSON.stringify({ action: "sync_chunks_to_neo4j" }),
      })
    );
    expect(unauthLrmRes.status).toBe(403);

    // 2. Even WITH explicit Platform Administrator header, NEO4J_PRESERVATION_READ_ONLY=true blocks all writers with 423
    process.env.NEO4J_PRESERVATION_READ_ONLY = "true";
    expect(isNeo4jPreservationWriteLockActive()).toBe(true);

    await expect(
      neo4jConnectionManager.executeCypher("MERGE (n:Regulator {canonical_id: $id})", { id: "x" }, { write: true })
    ).rejects.toThrow(/NEO4J_PRESERVATION_LOCKOUT_423/);

    const lockedHealthRes = await postGraphHealth(
      new NextRequest("http://localhost/api/v1/infrastructure/graph/health", {
        method: "POST",
        headers: { "x-reg24-role": "Platform Administrator" },
        body: JSON.stringify({ action: "run_migration" }),
      })
    );
    expect(lockedHealthRes.status).toBe(423);
  });

  it("enforces the unlowered 20/20 (100%) Owner UAT checklist gate and rejects 19/20 pass attempts", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-uat-20of20-"));
    try {
      const store = new DurableKnowledgeStore(tmpDir);
      const frozen = await freezeInventory("B01", ENG_ACTOR, { store });
      const run = await startBatchRun(
        {
          batch_id: "B01",
          manifest_id: frozen.manifest.manifest_id,
          idempotency_key: "uat-20-of-20-gate-test",
          max_documents: 30,
        },
        ENG_ACTOR,
        { store }
      );
      const ev = await evaluateRelease(run.release_id, "suite.B01.300families.v1.1", ENG_ACTOR, { store });
      expect(ev.uat_cases.length).toBe(20);

      const rel = store.getState().releases[run.release_id];

      // Attempt 19/20 pass (1 failed case) -> MUST be rejected per 02_OWNER_UAT_CHECKLIST.md!
      const nineteenPassOneFail = ev.uat_cases.map((c, idx) => ({
        case_id: c.case_id,
        decision: (idx === 19 ? "FAIL" : "PASS") as "PASS" | "FAIL",
        comment: idx === 19 ? "Failed mandatory check" : "OK",
      }));

      await expect(
        recordUatDecision(
          {
            release_id: run.release_id,
            manifest_hash: rel.manifest_hash,
            expected_revision: rel.revision,
            decision: "UAT_PASS",
            comments: "Attempted 19/20 lowered threshold",
            case_decisions: nineteenPassOneFail,
          },
          OWNER_ACTOR,
          { store }
        )
      ).rejects.toThrow(/MANDATORY_UAT_CASE_FAILURE_422/);

      // Attempt 19/20 incomplete submission -> MUST also be rejected!
      await expect(
        recordUatDecision(
          {
            release_id: run.release_id,
            manifest_hash: rel.manifest_hash,
            expected_revision: rel.revision,
            decision: "UAT_PASS",
            comments: "Submitted only 19 of 20 mandatory cases",
            case_decisions: ev.uat_cases.slice(0, 19).map((c) => ({
              case_id: c.case_id,
              decision: "PASS" as const,
              comment: "OK",
            })),
          },
          OWNER_ACTOR,
          { store }
        )
      ).rejects.toThrow(/INCOMPLETE_MANDATORY_UAT_PASS_422/);

      // Report validator also blocks any 19/20 report from RELEASE_APPROVED / ACCEPTED
      const tamperedReport = structuredClone(ev.release_report);
      tamperedReport.uat.owner_decision = "UAT_PASS";
      tamperedReport.uat.approved_manifest_hash = tamperedReport.manifest_hash;
      tamperedReport.uat.passed = 19;
      tamperedReport.uat.failed = 1;
      const val = validateReleaseReport(tamperedReport, "RELEASE_APPROVED");
      expect(val.valid).toBe(false);
      expect(val.errors.join(" ")).toMatch(/MANDATORY_UAT_CASE_FAILURE/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
