import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET() {
  return NextResponse.json(reg24Core.getDashboardSnapshot());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, payload } = body;

    switch (action) {
      case "install_module": {
        const res = reg24Core.installDynamicModule(payload);
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "set_module_state": {
        const res = reg24Core.setModuleLifecycleState(
          payload.module_id,
          payload.state,
          payload.new_version
        );
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "rollback_module": {
        const res = reg24Core.rollbackModuleVersion(payload.module_id);
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "uninstall_module": {
        const res = reg24Core.uninstallModuleSafely(payload.module_id);
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "approve_rule": {
        const res = reg24Core.approveDraftRule(
          payload.rule_id,
          payload.reviewer_name || "Dr. Somchai Nitikorn (Legal Reviewer)",
          payload.reviewer_role || "Legal Reviewer"
        );
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "simulate_amendment": {
        const res = reg24Core.simulateSharedProvisionAmendment(
          payload?.provision_id || "prov.th.ccc.1097"
        );
        return NextResponse.json({ success: true, ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "run_3r_graphrag": {
        const res = reg24Core.execute3RGraphRAGQuery({
          query: payload?.query || "Can a company terminate an employee without severance pay?",
          as_of_date: payload?.as_of_date || "2026-10-18",
          known_at_date: payload?.known_at_date || "2026-10-18",
          facts: payload?.facts,
        });
        return NextResponse.json({ success: true, graphrag_3r: res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "run_restructuring_mission": {
        const res = reg24Core.executeCrossModuleRestructuringMission({
          scenario_question: payload?.scenario_question,
          transaction_date: payload?.transaction_date || "2026-10-18",
          execution_mode: payload?.execution_mode || "agent_swarm",
          facts: payload?.facts,
        });
        return NextResponse.json({
          success: true,
          mission: res.result,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_tax_precedent_comparison": {
        const res = reg24Core.executeTaxPrecedentComparison({
          transaction_date: payload?.transaction_date || "2026-10-18",
          accounting_period: payload?.accounting_period,
          facts: payload?.facts,
        });
        return NextResponse.json({
          success: true,
          tax_precedent_comparison: res.result,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_pdpa_compliance_mission": {
        const res = reg24Core.executePDPAComplianceMission({
          as_of_date: payload?.as_of_date || "2026-10-18",
          tenant_id: payload?.tenant_id || "tenant.law24.prod",
          scenario_summary: payload?.scenario_summary,
          facts: payload?.facts,
        });
        return NextResponse.json({
          success: true,
          pdpa_compliance_assessment: res.result,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_case_search": {
        const searchRes = reg24Core.searchLegalCases({
          query: payload?.query,
          retrieval_methods: payload?.retrieval_methods,
          filters: payload?.filters,
        });
        return NextResponse.json({
          success: true,
          case_search: searchRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_case_agentic_research": {
        const researchRes = reg24Core.analyzeLegalIssueAgentic({
          query: payload?.query || "คำพิพากษาฎีกาเกี่ยวกับรายจ่ายต้องห้ามตามมาตรา 65 ตรี",
          transaction_date: payload?.transaction_date,
          scenario_code: payload?.scenario_code,
          cited_case_number: payload?.cited_case_number,
        });
        return NextResponse.json({
          success: true,
          case_research: researchRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_case_comparison": {
        const cmpRes = reg24Core.compareLegalCases(
          payload?.case_ids || ["case.th.dika.2845_2564", "case.th.dika.6120_2565"],
          payload?.focus_dimension
        );
        return NextResponse.json({
          success: true,
          case_comparison: cmpRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_case_citation_verify": {
        const citRes = reg24Core.verifyCaseCitation({
          citation: payload?.citation || "คำพิพากษาศาลฎีกาที่ 2845/2564",
          statute_section: payload?.statute_section,
          quote: payload?.quote,
          claimed_overruled: payload?.claimed_overruled,
        });
        return NextResponse.json({
          success: true,
          citation_verification: citRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_historical_law_query": {
        const histRes = reg24Core.getHistoricalLawPointInTime({
          transaction_date: payload?.transaction_date || "2018-06-30",
          assessment_date: payload?.assessment_date,
          filing_date: payload?.filing_date,
          judgment_date: payload?.judgment_date,
          topic_or_provision_id: payload?.topic_or_provision_id,
        });
        return NextResponse.json({
          success: true,
          historical_law: histRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "import_legal_case": {
        const impRes = reg24Core.importLegalCase(payload || {});
        return NextResponse.json({
          ...impRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "register_case_connector": {
        const connRes = reg24Core.registerCaseSourceConnector(payload || {});
        return NextResponse.json({
          ...connRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_v2_legal_analysis": {
        const v2Res = reg24Core.analyzeCorporateCommercialLegalQuestion({
          query: payload?.query || "Analyze the legal requirements for acquiring a Thai solar power company.",
          as_of_date: payload?.as_of_date || "2026-10-19",
          industry_module: payload?.industry_module,
          legal_domains: payload?.legal_domains,
          research_mode: payload?.research_mode,
          tenant_id: payload?.tenant_id || "tenant.law24.prod",
        });
        return NextResponse.json({
          success: true,
          v2_analysis: v2Res,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "register_industry_module": {
        const indRes = reg24Core.registerIndustryModule(payload || {});
        return NextResponse.json({
          ...indRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "run_agent_mission_v2": {
        const missionRes = reg24Core.executeAgentMissionV2(payload || {});
        return NextResponse.json({
          success: true,
          mission: missionRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "generate_studio_report": {
        const reportRes = reg24Core.generateResearchStudioReport(payload || {});
        return NextResponse.json({
          success: true,
          report: reportRes,
          snapshot: reg24Core.getDashboardSnapshot(),
        });
      }
      case "reset_seed": {
        reg24Core.resetToSeed();
        return NextResponse.json({ success: true, snapshot: reg24Core.getDashboardSnapshot() });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process platform action" },
      { status: 400 }
    );
  }
}
