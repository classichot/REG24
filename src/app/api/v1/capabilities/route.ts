import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function GET(req: NextRequest) {
  const jurisdiction = req.nextUrl.searchParams.get("jurisdiction") || "TH";
  const requestedTenant = req.nextUrl.searchParams.get("tenant_id") || undefined;
  const auth = await resolveAuthFromNextRequest(req, requestedTenant);

  const res = await reg24ApplicationService.discoverCapabilities(
    {
      request_id: req.nextUrl.searchParams.get("request_id") || `REQ-CAP-${Date.now()}`,
      jurisdiction,
      legal_as_of: req.nextUrl.searchParams.get("legal_as_of") || undefined,
      known_as_of: req.nextUrl.searchParams.get("known_as_of") || undefined,
      payload: {},
    },
    auth
  );
  return NextResponse.json(res.body, { status: res.status });
}
