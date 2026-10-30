import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const jurisdiction = req.nextUrl.searchParams.get("jurisdiction") || "TH";
  const auth = await resolveAuthFromNextRequest(req);

  const res = await reg24ApplicationService.explainAmendmentHistory(
    {
      request_id: req.nextUrl.searchParams.get("request_id") || `REQ-HIST-${Date.now()}`,
      jurisdiction,
      legal_as_of: req.nextUrl.searchParams.get("legal_as_of") || undefined,
      known_as_of: req.nextUrl.searchParams.get("known_as_of") || undefined,
      payload: { provision_id: id },
    },
    auth
  );
  return NextResponse.json(res.body, { status: res.status });
}
