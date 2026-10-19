import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET() {
  return NextResponse.json({
    total_sources: reg24Core.listCaseSources().length,
    sources: reg24Core.listCaseSources(),
    services: reg24Core.listCaseServices(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.registerCaseSourceConnector(body);
    return NextResponse.json(res, { status: res.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to register source connector" },
      { status: 400 }
    );
  }
}
