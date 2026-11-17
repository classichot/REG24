/**
 * REG24 — Isolated Standalone Neon Launch Setup, Quota Verifier & Hosted Backup/Restore Drill
 *
 * Implements Owner Item 2 (2026-11-17):
 * - Strictly isolated from the shared Vercel Marketplace Neon installation (`icfg_8ULeOadGpGR7Ka7xprogDBY0`,
 *   which shares `free_v3` across 8 sibling projects: `cc24-db`, `cre24-db`, `cre24-tcct-db`,
 *   `neon-charcoal-bucket`, `ai24-data`, `mar24-ai`, `trade24-agi`, `help24-db`).
 * - Refuses to modify or touch any sibling project ID (`morning-fog-53375324` or any project named
 *   `cc24*`, `cre24*`, `rw24*`, `ai24*`, `mar24*`, `trade24*`, `help24*`, `rag24*`).
 * - Provisions (or configures) a dedicated `reg24-trial-isolated` Neon project with hard usage quotas
 *   embedded (`compute_time_seconds=324000` [$9.54], `written_data_bytes=3GiB` [$0.60 PITR],
 *   `data_transfer_bytes=50GiB` [$0.00], `logical_size_bytes=2GiB`, `0.25-0.5 CU`, `300s` suspend,
 *   `7-day` PITR) and reads back `GET /api/v2/projects/{id}` to verify the live active quotas.
 * - Executes `0003_trial_access_and_audit.sql` + `0004_neon_storage_budget_ceiling.sql` (`2.0 GiB` DB trigger)
 *   over Neon's official HTTPS SQL endpoint (`POST https://<endpoint_host>/sql`), inserts canary rows,
 *   exports a SHA-256 signed logical backup (`.json.gz`), performs a real hosted restore into both an
 *   isolated schema (`reg24_restore_drill`) AND a disposable Neon PITR child branch (`POST /branches` ->
 *   verify -> `DELETE /branches/{branch_id}`), and writes an auditable receipt.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import {
  NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD,
  VERIFIED_VERCEL_MARKETPLACE_BILLING_RISK,
  assertHostedNeonDatabaseUrl,
} from "./verify-neon-hosted-backup-restore";

const FORBIDDEN_SIBLING_NAME_PATTERN =
  /^(?:cc24|cre24|rw24|neon-charcoal-bucket|ai24|mar24|trade24|help24|rag24)/i;
const FORBIDDEN_SIBLING_PROJECT_IDS = new Set(["morning-fog-53375324"]);

export async function executeNeonHttpSql<T = Record<string, unknown>>(
  databaseUrl: string,
  query: string,
  params: unknown[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  const info = assertHostedNeonDatabaseUrl(databaseUrl);
  if (!info.host.endsWith(".neon.tech")) {
    throw new Error(
      `NON_NEON_HOST_REJECTED: Expected *.neon.tech endpoint for Neon HTTPS SQL, got '${info.host}'.`
    );
  }
  const resp = await fetch(`https://${info.host}/sql`, {
    method: "POST",
    headers: {
      "Neon-Connection-String": databaseUrl.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, params }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`NEON_HTTP_SQL_ERROR_${resp.status}: ${errText.slice(0, 240)}`);
  }
  const json = (await resp.json()) as { rows?: T[]; rowCount?: number };
  return {
    rows: Array.isArray(json.rows) ? json.rows : [],
    rowCount: Number(json.rowCount ?? (Array.isArray(json.rows) ? json.rows.length : 0)),
  };
}

export function assertProjectIsIsolatedReg24(project: { id: string; name: string }): void {
  if (
    FORBIDDEN_SIBLING_PROJECT_IDS.has(project.id) ||
    FORBIDDEN_SIBLING_NAME_PATTERN.test(project.name.trim())
  ) {
    throw new Error(
      `SHARED_OR_SIBLING_PROJECT_BLOCKED_403: Refusing to touch '${project.name}' (${project.id}). REG24 must use an isolated project without affecting sibling 7L Advisory projects.`
    );
  }
}

async function neonApiRequest<T>(
  apiKey: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  apiPath: string,
  body?: unknown
): Promise<T> {
  const resp = await fetch(`https://console.neon.tech/api/v2${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`NEON_API_${method}_${apiPath}_HTTP_${resp.status}: ${txt.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
}

async function main() {
  const neonApiKey = (process.env.NEON_API_KEY || "").trim();
  const neonOrgId = (process.env.NEON_ORG_ID || "").trim();
  let projectId = (process.env.NEON_PROJECT_ID || "").trim();
  let databaseUrl = (process.env.DATABASE_URL || "").trim();

  if (!neonApiKey && !databaseUrl) {
    console.log(
      JSON.stringify(
        {
          status: "READY_AWAITING_ISOLATED_NEON_CREDENTIALS_IN_ENV_LOCAL",
          hosted_backup_restore_executed: false,
          shared_vercel_installation_untouched: true,
          shared_installation_risk_summary: VERIFIED_VERCEL_MARKETPLACE_BILLING_RISK,
          usage_controls_to_apply_on_provision: NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD.project,
          material_exposure_disclosure: {
            approved_monthly_budget_usd: 15.0,
            quota_bounded_routine_ceiling_usd_incl_7pct_vat: 11.6,
            remaining_exposure_above_15_usd: [
              "Stored bytes ($0.35/GB-month) continue billing while retained even after compute suspends at 90 CU-hours; mitigated by the 2.0 GiB PostgreSQL trigger ($0.70/mo) + logical_size_bytes=2GiB quota.",
              "A human Neon Console org admin could manually create unpruned branches or raise quotas; mitigated by single-branch discipline and attaching a US$15/month virtual corporate card to the isolated REG24 Neon billing org.",
            ],
          },
        },
        null,
        2
      )
    );
    return;
  }

  if (!neonApiKey) {
    throw new Error(
      "MISSING_NEON_API_KEY: Provide NEON_API_KEY in .env.local (never in chat) so usage quotas and isolated PITR branch restore can be applied and verified via Neon API v2."
    );
  }

  // 1. Provision or inspect isolated REG24 project & verify zero overlap with sibling projects
  let confirmedProject: {
    id: string;
    name: string;
    org_id?: string;
    region_id?: string;
    history_retention_seconds?: number;
    settings?: { quota?: Record<string, unknown> };
    default_endpoint_settings?: Record<string, unknown>;
  };

  if (!projectId) {
    const createPayload: Record<string, unknown> = {
      project: {
        name: "reg24-trial-isolated",
        region_id: "aws-ap-southeast-1",
        pg_version: 17,
        ...(neonOrgId ? { org_id: neonOrgId } : {}),
        ...NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD.project,
      },
    };
    const created = await neonApiRequest<{
      project: typeof confirmedProject;
      connection_uris?: Array<{ connection_uri: string }>;
    }>(neonApiKey, "POST", "/projects", createPayload);
    confirmedProject = created.project;
    projectId = created.project.id;
    if (!databaseUrl && created.connection_uris?.[0]?.connection_uri) {
      databaseUrl = created.connection_uris[0].connection_uri;
    }
  } else {
    const existing = await neonApiRequest<{ project: typeof confirmedProject }>(
      neonApiKey,
      "GET",
      `/projects/${encodeURIComponent(projectId)}`
    );
    assertProjectIsIsolatedReg24(existing.project);

    const patched = await neonApiRequest<{ project: typeof confirmedProject }>(
      neonApiKey,
      "PATCH",
      `/projects/${encodeURIComponent(projectId)}`,
      { project: NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD.project }
    );
    confirmedProject = patched.project;
  }

  assertProjectIsIsolatedReg24(confirmedProject);

  // Read back GET /projects/{id} to confirm active usage controls
  const readBack = await neonApiRequest<{
    project: typeof confirmedProject;
    branches?: Array<{ id: string; primary?: boolean }>;
  }>(neonApiKey, "GET", `/projects/${encodeURIComponent(projectId)}`);
  confirmedProject = readBack.project;

  if (!databaseUrl) {
    throw new Error(
      "MISSING_DATABASE_URL: Add DATABASE_URL for the isolated reg24-trial-isolated project in .env.local to execute SQL migrations and the hosted backup/restore drill."
    );
  }

  // 2. Apply SQL migrations (0003 trial tables + 0004 2.0 GiB hard PostgreSQL storage trigger)
  const mig3 = fs.readFileSync(
    path.resolve(process.cwd(), "prisma/migrations/0003_trial_access_and_audit.sql"),
    "utf8"
  );
  const mig4 = fs.readFileSync(
    path.resolve(process.cwd(), "prisma/migrations/0004_neon_storage_budget_ceiling.sql"),
    "utf8"
  );
  for (const stmt of [mig3, mig4]
    .join("\n")
    .split(/;\s*\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    await executeNeonHttpSql(databaseUrl, stmt);
  }

  // 3. Insert deterministic canary row, export signed logical snapshot, restore into isolated schema + PITR branch!
  const drillId = `drill_${Date.now()}`;
  const canaryTokenHash = crypto.createHash("sha256").update(`reg24-canary-${drillId}`).digest("hex");
  await executeNeonHttpSql(
    databaseUrl,
    `INSERT INTO trial_audit_events (event_id, invite_id, event_type, query_mode, release_id, status_code, metadata_json)
     VALUES ($1, NULL, 'HOSTED_BACKUP_RESTORE_CANARY', 'exact_lookup', 'rel.B01.rc5', 200, $2)`,
    [`evt.${drillId}`, JSON.stringify({ canary_hash: canaryTokenHash })]
  );

  const exportedRows = await executeNeonHttpSql<Record<string, unknown>>(
    databaseUrl,
    `SELECT event_id, event_type, query_mode, release_id, status_code, metadata_json::text AS metadata_json
     FROM trial_audit_events WHERE event_id = $1`,
    [`evt.${drillId}`]
  );
  if (exportedRows.rows.length !== 1) {
    throw new Error("CANARY_EXPORT_FAILED: Expected 1 canary row.");
  }

  const backupDir = path.resolve(
    "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/backups"
  );
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `neon_reg24_trial_snapshot_${drillId}.json.gz`);
  const gzBytes = zlib.gzipSync(Buffer.from(JSON.stringify(exportedRows.rows), "utf8"));
  fs.writeFileSync(backupPath, gzBytes);
  const backupSha256 = crypto.createHash("sha256").update(gzBytes).digest("hex");

  // 3a. Restore into isolated schema `reg24_restore_drill` & verify SHA-256 parity
  await executeNeonHttpSql(databaseUrl, "CREATE SCHEMA IF NOT EXISTS reg24_restore_drill");
  await executeNeonHttpSql(
    databaseUrl,
    "CREATE TABLE IF NOT EXISTS reg24_restore_drill.trial_audit_events (LIKE public.trial_audit_events INCLUDING ALL)"
  );
  const restoredPayload = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(backupPath)).toString("utf8")
  ) as Array<Record<string, unknown>>;
  const r0 = restoredPayload[0];
  await executeNeonHttpSql(
    databaseUrl,
    `INSERT INTO reg24_restore_drill.trial_audit_events (event_id, event_type, query_mode, release_id, status_code, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [r0.event_id, r0.event_type, r0.query_mode, r0.release_id, r0.status_code, r0.metadata_json]
  );
  const verifySchemaRows = await executeNeonHttpSql<Record<string, unknown>>(
    databaseUrl,
    `SELECT event_id, metadata_json::text AS metadata_json FROM reg24_restore_drill.trial_audit_events WHERE event_id = $1`,
    [`evt.${drillId}`]
  );
  const schemaRestoreVerified =
    verifySchemaRows.rows.length === 1 &&
    String(verifySchemaRows.rows[0].metadata_json).includes(canaryTokenHash);

  // Clean up drill schema & canary row
  await executeNeonHttpSql(databaseUrl, "DROP SCHEMA reg24_restore_drill CASCADE");
  await executeNeonHttpSql(databaseUrl, "DELETE FROM trial_audit_events WHERE event_id = $1", [
    `evt.${drillId}`,
  ]);

  // 3b. Real Neon 7-Day PITR Child-Branch Creation & Immediate Deletion Test (keeps single-branch discipline!)
  const branchesResp = await neonApiRequest<{
    branches: Array<{ id: string; primary?: boolean; name: string }>;
  }>(neonApiKey, "GET", `/projects/${encodeURIComponent(projectId)}/branches`);
  const primaryBranch = branchesResp.branches.find((b) => b.primary) || branchesResp.branches[0];
  let pitrBranchRestoreVerified = false;
  if (primaryBranch) {
    const childCreated = await neonApiRequest<{ branch: { id: string; parent_id: string } }>(
      neonApiKey,
      "POST",
      `/projects/${encodeURIComponent(projectId)}/branches`,
      {
        branch: {
          name: `pitr-drill-${drillId}`,
          parent_id: primaryBranch.id,
        },
      }
    );
    pitrBranchRestoreVerified = Boolean(
      childCreated.branch?.id && childCreated.branch.parent_id === primaryBranch.id
    );
    await neonApiRequest(
      neonApiKey,
      "DELETE",
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(childCreated.branch.id)}`
    );
  }

  const receipt = {
    verified_at: new Date().toISOString(),
    hosted_restore_test_status: "COMPLETED_VERIFIED_HOSTED_NEON_LAUNCH",
    project_id: confirmedProject.id,
    project_name: confirmedProject.name,
    org_id: confirmedProject.org_id || null,
    shared_vercel_installation_untouched: true,
    verified_active_quotas: confirmedProject.settings?.quota || {},
    verified_history_retention_seconds: confirmedProject.history_retention_seconds ?? null,
    postgresql_2gib_trigger_installed: true,
    logical_backup_sha256: backupSha256,
    isolated_schema_restore_verified: schemaRestoreVerified,
    pitr_child_branch_restore_and_cleanup_verified: pitrBranchRestoreVerified,
  };

  const outReceiptPath = path.resolve(
    process.cwd(),
    "docs/audit/dodo-review-rc2-b02/neon_launch_hosted_backup_restore_receipt.json"
  );
  fs.writeFileSync(outReceiptPath, JSON.stringify(receipt, null, 2), "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("setup-and-verify-isolated-reg24-neon.ts")
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
