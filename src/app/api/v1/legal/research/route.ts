import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { normalizeCanonicalRequest, resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await resolveAuthFromNextRequest(req, body.tenant_id as string | undefined);
  const canonicalReq = normalizeCanonicalRequest(body, {
    issue: (body.issue as string) || (body.query as string) || "Section 1097 promoter requirements",
    supplied_facts: (body.supplied_facts as Record<string, unknown>) || undefined,
    secondary_jurisdiction: (body.secondary_jurisdiction as string) || undefined,
  });
  const res = await reg24ApplicationService.researchIssue(canonicalReq, auth);
  return NextResponse.json(res.body, { status: res.status });
}
