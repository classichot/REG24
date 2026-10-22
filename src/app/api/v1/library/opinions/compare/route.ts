import { NextRequest, NextResponse } from "next/server";
import { reusableLegalKnowledgeLibrary } from "@/core/library/legal-knowledge-library";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const legalIssueId =
    body.legalIssueId ||
    body.legal_issue_id ||
    "issue.kl.tax.management_fee_deductibility";

  const comparison = reusableLegalKnowledgeLibrary.compareLegalOpinions(legalIssueId);
  return NextResponse.json({
    status: "ok",
    specification_id: "REG24-KL-001",
    requirement_ids: ["LIB-06", "LIB-08", "LIB-12"],
    comparison,
  });
}
