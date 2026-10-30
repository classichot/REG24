import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService, type CanonicalMissionClass } from "@/packages/application";
import { normalizeCanonicalRequest, resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await resolveAuthFromNextRequest(req, body.tenant_id as string | undefined);
  const canonicalReq = normalizeCanonicalRequest(body, {
    mission_class: ((body.mission_class as string) || "corporate_issue_research") as CanonicalMissionClass,
    inputs: (body.inputs as Record<string, unknown>) || { issue: "Promoter requirements under CCC Sec. 1097" },
    spend_cap_usd: body.spend_cap_usd as number | undefined,
    require_approval_before_completion: body.require_approval_before_completion as boolean | undefined,
  });
  const res = await reg24ApplicationService.createMission(canonicalReq, auth);
  return NextResponse.json(res.body, { status: res.status });
}
