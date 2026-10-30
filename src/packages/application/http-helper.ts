import { NextRequest } from "next/server";
import { reg24TrustPolicyEngine } from "../policy";
import type { Reg24CanonicalRequest, VerifiedAuthContext } from "../contracts";

export async function resolveAuthFromNextRequest(
  req: NextRequest,
  requestedTenantId?: string
): Promise<VerifiedAuthContext> {
  const headersObj: Record<string, string | undefined> = {};
  req.headers.forEach((val, key) => {
    headersObj[key.toLowerCase()] = val;
  });
  return reg24TrustPolicyEngine.verifyRequestAuth(headersObj, requestedTenantId);
}

export function normalizeCanonicalRequest<TPayload>(
  body: Record<string, unknown>,
  defaultPayload: TPayload
): Reg24CanonicalRequest<TPayload> {
  return {
    request_id: (body.request_id as string) || `REQ-${Date.now()}`,
    idempotency_key: body.idempotency_key as string | undefined,
    matter_id: body.matter_id as string | undefined,
    purpose: body.purpose as string | undefined,
    jurisdiction: (body.jurisdiction as string) || "TH",
    domain: body.domain as string | undefined,
    legal_as_of: body.legal_as_of as string | undefined,
    known_as_of: body.known_as_of as string | undefined,
    input_refs: body.input_refs as string[] | undefined,
    constraints: body.constraints as Reg24CanonicalRequest<TPayload>["constraints"],
    corpus_snapshot_id: body.corpus_snapshot_id as string | undefined,
    payload: (body.payload as TPayload) ?? defaultPayload,
  };
}
