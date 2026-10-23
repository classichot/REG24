import { NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { knowledgeIngestionPipeline } from "@/core/ingestion/knowledge-ingestion-pipeline";

export async function GET() {
  const pipelineSnap = knowledgeIngestionPipeline.getPipelineDashboardSnapshot();
  return NextResponse.json({
    total_jobs: reg24Core.listCaseIngestionJobs().length,
    jobs: reg24Core.listCaseIngestionJobs(),
    data_quality_metrics: reg24Core.getCaseDataQualityMetrics(),
    knowledge_ingestion_pipeline_v1: pipelineSnap,
  });
}
