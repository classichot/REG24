import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { normalizeCanonicalRequest, resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await resolveAuthFromNextRequest(req, body.tenant_id as string | undefined);
  const canonicalReq = normalizeCanonicalRequest(body, {
    rule_id: (body.rule_id as string) || undefined,
    entity_facts: (body.entity_facts as Record<string, string | number | boolean | undefined>) || {},
  });
  const res = await reg24ApplicationService.evaluateObligations(canonicalReq, auth);
  return NextResponse.json(res.body, { status: res.status });
}
