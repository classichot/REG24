import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { normalizeCanonicalRequest, resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await resolveAuthFromNextRequest(req, body.tenant_id as string | undefined);
  const canonicalReq = normalizeCanonicalRequest(body, {
    subject_id: (body.subject_id as string) || "PROV-TH-CCC-1097",
    predicates: body.predicates as undefined,
    include_candidates: Boolean(body.include_candidates),
  });
  const res = await reg24ApplicationService.traverseLegalRelationships(canonicalReq, auth);
  return NextResponse.json(res.body, { status: res.status });
}
