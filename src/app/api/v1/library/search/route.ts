import { NextRequest, NextResponse } from "next/server";
import {
  reusableLegalKnowledgeLibrary,
  type ConsumingApplicationId,
} from "@/core/library/legal-knowledge-library";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query =
      body.query ||
      body.question ||
      "Management fee deductibility under Revenue Code Section 65 ter";
    const asOfDate = body.asOfDate || body.as_of_date || "2026-10-22";
    const tenantId =
      body.tenantId ||
      body.tenant_id ||
      req.headers.get("x-reg24-tenant") ||
      "tenant.law24.prod";
    const consumingApp = (body.consumingApp ||
      body.consuming_app ||
      req.headers.get("x-reg24-app") ||
      "REG24") as ConsumingApplicationId;

    const answer = reusableLegalKnowledgeLibrary.searchAndSynthesizeAuthorityAwareAnswer({
      query,
      asOfDate,
      tenantId,
      consumingApp,
      includeOutdatedHistorical: body.includeOutdatedHistorical ?? true,
    });

    return NextResponse.json({
      status: "ok",
      specification_id: "REG24-KL-001",
      requirement_ids: ["LIB-06", "LIB-08", "LIB-09", "LIB-10", "LIB-11", "RET-01"],
      answer,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Invalid library search request",
      },
      { status: 400 }
    );
  }
}
