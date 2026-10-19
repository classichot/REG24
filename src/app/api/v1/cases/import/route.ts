import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.importLegalCase(body);
    return NextResponse.json(res, { status: res.success ? 200 : 422 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import case" },
      { status: 400 }
    );
  }
}
