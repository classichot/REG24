import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { reg24ApplicationService } from "@/packages/application";
import {
  resolveAuthFromNextRequest,
  normalizeCanonicalRequest,
} from "@/packages/application/http-helper";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = await resolveAuthFromNextRequest(req, body.tenant_id);
    const canonicalReq = normalizeCanonicalRequest(body, {
      query: String(body.query || "Section 1097"),
      top_k: typeof body.limit === "number" ? body.limit : 20,
    });
    const appOutcome = await reg24ApplicationService.searchAuthority(canonicalReq, auth);
    if (appOutcome.status >= 400) {
      return NextResponse.json(appOutcome.body, { status: appOutcome.status });
    }
    const res = reg24Core.searchLaw({
      query: body.query || "Section 1097",
      module_ids: body.module_ids,
      as_of_date: body.legal_as_of || body.as_of_date || "2026-10-19",
      known_at_date: body.known_as_of || body.known_at_date || "2026-10-19",
      result_limit: body.limit || 20,
    });
    return NextResponse.json({
      ...res,
      ...appOutcome.body,
    });
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || searchParams.get("query") || "Section 1097";
  const asOfDate = searchParams.get("legal_as_of") || searchParams.get("as_of_date") || "2026-10-19";
  const knownAtDate = searchParams.get("known_as_of") || searchParams.get("known_at_date") || asOfDate;
  const auth = await resolveAuthFromNextRequest(req);
  const canonicalReq = normalizeCanonicalRequest(
    { legal_as_of: asOfDate, known_as_of: knownAtDate },
    { query }
  );
  const appOutcome = await reg24ApplicationService.searchAuthority(canonicalReq, auth);
  if (appOutcome.status >= 400) {
    return NextResponse.json(appOutcome.body, { status: appOutcome.status });
  }
  const res = reg24Core.searchLaw({
    query,
    as_of_date: asOfDate,
    known_at_date: knownAtDate,
  });
  return NextResponse.json({
    ...res,
    ...appOutcome.body,
  });
}
