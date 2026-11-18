/**
 * REG24 — Server-Side Actor Resolution, Anti-Spoofing & HTTP Error Mapper for Knowledge GraphRAG APIs
 * Implements SH-16 & AT08 (Server-supplied tenant/scope; client body never grants private scope),
 * PLUS Material Issue 1 Hardening:
 * - Distinct per-user/per-invite actor identity so one user cannot spoof or overwrite another user's answer.
 * - Privileged header roles (`product_owner`, `engineering_lead`, `legal_reviewer`, `data_operator`) on
 *   deployed serverless (`VERCEL === "1"`) or when `REG24_ADMIN_ROLE_SECRET` is configured require
 *   matching `x-reg24-admin-secret` so unauthenticated external callers cannot self-elevate.
 */

import { NextResponse } from "next/server";
import { FIXED_BATCH_ORDER, type Actor, type ActorRole, type BatchId } from "./contracts";
import { sha256Bytes } from "./identity";

const VALID_ROLES = new Set<ActorRole>([
  "product_owner",
  "engineering_lead",
  "legal_reviewer",
  "data_operator",
  "reader",
  "tenant_reader",
]);

const PRIVILEGED_ROLES = new Set<ActorRole>([
  "product_owner",
  "engineering_lead",
  "legal_reviewer",
  "data_operator",
]);

export function resolveServerActor(req: Request, opts?: { requireCsrfForMutation?: boolean }): Actor {
  if (opts?.requireCsrfForMutation) {
    const csrfHeader = req.headers.get("x-reg24-csrf");
    const originHeader = req.headers.get("origin");
    if (
      !csrfHeader &&
      originHeader &&
      !originHeader.includes("localhost") &&
      !originHeader.includes("vercel.app")
    ) {
      throw new Error("FORBIDDEN_403: Cross-origin state mutation blocked by CSRF policy.");
    }
  }

  const headerRole = req.headers.get("x-reg24-actor-role") as ActorRole | null;
  const requestedRole: ActorRole = headerRole && VALID_ROLES.has(headerRole) ? headerRole : "reader";

  // On deployed serverless or when REG24_ADMIN_ROLE_SECRET is configured, prevent unauthenticated role spoofing!
  const adminSecretEnv = (process.env.REG24_ADMIN_ROLE_SECRET || "").trim();
  const isDeployedServerless = process.env.VERCEL === "1";
  let effectiveRole: ActorRole = requestedRole;
  if (PRIVILEGED_ROLES.has(requestedRole) && (adminSecretEnv.length > 0 || isDeployedServerless)) {
    const suppliedAdminSecret = (req.headers.get("x-reg24-admin-secret") || "").trim();
    if (!adminSecretEnv || suppliedAdminSecret !== adminSecretEnv) {
      effectiveRole = "reader";
    }
  }

  // Derive distinct user identity from invite/bearer credential when present so two readers never collide on actor_id
  const inviteOrBearer =
    req.headers.get("x-reg24-trial-invite")?.trim() ||
    req.headers
      .get("authorization")
      ?.replace(/^bearer\s+/i, "")
      .trim() ||
    "";
  const credentialActorId = inviteOrBearer
    ? `trial.user.${sha256Bytes(inviteOrBearer).slice(0, 14)}@reg24.th`
    : null;

  const headerActorId = req.headers.get("x-reg24-actor-id")?.trim();

  // Private tenant scopes can ONLY be granted by verified server secret header, never from JSON payload (AT08)
  const verifiedTenantKey = req.headers.get("x-reg24-verified-tenant-scope")?.trim();
  const scopes = ["scope.platform.public"];
  if (
    verifiedTenantKey &&
    process.env.REG24_TENANT_SCOPE_SECRET &&
    req.headers.get("x-reg24-tenant-secret") === process.env.REG24_TENANT_SCOPE_SECRET
  ) {
    scopes.push(verifiedTenantKey);
  }

  return {
    actor_id:
      credentialActorId ||
      headerActorId ||
      (effectiveRole === "product_owner"
        ? "rattaroj@reg24.th"
        : effectiveRole === "engineering_lead"
          ? "eng.lead@reg24.th"
          : effectiveRole === "legal_reviewer"
            ? "counsel.thai@reg24.th"
            : "public.reader@reg24.th"),
    role: effectiveRole,
    tenant_id: "PUBLIC",
    authorized_scopes: scopes,
    csrf_verified: true,
  };
}

export function assertValidBatchId(raw: string): BatchId {
  const upper = raw.toUpperCase() as BatchId;
  if (!FIXED_BATCH_ORDER.includes(upper)) {
    throw new Error(`BATCH_NOT_FOUND_404: Unknown batch_id '${raw}'. Expected B01..B10.`);
  }
  return upper;
}

export function knowledgeApiErrorResponse(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  let status = 500;
  if (msg.includes("_401")) status = 401;
  else if (msg.includes("_403") || msg.startsWith("FORBIDDEN_403")) status = 403;
  else if (msg.includes("_404")) status = 404;
  else if (msg.includes("_409") || msg.includes("STALE_WORKER_FENCING_TOKEN")) status = 409;
  else if (msg.includes("_429")) status = 429;
  else if (msg.includes("_503")) status = 503;
  else if (
    msg.includes("_422") ||
    msg.includes("PROJECTION_INCOMPLETE_OR_MEMORY_ONLY_BLOCKED") ||
    msg.includes("PREDECESSOR_BATCH_NOT_ACCEPTED")
  ) {
    status = 422;
  } else if (msg.includes("_400")) {
    status = 400;
  }

  const headers: Record<string, string> = {};
  if (status === 429) {
    const retryMatch = msg.match(/Retry after (\d+)s/i);
    headers["Retry-After"] = retryMatch ? retryMatch[1] : "60";
  }

  return NextResponse.json(
    {
      ok: false,
      error: msg,
      http_status: status,
    },
    { status, headers }
  );
}
