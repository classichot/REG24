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
  { id: "all", labelTh: "ทั้งหมด (12 กรณีทดสอบซับซ้อน)" },
  { id: "multi_step", labelTh: "วิเคราะห์หลายขั้นตอน" },
  { id: "exceptions", labelTh: "ข้อยกเว้นกฎหมาย" },
  { id: "changing_facts", labelTh: "ข้อเท็จจริงเปลี่ยน" },
  { id: "historical_law", labelTh: "กฎหมายย้อนหลัง/วันบังคับใช้" },
  { id: "missing_information", labelTh: "ข้อมูลชี้ขาดไม่ครบ" },
  { id: "follow_up_chain", labelTh: "คำถามต่อเนื่องหลายรอบ" },
  { id: "verified_attachment", labelTh: "แนบกฎหมายทางการ" },
  { id: "out_of_scope", labelTh: "นอกขอบเขต/เลขที่ไม่มีจริง" },
];

export default function LegalTeamReviewStudioPage() {
  const [inviteCode, setInviteCode] = useState<string>("");
  const [reviewerName, setReviewerName] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | ChallengingScenarioCategory>("all");
  const [activeScenario, setActiveScenario] = useState<ChallengingTaxScenario>(
    CHALLENGING_THAI_TAX_SCENARIOS[0]
  );

  // Query & Multi-turn conversation state
  const [question, setQuestion] = useState<string>(CHALLENGING_THAI_TAX_SCENARIOS[0].question_th);
  const [asOfDate, setAsOfDate] = useState<string>(
    CHALLENGING_THAI_TAX_SCENARIOS[0].as_of_date || ""
  );
  const [queryMode, setQueryMode] = useState<"standard" | "exact_lookup" | "comparison">(
    CHALLENGING_THAI_TAX_SCENARIOS[0].mode || "standard"
  );
  const [conversationHistory, setConversationHistory] = useState<ConversationTurnInput[]>([]);
  const [attachedDocIds, setAttachedDocIds] = useState<string[]>([]);
  const [attachmentSummary, setAttachmentSummary] = useState<string | null>(null);

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
      const res = await fetch("/api/v1/knowledge/legal-feedback", {
        method: "GET",
        headers: buildHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setFeedbackList(json.feedback || []);
        setFeedbackBackend(json.storage_backend || "unknown");
      }
    } catch {
      // Non-fatal on initial load
    }
  }, [buildHeaders]);

  useEffect(() => {
    void loadFeedbackHistory();
  }, [loadFeedbackHistory]);

  const selectScenario = (sc: ChallengingTaxScenario) => {
    setActiveScenario(sc);
    setQuestion(sc.question_th);
    setAsOfDate(sc.as_of_date || "");
    setQueryMode(sc.mode || "standard");
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

  const runQuery = async (overrideQuestion?: string, overrideDate?: string | null, appendFollowUp?: boolean) => {
    const qToRun = (overrideQuestion ?? question).trim();
    if (!qToRun) return;

    const dateToRun =
      overrideDate !== undefined ? overrideDate : asOfDate.trim() ? asOfDate.trim() : null;

    setQueryBusy(true);
    setStatusBanner(null);
    setCheckedOriginalSource(false);

    const historyForCall = appendFollowUp ? conversationHistory : [];

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
          conversation_history: historyForCall,
          attachment_doc_ids: attachedDocIds,
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

      setConversationHistory([
        ...historyForCall,
        { role: "user", content: qToRun, applicable_date: dateToRun },
        { role: "assistant", content: ans.answer },
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
          scenario_id: activeScenario?.scenario_id || null,
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
          {/* Left Column: 12 Challenging Thai Tax Scenarios */}
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
              ชุดโจทย์ภาษีไทยซับซ้อนสำหรับทดสอบ (เลือกเพื่อโหลดโจทย์)
            </div>
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
                maxHeight: "74vh",
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
          </aside>

          {/* Right Column: Query Runner, Attachment Verifier, Answer & Claim Traceability, Feedback Form */}
          <main style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
                    onChange={(e) => setAsOfDate(e.target.value)}
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
                      if (qText) setQuestion(qText);
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
                        <code>{fb.answer_revision_id || "-"}</code> · เวลา:{" "}
                        <span>{fb.recorded_at}</span>
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
