import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { normalizeCanonicalRequest, resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await resolveAuthFromNextRequest(req, body.tenant_id as string | undefined);
  const canonicalReq = normalizeCanonicalRequest(body, {
    template_id: (body.template_id as string) || "LFORM-553-001",
    template_version: (body.template_version as string) || "v1.0",
    fields: (body.fields as Record<string, string>) || { party_a: "Thai Co., Ltd.", party_b: "Counterparty Co., Ltd." },
    clause_sources: (body.clause_sources as string[]) || ["PROV-TH-CCC-1097"],
  });
  const res = await reg24ApplicationService.generateOrReviewDraft(canonicalReq, auth);
  return NextResponse.json(res.body, { status: res.status });
}
