/**
 * REG24 — Invite-Only Limited Trial Gate, Sliding-Window Rate Limiter & Query/Citation Audit Logger
 *
 * Designed for the limited real-user B01 trial (`RD Tax Rulings + Revenue Code` scope):
 * 1. Optional invite-only token enforcement (`REG24_TRIAL_INVITE_ONLY === "1"`) via `x-reg24-trial-invite`
 *    or `Authorization: Bearer <token>`. Raw tokens are never stored; only SHA-256 hashes are compared/logged.
 * 2. Per-actor sliding-window rate limits (`REG24_TRIAL_QUERY_LIMIT_15M` default 30,
 *    `REG24_TRIAL_EVIDENCE_LIMIT_15M` default 120) returning HTTP 429 with `Retry-After`.
 * 3. Append-only query & citation audit log (`trial_audit_log.jsonl` in the configured store directory,
 *    and pluggable `TrialAuditSink` interface ready for Option A managed PostgreSQL `trial_audit_events`).
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

const slidingWindowBuckets = new Map<string, number[]>();
let customAuditSink: TrialAuditSink | null = null;

export function setCustomTrialAuditSink(sink: TrialAuditSink | null): void {
  customAuditSink = sink;
}

export function resetTrialRateLimiterForTesting(): void {
  slidingWindowBuckets.clear();
}

function extractInviteToken(req: Request): string | null {
  const headerInvite = req.headers.get("x-reg24-trial-invite")?.trim();
  if (headerInvite) return headerInvite;
  const auth = req.headers.get("authorization")?.trim();
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  return null;
}

function resolveAllowedInviteHashes(): Set<string> {
  const out = new Set<string>();
  const rawHashes = process.env.REG24_TRIAL_ALLOWED_INVITE_SHA256 || "";
  for (const h of rawHashes.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    out.add(h);
  }
  const rawPlain = process.env.REG24_TRIAL_INVITE_CODES || "";
  for (const code of rawPlain.split(",").map((s) => s.trim()).filter(Boolean)) {
    out.add(sha256Bytes(code));
  }
  return out;
}

export function enforceTrialAccessAndRateLimit(
  req: Request,
  actor: Actor,
  action: "query" | "citation_open"
): { inviteFingerprint: string | null; remainingInWindow: number } {
  const inviteOnly = process.env.REG24_TRIAL_INVITE_ONLY === "1";
  const token = extractInviteToken(req);
  const tokenHash = token ? sha256Bytes(token) : null;

  if (inviteOnly) {
    const allowedHashes = resolveAllowedInviteHashes();
    if (!tokenHash || (allowedHashes.size > 0 && !allowedHashes.has(tokenHash))) {
      throw new Error(
        "TRIAL_INVITE_REQUIRED_401: Protected limited-trial environment requires a valid invite credential."
      );
    }
  }

  const rateLimitActive = inviteOnly || process.env.REG24_TRIAL_RATE_LIMIT === "1";
  if (!rateLimitActive) {
    return {
      inviteFingerprint: tokenHash ? tokenHash.slice(0, 12) : null,
      remainingInWindow: 999,
    };
  }

  const windowMs = 15 * 60 * 1000;
  const maxRequests =
    action === "query"
      ? Number(process.env.REG24_TRIAL_QUERY_LIMIT_15M || 30)
      : Number(process.env.REG24_TRIAL_EVIDENCE_LIMIT_15M || 120);

  const subjectKey = `${action}:${tokenHash ? tokenHash.slice(0, 16) : actor.actor_id}`;
  const now = Date.now();
  const prev = (slidingWindowBuckets.get(subjectKey) || []).filter((ts) => now - ts < windowMs);
  if (prev.length >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - prev[0])) / 1000));
    throw new Error(
      `RATE_LIMITED_429: Trial rate limit exceeded (${maxRequests} ${action} requests per 15 minutes). Retry after ${retryAfterSec}s.`
    );
  }
  prev.push(now);
  slidingWindowBuckets.set(subjectKey, prev);

  return {
    inviteFingerprint: tokenHash ? tokenHash.slice(0, 12) : null,
    remainingInWindow: Math.max(0, maxRequests - prev.length),
  };
}

export async function appendTrialAuditEvent(
  store: DurableKnowledgeStore,
  event: TrialAuditEvent
): Promise<void> {
  if (customAuditSink) {
    await customAuditSink.append(event);
  }
  const shouldPersistDisk =
    process.env.REG24_TRIAL_AUDIT_LOG === "1" ||
    process.env.REG24_TRIAL_INVITE_ONLY === "1";
  if (!shouldPersistDisk) return;

  try {
    const logPath = path.join(store.getStorageTopology().data_dir, "trial_audit_log.jsonl");
    fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Non-fatal if underlying preview container directory is read-only
  }
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
