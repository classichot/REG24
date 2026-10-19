import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const caseIds: string[] = body.case_ids || ["case.th.dika.2845_2564", "case.th.dika.6120_2565"];
    const res = reg24Core.compareLegalCases(caseIds, body.focus_dimension);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compare cases" },
      { status: 400 }
    );
  }
}
