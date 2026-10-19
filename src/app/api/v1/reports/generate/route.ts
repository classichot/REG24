import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { ReportTemplateType } from "@/core/types/legal-schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const report = reg24Core.generateResearchStudioReport({
      report_type: (body.report_type as ReportTemplateType) || "corporate_transaction_dd_report",
      query_or_topic: body.query_or_topic || body.topic || "Acquisition of a Thai Solar Power Company",
      industry_module: body.industry_module || "IND-ENERGY",
      language: body.language || "bilingual_th_en",
      as_of_date: body.as_of_date || "2026-10-19",
      tenant_id: body.tenant_id || "tenant.law24.prod",
    });
    return NextResponse.json({ status: "ok", report });
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET() {
  const snap = reg24Core.getDashboardSnapshot();
  return NextResponse.json({
    status: "ok",
    reports: snap.researchReportsV2,
  });
}
