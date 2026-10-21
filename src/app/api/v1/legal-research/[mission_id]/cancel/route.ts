import { NextRequest, NextResponse } from 'next/server';
import { agenticLegalResearchOrchestrator } from '@/core/agentic-rag/agentic-legal-research-engine';

export const dynamic = 'force-dynamic';

/**
 * AGR-002 & AGR-014 — POST /api/v1/legal-research/{mission_id}/cancel
 * Cancels an active or completed mission and records a cancellation trace checkpoint.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ mission_id: string }> }
) {
  const { mission_id } = await context.params;
  let tenantId: string | undefined;
  try {
    const body = await request.json();
    tenantId = body?.tenant_id;
  } catch {
    // Optional JSON body
  }

  try {
    const mission = agenticLegalResearchOrchestrator.cancelMission(
      mission_id,
      tenantId || 'PUBLIC'
    );
    if (!mission) {
      return NextResponse.json(
        {
          success: false,
          error: `Legal research mission '${mission_id}' not found or not accessible for this tenant.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-002, AGR-014)',
      mission_id: mission.mission_id,
      status: mission.status,
      trace: mission.trace,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Tenant isolation error.',
      },
      { status: 403 }
    );
  }
}
