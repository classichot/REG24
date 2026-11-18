import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { ReportTemplateType } from "@/core/types/legal-schema";
import { resolveServerActor } from "@/core/knowledge/http-auth";
import { queryKnowledge } from "@/core/knowledge/query";
import { getDefaultKnowledgeStore } from "@/core/knowledge/store";

export async function POST(req: NextRequest) {
  try {
    const actor = resolveServerActor(req);
    const body = await req.json();
    const topicOrQuery =
      body.query_or_topic || body.topic || "Acquisition of a Thai Solar Power Company";
    const asOfDate = body.as_of_date || null;

    const report = reg24Core.generateResearchStudioReport({
      report_type:
        (body.report_type as ReportTemplateType) || "corporate_transaction_dd_report",
      query_or_topic: topicOrQuery,
      industry_module: body.industry_module || "IND-ENERGY",
      language: body.language || "bilingual_th_en",
      as_of_date: asOfDate || "2026-10-19",
      tenant_id: body.tenant_id || "tenant.law24.prod",
    });

    const store = getDefaultKnowledgeStore();
    const grounded = await queryKnowledge(
      {
        question: String(topicOrQuery),
        applicable_date: asOfDate,
      },
      actor,
      { store, channel: "report" }
    );

    const isWithheld =
      grounded.status === "NEEDS_CLARIFICATION" ||
      grounded.status === "INSUFFICIENT_EVIDENCE" ||
      grounded.status === "REVIEW_REQUIRED";

    const sanitizedReport = isWithheld
      ? {
          ...report,
          executive_summary_th: grounded.answer,
          executive_summary_en: grounded.answer,
          grounded_status: grounded.status,
          clarification_questions: grounded.clarification_questions,
          traceable_answer: grounded.traceable_answer || null,
        }
      : {
          ...report,
          grounded_status: grounded.status,
          clarification_questions: grounded.clarification_questions,
          traceable_answer: grounded.traceable_answer || null,
        };

    return NextResponse.json({
      status: isWithheld ? grounded.status : "ok",
      grounded_status: grounded.status,
      clarification_questions: grounded.clarification_questions,
      coverage_warnings: grounded.coverage_warnings,
      applicable_date: grounded.applicable_date,
      report: sanitizedReport,
      traceable_answer: grounded.traceable_answer || null,
    });
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
