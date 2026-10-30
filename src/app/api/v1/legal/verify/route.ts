import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { normalizeCanonicalRequest, resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await resolveAuthFromNextRequest(req, body.tenant_id as string | undefined);
  const canonicalReq = normalizeCanonicalRequest(body, {
    citations:
      (body.citations as Array<{
        provision_id: string;
        provision_version_id?: string;
        claimed_quote?: string;
        claimed_hash?: string;
      }>) || [{ provision_id: "PROV-TH-CCC-1097", provision_version_id: "PVER-TH-CCC-1097-V2" }],
  });
  const res = await reg24ApplicationService.verifyCitationsAndClaims(canonicalReq, auth);
  return NextResponse.json(res.body, { status: res.status });
}
