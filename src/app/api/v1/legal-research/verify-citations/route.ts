import { NextRequest, NextResponse } from 'next/server';
import {
  verifyLegalCitationsAndClaims,
  agenticLegalResearchOrchestrator,
  type LegalSourceProvenanceItem,
} from '@/core/agentic-rag/agentic-legal-research-engine';

export const dynamic = 'force-dynamic';

/**
 * AGR-008 & AGR-014 — POST /api/v1/legal-research/verify-citations
 * Runs the mandatory 10-point citation and legal claim verification gate before publication.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      citations_to_verify?: Array<{
        citation_text: string;
        asserted_proposition?: string;
        as_of_date?: string;
      }>;
      claims?: Array<{ statement?: string; citation_text?: string }>;
      mission_id?: string;
      evidence_pool?: LegalSourceProvenanceItem[];
      as_of_date?: string;
      tenant_id?: string;
    };

    const rawCitations =
      body.citations_to_verify ||
      (body.claims || []).map((c) => ({
        citation_text: c.citation_text || c.statement || '',
        asserted_proposition: c.statement,
        as_of_date: body.as_of_date,
      }));

    if (!Array.isArray(rawCitations) || rawCitations.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required non-empty array: `citations_to_verify` or `claims`.',
          prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-008, AGR-014)',
        },
        { status: 400 }
      );
    }

    let evidencePool: LegalSourceProvenanceItem[] = body.evidence_pool || [];
    if (body.mission_id && evidencePool.length === 0) {
      const mission = agenticLegalResearchOrchestrator.getMission(
        body.mission_id,
        body.tenant_id || 'PUBLIC'
      );
      if (mission) {
        evidencePool = mission.evidence;
      }
    }

    const verification = verifyLegalCitationsAndClaims({
      citations_to_verify: rawCitations,
      evidence_pool: evidencePool,
    });

    return NextResponse.json({
      success: true,
      prd_reference: 'REG24-PRD-AGENTRAG-001 (AGR-008, AGR-014)',
      verification,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to verify legal citations.',
      },
      { status: 500 }
    );
  }
}
