import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { resolveServerActor } from "@/core/knowledge/http-auth";
import { queryKnowledge } from "@/core/knowledge/query";
import { getDefaultKnowledgeStore } from "@/core/knowledge/store";

export async function POST(req: NextRequest) {
  try {
    const actor = resolveServerActor(req);
    const body = await req.json();
    const queryText = String(
      body.query || body.question || "Analyze the legal requirements for acquiring a Thai solar power company."
    );
    const explicitAsOf = body.as_of_date || body.applicable_date || null;

    const store = getDefaultKnowledgeStore();
    const grounded = await queryKnowledge(
      {
        question: queryText,
        applicable_date: explicitAsOf,
      },
      actor,
      { store, channel: "api" }
    );

    const isWithheld =
      grounded.status === "NEEDS_CLARIFICATION" ||
      grounded.status === "INSUFFICIENT_EVIDENCE" ||
      grounded.status === "REVIEW_REQUIRED";

    const res = reg24Core.analyzeCorporateCommercialLegalQuestion({
      query: queryText,
      as_of_date: explicitAsOf || "2026-10-19",
      industry_module: body.industry_module,
      legal_domains: body.legal_domains,
      research_mode: body.research_mode,
      tenant_id: body.tenant_id || "tenant.law24.prod",
    });

    if (isWithheld) {
      return NextResponse.json({
        ...res,
        status: grounded.status,
        grounded_status: grounded.status,
        executive_summary: grounded.answer,
        clarification_questions: grounded.clarification_questions,
        coverage_warnings: grounded.coverage_warnings,
        applicable_date: grounded.applicable_date,
        traceable_answer: grounded.traceable_answer || null,
      });
    }

    return NextResponse.json({
      ...res,
      grounded_status: grounded.status,
      clarification_questions: grounded.clarification_questions,
      applicable_date: grounded.applicable_date,
      traceable_answer: grounded.traceable_answer || null,
    });
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const actor = resolveServerActor(req);
  const { searchParams } = new URL(req.url);
  const query =
    searchParams.get("q") ||
    searchParams.get("query") ||
    "Analyze the legal requirements for acquiring a Thai solar power company.";
  const explicitAsOf = searchParams.get("as_of_date") || searchParams.get("applicable_date") || null;

  const store = getDefaultKnowledgeStore();
  const grounded = await queryKnowledge(
    {
      question: query,
      applicable_date: explicitAsOf,
    },
    actor,
    { store, channel: "api" }
  );

  const res = reg24Core.analyzeCorporateCommercialLegalQuestion({
    query,
    as_of_date: explicitAsOf || "2026-10-19",
    industry_module: searchParams.get("industry_module") || undefined,
  });

  const isWithheld =
    grounded.status === "NEEDS_CLARIFICATION" ||
    grounded.status === "INSUFFICIENT_EVIDENCE" ||
    grounded.status === "REVIEW_REQUIRED";

  return NextResponse.json({
    ...res,
    ...(isWithheld ? { status: grounded.status, executive_summary: grounded.answer } : {}),
    grounded_status: grounded.status,
    clarification_questions: grounded.clarification_questions,
    applicable_date: grounded.applicable_date,
    traceable_answer: grounded.traceable_answer || null,
  });
}
