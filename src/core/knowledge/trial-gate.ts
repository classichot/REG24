/**
 * REG24 — Fail-Closed Invite Gate, Distributed Cross-Instance Rate Limiter & Verified Durable Audit Logger
 *
 * Hardened for the 20 November Limited Real-User B01 Trial (`RD Tax Rulings + Revenue Code` scope):
 * 1. FAIL-CLOSED INVITE GATE (`REG24_TRIAL_INVITE_ONLY === "1"`):
 *    - Rejects missing tokens (`401`), invalid/expired/revoked tokens (`401`), AND fails closed (`403`)
 *      when zero approved invitations are configured across both PostgreSQL (`trial_invite_credentials`)
 *      and `REG24_TRIAL_ALLOWED_INVITE_SHA256` / `REG24_TRIAL_INVITE_CODES`.
 * 2. DISTRIBUTED CROSS-INSTANCE RATE LIMITING:
 *    - Uses atomic ACID PostgreSQL `INSERT ... ON CONFLICT DO UPDATE RETURNING request_count` on
 *      `trial_rate_limit_buckets` across all deployed serverless instances when `DATABASE_URL` (`*.neon.tech`)
 *      or a shared `TrialDbTransport` is configured.
 *    - Fails closed (`503`) on serverless (`VERCEL === "1"`) in `REG24_TRIAL_INVITE_ONLY=1` mode if no
 *      shared database backend is configured or reachable, preventing silent degradation to per-lambda memory.
 * 3. VERIFIED DURABLE AUDIT PERSISTENCE OR EXPLICIT FAILURE REPORTING:
 *    - Verifies HTTP `200` + `RETURNING audit_id` row confirmation on hosted PostgreSQL `trial_audit_events`.
 *    - Never treats ephemeral serverless container disk (`VERCEL === "1"`) as durable storage.
 *    - Throws `TRIAL_AUDIT_PERSISTENCE_FAILED_503` in protected trial mode if durable audit saving fails,
 *      and explicitly surfaces `audit_status` + `x-reg24-audit-status` headers when optional audit logging fails.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "./identity";
import type { Actor, AnswerStatus } from "./contracts";
import type { DurableKnowledgeStore } from "./store";

export interface TrialQueryAuditEvent {
  audit_id: string;
  event_type: "TRIAL_QUERY";
  recorded_at: string;
  actor_id: string;
  actor_role: string;
  invite_fingerprint: string | null;
  release_id: string;
  manifest_hash: string | null;
  trace_id: string;
  question_sha256: string;
  question_text: string;
  applicable_date: string | null;
  mode: string;
  answer_status: AnswerStatus;
  cited_passage_ids: string[];
  cited_work_ids: string[];
  coverage_warnings_count: number;
  latency_ms: number;
}

export interface TrialCitationAuditEvent {
  audit_id: string;
  event_type: "TRIAL_CITATION_OPEN";
  recorded_at: string;
  actor_id: string;
  actor_role: string;
  invite_fingerprint: string | null;
  passage_id: string;
  work_id: string | null;
  official_identifier: string | null;
  origin_uri: string | null;
  http_status: number;
}

export type TrialAuditEvent = TrialQueryAuditEvent | TrialCitationAuditEvent;

export interface TrialAuditSink {
  append(event: TrialAuditEvent): Promise<void> | void;
}

export type TrialDbTransport = <T = Record<string, unknown>>(
  query: string,
  params?: unknown[]
) => Promise<{ rows: T[]; rowCount: number }>;

export interface TrialAccessDecision {
  inviteFingerprint: string | null;
  remainingInWindow: number;
  rateLimitBackend: "hosted_postgres_distributed" | "memory_single_instance" | "disabled";
}

export interface TrialAuditPersistenceStatus {
  required: boolean;
  persisted_durable: boolean;
  backend: "hosted_postgres" | "custom_sink" | "local_disk" | "none" | "failed";
  error: string | null;
}

const slidingWindowBuckets = new Map<string, number[]>();
let customAuditSink: TrialAuditSink | null = null;
let customDbTransport: TrialDbTransport | null = null;

export function setCustomTrialAuditSink(sink: TrialAuditSink | null): void {
  customAuditSink = sink;
}

export function setCustomTrialDbTransportForTesting(transport: TrialDbTransport | null): void {
  customDbTransport = transport;
}

export function resetTrialRateLimiterForTesting(): void {
  slidingWindowBuckets.clear();
}

function resolveActiveDbTransport(): TrialDbTransport | null {
  if (customDbTransport) {
    return customDbTransport;
  }
  if (process.env.VITEST && process.env.REG24_ALLOW_LIVE_DB_IN_VITEST !== "1") {
    return null;
  }
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) return null;

  let host: string;
  try {
    const parsed = new URL(dbUrl);
    if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith(".neon.tech")) {
    return null;
  }

  return async <T = Record<string, unknown>>(
    query: string,
    params: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number }> => {
    const resp = await fetch(`https://${host}/sql`, {
      method: "POST",
      headers: {
        "Neon-Connection-String": dbUrl,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, params }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`NEON_SQL_HTTP_${resp.status}:${errBody.slice(0, 180)}`);
    }
    const json = (await resp.json()) as { rows?: T[]; rowCount?: number };
    const rows = Array.isArray(json.rows) ? json.rows : [];
    return {
      rows,
      rowCount: Number(json.rowCount ?? rows.length),
    };
  };
}

function extractInviteToken(req: Request): string | null {
  const headerInvite = req.headers.get("x-reg24-trial-invite")?.trim();
  if (headerInvite) return headerInvite;
  const auth = req.headers.get("authorization")?.trim();
  if (auth && /^bearer\s+/i.test(auth)) {
    const val = auth.replace(/^bearer\s+/i, "").trim();
    return val.length > 0 ? val : null;
  }
  return null;
}

function resolveAllowedInviteHashes(): Set<string> {
  const out = new Set<string>();
  const rawHashes = process.env.REG24_TRIAL_ALLOWED_INVITE_SHA256 || "";
  for (const h of rawHashes.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (/^[0-9a-f]{64}$/.test(h)) {
      out.add(h);
    }
  }
  const rawPlain = process.env.REG24_TRIAL_INVITE_CODES || "";
  for (const code of rawPlain.split(",").map((s) => s.trim()).filter(Boolean)) {
    out.add(sha256Bytes(code));
  }
  return out;
}

export interface AuthenticatedReviewerReadOnlyStatus {
  verified: boolean;
  gate_enabled: boolean;
  actor_id: string | null;
  tenant_id: string | null;
  invite_id: string | null;
  environment_scope: "staging" | "trial";
  error_code: string | null;
}

/**
 * Strictly read-only pre-Generate check that reports the server-verified reviewer & tenant identity
 * without mutating state, burning query quota, or echoing raw tokens/emails.
 */
export async function inspectAuthenticatedReviewerReadOnly(
  req: Request
): Promise<AuthenticatedReviewerReadOnlyStatus> {
  const inviteOnly = process.env.REG24_TRIAL_INVITE_ONLY === "1";
  const envScope: "staging" | "trial" =
    process.env.REG24_TRIAL_ENV_SCOPE === "staging" ? "staging" : "trial";
  const token = extractInviteToken(req);
  const tokenHash = token ? sha256Bytes(token) : null;

  if (!tokenHash) {
    return {
      verified: false,
      gate_enabled: inviteOnly,
      actor_id: null,
      tenant_id: null,
      invite_id: null,
      environment_scope: envScope,
      error_code: inviteOnly ? "TRIAL_INVITE_REQUIRED_401" : null,
    };
  }

  const allowedHashes = resolveAllowedInviteHashes();
  let matched = allowedHashes.has(tokenHash);
  let matchedInviteId: string | null = matched ? "env.allowed_invite" : null;
  const dbTransport = resolveActiveDbTransport();

  if (dbTransport) {
    try {
      const dbInviteRes = await dbTransport<{ invite_id: string }>(
        `SELECT invite_id
         FROM trial_invite_credentials
         WHERE token_sha256 = $1
           AND environment_scope = $2
           AND revoked_at IS NULL
           AND expires_at > NOW()
         LIMIT 1`,
        [tokenHash, envScope]
      );
      if (dbInviteRes.rows.length > 0) {
        matched = true;
        matchedInviteId = dbInviteRes.rows[0].invite_id;
      }
    } catch {
      if (!matched) {
        return {
          verified: false,
          gate_enabled: inviteOnly,
          actor_id: null,
          tenant_id: null,
          invite_id: null,
          environment_scope: envScope,
          error_code: "TRIAL_INVITE_STORE_UNAVAILABLE_503",
        };
      }
    }
  }

  if (!matched) {
    return {
      verified: false,
      gate_enabled: inviteOnly,
      actor_id: null,
      tenant_id: null,
      invite_id: null,
      environment_scope: envScope,
      error_code: "TRIAL_INVITE_INVALID_401",
    };
  }

  const sha14 = tokenHash.slice(0, 14);
  return {
    verified: true,
    gate_enabled: inviteOnly,
    actor_id: `trial.user.${sha14}@reg24.th`,
    tenant_id: `tenant.trial.${sha14}`,
    invite_id: matchedInviteId,
    environment_scope: envScope,
    error_code: null,
  };
}

export async function enforceTrialAccessAndRateLimit(
  req: Request,
  actor: Actor,
  action: "query" | "citation_open"
): Promise<TrialAccessDecision> {
  const inviteOnly = process.env.REG24_TRIAL_INVITE_ONLY === "1";
  const isServerlessDeploy = process.env.VERCEL === "1";
  const envScope = process.env.REG24_TRIAL_ENV_SCOPE === "staging" ? "staging" : "trial";
  const dbTransport = resolveActiveDbTransport();

  const token = extractInviteToken(req);
  const tokenHash = token ? sha256Bytes(token) : null;
  let dbQueryLimitOverride: number | null = null;
  let dbEvidenceLimitOverride: number | null = null;

  if (inviteOnly) {
    const allowedHashes = resolveAllowedInviteHashes();

    // FAIL-CLOSED: When invite-only mode is enabled and ZERO approved invites are configured in env or DB,
    // reject ALL requests (even before checking whether the caller sent a random header)!
    if (!dbTransport && allowedHashes.size === 0) {
      throw new Error(
        "TRIAL_NO_APPROVED_INVITES_CONFIGURED_403: Invite-only trial gate is active, but zero approved invitations are configured; rejecting access fail-closed."
      );
    }

    if (!tokenHash) {
      throw new Error(
        "TRIAL_INVITE_REQUIRED_401: Protected limited-trial environment requires a valid invite credential."
      );
    }

    let matchedInEnv = allowedHashes.has(tokenHash);
    let matchedInDb = false;

    if (dbTransport) {
      let dbInviteRes: {
        rows: Array<{
          invite_id: string;
          query_limit_15m: number;
          evidence_limit_15m: number;
        }>;
      };
      try {
        dbInviteRes = await dbTransport(
          `SELECT invite_id, query_limit_15m, evidence_limit_15m
           FROM trial_invite_credentials
           WHERE token_sha256 = $1
             AND environment_scope = $2
             AND revoked_at IS NULL
             AND expires_at > NOW()
           LIMIT 1`,
          [tokenHash, envScope]
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `TRIAL_INVITE_STORE_UNAVAILABLE_503: Unable to verify invite credential against hosted trial database (${reason}).`
        );
      }

      if (dbInviteRes.rows.length > 0) {
        matchedInDb = true;
        dbQueryLimitOverride = Number(dbInviteRes.rows[0].query_limit_15m) || null;
        dbEvidenceLimitOverride = Number(dbInviteRes.rows[0].evidence_limit_15m) || null;
      } else if (allowedHashes.size === 0) {
        // Also verify whether the DB table has 0 approved invites configured overall so error diagnostics are exact
        const countRes = await dbTransport<{ cnt: number | string }>(
          `SELECT count(*)::int AS cnt
           FROM trial_invite_credentials
           WHERE environment_scope = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
          [envScope]
        ).catch(() => ({ rows: [{ cnt: 0 }], rowCount: 1 }));
        if (Number(countRes.rows[0]?.cnt ?? 0) === 0) {
          throw new Error(
            "TRIAL_NO_APPROVED_INVITES_CONFIGURED_403: Invite-only trial gate is active, but zero active invitations exist in trial_invite_credentials; rejecting access fail-closed."
          );
        }
      }
    }

    if (!matchedInEnv && !matchedInDb) {
      throw new Error(
        "TRIAL_INVITE_INVALID_401: Provided invite credential is not approved, expired, or revoked."
      );
    }
  }

  const rateLimitActive = inviteOnly || process.env.REG24_TRIAL_RATE_LIMIT === "1";
  if (!rateLimitActive) {
    return {
      inviteFingerprint: tokenHash ? tokenHash.slice(0, 12) : null,
      remainingInWindow: 999,
      rateLimitBackend: "disabled",
    };
  }

  const windowMs = 15 * 60 * 1000;
  const maxRequests =
    action === "query"
      ? (dbQueryLimitOverride ?? Number(process.env.REG24_TRIAL_QUERY_LIMIT_15M || 30))
      : (dbEvidenceLimitOverride ?? Number(process.env.REG24_TRIAL_EVIDENCE_LIMIT_15M || 120));

  const forwardedIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const subjectKey = tokenHash
    ? `inv:${tokenHash.slice(0, 16)}`
    : forwardedIp
      ? `ip:${sha256Bytes(forwardedIp).slice(0, 16)}`
      : `act:${actor.actor_id}`;

  const now = Date.now();
  const windowEpoch = Math.floor(now / windowMs);
  const windowEndMs = (windowEpoch + 1) * windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((windowEndMs - now) / 1000));

  // Cross-instance distributed rate limiting via hosted PostgreSQL (`trial_rate_limit_buckets`)
  if (dbTransport) {
    let bucketRes: { rows: Array<{ request_count: number | string }> };
    try {
      bucketRes = await dbTransport(
        `INSERT INTO trial_rate_limit_buckets (subject_key, action_type, window_epoch, request_count, updated_at)
         VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (subject_key, action_type, window_epoch)
         DO UPDATE SET request_count = trial_rate_limit_buckets.request_count + 1, updated_at = NOW()
         RETURNING request_count`,
        [subjectKey, action, windowEpoch]
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `TRIAL_RATELIMIT_BACKEND_UNAVAILABLE_503: Distributed rate-limit check failed (${reason}).`
      );
    }

    const currentCount = Number(bucketRes.rows[0]?.request_count ?? 1);
    if (currentCount > maxRequests) {
      throw new Error(
        `RATE_LIMITED_429: Trial rate limit exceeded (${maxRequests} ${action} requests per 15 minutes across deployed service). Retry after ${retryAfterSec}s.`
      );
    }

    return {
      inviteFingerprint: tokenHash ? tokenHash.slice(0, 12) : null,
      remainingInWindow: Math.max(0, maxRequests - currentCount),
      rateLimitBackend: "hosted_postgres_distributed",
    };
  }

  // On serverless (VERCEL=1), refuse per-instance memory rate limiting in protected invite-only trial mode
  // unless explicitly overridden for temporary non-external staging smoke checks!
  if (
    (inviteOnly || process.env.REG24_TRIAL_REQUIRE_DISTRIBUTED_RATELIMIT === "1") &&
    isServerlessDeploy &&
    process.env.REG24_ALLOW_SINGLE_INSTANCE_PREVIEW_RATELIMIT !== "1"
  ) {
    throw new Error(
      "TRIAL_SHARED_DB_REQUIRED_ON_SERVERLESS_503: Protected serverless trial requires DATABASE_URL (hosted Neon PostgreSQL) so rate limits and audit logs hold across all deployed instances."
    );
  }

  const memKey = `${action}:${subjectKey}`;
  const prev = (slidingWindowBuckets.get(memKey) || []).filter((ts) => now - ts < windowMs);
  if (prev.length >= maxRequests) {
    const memRetrySec = Math.max(1, Math.ceil((windowMs - (now - prev[0])) / 1000));
    throw new Error(
      `RATE_LIMITED_429: Trial rate limit exceeded (${maxRequests} ${action} requests per 15 minutes). Retry after ${memRetrySec}s.`
    );
  }
  prev.push(now);
  slidingWindowBuckets.set(memKey, prev);

  return {
    inviteFingerprint: tokenHash ? tokenHash.slice(0, 12) : null,
    remainingInWindow: Math.max(0, maxRequests - prev.length),
    rateLimitBackend: "memory_single_instance",
  };
}

export async function appendTrialAuditEvent(
  store: DurableKnowledgeStore,
  event: TrialAuditEvent
): Promise<TrialAuditPersistenceStatus> {
  const inviteOnly = process.env.REG24_TRIAL_INVITE_ONLY === "1";
  const strictDurableRequired =
    inviteOnly || process.env.REG24_TRIAL_REQUIRE_DURABLE_AUDIT === "1";
  const optionalAuditRequested =
    strictDurableRequired ||
    process.env.REG24_TRIAL_AUDIT_LOG === "1" ||
    process.env.REG24_TRIAL_DB_AUDIT === "1" ||
    customAuditSink !== null;

  if (!optionalAuditRequested) {
    return {
      required: false,
      persisted_durable: false,
      backend: "none",
      error: null,
    };
  }

  const errors: string[] = [];
  let persistedBackend: TrialAuditPersistenceStatus["backend"] = "failed";
  let persistedDurable = false;

  // 1. Custom injected sink (used in integration tests or custom enterprise collectors)
  if (customAuditSink) {
    try {
      await customAuditSink.append(event);
      persistedDurable = true;
      persistedBackend = "custom_sink";
    } catch (err) {
      errors.push(`custom_sink: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Hosted PostgreSQL (`trial_audit_events`) — primary durable store across deployed Vercel instances
  const dbTransport = resolveActiveDbTransport();
  if (dbTransport) {
    try {
      const scope = process.env.REG24_TRIAL_ENV_SCOPE === "staging" ? "staging" : "trial";
      if (event.event_type === "TRIAL_QUERY") {
        const ins = await dbTransport<{ audit_id: string }>(
          `INSERT INTO trial_audit_events (
            audit_id, event_type, environment_scope, recorded_at, actor_id, actor_role,
            invite_fingerprint, release_id, manifest_hash, trace_id, question_sha256,
            question_text, applicable_date, mode, answer_status, cited_passage_ids_json,
            cited_work_ids_json, coverage_warnings_count, latency_ms
          ) VALUES (
            $1, 'TRIAL_QUERY', $2, $3::timestamptz, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15::jsonb,
            $16::jsonb, $17, $18
          )
          ON CONFLICT (audit_id) DO UPDATE SET recorded_at = EXCLUDED.recorded_at
          RETURNING audit_id`,
          [
            event.audit_id,
            scope,
            event.recorded_at,
            event.actor_id,
            event.actor_role,
            event.invite_fingerprint,
            event.release_id,
            event.manifest_hash,
            event.trace_id,
            event.question_sha256,
            event.question_text,
            event.applicable_date,
            event.mode,
            event.answer_status,
            JSON.stringify(event.cited_passage_ids),
            JSON.stringify(event.cited_work_ids),
            event.coverage_warnings_count,
            event.latency_ms,
          ]
        );
        if (ins.rows.length < 1) {
          throw new Error("INSERT_RETURNED_ZERO_ROWS");
        }
      } else {
        const ins = await dbTransport<{ audit_id: string }>(
          `INSERT INTO trial_audit_events (
            audit_id, event_type, environment_scope, recorded_at, actor_id, actor_role,
            invite_fingerprint, passage_id, work_id, official_identifier, origin_uri, http_status
          ) VALUES (
            $1, 'TRIAL_CITATION_OPEN', $2, $3::timestamptz, $4, $5,
            $6, $7, $8, $9, $10, $11
          )
          ON CONFLICT (audit_id) DO UPDATE SET recorded_at = EXCLUDED.recorded_at
          RETURNING audit_id`,
          [
            event.audit_id,
            scope,
            event.recorded_at,
            event.actor_id,
            event.actor_role,
            event.invite_fingerprint,
            event.passage_id,
            event.work_id,
            event.official_identifier,
            event.origin_uri,
            event.http_status,
          ]
        );
        if (ins.rows.length < 1) {
          throw new Error("INSERT_RETURNED_ZERO_ROWS");
        }
      }
      persistedDurable = true;
      persistedBackend = "hosted_postgres";
    } catch (err) {
      errors.push(`hosted_postgres: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Local disk JSONL (ONLY treated as durable on non-serverless local/workstation runs!)
  const isServerlessDeploy = process.env.VERCEL === "1";
  const wantLocalDisk =
    !isServerlessDeploy &&
    (process.env.REG24_TRIAL_AUDIT_LOG === "1" || inviteOnly);

  if (wantLocalDisk) {
    try {
      const logPath = path.join(store.getStorageTopology().data_dir, "trial_audit_log.jsonl");
      fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
      if (!persistedDurable) {
        persistedDurable = true;
        persistedBackend = "local_disk";
      }
    } catch (err) {
      errors.push(`local_disk: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (isServerlessDeploy && !dbTransport && !customAuditSink) {
    errors.push(
      "serverless_no_durable_sink: VERCEL=1 container disk is ephemeral/read-only and DATABASE_URL is not configured"
    );
  }

  if (!persistedDurable || (dbTransport && errors.some((e) => e.startsWith("hosted_postgres:")))) {
    const combinedErr = errors.join("; ") || "No durable audit backend succeeded";
    console.error(
      JSON.stringify({
        level: "ERROR",
        code: "REG24_TRIAL_AUDIT_PERSISTENCE_FAILURE",
        audit_id: event.audit_id,
        event_type: event.event_type,
        strict_required: strictDurableRequired,
        error: combinedErr,
      })
    );

    if (strictDurableRequired) {
      throw new Error(
        `TRIAL_AUDIT_PERSISTENCE_FAILED_503: Trial audit record '${event.audit_id}' could not be durably saved (${combinedErr}).`
      );
    }

    return {
      required: false,
      persisted_durable: false,
      backend: "failed",
      error: combinedErr,
    };
  }

  return {
    required: strictDurableRequired,
    persisted_durable: true,
    backend: persistedBackend,
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}

export function readTrialAuditEvents(store: DurableKnowledgeStore): TrialAuditEvent[] {
  const logPath = path.join(store.getStorageTopology().data_dir, "trial_audit_log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TrialAuditEvent);
}
