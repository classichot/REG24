import { NextRequest, NextResponse } from "next/server";
import {
  reg24ProductionTrialEngine,
  DECLARED_TRIAL_COVERAGE_MANIFEST,
  EVALUATION_GATE_REPORT_V1,
  P0_TRACEABILITY_REGISTER,
  type IssueCategory,
} from "@/core/production/reg24-production-trial-engine";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "snapshot";
  const organizationId = searchParams.get("organization_id") || "org.law24.trial";

  if (action === "coverage") {
    return NextResponse.json({
      status: "ok",
      coverage_manifest: DECLARED_TRIAL_COVERAGE_MANIFEST,
    });
  }

  if (action === "evaluation_gate") {
    return NextResponse.json({
      status: "ok",
      evaluation_gate_report: EVALUATION_GATE_REPORT_V1,
    });
  }

  if (action === "traceability") {
    return NextResponse.json({
      status: "ok",
      traceability_register: P0_TRACEABILITY_REGISTER,
    });
  }

  if (action === "acceptance_tests") {
    return NextResponse.json({
      status: "ok",
      acceptance_suite: reg24ProductionTrialEngine.runAll30AcceptanceTests(),
    });
  }

  if (action === "open_evidence") {
    const userId = searchParams.get("user_id") || "user.somchai@law24.th";
    const runId = searchParams.get("run_id") || "";
    const citationId = searchParams.get("citation_id") || "cite_primary_1";
    const res = reg24ProductionTrialEngine.openCitedEvidence({
      organization_id: organizationId,
      user_id: userId,
      run_id: runId,
      citation_id: citationId,
    });
    return NextResponse.json(res, { status: res.http_status });
  }

  return NextResponse.json({
    status: "ok",
    snapshot: reg24ProductionTrialEngine.getDashboardSnapshot(organizationId),
    acceptance_suite: reg24ProductionTrialEngine.runAll30AcceptanceTests(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || "execute_run";
    const organizationId = body.organization_id || "org.law24.trial";
    const userId = body.user_id || "user.somchai@law24.th";

    if (action === "execute_run") {
      const res = reg24ProductionTrialEngine.executeResearchRun({
        organization_id: organizationId,
        user_id: userId,
        matter_id: body.matter_id,
        question:
          body.question ||
          "การจ่ายค่าบริการซอฟต์แวร์และคลาวด์ในประเทศผ่านระบบ e-Withholding Tax หลังวันที่ 1 ตุลาคม 2569 ต้องหักภาษี ณ ที่จ่ายในอัตราใด?",
        legal_date: body.legal_date || "2026-10-24",
        language: body.language || "th",
        idempotency_key: body.idempotency_key,
        channel: body.channel || "web",
        simulate_missing_facts: Boolean(body.simulate_missing_facts),
        simulate_uncovered_subject: Boolean(body.simulate_uncovered_subject),
        simulate_commentary_conflict: Boolean(body.simulate_commentary_conflict),
        simulate_unknown_commencement: Boolean(body.simulate_unknown_commencement),
        simulate_invented_citation: Boolean(body.simulate_invented_citation),
        simulate_unsupported_claim_repair: Boolean(body.simulate_unsupported_claim_repair),
        simulate_decisive_ocr_defect: Boolean(body.simulate_decisive_ocr_defect),
        simulate_provider_timeout: Boolean(body.simulate_provider_timeout),
      });
      return NextResponse.json(res, { status: res.http_status });
    }

    if (action === "update_matter") {
      const res = reg24ProductionTrialEngine.updateMatterWithOptimisticConcurrency({
        organization_id: organizationId,
        user_id: userId,
        matter_id: body.matter_id || "mat.law24.ewht_2026",
        expected_version: Number(body.expected_version ?? 1),
        new_title: body.new_title,
        add_private_note: body.add_private_note,
      });
      return NextResponse.json(res, { status: res.http_status });
    }

    if (action === "create_export") {
      const res = reg24ProductionTrialEngine.createExportJob({
        organization_id: organizationId,
        user_id: userId,
        run_id: body.run_id,
        format: body.format === "docx" ? "docx" : "pdf",
      });
      return NextResponse.json(res, { status: res.http_status });
    }

    if (action === "report_issue") {
      const ticket = reg24ProductionTrialEngine.reportAnswerIssue({
        organization_id: organizationId,
        user_id: userId,
        run_id: body.run_id || "",
        category: (body.category as IssueCategory) || "wrong_authority",
        explanation: body.explanation || "Reported via Production & Trial Console",
        share_matter_content_permitted: Boolean(body.share_matter_content_permitted),
      });
      return NextResponse.json({ status: "ok", ticket });
    }

    if (action === "quarantine_source") {
      const res = reg24ProductionTrialEngine.quarantineSource(
        body.source_version_id || "src_rd_tp432_2569_v2"
      );
      return NextResponse.json({ status: "ok", ...res });
    }

    if (action === "delete_matter") {
      const res = reg24ProductionTrialEngine.deleteMatterWithTombstone(
        body.matter_id || "mat.law24.ewht_2026"
      );
      return NextResponse.json({ status: "ok", ...res });
    }

    return NextResponse.json(
      { status: "error", message: `Unsupported action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Unexpected error",
      },
      { status: 500 }
    );
  }
}
