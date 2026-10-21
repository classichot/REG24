import { NextRequest, NextResponse } from 'next/server';
import { agenticLegalResearchOrchestrator } from '@/core/agentic-rag/agentic-legal-research-engine';

export const dynamic = 'force-dynamic';

/**
 * AGR-014 — GET /api/v1/legal-research/{mission_id}
 * Retrieves the complete mission state, routing decision, structured plan,
 * 14-section legal research deliverable, citation verification, and cost telemetry.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ mission_id: string }> }
) {
  try {
    const { mission_id } = await context.params;
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenant_id') || 'PUBLIC';

    const mission = agenticLegalResearchOrchestrator.getMission(mission_id, tenantId);
    if (!mission) {
      return NextResponse.json(
        {
          success: false,
          error: `Legal research mission '${mission_id}' not found.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-010, AGR-014)',
      mission,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unauthorized tenant access.',
      },
      { status: 403 }
    );
  }
}
