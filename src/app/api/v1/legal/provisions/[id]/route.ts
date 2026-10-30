import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { reg24ApplicationService } from "@/packages/application";
import {
  resolveAuthFromNextRequest,
  normalizeCanonicalRequest,
} from "@/packages/application/http-helper";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { searchParams } = new URL(req.url);
  const asOfDate = searchParams.get("legal_as_of") || searchParams.get("as_of_date") || "2026-10-19";
  const knownAtDate = searchParams.get("known_as_of") || searchParams.get("known_at_date") || asOfDate;
  const auth = await resolveAuthFromNextRequest(req);
  const canonicalReq = normalizeCanonicalRequest(
    { legal_as_of: asOfDate, known_as_of: knownAtDate },
    { provision_id: id }
  );
  const appOutcome = await reg24ApplicationService.resolveProvisionVersion(canonicalReq, auth);
  if (appOutcome.status >= 400) {
    return NextResponse.json(appOutcome.body, { status: appOutcome.status });
  }
  const res = reg24Core.executeMCPTool("reg24.get_provision", {
    provision_id: id,
    as_of_date: asOfDate,
    known_at_date: knownAtDate,
  });
  return NextResponse.json({
    ...res,
    ...appOutcome.body,
  });
}
