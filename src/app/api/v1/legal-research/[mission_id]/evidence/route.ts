import { NextRequest, NextResponse } from 'next/server';
import { agenticLegalResearchOrchestrator } from '@/core/agentic-rag/agentic-legal-research-engine';

export const dynamic = 'force-dynamic';

/**
 * AGR-009 & AGR-014 — GET /api/v1/legal-research/{mission_id}/evidence
 * Returns all normalized legal provenance evidence items (AGR-009 schema) and GraphRAG traversals.
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
      prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-009, AGR-014)',
      mission_id: mission.mission_id,
      as_of_date: mission.as_of_date,
      evidence_count: mission.evidence.length,
      evidence: mission.evidence,
      graph_traversal_paths: mission.trace.graph_traversal_paths,
      evidence_evaluation_rounds: mission.trace.evidence_evaluation_rounds,
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
