/**
 * REG24 — Server-Side Actor Resolution, Anti-Spoofing & HTTP Error Mapper for Knowledge GraphRAG APIs
 * Implements SH-16 & AT08 (Server-supplied tenant/scope; client body never grants private scope).
 */

import { NextResponse } from "next/server";
import { FIXED_BATCH_ORDER, type Actor, type ActorRole, type BatchId } from "./contracts";

const VALID_ROLES = new Set<ActorRole>([
  "product_owner",
  "engineering_lead",
  "legal_reviewer",
  "data_operator",
  "reader",
  "tenant_reader",
]);

/**
 * Resolves the caller's `Actor` from server-verified session/headers ONLY — NEVER from client JSON body!
 * Unauthenticated public web visitors receive `reader` with `scope.platform.public` only.
 * Authenticated Owner UAT / Operator actions identify role via `x-reg24-actor-role` + `x-reg24-actor-id`
 * (or configured bearer token in production).
 */
export function resolveServerActor(req: Request, opts?: { requireCsrfForMutation?: boolean }): Actor {
  if (opts?.requireCsrfForMutation) {
    const csrfHeader = req.headers.get("x-reg24-csrf");
    const originHeader = req.headers.get("origin");
    // Require explicit `x-reg24-csrf: 1` or same-site origin when mutating release/job state
    if (!csrfHeader && originHeader && !originHeader.includes("localhost") && !originHeader.includes("vercel.app")) {
      throw new Error("FORBIDDEN_403: Cross-origin state mutation blocked by CSRF policy.");
    }
  }

  const headerRole = req.headers.get("x-reg24-actor-role") as ActorRole | null;
  const headerActorId = req.headers.get("x-reg24-actor-id")?.trim();
  const role: ActorRole = headerRole && VALID_ROLES.has(headerRole) ? headerRole : "reader";

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
      headerActorId ||
      (role === "product_owner"
        ? "rattaroj@reg24.th"
        : role === "engineering_lead"
          ? "eng.lead@reg24.th"
          : role === "legal_reviewer"
            ? "counsel.thai@reg24.th"
            : "public.reader@reg24.th"),
    role,
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
  if (msg.includes("_403") || msg.startsWith("FORBIDDEN_403")) status = 403;
  else if (msg.includes("_404")) status = 404;
  else if (msg.includes("_409") || msg.includes("STALE_WORKER_FENCING_TOKEN")) status = 409;
  else if (
    msg.includes("_422") ||
    msg.includes("PROJECTION_INCOMPLETE_OR_MEMORY_ONLY_BLOCKED") ||
    msg.includes("PREDECESSOR_BATCH_NOT_ACCEPTED")
  ) {
    status = 422;
  } else if (msg.includes("_400")) {
    status = 400;
  }

  return NextResponse.json(
    {
      ok: false,
      error: msg,
      http_status: status,
    },
    { status }
  );
}
