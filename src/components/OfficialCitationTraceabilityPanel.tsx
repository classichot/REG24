"use client";

import React, { useState, useCallback } from "react";
import type {
  ClaimEvidenceReferenceDto,
  PublishedAtomicClaimDto,
  ResolvedPinnedEvidenceResponse,
  TraceableAnswerEnvelope,
} from "@/core/knowledge/citation-contracts";

export interface OfficialCitationTraceabilityPanelProps {
  envelope: TraceableAnswerEnvelope;
  questionText?: string;
  onReopenedEnvelope?: (reopened: TraceableAnswerEnvelope, questionText: string) => void;
}

export function OfficialCitationTraceabilityPanel({
  envelope,
  questionText = "",
  onReopenedEnvelope,
}: OfficialCitationTraceabilityPanelProps) {
  const [activeRef, setActiveRef] = useState<{
    claim: PublishedAtomicClaimDto;
    ref: ClaimEvidenceReferenceDto;
  } | null>(null);
  const [resolvedEvidence, setResolvedEvidence] = useState<
    NonNullable<ResolvedPinnedEvidenceResponse["evidence"]> | null
  >(null);
  const [loadingResolver, setLoadingResolver] = useState<boolean>(false);
  const [resolverError, setResolverError] = useState<string | null>(null);

  // Side-by-side Scan / Page Zoom & Page Navigation state (Section 6)
  const [scanPageIdx, setScanPageIdx] = useState<number>(0);
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [showRawOcrAudit, setShowRawOcrAudit] = useState<boolean>(false);
  const [showRestrictedAccessConfirm, setShowRestrictedAccessConfirm] = useState<boolean>(false);

  // Save / Reopen / Copy / Export feedback state
  const [savedRevisionId, setSavedRevisionId] = useState<string | null>(null);
  const [reopenInputId, setReopenInputId] = useState<string>("");
  const [actionToast, setActionToast] = useState<string | null>(null);

  const inspectPinnedPassage = useCallback(
    async (claim: PublishedAtomicClaimDto, ref: ClaimEvidenceReferenceDto) => {
      setActiveRef({ claim, ref });
      setScanPageIdx(0);
      setZoomPercent(100);
      setShowRawOcrAudit(false);
      setShowRestrictedAccessConfirm(false);
      setResolverError(null);

      if (!ref.resolver_url) {
        setResolvedEvidence(null);
        setResolverError("คำตอบรุ่นเดิมยังไม่มีลิงก์ตัวแก้ไขหลักฐานถาวร (Legacy Unverified Citation)");
        return;
      }

      setLoadingResolver(true);
      try {
        const res = await fetch(ref.resolver_url);
        const json = await res.json();
        if (!res.ok || !json.ok || !json.pinned_evidence) {
          setResolvedEvidence(null);
          setResolverError(
            json.error || "ไม่สามารถเปิดข้อความอ้างอิงได้เนื่องจากข้อจำกัดสิทธิ์หรือเอกสารถูกระงับ"
          );
        } else {
          setResolvedEvidence(json.pinned_evidence);
        }
      } catch (err) {
        setResolvedEvidence(null);
        setResolverError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการโหลดข้อความต้นฉบับ");
      } finally {
        setLoadingResolver(false);
      }
    },
    []
  );

  const copyFormattedCitation = useCallback(
    async (claim: PublishedAtomicClaimDto, ref: ClaimEvidenceReferenceDto) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "https://reg24.th";
      const permUrl = ref.resolver_url.startsWith("http")
        ? ref.resolver_url
        : ref.resolver_url
          ? `${origin}${ref.resolver_url}`
          : "-";
      const text = [
        `[${claim.claim_number}] ${ref.citation_label_th}`,
        `หน่วยงาน: ${ref.issuer_name_th} (${ref.record_type_label_th})`,
        `รุ่นเอกสาร: ${ref.version_id} · วันที่อ้างอิง: ${ref.date_relied_on || "-"}`,
        `ตำแหน่งอ้างอิง: ${ref.locator.human_pinpoint_th}`,
        `ลิงก์ต้นฉบับทางการ: ${ref.official_url_with_anchor || ref.official_url || "-"}`,
        `ลิงก์หลักฐานถาวร REG24: ${permUrl}`,
      ].join("\n");
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setActionToast("คัดลอกข้อมูลการอ้างอิง ลิงก์ทางการ และลิงก์ถาวร REG24 เรียบร้อยแล้ว");
      }
    },
    []
  );

  const handleSaveAnswer = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/knowledge/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traceable_answer: envelope,
          question_text: questionText,
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setSavedRevisionId(json.saved_answer_revision);
        setReopenInputId(json.saved_answer_revision);
        setActionToast(`บันทึกคำตอบตามรุ่นสำเร็จ: ${json.saved_answer_revision}`);
      } else {
        setActionToast(json.error || "ไม่สามารถบันทึกคำตอบได้");
      }
    } catch (err) {
      setActionToast(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการบันทึกคำตอบ");
    }
  }, [envelope, questionText]);

  const handleReopenAnswer = useCallback(async () => {
    const target = (reopenInputId || savedRevisionId || envelope.answer_revision).trim();
    if (!target) return;
    try {
      const res = await fetch(`/api/v1/knowledge/answers/${encodeURIComponent(target)}`);
      const json = await res.json();
      if (res.ok && json.ok && json.answer) {
        setActionToast(`เปิดคำตอบย้อนหลังรุ่น ${json.answer.answer_revision} สำเร็จ`);
        if (onReopenedEnvelope) {
          onReopenedEnvelope(json.answer, json.question_text || questionText);
        }
      } else {
        setActionToast(json.error || "ไม่พบคำตอบที่บันทึกไว้หรือไม่มีสิทธิ์เข้าถึง");
      }
    } catch (err) {
      setActionToast(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการเปิดคำตอบย้อนหลัง");
    }
  }, [reopenInputId, savedRevisionId, envelope.answer_revision, onReopenedEnvelope, questionText]);

  const handleExport = useCallback(
    async (format: "markdown" | "word_doc" | "pdf_html") => {
      try {
        const res = await fetch(
          `/api/v1/knowledge/answers/${encodeURIComponent(envelope.answer_revision)}/export`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              traceable_answer: envelope,
              format,
            }),
          }
        );
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setActionToast(json.error || "ระงับการส่งออกตามเกณฑ์การตรวจสอบหลักฐาน");
          return;
        }
        const blob = new Blob([json.content], { type: json.mime_type });
        const url = URL.createObjectURL(blob);
        if (format === "pdf_html") {
          const w = window.open(url, "_blank");
          if (w) {
            w.onload = () => w.print();
          }
          setActionToast("เปิดเอกสารพร้อมพิมพ์ PDF (คงลิงก์และเลขข้อกล่าวอ้างครบถ้วน)");
        } else {
          const a = document.createElement("a");
          a.href = url;
          a.download = json.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setActionToast(`ส่งออกไฟล์ ${json.filename} สำเร็จ`);
        }
      } catch (err) {
        setActionToast(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการส่งออก");
      }
    },
    [envelope]
  );

  const openOfficialSourceAction = useCallback((ref: ClaimEvidenceReferenceDto) => {
    if (ref.access_permission === "restricted_external_official" && ref.access_conditions_th) {
      setShowRestrictedAccessConfirm(true);
      return;
    }
    const targetUrl = ref.official_url_with_anchor || ref.official_url;
    if (targetUrl) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  }, []);

  const currentScanPage =
    resolvedEvidence && resolvedEvidence.scan_pages.length > 0
      ? resolvedEvidence.scan_pages[Math.min(scanPageIdx, resolvedEvidence.scan_pages.length - 1)]
      : null;

  return (
    <section
      aria-label="ข้อกล่าวอ้างทางกฎหมายและการตรวจสอบแหล่งอ้างอิงทางการ"
      style={{
        background: "#0d1117",
        border: "1px solid #2b313c",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        color: "#f3f4f6",
      }}
    >
      {/* Header: Answer Revision, As-of Date vs Generated Time, Save & Export Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
          flexWrap: "wrap",
          borderBottom: "1px solid #1f2937",
          paddingBottom: "12px",
        }}
      >
        <div>
          <div style={{ fontSize: "12px", fontWeight: 800, color: "#a3e635" }}>
            การตรวจสอบข้อกล่าวอ้างและแหล่งอ้างอิงทางการรายประเด็น (Claim Traceability ·{" "}
            <code>{envelope.answer_revision}</code>)
          </div>
          <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
            วันที่กฎหมายที่คำถามกล่าวถึง (As-of Date):{" "}
            <strong style={{ color: "#e5e7eb" }}>
              {envelope.as_of_date || "กฎหมายปัจจุบัน / ตามบริบทเอกสาร"}
            </strong>{" "}
            · เวลาที่สร้างคำตอบ:{" "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>{envelope.generated_at}</span> ·
            สถานะ: <code>{envelope.status.toUpperCase()}</code>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => void handleSaveAnswer()}
            style={{
              background: "#1e293b",
              color: "#a3e635",
              border: "1px solid #334155",
              padding: "5px 10px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            บันทึกคำตอบตามรุ่น
          </button>
          <button
            type="button"
            onClick={() => void handleExport("markdown")}
            style={{
              background: "#172033",
              color: "#e2e8f0",
              border: "1px solid #334155",
              padding: "5px 10px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            ส่งออก Markdown
          </button>
          <button
            type="button"
            onClick={() => void handleExport("word_doc")}
            style={{
              background: "#172033",
              color: "#e2e8f0",
              border: "1px solid #334155",
              padding: "5px 10px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            ส่งออก Word (.doc)
          </button>
          <button
            type="button"
            onClick={() => void handleExport("pdf_html")}
            style={{
              background: "#172033",
              color: "#e2e8f0",
              border: "1px solid #334155",
              padding: "5px 10px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            ส่งออก PDF / พิมพ์
          </button>
        </div>
      </div>

      {/* Reopen Historical Saved Answer Bar */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="reg24-reopen-answer-input" style={{ fontSize: "12px", color: "#9ca3af" }}>
          เปิดคำตอบที่บันทึกไว้ย้อนหลัง:
        </label>
        <input
          id="reg24-reopen-answer-input"
          value={reopenInputId}
          onChange={(e) => setReopenInputId(e.target.value)}
          placeholder={savedRevisionId || envelope.answer_revision}
          style={{
            background: "#090b0e",
            color: "#f9fafb",
            border: "1px solid #334155",
            padding: "4px 8px",
            fontSize: "12px",
            minWidth: "210px",
          }}
        />
        <button
          type="button"
          onClick={() => void handleReopenAnswer()}
          style={{
            background: "#1e293b",
            color: "#93c5fd",
            border: "1px solid #334155",
            padding: "4px 10px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          เปิดคำตอบย้อนหลัง
        </button>
        {actionToast && (
          <span style={{ fontSize: "12px", color: "#86efac" }}>{actionToast}</span>
        )}
      </div>

      {/* Legacy Unverified Warning (T11) */}
      {envelope.legacy_warning_th && (
        <div
          role="alert"
          style={{
            background: "rgba(220, 38, 38, 0.14)",
            border: "1px solid #ef4444",
            padding: "10px 12px",
            fontSize: "12.5px",
            color: "#fecaca",
          }}
        >
          ⚠️ <strong>{envelope.legacy_warning_th}</strong>
        </div>
      )}

      {/* Separate Update Notices when Newer Amendments Exist (T04) */}
      {envelope.update_notices && envelope.update_notices.length > 0 && (
        <div
          role="status"
          style={{
            background: "rgba(59, 130, 246, 0.14)",
            border: "1px solid #60a5fa",
            padding: "10px 12px",
            fontSize: "12.5px",
            color: "#dbeafe",
          }}
        >
          {envelope.update_notices.map((un, idx) => (
            <div key={idx}>ℹ️ {un.notice_th}</div>
          ))}
        </div>
      )}

      {/* User-Supplied Facts Separated from Legal Propositions (Section 1) */}
      {envelope.user_supplied_facts.length > 0 && (
        <div
          style={{
            background: "#111827",
            border: "1px solid #374151",
            padding: "10px 12px",
            fontSize: "12.5px",
          }}
        >
          <strong style={{ color: "#93c5fd" }}>
            ข้อเท็จจริงและสมมติฐานที่รับมาจากคำถามของผู้ใช้ (แยกจากข้อกฎหมาย):
          </strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: "18px", color: "#d1d5db" }}>
            {envelope.user_supplied_facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Main Split Grid: Atomic Claims List (Left) + Thai Evidence Inspection Panel (Right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: activeRef ? "1.15fr 1fr" : "1fr",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {envelope.claims.map((clm) => (
            <div
              key={clm.claim_id}
              style={{
                background: "#090b0e",
                border: "1px solid #23272f",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <span
                  style={{
                    background: "#1e293b",
                    color: "#a3e635",
                    fontWeight: 800,
                    fontSize: "11.5px",
                    padding: "2px 7px",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  ข้อกล่าวอ้าง [{clm.claim_number}]
                </span>
                <span
                  style={{
                    background:
                      clm.claim_type === "interpretation"
                        ? "rgba(59, 130, 246, 0.2)"
                        : "rgba(34, 197, 94, 0.16)",
                    color: clm.claim_type === "interpretation" ? "#93c5fd" : "#86efac",
                    fontSize: "11.5px",
                    padding: "2px 8px",
                    border: "1px solid rgba(148, 163, 184, 0.25)",
                  }}
                >
                  {clm.claim_type_label_th}
                </span>
                {clm.premise_ids.length > 0 && (
                  <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                    อาศัยข้อสมมติฐาน: <code>{clm.premise_ids.join(", ")}</code>
                  </span>
                )}
              </div>

              <div style={{ fontSize: "13.5px", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                {clm.text}
              </div>

              {/* Keyboard-Accessible Thai Citation Pills Next to Each Claim (Section 6) */}
              {clm.evidence_references.length > 0 && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                  {clm.evidence_references.map((ref) => (
                    <button
                      key={ref.link_id}
                      type="button"
                      tabIndex={0}
                      aria-label={`ตรวจสอบหลักฐานอ้างอิง ${ref.citation_label_th} (${ref.support_role_label_th})`}
                      onClick={() => void inspectPinnedPassage(clm, ref)}
                      style={{
                        background:
                          activeRef?.ref.link_id === ref.link_id ? "#a3e635" : "#172033",
                        color: activeRef?.ref.link_id === ref.link_id ? "#090b0e" : "#bae6fd",
                        border: "1px solid #38bdf8",
                        padding: "4px 9px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      📎 {ref.citation_label_th}
                      {clm.evidence_references.length > 1 ? ` (${ref.support_role_label_th})` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Scoped Unresolved Issues in Thai (Section 1 & ANS-03) */}
          {envelope.unresolved_issues.length > 0 && (
            <div
              style={{
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.45)",
                padding: "10px 12px",
                fontSize: "12.5px",
                color: "#fde68a",
              }}
            >
              <strong>คำชี้แจงประเด็นที่ระงับการสรุปเนื่องจากยังไม่สามารถยืนยันจากเอกสารทางการได้:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {envelope.unresolved_issues.map((iss) => (
                  <li key={iss.issue_id}>{iss.explanation_th}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right Side: Thai Evidence Inspection Panel */}
        {activeRef && (
          <aside
            aria-label="หน้าต่างตรวจสอบข้อความต้นฉบับและแหล่งอ้างอิงทางการ"
            style={{
              background: "#090b0e",
              border: "1px solid #a3e635",
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: "12px", color: "#a3e635" }}>
                แผงตรวจสอบหลักฐานต้นฉบับ (Official Evidence Inspector)
              </strong>
              <button
                type="button"
                aria-label="ปิดแผงตรวจสอบหลักฐาน"
                onClick={() => {
                  setActiveRef(null);
                  setResolvedEvidence(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                ✕
              </button>
            </div>

            {/* Mandatory Visible Distinction Between REG24 Preserved Copy & Official Website (Section 6) */}
            <div
              style={{
                background: "#111827",
                border: "1px solid #374151",
                padding: "8px 10px",
                fontSize: "11.5px",
                color: "#d1d5db",
                lineHeight: 1.5,
              }}
            >
              <div>
                🏛️ <strong>แหล่งข้อมูลทางการ:</strong> {activeRef.ref.issuer_name_th} ·{" "}
                {activeRef.ref.source_family_label_th} ({activeRef.ref.record_type_label_th})
              </div>
              <div>
                🔒 <strong>สำเนาที่แสดงในแผงนี้:</strong> สำเนาข้อความตามรุ่นที่ REG24 เก็บรักษา (
                <code>{activeRef.ref.version_id}</code>) แยกจากเว็บไซต์ทางการของหน่วยงานโดยชัดเจน
              </div>
            </div>

            <div style={{ fontSize: "12.5px", lineHeight: 1.6, color: "#e5e7eb" }}>
              <div>
                <strong>บทบาทหลักฐาน:</strong> {activeRef.ref.support_role_label_th}
              </div>
              <div>
                <strong>วันที่อ้างอิง:</strong> {activeRef.ref.date_relied_on || "ตามต้นฉบับ"} ·{" "}
                <strong>ตำแหน่งระบุจุด (Pinpoint):</strong>{" "}
                <span style={{ color: "#fde047", fontWeight: 700 }}>
                  {activeRef.ref.locator.human_pinpoint_th}
                </span>
              </div>
              <div>
                <strong>สถานะการตรวจสอบ:</strong>{" "}
                <code>{activeRef.ref.verification_status.toUpperCase()}</code>
              </div>
              {activeRef.ref.link_health_notice_th && (
                <div
                  style={{
                    marginTop: "6px",
                    padding: "6px 8px",
                    background: "rgba(245, 158, 11, 0.14)",
                    border: "1px solid #f59e0b",
                    color: "#fde68a",
                    fontSize: "12px",
                  }}
                >
                  {activeRef.ref.link_health_notice_th}
                </div>
              )}
            </div>

            {/* Required User Action Buttons (Section 6 Table) */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={!activeRef.ref.official_url}
                onClick={() => openOfficialSourceAction(activeRef.ref)}
                style={{
                  background: "#a3e635",
                  color: "#090b0e",
                  border: "none",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 800,
                  cursor: activeRef.ref.official_url ? "pointer" : "not-allowed",
                }}
              >
                เปิดต้นฉบับทางการ ↗
              </button>
              <button
                type="button"
                onClick={() => void inspectPinnedPassage(activeRef.claim, activeRef.ref)}
                style={{
                  background: "#1e293b",
                  color: "#f8fafc",
                  border: "1px solid #475569",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ดูข้อความที่ใช้อ้างอิง
              </button>
              <button
                type="button"
                onClick={() => void copyFormattedCitation(activeRef.claim, activeRef.ref)}
                style={{
                  background: "#172033",
                  color: "#bae6fd",
                  border: "1px solid #334155",
                  padding: "6px 12px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                คัดลอกการอ้างอิง
              </button>
            </div>

            {/* Restricted External Official Record Access Conditions Prompt (SRC-03) */}
            {showRestrictedAccessConfirm && activeRef.ref.access_conditions_th && (
              <div
                style={{
                  background: "#1f2937",
                  border: "1px solid #f59e0b",
                  padding: "10px",
                  fontSize: "12px",
                  color: "#fde68a",
                }}
              >
                <div>
                  <strong>เงื่อนไขการเข้าถึงต้นฉบับบนเว็บไซต์ทางการ:</strong>{" "}
                  {activeRef.ref.access_conditions_th}
                </div>
                <div style={{ marginTop: "6px", display: "flex", gap: "8px" }}>
                  <a
                    href={activeRef.ref.official_url_with_anchor || activeRef.ref.official_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#93c5fd", fontWeight: 700, textDecoration: "underline" }}
                  >
                    รับทราบเงื่อนไขและเปิดลิงก์ทางการ ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowRestrictedAccessConfirm(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#9ca3af",
                      cursor: "pointer",
                    }}
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}

            {loadingResolver && (
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                กำลังดึงสำเนาตามรุ่นและตรวจสอบสิทธิ์การเข้าถึง…
              </div>
            )}
            {resolverError && (
              <div style={{ fontSize: "12px", color: "#fca5a5" }}>{resolverError}</div>
            )}

            {/* Pinned Passage Quote Highlighted in Surrounding Context + Side-by-Side Scan Viewer */}
            {resolvedEvidence && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "11.5px", color: "#9ca3af" }}>
                  {resolvedEvidence.reg24_preserved_copy_label_th}
                </div>

                {currentScanPage ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "6px",
                        fontSize: "12px",
                      }}
                    >
                      <span>
                        มุมมองเคียงข้างภาพหน้าเอกสารต้นฉบับและข้อความที่ตรวจทานแล้ว (หน้า{" "}
                        {currentScanPage.physical_page_one_based} · หน้าพิมพ์{" "}
                        {currentScanPage.printed_page_label || "-"})
                      </span>
                      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                        <button
                          type="button"
                          disabled={scanPageIdx <= 0}
                          onClick={() => setScanPageIdx((p) => Math.max(0, p - 1))}
                          style={{
                            background: "#1e293b",
                            color: "#e2e8f0",
                            border: "1px solid #334155",
                            padding: "2px 7px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          ◀ หน้าก่อน
                        </button>
                        <button
                          type="button"
                          disabled={scanPageIdx >= resolvedEvidence.scan_pages.length - 1}
                          onClick={() =>
                            setScanPageIdx((p) =>
                              Math.min(resolvedEvidence.scan_pages.length - 1, p + 1)
                            )
                          }
                          style={{
                            background: "#1e293b",
                            color: "#e2e8f0",
                            border: "1px solid #334155",
                            padding: "2px 7px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          หน้าถัดไป ▶
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoomPercent((z) => Math.max(60, z - 20))}
                          style={{
                            background: "#1e293b",
                            color: "#e2e8f0",
                            border: "1px solid #334155",
                            padding: "2px 7px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          ซูม -
                        </button>
                        <span style={{ fontSize: "11px", color: "#a3e635" }}>{zoomPercent}%</span>
                        <button
                          type="button"
                          onClick={() => setZoomPercent((z) => Math.min(200, z + 20))}
                          style={{
                            background: "#1e293b",
                            color: "#e2e8f0",
                            border: "1px solid #334155",
                            padding: "2px 7px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          ซูม +
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "8px",
                        alignItems: "start",
                      }}
                    >
                      <div
                        style={{
                          overflow: "auto",
                          maxHeight: "340px",
                          border: "1px solid #334155",
                          background: "#f8fafc",
                        }}
                      >
                        <img
                          src={currentScanPage.scan_preview_svg_data_uri}
                          alt={`ภาพหน้าเอกสาร PDF หน้า ${currentScanPage.physical_page_one_based}`}
                          style={{
                            width: `${zoomPercent}%`,
                            height: "auto",
                            display: "block",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          background: "#11141a",
                          border: "1px solid #23272f",
                          padding: "10px",
                          fontSize: "13px",
                          lineHeight: 1.7,
                          maxHeight: "340px",
                          overflowY: "auto",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {resolvedEvidence.surrounding_before && (
                          <span style={{ color: "#6b7280" }}>
                            …{resolvedEvidence.surrounding_before}{"\n"}
                          </span>
                        )}
                        <mark
                          style={{
                            background: "rgba(163, 230, 53, 0.25)",
                            color: "#fef08a",
                            padding: "2px 4px",
                          }}
                        >
                          {resolvedEvidence.verbatim_quote}
                        </mark>
                        {resolvedEvidence.surrounding_after && (
                          <span style={{ color: "#6b7280" }}>
                            {"\n"}
                            {resolvedEvidence.surrounding_after}…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#11141a",
                      border: "1px solid #23272f",
                      padding: "12px",
                      fontSize: "13px",
                      lineHeight: 1.75,
                      whiteSpace: "pre-wrap",
                      maxHeight: "360px",
                      overflowY: "auto",
                    }}
                  >
                    {resolvedEvidence.surrounding_before && (
                      <span style={{ color: "#6b7280" }}>
                        …{resolvedEvidence.surrounding_before}{"\n"}
                      </span>
                    )}
                    <mark
                      style={{
                        background: "rgba(163, 230, 53, 0.24)",
                        color: "#fef08a",
                        padding: "2px 4px",
                      }}
                    >
                      {resolvedEvidence.verbatim_quote}
                    </mark>
                    {resolvedEvidence.surrounding_after && (
                      <span style={{ color: "#6b7280" }}>
                        {"\n"}
                        {resolvedEvidence.surrounding_after}…
                      </span>
                    )}
                  </div>
                )}

                {/* OCR Revision Audit History Toggle (T02) */}
                {resolvedEvidence.ocr_audit_trail.length > 1 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowRawOcrAudit((v) => !v)}
                      style={{
                        background: "transparent",
                        border: "1px dashed #475569",
                        color: "#9ca3af",
                        padding: "4px 8px",
                        fontSize: "11.5px",
                        cursor: "pointer",
                      }}
                    >
                      {showRawOcrAudit
                        ? "ซ่อนประวัติรุ่นการถอดข้อความ OCR เดิม"
                        : `ดูประวัติการถอดข้อความและตรวจทาน OCR (${resolvedEvidence.ocr_audit_trail.length} รุ่น)`}
                    </button>
                    {showRawOcrAudit && (
                      <div
                        style={{
                          marginTop: "6px",
                          padding: "8px",
                          background: "#0d1117",
                          border: "1px solid #1f2937",
                          fontSize: "11.5px",
                          color: "#9ca3af",
                        }}
                      >
                        {resolvedEvidence.ocr_audit_trail.map((rev) => (
                          <div key={rev.extraction_revision_id} style={{ marginBottom: "8px" }}>
                            <div>
                              <code>{rev.extraction_revision_id}</code> · {rev.parser_or_ocr_version}{" "}
                              · สถานะ: <strong>{rev.review_status}</strong>
                              {rev.reviewer_id ? ` · ผู้ตรวจทาน: ${rev.reviewer_id}` : ""}
                            </div>
                            {rev.correction_note && <div>หมายเหตุแก้ไข: {rev.correction_note}</div>}
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                margin: "4px 0 0",
                                padding: "6px",
                                background: "#090b0e",
                                color: "#cbd5e1",
                              }}
                            >
                              {rev.raw_transcription}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
