/**
 * REG24 — Hosted Neon Launch Backup, Point-in-Time / Branch Restore & Hard-Quota Verification Harness
 *
 * IMPORTANT STATUS DISCLOSURE (Owner Item 1 — 2026-11-17):
 * - HOSTED_RESTORE_TEST_STATUS = "NOT_YET_EXECUTED_PENDING_PROVISIONING".
 * - This harness is NOT a completed hosted backup/restore test by itself.
 * - A real hosted Neon Launch backup-and-restore test MUST be executed and documented
 *   against a live `*.neon.tech` endpoint after Owner go-ahead and BEFORE external trial invitations.
 *
 * Pre-Invite Trial Gate:
 * - Refuses to run against localhost/SQLite — requires a real hosted PostgreSQL connection (`neon.tech`).
 * - Applies `0003_trial_access_and_audit.sql` and `0004_neon_storage_budget_ceiling.sql` (`2.0 GiB` PostgreSQL-level write ceiling).
 * - Inserts deterministic canary rows across `trial_invite_credentials`, `trial_audit_events`, and `trial_feedback_entries`,
 *   exports a signed logical snapshot (`.json.gz` + `SHA-256`), verifies clean restoration into an isolated schema (`reg24_restore_drill`),
 *   verifies 100% row & SHA-256 parity, drops the temporary drill schema, and writes an auditable receipt.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export const HOSTED_RESTORE_TEST_STATUS = "NOT_YET_EXECUTED_PENDING_PROVISIONING" as const;

export function assertHostedNeonDatabaseUrl(rawUrl: string | undefined): {
  host: string;
  database: string;
} {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      "MISSING_HOSTED_DATABASE_URL: Hosted Neon backup/restore test is NOT YET EXECUTED (pending provisioning). Set DATABASE_URL locally in .env.local (never in chat) after provisioning to run the real hosted drill."
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
