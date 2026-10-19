import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.analyzeLegalIssueAgentic({
      query: body.query || "คำพิพากษาฎีกาเกี่ยวกับรายจ่ายต้องห้ามตามมาตรา 65 ตรี",
      transaction_date: body.transaction_date,
      scenario_code: body.scenario_code,
      cited_case_number: body.cited_case_number,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to analyze legal issue" },
      { status: 400 }
    );
  }
}
