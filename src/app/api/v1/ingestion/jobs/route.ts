import { NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET() {
  return NextResponse.json({
    total_jobs: reg24Core.listCaseIngestionJobs().length,
    jobs: reg24Core.listCaseIngestionJobs(),
    data_quality_metrics: reg24Core.getCaseDataQualityMetrics(),
  });
}
