import { NextResponse } from "next/server";
import {
  exportTraceableAnswer,
  reopenSavedTraceableAnswer,
  type SupportedExportFormat,
} from "../../../../../../../core/knowledge/claim-traceability-engine";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../../../core/knowledge/http-auth";
import { getDefaultKnowledgeStore } from "../../../../../../../core/knowledge/store";
import { enforceTrialAccessAndRateLimit } from "../../../../../../../core/knowledge/trial-gate";
import type { TraceableAnswerEnvelope } from "../../../../../../../core/knowledge/citation-contracts";

function resolvePublicOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    return u.origin;
  } catch {
    return "https://reg24.th";
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "citation_open");
    const url = new URL(req.url);
    const fmtRaw = (url.searchParams.get("format") || "markdown").toLowerCase();
    const format: SupportedExportFormat =
      fmtRaw === "pdf" || fmtRaw === "pdf_html"
        ? "pdf_html"
        : fmtRaw === "word" || fmtRaw === "doc" || fmtRaw === "docx" || fmtRaw === "word_doc"
          ? "word_doc"
          : fmtRaw === "json"
            ? "json"
            : "markdown";

    const store = getDefaultKnowledgeStore();
    const reopened = reopenSavedTraceableAnswer(store, decodeURIComponent(id), actor);
    if (!reopened.found || !reopened.answer) {
      return NextResponse.json(
        { ok: false, error: reopened.error_th || "Saved answer not found or restricted" },
        { status: reopened.http_status, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const exported = exportTraceableAnswer(store, {
      answer: reopened.answer,
      format,
      actor,
      public_base_url: resolvePublicOrigin(req),
    });

    if (!exported.allowed) {
      return NextResponse.json(
        { ok: false, error: exported.error_th || "Export blocked by publication gate" },
        { status: exported.http_status, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    return new Response(exported.content, {
      status: 200,
      headers: {
        "Content-Type": exported.mime_type,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params;
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "citation_open");
    const body = (await req.json().catch(() => ({}))) as {
      traceable_answer?: TraceableAnswerEnvelope;
      format?: SupportedExportFormat;
    };

    if (!body.traceable_answer) {
      throw new Error("INVALID_EXPORT_400: traceable_answer is required.");
    }

    const store = getDefaultKnowledgeStore();
    const exported = exportTraceableAnswer(store, {
      answer: body.traceable_answer,
      format: body.format || "markdown",
      actor,
      public_base_url: resolvePublicOrigin(req),
    });

    if (!exported.allowed) {
      return NextResponse.json(
        { ok: false, error: exported.error_th || "Export blocked by publication gate" },
        { status: exported.http_status, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        filename: exported.filename,
        mime_type: exported.mime_type,
        content: exported.content,
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
