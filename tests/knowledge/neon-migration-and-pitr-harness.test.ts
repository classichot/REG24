import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertProjectIsIsolatedReg24,
  runIsolatedReg24NeonSetupAndDrill,
  splitPostgresSqlStatements,
} from "../../scripts/setup-and-verify-isolated-reg24-neon";
import { NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD } from "../../scripts/verify-neon-hosted-backup-restore";
import { POST as postQueryRoute } from "../../src/app/api/v1/knowledge/query/route";
import { sha256Bytes } from "../../src/core/knowledge/identity";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import {
  resetTrialRateLimiterForTesting,
  setCustomTrialAuditSink,
  setCustomTrialDbTransportForTesting,
} from "../../src/core/knowledge/trial-gate";

describe("Batch 1 Trial Hardening: Fail-Closed Invite Gate, Durable Audit Failure Reporting, Distributed Rate Limits & PITR", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const trackedKeys = [
    "REG24_TRIAL_INVITE_ONLY",
    "REG24_TRIAL_INVITE_CODES",
    "REG24_TRIAL_ALLOWED_INVITE_SHA256",
    "REG24_TRIAL_QUERY_LIMIT_15M",
    "REG24_TRIAL_RATE_LIMIT",
    "REG24_TRIAL_DB_AUDIT",
    "REG24_TRIAL_AUDIT_LOG",
    "REG24_TRIAL_REQUIRE_DURABLE_AUDIT",
    "REG24_USE_B01_RC2_PREVIEW_STORE",
    "DATABASE_URL",
    "VERCEL",
  ];
  for (const k of trackedKeys) savedEnv[k] = process.env[k];

  afterEach(() => {
    for (const k of trackedKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetTrialRateLimiterForTesting();
    setCustomTrialDbTransportForTesting(null);
    setCustomTrialAuditSink(null);
    setDefaultKnowledgeStoreForTesting(null);
  });

  it("1. Parses 0003 and 0004 SQL migrations without splitting inside PL/pgSQL $$ ... $$ function bodies", () => {
    const mig3 = fs.readFileSync(
      path.resolve(process.cwd(), "prisma/migrations/0003_trial_access_and_audit.sql"),
      "utf8"
    );
    const mig4 = fs.readFileSync(
      path.resolve(process.cwd(), "prisma/migrations/0004_neon_storage_budget_ceiling.sql"),
      "utf8"
    );

    const s3 = splitPostgresSqlStatements(mig3);
    const s4 = splitPostgresSqlStatements(mig4);

    // 0003: 3 CREATE TABLE (invites, audit, rate_limit_buckets) + 3 CREATE INDEX = 6 statements
    expect(s3.length).toBe(6);
    expect(s3[0]).toMatch(/CREATE TABLE IF NOT EXISTS trial_invite_credentials/);
    expect(s3[1]).toMatch(/CREATE TABLE IF NOT EXISTS trial_audit_events/);
    expect(s3[5]).toMatch(/CREATE TABLE IF NOT EXISTS trial_rate_limit_buckets/);

    // 0004: 1 CREATE OR REPLACE FUNCTION (intact $$...$$) + 3*(DROP TRIGGER + CREATE TRIGGER) = 7 statements
    expect(s4.length).toBe(7);
    expect(s4[0]).toContain("CREATE OR REPLACE FUNCTION reg24_enforce_trial_storage_ceiling()");
    expect(s4[0]).toContain("DECLARE");
    expect(s4[0]).toContain("RAISE EXCEPTION 'REG24_STORAGE_CAP_EXCEEDED");
    expect(s4[0]).toMatch(/END;\s*\$\$/);
  });

  it("2. Blocks touching shared/sibling 7L Advisory projects and executes full quota + migration + parent_lsn PITR recovery + cleanup flow", async () => {
    expect(() =>
      assertProjectIsIsolatedReg24({ id: "morning-fog-53375324", name: "cc24-db" })
    ).toThrow(/SHARED_OR_SIBLING_PROJECT_BLOCKED_403/);
    expect(() =>
      assertProjectIsIsolatedReg24({ id: "proj_other", name: "trade24-agi" })
    ).toThrow(/SHARED_OR_SIBLING_PROJECT_BLOCKED_403/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-neon-pitr-test-"));
    try {
      const primaryHost = "ep-reg24-primary-pooler.ap-southeast-1.aws.neon.tech";
      const childPitrHost = "ep-reg24-pitr-ro.ap-southeast-1.aws.neon.tech";
      const primaryUrl = `postgresql://neondb_owner:secret@${primaryHost}/neondb?sslmode=require`;

      const primaryAuditRows = new Map<string, Record<string, unknown>>();
      const primaryInviteRows = new Map<string, Record<string, unknown>>();
      const restoreSchemaAuditRows = new Map<string, Record<string, unknown>>();
      let pitrSnapshotAuditRows = new Map<string, Record<string, unknown>>();
      let pitrSnapshotInviteRows = new Map<string, Record<string, unknown>>();
      let childBranchDeleted = false;
      let capturedParentLsn: string | null = null;
      const executedStatements: string[] = [];

      const receipt = await runIsolatedReg24NeonSetupAndDrill({
        neonApiKey: "napi_test_isolated_key",
        neonOrgId: "org-reg24-isolated",
        backupDirOverride: path.join(tmpDir, "backups"),
        receiptPathOverride: path.join(tmpDir, "receipt.json"),
        neonApiCaller: async <T>(_key: string, method: string, apiPath: string, body?: unknown): Promise<T> => {
          if (method === "POST" && apiPath === "/projects") {
            return {
              project: {
                id: "proj-reg24-isolated-01",
                name: "reg24-trial-isolated",
                org_id: "org-reg24-isolated",
                region_id: "aws-ap-southeast-1",
                history_retention_seconds: 604800,
                settings: {
                  quota: { ...NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD.project.settings.quota },
                },
              },
              connection_uris: [{ connection_uri: primaryUrl }],
            } as unknown as T;
          }
          if (method === "GET" && apiPath === "/projects/proj-reg24-isolated-01") {
            return {
              project: {
                id: "proj-reg24-isolated-01",
                name: "reg24-trial-isolated",
                org_id: "org-reg24-isolated",
                history_retention_seconds: 604800,
                settings: {
                  quota: { ...NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD.project.settings.quota },
                },
              },
            } as unknown as T;
          }
          if (method === "GET" && apiPath === "/projects/proj-reg24-isolated-01/branches") {
            return {
              branches: [{ id: "br-primary-01", name: "main", primary: true }],
            } as unknown as T;
          }
          if (method === "POST" && apiPath === "/projects/proj-reg24-isolated-01/branches") {
            const req = body as { branch: { parent_lsn: string } };
            capturedParentLsn = req.branch.parent_lsn;
            return {
              branch: {
                id: "br-pitr-child-01",
                parent_id: "br-primary-01",
                parent_lsn: req.branch.parent_lsn,
              },
              endpoints: [{ host: childPitrHost }],
            } as unknown as T;
          }
          if (
            method === "DELETE" &&
            apiPath === "/projects/proj-reg24-isolated-01/branches/br-pitr-child-01"
          ) {
            childBranchDeleted = true;
            return {} as unknown as T;
          }
          throw new Error(`Unexpected Neon API call: ${method} ${apiPath}`);
        },
        sqlExecutor: async <T>(dbUrl: string, query: string, params: unknown[] = []) => {
          executedStatements.push(query);
          const isChildPitr = dbUrl.includes(childPitrHost);

          if (query.includes("FROM pg_trigger")) {
            return {
              rows: [
                { tgname: "trg_trial_audit_storage_cap", tgenabled: "O" },
                { tgname: "trg_trial_invite_storage_cap", tgenabled: "O" },
                { tgname: "trg_trial_ratelimit_storage_cap", tgenabled: "O" },
              ] as unknown as T[],
              rowCount: 3,
            };
          }

          if (query.includes("INSERT INTO trial_invite_credentials")) {
            const [invite_id, token_sha256, assigned_email] = params as string[];
            primaryInviteRows.set(invite_id, { invite_id, token_sha256, assigned_email });
            return { rows: [], rowCount: 1 };
          }

          if (query.includes("INSERT INTO trial_audit_events")) {
            const [audit_id, invite_fingerprint, manifest_hash, trace_id, question_sha256] =
              params as string[];
            primaryAuditRows.set(audit_id, {
              audit_id,
              event_type: "TRIAL_QUERY",
              environment_scope: "trial",
              actor_id: "drill.operator@reg24.internal",
              actor_role: "legal_reviewer",
              invite_fingerprint,
              release_id: "rel.B01.rc5",
              manifest_hash,
              trace_id,
              question_sha256,
              question_text: "HOSTED_PITR_CANARY_CHECK",
              mode: "exact_lookup",
              answer_status: "ANSWERED",
              cited_passage_ids_json: '["psg.canary.1"]',
              cited_work_ids_json: '["work.canary.1"]',
              coverage_warnings_count: 0,
              http_status: 200,
              latency_ms: 42,
            });
            return { rows: [], rowCount: 1 };
          }

          if (query.includes("pg_current_wal_lsn()")) {
            pitrSnapshotAuditRows = new Map(primaryAuditRows);
            pitrSnapshotInviteRows = new Map(primaryInviteRows);
            return {
              rows: [{ lsn: "0/1A2B3C40", ts: "2026-11-18T00:40:00Z" }] as unknown as T[],
              rowCount: 1,
            };
          }

          if (query.startsWith("DELETE FROM trial_audit_events")) {
            primaryAuditRows.delete(String(params[0]));
            return { rows: [], rowCount: 1 };
          }

          if (query.startsWith("DELETE FROM trial_invite_credentials")) {
            primaryInviteRows.delete(String(params[0]));
            return { rows: [], rowCount: 1 };
          }

          if (query.includes("SELECT count(*)::int AS cnt FROM trial_audit_events")) {
            const has = primaryAuditRows.has(String(params[0]));
            return { rows: [{ cnt: has ? 1 : 0 }] as unknown as T[], rowCount: 1 };
          }

          if (query.includes("INSERT INTO reg24_restore_drill.trial_audit_events")) {
            restoreSchemaAuditRows.set(String(params[0]), {
              audit_id: String(params[0]),
              question_sha256: String(params[9]),
            });
            return { rows: [], rowCount: 1 };
          }

          if (query.includes("FROM reg24_restore_drill.trial_audit_events")) {
            const row = restoreSchemaAuditRows.get(String(params[0]));
            return { rows: (row ? [row] : []) as unknown as T[], rowCount: row ? 1 : 0 };
          }

          if (query.includes("FROM trial_audit_events WHERE audit_id = $1")) {
            const store = isChildPitr ? pitrSnapshotAuditRows : primaryAuditRows;
            const row = store.get(String(params[0]));
            return { rows: (row ? [row] : []) as unknown as T[], rowCount: row ? 1 : 0 };
          }

          if (query.includes("FROM trial_invite_credentials WHERE invite_id = $1")) {
            const store = isChildPitr ? pitrSnapshotInviteRows : primaryInviteRows;
            const row = store.get(String(params[0]));
            return { rows: (row ? [row] : []) as unknown as T[], rowCount: row ? 1 : 0 };
          }

          return { rows: [], rowCount: 0 };
        },
      });

      expect(receipt.hosted_restore_test_status).toBe(
        "COMPLETED_VERIFIED_HOSTED_BACKUP_AND_PITR"
      );
      expect(receipt.sql_statements_applied_count).toBe(13);
      expect(receipt.quotas_verified_exact).toBe(true);
      expect(receipt.postgresql_2gib_triggers_verified_active).toBe(true);
      expect(capturedParentLsn).toBe("0/1A2B3C40");
      expect(receipt.pitr_deleted_rows_recovered_at_lsn_verified).toBe(true);
      expect(childBranchDeleted).toBe(true);
      expect(receipt.pitr_child_branch_deleted_single_branch_preserved).toBe(true);
      expect(executedStatements.some((q) => q.includes("DROP SCHEMA IF EXISTS reg24_restore_drill"))).toBe(
        true
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("3. Rejects access fail-closed when zero approved invites are configured, enforces distributed rate limits across cold-start instances, and reports/blocks audit save failures", async () => {
    const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
    const store = new DurableKnowledgeStore(previewDir);
    setDefaultKnowledgeStoreForTesting(store);

    // 3a. FAIL-CLOSED WHEN ZERO APPROVED INVITES ARE CONFIGURED (even when caller passes a non-empty token!)
    process.env.REG24_TRIAL_INVITE_ONLY = "1";
    delete process.env.REG24_TRIAL_INVITE_CODES;
    delete process.env.REG24_TRIAL_ALLOWED_INVITE_SHA256;
    delete process.env.DATABASE_URL;

    const zeroConfigRes = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-trial-invite": "arbitrary-non-empty-secret",
        },
        body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636" }),
      })
    );
    expect(zeroConfigRes.status).toBe(403);
    const zeroConfigJson = await zeroConfigRes.json();
    expect(zeroConfigJson.error).toMatch(/TRIAL_NO_APPROVED_INVITES_CONFIGURED_403/);

    // 3b. DISTRIBUTED CROSS-INSTANCE RATE LIMITING ACROSS STATELESS SERVERLESS INSTANCES (VERCEL=1)
    //     Wiping local slidingWindowBuckets BEFORE EVERY SINGLE REQUEST proves zero reliance on per-lambda memory!
    process.env.VERCEL = "1";
    process.env.REG24_TRIAL_QUERY_LIMIT_15M = "2";
    const validToken = "invite-live-trial-01";
    const validTokenHash = sha256Bytes(validToken);

    const sharedDbRateBuckets = new Map<string, number>();
    const sharedDbAuditRows: Array<Record<string, unknown>> = [];
    let simulateAuditDbFailure = false;

    setCustomTrialDbTransportForTesting(async <T>(query: string, params: unknown[] = []) => {
      if (query.includes("FROM trial_invite_credentials") && query.includes("token_sha256 = $1")) {
        if (params[0] === validTokenHash) {
          return {
            rows: [{ invite_id: "inv.01", query_limit_15m: 2, evidence_limit_15m: 120 }] as unknown as T[],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("INSERT INTO trial_rate_limit_buckets")) {
        const bKey = `${params[0]}:${params[1]}:${params[2]}`;
        const nextCnt = (sharedDbRateBuckets.get(bKey) || 0) + 1;
        sharedDbRateBuckets.set(bKey, nextCnt);
        return { rows: [{ request_count: nextCnt }] as unknown as T[], rowCount: 1 };
      }
      if (query.includes("INSERT INTO trial_audit_events")) {
        if (simulateAuditDbFailure) {
          throw new Error("NEON_SQL_HTTP_500:disk_or_connection_failure");
        }
        sharedDbAuditRows.push({ audit_id: params[0] });
        return { rows: [{ audit_id: params[0] }] as unknown as T[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // Instance 1 (cold start) -> 200 OK
    resetTrialRateLimiterForTesting();
    const inst1 = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-trial-invite": validToken,
        },
        body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636", mode: "exact_lookup" }),
      })
    );
    expect(inst1.status).toBe(200);
    expect(inst1.headers.get("x-reg24-ratelimit-backend")).toBe("hosted_postgres_distributed");
    expect(inst1.headers.get("x-reg24-ratelimit-remaining")).toBe("1");
    expect(inst1.headers.get("x-reg24-audit-status")).toBe("hosted_postgres");

    // Instance 2 (cold start — local memory completely wiped!) -> 200 OK (remaining = 0)
    resetTrialRateLimiterForTesting();
    const inst2 = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-trial-invite": validToken,
        },
        body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999" }),
      })
    );
    expect(inst2.status).toBe(200);
    expect(inst2.headers.get("x-reg24-ratelimit-remaining")).toBe("0");

    // Instance 3 (cold start — local memory completely wiped!) -> 429 RATE_LIMITED + Retry-After header!
    resetTrialRateLimiterForTesting();
    const inst3 = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-trial-invite": validToken,
        },
        body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636" }),
      })
    );
    expect(inst3.status).toBe(429);
    expect(Number(inst3.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(sharedDbAuditRows.length).toBe(2);

    // 3c. AUDIT FAILURE IN PROTECTED TRIAL FAILS CLOSED (503) — NEVER SILENTLY DROPS AUDIT!
    sharedDbRateBuckets.clear();
    simulateAuditDbFailure = true;
    const auditFailStrict = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-trial-invite": validToken,
        },
        body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999" }),
      })
    );
    expect(auditFailStrict.status).toBe(503);
    const auditFailJson = await auditFailStrict.json();
    expect(auditFailJson.error).toMatch(/TRIAL_AUDIT_PERSISTENCE_FAILED_503/);

    // 3d. Even in non-strict preview (REG24_TRIAL_INVITE_ONLY=0, REG24_TRIAL_DB_AUDIT=1), audit failure is explicitly surfaced in headers & JSON!
    delete process.env.REG24_TRIAL_INVITE_ONLY;
    process.env.REG24_TRIAL_DB_AUDIT = "1";
    const previewExplicitWarn = await postQueryRoute(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999" }),
      })
    );
    expect(previewExplicitWarn.status).toBe(200);
    expect(previewExplicitWarn.headers.get("x-reg24-audit-status")).toBe("failed");
    expect(previewExplicitWarn.headers.get("x-reg24-audit-error")).toContain("NEON_SQL_HTTP_500");
    const previewWarnJson = await previewExplicitWarn.json();
    expect(previewWarnJson.audit_status.persisted_durable).toBe(false);
    expect(previewWarnJson.audit_status.backend).toBe("failed");
  });
});
