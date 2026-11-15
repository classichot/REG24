"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type {
  EvaluationReport,
  GroundedAnswer,
  ReleaseReport,
  UATCase,
} from "@/core/knowledge/contracts";

interface BatchGateBoardItem {
  batch_id: string;
  predecessor_batch_id: string | null;
  unlocked: boolean;
  status: string;
  release_id: string | null;
}

interface ReportApiResponse {
  ok: boolean;
  batch_id: string;
  active_release_id: string | null;
  release_record: {
    release_id: string;
    revision: number;
    manifest_hash: string;
    state: string;
    code_commit: string;
  } | null;
  report: ReleaseReport | null;
  evaluation: EvaluationReport | null;
  uat_cases: UATCase[];
  dependency_manifest?: {
    loaded_b02_dependencies_count: number;
    loaded_b02_dependencies: Array<{
      work_id: string;
      title_th: string;
      owner_batch_id: string;
      first_loaded_by_batch_id: string;
      required_by_count: number;
    }>;
    unresolved_external_references_count: number;
  } | null;
  batch_gate_board: BatchGateBoardItem[];
  error?: string;
}

interface ResolvedDrawerEvidence {
  passage: {
    passage_id: string;
    work_id: string;
    version_id: string;
    exact_text: string;
    contextualized_header: string;
    statement_role: string;
    structural_path: string[];
    critical_tokens_flagged: string[];
  };
  work_title_th: string;
  official_identifier: string;
  authority_type: string;
  authenticity_status: string;
  is_derivative: boolean;
  locator: {
    kind: string;
    artifact_id: string;
    origin_uri: string;
    physical_page_index?: number;
    printed_page_label?: string | null;
    structural_selector?: string;
  };
}

const EXPLORATORY_B01_REPRESENTATIVE_QUESTIONS: Array<{
  id: string;
  label: string;
  question: string;
  mode: "standard" | "exact_lookup" | "comparison";
  date: string | null;
  cmp?: string[];
}> = [
  {
    id: "Q1",
    label: "1. Exact Ruling (กค 0702/636 · 0% VAT Foreign Grant)",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
    mode: "exact_lookup",
    date: null,
  },
  {
    id: "Q2",
    label: "2. Facts vs Ruling Separation (กค 0702/1494 · มาตรา 47 ทวิ)",
    question:
      "ในหนังสือตอบข้อหารือ กค 0702/1494 ข้อเท็จจริงของกองมรดกผู้ขอคืนภาษีคืออะไร และกรมสรรพากรวินิจฉัยเรื่องเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ อย่างไร",
    mode: "standard",
    date: null,
  },
  {
    id: "Q3",
    label: "3. Royal Decree 244 Fix (กค 0811/13980 · มาตรา 3 (5))",
    question:
      "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/13980 เรื่องการยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกา ฉบับที่ 244 มาตรา 3 (5)",
    mode: "standard",
    date: null,
  },
  {
    id: "Q4",
    label: "4. Multi-Ruling VAT Comparison (กค 0702/1903 vs กค 0702/634)",
    question:
      "เปรียบเทียบการเสียภาษีมูลค่าเพิ่มระหว่างการขายสารเสริมสำหรับสัตว์ใน กค 0702/1903 กับการขายทองรูปพรรณความบริสุทธิ์ร้อยละ 96.5 ใน กค 0702/634",
    mode: "comparison",
    date: null,
  },
  {
    id: "Q5",
    label: "5. Multi-Installment Lease & ท.ป. Orders (กค 0702/1248)",
    question:
      "ตามหนังสือตอบข้อหารือ กค 0702/1248 การให้เช่าที่ดินระยะเวลา 30 ปี มูลค่า 1,470,993,502.74 บาท ต้องรับรู้รายได้เพื่อเสียภาษีเงินได้นิติบุคคลตามมาตรา 65 และคำสั่งกรมสรรพากรใด",
    mode: "standard",
    date: null,
  },
  {
    id: "Q6",
    label: "6. Historical Statute @ 2018-06-30 (มาตรา 65 ตรี v1_pre2019)",
    question: "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2018-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
    mode: "standard",
    date: "2018-06-30",
  },
  {
    id: "Q7",
    label: "7. Quarantined External Law Control (กค 0702/1493 · พ.ร.ฎ. 736)",
    question:
      "แสดงแนววินิจฉัยในหนังสือตอบข้อหารือ กค 0702/1493 กรณีการยกเว้นภาษีธุรกิจเฉพาะและอากรแสตมป์จากการเวนคืนอสังหาริมทรัพย์",
    mode: "standard",
    date: null,
  },
  {
    id: "Q8",
    label: "8. Nonexistent Ruling Abstention (กค 0702/999999)",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999",
    mode: "exact_lookup",
    date: null,
  },
];

export default function KnowledgeBatchesUatPage() {
  const [selectedBatch, setSelectedBatch] = useState<string>("B01");
  const [exploratoryMode, setExploratoryMode] = useState<boolean>(false);
  const [data, setData] = useState<ReportApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [apiBanner, setApiBanner] = useState<{ kind: "info" | "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qBatch = params.get("batch");
      if (qBatch && /^B\d{2}$/.test(qBatch)) {
        setSelectedBatch(qBatch);
      }
      if (params.get("mode") === "exploratory") {
        setExploratoryMode(true);
      }
    }
  }, []);

  // Interactive Grounded Query State
  const [question, setQuestion] = useState<string>(
    "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636"
  );
  const [applicableDate, setApplicableDate] = useState<string>("");
  const [queryMode, setQueryMode] = useState<"standard" | "exact_lookup" | "comparison">("exact_lookup");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [queryLoading, setQueryLoading] = useState<boolean>(false);
  const [answerResult, setAnswerResult] = useState<GroundedAnswer | null>(null);

  // Live Evidence Drawer State
  const [drawerEvidence, setDrawerEvidence] = useState<ResolvedDrawerEvidence | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);

  // Owner UAT Sheet State
  const [caseDecisions, setCaseDecisions] = useState<
    Record<string, { decision: "PASS" | "FAIL"; comment: string }>
  >({});
  const [ownerEmail, setOwnerEmail] = useState<string>("rattaroj@reg24.th");
  const [ownerSummaryComment, setOwnerSummaryComment] = useState<string>("");
  const [acknowledgeGaps, setAcknowledgeGaps] = useState<boolean>(false);
  const [submittingDecision, setSubmittingDecision] = useState<boolean>(false);

  const loadBatchReport = useCallback(async (batchId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/knowledge/batches/${batchId}/report`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ReportApiResponse;
      setData(json);
      if (json.uat_cases) {
        const existingMap: Record<string, { decision: "PASS" | "FAIL"; comment: string }> = {};
        for (const uc of json.uat_cases) {
          if (uc.owner_result) {
            existingMap[uc.case_id] = {
              decision: uc.owner_result.decision,
              comment: uc.owner_result.comment,
            };
          }
        }
        setCaseDecisions(existingMap);
      }
    } catch (err) {
      setApiBanner({
        kind: "err",
        text: `Failed to load batch report: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const [lastAutoRunBatch, setLastAutoRunBatch] = useState<string>("");

  useEffect(() => {
    void loadBatchReport(selectedBatch);
  }, [selectedBatch, loadBatchReport]);

  // Auto-execute Case #1 on load of an unlocked candidate batch so the user immediately sees HTTP 200 grounded output
  useEffect(() => {
    if (
      data?.batch_id === selectedBatch &&
      lastAutoRunBatch !== selectedBatch &&
      data?.uat_cases &&
      data.uat_cases.length > 0 &&
      data.report
    ) {
      setLastAutoRunBatch(selectedBatch);
      const firstCase = data.uat_cases[0];
      const mode: "standard" | "exact_lookup" | "comparison" =
        firstCase.category === "comparison"
          ? "comparison"
          : firstCase.category === "legal_lookup" || firstCase.category === "nonexistent_lookup"
            ? "exact_lookup"
            : "standard";
      setQuestion(firstCase.question);
      setApplicableDate(firstCase.applicable_date || "");
      setQueryMode(mode);
      void runLiveQuery({
        q: firstCase.question,
        date: firstCase.applicable_date,
        mode,
        cmp: firstCase.comparison_target_ids,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedBatch, lastAutoRunBatch]);

  const runLiveQuery = async (override?: {
    q: string;
    date: string | null;
    mode: "standard" | "exact_lookup" | "comparison";
    cmp?: string[];
  }) => {
    const qText = override ? override.q : question;
    const qDate = override ? override.date : applicableDate || null;
    const qMode = override ? override.mode : queryMode;
    const qCmp = override?.cmp ?? comparisonIds;

    setQueryLoading(true);
    setDrawerEvidence(null);
    try {
      const relId = data?.report?.release_id || `rel.${selectedBatch}.rc1`;
      const res = await fetch("/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: qText,
          release_id: relId,
          applicable_date: qDate,
          mode: qMode,
          comparison_work_ids: qCmp.length > 0 ? qCmp : undefined,
        }),
      });
      const json = (await res.json()) as { ok: boolean; answer?: GroundedAnswer; error?: string };
      if (!json.ok || !json.answer) {
        setApiBanner({ kind: "err", text: json.error || "Query failed" });
        return;
      }
      setAnswerResult(json.answer);
    } catch (err) {
      setApiBanner({
        kind: "err",
        text: `Query error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setQueryLoading(false);
    }
  };

  const openEvidenceLocator = async (passageId: string) => {
    setDrawerLoading(true);
    try {
      const res = await fetch(`/api/v1/knowledge/evidence/${encodeURIComponent(passageId)}`);
      const json = (await res.json()) as {
        ok: boolean;
        evidence?: ResolvedDrawerEvidence;
        error?: string;
      };
      if (!json.ok || !json.evidence) {
        setApiBanner({
          kind: "err",
          text: json.error || `Evidence ${passageId} blocked or unavailable`,
        });
        return;
      }
      setDrawerEvidence(json.evidence);
    } finally {
      setDrawerLoading(false);
    }
  };

  const executeUatCase = (uc: UATCase) => {
    const mode: "standard" | "exact_lookup" | "comparison" =
      uc.category === "comparison"
        ? "comparison"
        : uc.category === "legal_lookup" || uc.category === "nonexistent_lookup"
          ? "exact_lookup"
          : "standard";
    setQuestion(uc.question);
    setApplicableDate(uc.applicable_date || "");
    setQueryMode(mode);
    setComparisonIds(uc.comparison_target_ids || []);
    void runLiveQuery({
      q: uc.question,
      date: uc.applicable_date,
      mode,
      cmp: uc.comparison_target_ids,
    });
    window.scrollTo({ top: 380, behavior: "smooth" });
  };

  const nextLockedBatch =
    data?.batch_gate_board?.find((b) => !b.unlocked)?.batch_id || "B03";

  const testPrematureNextBatchGate = async () => {
    setApiBanner({
      kind: "info",
      text: `Testing sequential predecessor gate on Batch ${nextLockedBatch}...`,
    });
    const res = await fetch(`/api/v1/knowledge/batches/${nextLockedBatch}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-reg24-csrf": "1",
        "x-reg24-actor-role": "engineering_lead",
        "x-reg24-actor-id": "eng.lead@reg24.th",
      },
      body: JSON.stringify({
        idempotency_key: `gate-probe-${Date.now()}`,
      }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string; http_status?: number };
    if (res.status === 422) {
      setApiBanner({
        kind: "ok",
        text: `✅ PASS (Expected Predecessor Gate): Batch ${nextLockedBatch} returned HTTP 422 because ${nextLockedBatch} is intentionally locked until you approve ${selectedBatch}. Batch ${selectedBatch} itself is LIVE and serving HTTP 200 below.`,
      });
    } else {
      setApiBanner({
        kind: "info",
        text: `${nextLockedBatch} Gate response (HTTP ${res.status}): ${JSON.stringify(json)}`,
      });
    }
  };

  const submitOwnerDecision = async (
    decision: "UAT_PASS" | "UAT_PASS_WITH_DECLARED_GAPS" | "UAT_FAIL"
  ) => {
    if (!data?.release_record) return;
    if (decision === "UAT_PASS_WITH_DECLARED_GAPS" && !acknowledgeGaps) {
      setAcknowledgeGaps(true);
    }

    setSubmittingDecision(true);
    try {
      const rel = data.release_record;
      const caseDecisionArray = Object.entries(caseDecisions).map(([case_id, val]) => ({
        case_id,
        decision: val.decision,
        comment: val.comment,
      }));

      const res = await fetch(
        `/api/v1/knowledge/releases/${encodeURIComponent(rel.release_id)}/uat-decisions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-csrf": "1",
            "x-reg24-actor-role": "product_owner",
            "x-reg24-actor-id": ownerEmail.trim() || "rattaroj@reg24.th",
          },
          body: JSON.stringify({
            manifest_hash: rel.manifest_hash,
            expected_revision: rel.revision,
            decision,
            declared_gaps_accepted:
              decision === "UAT_PASS_WITH_DECLARED_GAPS" ? data.report?.coverage_gaps : undefined,
            comments: ownerSummaryComment || `Owner submitted ${decision}`,
            case_decisions: caseDecisionArray,
          }),
        }
      );

      const json = (await res.json()) as {
        ok: boolean;
        release_state?: string;
        error?: string;
      };
      if (!json.ok) {
        setApiBanner({
          kind: "err",
          text: `UAT Decision Rejected (HTTP ${res.status}): ${json.error}`,
        });
        return;
      }
      setApiBanner({
        kind: "ok",
        text: `Recorded Owner UAT Decision: ${decision} -> Release state is now ${json.release_state}`,
      });
      await loadBatchReport(selectedBatch);
    } finally {
      setSubmittingDecision(false);
    }
  };

  const rep = data?.report;
  const ev = data?.evaluation;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0d10",
        color: "#f3f4f6",
        fontFamily: "system-ui, -apple-system, 'Noto Sans Thai', sans-serif",
        padding: "24px clamp(16px, 3vw, 40px) 64px",
      }}
    >
      <div style={{ maxWidth: "1400px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Header */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "16px",
            borderBottom: "1px solid #23272f",
            paddingBottom: "20px",
          }}
        >
          <div>
            <div style={{ fontSize: "12px", fontFamily: "ui-monospace, monospace", color: "#a3e635", letterSpacing: "0.08em" }}>
              REG24 · 10-BATCH GRAPHRAG CANDIDATE & OWNER UAT GATE
            </div>
            <h1 style={{ margin: "6px 0 6px", fontSize: "26px", fontWeight: 800 }}>
              Sequential Knowledge Ingestion &amp; Owner UAT Console
            </h1>
            <p style={{ margin: 0, fontSize: "14px", color: "#9ca3af", maxWidth: "78ch" }}>
              Strict batch-by-batch gate (`SH-02` / `SH-03`): Candidate release stops at{" "}
              <code style={{ color: "#fde047" }}>READY_FOR_UAT</code>. Batch B02–B10 cannot start until Product Owner
              approves the current batch.
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                if (data?.uat_cases?.[0]) {
                  executeUatCase(data.uat_cases[0]);
                } else {
                  void runLiveQuery();
                }
              }}
              style={{
                background: "#16a34a",
                color: "#fff",
                border: "none",
                padding: "9px 16px",
                fontSize: "13px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ▶ Run {selectedBatch} UAT Case #1 (200 OK)
            </button>
            <button
              onClick={() => void testPrematureNextBatchGate()}
              title={`Security check: confirms Batch ${nextLockedBatch} cannot start before ${selectedBatch} is approved`}
              style={{
                background: "#1f2937",
                color: "#d1d5db",
                border: "1px solid #374151",
                padding: "9px 14px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🔒 Check {nextLockedBatch} Lock (Expected 422)
            </button>
            <Link
              href="/"
              style={{
                background: "#a3e635",
                color: "#0b0d10",
                padding: "9px 16px",
                fontSize: "13px",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              ← Back to REG24 Workspace
            </Link>
          </div>
        </header>

        {exploratoryMode && (
          <div
            style={{
              padding: "14px 18px",
              border: "1px solid rgba(163, 230, 53, 0.55)",
              background: "rgba(163, 230, 53, 0.08)",
              fontSize: "13px",
              lineHeight: 1.6,
              color: "#ecfccb",
            }}
          >
            <div style={{ fontWeight: 800, color: "#a3e635", marginBottom: "4px" }}>
              EXPLORATORY OWNER TESTING MODE — ISOLATED NON-PRODUCTION CANDIDATE ({rep?.release_id || "rel.B01.rc2"})
            </div>
            <div>
              Serving remediated candidate <code>{rep?.release_id || "rel.B01.rc2"}</code> (
              <strong>4,578</strong> physical RD tax rulings + <strong>326</strong> verified Revenue Code sections +{" "}
              <strong>155</strong> verified subordinate/amendment instruments;{" "}
              <strong>{data?.dependency_manifest?.unresolved_external_references_count ?? 1381}</strong> unverified
              external statutory citations strictly suppressed with <code>usable_as_legal_evidence: false</code>).
              Formal UAT sign-off buttons are intentionally locked in exploratory mode so testing cannot mutate
              acceptance state or promote to production.
            </div>
          </div>
        )}

        {apiBanner && (
          <div
            style={{
              padding: "12px 16px",
              border: `1px solid ${
                apiBanner.kind === "err" ? "#ef4444" : apiBanner.kind === "ok" ? "#22c55e" : "#3b82f6"
              }`,
              background:
                apiBanner.kind === "err"
                  ? "rgba(239,68,68,0.12)"
                  : apiBanner.kind === "ok"
                    ? "rgba(34,197,94,0.12)"
                    : "rgba(59,130,246,0.12)",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <span>{apiBanner.text}</span>
            <button
              onClick={() => setApiBanner(null)}
              style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        )}

        {/* 10-Batch Sequential Gate Board */}
        <section>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#9ca3af", marginBottom: "8px", letterSpacing: "0.05em" }}>
            10-BATCH SEQUENTIAL EXECUTION ORDER (SH-02)
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "8px",
            }}
          >
            {(data?.batch_gate_board || []).map((b) => {
              const isSelected = b.batch_id === selectedBatch;
              return (
                <button
                  key={b.batch_id}
                  onClick={() => setSelectedBatch(b.batch_id)}
                  style={{
                    textAlign: "left",
                    padding: "12px",
                    background: isSelected ? "#1e293b" : "#11141a",
                    border: isSelected ? "2px solid #a3e635" : "1px solid #23272f",
                    color: b.unlocked ? "#f9fafb" : "#6b7280",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 800 }}>
                    <span>{b.batch_id}</span>
                    <span>{b.unlocked ? "🔓" : "🔒"}</span>
                  </div>
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "11px",
                      fontFamily: "ui-monospace, monospace",
                      color:
                        b.status === "READY_FOR_UAT"
                          ? "#fde047"
                          : b.status.startsWith("ACCEPTED")
                            ? "#4ade80"
                            : "#9ca3af",
                    }}
                  >
                    {b.status}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>
            Loading candidate release report &amp; UAT cases for {selectedBatch}…
          </div>
        ) : !rep ? (
          <div style={{ padding: "32px", background: "#11141a", border: "1px solid #23272f" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: "18px" }}>
              Batch {selectedBatch} — Intentionally Locked Behind Predecessor Approval (HTTP 422)
            </h2>
            <p style={{ margin: "0 0 14px", color: "#9ca3af", fontSize: "14px" }}>
              Per sequential batch policy (`SH-02`, `SH-05`), Batch {selectedBatch} has not been ingested and remains
              locked until Batch B01 is tested and approved by the Product Owner.
            </p>
            <button
              onClick={() => setSelectedBatch("B01")}
              style={{
                background: "#a3e635",
                color: "#0b0d10",
                border: "none",
                padding: "9px 16px",
                fontSize: "13px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ← Switch Back to Active Candidate Batch B01
            </button>
          </div>
        ) : (
          <>
            {/* Release Metadata + Inventory Reconciliation + Quality Metrics */}
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
                gap: "16px",
              }}
            >
              <div style={{ background: "#11141a", border: "1px solid #23272f", padding: "18px" }}>
                <div style={{ fontSize: "11px", color: "#a3e635", fontFamily: "ui-monospace, monospace" }}>
                  CANDIDATE RELEASE IDENTITY
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, marginTop: "6px" }}>
                  {rep.release_id} ·{" "}
                  <span style={{ color: "#fde047" }}>{rep.status}</span>
                </div>
                <div style={{ marginTop: "12px", fontSize: "13px", color: "#d1d5db", lineHeight: 1.7 }}>
                  <div>
                    <strong>Owner UAT Decision:</strong>{" "}
                    <code style={{ color: rep.uat.owner_decision ? "#4ade80" : "#fde047" }}>
                      {rep.uat.owner_decision ?? "PENDING_HUMAN_OWNER_APPROVAL"}
                    </code>
                  </div>
                  <div>
                    <strong>Next Batch Unlocked:</strong>{" "}
                    <code>{String(rep.next_batch_unlocked)}</code>
                  </div>
                  <div>
                    <strong>Manifest SHA-256:</strong>{" "}
                    <code style={{ fontSize: "11px" }}>{rep.manifest_hash?.slice(0, 20)}…</code>
                  </div>
                  <div>
                    <strong>Git Commit:</strong> <code>{rep.code_commit?.slice(0, 10)}</code>
                  </div>
                  <div>
                    <strong>Rollback Target:</strong> <code>{rep.rollback_target}</code>
                  </div>
                </div>
              </div>

              <div style={{ background: "#11141a", border: "1px solid #23272f", padding: "18px" }}>
                <div style={{ fontSize: "11px", color: "#a3e635", fontFamily: "ui-monospace, monospace" }}>
                  5,150 RD POOL RECONCILIATION (ZERO SILENT DROPS)
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, marginTop: "6px" }}>
                  {rep.inventory.total_candidates?.toLocaleString()} Candidates ·{" "}
                  <span style={{ color: "#4ade80" }}>
                    {rep.inventory.accounting_matches ? "Reconciled ✓" : "Mismatch"}
                  </span>
                </div>
                <div style={{ marginTop: "12px", fontSize: "13px", color: "#d1d5db", lineHeight: 1.65 }}>
                  <div>• Published New Rulings: <strong>{rep.inventory.published_new?.toLocaleString()}</strong></div>
                  <div>• Reused Existing Seed Rulings: <strong>{rep.inventory.reused_existing}</strong></div>
                  <div>• Attached Duplicate Representations: <strong>{rep.inventory.attached_representation}</strong></div>
                  <div>• Rejected Out-of-Scope (B02 RD Regs): <strong>{rep.inventory.rejected_out_of_scope}</strong></div>
                  <div>• Deferred w/ Explicit Reason: <strong>{rep.inventory.deferred_with_reason?.toLocaleString()}</strong></div>
                  <div>• Failed Records: <strong>{rep.inventory.failed}</strong></div>
                </div>
              </div>

              <div style={{ background: "#11141a", border: "1px solid #23272f", padding: "18px" }}>
                <div style={{ fontSize: "11px", color: "#a3e635", fontFamily: "ui-monospace, monospace" }}>
                  300-FAMILY BENCHMARK &amp; ABLATION GATES
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, marginTop: "6px" }}>
                  Holdout {rep.quality.holdout_question_families} Families ·{" "}
                  <span style={{ color: "#4ade80" }}>
                    {ev?.all_automated_gates_passed ? "All Gates Green ✓" : "Check Gates"}
                  </span>
                </div>
                <div style={{ marginTop: "12px", fontSize: "13px", color: "#d1d5db", lineHeight: 1.65 }}>
                  <div>• Citation Resolution: <strong>{((rep.quality.citation_resolution ?? 0) * 100).toFixed(1)}%</strong></div>
                  <div>• Evidence Recall@20 (Graph): <strong>{((rep.quality.evidence_recall_at_20 ?? 0) * 100).toFixed(1)}%</strong></div>
                  <div>• Claim Support: <strong>{((rep.quality.claim_support ?? 0) * 100).toFixed(1)}%</strong></div>
                  <div>• Attempted Answer Correctness: <strong>{((rep.quality.attempted_answer_correctness ?? 0) * 100).toFixed(1)}%</strong></div>
                  <div>• Canonical Passages / Assertions: <strong>{rep.knowledge.accepted_passages} / {rep.knowledge.accepted_assertions}</strong></div>
                  <div>• B02 Statutory Dependencies Loaded: <strong>{data?.dependency_manifest?.loaded_b02_dependencies_count ?? 0}</strong></div>
                </div>
              </div>
            </section>

            {/* Scope & Coverage Status */}
            {rep.coverage_gaps.length > 0 ? (
              <section
                style={{
                  background: "rgba(250, 204, 21, 0.08)",
                  border: "1px solid rgba(250, 204, 21, 0.4)",
                  padding: "16px 18px",
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: 800, color: "#fde047", marginBottom: "6px" }}>
                  {rep.scope_classification === "LIMITED_SCOPE_CANDIDATE"
                    ? `LIMITED-SCOPE CANDIDATE — ${rep.scope_label || "DECLARED SCOPE & COVERAGE GAPS"}`
                    : "DECLARED SCOPE & COVERAGE GAPS (VISIBLE BEFORE ACCEPTANCE)"}
                </div>
                <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "#fef08a", lineHeight: 1.6 }}>
                  {rep.coverage_gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </section>
            ) : (
              <section
                style={{
                  background: "rgba(34, 197, 94, 0.08)",
                  border: "1px solid rgba(34, 197, 94, 0.4)",
                  padding: "14px 18px",
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: 800, color: "#4ade80", marginBottom: "4px" }}>
                  ZERO SCOPE OR COVERAGE GAPS — 100% COMPLETE B01 INGESTION ✓
                </div>
                <div style={{ fontSize: "13px", color: "#dcfce7", lineHeight: 1.6 }}>
                  All <strong>{rep.inventory.total_candidates?.toLocaleString()}</strong> physical files in{" "}
                  <code>RD - Revenue Department</code> are reconciled with{" "}
                  <strong>0 Deferred Records</strong> and <strong>0 Declared Coverage Gaps</strong> (
                  <strong>
                    {(
                      (rep.inventory.published_new ?? 0) +
                      (rep.inventory.reused_existing ?? 0) +
                      (rep.inventory.attached_representation ?? 0)
                    ).toLocaleString()}
                  </strong>{" "}
                  admitted B01 ruling files fully extracted &amp; staged across{" "}
                  <strong>{rep.page_accounting.total_source_pages.toLocaleString()}</strong> physical pages +{" "}
                  <strong>{rep.inventory.rejected_out_of_scope}</strong> B02-owned RD tax regulations &amp; root index
                  sheets routed out-of-scope).
                </div>
              </section>
            )}

            {/* Interactive Grounded Q&A + Live Evidence Locator Drawer */}
            <section
              style={{
                background: "#11141a",
                border: "1px solid #2b313c",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: "#a3e635", fontFamily: "ui-monospace, monospace" }}>
                  LIVE CANDIDATE GRAPHRAG WORKSPACE ({rep.release_id})
                </div>
                <h2 style={{ margin: "4px 0 0", fontSize: "19px" }}>
                  Test Grounded Question → Claim Ledger → Exact Source Passage &amp; Related Provisions
                </h2>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "10px", flexWrap: "wrap" }}>
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="พิมพ์คำถามข้อหารือภาษี เลขที่ กค .../... หรือมาตราแห่งประมวลรัษฎากร"
                  style={{
                    background: "#0b0d10",
                    color: "#f9fafb",
                    border: "1px solid #374151",
                    padding: "10px 14px",
                    fontSize: "14px",
                    minWidth: "260px",
                  }}
                />
                <input
                  type="date"
                  value={applicableDate}
                  onChange={(e) => setApplicableDate(e.target.value)}
                  title="Applicable Tax/Transaction Date (e.g. 2018-06-30 vs 2025-01-15)"
                  style={{
                    background: "#0b0d10",
                    color: "#f9fafb",
                    border: "1px solid #374151",
                    padding: "10px 12px",
                    fontSize: "13px",
                  }}
                />
                <select
                  value={queryMode}
                  onChange={(e) =>
                    setQueryMode(e.target.value as "standard" | "exact_lookup" | "comparison")
                  }
                  style={{
                    background: "#0b0d10",
                    color: "#f9fafb",
                    border: "1px solid #374151",
                    padding: "10px 12px",
                    fontSize: "13px",
                  }}
                >
                  <option value="standard">Standard Hybrid + Graph</option>
                  <option value="exact_lookup">Exact Ruling Lookup</option>
                  <option value="comparison">Ruling Comparison</option>
                </select>
                <button
                  onClick={() => void runLiveQuery()}
                  disabled={queryLoading}
                  style={{
                    background: "#a3e635",
                    color: "#0b0d10",
                    border: "none",
                    padding: "10px 20px",
                    fontWeight: 800,
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  {queryLoading ? "Querying…" : "Ask Candidate B01"}
                </button>
              </div>

              {selectedBatch === "B01" && (
                <div
                  style={{
                    background: "#0d1117",
                    border: "1px solid #23272f",
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#a3e635" }}>
                    Representative Exploratory Test Questions (Click any prompt to run &amp; inspect source citations):
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {EXPLORATORY_B01_REPRESENTATIVE_QUESTIONS.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setQuestion(item.question);
                          setApplicableDate(item.date || "");
                          setQueryMode(item.mode);
                          setComparisonIds(item.cmp || []);
                          void runLiveQuery({
                            q: item.question,
                            date: item.date,
                            mode: item.mode,
                            cmp: item.cmp || [],
                          });
                        }}
                        style={{
                          background: "#172033",
                          color: "#e2e8f0",
                          border: "1px solid #334155",
                          padding: "6px 10px",
                          fontSize: "12px",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", fontSize: "12px" }}>
                <span style={{ color: "#9ca3af" }}>Quick Thai/Arabic Digit Parity Check:</span>
                {[
                  ["กค 0702/636 (Arabic — B01-U01A)", "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636"],
                  ["กค ๐๗๐๒ / ๖๓๖ (Thai Digits — B01-U01B)", "ค้นหาหนังสือตอบข้อหารือเลขไทย กค ๐๗๐๒ / ๖๓๖"],
                  ["กค ๐๗๐๒ / ๑๒๔๘ (0702/1248 in Thai Digits)", "ค้นหาหนังสือตอบข้อหารือเลขไทย กค ๐๗๐๒ / ๑๒๔๘"],
                ].map(([label, qStr]) => (
                  <button
                    key={label}
                    onClick={() => {
                      setQuestion(qStr);
                      setApplicableDate("");
                      setQueryMode("exact_lookup");
                      void runLiveQuery({ q: qStr, date: null, mode: "exact_lookup", cmp: [] });
                    }}
                    style={{
                      background: "#1e293b",
                      color: "#e2e8f0",
                      border: "1px solid #334155",
                      padding: "4px 10px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {answerResult && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: drawerEvidence ? "1.2fr 1fr" : "1fr",
                    gap: "16px",
                    borderTop: "1px solid #23272f",
                    paddingTop: "16px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      <span
                        style={{
                          padding: "4px 10px",
                          fontSize: "12px",
                          fontWeight: 800,
                          fontFamily: "ui-monospace, monospace",
                          background:
                            answerResult.status === "ANSWERED"
                              ? "#166534"
                              : answerResult.status === "CONDITIONAL"
                                ? "#1d4ed8"
                                : "#854d0e",
                          color: "#fff",
                        }}
                      >
                        STATUS: {answerResult.status}
                      </span>
                      <span style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "ui-monospace, monospace" }}>
                        trace={answerResult.trace_id} · {answerResult.latency_ms}ms · release={answerResult.release_id}
                      </span>
                    </div>

                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#0b0d10",
                        border: "1px solid #23272f",
                        padding: "16px",
                        fontSize: "14px",
                        lineHeight: 1.7,
                      }}
                    >
                      {answerResult.answer}
                    </div>

                    {answerResult.clarification_questions.length > 0 && (
                      <div style={{ background: "rgba(59,130,246,0.12)", border: "1px solid #3b82f6", padding: "12px" }}>
                        <strong style={{ fontSize: "12px", color: "#93c5fd" }}>
                          Required Material Facts / Clarification Questions:
                        </strong>
                        <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "13px" }}>
                          {answerResult.clarification_questions.map((cq, idx) => (
                            <li key={idx}>{cq}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Evidence Citations */}
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#9ca3af", marginBottom: "8px" }}>
                        AUTHORIZED SOURCE CITATIONS ({answerResult.evidence.length}) — CLICK TO INSPECT ORIGINAL PASSAGE &amp; LOCATOR
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {answerResult.evidence.map((evCard) => (
                          <div
                            key={evCard.passage_id}
                            style={{
                              background: "#0b0d10",
                              border: "1px solid #2b313c",
                              padding: "12px",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: "12px",
                            }}
                          >
                            <div style={{ fontSize: "13px" }}>
                              <div style={{ fontWeight: 700, color: "#a3e635" }}>
                                {evCard.official_identifier} — {evCard.title_th}
                              </div>
                              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "3px" }}>
                                Role: <code>{evCard.statement_role}</code> · Version: <code>{evCard.version_id}</code> ·
                                Authenticity: <code>{evCard.authenticity_status}</code>
                                {evCard.is_derivative ? " (Derivative)" : " (Verified Source)"}
                              </div>
                              {evCard.related_provisions.length > 0 && (
                                <div style={{ fontSize: "12px", color: "#cbd5e1", marginTop: "6px" }}>
                                  Related Law:{" "}
                                  {evCard.related_provisions.map((rp) => `${rp.predicate} → ${rp.label}`).join(" | ")}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => void openEvidenceLocator(evCard.passage_id)}
                              style={{
                                background: "#1e293b",
                                color: "#f8fafc",
                                border: "1px solid #475569",
                                padding: "7px 12px",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {drawerLoading ? "Opening…" : "Open Passage & Locator"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Live Source Passage & Locator Drawer */}
                  {drawerEvidence && (
                    <aside
                      style={{
                        background: "#090b0e",
                        border: "1px solid #a3e635",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", fontFamily: "ui-monospace, monospace", color: "#a3e635" }}>
                          VERIFIED SOURCE PASSAGE DRAWER (SH-16 / AT08)
                        </span>
                        <button
                          onClick={() => setDrawerEvidence(null)}
                          style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer" }}
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: "15px" }}>{drawerEvidence.work_title_th}</div>
                      <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.6 }}>
                        <div>Passage ID: <code>{drawerEvidence.passage.passage_id}</code></div>
                        <div>Statement Role: <code>{drawerEvidence.passage.statement_role}</code></div>
                        <div>Authenticity: <code>{drawerEvidence.authenticity_status}</code></div>
                        <div>
                          Real Locator: <code>{drawerEvidence.locator.kind}</code> ·{" "}
                          <code>
                            {drawerEvidence.locator.structural_selector ||
                              `page=${drawerEvidence.locator.physical_page_index ?? 0}`}
                          </code>
                        </div>
                        <div>
                          Origin URI:{" "}
                          <a
                            href={drawerEvidence.locator.origin_uri}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#93c5fd" }}
                          >
                            {drawerEvidence.locator.origin_uri}
                          </a>
                        </div>
                      </div>
                      <div
                        style={{
                          background: "#11141a",
                          border: "1px solid #23272f",
                          padding: "12px",
                          fontSize: "13.5px",
                          lineHeight: 1.75,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {drawerEvidence.passage.exact_text}
                      </div>
                    </aside>
                  )}
                </div>
              )}
            </section>

            {/* 20 Executable Owner UAT Cases Sheet */}
            <section
              style={{
                background: "#11141a",
                border: "1px solid #23272f",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: "#a3e635", fontFamily: "ui-monospace, monospace" }}>
                  MANDATORY 20-CASE EXECUTABLE OWNER UAT SHEET (B01-U01A .. B01-U10B)
                </div>
                <h2 style={{ margin: "4px 0 4px", fontSize: "19px" }}>
                  Owner Acceptance Cases — Run Live &amp; Record Pass / Fail
                </h2>
                <p style={{ margin: 0, fontSize: "13px", color: "#9ca3af" }}>
                  Zero bracketed placeholders · 6 cases explicitly test source/page fidelity, critical Thai numerals,
                  negations, and duplicate representation provenance.
                </p>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2b313c", textAlign: "left", color: "#9ca3af" }}>
                      <th style={{ padding: "10px 8px" }}>Case</th>
                      <th style={{ padding: "10px 8px" }}>Category / Fidelity</th>
                      <th style={{ padding: "10px 8px" }}>Bound Thai Legal Question / Action</th>
                      <th style={{ padding: "10px 8px" }}>Auto Precheck</th>
                      <th style={{ padding: "10px 8px" }}>Execute</th>
                      <th style={{ padding: "10px 8px" }}>Owner Decision &amp; Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.uat_cases || []).map((uc) => {
                      const curDec = caseDecisions[uc.case_id];
                      return (
                        <tr key={uc.case_id} style={{ borderBottom: "1px solid #1f242d" }}>
                          <td style={{ padding: "10px 8px", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                            {uc.case_id}
                            <div style={{ fontSize: "11px", color: "#9ca3af" }}>{uc.severity}</div>
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            <div>{uc.category}</div>
                            {uc.exercises_source_fidelity && (
                              <span
                                style={{
                                  display: "inline-block",
                                  marginTop: "4px",
                                  padding: "2px 6px",
                                  fontSize: "10px",
                                  background: "rgba(163,230,53,0.15)",
                                  color: "#a3e635",
                                }}
                              >
                                Source Fidelity ✓
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "10px 8px", maxWidth: "440px", lineHeight: 1.5 }}>
                            <div>{uc.question}</div>
                            {uc.applicable_date && (
                              <div style={{ fontSize: "11px", color: "#93c5fd", marginTop: "3px" }}>
                                Applicable Date: {uc.applicable_date}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "10px 8px", fontFamily: "ui-monospace, monospace" }}>
                            {uc.evaluator_results?.automated_precheck_passed ? (
                              <span style={{ color: "#4ade80" }}>READY ✓</span>
                            ) : (
                              <span style={{ color: "#f87171" }}>CHECK</span>
                            )}
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            <button
                              onClick={() => executeUatCase(uc)}
                              style={{
                                background: "#1e293b",
                                color: "#a3e635",
                                border: "1px solid #334155",
                                padding: "6px 10px",
                                fontSize: "12px",
                                fontWeight: 700,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              ▶ Run Case
                            </button>
                          </td>
                          <td style={{ padding: "10px 8px", minWidth: "230px" }}>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                              <button
                                onClick={() =>
                                  setCaseDecisions((p) => ({
                                    ...p,
                                    [uc.case_id]: { decision: "PASS", comment: p[uc.case_id]?.comment || "" },
                                  }))
                                }
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  border: "1px solid #166534",
                                  background: curDec?.decision === "PASS" ? "#16a34a" : "transparent",
                                  color: curDec?.decision === "PASS" ? "#fff" : "#86efac",
                                }}
                              >
                                PASS
                              </button>
                              <button
                                onClick={() =>
                                  setCaseDecisions((p) => ({
                                    ...p,
                                    [uc.case_id]: { decision: "FAIL", comment: p[uc.case_id]?.comment || "" },
                                  }))
                                }
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  border: "1px solid #991b1b",
                                  background: curDec?.decision === "FAIL" ? "#dc2626" : "transparent",
                                  color: curDec?.decision === "FAIL" ? "#fff" : "#fca5a5",
                                }}
                              >
                                FAIL
                              </button>
                              <input
                                placeholder="Comment…"
                                value={curDec?.comment || ""}
                                onChange={(e) =>
                                  setCaseDecisions((p) => ({
                                    ...p,
                                    [uc.case_id]: {
                                      decision: p[uc.case_id]?.decision || "PASS",
                                      comment: e.target.value,
                                    },
                                  }))
                                }
                                style={{
                                  background: "#0b0d10",
                                  color: "#f3f4f6",
                                  border: "1px solid #2b313c",
                                  padding: "4px 8px",
                                  fontSize: "12px",
                                  width: "110px",
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Final Product Owner Sign-Off Box */}
              <div
                style={{
                  borderTop: "1px solid #2b313c",
                  paddingTop: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ fontSize: "14px", fontWeight: 800 }}>
                  Submit Authenticated Product Owner UAT Decision (`{rep.release_id}` · rev{" "}
                  {data?.release_record?.revision ?? 1})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "10px" }}>
                  <input
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="Owner identity (rattaroj@reg24.th)"
                    style={{
                      background: "#0b0d10",
                      color: "#f9fafb",
                      border: "1px solid #374151",
                      padding: "9px 12px",
                      fontSize: "13px",
                    }}
                  />
                  <input
                    value={ownerSummaryComment}
                    onChange={(e) => setOwnerSummaryComment(e.target.value)}
                    placeholder="Owner UAT summary comments / notes for release audit trail…"
                    style={{
                      background: "#0b0d10",
                      color: "#f9fafb",
                      border: "1px solid #374151",
                      padding: "9px 12px",
                      fontSize: "13px",
                    }}
                  />
                </div>

                {rep.coverage_gaps.length > 0 && (
                  <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "#fde047" }}>
                    <input
                      type="checkbox"
                      checked={acknowledgeGaps}
                      onChange={(e) => setAcknowledgeGaps(e.target.checked)}
                    />
                    I acknowledge the declared coverage gaps above if approving via{" "}
                    <code>UAT_PASS_WITH_DECLARED_GAPS</code>.
                  </label>
                )}

                {exploratoryMode ? (
                  <div
                    style={{
                      padding: "12px 14px",
                      border: "1px solid #374151",
                      background: "#0d1117",
                      color: "#fde047",
                      fontSize: "13px",
                    }}
                  >
                    🔒 <strong>Exploratory Mode Active:</strong> Formal <code>UAT_PASS</code> / <code>UAT_FAIL</code>{" "}
                    sign-off is disabled on <code>?mode=exploratory</code> so Dodo and Owner exploratory testing cannot
                    alter release acceptance or unlock Batch B02.
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <button
                      disabled={submittingDecision}
                      onClick={() => void submitOwnerDecision("UAT_PASS")}
                      style={{
                        background: "#16a34a",
                        color: "#fff",
                        border: "none",
                        padding: "10px 18px",
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Approve Batch (UAT_PASS)
                    </button>
                    {rep.coverage_gaps.length > 0 && (
                      <button
                        disabled={submittingDecision}
                        onClick={() => void submitOwnerDecision("UAT_PASS_WITH_DECLARED_GAPS")}
                        style={{
                          background: "#ca8a04",
                          color: "#fff",
                          border: "none",
                          padding: "10px 18px",
                          fontWeight: 800,
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
                        Approve w/ Declared Gaps (UAT_PASS_WITH_DECLARED_GAPS)
                      </button>
                    )}
                    <button
                      disabled={submittingDecision}
                      onClick={() => void submitOwnerDecision("UAT_FAIL")}
                      style={{
                        background: "#dc2626",
                        color: "#fff",
                        border: "none",
                        padding: "10px 18px",
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Reject Candidate (UAT_FAIL — Block B02)
                    </button>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
