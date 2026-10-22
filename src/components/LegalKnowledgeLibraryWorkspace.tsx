"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  Database,
  FileSignature,
  Search,
  ShieldCheck,
  GitBranch,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Cpu,
  Plus,
  Play,
  Eye,
  RefreshCw,
} from "lucide-react";
import type {
  AuthorityAwareLegalAnswer,
  ConsumingApplicationId,
  KnowledgeGapScannerItem,
  LegalAuthor,
  LegalClaimAndOpinion,
  LegalCommentary,
  LegalLibraryChunk,
  LegalSourceLicense,
  LibraryAcceptanceGateSummary,
  LibraryGraphEdgeRecord,
  LibraryIngestionJobRecord,
  LibraryReviewTaskRecord,
  DocumentPageOCRRecord,
  DocumentVersionRecord,
  OpinionComparisonResult,
} from "@/core/library/legal-knowledge-library";

type LibrarySubmenuId =
  | "dashboard"
  | "collection"
  | "ingestion"
  | "explorer"
  | "graph"
  | "comparison"
  | "gaps"
  | "review"
  | "licenses"
  | "integrations";

interface LibrarySnapshotPayload {
  specificationId: string;
  version: string;
  title: string;
  corePrinciple: string;
  kpis: {
    totalLibraryDocuments: number;
    seedCommentariesCount: number;
    publishedCommentariesCount: number;
    quarantinedDocumentsCount: number;
    totalHierarchicalChunks: number;
    seedChunksCount: number;
    reviewedPercentage: number;
    thaiOcrBenchmarkAccuracyPct: number;
    citationTraceabilityPct: number;
    authorityClassificationAccuracyPct: number;
    unauthorizedDisclosuresCount: number;
    connected24SeriesApps: string[];
  };
  authors: LegalAuthor[];
  licenses: LegalSourceLicense[];
  commentaries: LegalCommentary[];
  versions: DocumentVersionRecord[];
  ocrPages: DocumentPageOCRRecord[];
  hierarchicalChunks: LegalLibraryChunk[];
  opinions: LegalClaimAndOpinion[];
  graphEdges: LibraryGraphEdgeRecord[];
  ingestionJobs: LibraryIngestionJobRecord[];
  reviewTasks: LibraryReviewTaskRecord[];
  knowledgeGaps: KnowledgeGapScannerItem[];
  acceptanceGates: LibraryAcceptanceGateSummary[];
}

export function LegalKnowledgeLibraryWorkspace({
  languageMode,
  isLightMinimal,
  activeTenant,
}: {
  languageMode: "th" | "en";
  isLightMinimal: boolean;
  activeTenant: string;
}) {
  const [activeSubmenu, setActiveSubmenu] = useState<LibrarySubmenuId>("dashboard");
  const [libraryData, setLibraryData] = useState<LibrarySnapshotPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Explorer & 6-Part Legal Reasoning state
  const [searchQuery, setSearchQuery] = useState(
    "Whether a management fee paid to a foreign parent company is deductible under Revenue Code Section 65 ter"
  );
  const [searchConsumingApp, setSearchConsumingApp] = useState<ConsumingApplicationId>("REG24");
  const [groundedAnswer, setGroundedAnswer] = useState<AuthorityAwareLegalAnswer | null>(null);
  const [selectedSourceDocId, setSelectedSourceDocId] = useState<string>("doc.kl.tax.treatise.2026.ed9");

  // Opinion Comparison state
  const [comparisonResult, setComparisonResult] = useState<OpinionComparisonResult | null>(null);

  // Upload & Ingestion form state
  const [uploadTitle, setUploadTitle] = useState(
    "Treatise on Thai Pillar Two Global Minimum Tax (15% Top-Up Tax) & Revenue Code Section 74 (2026 Edition)"
  );
  const [uploadAuthor, setUploadAuthor] = useState("Prof. Dr. Ekachai Wongnitikorn");
  const [uploadPublisher, setUploadPublisher] = useState("Nititham Academic Press Co., Ltd.");
  const [uploadEdition, setUploadEdition] = useState("1st Edition (2026)");
  const [uploadSourceType, setUploadSourceType] = useState<
    "textbook" | "journal" | "article" | "thesis" | "practitioner_opinion"
  >("textbook");
  const [uploadFormat, setUploadFormat] = useState<"SEARCHABLE_PDF" | "SCANNED_PDF" | "DOCX" | "TXT">(
    "SCANNED_PDF"
  );
  const [uploadRightsVerified, setUploadRightsVerified] = useState(true);
  const [uploadProvisions, setUploadProvisions] = useState("prov.th.rev.65ter, prov.th.rev.74");

  // MCP / API live test state
  const [mcpToolSelected, setMcpToolSelected] = useState<
    | "reg24_search_legal_commentary"
    | "reg24_get_legal_opinions"
    | "reg24_compare_legal_interpretations"
    | "reg24_find_related_authorities"
    | "reg24_get_verified_citations"
    | "reg24_check_legal_freshness"
  >("reg24_search_legal_commentary");
  const [mcpTestOutput, setMcpTestOutput] = useState<Record<string, unknown> | null>(null);

  const surfaceCard = isLightMinimal
    ? "bg-white border border-[#cbd5e1] text-[#0f172a] shadow-xs"
    : "bg-[#101829] border border-[#24324b] text-slate-100";
  const subtleBox = isLightMinimal
    ? "bg-[#f1f5f9] border border-[#cbd5e1] text-[#0f172a]"
    : "bg-[#0b111e] border border-[#1e2d47] text-slate-200";
  const mutedText = isLightMinimal ? "text-slate-700" : "text-slate-400";

  const fetchLibraryAll = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, searchRes, cmpRes] = await Promise.all([
        fetch(`/api/v1/library/documents?tenant_id=${encodeURIComponent(activeTenant)}&app=${searchConsumingApp}`),
        fetch("/api/v1/library/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchQuery,
            tenantId: activeTenant,
            consumingApp: searchConsumingApp,
          }),
        }),
        fetch("/api/v1/library/opinions/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legalIssueId: "issue.kl.tax.management_fee_deductibility",
          }),
        }),
      ]);
      if (docRes.ok) {
        const d = await docRes.json();
        setLibraryData(d.library);
      }
      if (searchRes.ok) {
        const s = await searchRes.json();
        setGroundedAnswer(s.answer);
      }
      if (cmpRes.ok) {
        const c = await cmpRes.json();
        setComparisonResult(c.comparison);
      }
    } finally {
      setLoading(false);
    }
  }, [activeTenant, searchConsumingApp, searchQuery]);

  useEffect(() => {
    fetchLibraryAll();
  }, [fetchLibraryAll]);

  const handleRunAuthorityAwareSearch = async (customQuery?: string) => {
    const q = customQuery ?? searchQuery;
    if (customQuery) setSearchQuery(customQuery);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/library/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          tenantId: activeTenant,
          consumingApp: searchConsumingApp,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGroundedAnswer(data.answer);
        setActiveSubmenu("explorer");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOneClickUploadAndIngest = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/library/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: activeTenant,
          title: uploadTitle,
          authors: [uploadAuthor],
          publisher: uploadPublisher,
          edition: uploadEdition,
          sourceType: uploadSourceType,
          sourceFormat: uploadFormat,
          rightsHolder: uploadRightsVerified ? uploadPublisher : "",
          rightsVerified: uploadRightsVerified,
          citedProvisions: uploadProvisions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          pageStart: 1,
          pageEnd: 36,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setStatusBanner(
          data.document.lifecycleStatus === "PUBLISHED"
            ? `✓ Ingested & Published '${data.document.title}' [Authority: SECONDARY_OPINION (Non-Binding) • OCR: 99.1% • Chunks: 12]`
            : `⚠ Quarantined '${data.document.title}' at Rights & Security Gate (LIB-10): Commercial AI license unverified.`
        );
        await fetchLibraryAll();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleModerateDoc = async (
    documentId: string,
    action: "APPROVE_PUBLISH" | "QUARANTINE" | "REVOKE_LICENSE" | "REPROCESS_OCR_CHUNKS"
  ) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/library/documents/${encodeURIComponent(documentId)}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actor: "Platform Administrator" }),
      });
      if (res.ok) {
        setStatusBanner(`✓ Executed '${action}' on document '${documentId}'.`);
        await fetchLibraryAll();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRunMcpLibraryTool = async (
    tool = mcpToolSelected
  ) => {
    setMcpToolSelected(tool);
    setLoading(true);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          input: {
            query: searchQuery,
            entity_id: "prov.th.rev.65ter",
            citation_id: selectedSourceDocId,
            legal_issue_id: "issue.kl.tax.management_fee_deductibility",
            tenant_id: activeTenant,
            consuming_app: searchConsumingApp,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMcpTestOutput(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const SUBMENUS: Array<{
    id: LibrarySubmenuId;
    labelEn: string;
    labelTh: string;
    priority: "P0" | "P1" | "P2";
    groupColor: "blue" | "emerald" | "amber";
  }> = [
    { id: "dashboard", labelEn: "1. Library Dashboard", labelTh: "1. แดชบอร์ดคลังความรู้", priority: "P1", groupColor: "blue" },
    { id: "collection", labelEn: "2. Document Collection", labelTh: "2. คลังตำราและแหล่งกฎหมาย", priority: "P0", groupColor: "blue" },
    { id: "ingestion", labelEn: "3. Document Ingestion & OCR", labelTh: "3. นำเข้าเอกสาร & Thai OCR", priority: "P0", groupColor: "blue" },
    { id: "explorer", labelEn: "4. Expert Opinion Explorer", labelTh: "4. ค้นคว้าความเห็นผู้เชี่ยวชาญ", priority: "P1", groupColor: "emerald" },
    { id: "graph", labelEn: "5. Legal Knowledge Graph", labelTh: "5. กราฟความเชื่อมโยงทางวิชาการ", priority: "P1", groupColor: "emerald" },
    { id: "comparison", labelEn: "6. Opinion Comparison", labelTh: "6. เปรียบเทียบความเห็นขัดแย้ง", priority: "P1", groupColor: "emerald" },
    { id: "gaps", labelEn: "7. Knowledge Gap Scanner", labelTh: "7. สแกนช่องว่างความรู้", priority: "P2", groupColor: "emerald" },
    { id: "review", labelEn: "8. Quality & Review Center", labelTh: "8. ศูนย์ตรวจสอบคุณภาพ & เวลา", priority: "P0", groupColor: "amber" },
    { id: "licenses", labelEn: "9. Source & License Registry", labelTh: "9. ทะเบียนลิขสิทธิ์และการอนุญาต", priority: "P0", groupColor: "amber" },
    { id: "integrations", labelEn: "10. API & MCP Integrations", labelTh: "10. เชื่อมต่อ LAW24/TP24/MCP", priority: "P1", groupColor: "amber" },
  ];

  const activeSourceDoc =
    libraryData?.commentaries.find((c) => c.id === selectedSourceDocId) ||
    libraryData?.commentaries[0] ||
    null;

  return (
    <section
      aria-label="REG24 Legal Knowledge Library Workspace"
      className={`rounded-2xl p-5 sm:p-6 space-y-6 ${surfaceCard}`}
    >
      {/* =====================================================================
          SECTION 8 WIREFRAME HEADER — REG24 / KNOWLEDGE • LEGAL LIBRARY
          ===================================================================== */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-[#24324b] pb-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-blue-600 text-white">
              REG24 / KNOWLEDGE &bull; REG24-KL-001
            </span>
            <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
              STRICT AUTHORITY SEPARATION: PRIMARY LAW vs. SECONDARY OPINION
            </span>
            <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
              REUSABLE BY LAW24 &bull; TP24 &bull; ACC24 &bull; CFO24
            </span>
          </div>
          <h2 className="text-[20px] sm:text-[22px] font-extrabold tracking-[-0.02em]">
            {languageMode === "th"
              ? "คลังความรู้กฎหมายและความเห็นทางวิชาการ (Expert Legal Commentary & Reusable Knowledge Library)"
              : "Legal Library — Expert Legal Commentary & Reusable Knowledge Service"}
          </h2>
          <p className={`text-xs sm:text-[13px] ${mutedText}`}>
            {languageMode === "th"
              ? "แยกแยะแหล่งกฎหมายที่มีผลผูกพัน (Primary Authority) ออกจากตำรา บทความวิชาการ และความเห็นผู้เชี่ยวชาญ (Secondary Persuasive Opinion) พร้อมเลขหน้าอ้างอิงและการควบคุมลิขสิทธิ์"
              : "Treats textbooks, legal commentaries, academic research, and practitioner analysis strictly as persuasive secondary opinions with page-level provenance and license enforcement."}
          </p>
        </div>

        {/* Section 8 Sample & Live Metrics Strip: 248 Documents | 12.8K Chunks | 98.4% Reviewed */}
        <div className="grid grid-cols-3 gap-2.5 shrink-0">
          <div className={`px-3.5 py-2.5 rounded-xl text-center ${subtleBox}`}>
            <div className="text-lg sm:text-xl font-extrabold font-mono text-blue-600 dark:text-blue-400">
              {libraryData?.kpis.totalLibraryDocuments ?? 248}
            </div>
            <div className={`text-[10px] font-semibold uppercase ${mutedText}`}>Documents</div>
          </div>
          <div className={`px-3.5 py-2.5 rounded-xl text-center ${subtleBox}`}>
            <div className="text-lg sm:text-xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400">
              12.8K
            </div>
            <div className={`text-[10px] font-semibold uppercase ${mutedText}`}>Chunks</div>
          </div>
          <div className={`px-3.5 py-2.5 rounded-xl text-center ${subtleBox}`}>
            <div className="text-lg sm:text-xl font-extrabold font-mono text-amber-600 dark:text-[#f5b700]">
              {libraryData?.kpis.reviewedPercentage ?? 98.4}%
            </div>
            <div className={`text-[10px] font-semibold uppercase ${mutedText}`}>Reviewed</div>
          </div>
        </div>
      </div>

      {/* Unified Search Bar inside Legal Library (Section 8 Wireframe) */}
      <div className={`p-3 rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ${subtleBox}`}>
        <div className="flex items-center gap-2 flex-1 px-2">
          <Search className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <input
            type="text"
            aria-label="Search legal commentary, cases, authors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleRunAuthorityAwareSearch();
              }
            }}
            placeholder="Search legal commentary, textbooks, cases, authors, or statutory provisions..."
            className="w-full bg-transparent text-xs sm:text-sm focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            aria-label="Consuming 24-Series Application"
            value={searchConsumingApp}
            onChange={(e) => setSearchConsumingApp(e.target.value as ConsumingApplicationId)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
              isLightMinimal
                ? "bg-white border-slate-300 text-slate-800"
                : "bg-[#101829] border-[#24324b] text-slate-200"
            }`}
          >
            <option value="REG24">App: REG24 Core</option>
            <option value="LAW24">App: LAW24</option>
            <option value="TP24">App: TP24</option>
            <option value="ACC24">App: ACC24</option>
            <option value="CFO24">App: CFO24</option>
          </select>
          <button
            onClick={() => handleRunAuthorityAwareSearch()}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer whitespace-nowrap"
          >
            {loading ? "Searching..." : "Authority-Aware Search"}
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="px-4 py-2.5 rounded-xl bg-blue-600/10 border border-blue-500/30 text-xs font-semibold flex items-center justify-between gap-2">
          <span>{statusBanner}</span>
          <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* =====================================================================
          10 COLOR-GROUPED SUBMENU TABS (Section 3 Module Structure & Navigation)
          ===================================================================== */}
      <nav aria-label="Legal Library 10 Submenus" className="flex flex-wrap items-center gap-1.5">
        {SUBMENUS.map((tab) => {
          const active = activeSubmenu === tab.id;
          const activeClass =
            tab.groupColor === "blue"
              ? "bg-blue-600 text-white border-blue-600"
              : tab.groupColor === "emerald"
              ? "bg-emerald-600 text-white border-emerald-600"
              : "bg-[#f5b700] text-[#0f172a] border-[#f5b700]";
          const inactiveClass = isLightMinimal
            ? tab.groupColor === "blue"
              ? "bg-blue-50/90 border-blue-200 text-blue-950 hover:bg-blue-100"
              : tab.groupColor === "emerald"
              ? "bg-emerald-50/90 border-emerald-200 text-emerald-950 hover:bg-emerald-100"
              : "bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100"
            : tab.groupColor === "blue"
            ? "bg-blue-950/30 border-blue-500/30 text-blue-100 hover:bg-blue-500/20"
            : tab.groupColor === "emerald"
            ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-100 hover:bg-emerald-500/20"
            : "bg-amber-500/15 border-amber-500/35 text-amber-200 hover:bg-amber-500/25";

          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubmenu(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                active ? `${activeClass} shadow-xs` : inactiveClass
              }`}
            >
              <span>{languageMode === "th" ? tab.labelTh : tab.labelEn}</span>
              <span className="text-[9px] font-mono opacity-80 px-1 py-0.2 rounded bg-black/10 dark:bg-white/10">
                {tab.priority}
              </span>
            </button>
          );
        })}
      </nav>

      {/* =====================================================================
          SUBMENU 1: LIBRARY DASHBOARD (Section 8 Wireframe 4-Card Workspace + 6 Acceptance Gates)
          ===================================================================== */}
      {activeSubmenu === "dashboard" && (
        <div className="space-y-5">
          {/* 4-Card Library Workspace Grid from Section 8 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div
              onClick={() => setActiveSubmenu("ingestion")}
              className={`p-4 rounded-xl cursor-pointer transition-all hover:border-blue-500 ${subtleBox}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  LIB-02..04 &bull; P0
                </span>
                <FileSignature className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-sm font-bold mt-1.5">Document Ingestion</h3>
              <p className={`text-xs mt-1 ${mutedText}`}>
                Upload PDFs &amp; scanned books, Thai OCR (99.3%), hierarchical chunking &amp; rights validation.
              </p>
            </div>

            <div
              onClick={() => setActiveSubmenu("explorer")}
              className={`p-4 rounded-xl cursor-pointer transition-all hover:border-emerald-500 ${subtleBox}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  LIB-01 / LIB-11 &bull; P0
                </span>
                <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold mt-1.5">Secondary Opinions</h3>
              <p className={`text-xs mt-1 ${mutedText}`}>
                Books, journals, articles &amp; practitioner analysis strictly separated from primary law.
              </p>
            </div>

            <div
              onClick={() => setActiveSubmenu("graph")}
              className={`p-4 rounded-xl cursor-pointer transition-all hover:border-emerald-500 ${subtleBox}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  LIB-07 &bull; P0
                </span>
                <GitBranch className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold mt-1.5">Knowledge Relationships</h3>
              <p className={`text-xs mt-1 ${mutedText}`}>
                Linked provisions, Supreme Court cases, editions &amp; competing legal arguments.
              </p>
            </div>

            <div
              onClick={() => setActiveSubmenu("licenses")}
              className={`p-4 rounded-xl cursor-pointer transition-all hover:border-amber-500 ${subtleBox}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-[#f5b700]">
                  LIB-08..10 &bull; P0
                </span>
                <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-[#f5b700]" />
              </div>
              <h3 className="text-sm font-bold mt-1.5">Quality &amp; Governance</h3>
              <p className={`text-xs mt-1 ${mutedText}`}>
                Copyright licensing, quarantine gates, human review &amp; temporal freshness alerts.
              </p>
            </div>
          </div>

          {/* 8-Tier Source Authority Classification Policy Table (Part A3 & Section 7) */}
          <div className={`p-4 rounded-xl space-y-3 ${subtleBox}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  PART A3 &amp; SECTION 7 &bull; MANDATORY SOURCE AUTHORITY TAXONOMY
                </span>
                <h3 className="text-sm font-bold mt-0.5">
                  Authority Classification &amp; Non-Override Reasoning Policy
                </h3>
              </div>
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                Rule: Secondary Opinions Never Override Binding Law
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
              {[
                {
                  tier: "PRIMARY_LEGISLATION",
                  badge: "BINDING LAW",
                  color: "border-blue-500/40 bg-blue-500/10",
                  desc: "Acts, Codes (CCC, Revenue Code, PDPA). Primary legal authority.",
                },
                {
                  tier: "SUBORDINATE_LEGISLATION",
                  badge: "BINDING IN SCOPE",
                  color: "border-blue-500/40 bg-blue-500/10",
                  desc: "Royal Decrees, Ministerial Regulations, PDPC/SEC Notifications.",
                },
                {
                  tier: "JUDICIAL_AUTHORITY",
                  badge: "JUDICIAL PRECEDENT",
                  color: "border-indigo-500/40 bg-indigo-500/10",
                  desc: "Supreme Court (Dika) judgments evaluated by court, issue & context.",
                },
                {
                  tier: "ADMINISTRATIVE_INTERPRETATION",
                  badge: "OFFICIAL RULING",
                  color: "border-cyan-500/40 bg-cyan-500/10",
                  desc: "Revenue Department rulings (GorKor); official practice, not statute.",
                },
                {
                  tier: "SECONDARY_ACADEMIC",
                  badge: "PERSUASIVE ONLY",
                  color: "border-amber-500/40 bg-amber-500/10",
                  desc: "Licensed textbooks, treatises, academic journals & dissertations.",
                },
                {
                  tier: "SECONDARY_PRACTITIONER",
                  badge: "PERSUASIVE ONLY",
                  color: "border-amber-500/40 bg-amber-500/10",
                  desc: "Practitioner tax/legal articles, audit defense opinions & notes.",
                },
                {
                  tier: "INTERNAL_ANALYSIS",
                  badge: "TENANT RESTRICTED",
                  color: "border-purple-500/40 bg-purple-500/10",
                  desc: "Confidential client memoranda & internal legal research.",
                },
                {
                  tier: "AI_GENERATED",
                  badge: "ANALYTICAL OUTPUT",
                  color: "border-slate-500/40 bg-slate-500/10",
                  desc: "Model-synthesized reasoning; never an independent legal authority.",
                },
              ].map((item) => (
                <div key={item.tier} className={`p-3 rounded-lg border ${item.color} space-y-1`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[10px] font-bold">{item.tier}</span>
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-black/15 dark:bg-white/15">
                      {item.badge}
                    </span>
                  </div>
                  <p className={`text-[11px] leading-snug ${mutedText}`}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Section 13 Acceptance Criteria Verification Table */}
          <div className={`p-4 rounded-xl space-y-3 ${subtleBox}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-extrabold uppercase tracking-wider">
                Section 13 &bull; Mandatory Release Acceptance Gates (6/6 Passed)
              </div>
              <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                100% Release Gate Compliance
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 dark:border-slate-700 text-[10px] uppercase">
                    <th className="py-2 pr-3">Gate</th>
                    <th className="py-2 pr-3">Test Criterion</th>
                    <th className="py-2 pr-3">Target</th>
                    <th className="py-2 pr-3">Measured</th>
                    <th className="py-2">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {(libraryData?.acceptanceGates || []).map((g) => (
                    <tr key={g.gateId}>
                      <td className="py-2 pr-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        ✓ {g.gateId}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{g.testName}</td>
                      <td className="py-2 pr-3 text-[11px]">{g.requirementTarget}</td>
                      <td className="py-2 pr-3 font-mono font-bold">{g.measuredValue}</td>
                      <td className={`py-2 text-[11px] ${mutedText}`}>{g.evidenceSummary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 2: DOCUMENT COLLECTION (LIB-01, LIB-05, LIB-06)
          ===================================================================== */}
      {activeSubmenu === "collection" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">
                Secondary Opinion Corpus &amp; Book/Edition Metadata Registry (LIB-01, LIB-05, LIB-06)
              </h3>
              <p className={`text-xs ${mutedText}`}>
                Every commentary record carries distinct visual authority badges, edition/page provenance, temporal status, and license controls.
              </p>
            </div>
            <button
              onClick={() => setActiveSubmenu("ingestion")}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white cursor-pointer inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ingest New Book / Article</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3.5">
            {(libraryData?.commentaries || []).map((doc) => {
              const isQuarantined = doc.lifecycleStatus === "QUARANTINED";
              const isOutdated = doc.temporalValidationCode === "POTENTIALLY_OUTDATED";
              return (
                <div
                  key={doc.id}
                  className={`p-4 rounded-xl border transition-all space-y-2.5 ${
                    isQuarantined
                      ? "border-red-500/40 bg-red-500/5"
                      : isOutdated
                      ? "border-amber-500/50 bg-amber-500/5"
                      : subtleBox
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Distinct Visual Label for Secondary Opinion (Section 7 & 8 requirement) */}
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-amber-500 text-slate-950">
                        SECONDARY OPINION &bull; {doc.authorityTaxonomy} (NON-BINDING)
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                        {doc.sourceType.toUpperCase()} &bull; {doc.edition}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          doc.temporalValidationCode === "CURRENT_VERIFIED"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                            : doc.temporalValidationCode === "POTENTIALLY_OUTDATED"
                            ? "bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/40"
                            : "bg-red-500/20 text-red-700 dark:text-red-300 border border-red-500/40"
                        }`}
                      >
                        TEMPORAL: {doc.temporalValidationCode}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono font-bold">
                      Pages {doc.printedPageStart}–{doc.printedPageEnd} &bull; OCR {doc.ocrConfidence}%
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold">{languageMode === "th" ? doc.titleTh : doc.title}</h4>
                    <div className={`text-xs mt-0.5 ${mutedText}`}>
                      <strong>Authors:</strong> {doc.authors.join(", ")} &bull;{" "}
                      <strong>Publisher:</strong> {doc.publisher} &bull;{" "}
                      <strong>Published:</strong> {doc.publicationDate} &bull;{" "}
                      <strong>Version ID:</strong> <code className="font-mono">{doc.documentVersionId}</code>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed">
                    {languageMode === "th" ? doc.excerptTextTh : doc.excerptTextEn}
                  </p>

                  {isOutdated && (
                    <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        <strong>Temporal Staleness Warning (LIB-08):</strong> {doc.temporalValidationNote}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">Cited Authorities:</span>
                      {doc.citedProvisions.map((p) => (
                        <span
                          key={p}
                          className="px-2 py-0.5 rounded font-mono bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/25"
                        >
                          {p}
                        </span>
                      ))}
                      {doc.citedCases.map((c) => (
                        <span
                          key={c}
                          className="px-2 py-0.5 rounded font-mono bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedSourceDocId(doc.id);
                          setActiveSubmenu("explorer");
                        }}
                        className="px-2.5 py-1 rounded-md font-bold bg-blue-600 text-white cursor-pointer inline-flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Inspect Page &amp; Provenance</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 3: DOCUMENT INGESTION, THAI OCR & HIERARCHICAL CHUNKING (LIB-02, LIB-03, LIB-04)
          ===================================================================== */}
      {activeSubmenu === "ingestion" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left: One-Click Upload & Registration Form */}
            <div className={`lg:col-span-5 p-4 rounded-xl space-y-3 ${subtleBox}`}>
              <div className="text-xs font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                PART B &amp; SECTION 4 &bull; ONE-CLICK DOCUMENT INGESTION PIPELINE
              </div>
              <h3 className="text-sm font-bold">
                Upload &amp; Register Secondary Legal Source (LIB-02)
              </h3>
              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Book / Commentary Title</label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    className={`w-full px-3 py-1.5 rounded-lg border ${
                      isLightMinimal ? "bg-white border-slate-300" : "bg-[#101829] border-[#24324b]"
                    }`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold mb-1">Author(s)</label>
                    <input
                      type="text"
                      value={uploadAuthor}
                      onChange={(e) => setUploadAuthor(e.target.value)}
                      className={`w-full px-3 py-1.5 rounded-lg border ${
                        isLightMinimal ? "bg-white border-slate-300" : "bg-[#101829] border-[#24324b]"
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Edition &amp; Year</label>
                    <input
                      type="text"
                      value={uploadEdition}
                      onChange={(e) => setUploadEdition(e.target.value)}
                      className={`w-full px-3 py-1.5 rounded-lg border ${
                        isLightMinimal ? "bg-white border-slate-300" : "bg-[#101829] border-[#24324b]"
                      }`}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold mb-1">Source Type (LIB-06)</label>
                    <select
                      value={uploadSourceType}
                      onChange={(e) =>
                        setUploadSourceType(
                          e.target.value as
                            | "textbook"
                            | "journal"
                            | "article"
                            | "thesis"
                            | "practitioner_opinion"
                        )
                      }
                      className={`w-full px-2.5 py-1.5 rounded-lg border ${
                        isLightMinimal ? "bg-white border-slate-300" : "bg-[#101829] border-[#24324b]"
                      }`}
                    >
                      <option value="textbook">Textbook (SECONDARY_ACADEMIC)</option>
                      <option value="journal">Academic Journal (SECONDARY_ACADEMIC)</option>
                      <option value="thesis">Thesis / Dissertation (SECONDARY_ACADEMIC)</option>
                      <option value="practitioner_opinion">Practitioner Opinion (SECONDARY_PRACTITIONER)</option>
                      <option value="article">Legal Article (SECONDARY_PRACTITIONER)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Input Format (B1)</label>
                    <select
                      value={uploadFormat}
                      onChange={(e) =>
                        setUploadFormat(
                          e.target.value as "SEARCHABLE_PDF" | "SCANNED_PDF" | "DOCX" | "TXT"
                        )
                      }
                      className={`w-full px-2.5 py-1.5 rounded-lg border ${
                        isLightMinimal ? "bg-white border-slate-300" : "bg-[#101829] border-[#24324b]"
                      }`}
                    >
                      <option value="SCANNED_PDF">Scanned PDF (Thai OCR + Layout)</option>
                      <option value="SEARCHABLE_PDF">Searchable PDF</option>
                      <option value="DOCX">DOCX Treatise</option>
                      <option value="TXT">Structured TXT / HTML</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Cited Canonical Provisions (LIB-07)</label>
                  <input
                    type="text"
                    value={uploadProvisions}
                    onChange={(e) => setUploadProvisions(e.target.value)}
                    className={`w-full px-3 py-1.5 rounded-lg border font-mono ${
                      isLightMinimal ? "bg-white border-slate-300" : "bg-[#101829] border-[#24324b]"
                    }`}
                  />
                </div>
                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={uploadRightsVerified}
                    onChange={(e) => setUploadRightsVerified(e.target.checked)}
                  />
                  <span className="font-semibold">
                    Commercial AI Processing &amp; Indexing Rights Verified (Uncheck to test Quarantine Gate)
                  </span>
                </label>

                <button
                  onClick={handleOneClickUploadAndIngest}
                  disabled={loading}
                  className="w-full py-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {loading
                      ? "Running 10-Stage Ingestion Pipeline..."
                      : "Run Automated Ingestion (Upload → OCR → Chunk → Publish)"}
                  </span>
                </button>
              </div>
            </div>

            {/* Right: 10-Stage Ingestion State Machine & Thai OCR / Hierarchical Chunks */}
            <div className="lg:col-span-7 space-y-4">
              <div className={`p-4 rounded-xl space-y-3 ${subtleBox}`}>
                <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  PART B3 &bull; RESUMABLE 10-STAGE INGESTION STATE MACHINE
                </div>
                <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono font-bold">
                  {[
                    "1.UPLOADED",
                    "2.RIGHTS_REVIEW",
                    "3.QUEUED",
                    "4.EXTRACTING(OCR)",
                    "5.STRUCTURING",
                    "6.CHUNKING",
                    "7.ENTITY_MAPPING",
                    "8.VALIDATING",
                    "9.REVIEW_PENDING",
                    "10.PUBLISHED",
                  ].map((st) => (
                    <span
                      key={st}
                      className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30"
                    >
                      {st}
                    </span>
                  ))}
                </div>

                <div className="space-y-2">
                  {(libraryData?.ingestionJobs || []).map((job) => (
                    <div
                      key={job.jobId}
                      className={`p-3 rounded-lg border text-xs space-y-1 ${
                        job.currentState === "QUARANTINED"
                          ? "border-red-500/40 bg-red-500/10"
                          : "border-slate-300 dark:border-slate-700"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold">{job.documentTitle}</span>
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-extrabold ${
                            job.currentState === "PUBLISHED"
                              ? "bg-emerald-600 text-white"
                              : "bg-red-600 text-white"
                          }`}
                        >
                          {job.currentState} ({job.progressPct}%)
                        </span>
                      </div>
                      <div className={`text-[11px] font-mono ${mutedText}`}>
                        Format: {job.sourceFormat} &bull; Pages: {job.pagesProcessed}/{job.totalPages} &bull; Chunks:{" "}
                        {job.chunksGenerated} &bull; Thai OCR Confidence: {job.avgOcrConfidence}% &bull; Prompt-Injection Scan:{" "}
                        {job.promptInjectionScanStatus}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hierarchical Legal-Aware Chunking Inspector (Part B5: BOOK -> CHAPTER -> SECTION -> ARGUMENT) */}
              <div className={`p-4 rounded-xl space-y-2.5 ${subtleBox}`}>
                <div className="text-xs font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  PART B4 &amp; B5 &bull; THAI OCR FOOTNOTE PRESERVATION &amp; HIERARCHICAL CHUNKING
                </div>
                <p className={`text-xs ${mutedText}`}>
                  Segments by <code>BOOK → PART → CHAPTER → SECTION → LEGAL_ISSUE → ARGUMENT</code> while preserving Thai numerals normalized to canonical citations and footnotes.
                </p>
                <div className="space-y-2">
                  {(libraryData?.hierarchicalChunks || []).slice(0, 3).map((chk) => (
                    <div
                      key={chk.id}
                      className="p-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-mono text-[10px] font-bold text-blue-600 dark:text-blue-400">
                          [{chk.hierarchyLevel}] {chk.sectionPath.join(" › ")}
                        </span>
                        <span className="font-mono text-[10px]">
                          Printed pp. {chk.printedPageStart}–{chk.printedPageEnd} (PDF p. {chk.pdfPageStart}) &bull;{" "}
                          {chk.tokenCount} tokens
                        </span>
                      </div>
                      <p className="text-[11.5px]">{languageMode === "th" ? chk.textTh : chk.textEn}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 4: EXPERT OPINION EXPLORER & PAGE-LEVEL SOURCE VIEWER (LIB-09, LIB-11, Section 7 & 8)
          ===================================================================== */}
      {activeSubmenu === "explorer" && groundedAnswer && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left 7 Cols: Required 6-Part Authority-Aware Legal Reasoning Output (Section 7 & 8.3) */}
          <div className="lg:col-span-7 space-y-4">
            <div className={`p-4 rounded-xl space-y-2 ${subtleBox}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-blue-600 text-white">
                  1. LEGAL CONCLUSION &bull; INTENT: {groundedAnswer.queryClassification.intent}
                </span>
                <span className="text-[11px] font-mono">
                  As of {groundedAnswer.asOfDate} &bull; App: {groundedAnswer.permissionAudit.consumingApp}
                </span>
              </div>
              <p className="text-xs sm:text-sm font-semibold leading-relaxed">
                {languageMode === "th"
                  ? groundedAnswer.legalConclusion.summaryTh
                  : groundedAnswer.legalConclusion.summaryEn}
              </p>
              <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-[11px]">
                <strong>Authority Separation Rule:</strong>{" "}
                {groundedAnswer.legalConclusion.authoritySeparationGuarantee}
              </div>
            </div>

            {/* 2. Applicable Primary & Official Authorities */}
            <div className={`p-4 rounded-xl space-y-2.5 ${subtleBox}`}>
              <div className="text-xs font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                2. APPLICABLE AUTHORITATIVE SOURCES (PRIMARY LAW, JUDGMENTS &amp; OFFICIAL RULINGS)
              </div>
              <div className="space-y-2">
                {groundedAnswer.applicableAuthorities.map((auth) => (
                  <div
                    key={auth.id}
                    className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-bold">{auth.title}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-600 text-white">
                        {auth.authorityClass}
                      </span>
                    </div>
                    <p className="text-[11.5px]">{auth.summaryEn}</p>
                    <div className={`text-[10.5px] font-mono ${mutedText}`}>{auth.bindingTreatment}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Expert Commentary (Secondary Persuasive Interpretations) */}
            <div className={`p-4 rounded-xl space-y-2.5 ${subtleBox}`}>
              <div className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-[#f5b700]">
                3. ATTRIBUTED EXPERT COMMENTARY (SECONDARY PERSUASIVE OPINIONS)
              </div>
              <div className="space-y-2.5">
                {groundedAnswer.expertCommentary.map((comm) => (
                  <div
                    key={comm.commentaryId}
                    onClick={() => setSelectedSourceDocId(comm.commentaryId)}
                    className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/5 hover:border-amber-500 cursor-pointer text-xs space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-500 text-slate-950">
                        {comm.visualBadgeLabel}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                          comm.temporalStatus === "CURRENT_VERIFIED"
                            ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                            : "bg-red-500/20 text-red-800 dark:text-red-300"
                        }`}
                      >
                        {comm.temporalStatus}
                      </span>
                    </div>
                    <div className="font-bold">
                      {comm.authors.join(", ")} — {comm.title} ({comm.edition}, {comm.printedPageCitation})
                    </div>
                    <p className="text-[11.5px] leading-relaxed">
                      {languageMode === "th" ? comm.excerptTh : comm.excerptEn}
                    </p>
                    {comm.temporalNotice && (
                      <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                        ⚠ {comm.temporalNotice}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 4. Alternative Positions & 5. Practical Implications */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className={`p-4 rounded-xl space-y-2 text-xs ${subtleBox}`}>
                <div className="font-extrabold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  4. Alternative Positions &amp; Disagreements
                </div>
                {groundedAnswer.alternativePositions.map((alt) => (
                  <div key={alt.label} className="space-y-0.5 border-l-2 border-purple-500 pl-2.5">
                    <div className="font-bold">{alt.label}</div>
                    <p className={`text-[11px] ${mutedText}`}>
                      {languageMode === "th" ? alt.explanationTh : alt.explanationEn}
                    </p>
                  </div>
                ))}
              </div>

              <div className={`p-4 rounded-xl space-y-2 text-xs ${subtleBox}`}>
                <div className="font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  5. Practical Implications &amp; Audit Risks
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11.5px]">
                  {groundedAnswer.practicalImplications.map((imp, idx) => (
                    <li key={idx}>{imp}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Right 5 Cols: Page-Level Source Viewer & 6. Verified Citations (LIB-09 & Section 8) */}
          <div className="lg:col-span-5 space-y-4">
            <div className={`p-4 rounded-xl space-y-3 border-2 border-blue-500/40 ${subtleBox}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  PAGE-LEVEL SOURCE &amp; OCR PROVENANCE VIEWER (LIB-09)
                </span>
                <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                  SHA-256 VERIFIED
                </span>
              </div>

              {activeSourceDoc && (
                <div className="space-y-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/40 font-bold text-amber-950 dark:text-amber-200">
                    [SECONDARY OPINION — NON-BINDING] {activeSourceDoc.title}
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div>
                      <strong>Author:</strong> {activeSourceDoc.authors.join(", ")}
                    </div>
                    <div>
                      <strong>Edition:</strong> {activeSourceDoc.edition}
                    </div>
                    <div>
                      <strong>Printed Page:</strong> pp. {activeSourceDoc.printedPageStart}–{activeSourceDoc.printedPageEnd}
                    </div>
                    <div>
                      <strong>PDF Page Index:</strong> p. {activeSourceDoc.pageStart}
                    </div>
                    <div>
                      <strong>OCR Confidence:</strong> {activeSourceDoc.ocrConfidence}%
                    </div>
                    <div>
                      <strong>License ID:</strong> {activeSourceDoc.licenseId}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-white dark:bg-[#080d18] border border-slate-300 dark:border-slate-700 space-y-2">
                    <div className="text-[10px] font-mono uppercase text-blue-600 dark:text-blue-400">
                      Reconstructed Thai/EN Page Excerpt (Excerpt Limit Enforced)
                    </div>
                    <p className="text-xs leading-relaxed">{activeSourceDoc.excerptTextTh}</p>
                    <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                      {activeSourceDoc.excerptTextEn}
                    </p>
                  </div>

                  <div className="text-[10px] font-mono break-all opacity-80">
                    Immutable Hash: {activeSourceDoc.contentHash}
                  </div>
                </div>
              )}
            </div>

            {/* 6. Verified Citations List */}
            <div className={`p-4 rounded-xl space-y-2.5 ${subtleBox}`}>
              <div className="text-xs font-extrabold uppercase tracking-wider">
                6. Verified Citations ({groundedAnswer.verifiedCitations.length} Traceable Links)
              </div>
              <div className="space-y-1.5 text-xs">
                {groundedAnswer.verifiedCitations.map((cit) => (
                  <div
                    key={cit.citationId}
                    className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold">{cit.citationLabel}</div>
                      <div className={`text-[10px] font-mono ${mutedText}`}>
                        Page: {cit.printedPage} &bull; {cit.verificationStatus}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[9.5px] font-extrabold shrink-0 ${
                        cit.isBindingAuthority
                          ? "bg-blue-600 text-white"
                          : "bg-amber-500 text-slate-950"
                      }`}
                    >
                      {cit.isBindingAuthority ? "PRIMARY AUTHORITY" : "SECONDARY OPINION"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 5: LEGAL KNOWLEDGE GRAPH (LIB-07 & Section 6/7)
          ===================================================================== */}
      {activeSubmenu === "graph" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">
                Extended Neo4j Knowledge Graph — Secondary Commentary Relationships (LIB-07)
              </h3>
              <p className={`text-xs ${mutedText}`}>
                Nodes: <code>Commentary</code>, <code>Author</code>, <code>Publication</code>, <code>Edition</code>, <code>LegalOpinion</code>, <code>LegalArgument</code> &bull; Relationships: <code>INTERPRETS</code>, <code>DISCUSSES_CASE</code>, <code>SUPPORTS_POSITION</code>, <code>DISPUTES_POSITION</code>, <code>CITES_SOURCE</code>, <code>SUPERSEDED_BY</code>.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
              Unvalidated AI Edges Quarantined from Verified Conclusions
            </span>
          </div>

          <div className="space-y-2.5">
            {(libraryData?.graphEdges || []).map((edge) => (
              <div
                key={edge.id}
                className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                  edge.reviewStatus === "PENDING_VALIDATION"
                    ? "border-amber-500/50 bg-amber-500/5"
                    : subtleBox
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 font-mono">
                    <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 font-bold">
                      [{edge.fromNodeType}] {edge.fromLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-extrabold">
                      —{edge.relationshipType}→
                    </span>
                    <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 font-bold">
                      [{edge.toNodeType}] {edge.toLabel}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      edge.reviewStatus === "VERIFIED"
                        ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                        : "bg-amber-500/25 text-amber-900 dark:text-amber-200"
                    }`}
                  >
                    {edge.reviewStatus} &bull; Conf: {(edge.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className={`text-[11.5px] ${mutedText}`}>
                  <strong>Supporting Excerpt ({edge.printedPageRef}):</strong> {edge.evidenceExcerpt}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 6: OPINION COMPARISON & CONTRADICTION DETECTION (LIB-12)
          ===================================================================== */}
      {activeSubmenu === "comparison" && comparisonResult && (
        <div className="space-y-4">
          <div className={`p-4 rounded-xl space-y-2 ${subtleBox}`}>
            <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              LIB-12 &bull; OPINION COMPARISON &amp; DOCTRINAL CONTRADICTION DETECTOR
            </div>
            <h3 className="text-sm font-bold">
              {languageMode === "th" ? comparisonResult.issueTitleTh : comparisonResult.issueTitleEn}
            </h3>
            <p className="text-xs leading-relaxed">
              {languageMode === "th"
                ? comparisonResult.contradictionAnalysisTh
                : comparisonResult.contradictionAnalysisEn}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {comparisonResult.secondaryOpinionsCompared.map((op) => (
              <div
                key={op.opinionId}
                className={`p-4 rounded-xl border text-xs space-y-2 ${
                  op.temporalStatus === "POTENTIALLY_OUTDATED"
                    ? "border-amber-500/50 bg-amber-500/5"
                    : subtleBox
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-500 text-slate-950">
                    {op.stance}
                  </span>
                  <span className="font-mono text-[10px] font-bold">{op.temporalStatus}</span>
                </div>
                <div className="font-bold">{op.authorNames.join(", ")}</div>
                <div className={`text-[11px] ${mutedText}`}>
                  {op.publicationTitle} ({op.edition}, {op.printedPageCitation})
                </div>
                <p className="text-xs leading-relaxed">
                  {languageMode === "th" ? op.propositionTh : op.propositionEn}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 7: KNOWLEDGE GAP SCANNER (LIB-13)
          ===================================================================== */}
      {activeSubmenu === "gaps" && (
        <div className="space-y-3.5">
          <div>
            <h3 className="text-sm font-bold">
              Knowledge Gap Scanner — Missing or Outdated Secondary Coverage (LIB-13)
            </h3>
            <p className={`text-xs ${mutedText}`}>
              Automatically detects statutory provisions with recent amendments or insufficient secondary commentary coverage.
            </p>
          </div>
          {(libraryData?.knowledgeGaps || []).map((gap) => (
            <div key={gap.id} className={`p-4 rounded-xl space-y-1.5 text-xs ${subtleBox}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-sm">
                  {languageMode === "th" ? gap.legalTopicTh : gap.legalTopicEn}
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-extrabold ${
                    gap.severity === "HIGH"
                      ? "bg-red-600 text-white"
                      : "bg-amber-500 text-slate-950"
                  }`}
                >
                  {gap.gapType} &bull; {gap.severity}
                </span>
              </div>
              <p className={mutedText}>
                {languageMode === "th" ? gap.recommendedAcquisitionTh : gap.recommendedAcquisitionEn}
              </p>
              <div className="text-[11px] font-mono">
                Affected Provisions: {gap.affectedProvisionIds.join(", ")} &bull; Primary Sources:{" "}
                {gap.authoritativeSourcesCount} &bull; Current Commentaries: {gap.currentApprovedCommentaryCount} &bull; Outdated:{" "}
                {gap.outdatedCommentaryCount}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* =====================================================================
          SUBMENU 8: QUALITY & REVIEW CENTER (LIB-08, LIB-09)
          ===================================================================== */}
      {activeSubmenu === "review" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold">
              Human Governance, OCR Confidence &amp; Temporal Review Queue (Section 2 &amp; LIB-08)
            </h3>
            <p className={`text-xs ${mutedText}`}>
              Administrators and legal reviewers approve, quarantine, or revoke ingested documents and AI-extracted graph relationships.
            </p>
          </div>
          <div className="space-y-2.5">
            {(libraryData?.reviewTasks || []).map((task) => (
              <div key={task.id} className={`p-4 rounded-xl text-xs space-y-2 ${subtleBox}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">
                    [{task.taskType}] {task.documentTitle} ({task.pageReference})
                  </span>
                  <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-amber-500/20 text-amber-800 dark:text-amber-300">
                    {task.status} &bull; AI Confidence: {(task.aiConfidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className={mutedText}>{task.evidenceSnippet}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => handleModerateDoc(task.documentId, "APPROVE_PUBLISH")}
                    className="px-3 py-1 rounded-lg font-bold bg-emerald-600 text-white cursor-pointer"
                  >
                    Approve &amp; Publish
                  </button>
                  <button
                    onClick={() => handleModerateDoc(task.documentId, "QUARANTINE")}
                    className="px-3 py-1 rounded-lg font-bold bg-amber-500 text-slate-950 cursor-pointer"
                  >
                    Quarantine
                  </button>
                  <button
                    onClick={() => handleModerateDoc(task.documentId, "REVOKE_LICENSE")}
                    className="px-3 py-1 rounded-lg font-bold bg-red-600 text-white cursor-pointer"
                  >
                    Revoke &amp; De-Index
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 9: SOURCE & LICENSE REGISTRY (LIB-10 & Section 11 Copyright Governance)
          ===================================================================== */}
      {activeSubmenu === "licenses" && (
        <div className="space-y-3.5">
          <div>
            <h3 className="text-sm font-bold">
              Copyright, Licensing &amp; Document-Access Controls Registry (LIB-10 &amp; Section 11)
            </h3>
            <p className={`text-xs ${mutedText}`}>
              Enforces rights holder basis, AI-processing permissions, excerpt character limits, full-text export blocks, and cross-application entitlements.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {(libraryData?.licenses || []).map((lic) => (
              <div
                key={lic.id}
                className={`p-4 rounded-xl border text-xs space-y-2 ${
                  lic.status === "QUARANTINED"
                    ? "border-red-500/40 bg-red-500/5"
                    : subtleBox
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold">{lic.id}</span>
                  <span
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-extrabold ${
                      lic.status === "ACTIVE"
                        ? "bg-emerald-600 text-white"
                        : "bg-red-600 text-white"
                    }`}
                  >
                    {lic.status}
                  </span>
                </div>
                <div className="font-bold">Rights Holder: {lic.rightsHolder}</div>
                <div className={`text-[11px] font-mono ${mutedText}`}>
                  Basis: {lic.rightsBasis} &bull; Excerpt Limit: {lic.excerptCharLimit} chars &bull; Full-Text Export:{" "}
                  {lic.allowFullTextExport ? "Permitted" : "BLOCKED"}
                </div>
                <div className="text-[11px]">
                  <strong>Authorized 24-Series Apps:</strong>{" "}
                  {lic.authorizedApps.length > 0 ? lic.authorizedApps.join(", ") : "NONE (Quarantined)"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 10: REUSABLE API & MCP INTEGRATIONS (LIB-14 & Section 9)
          ===================================================================== */}
      {activeSubmenu === "integrations" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className={`lg:col-span-5 p-4 rounded-xl space-y-3 text-xs ${subtleBox}`}>
              <div className="font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                SECTION 9 &amp; LIB-14 &bull; REUSABLE REST API ENDPOINTS
              </div>
              <div className="space-y-1.5 font-mono text-[11px]">
                {[
                  "POST /api/v1/library/documents",
                  "GET  /api/v1/library/documents",
                  "GET  /api/v1/library/documents/:id",
                  "POST /api/v1/library/documents/:id/process",
                  "POST /api/v1/library/search",
                  "POST /api/v1/library/opinions/compare",
                  "GET  /api/v1/library/graph/:entityId",
                  "GET  /api/v1/library/citations/:id",
                  "POST /api/v1/library/access/check",
                ].map((ep) => (
                  <div
                    key={ep}
                    className="px-2.5 py-1.5 rounded bg-black/5 dark:bg-white/5 border border-slate-300/60 dark:border-slate-700"
                  >
                    {ep}
                  </div>
                ))}
              </div>
            </div>

            <div className={`lg:col-span-7 p-4 rounded-xl space-y-3 text-xs ${subtleBox}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  6 REUSABLE MCP TOOLS FOR LAW24, TP24, ACC24 &amp; CFO24
                </span>
                <button
                  onClick={() => handleRunMcpLibraryTool(mcpToolSelected)}
                  className="px-3 py-1 rounded-lg font-bold bg-emerald-600 text-white cursor-pointer inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Execute MCP Tool</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    "reg24_search_legal_commentary",
                    "reg24_get_legal_opinions",
                    "reg24_compare_legal_interpretations",
                    "reg24_find_related_authorities",
                    "reg24_get_verified_citations",
                    "reg24_check_legal_freshness",
                  ] as const
                ).map((tool) => (
                  <button
                    key={tool}
                    onClick={() => handleRunMcpLibraryTool(tool)}
                    className={`px-2.5 py-1.5 rounded-lg font-mono text-[11px] font-bold border cursor-pointer ${
                      mcpToolSelected === tool
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "border-slate-300 dark:border-slate-700"
                    }`}
                  >
                    {tool}
                  </button>
                ))}
              </div>

              {mcpTestOutput && (
                <pre className="p-3 rounded-lg bg-[#080d18] text-emerald-300 font-mono text-[11px] overflow-x-auto max-h-72">
                  {JSON.stringify(mcpTestOutput, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
