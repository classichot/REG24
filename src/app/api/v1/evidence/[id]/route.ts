import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const jurisdiction = req.nextUrl.searchParams.get("jurisdiction") || "TH";
  const objectRef = req.nextUrl.searchParams.get("object_ref") || undefined;
  const auth = await resolveAuthFromNextRequest(req);

  const res = await reg24ApplicationService.getAuthorizedEvidence(
    {
      request_id: req.nextUrl.searchParams.get("request_id") || `REQ-EVID-${Date.now()}`,
      jurisdiction,
      payload: { evidence_id: id, object_ref: objectRef },
    },
    auth
  );
  return NextResponse.json(res.body, { status: res.status });
}
