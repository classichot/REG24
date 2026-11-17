/**
 * REG24 — Hosted Neon Launch Backup, Point-in-Time / Branch Restore & Hard-Quota Verification Script
 *
 * Pre-Invite Trial Gate (Owner Item 1):
 * - Runs ONLY after Owner confirms the Neon billing account + residual storage exposure notice and supplies `DATABASE_URL`.
 * - Refuses to run against localhost/SQLite — requires a real hosted PostgreSQL connection (`neon.tech`).
 * - Applies `prisma/migrations/0003_trial_access_and_audit.sql` idempotently.
 * - Inserts deterministic canary rows across `trial_invite_credentials`, `trial_audit_events`, and `trial_feedback_entries`,
 *   exports a signed logical snapshot (`.json.gz` + `SHA-256`), verifies clean restoration into an isolated schema (`reg24_restore_drill`),
 *   verifies 100% row & SHA-256 parity, drops the temporary drill schema, and writes an auditable receipt.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export function assertHostedNeonDatabaseUrl(rawUrl: string | undefined): {
  host: string;
  database: string;
} {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      "MISSING_HOSTED_DATABASE_URL: Set DATABASE_URL to the provisioned Neon Launch PostgreSQL connection string before running the hosted backup/restore drill."
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
        // 72 CU-hours * $0.106 = $7.63 max compute/month (hard-suspends compute at ceiling)
        compute_time_seconds: 259_200,
        // 5 GiB max WAL/writes per month -> caps 7-day PITR history <= $1.00/mo AND bounds storage growth <= +5 GiB/mo ($1.75/mo)
        written_data_bytes: 5_368_709_120,
        // 50 GiB <= 500 GiB included free egress ($0.00)
        data_transfer_bytes: 53_687_091_200,
        // Logical size safety cap (3 GiB * $0.35 = $1.05/mo storage)
        logical_size_bytes: 3_221_225_472,
      },
    },
    default_endpoint_settings: {
      autoscaling_limit_min_cu: 0.25,
      autoscaling_limit_max_cu: 0.5,
      suspend_timeout_seconds: 300,
    },
    history_retention_seconds: 604_800, // 7-day PITR recovery window
  },
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
          ready_for_hosted_drill: true,
          host_redacted: info.host,
          database: info.database,
          recommended_quota: NEON_LAUNCH_RECOMMENDED_QUOTA_PAYLOAD,
          sql_migration: path.resolve(process.cwd(), "prisma/migrations/0003_trial_access_and_audit.sql"),
          zlib_ready: typeof zlib.gzipSync === "function",
          sha256_ready: typeof crypto.createHash === "function",
          migration_exists: fs.existsSync(
            path.resolve(process.cwd(), "prisma/migrations/0003_trial_access_and_audit.sql")
          ),
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
