"use client";

import React, { useCallback, useEffect, useState } from "react";
import { OfficialCitationTraceabilityPanel } from "@/components/OfficialCitationTraceabilityPanel";
import {
  CHALLENGING_THAI_TAX_SCENARIOS,
  type ChallengingScenarioCategory,
  type ChallengingTaxScenario,
} from "@/core/knowledge/challenging-tax-scenarios";
import type {
  LegalReviewFeedbackRecord,
  LegalReviewVerdict,
  TraceableAnswerEnvelope,
} from "@/core/knowledge/citation-contracts";
import type { ConversationTurnInput, GroundedAnswer } from "@/core/knowledge/contracts";

const CATEGORY_FILTERS: Array<{ id: "all" | ChallengingScenarioCategory; labelTh: string }> = [
  { id: "all", labelTh: "ทั้งหมด (16 โจทย์ซับซ้อนและคำถามใหม่)" },
  { id: "multi_step", labelTh: "วิเคราะห์หลายขั้นตอน" },
  { id: "exceptions", labelTh: "ข้อยกเว้นกฎหมาย" },
  { id: "changing_facts", labelTh: "ข้อเท็จจริงเปลี่ยน" },
  { id: "historical_law", labelTh: "กฎหมายย้อนหลัง/เฉพาะปี/เฉพาะเดือน" },
  { id: "missing_information", labelTh: "ข้อมูลชี้ขาดไม่ครบ" },
  { id: "follow_up_chain", labelTh: "คำถามต่อเนื่องหลายรอบ" },
  { id: "verified_attachment", labelTh: "แนบกฎหมายทางการ" },
  { id: "out_of_scope", labelTh: "นอกขอบเขต/เลขที่ไม่มีจริง" },
];

interface SpotcheckCaseItem {
  spotcheck_id: string;
  stratum: string;
  question: string;
  mode: "standard" | "exact_lookup" | "comparison";
  applicable_date: string | null;
  legal_check_focus: string;
  baseline_observed_status: string;
}

export default function LegalTeamReviewStudioPage() {
  const [inviteCode, setInviteCode] = useState<string>("");
  const [reviewerName, setReviewerName] = useState<string>("");
  const [reviewModeTab, setReviewModeTab] = useState<"challenging" | "pack30" | "unseen">(
    "pack30"
  );
  const [spotcheckCases, setSpotcheckCases] = useState<SpotcheckCaseItem[]>([]);
  const [activeSpotcheckId, setActiveSpotcheckId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | ChallengingScenarioCategory>("all");
  const [activeScenario, setActiveScenario] = useState<ChallengingTaxScenario | null>(null);

  // Query & Multi-turn conversation state — start clean (NEVER pre-seed a stale scenario or date like 2025-06-15!)
  const [question, setQuestion] = useState<string>("");
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [asOfDateSetByPreset, setAsOfDateSetByPreset] = useState<boolean>(false);
  const [queryMode, setQueryMode] = useState<"standard" | "exact_lookup" | "comparison">("standard");
  const [answerGenerationMode, setAnswerGenerationMode] = useState<
    "llm_grounded" | "baseline_deterministic"
  >("llm_grounded");
  const createFreshConversationId = () =>
    `conv.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;

  const [conversationId, setConversationId] = useState<string>(() =>
    `conv.init.${Math.random().toString(36).slice(2, 8)}`
  );
  const [conversationHistory, setConversationHistory] = useState<ConversationTurnInput[]>([]);
  const [attachedDocIds, setAttachedDocIds] = useState<string[]>([]);
  const [attachmentSummary, setAttachmentSummary] = useState<string | null>(null);

  // CW2 Reopen Saved Revision State (works immediately on fresh page load / refresh without running a new query!)
  const [reopenRevInput, setReopenRevInput] = useState<string>("");
  const [reopenBusy, setReopenBusy] = useState<boolean>(false);

  // Official Law Attachment Form State
  const [showAttachmentForm, setShowAttachmentForm] = useState<boolean>(false);
  const [attNativeId, setAttNativeId] = useState<string>("");
  const [attTitleTh, setAttTitleTh] = useState<string>("");
  const [attOriginUrl, setAttOriginUrl] = useState<string>("");
  const [attGazetteRef, setAttGazetteRef] = useState<string>("");
  const [attEffectiveFrom, setAttEffectiveFrom] = useState<string>("");
  const [attSectionLabel, setAttSectionLabel] = useState<string>("");
  const [attPageNum, setAttPageNum] = useState<string>("1");
  const [attText, setAttText] = useState<string>("");
  const [attBusy, setAttBusy] = useState<boolean>(false);

  // Live Answer & Revision State
  const [queryBusy, setQueryBusy] = useState<boolean>(false);
  const [answerResult, setAnswerResult] = useState<GroundedAnswer | null>(null);
  const [traceableEnvelope, setTraceableEnvelope] = useState<TraceableAnswerEnvelope | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    kind: "info" | "ok" | "err";
    text: string;
  } | null>(null);

  // Feedback Recorder State
  const [verdict, setVerdict] = useState<LegalReviewVerdict>("PASS_SUPPORTED");
  const [checkedOriginalSource, setCheckedOriginalSource] = useState<boolean>(false);
  const [commentsTh, setCommentsTh] = useState<string>("");
  const [feedbackBusy, setFeedbackBusy] = useState<boolean>(false);
  const [feedbackList, setFeedbackList] = useState<LegalReviewFeedbackRecord[]>([]);
  const [feedbackBackend, setFeedbackBackend] = useState<string>("loading");
  const [envInfo, setEnvInfo] = useState<{
    environment_scope: string;
    git_branch: string;
    git_commit_sha: string;
    shared_neon_postgres_connected: boolean;
    release_id: string;
    manifest_id: string | null;
    manifest_hash: string | null;
    eligible_official_documents: number;
    eligible_evidence_passages: number;
  } | null>(null);

  const buildHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (inviteCode.trim()) {
      h["x-reg24-trial-invite"] = inviteCode.trim();
    }
    if (reviewerName.trim()) {
      h["x-reg24-actor-id"] = `${reviewerName.trim().replace(/\s+/g, ".").toLowerCase()}@7ladvisory.review`;
    }
    return h;
  }, [inviteCode, reviewerName]);

  const loadFeedbackHistory = useCallback(async () => {
    try {
      const [fbRes, envRes, packRes] = await Promise.all([
        fetch("/api/v1/knowledge/legal-feedback", {
          method: "GET",
          headers: buildHeaders(),
        }),
        fetch("/api/v1/knowledge/environment", {
          method: "GET",
          headers: buildHeaders(),
        }),
        fetch("/api/v1/knowledge/legal-spotcheck-cases", {
          method: "GET",
          headers: buildHeaders(),
        }),
      ]);
      const fbJson = await fbRes.json();
      if (fbRes.ok && fbJson.ok) {
        setFeedbackList(fbJson.feedback || []);
        setFeedbackBackend(fbJson.storage_backend || "unknown");
      }
      const envJson = await envRes.json();
      if (envRes.ok && envJson.ok) {
        setEnvInfo({
          environment_scope: envJson.environment.environment_scope,
          git_branch: envJson.environment.git_branch,
          git_commit_sha: envJson.environment.git_commit_sha,
          shared_neon_postgres_connected: envJson.environment.shared_neon_postgres_connected,
          release_id: envJson.data_version.release_id,
          manifest_id: envJson.data_version.manifest_id,
          manifest_hash: envJson.data_version.manifest_hash,
          eligible_official_documents: envJson.data_version.eligible_official_documents,
          eligible_evidence_passages: envJson.data_version.eligible_evidence_passages,
        });
      }
      const packJson = await packRes.json();
      if (packRes.ok && packJson.ok && Array.isArray(packJson.cases)) {
        setSpotcheckCases(packJson.cases);
      }
    } catch {
      // Non-fatal on initial load
    }
  }, [buildHeaders]);

  const buildGroundedAnswerFromEnvelope = useCallback(
    (env: TraceableAnswerEnvelope): GroundedAnswer => {
      const seenEv = new Set<string>();
      const evidenceCards: GroundedAnswer["evidence"] = [];
      for (const clm of env.claims) {
        for (const ref of clm.evidence_references) {
          if (seenEv.has(ref.evidence_id)) continue;
          seenEv.add(ref.evidence_id);
          evidenceCards.push({
            passage_id: ref.evidence_id,
            work_id: ref.doc_id,
            version_id: ref.version_id,
            official_identifier: ref.citation_label_th,
            title_th: ref.citation_label_th,
            authority_type:
              ref.source_family === "revenue_department_ruling"
                ? "TaxRuling"
                : ref.source_family === "supreme_court_decision"
                  ? "CourtDecision"
                  : ref.source_family === "council_of_state_opinion"
                    ? "CouncilOfStateOpinion"
                    : "Statute",
            authenticity_status: "verified_corpus_mirror",
            is_derivative: false,
            statement_role: "statutory_text",
            issue_or_effective_date: ref.date_relied_on,
            raw_date_text: ref.date_relied_on,
            exact_excerpt: ref.locator.human_pinpoint_th,
            locator: {
              kind: ref.locator.physical_page_start !== null ? "pdf_page" : "html_structural",
              artifact_id: ref.version_id,
              origin_uri: ref.official_url_with_anchor || ref.official_url,
            },
            related_provisions: [],
          });
        }
      }
      return {
        release_id: env.verifier_metadata.release_id,
        knowledge_snapshot_at: env.generated_at,
        status:
          env.status === "complete"
            ? "ANSWERED"
            : env.status === "partial"
              ? "CONDITIONAL"
              : "INSUFFICIENT_EVIDENCE",
        answer: env.rendered_answer_th,
        claims: env.claims.map((c) => ({
          claim_id: c.claim_id,
          statement: c.text,
          claim_type:
            c.claim_type === "interpretation"
              ? ("qualified_legal_synthesis" as const)
              : ("direct_source_statement" as const),
          statement_role: "statutory_text" as const,
          supporting_passage_ids: c.evidence_references.map((r) => r.evidence_id),
          applicable_version_id: c.evidence_references[0]?.version_id ?? null,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result:
            c.verification_decision === "supported"
              ? ("VERIFIED" as const)
              : ("UNSUPPORTED" as const),
          bound_calculation: c.bound_calculation ?? null,
        })),
        evidence: evidenceCards,
        assumptions: env.assumptions,
        clarification_questions: [],
        coverage_warnings: [],
        applicable_date: env.as_of_date,
        model_policy_version:
          env.execution_provenance?.model_policy_version || env.verifier_metadata.verifier_version,
        trace_id: env.answer_revision,
        latency_ms: 0,
        execution_provenance: env.execution_provenance ?? undefined,
        traceable_answer: env,
      };
    },
    []
  );

  const reopenSavedRevisionById = useCallback(
    async (targetRevisionId?: string) => {
      const target = (targetRevisionId ?? reopenRevInput).trim();
      if (!target) {
        setStatusBanner({
          kind: "err",
          text: "กรุณาระบุรหัสรุ่นคำตอบ (เช่น ans.trc.xxxxxxxxxxxxxx.r1) ก่อนกดเปิด",
        });
        return;
      }
      setReopenBusy(true);
      setStatusBanner(null);
      try {
        const requireDbQuery = envInfo?.shared_neon_postgres_connected ? "?require_db=1" : "";
        const res = await fetch(
          `/api/v1/knowledge/answers/${encodeURIComponent(target)}${requireDbQuery}`,
          {
            method: "GET",
            headers: buildHeaders(),
          }
        );
        const json = await res.json();
        if (!res.ok || !json.ok || !json.answer) {
          setStatusBanner({
            kind: "err",
            text: json.error || `ไม่พบรุ่นคำตอบ ${target} (HTTP ${res.status})`,
          });
          return;
        }
        const env: TraceableAnswerEnvelope = json.answer;
        setTraceableEnvelope(env);
        setAnswerResult(buildGroundedAnswerFromEnvelope(env));
        setQuestion(json.question_text || "");
        setAsOfDate(env.as_of_date || "");
        setAsOfDateSetByPreset(false);
        setActiveScenario(null);
        setActiveSpotcheckId(null);
        setReopenRevInput(env.answer_revision);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("rev", env.answer_revision);
          window.history.replaceState({}, "", url.toString());
        }
        setStatusBanner({
          kind: "ok",
          text: `เปิดรุ่นคำตอบที่บันทึกไว้สำเร็จโดยไม่สร้างคำตอบใหม่: ${env.answer_revision} (พร้อมบันทึก/ตรวจทานผลการประเมินด้านล่าง)`,
        });
      } catch (err) {
        setStatusBanner({
          kind: "err",
          text: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการเปิดรุ่นคำตอบย้อนหลัง",
        });
      } finally {
        setReopenBusy(false);
      }
    },
    [buildHeaders, buildGroundedAnswerFromEnvelope, reopenRevInput]
  );

  useEffect(() => {
    void loadFeedbackHistory();
    if (typeof window !== "undefined") {
      const revFromUrl = new URLSearchParams(window.location.search).get("rev");
      if (revFromUrl && revFromUrl.trim()) {
        setReopenRevInput(revFromUrl.trim());
        void reopenSavedRevisionById(revFromUrl.trim());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectScenario = (sc: ChallengingTaxScenario) => {
    setReviewModeTab("challenging");
    setActiveSpotcheckId(null);
    setActiveScenario(sc);
    setQuestion(sc.question_th);
    setAsOfDate(sc.as_of_date || "");
    setAsOfDateSetByPreset(Boolean(sc.as_of_date));
    setQueryMode(sc.mode || "standard");
    setConversationId(createFreshConversationId());
    setConversationHistory([]);
    setAttachedDocIds([]);
    setAttachmentSummary(null);
    setAnswerResult(null);
    setTraceableEnvelope(null);
    setCheckedOriginalSource(false);
    setCommentsTh("");
    setStatusBanner(null);

    if (sc.preset_attachment) {
      setShowAttachmentForm(true);
      setAttNativeId(sc.preset_attachment.source_native_id);
      setAttTitleTh(sc.preset_attachment.original_title_th);
      setAttOriginUrl(sc.preset_attachment.official_origin_url);
      setAttGazetteRef(sc.preset_attachment.royal_gazette_ref);
      setAttEffectiveFrom(sc.preset_attachment.effective_from);
      setAttSectionLabel(sc.preset_attachment.section_label);
      setAttPageNum(String(sc.preset_attachment.physical_page_one_based));
      setAttText(sc.preset_attachment.attachment_text);
    } else {
      setShowAttachmentForm(false);
    }
  };

  const selectSpotcheckCase = (sc: SpotcheckCaseItem) => {
    setReviewModeTab("pack30");
    setActiveSpotcheckId(sc.spotcheck_id);
    setActiveScenario(null);
    setQuestion(sc.question);
    setAsOfDate(sc.applicable_date || "");
    setAsOfDateSetByPreset(Boolean(sc.applicable_date));
    setQueryMode(sc.mode || "standard");
    setConversationId(createFreshConversationId());
    setConversationHistory([]);
    setAttachedDocIds([]);
    setAttachmentSummary(null);
    setShowAttachmentForm(false);
    setAnswerResult(null);
    setTraceableEnvelope(null);
    setCheckedOriginalSource(false);
    setCommentsTh("");
    setStatusBanner(null);
  };

  const startFreeFormUnseenQuestion = () => {
    setReviewModeTab("unseen");
    setActiveSpotcheckId("UNSEEN-CUSTOM");
    setActiveScenario(null);
    setQuestion("");
    setAsOfDate("");
    setAsOfDateSetByPreset(false);
    setQueryMode("standard");
    setConversationId(createFreshConversationId());
    setConversationHistory([]);
    setAttachedDocIds([]);
    setAttachmentSummary(null);
    setShowAttachmentForm(false);
    setAnswerResult(null);
    setTraceableEnvelope(null);
    setCheckedOriginalSource(false);
    setCommentsTh("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("rev");
      window.history.replaceState({}, "", url.toString());
    }
    setStatusBanner({
      kind: "info",
      text: "เริ่มเคสใหม่สะอาด (Clean Session): ล้างโจทย์ วันที่ (As-of Date) และประวัติบทสนทนาเดิมเรียบร้อยแล้ว",
    });
  };

  const handleVerifyAndAttachLaw = async () => {
    setAttBusy(true);
    setStatusBanner(null);
    try {
      const res = await fetch("/api/v1/knowledge/attachments", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          issuer_id: attOriginUrl.includes("rd.go.th")
            ? "reg.th.rd"
            : "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: attNativeId,
          original_title_th: attTitleTh,
          official_origin_url: attOriginUrl || null,
          royal_gazette_ref: attGazetteRef || null,
          effective_from: attEffectiveFrom || null,
          publication_date: attEffectiveFrom || null,
          section_label: attSectionLabel || null,
          physical_page_one_based: attPageNum ? Number(attPageNum) : 1,
          attachment_text: attText,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatusBanner({
          kind: "err",
          text: `ปฏิเสธเอกสารแนบเนื่องจากไม่ผ่านเกณฑ์ตรวจสอบต้นฉบับ/รุ่น/หน้า: ${json.error || res.status}`,
        });
        return;
      }
      setAttachedDocIds((prev) => Array.from(new Set([...prev, json.doc_id])));
      setAttachmentSummary(
        `ยืนยันเอกสารแนบทางการสำเร็จ: ${attNativeId} (doc_id: ${json.doc_id} · รุ่นมีผล: ${json.effective_from} · ตำแหน่ง: ${json.human_pinpoint_th})`
      );
      setStatusBanner({
        kind: "ok",
        text: `ยืนยันต้นฉบับ + รุ่นวันบังคับใช้ + มาตรา/หน้า สำเร็จ (${json.passage_id}) — พร้อมใช้เป็นหลักฐานในการถามคำถาม`,
      });
    } catch (err) {
      setStatusBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการยืนยันเอกสารแนบ",
      });
    } finally {
      setAttBusy(false);
    }
  };

  const runQuery = async (
    overrideQuestion?: string,
    overrideDate?: string | null,
    appendFollowUp?: boolean,
    syntheticFixture?: "RC1_REJECTED_CALC" | null
  ) => {
    const qToRun = (overrideQuestion ?? question).trim();
    if (!qToRun) return;

    // Prevent stale preset as_of_date contamination on fresh custom prompts (T03 fix):
    // If a preset seeded asOfDate and the user replaced the prompt with a different case on a New Query,
    // clear the stale preset date automatically unless manually entered!
    const presetQuestionText =
      activeScenario?.question_th ||
      spotcheckCases.find((c) => c.spotcheck_id === activeSpotcheckId)?.question ||
      null;
    const promptChangedFromPreset =
      Boolean(presetQuestionText) && qToRun !== presetQuestionText!.trim();
    const effectiveRawDate =
      overrideDate !== undefined
        ? overrideDate
        : !appendFollowUp && asOfDateSetByPreset && promptChangedFromPreset
          ? null
          : asOfDate.trim()
            ? asOfDate.trim()
            : null;
    const dateToRun = effectiveRawDate;

    setQueryBusy(true);
    setStatusBanner(null);
    setCheckedOriginalSource(false);

    // Clicking "▶ รันคำถามใหม่ (New Query)" (appendFollowUp === false) MUST ALWAYS start a fresh case with zero prior history!
    const isFollowUpCall = Boolean(appendFollowUp);
    const historyForCall = isFollowUpCall ? conversationHistory : [];
    const activeConvId = isFollowUpCall ? conversationId : createFreshConversationId();
    if (!isFollowUpCall) {
      setConversationId(activeConvId);
      if (promptChangedFromPreset) {
        setActiveScenario(null);
        setActiveSpotcheckId("UNSEEN-CUSTOM");
        if (asOfDateSetByPreset) {
          setAsOfDate("");
          setAsOfDateSetByPreset(false);
        }
      }
    }
    const priorSavedTurn = isFollowUpCall
      ? [...historyForCall]
          .reverse()
          .find((t) => t.role === "assistant" && Boolean(t.saved_answer_revision))
      : undefined;

    try {
      const res = await fetch("/api/v1/knowledge/query", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          question: qToRun,
          applicable_date: dateToRun,
          mode: queryMode,
          channel: "chat",
          persist_answer: true,
          conversation_id: activeConvId,
          prior_saved_answer_revision: priorSavedTurn?.saved_answer_revision ?? null,
          conversation_history: historyForCall,
          attachment_doc_ids: attachedDocIds,
          qa_synthetic_fixture: syntheticFixture ?? null,
          answer_generation_mode: answerGenerationMode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatusBanner({
          kind: "err",
          text: `ไม่สามารถประมวลผลคำถามได้ (HTTP ${res.status}): ${json.error || "Unknown error"}`,
        });
        return;
      }
      const ans: GroundedAnswer = json.answer;
      const env: TraceableAnswerEnvelope | null =
        json.traceable_answer || ans.traceable_answer || null;
      setAnswerResult(ans);
      setTraceableEnvelope(env);
      setQuestion(qToRun);
      setAsOfDate(dateToRun || "");

      const savedRev =
        ans.status !== "NEEDS_CLARIFICATION" &&
        ans.status !== "INSUFFICIENT_EVIDENCE" &&
        env &&
        (env.status === "complete" || env.status === "partial")
          ? env.answer_revision
          : null;
      const savedAnsId = savedRev && env ? env.answer_id : null;
      if (savedRev) {
        setReopenRevInput(savedRev);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("rev", savedRev);
          window.history.replaceState({}, "", url.toString());
        }
      }

      setConversationHistory([
        ...historyForCall,
        {
          role: "user",
          content: qToRun,
          applicable_date: dateToRun,
          conversation_id: activeConvId,
        },
        {
          role: "assistant",
          content: ans.answer,
          saved_answer_id: savedAnsId,
          saved_answer_revision: savedRev,
          conversation_id: activeConvId,
        },
      ]);
    } catch (err) {
      setStatusBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์",
      });
    } finally {
      setQueryBusy(false);
    }
  };

  const submitFeedback = async () => {
    if (!reviewerName.trim()) {
      setStatusBanner({
        kind: "err",
        text: "กรุณาระบุชื่อผู้ตรวจทานทางกฎหมาย (เช่น Beer / ชื่อทนายความในทีม) ก่อนบันทึกผลการตรวจ",
      });
      return;
    }
    if (!answerResult) {
      setStatusBanner({
        kind: "err",
        text: "กรุณารันคำถามเพื่อดูคำตอบและตรวจสอบหลักฐานก่อนบันทึก Feedback",
      });
      return;
    }

    setFeedbackBusy(true);
    setStatusBanner(null);
    try {
      const citedIds =
        traceableEnvelope?.claims.flatMap((c) =>
          c.evidence_references.map((r) => r.evidence_id)
        ) ||
        answerResult.evidence.map((e) => e.passage_id) ||
        [];

      const res = await fetch("/api/v1/knowledge/legal-feedback", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          scenario_id: activeSpotcheckId || activeScenario?.scenario_id || "UNSEEN-CUSTOM",
          question_text: question,
          as_of_date: answerResult.applicable_date,
          answer_revision_id: traceableEnvelope?.answer_revision || null,
          answer_status: answerResult.status,
          reviewer_name: reviewerName.trim(),
          verdict,
          checked_original_source: checkedOriginalSource,
          comments_th: commentsTh,
          cited_evidence_ids: Array.from(new Set(citedIds)),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatusBanner({
          kind: "err",
          text: json.error || `ไม่สามารถบันทึก Feedback ได้ (HTTP ${res.status})`,
        });
        return;
      }
      setStatusBanner({
        kind: "ok",
        text: `บันทึกผลการตรวจทานของ "${reviewerName.trim()}" สำเร็จ (${json.feedback.feedback_id}${json.persisted_postgres ? " · บันทึกลงฐานข้อมูล Neon PostgreSQL ถาวรแล้ว" : ""})`,
      });
      setCommentsTh("");
      await loadFeedbackHistory();
    } catch (err) {
      setStatusBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการบันทึก Feedback",
      });
    } finally {
      setFeedbackBusy(false);
    }
  };

  const visibleScenarios =
    categoryFilter === "all"
      ? CHALLENGING_THAI_TAX_SCENARIOS
      : CHALLENGING_THAI_TAX_SCENARIOS.filter((s) => s.category === categoryFilter);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0d10",
        color: "#f3f4f6",
        fontFamily: "system-ui, -apple-system, 'Noto Sans Thai', sans-serif",
        padding: "24px clamp(16px, 3vw, 36px) 64px",
      }}
    >
      <div
        style={{
          maxWidth: "1380px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {/* Top Bar */}
        <header
          style={{
            borderBottom: "1px solid #1f2937",
            paddingBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "14px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 800,
                color: "#a3e635",
                letterSpacing: "0.06em",
              }}
            >
              REG24 · STAGING LEGAL REVIEW &amp; CHALLENGING THAI TAX WORKBENCH (BATCH 1)
            </div>
            <h1 style={{ margin: "6px 0", fontSize: "24px", fontWeight: 800 }}>
              ห้องทดสอบความถูกต้องทางกฎหมาย การอ้างอิงต้นฉบับ และบันทึกข้อเสนอแนะทีมกฎหมาย
            </h1>
            <p style={{ margin: 0, fontSize: "13px", color: "#9ca3af", maxWidth: "88ch" }}>
              เกณฑ์สำคัญ: <strong>คำตอบที่ดูสมเหตุสมผลแต่ไม่มีหลักฐานทางการที่ตรวจสอบได้จะไม่นับว่าผ่าน (Pass)</strong>{" "}
              · กรณีวันที่หรือรุ่นกฎหมายไม่ชัดเจน ระบบต้องถามข้อเท็จจริงเพิ่มเติม (
              <code>NEEDS_CLARIFICATION</code>) หรือแจ้งข้อจำกัด (<code>INSUFFICIENT_EVIDENCE</code>)
              แทนการคาดเดา
            </p>
            {envInfo ? (
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "12px",
                  color: "#cbd5e1",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                Env: <strong>{envInfo.environment_scope}</strong> · Release:{" "}
                <strong>{envInfo.release_id}</strong> ({envInfo.manifest_id || "man.B01.rc5"} ·{" "}
                {envInfo.manifest_hash ? `${envInfo.manifest_hash.slice(0, 12)}…` : "-"}) · Eligible
                Sources: <strong>{envInfo.eligible_official_documents.toLocaleString()}</strong> docs
                / <strong>{envInfo.eligible_evidence_passages.toLocaleString()}</strong> passages ·
                Commit: <strong>{envInfo.git_commit_sha.slice(0, 10)}</strong> · Neon DB:{" "}
                <strong>{envInfo.shared_neon_postgres_connected ? "connected" : "local"}</strong>
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="ชื่อผู้ตรวจทาน (เช่น Beer / ทนายความ)"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              style={{
                background: "#111827",
                color: "#f9fafb",
                border: "1px solid #374151",
                padding: "7px 10px",
                fontSize: "13px",
                minWidth: "220px",
              }}
            />
            <input
              type="password"
              placeholder="รหัสเชิญ (ถ้าเปิดโหมด Invite Gate)"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              style={{
                background: "#111827",
                color: "#f9fafb",
                border: "1px solid #374151",
                padding: "7px 10px",
                fontSize: "13px",
                width: "210px",
              }}
            />
            <a
              href="/admin/knowledge/batches?batch=B01"
              style={{
                background: "#1e293b",
                color: "#cbd5e1",
                textDecoration: "none",
                padding: "8px 12px",
                fontSize: "12px",
                border: "1px solid #334155",
              }}
            >
              เปิดหน้า UAT Console (B01) →
            </a>
          </div>
        </header>

        {statusBanner ? (
          <div
            style={{
              padding: "12px 14px",
              border: `1px solid ${
                statusBanner.kind === "err"
                  ? "#ef4444"
                  : statusBanner.kind === "ok"
                    ? "#22c55e"
                    : "#3b82f6"
              }`,
              background:
                statusBanner.kind === "err"
                  ? "#2a1215"
                  : statusBanner.kind === "ok"
                    ? "#0f291e"
                    : "#172554",
              fontSize: "13px",
            }}
          >
            {statusBanner.text}
          </div>
        ) : null}

        {/* Main 2-Column Layout: Left = Challenging Scenarios, Right = Interactive Query, Traceability & Feedback */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(310px, 390px) minmax(0, 1fr)",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* Left Column: 30-Case Batch 1 Review Pack + 16 Challenging Scenarios + Unseen Free-Form Mode */}
          <aside
            style={{
              background: "#11151c",
              border: "1px solid #242b35",
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 800 }}>
              เลือกโหมดตรวจรับทางกฎหมาย (30 เคสหลัก · โจทย์ซับซ้อน · โจทย์ใหม่)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
              <button
                type="button"
                onClick={() => setReviewModeTab("pack30")}
                style={{
                  background: reviewModeTab === "pack30" ? "#1d4ed8" : "#0b0d10",
                  color: "#f9fafb",
                  border: "1px solid #374151",
                  padding: "7px 6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                30 เคส B01 ({spotcheckCases.length || 30})
              </button>
              <button
                type="button"
                onClick={() => setReviewModeTab("challenging")}
                style={{
                  background: reviewModeTab === "challenging" ? "#1d4ed8" : "#0b0d10",
                  color: "#f9fafb",
                  border: "1px solid #374151",
                  padding: "7px 6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                โจทย์ซับซ้อน ({CHALLENGING_THAI_TAX_SCENARIOS.length})
              </button>
              <button
                type="button"
                onClick={startFreeFormUnseenQuestion}
                style={{
                  background: reviewModeTab === "unseen" ? "#15803d" : "#0b0d10",
                  color: "#f9fafb",
                  border: "1px solid #374151",
                  padding: "7px 6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                + ตั้งคำถามใหม่
              </button>
            </div>

            {reviewModeTab === "challenging" ? (
              <>
                <select
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value as "all" | ChallengingScenarioCategory)
                  }
                  style={{
                    background: "#0b0d10",
                    color: "#e5e7eb",
                    border: "1px solid #374151",
                    padding: "7px 8px",
                    fontSize: "12px",
                  }}
                >
                  {CATEGORY_FILTERS.map((cf) => (
                    <option key={cf.id} value={cf.id}>
                      {cf.labelTh}
                    </option>
                  ))}
                </select>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "72vh",
                    overflowY: "auto",
                    paddingRight: "4px",
                  }}
                >
                  {visibleScenarios.map((sc) => {
                    const isSelected = activeScenario?.scenario_id === sc.scenario_id;
                    return (
                      <button
                        key={sc.scenario_id}
                        type="button"
                        onClick={() => selectScenario(sc)}
                        style={{
                          textAlign: "left",
                          background: isSelected ? "#172554" : "#0d1117",
                          border: `1px solid ${isSelected ? "#60a5fa" : "#262d38"}`,
                          color: "#f3f4f6",
                          padding: "10px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: "11px", color: "#93c5fd", fontWeight: 700 }}>
                          {sc.scenario_id} · {sc.category_label_th}
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 700, marginTop: "3px" }}>
                          {sc.title_th}
                        </div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>
                          <strong>จุดที่ตรวจ:</strong> {sc.expected_behavior_th}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : reviewModeTab === "pack30" ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  maxHeight: "76vh",
                  overflowY: "auto",
                  paddingRight: "4px",
                }}
              >
                {spotcheckCases.map((sc) => {
                  const isSelected = activeSpotcheckId === sc.spotcheck_id;
                  const alreadyReviewed = feedbackList.some(
                    (fb) => fb.scenario_id === sc.spotcheck_id
                  );
                  return (
                    <button
                      key={sc.spotcheck_id}
                      type="button"
                      onClick={() => selectSpotcheckCase(sc)}
                      style={{
                        textAlign: "left",
                        background: isSelected ? "#172554" : "#0d1117",
                        border: `1px solid ${isSelected ? "#60a5fa" : alreadyReviewed ? "#22c55e" : "#262d38"}`,
                        color: "#f3f4f6",
                        padding: "10px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: "11px", color: "#fde047", fontWeight: 700 }}>
                        {sc.spotcheck_id} · {sc.stratum}
                        {alreadyReviewed ? " · ✓ บันทึกผลแล้ว" : ""}
                      </div>
                      <div style={{ fontSize: "12px", fontWeight: 700, marginTop: "3px" }}>
                        {sc.question}
                      </div>
                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>
                        <strong>Focus:</strong> {sc.legal_check_focus}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  background: "#0d1117",
                  border: "1px solid #15803d",
                  padding: "12px",
                  fontSize: "12px",
                  lineHeight: 1.6,
                  color: "#d1fae5",
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: "6px", color: "#86efac" }}>
                  คำแนะนำการตั้งคำถามใหม่นอกระบบ (Previously Unseen Questions)
                </div>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  <li>ทดสอบข้อเท็จจริงใหม่ที่ไม่ได้อยู่ใน 30 เคสหลัก (ทั้งภาษาไทยและภาษาอังกฤษ)</li>
                  <li>ลองถามแบบระบุเฉพาะปี (เช่น &ldquo;ปี 2561&rdquo;) หรือเฉพาะเดือน (เช่น &ldquo;ในเดือนมิถุนายน&rdquo;)</li>
                  <li>ลองถามหลายประเด็นในข้อเดียว (CIT + WHT + VAT) หรือเปลี่ยนข้อเท็จจริงในคำถามต่อเนื่อง</li>
                  <li>ตรวจต้นฉบับจากลิงก์ทางการว่าหลักฐานรองรับข้อกล่าวอ้างจริง ไม่ใช่เพียงมีชื่อเอกสารแนบ</li>
                </ul>
              </div>
            )}
          </aside>

          {/* Right Column: Reopen Saved Revision (CW2), Query Runner, Attachment Verifier, Answer & Traceability, Feedback Form */}
          <main style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* CW2: Always-visible Reopen Saved Revision Bar (works immediately on fresh page load / refresh without generating a new answer) */}
            <div
              style={{
                background: "#11151c",
                border: "1px solid #2b3544",
                padding: "10px 14px",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#93c5fd" }}>
                📂 เปิดรุ่นคำตอบที่บันทึกไว้เพื่อตรวจทาน/บันทึกผล (Reopen Saved Revision — ไม่สร้างคำตอบใหม่):
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="text"
                  value={reopenRevInput}
                  onChange={(e) => setReopenRevInput(e.target.value)}
                  placeholder="ระบุรหัสรุ่น เช่น ans.trc.xxxxxxxxxxxxxx.r1"
                  style={{
                    background: "#0b0d10",
                    color: "#f9fafb",
                    border: "1px solid #374151",
                    padding: "5px 8px",
                    fontSize: "12px",
                    minWidth: "240px",
                    fontFamily: "ui-monospace, monospace",
                  }}
                />
                <button
                  type="button"
                  disabled={reopenBusy}
                  onClick={() => void reopenSavedRevisionById()}
                  style={{
                    background: "#1d4ed8",
                    color: "#fff",
                    border: "none",
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {reopenBusy ? "กำลังเปิดรุ่นคำตอบ..." : "เปิดรุ่นคำตอบเดิม (Reopen)"}
                </button>
                <button
                  type="button"
                  onClick={startFreeFormUnseenQuestion}
                  style={{
                    background: "#1e293b",
                    color: "#e2e8f0",
                    border: "1px solid #475569",
                    padding: "6px 10px",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  🧹 ล้างโจทย์และวันที่ (New Clean Case)
                </button>
              </div>
            </div>

            {/* Scenario Context Box */}
            {activeScenario ? (
              <div
                style={{
                  background: "#111827",
                  border: "1px solid #2b3544",
                  padding: "12px 14px",
                  fontSize: "12px",
                }}
              >
                <div style={{ fontWeight: 800, color: "#fde047" }}>
                  โจทย์ปัจจุบัน: {activeScenario.scenario_id} — {activeScenario.title_th}
                </div>
                <div style={{ color: "#cbd5e1", marginTop: "4px" }}>
                  <strong>ประเด็นกฎหมายที่ทดสอบ:</strong> {activeScenario.legal_focus_th}
                </div>
                <div style={{ color: "#a3e635", marginTop: "3px" }}>
                  <strong>ผลลัพธ์ที่ถูกต้องตามเกณฑ์:</strong> {activeScenario.expected_behavior_th}
                </div>
              </div>
            ) : null}

            {/* Question & Multi-Turn Composer */}
            <div
              style={{
                background: "#11151c",
                border: "1px solid #242b35",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <label style={{ fontSize: "13px", fontWeight: 800 }}>
                  คำถามทางกฎหมายภาษีอากร (พิมพ์คำถามอิสระ หรือแก้ไขจากโจทย์ตัวอย่างได้ทันที)
                </label>
                <button
                  type="button"
                  onClick={() => setShowAttachmentForm((v) => !v)}
                  style={{
                    background: "#1e293b",
                    color: "#93c5fd",
                    border: "1px solid #334155",
                    padding: "5px 10px",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  {showAttachmentForm
                    ? "ซ่อนฟอร์มแนบกฎหมายทางการ"
                    : "+ แนบตัวบทกฎหมาย/ประกาศทางการเพื่อใช้เป็นหลักฐาน"}
                </button>
              </div>

              {/* Official Law Attachment Verification Panel */}
              {showAttachmentForm ? (
                <div
                  style={{
                    background: "#0d1117",
                    border: "1px solid #334155",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 800, color: "#93c5fd" }}>
                    แนบกฎหมายหรือประกาศทางการ (ตรวจยืนยัน 3 เงื่อนไข: แหล่งที่มาทางการ · รุ่นวันบังคับใช้ · มาตรา/เลขหน้า)
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                      gap: "8px",
                    }}
                  >
                    <input
                      value={attNativeId}
                      onChange={(e) => setAttNativeId(e.target.value)}
                      placeholder="เลขที่/ชื่อย่อ เช่น พระราชกฤษฎีกา (ฉบับที่ 779) มาตรา 4"
                      style={{
                        background: "#111827",
                        color: "#f3f4f6",
                        border: "1px solid #374151",
                        padding: "6px 8px",
                        fontSize: "12px",
                      }}
                    />
                    <input
                      value={attTitleTh}
                      onChange={(e) => setAttTitleTh(e.target.value)}
                      placeholder="ชื่อเต็มตราสารกฎหมายทางการ"
                      style={{
                        background: "#111827",
                        color: "#f3f4f6",
                        border: "1px solid #374151",
                        padding: "6px 8px",
                        fontSize: "12px",
                      }}
                    />
                    <input
                      value={attOriginUrl}
                      onChange={(e) => setAttOriginUrl(e.target.value)}
                      placeholder="URL ต้นฉบับทางการ (ratchakitcha.soc.go.th / rd.go.th)"
                      style={{
                        background: "#111827",
                        color: "#f3f4f6",
                        border: "1px solid #374151",
                        padding: "6px 8px",
                        fontSize: "12px",
                      }}
                    />
                    <input
                      value={attEffectiveFrom}
                      onChange={(e) => setAttEffectiveFrom(e.target.value)}
                      placeholder="วันเริ่มใช้บังคับ (YYYY-MM-DD)"
                      style={{
                        background: "#111827",
                        color: "#f3f4f6",
                        border: "1px solid #374151",
                        padding: "6px 8px",
                        fontSize: "12px",
                      }}
                    />
                    <input
                      value={attSectionLabel}
                      onChange={(e) => setAttSectionLabel(e.target.value)}
                      placeholder="มาตรา / ข้อ (เช่น มาตรา 4)"
                      style={{
                        background: "#111827",
                        color: "#f3f4f6",
                        border: "1px solid #374151",
                        padding: "6px 8px",
                        fontSize: "12px",
                      }}
                    />
                    <input
                      value={attPageNum}
                      onChange={(e) => setAttPageNum(e.target.value)}
                      placeholder="เลขหน้าไฟล์ PDF (เริ่มจาก 1)"
                      style={{
                        background: "#111827",
                        color: "#f3f4f6",
                        border: "1px solid #374151",
                        padding: "6px 8px",
                        fontSize: "12px",
                      }}
                    />
                  </div>
                  <textarea
                    rows={3}
                    value={attText}
                    onChange={(e) => setAttText(e.target.value)}
                    placeholder="วางข้อความตัวบทจากราชกิจจานุเบกษาหรือประกาศกรมสรรพากรตรงตามต้นฉบับ..."
                    style={{
                      background: "#111827",
                      color: "#f3f4f6",
                      border: "1px solid #374151",
                      padding: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <div>
                    <button
                      type="button"
                      disabled={attBusy}
                      onClick={() => void handleVerifyAndAttachLaw()}
                      style={{
                        background: "#2563eb",
                        color: "#fff",
                        border: "none",
                        padding: "7px 14px",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {attBusy
                        ? "กำลังตรวจสอบต้นฉบับ..."
                        : "✓ ตรวจยืนยันต้นฉบับ + รุ่น + หน้า และแนบเป็นหลักฐาน"}
                    </button>
                  </div>
                </div>
              ) : null}

              {attachmentSummary ? (
                <div
                  style={{
                    background: "#0f291e",
                    border: "1px solid #22c55e",
                    padding: "8px 10px",
                    fontSize: "12px",
                    color: "#bbf7d0",
                  }}
                >
                  📎 {attachmentSummary}
                </div>
              ) : null}

              <textarea
                rows={4}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                style={{
                  background: "#0b0d10",
                  color: "#f9fafb",
                  border: "1px solid #374151",
                  padding: "10px",
                  fontSize: "14px",
                  lineHeight: 1.55,
                }}
              />

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontSize: "12px", color: "#cbd5e1" }}>
                  วันที่กฎหมายที่ต้องการตรวจสอบ (เว้นว่างได้เพื่อทดสอบการจับวันที่จากคำถาม):{" "}
                  <input
                    type="text"
                    placeholder="YYYY-MM-DD (ถ้ามี)"
                    value={asOfDate}
                    onChange={(e) => {
                      setAsOfDate(e.target.value);
                      setAsOfDateSetByPreset(false);
                    }}
                    style={{
                      background: "#0b0d10",
                      color: "#f9fafb",
                      border: "1px solid #374151",
                      padding: "5px 8px",
                      fontSize: "12px",
                      width: "140px",
                    }}
                  />
                </label>

                <select
                  value={queryMode}
                  onChange={(e) =>
                    setQueryMode(e.target.value as "standard" | "exact_lookup" | "comparison")
                  }
                  style={{
                    background: "#0b0d10",
                    color: "#f9fafb",
                    border: "1px solid #374151",
                    padding: "6px 8px",
                    fontSize: "12px",
                  }}
                >
                  <option value="standard">โหมดวิเคราะห์ข้อกฎหมาย (Standard)</option>
                  <option value="exact_lookup">โหมดค้นหาเลขที่เอกสารตรงตัว (Exact Lookup)</option>
                  <option value="comparison">โหมดเปรียบเทียบหลายเอกสาร (Comparison)</option>
                </select>

                <select
                  value={answerGenerationMode}
                  onChange={(e) =>
                    setAnswerGenerationMode(
                      e.target.value as "llm_grounded" | "baseline_deterministic"
                    )
                  }
                  style={{
                    background: "#0b0d10",
                    color: "#93c5fd",
                    border: "1px solid #1d4ed8",
                    padding: "6px 8px",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                >
                  <option value="llm_grounded">
                    Grounded LLM — Gemini 4 Neon (Staging Flag · Zero Silent Fallback)
                  </option>
                  <option value="baseline_deterministic">
                    Baseline Deterministic (Comparison Control)
                  </option>
                </select>

                <button
                  type="button"
                  disabled={queryBusy}
                  onClick={() => void runQuery(undefined, undefined, false)}
                  style={{
                    background: "#16a34a",
                    color: "#fff",
                    border: "none",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {queryBusy ? "กำลังวิเคราะห์และตรวจสอบหลักฐาน..." : "▶ รันคำถามใหม่ (New Query)"}
                </button>

                {conversationHistory.length > 0 ? (
                  <button
                    type="button"
                    disabled={queryBusy}
                    onClick={() => void runQuery(undefined, undefined, true)}
                    style={{
                      background: "#0284c7",
                      color: "#fff",
                      border: "none",
                      padding: "8px 14px",
                      fontSize: "13px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ↪ ถามต่อเนื่องจากบทสนทนาเดิม ({conversationHistory.length / 2} รอบ)
                  </button>
                ) : null}

                {envInfo?.environment_scope === "staging" ? (
                  <button
                    type="button"
                    disabled={queryBusy}
                    onClick={() =>
                      void runQuery(
                        "บริษัท นอร์ทสตาร์ โซลูชันส์ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการที่ปรึกษาด้านระบบสารสนเทศแก่บริษัทลูกค้าในกรุงเทพมหานคร ซึ่งใช้บริการทั้งหมดในประเทศไทย โดยออกใบกำกับภาษีและได้รับชำระค่าบริการครบถ้วนในวันที่ 15 มีนาคม 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราเท่าใด และตามกฎหมายฉบับใด",
                        null,
                        false,
                        "RC1_REJECTED_CALC"
                      )
                    }
                    title="QA Staging Fixture (RC1): ส่งการคำนวณจำลองที่ไม่ผ่านการตรวจสอบหลักฐานเข้าสู่ Verifier จริง เพื่อยืนยันว่าตัวเลขและขั้นตอนที่ถูกปฏิเสธจะไม่หลุดออกใน UI, API หรือรุ่นคำตอบที่บันทึก"
                    style={{
                      background: "#4c1d95",
                      color: "#f5f3ff",
                      border: "1px solid #7c3aed",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    🧪 ทดสอบ RC1: จำลองการคำนวณที่ถูก Verifier ปฏิเสธ
                  </button>
                ) : null}
              </div>

              {/* Preset Follow-Up Turn Buttons */}
              {activeScenario?.follow_up_turns && activeScenario.follow_up_turns.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    paddingTop: "6px",
                    borderTop: "1px dashed #262f3d",
                  }}
                >
                  <span style={{ fontSize: "12px", color: "#93c5fd", alignSelf: "center" }}>
                    ทดสอบคำถามต่อเนื่อง (Follow-up):
                  </span>
                  {activeScenario.follow_up_turns.map((ft, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={queryBusy}
                      onClick={() => void runQuery(ft.question_th, ft.as_of_date ?? null, true)}
                      style={{
                        background: "#1e293b",
                        color: "#e0f2fe",
                        border: "1px solid #38bdf8",
                        padding: "5px 10px",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      {ft.turn_label_th}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Answer & Official Citation Traceability Output */}
            {answerResult ? (
              <div
                style={{
                  background: "#11151c",
                  border: "1px solid #242b35",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      fontWeight: 800,
                      background:
                        answerResult.status === "ANSWERED"
                          ? "#14532d"
                          : answerResult.status === "CONDITIONAL"
                            ? "#713f12"
                            : "#1e3a8a",
                      color: "#fff",
                    }}
                  >
                    สถานะคำตอบ: {answerResult.status}
                  </span>
                  <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                    หลักฐานที่ผูกอ้างอิง: <strong>{answerResult.evidence.length}</strong> รายการ ·
                    Trace ID: <code>{answerResult.trace_id}</code>
                    {answerResult.execution_provenance ? (
                      <>
                        {" "}
                        · Release: <code>{answerResult.execution_provenance.release_id}</code> (
                        <code>{answerResult.execution_provenance.manifest_id || "-"}</code>) · Commit:{" "}
                        <code>{answerResult.execution_provenance.git_commit_sha.slice(0, 7)}</code> ·
                        Engine: <code>{answerResult.execution_provenance.model_id}</code> ·
                        Policy: <code>{answerResult.execution_provenance.model_policy_version}</code> ·
                        CalcVerifier:{" "}
                        <code>{answerResult.execution_provenance.calculation_verifier_version}</code>
                        {answerResult.execution_provenance.provider_invocation ? (
                          <>
                            {" "}
                            · Provider:{" "}
                            <code>
                              {String(
                                (
                                  answerResult.execution_provenance.provider_invocation as Record<
                                    string,
                                    unknown
                                  >
                                ).provider || "-"
                              )}
                            </code>{" "}
                            (requested=
                            <code>
                              {String(
                                (
                                  answerResult.execution_provenance.provider_invocation as Record<
                                    string,
                                    unknown
                                  >
                                ).requested_model || "-"
                              )}
                            </code>
                            , resolved=
                            <code>
                              {String(
                                (
                                  answerResult.execution_provenance.provider_invocation as Record<
                                    string,
                                    unknown
                                  >
                                ).resolved_model || "none"
                              )}
                            </code>
                            , thinking=
                            <code>
                              {String(
                                (
                                  (
                                    answerResult.execution_provenance.provider_invocation as Record<
                                      string,
                                      unknown
                                    >
                                  ).pinned_settings as Record<string, unknown> | undefined
                                )?.thinking_level || "-"
                              )}
                            </code>
                            , failure=
                            <code>
                              {String(
                                (
                                  answerResult.execution_provenance.provider_invocation as Record<
                                    string,
                                    unknown
                                  >
                                ).failure_classification || "NONE"
                              )}
                            </code>
                            , live=
                            <code>
                              {String(
                                Boolean(
                                  (
                                    answerResult.execution_provenance.provider_invocation as Record<
                                      string,
                                      unknown
                                    >
                                  ).live_provider_called
                                )
                              )}
                            </code>
                            , tokens=
                            <code>
                              {String(
                                (
                                  answerResult.execution_provenance.provider_invocation as Record<
                                    string,
                                    unknown
                                  >
                                ).total_tokens ?? 0
                              )}
                            </code>
                            , cost=$
                            <code>
                              {String(
                                (
                                  answerResult.execution_provenance.provider_invocation as Record<
                                    string,
                                    unknown
                                  >
                                ).estimated_cost_usd ?? 0
                              )}
                            </code>
                            , latency=
                            <code>{answerResult.latency_ms}ms</code>)
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {traceableEnvelope &&
                    (traceableEnvelope.status === "complete" ||
                      traceableEnvelope.status === "partial") ? (
                      <>
                        {" "}
                        · SavedRev: <code>{traceableEnvelope.answer_revision}</code> (r
                        {traceableEnvelope.revision_number}
                        {traceableEnvelope.supersedes_answer_revision
                          ? ` ← supersedes ${traceableEnvelope.supersedes_answer_revision}`
                          : " · initial"}
                        )
                      </>
                    ) : null}
                  </span>
                </div>

                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.7,
                    fontSize: "14px",
                    background: "#0d1117",
                    padding: "14px",
                    border: "1px solid #1f2937",
                  }}
                >
                  {answerResult.answer}
                </div>

                {answerResult.clarification_questions.length > 0 ? (
                  <div
                    style={{
                      background: "#172554",
                      border: "1px solid #3b82f6",
                      padding: "10px 12px",
                      fontSize: "13px",
                    }}
                  >
                    <strong>คำถามเพื่อขอข้อเท็จจริง/วันที่เพิ่มเติมโดยไม่คาดเดา:</strong>
                    <ul style={{ margin: "6px 0 0 18px" }}>
                      {answerResult.clarification_questions.map((cq, i) => (
                        <li key={i}>{cq}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {traceableEnvelope ? (
                  <OfficialCitationTraceabilityPanel
                    envelope={traceableEnvelope}
                    questionText={question}
                    onReopenedEnvelope={(reopened: TraceableAnswerEnvelope, qText: string) => {
                      setTraceableEnvelope(reopened);
                      setAnswerResult(buildGroundedAnswerFromEnvelope(reopened));
                      setReopenRevInput(reopened.answer_revision);
                      if (qText) setQuestion(qText);
                      if (typeof window !== "undefined") {
                        const url = new URL(window.location.href);
                        url.searchParams.set("rev", reopened.answer_revision);
                        window.history.replaceState({}, "", url.toString());
                      }
                      setStatusBanner({
                        kind: "ok",
                        text: `เปิดรุ่นคำตอบที่บันทึกไว้สำเร็จ: ${reopened.answer_revision}`,
                      });
                    }}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Legal Team Feedback Form */}
            <section
              style={{
                background: "#11151c",
                border: "1px solid #334155",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 800, color: "#fde047" }}>
                บันทึกผลการตรวจประเมินของทีมกฎหมาย (Legal Team Review Verdict)
              </div>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                ระบบบันทึกผลลงฐานข้อมูลแยกส่วนใน Staging (<code>{feedbackBackend}</code>) ·
                หากคำตอบดูน่าเชื่อถือแต่ไม่มีหลักฐานรองรับที่ถูกต้อง กรุณาเลือก{" "}
                <code>FAIL_UNSUPPORTED_OR_WEAK_EVIDENCE</code>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value as LegalReviewVerdict)}
                  style={{
                    background: "#0b0d10",
                    color: "#f9fafb",
                    border: "1px solid #475569",
                    padding: "7px 10px",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  <option value="PASS_SUPPORTED">
                    ✅ PASS_SUPPORTED — ถูกต้องและมีหลักฐานทางการรองรับครบถ้วน (หรือระงับการเดาได้ถูกต้อง)
                  </option>
                  <option value="FAIL_UNSUPPORTED_OR_WEAK_EVIDENCE">
                    ❌ FAIL_UNSUPPORTED_OR_WEAK_EVIDENCE — สรุปโดยไม่มีหลักฐานรองรับ / อ้างอิงไม่ตรงประเด็น
                  </option>
                  <option value="FAIL_WRONG_LAW_OR_VERSION">
                    ❌ FAIL_WRONG_LAW_OR_VERSION — ใช้รุ่นกฎหมายผิดช่วงเวลา / ข้ามข้อยกเว้นสำคัญ
                  </option>
                  <option value="NEEDS_REFINEMENT">
                    ⚠️ NEEDS_REFINEMENT — หลักฐานถูกต้องแต่ควรปรับถ้อยคำหรือลำดับการอธิบาย
                  </option>
                </select>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checkedOriginalSource}
                    onChange={(e) => setCheckedOriginalSource(e.target.checked)}
                  />
                  ได้เปิดตรวจสอบลิงก์ต้นฉบับทางการ / ข้อความหลักฐานแล้ว (จำเป็นต้องติ๊กก่อนกด PASS)
                </label>
              </div>

              <textarea
                rows={3}
                value={commentsTh}
                onChange={(e) => setCommentsTh(e.target.value)}
                placeholder="ความเห็นเพิ่มเติมของทีมกฎหมาย เช่น จุดที่ควรปรับปรุง มาตราหรือข้อหารือที่ควรอ้างเพิ่ม..."
                style={{
                  background: "#0b0d10",
                  color: "#f9fafb",
                  border: "1px solid #374151",
                  padding: "8px 10px",
                  fontSize: "13px",
                }}
              />

              <div>
                <button
                  type="button"
                  disabled={feedbackBusy}
                  onClick={() => void submitFeedback()}
                  style={{
                    background: "#eab308",
                    color: "#0f172a",
                    border: "none",
                    padding: "8px 18px",
                    fontSize: "13px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {feedbackBusy ? "กำลังบันทึกผล..." : "💾 บันทึกผลการตรวจของทีมกฎหมาย"}
                </button>
              </div>

              {/* Recent Feedback Log */}
              {feedbackList.length > 0 ? (
                <div style={{ marginTop: "8px", borderTop: "1px solid #1f2937", paddingTop: "10px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
                    รายการ Feedback ล่าสุดที่บันทึกไว้ ({feedbackList.length} รายการ):
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {feedbackList.slice(0, 8).map((fb) => (
                      <div
                        key={fb.feedback_id}
                        style={{
                          background: "#0d1117",
                          border: "1px solid #1f2937",
                          padding: "8px 10px",
                          fontSize: "12px",
                        }}
                      >
                        <strong>{fb.verdict}</strong> · ผู้ตรวจ: <strong>{fb.reviewer_name}</strong>{" "}
                        · โจทย์: <code>{fb.scenario_id || "Custom"}</code> · รุ่นคำตอบ:{" "}
                        <code>{fb.answer_revision_id || "-"}</code>
                        {fb.answer_revision_id ? (
                          <>
                            {" "}
                            <button
                              type="button"
                              onClick={() => void reopenSavedRevisionById(fb.answer_revision_id!)}
                              style={{
                                background: "#1e293b",
                                color: "#93c5fd",
                                border: "1px solid #334155",
                                padding: "2px 6px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              📂 เปิดรุ่นนี้
                            </button>
                          </>
                        ) : null}{" "}
                        · เวลา: <span>{fb.recorded_at}</span>
                        {fb.comments_th ? (
                          <div style={{ color: "#cbd5e1", marginTop: "3px" }}>{fb.comments_th}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
