/**
 * Public exports for `@/packages/ocr-v2` — REG24 Thai Legal OCR, Verification & Source-Linked Publication v2.0
 */

export * from "./contract";
export * from "./thai-normalizer";
export * from "./providers";
export * from "./benchmark";
export * from "./service";

import { DEFAULT_SYSTEM_OPERATOR } from "./service";
import type { OcrHumanRole, OcrPrincipalContext } from "./contract";

/**
 * Extracts an authenticated `OcrPrincipalContext` from HTTP request headers.
 * Workspace and tenant come from verified header claims rather than unchecked payload fields.
 */
export function resolveOcrPrincipalFromHeaders(headers: {
  get(name: string): string | null;
}): OcrPrincipalContext {
  const principalId =
    headers.get("x-principal-id") ||
    headers.get("x-actor-id") ||
    DEFAULT_SYSTEM_OPERATOR.principal_id;
  const tenantId = headers.get("x-tenant-id") || DEFAULT_SYSTEM_OPERATOR.tenant_id;
  const workspaceId = headers.get("x-workspace-id") || DEFAULT_SYSTEM_OPERATOR.workspace_id;

  const rolesRaw = headers.get("x-roles");
  const roles: OcrHumanRole[] = rolesRaw
    ? (rolesRaw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean) as OcrHumanRole[])
    : [...DEFAULT_SYSTEM_OPERATOR.roles];

  const scopesRaw = headers.get("x-scopes");
  const scopes: string[] = scopesRaw
    ? scopesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [...DEFAULT_SYSTEM_OPERATOR.scopes];

  const isServiceAccount =
    headers.get("x-service-account") === "true" || roles.includes("service_account");
  const revoked = headers.get("x-revoked") === "true";

  // Administrators do NOT automatically receive confidential access unless explicitly granted
  const confidentialHeader = headers.get("x-confidential-access");
  const confidentialAccessGranted =
    confidentialHeader !== null
      ? confidentialHeader === "true"
      : !roles.includes("administrator") || roles.length > 1;

  return {
    principal_id: principalId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    roles,
    scopes,
    is_service_account: isServiceAccount,
    revoked,
    confidential_access_granted: confidentialAccessGranted,
  };
}
