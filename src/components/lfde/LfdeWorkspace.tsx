"use client";

import React, { useState, useEffect, useCallback } from "react";
import type {
  AgiMissionExecution,
  ClauseVersion,
  DocumentCase,
  DraftRevision,
  ExportArtifact,
  FactCandidate,
  FilingProfileVersion,
  Template,
  TemplateVersion,
  ValidationRun,
  WorkflowTask,
} from "@/core/lfde/types";

interface TemplateSearchItem {
  template: Template;
  version: TemplateVersion;
  scores: {
    intent_match_score: number;
    extraction_confidence: number;
    verification_status: "verified" | "unknown";
  };
  explanation_th: string;
  explanation_en: string;
}

interface DocumentDetailResponse {
  status: string;
  document: DocumentCase;
  template_version: TemplateVersion;
  facts: FactCandidate[];
  trace: {
    document: DocumentCase;
    plain_timeline: Array<{ step: string; label_th: string; label_en: string; done: boolean }>;
    revisions: DraftRevision[];
    validation_runs: ValidationRun[];
    exports: ExportArtifact[];
  };
}

export interface LfdeDocumentsScreenProps {
  isTh: boolean;
  isMax: boolean;
  initialObjective?: string;
  onClearInitialObjective?: () => void;
  onAskAi?: (q: string) => void;
}

export function LfdeDocumentsScreen({
  isTh,
  isMax,
  initialObjective,
  onClearInitialObjective,
}: LfdeDocumentsScreenProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [templates, setTemplates] = useState<TemplateSearchItem[]>([]);
  const [clauses, setClauses] = useState<ClauseVersion[]>([]);
  const [filingProfiles, setFilingProfiles] = useState<FilingProfileVersion[]>([]);
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] =
    useState<string>("template_demo_nda_v1");
  const [objectiveInput, setObjectiveInput] = useState<string>(
    initialObjective ||
      (isTh
        ? "จัดทำสัญญารักษาความลับสองฝ่ายสำหรับการตรวจสอบสถานะกิจการ (M&A Due Diligence)"
        : "Draft a mutual NDA for M&A due diligence in Thailand")
  );
  const [asOfDate, setAsOfDate] = useState<string>("2026-10-23");
  const [activeDetail, setActiveDetail] = useState<DocumentDetailResponse | null>(null);
  const [factDraft, setFactDraft] = useState<Record<string, unknown>>({});
  const [selectedClauseIds, setSelectedClauseIds] = useState<string[]>([]);
  const [reviewDecisionNotes, setReviewDecisionNotes] = useState<string>(
    "Verified against CCC Book III, PDPA B.E. 2562, and firm commercial playbook."
  );
  const [selectedFilingProfileId, setSelectedFilingProfileId] = useState<string>(
    "profile_dbd_incorporation_v1"
  );
  const [downloadSessionInfo, setDownloadSessionInfo] = useState<{
    session_id: string;
    expires_at: string;
    export_id: string;
  } | null>(null);
  const [activeMission, setActiveMission] = useState<AgiMissionExecution | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const MUT = "color-mix(in srgb,var(--color-text) 62%,transparent)";
  const tint = "color-mix(in srgb,var(--color-text) 6%,transparent)";

  const loadWorkspace = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/lfde");
      if (!res.ok) return;
      const data = await res.json();
      const snap = data.snapshot;
      if (snap) {
        setTemplates(snap.templates || []);
        setClauses(snap.clauses || []);
        setFilingProfiles(snap.filing_profiles || []);
      }
    } catch {
      // Ignore network errors
    }
  }, []);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (initialObjective) {
      setObjectiveInput(initialObjective);
      if (initialObjective.includes("1097") || initialObjective.toLowerCase().includes("board")) {
        setSelectedTemplateVersionId("template_demo_board_res_v1");
      } else if (
        initialObjective.toLowerCase().includes("lease") ||
        initialObjective.includes("เช่า")
      ) {
        setSelectedTemplateVersionId("template_demo_lease_v1");
      } else if (
        initialObjective.toLowerCase().includes("msa") ||
        initialObjective.includes("บริการ")
      ) {
        setSelectedTemplateVersionId("template_demo_msa_v1");
      }
      if (onClearInitialObjective) onClearInitialObjective();
    }
  }, [initialObjective, onClearInitialObjective]);

  const refreshDocumentDetail = async (docId: string) => {
    const res = await fetch(`/api/v1/lfde/documents/${docId}`);
    if (res.ok) {
      const json = (await res.json()) as DocumentDetailResponse;
      setActiveDetail(json);
      setSelectedClauseIds(json.document.selected_clause_ids || []);
      return json;
    }
    return null;
  };

  const handleCreateDraft = async () => {
    setLoading(true);
    setStatusBanner(null);
    try {
      const defaultFacts: Record<string, unknown> = {};
      if (selectedTemplateVersionId === "template_demo_nda_v1") {
        defaultFacts["party_a.name"] = "บริษัท สยาม โซลาร์ โฮลดิ้งส์ จำกัด";
        defaultFacts["party_a.registration_number"] = "0105564019283";
        defaultFacts["party_b.name"] = "บริษัท อีอีซี คลีน เอนเนอร์จี จำกัด";
        defaultFacts["transaction.purpose"] =
          "การตรวจสอบสถานะกิจการและการเจรจาร่วมทุนโครงการพลังงานแสงอาทิตย์";
        defaultFacts["dates.effective_date"] = asOfDate;
        defaultFacts["signatory.evidence_ref"] = "DBD-CERT-2569-00182";
      } else if (selectedTemplateVersionId === "template_demo_board_res_v1") {
        defaultFacts["party_a.name"] = "บริษัท เร็ก24 เทคโนโลยี จำกัด";
        defaultFacts["transaction.promoter_count"] = asOfDate < "2023-02-07" ? "3" : "2";
        defaultFacts["signatory.evidence_ref"] = "DBD-ID-PROMOTERS-2569";
      } else if (selectedTemplateVersionId === "template_demo_msa_v1") {
        defaultFacts["party_a.name"] = "บริษัท ไทย อินดัสเทรียล กรุ๊ป จำกัด";
        defaultFacts["party_b.name"] = "REG24 Legal Intelligence Co., Ltd.";
        defaultFacts["transaction.paid"] = true;
        defaultFacts["transaction.fee"] = "1200000.00";
        defaultFacts["transaction.installment_1"] = "600000.00";
        defaultFacts["transaction.installment_2"] = "600000.00";
        defaultFacts["signatory.evidence_ref"] = "POA-MSA-2569-09";
      } else if (selectedTemplateVersionId === "template_demo_lease_v1") {
        defaultFacts["party_a.name"] = "บริษัท สาทร พร็อพเพอร์ตี้ จำกัด";
        defaultFacts["party_b.name"] = "บริษัท ลอว์24 โซลูชั่นส์ จำกัด";
        defaultFacts["signatory.evidence_ref"] = "TITLE-DEED-SATHORN-881";
      } else if (selectedTemplateVersionId === "template_lform_dol_td15_v1") {
        defaultFacts["party_a.name"] = "บริษัท อีอีซี คลีน เอนเนอร์จี จำกัด";
        defaultFacts["party_b.name"] = "ธนาคารกรุงเทพ จำกัด (มหาชน)";
        defaultFacts["land.title_deed_ref"] =
          "โฉนดเลขที่ 88421 เลขที่ดิน 19 ตำบลมาบตาพุด อำเภอเมืองระยอง จังหวัดระยอง วงเงินจำนอง 120,000,000 บาท";
        defaultFacts["signatory.evidence_ref"] = "DOL-TD21-POA-2569-014";
      } else if (selectedTemplateVersionId === "template_lform_tax_court_ps1_v1") {
        defaultFacts["party_a.name"] = "บริษัท สยาม โซลาร์ โฮลดิ้งส์ จำกัด";
        defaultFacts["party_b.name"] = "กรมสรรพากร กับพวก";
        defaultFacts["signatory.evidence_ref"] = "กอ.12/2569 และใบแต่งทนายความ ภษ.2569";
      } else if (selectedTemplateVersionId === "template_lform_coj_plaint_a4_v1") {
        defaultFacts["party_a.name"] = "บริษัท เร็ก24 เทคโนโลยี จำกัด";
        defaultFacts["party_b.name"] = "บริษัท เอเชีย ซัพพลายเชน จำกัด";
        defaultFacts["signatory.evidence_ref"] = "COJ-FORM7-COUNSEL-2569-099";
      } else if (selectedTemplateVersionId === "template_lform_labour_rn1_v1") {
        defaultFacts["party_a.name"] = "นายสมชาย รักงานดี";
        defaultFacts["party_b.name"] = "บริษัท ไทย อินดัสเทรียล กรุ๊ป จำกัด";
        defaultFacts["signatory.evidence_ref"] = "EMP-CONTRACT-2567-112";
      } else if (selectedTemplateVersionId === "template_lform_led_rehab_f20_v1") {
        defaultFacts["party_a.name"] = "ธนาคารกสิกรไทย จำกัด (มหาชน)";
        defaultFacts["party_b.name"] = "บริษัท เมกะ พาวเวอร์ โฮลดิ้งส์ จำกัด (มหาชน)";
        defaultFacts["signatory.evidence_ref"] = "LED-F20KOR-SCHEDULE-2569-01";
      } else if (selectedTemplateVersionId === "template_lform_admin_court_k1_v1") {
        defaultFacts["party_a.name"] = "บริษัท อีอีซี คลีน เอนเนอร์จี จำกัด";
        defaultFacts["party_b.name"] = "คณะกรรมการกำกับกิจการพลังงาน (กกพ.)";
        defaultFacts["signatory.evidence_ref"] = "ERC-APPEAL-ORDER-44/2569";
      }

      const res = await fetch("/api/v1/lfde/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matter_id: "matter.law24.ma.2026.01",
          template_version_id: selectedTemplateVersionId,
          objective: objectiveInput,
          legal_as_of_date: asOfDate,
          transaction_date: asOfDate,
          initial_facts: defaultFacts,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatusBanner({ type: "error", text: json.message || "Failed to create draft" });
      } else {
        await refreshDocumentDetail(json.document.id);
        setFactDraft(defaultFacts);
        setStep(2);
        setStatusBanner({
          type: "ok",
          text: isTh
            ? `สร้างแฟ้มเอกสาร ${json.document.id} และตรึงวันที่มีผลทางกฎหมาย ${asOfDate} เรียบร้อยแล้ว`
            : `Created DocumentCase ${json.document.id} pinned to legal date ${asOfDate}.`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFactsAndConfirmAll = async () => {
    if (!activeDetail) return;
    setLoading(true);
    setStatusBanner(null);
    try {
      const changes = Object.entries(factDraft).map(([field_key, value]) => ({
        field_key,
        value,
        action: "confirm_candidate" as const,
        confidence: 1.0,
        source_evidence_id: "ui_confirmed_ledger",
      }));

      const res = await fetch(`/api/v1/lfde/documents/${activeDetail.document.id}/facts`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": activeDetail.document.etag,
        },
        body: JSON.stringify({
          changes,
          selected_clause_ids: selectedClauseIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatusBanner({ type: "error", text: json.message || "Failed to update facts" });
      } else {
        await refreshDocumentDetail(activeDetail.document.id);
        setStatusBanner({
          type: "ok",
          text: isTh
            ? `ยืนยันข้อเท็จจริงครบ ${changes.length} รายการ (ETag: ${json.document.etag})`
            : `Confirmed ${changes.length} typed facts in ledger (ETag: ${json.document.etag}).`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAssemble = async () => {
    if (!activeDetail) return;
    setLoading(true);
    setStatusBanner(null);
    try {
      const changes = Object.entries(factDraft).map(([field_key, value]) => ({
        field_key,
        value,
        action: "confirm_candidate" as const,
        confidence: 1.0,
        source_evidence_id: "ui_confirmed_ledger",
      }));

      await fetch(`/api/v1/lfde/documents/${activeDetail.document.id}/facts`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": activeDetail.document.etag,
        },
        body: JSON.stringify({
          changes,
          selected_clause_ids: selectedClauseIds,
        }),
      });

      const res = await fetch(`/api/v1/lfde/documents/${activeDetail.document.id}/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "deterministic",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatusBanner({ type: "error", text: json.message || "Assembly failed" });
      } else {
        await refreshDocumentDetail(activeDetail.document.id);
        setStep(3);
        setStatusBanner({
          type: "ok",
          text: isTh
            ? `ประกอบร่างเอกสาร Revision #${json.revision.revision_number} สำเร็จ (SHA-256: ${json.revision.content_hash.slice(0, 14)}…)`
            : `Assembled Revision #${json.revision.revision_number} deterministically (SHA-256: ${json.revision.content_hash.slice(0, 14)}…).`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRunValidation = async () => {
    if (!activeDetail) return;
    setLoading(true);
    setStatusBanner(null);
    try {
      const res = await fetch(`/api/v1/lfde/documents/${activeDetail.document.id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (res.ok) {
        await refreshDocumentDetail(activeDetail.document.id);
        setStep(4);
        const passed = !json.validation.has_unresolved_blockers;
        setStatusBanner({
          type: passed ? "ok" : "error",
          text: passed
            ? isTh
              ? "ผ่านการตรวจสอบความถูกต้องครบทุกชั้น (พร้อมส่งตรวจอนุมัติ)"
              : "All deterministic validation layers passed (Review Ready)."
            : isTh
            ? `พบข้อสังเกตที่ต้องแก้ไข ${json.validation.findings.length} รายการ`
            : `Found ${json.validation.findings.length} validation finding(s).`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAndApproveReview = async () => {
    if (!activeDetail) return;
    setLoading(true);
    setStatusBanner(null);
    try {
      const reqRes = await fetch(
        `/api/v1/lfde/documents/${activeDetail.document.id}/review-requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision_id: activeDetail.document.current_revision_id,
            assigned_reviewers: ["approver.partner@law24.th"],
          }),
        }
      );
      const reqJson = await reqRes.json();
      if (!reqRes.ok) {
        setStatusBanner({ type: "error", text: reqJson.message || "Review request failed" });
        return;
      }

      const refreshed = await refreshDocumentDetail(activeDetail.document.id);
      const currentEtag = refreshed?.document.etag || activeDetail.document.etag;

      const decRes = await fetch(
        `/api/v1/lfde/review-requests/${reqJson.review_request.id}/decisions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": currentEtag,
          },
          body: JSON.stringify({
            decision: "approve",
            reason: reviewDecisionNotes,
          }),
        }
      );
      const decJson = await decRes.json();
      if (!decRes.ok) {
        setStatusBanner({ type: "error", text: decJson.message || "Approval failed" });
      } else {
        await refreshDocumentDetail(activeDetail.document.id);
        setStep(5);
        setStatusBanner({
          type: "ok",
          text: isTh
            ? `อนุมัติเอกสารโดยผู้ตรวจกฎหมายสำเร็จ (Grant: ${decJson.decision.reviewer_grant_id})`
            : `Approved by Human Legal Reviewer (Grant: ${decJson.decision.reviewer_grant_id}). Ready for FINAL export.`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExportDocument = async (mode: "draft" | "final", format: "docx" | "pdf") => {
    if (!activeDetail) return;
    setLoading(true);
    setStatusBanner(null);
    try {
      const res = await fetch(`/api/v1/lfde/documents/${activeDetail.document.id}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_revision_id: activeDetail.document.current_revision_id,
          mode,
          format,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatusBanner({ type: "error", text: json.message || "Export blocked" });
        return;
      }

      const dlRes = await fetch(
        `/api/v1/lfde/exports/${json.export_artifact.id}/download-session`,
        { method: "POST" }
      );
      const dlJson = await dlRes.json();
      if (dlRes.ok) {
        setDownloadSessionInfo(dlJson.download_session);
      }

      await refreshDocumentDetail(activeDetail.document.id);
      setStatusBanner({
        type: "ok",
        text: isTh
          ? `ส่งออกไฟล์ ${json.export_artifact.id}.${format} (${mode.toUpperCase()}) พร้อม Lineage Manifest เรียบร้อยแล้ว`
          : `Exported ${json.export_artifact.id}.${format} (${mode.toUpperCase()}) with immutable Lineage Manifest.`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBuildFilingPackage = async () => {
    if (!activeDetail) return;
    setLoading(true);
    setStatusBanner(null);
    try {
      const finalExports = activeDetail.trace.exports.filter((e) => e.mode === "final");
      if (finalExports.length === 0) {
        setStatusBanner({
          type: "error",
          text: isTh
            ? "กรุณาส่งออกเอกสารฉบับสมบูรณ์ (FINAL Export) อย่างน้อย 1 รายการก่อนจัดชุดเอกสารยื่นหน่วยงาน"
            : "Please create at least one approved FINAL export artifact before building a filing package.",
        });
        return;
      }

      const res = await fetch("/api/v1/lfde/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matter_id: activeDetail.document.matter_id,
          profile_version_id: selectedFilingProfileId,
          export_artifact_ids: finalExports.map((e) => e.id),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setStatusBanner({
          type: "ok",
          text: isTh
            ? `สร้างชุดเอกสารเตรียมยื่นหน่วยงาน ${json.filing_package.id} (${json.filing_package.status_label})`
            : `Created Filing Package ${json.filing_package.id} (${json.filing_package.status_label}).`,
        });
      } else {
        setStatusBanner({ type: "error", text: json.message || "Package creation failed" });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRunAgiMission = async (
    missionType: AgiMissionExecution["mission_type"]
  ) => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/lfde/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_type: missionType,
          topology: "team",
          automation: "supervised",
          objective: objectiveInput,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setActiveMission(json.mission);
      }
    } finally {
      setLoading(false);
    }
  };

  const latestRevision =
    activeDetail?.trace.revisions[activeDetail.trace.revisions.length - 1] || null;
  const latestValidation =
    activeDetail?.trace.validation_runs[activeDetail.trace.validation_runs.length - 1] || null;
  const latestExport =
    activeDetail?.trace.exports[activeDetail.trace.exports.length - 1] || null;

  const STEPS: Array<{ n: 1 | 2 | 3 | 4 | 5; th: string; en: string; code: string }> = [
    {
      n: 1,
      th: "1. กำหนดวัตถุประสงค์และเลือกแม่แบบ",
      en: "1. Define Objective & Select Template",
      code: "LFDE-TPL-001..002",
    },
    {
      n: 2,
      th: "2. นำเข้าและยืนยันข้อเท็จจริง",
      en: "2. Adaptive Fact Intake & Ledger",
      code: "LFDE-FACT-001",
    },
    {
      n: 3,
      th: "3. ประกอบร่างและเลือกข้อสัญญา",
      en: "3. Deterministic Assembly & Clauses",
      code: "LFDE-ASM-001",
    },
    {
      n: 4,
      th: "4. ตรวจสอบ 8 ชั้นและอนุมัติโดยผู้เชี่ยวชาญ",
      en: "4. Layered Validation & Human Review",
      code: "LFDE-REV-001..002",
    },
    {
      n: 5,
      th: "5. ส่งออก ชุดยื่นหน่วยงาน และ Lineage",
      en: "5. Export, Filing Package & Lineage",
      code: "LFDE-PKG-001",
    },
  ];

  return (
    <main
      data-screen-label="Documents · LFDE v2.0"
      style={{
        flex: 1,
        width: "100%",
        maxWidth: isMax ? "none" : "1200px",
        margin: "0 auto",
        padding: isMax
          ? "24px clamp(16px,2.5vw,32px) 48px"
          : "clamp(40px,7vh,72px) clamp(16px,4vw,40px) 64px",
        display: "flex",
        flexDirection: "column",
        gap: "28px",
      }}
    >
      {/* Header Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "24px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--color-accent-700)",
            }}
          >
            REG24-LFDE-V2-001 · LEGAL FORM &amp; DOCUMENT EXECUTION ENGINE
          </span>
          <h1
            style={{
              fontSize: "clamp(24px,2.5vw,32px)",
              lineHeight: 1.3,
              letterSpacing: "-0.02em",
              fontWeight: 600,
              margin: 0,
            }}
          >
            {isTh
              ? "ระบบร่าง ประกอบ ตรวจสอบ และบริหารเอกสารกฎหมายอัตโนมัติ"
              : "Legal Form & Document Execution Studio (LFDE v2.0)"}
          </h1>
          <p style={{ margin: 0, fontSize: "14px", maxWidth: "68ch", color: MUT }}>
            {isTh
              ? "แยกชั้นการสกัดข้อเท็จจริงออกจากการประกอบเอกสารเชิงกำหนด (Deterministic Assembly) พร้อมการตรึงเวอร์ชันกฎหมายและการอนุมัติโดยมนุษย์ก่อนส่งออกฉบับสมบูรณ์"
              : "Strictly separates probabilistic AI fact intake from deterministic template assembly, pinned statutory authority snapshots, layered validation, and human reviewer approval."}
          </p>
        </div>

        {activeDetail && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              padding: "10px 14px",
              background: "var(--color-surface)",
              borderLeft: "3px solid var(--color-accent)",
              font: "12px ui-monospace,Menlo,monospace",
            }}
          >
            <div>
              <strong>CASE:</strong> {activeDetail.document.id} ·{" "}
              <span className="tag tag-accent">{activeDetail.document.state.toUpperCase()}</span>
            </div>
            <div style={{ color: MUT }}>
              ETag: {activeDetail.document.etag} · Readiness:{" "}
              {activeDetail.document.readiness.toUpperCase()} · as_of{" "}
              {activeDetail.document.legal_dates.legal_as_of_date}
            </div>
          </div>
        )}
      </div>

      {/* 5-Step Guided Progress Bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: "2px",
          background: "var(--color-divider)",
          border: "2px solid var(--color-text)",
        }}
      >
        {STEPS.map((s) => {
          const active = step === s.n;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(s.n)}
              style={{
                padding: "14px 16px",
                border: 0,
                cursor: "pointer",
                textAlign: "left",
                background: active ? "var(--color-accent)" : "var(--color-surface)",
                color: active ? "var(--on-accent)" : "var(--color-text)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ font: "600 10.5px ui-monospace,Menlo,monospace", opacity: 0.85 }}>
                {s.code}
              </span>
              <span style={{ fontWeight: 700, fontSize: "13.5px", lineHeight: 1.35 }}>
                {isTh ? s.th : s.en}
              </span>
            </button>
          );
        })}
      </div>

      {statusBanner && (
        <div
          style={{
            padding: "12px 16px",
            background:
              statusBanner.type === "ok"
                ? "color-mix(in srgb,var(--accent-ink) 14%,transparent)"
                : "color-mix(in srgb,var(--color-text) 10%,transparent)",
            borderLeft: `4px solid ${
              statusBanner.type === "ok" ? "var(--color-accent)" : "var(--color-text)"
            }`,
            fontSize: "13.5px",
            fontWeight: 600,
          }}
        >
          {statusBanner.text}
        </div>
      )}

      {/* STEP 1 */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                  STEP 1 · INTENT &amp; TEMPORAL AUTHORITY LOCK (LFDE-AUT-001)
                </span>
                <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                  {isTh
                    ? "ระบุธุรกรรมและวันที่มีผลทางกฎหมาย (transaction_date / legal_as_of_date)"
                    : "Specify Transaction Objective & Effective Legal Date"}
                </h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <label style={{ font: "600 12px ui-monospace,Menlo,monospace", color: MUT }}>
                  LEGAL DATE:
                </label>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-divider)",
                    font: "600 13px ui-monospace,Menlo,monospace",
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setAsOfDate("2020-05-01")}
                  style={{ fontSize: "12px", padding: "6px 10px" }}
                >
                  {isTh ? "ทดสอบปี 2020 (ผู้เริ่มก่อการ 3 คน)" : "Test 2020 (3 Promoters)"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setAsOfDate("2026-10-23")}
                  style={{ fontSize: "12px", padding: "6px 10px" }}
                >
                  {isTh ? "ปัจจุบัน (2026)" : "Current (2026)"}
                </button>
              </div>
            </div>

            <textarea
              value={objectiveInput}
              onChange={(e) => setObjectiveInput(e.target.value)}
              rows={2}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                border: "1px solid var(--color-divider)",
                font: "400 15px var(--font-body)",
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                gap: "12px",
              }}
            >
              {templates.map((item) => {
                const ver = item.version;
                const selected = ver.id === selectedTemplateVersionId;
                return (
                  <div
                    key={ver.id}
                    onClick={() => setSelectedTemplateVersionId(ver.id)}
                    style={{
                      padding: "18px",
                      background: selected ? "var(--color-accent)" : "var(--color-bg)",
                      color: selected ? "var(--on-accent)" : "var(--color-text)",
                      border: "2px solid var(--color-text)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ font: "600 11px ui-monospace,Menlo,monospace" }}>
                        {ver.id} · v{ver.semver}
                      </span>
                      <span style={{ font: "600 11px ui-monospace,Menlo,monospace" }}>
                        {ver.domain.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "16px", lineHeight: 1.35 }}>
                      {isTh ? ver.title_th : ver.title_en}
                    </div>
                    <div style={{ fontSize: "12px", opacity: 0.85, marginTop: "auto" }}>
                      {ver.fields.length} {isTh ? "ช่องข้อมูล" : "typed fields"} ·{" "}
                      {ver.blocks.length} {isTh ? "บล็อกโครงสร้าง" : "blocks"} · RISK:{" "}
                      {ver.risk.toUpperCase()}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(
                  [
                    "find_suitable_form",
                    "prepare_draft",
                    "review_imported_draft",
                    "prepare_connected_documents",
                  ] as const
                ).map((mType) => (
                  <button
                    key={mType}
                    type="button"
                    className="btn"
                    onClick={() => handleRunAgiMission(mType)}
                    style={{ padding: "7px 12px", fontSize: "12px", background: tint }}
                  >
                    ⚡ {mType}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={handleCreateDraft}
                style={{ padding: "12px 20px", fontSize: "14px" }}
              >
                {isTh
                  ? "สร้างแฟ้มเอกสารและไปขั้นตอนที่ 2 →"
                  : "Initialize DocumentCase & Proceed to Step 2 →"}
              </button>
            </div>
          </div>

          {activeMission && (
            <div
              style={{
                background: "var(--color-surface)",
                padding: "20px",
                borderLeft: "4px solid var(--color-accent)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ font: "600 12px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                  {activeMission.mission_id} · {activeMission.mission_type.toUpperCase()}
                </span>
                <span className="tag tag-accent">
                  PAUSED AT: {activeMission.paused_for_human_gate}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: "14px" }}>
                {isTh ? activeMission.output_summary_th : activeMission.output_summary_en}
              </p>
              <div style={{ font: "11.5px ui-monospace,Menlo,monospace", color: MUT }}>
                Budget Cap: {activeMission.budget_thb_cap} THB · Spent: {activeMission.spent_thb} THB ·{" "}
                {activeMission.hard_boundary_notice}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && activeDetail && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))",
            gap: "20px",
          }}
        >
          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 2A · TYPED FIELD INTAKE &amp; NORMALIZATION (SECTION 5.2)
              </span>
              <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                {isTh ? "กรอกและยืนยันข้อมูลตามโครงสร้างแม่แบบ" : "Structured Template Fields"}
              </h2>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {activeDetail.template_version.fields.map((field) => {
                const val = factDraft[field.field_key];
                const cand = activeDetail.facts.find(
                  (c) => c.field_key === field.field_key && c.assertion_state === "confirmed"
                );
                return (
                  <div
                    key={field.field_key}
                    style={{
                      padding: "12px 14px",
                      background: "var(--color-bg)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <label style={{ fontWeight: 600, fontSize: "13.5px" }}>
                        {isTh ? field.label_th : field.label_en || field.label_th}
                      </label>
                      <span style={{ font: "11px ui-monospace,Menlo,monospace", color: MUT }}>
                        {field.datatype} · {cand ? "✓ CONFIRMED" : "PENDING"}
                      </span>
                    </div>

                    {field.datatype === "boolean" ? (
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px" }}>
                        <input
                          type="checkbox"
                          checked={Boolean(val)}
                          onChange={(e) =>
                            setFactDraft((prev) => ({
                              ...prev,
                              [field.field_key]: e.target.checked,
                            }))
                          }
                        />
                        <span>{val ? "True" : "False"}</span>
                      </label>
                    ) : (
                      <input
                        type="text"
                        value={val !== undefined && val !== null ? String(val) : ""}
                        onChange={(e) =>
                          setFactDraft((prev) => ({
                            ...prev,
                            [field.field_key]: e.target.value,
                          }))
                        }
                        style={{
                          padding: "8px 10px",
                          background: "var(--color-surface)",
                          color: "var(--color-text)",
                          border: "1px solid var(--color-divider)",
                          font: "400 14px ui-monospace,Menlo,monospace",
                        }}
                      />
                    )}
                    <span style={{ fontSize: "12px", color: MUT }}>
                      {isTh ? field.why_needed_th : field.why_needed_en}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" }}>
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={handleSaveFactsAndConfirmAll}
                style={{ padding: "10px 16px", background: tint }}
              >
                {isTh ? "✓ ยืนยันข้อเท็จจริงทั้งหมด (Confirm Ledger)" : "✓ Confirm All Facts in Ledger"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={handleAssemble}
                style={{ padding: "10px 18px" }}
              >
                {isTh ? "ประกอบร่างเอกสาร (Step 3) →" : "Assemble Document (Step 3) →"}
              </button>
            </div>
          </section>

          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 2B · FACT LEDGER &amp; PLAIN-LANGUAGE TIMELINE
              </span>
              <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                {isTh ? "สถานะการยืนยันข้อมูลและขั้นตอนการดำเนินงาน" : "Confirmed Fact Candidates & Timeline"}
              </h2>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {activeDetail.trace.plain_timeline.map((item) => (
                <div
                  key={item.step}
                  style={{
                    padding: "10px 12px",
                    background: "var(--color-bg)",
                    borderLeft: `3px solid ${item.done ? "var(--color-accent)" : "var(--color-divider)"}`,
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "13px",
                  }}
                >
                  <span>{isTh ? item.label_th : item.label_en}</span>
                  <span style={{ font: "600 11px ui-monospace,Menlo,monospace" }}>
                    {item.done ? "DONE" : "PENDING"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && activeDetail && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))",
            gap: "20px",
          }}
        >
          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 3A · APPROVED CLAUSE PLAYBOOK (SECTION 5.3)
              </span>
              <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                {isTh ? "เลือกข้อสัญญามาตรฐานที่ผ่านการรับรอง" : "Compatible Approved Clauses"}
              </h2>
            </div>

            {clauses
              .filter((c) => c.compatible_templates.includes(activeDetail.template_version.id))
              .map((cl) => {
                const checked = selectedClauseIds.includes(cl.id);
                return (
                  <label
                    key={cl.id}
                    style={{
                      padding: "12px 14px",
                      background: "var(--color-bg)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "13.5px" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedClauseIds((prev) =>
                              Array.from(new Set([...prev, cl.id]))
                            );
                          } else {
                            setSelectedClauseIds((prev) => prev.filter((id) => id !== cl.id));
                          }
                        }}
                      />
                      <span>
                        [{cl.risk.toUpperCase()}] {isTh ? cl.title_th : cl.title_en}
                      </span>
                    </div>
                    <div style={{ fontSize: "12.5px", color: MUT }}>
                      {isTh ? cl.purpose_th : cl.purpose_en}
                    </div>
                  </label>
                );
              })}

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={handleAssemble}
                style={{ padding: "10px 16px", background: tint }}
              >
                {isTh ? "↻ ประกอบร่างใหม่ (Re-Assemble)" : "↻ Re-Assemble Revision"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={handleRunValidation}
                style={{ padding: "10px 18px" }}
              >
                {isTh ? "ไปขั้นตอนที่ 4: ตรวจสอบความถูกต้อง →" : "Proceed to Step 4: Validation →"}
              </button>
            </div>
          </section>

          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 3B · DETERMINISTIC ASSEMBLED BLOCKS (REV #{latestRevision?.revision_number || 0})
              </span>
              {latestRevision && (
                <span style={{ font: "11px ui-monospace,Menlo,monospace", color: MUT }}>
                  SHA-256: {latestRevision.content_hash.slice(0, 14)}…
                </span>
              )}
            </div>

            {latestRevision ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {latestRevision.assembled_blocks.map((blk) => (
                  <div
                    key={blk.block_id}
                    style={{
                      padding: "12px 14px",
                      background: "var(--color-bg)",
                      borderLeft: "3px solid var(--color-accent)",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: "13.5px" }}>
                      {blk.number_label}. {isTh ? blk.title_th : blk.title_en || blk.title_th}
                    </div>
                    <div style={{ fontSize: "13.5px", marginTop: "6px", lineHeight: 1.65 }}>
                      {isTh ? blk.rendered_text_th : blk.rendered_text_en || blk.rendered_text_th}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "24px", background: "var(--color-bg)", color: MUT }}>
                {isTh ? "ยังไม่มีร่างเอกสาร" : "No assembled revision yet."}
              </div>
            )}
          </section>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && activeDetail && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))",
            gap: "20px",
          }}
        >
          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 4A · LAYERED VALIDATION ENGINE (SECTION 8.1)
              </span>
              <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                {isTh ? "ผลการตรวจสอบความถูกต้องตามกฎและตัวบทกฎหมาย" : "Layered Validation Report"}
              </h2>
            </div>

            {latestValidation ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div
                  style={{
                    padding: "12px 14px",
                    background: "var(--color-bg)",
                    font: "600 12px ui-monospace,Menlo,monospace",
                  }}
                >
                  READINESS: {latestValidation.readiness.toUpperCase()} · FINDINGS:{" "}
                  {latestValidation.findings.length}
                </div>
                {latestValidation.findings.length === 0 && (
                  <div style={{ padding: "14px", background: "var(--color-bg)", fontSize: "13.5px" }}>
                    ✓{" "}
                    {isTh
                      ? "ไม่พบข้อผิดพลาดในการตรวจสอบครบทุกชั้น (พร้อมส่งตรวจอนุมัติ)"
                      : "Zero blocker findings across all validation layers."}
                  </div>
                )}
                {latestValidation.findings.map((f) => (
                  <div
                    key={f.finding_id}
                    style={{
                      padding: "12px 14px",
                      background: "var(--color-bg)",
                      borderLeft: "4px solid var(--color-text)",
                    }}
                  >
                    <div style={{ font: "600 11px ui-monospace,Menlo,monospace" }}>
                      [{f.severity.toUpperCase()}] {f.rule_id} · {f.layer}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "13.5px", marginTop: "4px" }}>
                      {isTh ? f.explanation_th : f.explanation_en}
                    </div>
                    <div style={{ fontSize: "12.5px", color: MUT, marginTop: "4px" }}>
                      {isTh ? f.remediation_th : f.remediation_en}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 4B · HUMAN LEGAL REVIEWER PINNED APPROVAL (LFDE-REV-002)
              </span>
              <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                {isTh ? "การอนุมัติโดยผู้ตรวจกฎหมาย (Human-in-the-Loop Gate)" : "Scoped Human Reviewer Approval"}
              </h2>
            </div>

            <textarea
              value={reviewDecisionNotes}
              onChange={(e) => setReviewDecisionNotes(e.target.value)}
              rows={3}
              style={{
                padding: "10px 12px",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                border: "1px solid var(--color-divider)",
                font: "400 14px var(--font-body)",
              }}
            />

            <button
              type="button"
              className="btn btn-primary"
              disabled={loading}
              onClick={handleRequestAndApproveReview}
              style={{ padding: "12px 18px", fontSize: "14px" }}
            >
              {isTh
                ? "✓ อนุมัติเอกสารฉบับนี้และไปขั้นตอนที่ 5 (Export & Filing) →"
                : "✓ Approve Pinned Revision & Proceed to Step 5 →"}
            </button>
          </section>
        </div>
      )}

      {/* STEP 5 */}
      {step === 5 && activeDetail && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))",
            gap: "20px",
          }}
        >
          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 5A · WATERMARKED DRAFT VS. APPROVED FINAL EXPORT
              </span>
              <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                {isTh ? "ส่งออกเอกสารและสร้างเซสชันดาวน์โหลด 5 นาที" : "Export Artifacts & Ephemeral Download Session"}
              </h2>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => handleExportDocument("draft", "docx")}
                style={{ padding: "10px 14px", background: tint }}
              >
                {isTh ? "ส่งออก DRAFT (.docx มีลายน้ำ)" : "Export DRAFT (.docx Watermarked)"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={() => handleExportDocument("final", "docx")}
                style={{ padding: "10px 16px" }}
              >
                {isTh ? "ส่งออก FINAL (.docx อนุมัติแล้ว)" : "Export FINAL (.docx Approved)"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => handleExportDocument("final", "pdf")}
                style={{ padding: "10px 14px", background: tint }}
              >
                {isTh ? "ส่งออก FINAL (.pdf)" : "Export FINAL (.pdf)"}
              </button>
            </div>

            {downloadSessionInfo && (
              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--color-bg)",
                  borderLeft: "3px solid var(--color-accent)",
                  font: "12px ui-monospace,Menlo,monospace",
                }}
              >
                <div>
                  <strong>EPHEMERAL DOWNLOAD SESSION (≤5 MIN TTL):</strong>{" "}
                  {downloadSessionInfo.session_id}
                </div>
                <div style={{ color: MUT }}>
                  Export: {downloadSessionInfo.export_id} · Expires: {downloadSessionInfo.expires_at}
                </div>
              </div>
            )}

            {latestExport && (
              <div
                style={{
                  padding: "14px",
                  background: "var(--color-bg)",
                  font: "12px ui-monospace,Menlo,monospace",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ color: "var(--color-accent-700)", fontWeight: 700 }}>
                  IMMUTABLE LINEAGE MANIFEST ({latestExport.manifest.manifest_id})
                </div>
                <div>
                  Template Version: {latestExport.manifest.template_version_id} · Status:{" "}
                  {latestExport.status_label.toUpperCase()}
                </div>
                <div>Artifact SHA-256: {latestExport.sha256.slice(0, 24)}…</div>
                <div>
                  Approval Decisions:{" "}
                  {latestExport.approval_decision_ids.length
                    ? latestExport.approval_decision_ids.join(", ")
                    : "NONE (WATERMARKED DRAFT)"}
                </div>
              </div>
            )}
          </section>

          <section
            style={{
              background: "var(--color-surface)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div>
              <span style={{ font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                STEP 5B · REGULATOR FILING PACKAGE BUILDER (SECTION 9)
              </span>
              <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
                {isTh
                  ? "ชุดเตรียมเอกสารยื่นหน่วยงานโดยมนุษย์ (Prepared for Human Submission)"
                  : "Regulator Filing Package & Exhibit Index"}
              </h2>
            </div>

            <select
              value={selectedFilingProfileId}
              onChange={(e) => setSelectedFilingProfileId(e.target.value)}
              style={{
                padding: "10px 12px",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                border: "1px solid var(--color-divider)",
                font: "600 13.5px var(--font-body)",
              }}
            >
              {filingProfiles.map((fp) => (
                <option key={fp.id} value={fp.id}>
                  {isTh ? fp.destination_agency_th : fp.destination_agency_en} ({fp.document_family})
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn btn-primary"
              disabled={loading}
              onClick={handleBuildFilingPackage}
              style={{ padding: "10px 16px" }}
            >
              {isTh ? "สร้างชุดเอกสารเตรียมยื่นหน่วยงาน" : "Build Regulator Filing Package"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

interface OfficialCatalogFormRecord {
  id: string;
  code: string;
  category_code: string;
  category_folder: string;
  authority_th: string;
  category_description_en: string;
  title: string;
  file_extension: string;
  file_size_bytes: number;
  drive_url: string;
  is_court_or_agency_form: boolean;
  strict_layout_lock: boolean;
}

interface OfficialCatalogCategory {
  category_code: string;
  category_folder: string;
  authority_th: string;
  category_description_en: string;
  count: number;
}

export function LfdeFormLibrarySection({
  isTh,
  onOpenInDocuments,
}: {
  isTh: boolean;
  onOpenInDocuments: (templateId: string, title: string) => void;
}) {
  const [items, setItems] = useState<TemplateSearchItem[]>([]);
  const [catalogForms, setCatalogForms] = useState<OfficialCatalogFormRecord[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<OfficialCatalogCategory[]>([]);
  const [catalogTotal, setCatalogTotal] = useState<number>(572);
  const [catalogMatched, setCatalogMatched] = useState<number>(572);
  const [catalogQuery, setCatalogQuery] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const MUT = "color-mix(in srgb,var(--color-text) 62%,transparent)";

  useEffect(() => {
    fetch("/api/v1/lfde/templates")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.items)) setItems(d.items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (catalogQuery.trim()) params.set("q", catalogQuery.trim());
    if (selectedCategory !== "ALL") params.set("category_code", selectedCategory);
    params.set("limit", "48");
    fetch(`/api/v1/lfde/official-forms-catalog?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.results)) {
          setCatalogForms(d.results);
          setCatalogCategories(d.categories || []);
          setCatalogTotal(d.total_catalog_files || 572);
          setCatalogMatched(d.matched_count ?? d.results.length);
        }
      })
      .catch(() => {});
  }, [catalogQuery, selectedCategory]);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        paddingTop: "20px",
        borderTop: "2px solid var(--color-text)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <span
            style={{
              font: "600 11px ui-monospace,Menlo,monospace",
              letterSpacing: ".08em",
              color: "var(--color-accent-700)",
            }}
          >
            LFDE-TPL-001..002 · VERIFIED INTERACTIVE FORM &amp; CONTRACT TEMPLATES
          </span>
          <h2 style={{ fontSize: "22px", margin: "4px 0 0" }}>
            {isTh
              ? "คลังแม่แบบสัญญาและแบบพิมพ์ราชการพร้อมประกอบร่างอัตโนมัติ (LFDE Interactive Templates)"
              : "LFDE Interactive Contract & Official Form Templates"}
          </h2>
        </div>
        <span className="tag tag-accent">
          {items.length} {isTh ? "แม่แบบพร้อมประกอบร่างอัตโนมัติ" : "Interactive Templates"}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: "12px",
        }}
      >
        {items.map((it) => {
          const ver = it.version;
          const isOfficial = it.template.is_court_or_agency_form || ver.strict_layout_lock;
          return (
            <div
              key={ver.id}
              style={{
                background: "var(--color-surface)",
                padding: "18px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                borderLeft: isOfficial
                  ? "3px solid var(--color-text)"
                  : "3px solid var(--color-accent)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", font: "600 11px ui-monospace,Menlo,monospace", color: "var(--color-accent-700)" }}>
                <span>{ver.lform_catalog_id || ver.id}</span>
                <span>
                  {isOfficial ? "OFFICIAL FORM · LOCK" : "CONTRACT"} · v{ver.semver}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>
                {isTh ? ver.title_th : ver.title_en}
              </div>
              <div style={{ fontSize: "12px", color: MUT }}>
                {ver.fields.length} {isTh ? "ช่องข้อมูล" : "fields"} ·{" "}
                {ver.blocks.length} {isTh ? "บล็อก" : "blocks"} · Risk: {ver.risk.toUpperCase()}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginTop: "auto", paddingTop: "6px" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    onOpenInDocuments(ver.id, isTh ? ver.title_th : ver.title_en)
                  }
                  style={{ fontSize: "12.5px", padding: "6px 0" }}
                >
                  {isTh ? "ใช้แม่แบบนี้สร้างเอกสาร →" : "Draft with this template →"}
                </button>
                {ver.drive_url && (
                  <a
                    href={ver.drive_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      font: "600 11px ui-monospace,Menlo,monospace",
                      color: "var(--color-text)",
                      textDecoration: "underline",
                    }}
                  >
                    {isTh ? "ไฟล์ต้นฉบับ .docx ↗" : "Source .docx ↗"}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FULL 572-FILE OFFICIAL COURT & AGENCY FORMS CATALOG (L FORM 2024 V.4.1) */}
      <div
        style={{
          marginTop: "12px",
          padding: "22px",
          background: "var(--color-surface)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <span
              style={{
                font: "600 11px ui-monospace,Menlo,monospace",
                letterSpacing: ".08em",
                color: "var(--color-accent-700)",
              }}
            >
              LEGAL DATABASE RESOURCE MASTER · L FORM 2024 V.4.1 ({catalogTotal} FILES · 22 COURTS &amp; AGENCIES)
            </span>
            <h3 style={{ fontSize: "19px", margin: "4px 0 0" }}>
              {isTh
                ? "คลังแบบฟอร์มศาลและส่วนราชการมาตรฐาน (Official Court & Government Agency Forms Catalog)"
                : "Official Thai Court & Government Agency Forms Catalog (L FORM 2024 V.4.1)"}
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: MUT }}>
              {isTh
                ? "ครอบคลุมแบบพิมพ์ศาลยุติธรรม (A4 TH/EN), ศาลภาษีอากรกลาง (ภษ.), กรมที่ดิน (ท.ด.), กรมบังคับคดี (ล./ว.), ฟื้นฟูกิจการ (ฟ.), ศาลแรงงาน (รง.), ศาลปกครอง (ค.), ศาลทรัพย์สินทางปัญญาฯ, คดีผู้บริโภค (ผบ./CB.) และอนุญาโตตุลาการ (คปภ./สถาบันอนุญาโตตุลาการ)"
                : "Includes 545 editable .docx templates, 15 .pdf forms, and TH SarabunNew / TH SarabunIT9 judicial fonts across 22 Thai courts and agencies."}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <a
              href="https://drive.google.com/drive/folders/1jNJtHzWoJfGZdDqHzPbuZshNzbOwk-or"
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
              style={{ padding: "8px 12px", fontSize: "12px" }}
            >
              {isTh ? "เปิดโฟลเดอร์ Legal Forms บน Google Drive ↗" : "Open Legal Forms Drive Folder ↗"}
            </a>
            <a
              href="https://docs.google.com/spreadsheets/d/14Ri-BTPefdCtqk1nFAJE9-MKOVqTataE_vvJm5ogvvg/edit"
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
              style={{ padding: "8px 12px", fontSize: "12px" }}
            >
              {isTh ? "เปิดตารางสารบัญ Legal Forms Index ↗" : "Open Legal Forms Index Sheet ↗"}
            </a>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder={
              isTh
                ? "ค้นหาชื่อแบบฟอร์ม เช่น ท.ด.๑๕, ภษ.๑, รง.๑, ล.๒๙, ฟ.๒๐, ค.๑, ผบ.๑, คำฟ้อง, มอบอำนาจ..."
                : "Search 572 official forms (e.g., ท.ด.๑๕, ภษ.๑, รง.๑, ล.๒๙, ฟ.๒๐, Plaint, Summons)..."
            }
            style={{
              flex: "1 1 300px",
              padding: "10px 14px",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              border: "1px solid var(--color-divider)",
              font: "400 13.5px var(--font-body)",
            }}
          />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{
              padding: "10px 12px",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              border: "1px solid var(--color-divider)",
              font: "600 13px var(--font-body)",
            }}
          >
            <option value="ALL">
              {isTh
                ? `ทุกศาลและหน่วยงานราชการ (${catalogTotal} ไฟล์)`
                : `All Courts & Government Agencies (${catalogTotal} files)`}
            </option>
            {catalogCategories.map((cat) => (
              <option key={cat.category_code} value={cat.category_code}>
                {cat.category_folder} — {cat.count} {isTh ? "ไฟล์" : "files"}
              </option>
            ))}
          </select>
          <span style={{ font: "600 12px ui-monospace,Menlo,monospace", color: MUT }}>
            {isTh ? `พบ ${catalogMatched} รายการ` : `${catalogMatched} matched`}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))",
            gap: "10px",
            maxHeight: "420px",
            overflowY: "auto",
            paddingRight: "4px",
          }}
        >
          {catalogForms.map((cf) => (
            <div
              key={cf.id}
              style={{
                padding: "12px 14px",
                background: "var(--color-bg)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                borderLeft: "2px solid var(--color-divider)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  font: "600 10.5px ui-monospace,Menlo,monospace",
                  color: "var(--color-accent-700)",
                }}
              >
                <span>
                  {cf.id} · {cf.category_folder}
                </span>
                <span>.{cf.file_extension.toUpperCase()}</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: "13.5px", lineHeight: 1.35 }}>
                {cf.title}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "auto",
                  paddingTop: "4px",
                  fontSize: "11.5px",
                  color: MUT,
                }}
              >
                <span>{(cf.file_size_bytes / 1024).toFixed(0)} KB</span>
                <a
                  href={cf.drive_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    font: "600 11.5px ui-monospace,Menlo,monospace",
                    color: "var(--color-text)",
                    textDecoration: "underline",
                  }}
                >
                  {isTh ? "เปิดไฟล์บน Drive ↗" : "Open in Drive ↗"}
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LfdeCuratorConsoleSection({ isTh }: { isTh: boolean }) {
  const [curatorData, setCuratorData] = useState<{
    templates: Template[];
    workflow_tasks: WorkflowTask[];
  } | null>(null);
  const [impactNotice, setImpactNotice] = useState<string | null>(null);
  const MUT = "color-mix(in srgb,var(--color-text) 62%,transparent)";

  const loadCurator = useCallback(() => {
    fetch("/api/v1/lfde/curator")
      .then((r) => r.json())
      .then((d) => {
        if (d.curator) setCuratorData(d.curator);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadCurator();
  }, [loadCurator]);

  const triggerSourceAmendmentScan = async () => {
    const res = await fetch("/api/v1/lfde/curator/source-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canonical_id: "th-ccc-sec-1097",
        new_version_id: "th-ccc-sec-1097-v2026-demo",
      }),
    });
    const json = await res.json();
    if (res.ok) {
      setImpactNotice(
        isTh
          ? `ตรวจสอบผลกระทบการแก้ไข th-ccc-sec-1097 สำเร็จ (สร้างงานทบทวนใหม่ ${json.created_tasks.length} รายการ, ป้องกันงานซ้ำ: ${json.deduplicated ? "ใช่" : "ไม่"})`
          : `Source change impact scan for th-ccc-sec-1097 completed (Created ${json.created_tasks.length} review task(s), deduplicated: ${json.deduplicated}).`
      );
      loadCurator();
    }
  };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        paddingTop: "24px",
        borderTop: "2px solid var(--color-text)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <span
            style={{
              font: "600 11px ui-monospace,Menlo,monospace",
              letterSpacing: ".08em",
              color: "var(--color-accent-700)",
            }}
          >
            LFDE-CURATOR · TEMPLATE CURATOR &amp; STATUTORY IMPACT CONSOLE
          </span>
          <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
            {isTh
              ? "คอนโซลผู้ดูแลแม่แบบสัญญา สิทธิ์การใช้งาน และการแจ้งเตือนเมื่อกฎหมายแก้ไข"
              : "LFDE Template Curator, Licensing & Statutory Change Impact Console"}
          </h2>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={triggerSourceAmendmentScan}
          style={{ padding: "9px 14px", fontSize: "13px" }}
        >
          {isTh
            ? "จำลองการแก้ไข ป.พ.พ. มาตรา 1097 (Source-Change Scan)"
            : "Simulate CCC Sec. 1097 Amendment Impact Scan"}
        </button>
      </div>

      {impactNotice && (
        <div
          style={{
            padding: "12px 14px",
            background: "color-mix(in srgb,var(--accent-ink) 14%,transparent)",
            borderLeft: "4px solid var(--color-accent)",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          {impactNotice}
        </div>
      )}

      {curatorData && curatorData.workflow_tasks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ font: "600 11px ui-monospace,Menlo,monospace", color: MUT }}>
            OPEN CURATOR WORKFLOW TASKS ({curatorData.workflow_tasks.length})
          </div>
          {curatorData.workflow_tasks.map((wt) => (
            <div
              key={wt.id}
              style={{
                padding: "10px 14px",
                background: "var(--color-surface)",
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                fontSize: "13px",
              }}
            >
              <span>
                <strong>[{wt.type}]</strong> {wt.title}
              </span>
              <span className="tag tag-accent">{wt.state.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
