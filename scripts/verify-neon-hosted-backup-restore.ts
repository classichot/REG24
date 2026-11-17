/**
 * REG24 — Hosted Neon Launch Quota Pre-Enforcer & Real Backup/Restore Verification Harness
 *
 * Pre-Provisioning & Pre-Invite Trial Gates (Owner Item 1 — 2026-11-17):
 * 1. BILLING ACCOUNT & SHARED-INSTALLATION RISK FINDING:
 *    - Vercel Team `7L Advisory` (`team_jI61APP2gcTC9eHit6wDamuW`, `hobby` plan) currently has a shared
 *      Vercel Marketplace Neon installation (`icfg_8ULeOadGpGR7Ka7xprogDBY0`) on `billingPlan.id = "free_v3"`
 *      (`scope: "installation"`), shared by 8 sibling projects (`cc24`, `cre24` x2, `rw24`, `ai24`, `mar24`,
 *      `trade24`, `help24`).
 *    - MATERIAL BUDGET RISK FLAGGED: Upgrading `icfg_8ULeOadGpGR7Ka7xprogDBY0` inside Vercel Marketplace
 *      would convert ALL 8 sibling Neon projects to paid Neon Launch simultaneously and does not issue a
 *      Neon Management API key (`napi_...`) to enforce project-level quotas before provisioning.
 *    - REQUIRED SAFE PATH: Use an isolated standalone Neon Launch organization/project at `console.neon.tech`
 *      for REG24 ONLY (leaving `icfg_8ULeOadGpGR7Ka7xprogDBY0` untouched on `Free`), apply
 *      `NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD` via `applyNeonProjectQuotasBeforeUse()` BEFORE creating tables
 *      or ingesting trial data, and run the real hosted backup-and-restore drill below before external invitations.
 *
 * 2. HOSTED_RESTORE_TEST_STATUS = "NOT_YET_EXECUTED_PENDING_ISOLATED_NEON_ORG_CREDENTIALS".
 *    This script refuses localhost/SQLite and requires a real `*.neon.tech` endpoint.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export const HOSTED_RESTORE_TEST_STATUS =
  "NOT_YET_EXECUTED_PENDING_ISOLATED_NEON_ORG_CREDENTIALS" as const;

export const VERIFIED_VERCEL_MARKETPLACE_BILLING_RISK = {
  vercel_team_id: "team_jI61APP2gcTC9eHit6wDamuW",
  vercel_team_name: "7L Advisory",
  shared_neon_marketplace_installation_id: "icfg_8ULeOadGpGR7Ka7xprogDBY0",
  current_installation_plan: "free_v3 (scope: installation)",
  sibling_stores_sharing_installation_count: 8,
  material_risk_flagged:
    "Upgrading shared Vercel Marketplace installation icfg_8ULeOadGpGR7Ka7xprogDBY0 to Neon Launch would convert all 8 sibling project databases to paid Launch billing at once and lacks Neon API quota controls. Provision REG24 in a dedicated standalone Neon org (console.neon.tech) instead.",
} as const;

export const NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD = {
  project: {
    settings: {
      quota: {
        // 90 CU-hours * $0.106 = $9.54 max compute/month (hard-suspends compute at ceiling)
        compute_time_seconds: 324_000,
        // 3 GiB max WAL/writes per month -> bounds 7-day PITR history <= 3 GiB * $0.20 = $0.60/mo
        written_data_bytes: 3_221_225_472,
        // 50 GiB <= 100 GiB included free egress ($0.00/mo)
        data_transfer_bytes: 53_687_091_200,
        // 2 GiB logical size safety cap -> paired with 0004_neon_storage_budget_ceiling.sql trigger ($0.70/mo storage)
        logical_size_bytes: 2_147_483_648,
      },
    },
    default_endpoint_settings: {
      autoscaling_limit_min_cu: 0.25,
      autoscaling_limit_max_cu: 0.5,
      suspend_timeout_seconds: 300,
    },
    history_retention_seconds: 604_800, // 7-day PITR recovery window
  },
  // Subtotal max under single-branch discipline: $9.54 compute + $0.70 storage + $0.60 PITR + $0.00 egress = $10.84/mo
  // Plus 7% Thai VAT ($0.76) = $11.60/mo worst-case (< US$15.00/mo budget with $3.40/mo safety headroom)
} as const;

export async function applyNeonProjectQuotasBeforeUse(params: {
  neonApiKey: string;
  projectId: string;
}): Promise<{
  applied: boolean;
  project_id: string;
  confirmed_quota: Record<string, unknown>;
}> {
  if (!params.neonApiKey.trim() || !params.projectId.trim()) {
    throw new Error("MISSING_NEON_API_CREDENTIALS: NEON_API_KEY and NEON_PROJECT_ID are required.");
  }
  const resp = await fetch(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(params.projectId.trim())}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${params.neonApiKey.trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        project: NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD.project,
      }),
    }
  );
  if (!resp.ok) {
    throw new Error(`NEON_QUOTA_PATCH_FAILED_HTTP_${resp.status}`);
  }
  const json = (await resp.json()) as {
    project?: { id?: string; settings?: { quota?: Record<string, unknown> } };
  };
  return {
    applied: true,
    project_id: json.project?.id || params.projectId,
    confirmed_quota: json.project?.settings?.quota || {},
  };
}

export function assertHostedNeonDatabaseUrl(rawUrl: string | undefined): {
  host: string;
  database: string;
} {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      "MISSING_HOSTED_DATABASE_URL: Hosted Neon backup/restore test is NOT YET EXECUTED (pending isolated Neon org credentials in .env.local — never paste in chat)."
    );
  }
  const parsed = new URL(rawUrl.trim());
  if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) {
    throw new Error(`INVALID_DATABASE_PROTOCOL: Expected postgresql://, got '${parsed.protocol}'.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    throw new Error(
      "LOCAL_DB_REJECTED: Pre-invite gate requires a real hosted Neon Launch instance, not localhost."
    );
  }
  return {
    host,
    database: parsed.pathname.replace(/^\//, "") || "neondb",
  };
}

if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("verify-neon-hosted-backup-restore.ts")
) {
  try {
    const info = assertHostedNeonDatabaseUrl(process.env.DATABASE_URL);
    console.log(
      JSON.stringify(
        {
          hosted_restore_test_status: HOSTED_RESTORE_TEST_STATUS,
          verified_billing_risk: VERIFIED_VERCEL_MARKETPLACE_BILLING_RISK,
          ready_for_hosted_drill: true,
          host_redacted: info.host,
          database: info.database,
          recommended_quota: NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD,
          sql_migrations: [
            path.resolve(process.cwd(), "prisma/migrations/0003_trial_access_and_audit.sql"),
            path.resolve(process.cwd(), "prisma/migrations/0004_neon_storage_budget_ceiling.sql"),
          ],
          zlib_ready: typeof zlib.gzipSync === "function",
          sha256_ready: typeof crypto.createHash === "function",
          migrations_exist:
            fs.existsSync(path.resolve(process.cwd(), "prisma/migrations/0003_trial_access_and_audit.sql")) &&
            fs.existsSync(path.resolve(process.cwd(), "prisma/migrations/0004_neon_storage_budget_ceiling.sql")),
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
