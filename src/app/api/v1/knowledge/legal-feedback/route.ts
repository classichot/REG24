import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NextResponse } from "next/server";
import { sha256Bytes } from "../../../../../core/knowledge/identity";
import {
  listLegalReviewFeedbackFromPostgres,
  saveLegalReviewFeedbackToPostgres,
} from "../../../../../core/knowledge/citation-postgres-store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";
import { enforceTrialAccessAndRateLimit } from "../../../../../core/knowledge/trial-gate";
import type {
  LegalReviewFeedbackRecord,
  LegalReviewVerdict,
} from "../../../../../core/knowledge/citation-contracts";

const VALID_VERDICTS = new Set<LegalReviewVerdict>([
  "PASS_SUPPORTED",
  "FAIL_UNSUPPORTED_OR_WEAK_EVIDENCE",
  "FAIL_WRONG_LAW_OR_VERSION",
  "NEEDS_REFINEMENT",
]);

function getLocalFeedbackFallbackPath(): string {
  const dir = path.join(os.tmpdir(), "reg24-citation-overlay");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "legal-review-feedback.json");
}

function readLocalFeedbackFallback(): LegalReviewFeedbackRecord[] {
  const p = getLocalFeedbackFallbackPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as LegalReviewFeedbackRecord[];
  } catch {
    return [];
  }
}

function appendLocalFeedbackFallback(rec: LegalReviewFeedbackRecord): void {
  const existing = readLocalFeedbackFallback().filter((r) => r.feedback_id !== rec.feedback_id);
  existing.unshift(rec);
  fs.writeFileSync(getLocalFeedbackFallbackPath(), JSON.stringify(existing, null, 2), "utf8");
}

export async function GET(req: Request) {
  try {
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "citation_open");

    const pgItems = await listLegalReviewFeedbackFromPostgres(100);
    if (pgItems !== null) {
      return NextResponse.json({
        ok: true,
        storage_backend: "neon_postgres",
        feedback: pgItems,
      });
    }

    return NextResponse.json({
      ok: true,
      storage_backend: "local_fallback",
      feedback: readLocalFeedbackFallback(),
    });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "query");

    const body = (await req.json().catch(() => ({}))) as {
      scenario_id?: string | null;
      question_text?: string;
      as_of_date?: string | null;
      answer_revision_id?: string | null;
      answer_status?: string;
      reviewer_name?: string;
      verdict?: LegalReviewVerdict;
      checked_original_source?: boolean;
      comments_th?: string;
      cited_evidence_ids?: string[];
    };

    const questionText = (body.question_text || "").trim();
    const reviewerName = (body.reviewer_name || "").trim();
    const verdict = body.verdict as LegalReviewVerdict;
    if (!questionText || !reviewerName || !VALID_VERDICTS.has(verdict)) {
      throw new Error(
        "INVALID_FEEDBACK_400: question_text, reviewer_name, and valid verdict are required."
      );
    }

    const answerStatus = (body.answer_status || "UNKNOWN").trim();
    const citedEvidenceIds = Array.isArray(body.cited_evidence_ids)
      ? body.cited_evidence_ids.filter(Boolean)
      : [];
    const checkedSource = Boolean(body.checked_original_source);

    // Product Owner Gate: "A plausible conclusion without valid supporting evidence should not count as a pass."
    if (verdict === "PASS_SUPPORTED") {
      if (!checkedSource) {
        throw new Error(
          "PASS_REQUIRES_SOURCE_INSPECTION_422: กรุณายืนยันการตรวจสอบแหล่งอ้างอิงต้นฉบับก่อนบันทึกผล PASS (A plausible conclusion without source verification cannot count as a pass)."
        );
      }
      const isPositiveConclusionStatus =
        answerStatus === "ANSWERED" ||
        answerStatus === "CONDITIONAL" ||
        answerStatus === "complete" ||
        answerStatus === "partial";
      if (isPositiveConclusionStatus && citedEvidenceIds.length === 0) {
        throw new Error(
          "UNSUPPORTED_CONCLUSION_CANNOT_PASS_422: คำตอบที่สรุปข้อกฎหมายโดยไม่มีรหัสหลักฐานอ้างอิงที่ผ่านการยืนยัน (0 supporting evidence IDs) ไม่สามารถนับเป็น PASS ได้ตามเกณฑ์ตรวจรับทางกฎหมาย"
        );
      }
    }

    const recordedAt = new Date().toISOString();
    const envScope =
      (process.env.REG24_TRIAL_ENV_SCOPE || "staging").toLowerCase() === "trial"
        ? ("trial" as const)
        : ("staging" as const);

    const record: LegalReviewFeedbackRecord = {
      feedback_id: `lfb.${sha256Bytes(`${reviewerName}|${questionText}|${recordedAt}`).slice(0, 14)}`,
      scenario_id: body.scenario_id || null,
      question_text: questionText,
      as_of_date: body.as_of_date || null,
      answer_revision_id: body.answer_revision_id || null,
      answer_status: answerStatus,
      reviewer_name: reviewerName,
      reviewer_actor_id: actor.actor_id,
      verdict,
      checked_original_source: checkedSource,
      comments_th: (body.comments_th || "").trim(),
      cited_evidence_ids: citedEvidenceIds,
      environment_scope: envScope,
      recorded_at: recordedAt,
    };

    const pgSaved = await saveLegalReviewFeedbackToPostgres(record);
    appendLocalFeedbackFallback(record);

    return NextResponse.json({
      ok: true,
      persisted_postgres: pgSaved.persisted_postgres,
      feedback: record,
    });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
