import { NextResponse } from "next/server";
import {
  recordTechnicalOrLegalAttestation,
  recordUatDecision,
} from "../../../../../../../core/knowledge/releases";
import { getDefaultKnowledgeStore } from "../../../../../../../core/knowledge/store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../../../core/knowledge/http-auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = resolveServerActor(req, { requireCsrfForMutation: true });
    const body = (await req.json().catch(() => ({}))) as {
      manifest_hash?: string;
      expected_revision?: number;
      decision?: "UAT_PASS" | "UAT_PASS_WITH_DECLARED_GAPS" | "UAT_FAIL";
      declared_gaps_accepted?: string[];
      comments?: string;
      case_decisions?: Array<{
        case_id: string;
        decision: "PASS" | "FAIL";
        comment: string;
      }>;
      custom_owner_questions?: Array<{
        question_id: string;
        question: string;
        applicable_date?: string | null;
        trace_id?: string | null;
        decision: "PASS" | "FAIL";
        comment: string;
      }>;
      attestation_only?: boolean;
    };

    if (!body.manifest_hash) {
      throw new Error("MISSING_MANIFEST_HASH_400: manifest_hash is required.");
    }

    const store = getDefaultKnowledgeStore();

    if (body.attestation_only) {
      const acc = recordTechnicalOrLegalAttestation(store, {
        release_id: id,
        manifest_hash: body.manifest_hash,
        expected_revision: body.expected_revision,
        actor,
        notes: body.comments || "Attested via Knowledge Release API",
      });
      return NextResponse.json(
        {
          ok: true,
          acceptance: acc,
          release_state: store.getState().releases[id]?.state,
          storage_topology: store.getStorageTopology(),
        },
        { status: 200 }
      );
    }

    if (!body.decision || typeof body.expected_revision !== "number") {
      throw new Error(
        "INVALID_UAT_DECISION_PAYLOAD_400: decision and expected_revision are required."
      );
    }

    const acc = await recordUatDecision(
      {
        release_id: id,
        manifest_hash: body.manifest_hash,
        expected_revision: body.expected_revision,
        decision: body.decision,
        declared_gaps_accepted: body.declared_gaps_accepted,
        comments: body.comments || "",
        case_decisions: body.case_decisions,
        custom_owner_questions: body.custom_owner_questions,
      },
      actor,
      { store }
    );

    return NextResponse.json(
      {
        ok: true,
        acceptance: acc,
        release_state: store.getState().releases[id]?.state,
        storage_topology: store.getStorageTopology(),
      },
      { status: 200 }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
