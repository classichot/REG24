import { NextResponse } from "next/server";
import { queryKnowledge } from "../../../../../core/knowledge/query";
import { getDefaultKnowledgeStore } from "../../../../../core/knowledge/store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";

export async function POST(req: Request) {
  try {
    // Server-supplied tenant & scope ONLY — client JSON fields (`tenant_id`, `authorized_scopes`) are ignored (SH-16 / AT08)
    const actor = resolveServerActor(req);
    const body = (await req.json().catch(() => ({}))) as {
      question?: string;
      release_id?: string;
      applicable_date?: string | null;
      mode?: "standard" | "exact_lookup" | "comparison";
      comparison_work_ids?: string[];
    };

    if (!body.question || typeof body.question !== "string" || !body.question.trim()) {
      throw new Error("EMPTY_QUESTION_400: question is required.");
    }

    const answer = await queryKnowledge(
      {
        question: body.question.trim(),
        release_id: body.release_id,
        applicable_date: body.applicable_date ?? null,
        mode: body.mode,
        comparison_work_ids: body.comparison_work_ids,
      },
      actor,
      { store: getDefaultKnowledgeStore() }
    );

    return NextResponse.json({ ok: true, answer }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
