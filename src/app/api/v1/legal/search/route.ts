import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.searchLaw({
      query: body.query || "Section 1097",
      module_ids: body.module_ids,
      as_of_date: body.as_of_date || "2026-10-19",
      known_at_date: body.known_at_date || "2026-10-19",
      result_limit: body.limit || 20,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || searchParams.get("query") || "Section 1097";
  const asOfDate = searchParams.get("as_of_date") || "2026-10-19";
  const res = reg24Core.searchLaw({
    query,
    as_of_date: asOfDate,
    known_at_date: asOfDate,
  });
  return NextResponse.json(res);
}
