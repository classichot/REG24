import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.execute3RGraphRAGQuery({
      query: body.query || "Can a company terminate an employee without severance pay?",
      as_of_date: body.as_of_date || "2026-10-19",
      known_at_date: body.known_at_date || "2026-10-19",
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "Can a company terminate an employee without severance pay?";
  const res = reg24Core.execute3RGraphRAGQuery({
    query,
    as_of_date: searchParams.get("as_of_date") || "2026-10-19",
    known_at_date: "2026-10-19",
  });
  return NextResponse.json(res);
}
