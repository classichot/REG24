import { NextRequest, NextResponse } from 'next/server';
import {
  agenticLegalResearchOrchestrator,
  getLegalCorpusCoverageDiagnostics,
  classifyAndRouteLegalQuery,
  buildStructuredResearchPlan,
  SPECIALIST_WORKER_PROFILES,
  type RequestedResearchModeInput,
  type DeliverableOutputFormat,
} from '@/core/agentic-rag/agentic-legal-research-engine';

export const dynamic = 'force-dynamic';

/**
 * AGR-014 — REST API: POST /api/v1/legal-research
 * Starts and executes an Agentic Legal Research mission across Fast (Mode A),
 * Advanced (Mode B), or Deep Agentic (Mode C) execution pipelines.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      question?: string;
      query?: string;
      jurisdiction?: string;
      as_of_date?: string;
      research_mode?: RequestedResearchModeInput;
      mode?: RequestedResearchModeInput;
      language?: 'th' | 'en';
      output_format?: DeliverableOutputFormat;
      budget_limit_usd?: number;
      max_cost_usd?: number;
      max_iterations?: number;
      tenant_id?: string;
      user_id?: string;
      requested_tenant_document_scope?: string;
      preview_plan_only?: boolean;
    };

    const questionText = (body.question || body.query || '').trim();
    if (!questionText) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: `question` or `query` (string).',
          prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-014)',
        },
        { status: 400 }
      );
    }

    const reqMode = (body.research_mode || body.mode || 'auto') as RequestedResearchModeInput;
    const asOfDate = body.as_of_date || '2026-10-21';
    const budgetUsd = body.budget_limit_usd ?? body.max_cost_usd ?? 2.0;

    if (body.preview_plan_only) {
      const routerDecision = classifyAndRouteLegalQuery({
        question: questionText,
        requested_mode: reqMode,
        as_of_date: asOfDate,
        budget_limit_usd: budgetUsd,
      });
      const plan = buildStructuredResearchPlan({
        mission_id: `preview.${Date.now()}`,
        question: questionText,
        jurisdiction: body.jurisdiction || 'TH',
        as_of_date: asOfDate,
        router_decision: routerDecision,
        max_iterations: body.max_iterations,
        budget_limit_usd: budgetUsd,
      });
      return NextResponse.json({
        success: true,
        prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-001, AGR-003)',
        router_decision: routerDecision,
        research_plan: plan,
      });
    }

    const mission = agenticLegalResearchOrchestrator.executeResearchMission({
      question: questionText,
      jurisdiction: body.jurisdiction || 'TH',
      as_of_date: asOfDate,
      research_mode: reqMode,
      language: body.language || 'th',
      output_format: body.output_format || 'structured_report',
      budget_limit_usd: budgetUsd,
      max_iterations: body.max_iterations,
      tenant_id: body.tenant_id || 'PUBLIC',
      user_id: body.user_id,
      requested_tenant_document_scope: body.requested_tenant_document_scope,
    });

    return NextResponse.json({
      success: true,
      prd_reference: 'REG24-PRD-AGENTRAG-001',
      mission_id: mission.mission_id,
      status: mission.status,
      mode: mission.router_decision.selected_mode,
      mission,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute legal research mission.',
      },
      { status: 403 }
    );
  }
}

/**
 * AGR-014 / AGR-018 / AGR-019 — GET /api/v1/legal-research
 * Returns recent missions (tenant-isolated if `tenant_id` is passed), specialist worker profiles,
 * corpus coverage diagnostics (`AGR-018`), and optional mandatory acceptance test suite (`AGR-019`).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenant_id') || 'PUBLIC';
    const runAcceptance = searchParams.get('run_acceptance') === 'true';

    const missions = agenticLegalResearchOrchestrator.listMissions(tenantId).map((m) => ({
      mission_id: m.mission_id,
      status: m.status,
      question: m.question,
      selected_mode: m.router_decision.selected_mode,
      created_at: m.created_at,
      completed_at: m.completed_at,
      evidence_count: m.evidence.length,
      estimated_cost_usd: m.cost_ledger.total_cost_usd,
      tenant_id: m.tenant_id,
    }));

    const coverageDiagnostics = getLegalCorpusCoverageDiagnostics();
    const acceptanceReport = runAcceptance
      ? agenticLegalResearchOrchestrator.runMandatoryAcceptanceSuite()
      : undefined;

    return NextResponse.json({
      success: true,
      prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-001..AGR-019)',
      specialist_workers: SPECIALIST_WORKER_PROFILES,
      corpus_coverage_diagnostics: coverageDiagnostics,
      recent_missions: missions,
      ...(acceptanceReport ? { acceptance_suite_report: acceptanceReport } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to inspect legal research engine.',
      },
      { status: 500 }
    );
  }
}
