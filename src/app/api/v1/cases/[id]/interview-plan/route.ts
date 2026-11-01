import { NextRequest, NextResponse } from "next/server";
import { reg24CaseIntelligenceService } from "@/packages/case-intelligence";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenant_id || req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
    const principalId = body.principal_id || req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

    const res = reg24CaseIntelligenceService.generateInterviewPlan({
      tenant_id: tenantId,
      case_id: id,
      principal_id: principalId,
      interviewee_ref: String(body.interviewee_ref || body.examinee_name || "Khun Anan (Eastern Logistics PM)"),
      interviewee_role: body.interviewee_role || "counterparty_witness",
      purpose: String(body.purpose || body.user_prompt_instructions || "Clarify Milestone 2 UAT completion and payment shortfall"),
    });

    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: String(err) } }, { status: 400 });
  }
}
