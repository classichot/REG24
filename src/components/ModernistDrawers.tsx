"use client";

import React, { useState, useEffect } from "react";

export interface DatabaseRecordDetail {
  code: string;
  catKey: string;
  cat: string;
  titleTh: string;
  titleEn: string;
  status: string;
  tagCls: string;
  textTh: string;
  textEn: string;
  effectiveFrom: string;
  sha256: string;
  commentaryTh?: string;
  commentaryEn?: string;
}

export interface LibraryDocSummary {
  document_id: string;
  title: string;
  author_name: string;
  source_organization: string;
  publication_type: string;
  publication_date: string;
  processing_status: string;
  abstract_summary: string;
  topics: string[];
  linked_statutes: string[];
}

/* ══════════════════════════════════════════════════════════════════════════
   G2: Inline Document Upload & Contract Fact Attachment Bar
   ══════════════════════════════════════════════════════════════════════════ */
export function ModernistUploadBar({
  isTh,
  uploadedDocName,
  uploadedDocText,
  onAttach,
  onClear,
}: {
  isTh: boolean;
  uploadedDocName: string;
  uploadedDocText: string;
  onAttach: (name: string, text: string) => void;
  onClear: () => void;
}) {
  const [draftName, setDraftName] = useState(uploadedDocName || "");
  const [draftText, setDraftText] = useState(uploadedDocText || "");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDraftName(file.name);
    try {
      const text = await file.text();
      const cleaned = text.slice(0, 6000);
      setDraftText(cleaned);
      onAttach(file.name, cleaned);
    } catch {
      const fallback = `[Attached file: ${file.name} (${file.size} bytes)]`;
      setDraftText(fallback);
      onAttach(file.name, fallback);
    }
  };

  return (
    <div
      style={{
        margin: "4px 16px 8px",
        padding: "14px 16px",
        background: "var(--color-bg)",
        borderTop: "2px solid var(--color-divider)",
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
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            font: "600 11px ui-monospace,Menlo,monospace",
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--color-accent-700)",
          }}
        >
          {isTh
            ? "แนบเอกสาร / ข้อสัญญาเพื่อวิเคราะห์ร่วมกับกฎหมายไทย"
            : "ATTACH DOCUMENT / CONTRACT CLAUSE FOR DUAL-EVIDENCE ANALYSIS"}
        </span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <label
            className="btn btn-secondary"
            style={{ padding: "5px 10px", fontSize: "12px", cursor: "pointer" }}
          >
            {isTh ? "เลือกไฟล์ (.txt/.md/.json/.pdf)" : "Choose file (.txt/.md/.json/.pdf)"}
            <input
              type="file"
              accept=".txt,.md,.json,.csv,.pdf,.docx"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </label>
          {(uploadedDocName || draftText) && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDraftName("");
                setDraftText("");
                onClear();
              }}
              style={{ fontSize: "12px", padding: "4px 8px" }}
            >
              {isTh ? "ลบเอกสารแนบ" : "Remove"}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <input
          className="input"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={
            isTh ? "ชื่อสัญญาหรือเอกสาร (เช่น สัญญาบริการซอฟต์แวร์ 2569)" : "Document title (e.g. SaaS Agreement 2026)"
          }
          style={{ flex: "1 1 220px", minHeight: "34px", fontSize: "13px" }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            onAttach(
              draftName.trim() || (isTh ? "เอกสารแนบของผู้ใช้" : "User Attached Clause"),
              draftText.trim()
            )
          }
          style={{ padding: "6px 12px", fontSize: "12px" }}
        >
          {uploadedDocText
            ? isTh
              ? "อัปเดตเอกสารแนบ ✓"
              : "Updated ✓"
            : isTh
            ? "ใช้เอกสารนี้ในคำถาม"
            : "Attach to query"}
        </button>
      </div>

      <textarea
        className="input"
        rows={2}
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        placeholder={
          isTh
            ? "วางข้อความสัญญา ข้อเท็จจริงของบริษัท หรือเนื้อหาเอกสารที่นี่…"
            : "Paste contract clauses, corporate facts, or document excerpt here…"
        }
        style={{ minHeight: "62px", fontSize: "13px", fontFamily: "var(--font-body)" }}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   G3: Database Statutory Reader & REG24-KL-001 Commentary Modal
   ══════════════════════════════════════════════════════════════════════════ */
export function ModernistDatabaseDetailModal({
  record,
  isTh,
  onClose,
  onAskAi,
}: {
  record: DatabaseRecordDetail | null;
  isTh: boolean;
  onClose: () => void;
  onAskAi: (prompt: string) => void;
}) {
  if (!record) return null;

  return (
    <div className="dialog-backdrop" onClick={onClose} style={{ zIndex: 25 }}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "88vh",
          overflowY: "auto",
          padding: "28px",
          gap: "18px",
          borderTop: "4px solid var(--color-accent)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
              <span
                style={{
                  font: "600 12px ui-monospace,Menlo,monospace",
                  color: "var(--color-accent-700)",
                }}
              >
                {record.code}
              </span>
              <span className={`tag ${record.tagCls}`}>{record.status}</span>
              <span className="tag tag-neutral">{record.cat}</span>
            </div>
            <div className="dialog-title" style={{ fontSize: "22px", lineHeight: 1.3 }}>
              {isTh ? record.titleTh : record.titleEn}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onClose}
            aria-label="close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
            gap: "12px",
            padding: "12px 14px",
            background: "var(--color-bg)",
            borderTop: "2px solid var(--color-text)",
            font: "12px ui-monospace,Menlo,monospace",
          }}
        >
          <div>
            <div style={{ opacity: 0.65 }}>{isTh ? "วันที่มีผลบังคับใช้" : "EFFECTIVE FROM"}</div>
            <div style={{ fontWeight: 600, marginTop: "2px" }}>{record.effectiveFrom}</div>
          </div>
          <div>
            <div style={{ opacity: 0.65 }}>SHA-256 PROVENANCE</div>
            <div style={{ fontWeight: 600, marginTop: "2px", overflowWrap: "anywhere" }}>
              {record.sha256.slice(0, 24)}…
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.65 }}>AUTHORITY TIER</div>
            <div style={{ fontWeight: 600, marginTop: "2px", color: "var(--accent-ink)" }}>
              {isTh ? "กฎหมาย/แหล่งข้อมูลปฐมภูมิ" : "Primary Binding Authority"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div
            style={{
              font: "600 11px ui-monospace,Menlo,monospace",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--color-accent-700)",
            }}
          >
            {isTh ? "ตัวบทกฎหมาย / สาระสำคัญฉบับเต็ม" : "CANONICAL STATUTORY / RULING TEXT"}
          </div>
          <div
            style={{
              padding: "16px 18px",
              background: "var(--color-bg)",
              fontSize: "15px",
              lineHeight: 1.75,
              borderLeft: "3px solid var(--color-accent)",
            }}
          >
            {isTh ? record.textTh : record.textEn}
          </div>
        </div>

        {(record.commentaryTh || record.commentaryEn) && (
          <div
            style={{
              padding: "16px 18px",
              background: "var(--color-bg)",
              borderTop: "2px solid var(--color-divider)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  font: "600 11px ui-monospace,Menlo,monospace",
                  letterSpacing: ".08em",
                  color: "var(--color-accent-700)",
                }}
              >
                REG24-KL-001 · {isTh ? "ความเห็นทางวิชาการ / แนววิเคราะห์" : "SECONDARY EXPERT COMMENTARY"}
              </span>
              <span className="tag tag-outline" style={{ fontSize: "10px" }}>
                {isTh ? "ความเห็นทางวิชาการ — ไม่ใช่กฎหมายที่มีผลผูกพัน" : "SECONDARY COMMENTARY — NOT BINDING LAW"}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.65 }}>
              {isTh ? record.commentaryTh : record.commentaryEn}
            </p>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", paddingTop: "8px" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {isTh ? "ปิดหน้าต่าง" : "Close"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              onAskAi(
                isTh
                  ? `วิเคราะห์ข้อกำหนดและผลกระทบของ ${record.titleTh} (${record.code})`
                  : `Analyze compliance requirements and legal impact of ${record.titleEn} (${record.code})`
              );
            }}
            style={{ padding: "10px 16px" }}
          >
            {isTh ? "วิเคราะห์มาตรานี้ในหน้าค้นคว้า →" : "Analyze in Research →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   G3 (Part 2): Live Expert Legal Commentary Library Section (REG24-KL-001)
   ══════════════════════════════════════════════════════════════════════════ */
export function ModernistKnowledgeLibrarySection({
  isTh,
  onAskAi,
}: {
  isTh: boolean;
  onAskAi: (prompt: string) => void;
}) {
  const [docs, setDocs] = useState<LibraryDocSummary[]>([]);
  const [showIngest, setShowIngest] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAuthor, setNewAuthor] = useState("");
  const [newOrg, setNewOrg] = useState("");
  const [newText, setNewText] = useState("");
  const [ingesting, setIngesting] = useState(false);

  const loadDocs = async () => {
    try {
      const res = await fetch("/api/v1/library/documents");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.documents)) {
          setDocs(data.documents);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleIngest = async () => {
    if (!newTitle.trim() || !newText.trim()) return;
    setIngesting(true);
    try {
      const res = await fetch("/api/v1/library/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          author_name: newAuthor.trim() || "Legal Counsel",
          source_organization: newOrg.trim() || "Enterprise Legal",
          publication_type: "practice_note",
          publication_date: "2026-10-23",
          jurisdiction: "TH",
          language: isTh ? "th" : "en",
          visibility: "workspace",
          raw_text: newText.trim(),
          topics: ["Corporate Law", "Tax Law"],
          linked_statutes: ["CCC Section 1097", "Revenue Code Section 70"],
        }),
      });
      if (res.ok) {
        setNewTitle("");
        setNewAuthor("");
        setNewOrg("");
        setNewText("");
        setShowIngest(false);
        await loadDocs();
      }
    } finally {
      setIngesting(false);
    }
  };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        paddingTop: "20px",
        borderTop: "2px solid var(--color-divider)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <span
            style={{
              font: "600 11px ui-monospace,Menlo,monospace",
              letterSpacing: ".08em",
              color: "var(--color-accent-700)",
            }}
          >
            REG24-KL-001 · REUSABLE LEGAL KNOWLEDGE LIBRARY
          </span>
          <h2 style={{ fontSize: "20px", margin: "4px 0 0" }}>
            {isTh
              ? "คลังบทวิเคราะห์และความเห็นผู้เชี่ยวชาญกฎหมาย (Secondary Sources)"
              : "Expert Legal Commentary & Practice Notes (Secondary Sources)"}
          </h2>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowIngest((v) => !v)}
          style={{ padding: "8px 12px", fontSize: "13px" }}
        >
          {showIngest
            ? isTh
              ? "ปิดฟอร์มอัปโหลด"
              : "Close Upload Form"
            : isTh
            ? "+ อัปโหลดบันทึกกฎหมาย / ความเห็นเข้าคลัง"
            : "+ Upload Practice Note / Commentary"}
        </button>
      </div>

      {showIngest && (
        <div
          style={{
            background: "var(--color-surface)",
            padding: "20px",
            borderTop: "3px solid var(--color-accent)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "10px" }}>
            <input
              className="input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={isTh ? "ชื่อบทวิเคราะห์ / บันทึกกฎหมาย" : "Commentary / Memo Title"}
            />
            <input
              className="input"
              value={newAuthor}
              onChange={(e) => setNewAuthor(e.target.value)}
              placeholder={isTh ? "ผู้เขียน (เช่น ฝ่ายกฎหมาย)" : "Author (e.g. Senior Partner)"}
            />
            <input
              className="input"
              value={newOrg}
              onChange={(e) => setNewOrg(e.target.value)}
              placeholder={isTh ? "หน่วยงาน / สำนักงานกฎหมาย" : "Organization / Law Firm"}
            />
          </div>
          <textarea
            className="input"
            rows={3}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder={
              isTh
                ? "วางเนื้อหาความเห็นทางกฎหมาย (ระบบจะแยก Chunk สร้าง Vector Embedding และเชื่อมโยงมาตราอัตโนมัติ)…"
                : "Paste legal analysis text (auto-chunked, embedded, and linked to statutory nodes)…"
            }
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={ingesting}
              onClick={handleIngest}
              style={{ padding: "8px 14px" }}
            >
              {ingesting
                ? isTh
                  ? "กำลังประมวลผล OCR & Graph Link…"
                  : "Indexing & Linking…"
                : isTh
                ? "บันทึกและสร้างดัชนีในคลังความรู้ →"
                : "Ingest & Index Document →"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {docs.map((d) => (
          <div
            key={d.document_id}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(110px,150px) minmax(0,1fr) auto",
              gap: "16px",
              alignItems: "center",
              padding: "14px 18px",
              background: "var(--color-surface)",
            }}
          >
            <div>
              <span
                style={{
                  font: "600 11.5px ui-monospace,Menlo,monospace",
                  color: "var(--color-accent-700)",
                  display: "block",
                }}
              >
                {d.document_id}
              </span>
              <span className="tag tag-outline" style={{ fontSize: "10px", marginTop: "4px" }}>
                {d.publication_type}
              </span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "14.5px", lineHeight: 1.4 }}>{d.title}</div>
              <div style={{ fontSize: "12px", opacity: 0.7, marginTop: "2px" }}>
                {d.author_name} · {d.source_organization} · {d.publication_date}
              </div>
              <div style={{ fontSize: "13px", opacity: 0.85, marginTop: "4px" }}>
                {d.abstract_summary}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                onAskAi(
                  isTh
                    ? `เปรียบเทียบความเห็นใน "${d.title}" กับตัวบทกฎหมายและคำพิพากษาที่เกี่ยวข้อง`
                    : `Compare expert commentary in "${d.title}" against primary statutes and rulings`
                )
              }
              style={{ fontSize: "12px", padding: "6px 10px" }}
            >
              AI →
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   G5: 16 Modules Interactive Modal (Including Law-as-Code Rule Studio from REG24 Redesign.dc.html)
   ══════════════════════════════════════════════════════════════════════════ */
export function ModernistModuleModal({
  tileCode,
  tileTitle,
  isTh,
  onClose,
  onNavigate,
  onAskAi,
}: {
  tileCode: string | null;
  tileTitle: string;
  isTh: boolean;
  onClose: () => void;
  onNavigate: (dest: "research" | "workspace" | "databases" | "notebook" | "mcp" | "developer" | "control") => void;
  onAskAi: (prompt: string) => void;
}) {
  const [foreignPct, setForeignPct] = useState(49);
  const [sector, setSector] = useState<"service" | "export">("service");
  const [capital, setCapital] = useState(2);
  const [promoters, setPromoters] = useState(2);

  if (!tileCode) return null;

  const foreign = foreignPct >= 50;
  const service = sector === "service";
  const minCap = service ? 3 : 2;
  const mk = (st: "pass" | "warn" | "fail") =>
    st === "pass"
      ? { tag: "tag-neutral", label: isTh ? "ผ่าน" : "PASS", dot: "var(--color-neutral-500)" }
      : st === "warn"
      ? { tag: "tag-outline", label: isTh ? "ต้องดำเนินการ" : "ACTION REQUIRED", dot: "var(--color-accent-400)" }
      : { tag: "tag-accent", label: isTh ? "ไม่ผ่าน" : "FAIL", dot: "var(--color-accent)" };

  const rules = [
    {
      code: "FBA-4",
      title: isTh ? "สถานะนิติบุคคล" : "Juristic Person Foreign Status",
      law: isTh
        ? "พ.ร.บ. การประกอบธุรกิจของคนต่างด้าว พ.ศ. 2542 มาตรา 4"
        : "Foreign Business Act B.E. 2542 Section 4",
      st: (foreign ? "warn" : "pass") as "pass" | "warn" | "fail",
      note: foreign
        ? isTh
          ? `ต่างชาติถือหุ้น ${foreignPct}% — ถือเป็นคนต่างด้าวตามกฎหมาย`
          : `Foreign shareholding ${foreignPct}% — classified as foreign entity under FBA Sec. 4`
        : isTh
        ? `ต่างชาติถือหุ้น ${foreignPct}% — ไม่ถึงกึ่งหนึ่ง ถือเป็นนิติบุคคลไทย`
        : `Foreign shareholding ${foreignPct}% (<50%) — Thai juristic person`,
    },
    {
      code: "FBA-B3",
      title: isTh ? "ใบอนุญาตประกอบธุรกิจของคนต่างด้าว" : "Foreign Business License (List 3)",
      law: isTh ? "บัญชีสาม (21) ธุรกิจบริการอื่น" : "FBA List 3 (21) Other Service Businesses",
      st: (foreign && service ? "fail" : "pass") as "pass" | "warn" | "fail",
      note:
        foreign && service
          ? isTh
            ? "ต้องได้รับใบอนุญาต FBL หรือหนังสือรับรอง BOI ก่อนเริ่มประกอบธุรกิจบริการ"
            : "Requires Foreign Business License (FBL) or BOI promotion before operating"
          : isTh
          ? "ไม่ต้องขอใบอนุญาตตามข้อเท็จจริงที่ระบุ"
          : "No List 3 service license required for current parameters",
    },
    {
      code: "FBA-14",
      title: isTh ? "ทุนขั้นต่ำ" : "Minimum Registered Capital",
      law: isTh
        ? "พ.ร.บ. การประกอบธุรกิจของคนต่างด้าว มาตรา 14"
        : "Foreign Business Act Section 14",
      st: (foreign && capital < minCap ? "fail" : "pass") as "pass" | "warn" | "fail",
      note: foreign
        ? isTh
          ? `ต้องมีทุนไม่ต่ำกว่า ${minCap} ล้านบาท — ปัจจุบัน ${capital} ล้านบาท`
          : `Requires at least ${minCap}M THB minimum capital — currently ${capital}M THB`
        : isTh
        ? "ไม่มีเงื่อนไขทุนขั้นต่ำตาม พ.ร.บ. ธุรกิจคนต่างด้าว สำหรับนิติบุคคลไทย"
        : "FBA minimum capital threshold does not apply to Thai majority entities",
    },
    {
      code: "CCC-1097",
      title: isTh ? "จำนวนผู้เริ่มก่อการ" : "Minimum Number of Promoters",
      law: isTh
        ? "ป.พ.พ. มาตรา 1097 (แก้ไขเพิ่มเติม พ.ศ. 2565)"
        : "Civil & Commercial Code Sec. 1097 (Amended B.E. 2565)",
      st: (promoters >= 2 ? "pass" : "fail") as "pass" | "warn" | "fail",
      note:
        promoters >= 2
          ? isTh
            ? `${promoters} คน — ครบตามขั้นต่ำ 2 คน`
            : `${promoters} promoters — satisfies minimum of 2 promoters`
          : isTh
          ? "1 คน — ต้องมีอย่างน้อย 2 คน"
          : "1 promoter — statutory minimum is 2 promoters",
    },
  ].map((r) => ({ ...r, ...mk(r.st) }));

  const fails = rules.filter((r) => r.st === "fail").length;
  const warns = rules.filter((r) => r.st === "warn").length;
  const verdict = fails
    ? {
        num: String(fails),
        color: "var(--color-accent)",
        title: isTh
          ? `${fails} ข้อไม่ผ่าน ต้องแก้ไขก่อนจดทะเบียน`
          : `${fails} rule(s) failed — remediation required before registration`,
      }
    : warns
    ? {
        num: "!",
        color: "var(--color-accent-700)",
        title: isTh
          ? "ผ่านเกณฑ์พื้นฐาน แต่มีขั้นตอนที่ต้องดำเนินการ"
          : "Conditional pass — regulatory filing required",
      }
    : {
        num: "✓",
        color: "var(--color-text)",
        title: isTh ? "ผ่านครบทุกกฎ พร้อมจดทะเบียน" : "All 4 statutory rules passed",
      };

  const MODULE_PRESETS: Record<
    string,
    { descTh: string; descEn: string; queriesTh: string[]; queriesEn: string[]; targetNav: "research" | "databases" | "mcp" | "developer" | "workspace" | "control" }
  > = {
    "PRD-V2": {
      descTh: "ระบบวิเคราะห์ผลกระทบกฎหมายตามประเภทธุรกิจและอุตสาหกรรม 19 กลุ่ม พร้อมตรวจสอบใบอนุญาตและหน้าที่ตามกฎหมาย",
      descEn: "Corporate & 19-industry regulatory intelligence with automated license & obligation mapping.",
      queriesTh: [
        "ธุรกิจโรงไฟฟ้าพลังงานแสงอาทิตย์ต้องขอใบอนุญาตใดบ้างและมีเงื่อนไข BOI อย่างไร",
        "เปรียบเทียบข้อดีข้อเสียของการโอนกิจการทั้งหมด (Entire Business Transfer) กับการควบบริษัท",
      ],
      queriesEn: [
        "What licenses and BOI conditions apply to a solar power plant acquisition in Thailand?",
        "Compare Entire Business Transfer (EBT) vs statutory amalgamation under Thai corporate & tax law",
      ],
      targetNav: "databases",
    },
    "SCR-M": {
      descTh: "คลังคำพิพากษาศาลฎีกาและศาลภาษีอากร พร้อมการสกัดประเด็นข้อกฎหมาย (Ratio Decidendi) และเทียบเคียงข้อเท็จจริง",
      descEn: "Supreme Court (Dika) & Central Tax Court precedent engine with ratio decidendi extraction.",
      queriesTh: [
        "สรุปแนวคำพิพากษาศาลฎีกาเรื่องความรับผิดของกรรมการบริษัทจำกัด",
        "คำพิพากษาศาลฎีกาที่ 2845/2564 วินิจฉัยเรื่องรายจ่ายต้องห้ามตามมาตรา 65 ตรี ไว้อย่างไร",
      ],
      queriesEn: [
        "Summarise Supreme Court rulings on director liability in limited companies",
        "How did Supreme Court Dika 2845/2564 rule on non-deductible expenses under Section 65 ter?",
      ],
      targetNav: "research",
    },
    "SCR-L": {
      descTh: "ระบบตรวจสอบ PDPA พ.ศ. 2562 และประกาศคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2569 (แจ้งเหตุละเมิดภายใน 72 ชม. และสิทธิ DSAR)",
      descEn: "PDPA B.E. 2562 & PDPC 2026 compliance engine (72-hour breach notification & DSAR SLA calculator).",
      queriesTh: [
        "หากเกิดเหตุข้อมูลส่วนบุคคลรั่วไหลของลูกค้า 5,000 ราย ต้องแจ้ง สคส. ภายในกี่ชั่วโมงตามประกาศ PDPC",
        "เงื่อนไขการโอนข้อมูลส่วนบุคคลไปต่างประเทศตามมาตรา 28 และ 29 แห่ง พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล",
      ],
      queriesEn: [
        "What is the PDPC notification deadline and requirement for a data breach affecting 5,000 data subjects?",
        "What are the cross-border data transfer requirements under PDPA Sections 28 and 29?",
      ],
      targetNav: "research",
    },
    "SCR-K": {
      descTh: "คลังข้อหารือกรมสรรพากร 3,643 ฉบับ (พ.ศ. 2543–2569) และกฎหมายลำดับรองตามประมวลรัษฎากร",
      descEn: "3,643 Revenue Department tax rulings (B.E. 2543–2569) and sub-regulations under the Revenue Code.",
      queriesTh: [
        "จ่ายค่าบริการซอฟต์แวร์และคลาวด์ให้บริษัทในสิงคโปร์ ต้องหักภาษี ณ ที่จ่ายตามมาตรา 70 หรือไม่",
        "ข้อหารือกรมสรรพากรเกี่ยวกับการยกเว้นภาษีเงินได้นิติบุคคลจากการโอนกิจการทั้งหมด (EBT)",
      ],
      queriesEn: [
        "Does paying cloud/SaaS fees to a Singapore entity trigger withholding tax under Revenue Code Section 70?",
        "Revenue Department rulings on corporate income tax exemption for Entire Business Transfer (EBT)",
      ],
      targetNav: "research",
    },
    "SCR-J": {
      descTh: "กฎหมายตลาดทุน พ.ร.บ.หลักทรัพย์ฯ ก.ล.ต. ตลาดหลักทรัพย์ฯ การปรับโครงสร้างหนี้ และฟื้นฟูกิจการ",
      descEn: "SEC & SET capital markets regulations, M&A tender offers, debt restructuring, and business rehabilitation.",
      queriesTh: [
        "การได้มาซึ่งหุ้นของบริษัทจดทะเบียนเกินร้อยละ 25, 50 หรือ 75 มีหน้าที่ทำคำเสนอซื้อหลักทรัพย์ (Tender Offer) อย่างไร",
        "ขั้นตอนการยื่นคำร้องขอฟื้นฟูกิจการและสภาวะพักการชำระหนี้ (Automatic Stay) ตาม พ.ร.บ. ล้มละลาย",
      ],
      queriesEn: [
        "What are the mandatory tender offer triggers at 25%, 50%, and 75% shareholding in a SET-listed company?",
        "Explain business rehabilitation filing requirements and Automatic Stay under the Thai Bankruptcy Act",
      ],
      targetNav: "research",
    },
  };

  const preset = MODULE_PRESETS[tileCode];

  return (
    <div className="dialog-backdrop" onClick={onClose} style={{ zIndex: 25 }}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(860px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "28px",
          gap: "20px",
          borderTop: "4px solid var(--color-accent)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div>
            <span
              style={{
                font: "600 12px ui-monospace,Menlo,monospace",
                letterSpacing: ".08em",
                color: "var(--accent-ink)",
              }}
            >
              {tileCode} · REG24 MODULE CONSOLE
            </span>
            <div className="dialog-title" style={{ fontSize: "24px", marginTop: "4px" }}>
              {tileTitle}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onClose}
            aria-label="close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Interactive Law-as-Code Rule Engine from REG24 Redesign.dc.html */}
        {(tileCode === "SCR-E" || tileCode === "PRD-V2") && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
              gap: "24px",
              paddingTop: "12px",
              borderTop: "2px solid var(--color-text)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <span
                style={{
                  font: "600 11px ui-monospace,Menlo,monospace",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--color-accent-700)",
                }}
              >
                {isTh ? "ข้อเท็จจริงของบริษัท (Law-as-Code Input)" : "COMPANY FACTS (LAW-AS-CODE INPUT)"}
              </span>

              <div className="field">
                <label>{isTh ? "สัดส่วนการถือหุ้นของต่างชาติ" : "Foreign shareholding percentage"}</label>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={foreignPct}
                    onChange={(e) => setForeignPct(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "var(--color-accent)" }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "24px",
                      width: "64px",
                      textAlign: "right",
                    }}
                  >
                    {foreignPct}%
                  </span>
                </div>
              </div>

              <div className="field">
                <label>{isTh ? "ประเภทธุรกิจ" : "Business sector"}</label>
                <div className="seg">
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="mod-sector"
                      checked={sector === "service"}
                      onChange={() => setSector("service")}
                    />
                    {isTh ? "บริการ (บัญชี 3)" : "Service (List 3)"}
                  </label>
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="mod-sector"
                      checked={sector === "export"}
                      onChange={() => setSector("export")}
                    />
                    {isTh ? "การผลิตเพื่อส่งออก" : "Export manufacturing"}
                  </label>
                </div>
              </div>

              <div className="field">
                <label>{isTh ? "ทุนจดทะเบียน (ล้านบาท)" : "Registered capital (M THB)"}</label>
                <div className="seg">
                  {[1, 2, 3, 5].map((c) => (
                    <label key={c} className="seg-opt">
                      <input
                        type="radio"
                        name="mod-cap"
                        checked={capital === c}
                        onChange={() => setCapital(c)}
                      />
                      {c}M
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>{isTh ? "จำนวนผู้เริ่มก่อการ" : "Number of promoters"}</label>
                <div className="seg">
                  {[
                    [1, "1"],
                    [2, "2"],
                    [3, "3+"],
                  ].map(([val, lbl]) => (
                    <label key={val} className="seg-opt">
                      <input
                        type="radio"
                        name="mod-prom"
                        checked={promoters === val}
                        onChange={() => setPromoters(Number(val))}
                      />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", gap: "18px", alignItems: "center" }}>
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "64px",
                    lineHeight: 0.9,
                    color: verdict.color,
                  }}
                >
                  {verdict.num}
                </span>
                <div>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "18px" }}>
                    {verdict.title}
                  </div>
                  <div style={{ fontSize: "12px", opacity: 0.7, marginTop: "2px" }}>
                    {isTh ? "ชุดกฎ: จัดตั้งบริษัทจำกัด · ประมวลผล 4 กฎ" : "Ruleset: Thai Company Incorporation · 4 rules"}
                  </div>
                </div>
              </div>

              <div style={{ borderTop: "2px solid var(--color-text)" }}>
                {rules.map((r) => (
                  <div
                    key={r.code}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "12px minmax(0,1fr) auto",
                      gap: "12px",
                      alignItems: "start",
                      padding: "12px 0",
                      borderBottom: "1px solid var(--color-divider)",
                    }}
                  >
                    <span
                      style={{
                        width: "10px",
                        height: "10px",
                        marginTop: "6px",
                        background: r.dot,
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "14.5px" }}>{r.title}</div>
                      <div style={{ fontSize: "13px", marginTop: "2px" }}>{r.note}</div>
                      <div style={{ fontSize: "11px", opacity: 0.65, marginTop: "3px" }}>
                        {r.code} · {r.law}
                      </div>
                    </div>
                    <span className={`tag ${r.tag}`}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Preset Quick Launchers for Specialized Modules */}
        {preset && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              paddingTop: "12px",
              borderTop: "2px solid var(--color-divider)",
            }}
          >
            <p style={{ margin: 0, fontSize: "14.5px" }}>{isTh ? preset.descTh : preset.descEn}</p>
            <span
              style={{
                font: "600 11px ui-monospace,Menlo,monospace",
                letterSpacing: ".08em",
                color: "var(--color-accent-700)",
              }}
            >
              {isTh ? "คลิกเพื่อรันคำถามทดสอบในโมดูลนี้ทันที" : "ONE-CLICK TRIAL QUERIES FOR THIS MODULE"}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {(isTh ? preset.queriesTh : preset.queriesEn).map((qText, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onClose();
                    onAskAi(qText);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 14px",
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-divider)",
                    color: "var(--color-text)",
                    cursor: "pointer",
                    textAlign: "left",
                    font: "600 13.5px var(--font-body)",
                  }}
                >
                  <span>{qText}</span>
                  <span style={{ color: "var(--accent-ink)", flex: "none" }}>AI →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", paddingTop: "8px" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {isTh ? "ปิด" : "Close"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              onNavigate(preset?.targetNav || "research");
            }}
          >
            {isTh ? "เปิดในหน้าหลัก →" : "Open Destination →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   G6: Live MCP & REST API Playground Modal
   ══════════════════════════════════════════════════════════════════════════ */
export function ModernistMcpPlaygroundModal({
  open,
  isTh,
  onClose,
}: {
  open: boolean;
  isTh: boolean;
  onClose: () => void;
}) {
  const [selectedTool, setSelectedTool] = useState("reg24_search_law");
  const [argsJson, setArgsJson] = useState(
    JSON.stringify({ query: "Section 1097 promoters", as_of_date: "2026-10-22" }, null, 2)
  );
  const [responseJson, setResponseJson] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  if (!open) return null;

  const PRESET_ARGS: Record<string, Record<string, unknown>> = {
    reg24_search_law: { query: "Section 1097 promoters", as_of_date: "2026-10-22" },
    reg24_get_provision: { provision_id: "prov.th.ccc.1097", as_of_date: "2020-05-01" },
    reg24_search_cases: { query: "65 ter non-deductible expense" },
    reg24_check_compliance: {
      rule_id: "rule.th.corporate.promoter_minimum",
      facts: { promoter_count: 2 },
    },
    reg24_tax_advisor: { query: "Withholding tax Section 70 foreign software service" },
  };

  const executeCall = async () => {
    setRunning(true);
    const t0 = Date.now();
    try {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(argsJson);
      } catch {
        parsedArgs = { query: "Section 1097" };
      }
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: selectedTool,
            arguments: parsedArgs,
          },
        }),
      });
      const data = await res.json();
      setLatencyMs(Date.now() - t0);
      setResponseJson(JSON.stringify(data, null, 2));
    } catch (e) {
      setResponseJson(JSON.stringify({ error: String(e) }, null, 2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose} style={{ zIndex: 25 }}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(840px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "28px",
          gap: "16px",
          borderTop: "4px solid var(--color-accent)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div>
            <span
              style={{
                font: "600 11px ui-monospace,Menlo,monospace",
                letterSpacing: ".08em",
                color: "var(--accent-ink)",
              }}
            >
              POST /api/mcp · JSON-RPC 2.0 LIVE PLAYGROUND
            </span>
            <div className="dialog-title" style={{ fontSize: "22px", marginTop: "4px" }}>
              {isTh ? "ทดสอบเรียกใช้เครื่องมือ MCP & REST สด" : "Live MCP & REST Tool Playground"}
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-icon" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {Object.keys(PRESET_ARGS).map((toolName) => (
            <button
              key={toolName}
              type="button"
              onClick={() => {
                setSelectedTool(toolName);
                setArgsJson(JSON.stringify(PRESET_ARGS[toolName], null, 2));
              }}
              style={{
                padding: "7px 11px",
                border: 0,
                cursor: "pointer",
                font: "600 12px ui-monospace,Menlo,monospace",
                background:
                  selectedTool === toolName
                    ? "var(--color-accent)"
                    : "color-mix(in srgb,var(--color-text) 6%,transparent)",
                color: selectedTool === toolName ? "var(--on-accent)" : "var(--color-text)",
              }}
            >
              {toolName}
            </button>
          ))}
        </div>

        <div className="field">
          <label>JSON-RPC Arguments (`params.arguments`)</label>
          <textarea
            className="input"
            rows={4}
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: "12.5px" }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <span style={{ font: "12px ui-monospace,Menlo,monospace", opacity: 0.7 }}>
            {latencyMs !== null ? `HTTP 200 OK · ${latencyMs} ms` : "Endpoint: POST /api/mcp"}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={running}
            onClick={executeCall}
            style={{ padding: "10px 16px" }}
          >
            {running
              ? isTh
                ? "กำลังส่งคำขอ JSON-RPC…"
                : "Executing…"
              : isTh
              ? "รันคำสั่ง MCP สด →"
              : "Execute Live MCP Call →"}
          </button>
        </div>

        {responseJson && (
          <div
            style={{
              background: "var(--color-text)",
              color: "var(--color-bg)",
              font: "12px/1.65 ui-monospace,Menlo,monospace",
              padding: "16px",
              maxHeight: "280px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {responseJson}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   UPDATE #1 & #2: ThLexGraph Multi-Hop Provision Graph Explorer &
   Interactive Side-by-Side Statutory Version Diff Viewer
   ══════════════════════════════════════════════════════════════════════════ */
interface VersionSnapshotUi {
  version_id: string;
  version_sequence: number;
  version_label_th: string;
  version_label_en: string;
  amendment_instrument_th: string;
  effective_from: string;
  effective_to: string | null;
  status: "HISTORICAL_SUPERSEDED" | "IN_FORCE_CURRENT";
  text_th: string;
  text_en_summary: string;
  key_legal_rule: string;
}

interface VersionChainUi {
  chain_id: string;
  canonical_provision_key: string;
  authority_code: string;
  regulator: string;
  instrument_title_th: string;
  instrument_title_en: string;
  provision_label: string;
  practice_area: string;
  amendment_rationale_th: string;
  point_in_time_routing_rule: string;
  versions: VersionSnapshotUi[];
}

interface DiffComparisonUi {
  chain: VersionChainUi;
  left_version: VersionSnapshotUi;
  right_version: VersionSnapshotUi;
  diff_segments: Array<{ type: "UNCHANGED" | "REMOVED" | "ADDED"; text: string }>;
  stats: {
    added_tokens: number;
    removed_tokens: number;
    unchanged_tokens: number;
    change_ratio_pct: number;
  };
}

interface GraphTraversalHopUi {
  hop_distance: number;
  traversal_type: string;
  edge_label: string;
  chunk: {
    chunk_id: string;
    canonical_provision_key: string;
    parent_code: string;
    authority_code: string;
    section_or_clause_label: string;
    title_th: string;
    title_en: string;
    raw_text: string;
    effective_from: string;
    is_binding_law: boolean;
  } | null;
  stub_node: {
    canonical_key: string;
    instrument_hint: string;
    section_code: string | null;
    status: string;
    incoming_citation_count: number;
    citing_deka_count: number;
    citing_ruling_count: number;
    citing_regulation_count: number;
  } | null;
}

export function ModernistThLexGraphAndVersionDiffSection({
  isTh,
  onAskAi,
}: {
  isTh: boolean;
  onAskAi: (q: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"version-diff" | "graph-traverse">("version-diff");
  const [chains, setChains] = useState<VersionChainUi[]>([]);
  const [selectedChainId, setSelectedChainId] = useState<string>("chain.ccc.1097");
  const [comparison, setComparison] = useState<DiffComparisonUi | null>(null);

  const [graphQuery, setGraphQuery] = useState<string>("มาตรา 8");
  const [maxHops, setMaxHops] = useState<number>(2);
  const [graphData, setGraphData] = useState<{
    anchor_chunk?: GraphTraversalHopUi["chunk"];
    graph_stats?: {
      total_provision_nodes: number;
      total_sequential_edges: number;
      total_cross_reference_edges: number;
      resolved_cross_references_count: number;
      stub_awaiting_ingestion_count: number;
    };
    co_citation_authority?: {
      canonical_key: string;
      incoming_citation_count: number;
      citing_deka_count: number;
      citing_ruling_count: number;
      citing_regulation_count: number;
    };
    hops?: GraphTraversalHopUi[];
    top_co_cited?: Array<{
      canonical_key: string;
      instrument_hint: string;
      status: string;
      incoming_citation_count: number;
      citing_deka_count: number;
      citing_ruling_count: number;
    }>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/legal/resource-master?mode=version-diff&chain_id=${encodeURIComponent(selectedChainId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.available_chains)) {
          setChains(data.available_chains);
        }
        if (data.comparison) {
          setComparison(data.comparison);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedChainId]);

  const runGraphTraverse = (qOverride?: string, hopsOverride?: number) => {
    const q = qOverride ?? graphQuery;
    const h = hopsOverride ?? maxHops;
    fetch(
      `/api/v1/legal/resource-master?mode=graph-traverse&q=${encodeURIComponent(q)}&max_hops=${h}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.traversal) return;
        setGraphData({
          anchor_chunk: data.traversal.anchor_chunk,
          graph_stats: data.traversal.graph_stats,
          co_citation_authority: data.traversal.co_citation_authority,
          hops: data.traversal.hops,
          top_co_cited: data.top_co_cited_provisions,
        });
      })
      .catch(() => {});
  };

  useEffect(() => {
    runGraphTraverse("มาตรา 8", 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      style={{
        marginTop: "24px",
        paddingTop: "24px",
        borderTop: "2px solid var(--color-divider)",
        display: "flex",
        flexDirection: "column",
        gap: "18px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span
            style={{
              font: "600 11px ui-monospace,Menlo,monospace",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--color-accent-700)",
            }}
          >
            {isTh
              ? "BI-TEMPORAL VERSION DIFF & THLEXGRAPH MULTI-HOP TRAVERSAL (REG-AI-01 / REG-AI-02)"
              : "BI-TEMPORAL VERSION DIFF & THLEXGRAPH MULTI-HOP TRAVERSAL (REG-AI-01 / REG-AI-02)"}
          </span>
          <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>
            {isTh
              ? "เปรียบเทียบวิวัฒนาการตัวบทกฎหมายรายมาตรา & สำรวจกราฟอ้างอิงข้ามกฎหมาย (Multi-Hop Graph)"
              : "Side-by-Side Statutory Version Diff & Multi-Hop Provision Graph Explorer"}
          </h2>
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => setActiveTab("version-diff")}
            style={{
              padding: "8px 14px",
              border: 0,
              cursor: "pointer",
              font: "600 13px var(--font-body)",
              background:
                activeTab === "version-diff"
                  ? "var(--color-accent)"
                  : "color-mix(in srgb,var(--color-text) 6%,transparent)",
              color: activeTab === "version-diff" ? "var(--on-accent)" : "var(--color-text)",
            }}
          >
            {isTh ? "1. เปรียบเทียบตัวบทเก่า-ใหม่ (Version Diff)" : "1. Statutory Version Diff"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("graph-traverse")}
            style={{
              padding: "8px 14px",
              border: 0,
              cursor: "pointer",
              font: "600 13px var(--font-body)",
              background:
                activeTab === "graph-traverse"
                  ? "var(--color-accent)"
                  : "color-mix(in srgb,var(--color-text) 6%,transparent)",
              color: activeTab === "graph-traverse" ? "var(--on-accent)" : "var(--color-text)",
            }}
          >
            {isTh ? "2. กราฟเชื่อมโยงมาตรา (ThLexGraph Multi-Hop)" : "2. Multi-Hop Provision Graph"}
          </button>
        </div>
      </div>

      {activeTab === "version-diff" && comparison && (
        <div
          style={{
            background: "var(--color-surface)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {/* Chain selector pills */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {chains.map((ch) => {
              const on = ch.chain_id === selectedChainId;
              return (
                <button
                  key={ch.chain_id}
                  type="button"
                  onClick={() => setSelectedChainId(ch.chain_id)}
                  style={{
                    padding: "7px 12px",
                    border: 0,
                    cursor: "pointer",
                    font: "600 12.5px var(--font-body)",
                    background: on
                      ? "var(--color-accent)"
                      : "color-mix(in srgb,var(--color-text) 6%,transparent)",
                    color: on ? "var(--on-accent)" : "var(--color-text)",
                  }}
                >
                  [{ch.authority_code}] {ch.provision_label}
                </button>
              );
            })}
          </div>

          {/* Header metadata */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "12px",
              flexWrap: "wrap",
              paddingBottom: "12px",
              borderBottom: "1px solid var(--color-divider)",
            }}
          >
            <div>
              <div
                style={{
                  font: "600 11.5px ui-monospace,Menlo,monospace",
                  color: "var(--color-accent-700)",
                }}
              >
                {comparison.chain.canonical_provision_key} · {comparison.chain.practice_area} · Δ{" "}
                {comparison.stats.change_ratio_pct}% (+{comparison.stats.added_tokens} / -
                {comparison.stats.removed_tokens} tokens)
              </div>
              <div style={{ fontWeight: 700, fontSize: "16px", marginTop: "4px" }}>
                {isTh ? comparison.chain.instrument_title_th : comparison.chain.instrument_title_en} —{" "}
                {comparison.chain.provision_label}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                onAskAi(
                  isTh
                    ? `เปรียบเทียบผลทางกฎหมายระหว่างฉบับเดิมและฉบับแก้ไขใหม่ของ ${comparison.chain.instrument_title_th} ${comparison.chain.provision_label}`
                    : `Compare the legal impact of the historical vs. amended version of ${comparison.chain.instrument_title_en} ${comparison.chain.provision_label}`
                )
              }
              style={{ padding: "7px 12px", fontSize: "12.5px" }}
            >
              {isTh ? "วิเคราะห์ผลกระทบด้วย AI →" : "Analyze Amendment in AI →"}
            </button>
          </div>

          {/* Side-by-side comparison cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
              gap: "14px",
            }}
          >
            {/* Left: Historical Version */}
            <div
              style={{
                padding: "16px",
                background: "var(--color-bg)",
                borderLeft: "3px solid var(--color-neutral-500)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  font: "600 11px ui-monospace,Menlo,monospace",
                  opacity: 0.75,
                }}
              >
                <span>HISTORICAL / SUPERSEDED</span>
                <span>
                  {comparison.left_version.effective_from} →{" "}
                  {comparison.left_version.effective_to || "PRESENT"}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: "14px" }}>
                {isTh
                  ? comparison.left_version.version_label_th
                  : comparison.left_version.version_label_en}
              </div>
              <div style={{ fontSize: "13.5px", lineHeight: 1.65 }}>
                {comparison.left_version.text_th}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  opacity: 0.75,
                  paddingTop: "6px",
                  borderTop: "1px solid var(--color-divider)",
                }}
              >
                <strong>{isTh ? "เกณฑ์สำคัญ:" : "Key Rule:"}</strong>{" "}
                {comparison.left_version.key_legal_rule}
              </div>
            </div>

            {/* Right: Current In-Force Version */}
            <div
              style={{
                padding: "16px",
                background: "var(--color-bg)",
                borderLeft: "3px solid var(--color-accent)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  font: "600 11px ui-monospace,Menlo,monospace",
                  color: "var(--color-accent-700)",
                }}
              >
                <span>IN FORCE / CURRENT</span>
                <span>{comparison.right_version.effective_from} → PRESENT</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: "14px" }}>
                {isTh
                  ? comparison.right_version.version_label_th
                  : comparison.right_version.version_label_en}
              </div>
              <div style={{ fontSize: "13.5px", lineHeight: 1.65 }}>
                {comparison.right_version.text_th}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--color-accent-700)",
                  paddingTop: "6px",
                  borderTop: "1px solid var(--color-divider)",
                }}
              >
                <strong>{isTh ? "เกณฑ์ปัจจุบัน:" : "Current Rule:"}</strong>{" "}
                {comparison.right_version.key_legal_rule}
              </div>
            </div>
          </div>

          {/* Inline Word-Level Redline Diff */}
          <div
            style={{
              padding: "14px 16px",
              background: "var(--color-bg)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div
              style={{
                font: "600 11px ui-monospace,Menlo,monospace",
                letterSpacing: ".06em",
                opacity: 0.7,
              }}
            >
              {isTh
                ? "REDLINE DIFF (ขีดฆ่า = ถ้อยคำเดิมที่ถูกยกเลิก · ไฮไลต์ = ถ้อยคำที่แก้ไขเพิ่มเติม)"
                : "REDLINE STATUTORY DIFF (STRIKETHROUGH = REMOVED · HIGHLIGHT = ADDED)"}
            </div>
            <div style={{ fontSize: "14px", lineHeight: 1.75 }}>
              {comparison.diff_segments.map((seg, i) => {
                if (seg.type === "REMOVED") {
                  return (
                    <span
                      key={i}
                      style={{
                        textDecoration: "line-through",
                        opacity: 0.6,
                        background: "rgba(220, 38, 38, 0.14)",
                        padding: "1px 3px",
                        marginRight: "2px",
                      }}
                    >
                      {seg.text}
                    </span>
                  );
                }
                if (seg.type === "ADDED") {
                  return (
                    <span
                      key={i}
                      style={{
                        fontWeight: 700,
                        background: "color-mix(in srgb,var(--color-accent) 28%,transparent)",
                        padding: "1px 4px",
                        marginRight: "2px",
                      }}
                    >
                      {seg.text}
                    </span>
                  );
                }
                return <span key={i}>{seg.text}</span>;
              })}
            </div>
          </div>

          {/* Bi-Temporal Point-in-Time Routing Rule */}
          <div
            style={{
              fontSize: "12.5px",
              lineHeight: 1.55,
              padding: "10px 14px",
              background: "color-mix(in srgb,var(--color-text) 5%,transparent)",
            }}
          >
            <strong>{isTh ? "เหตุผลแห่งการแก้ไข & กฎการเลือกใช้ตามเวลา (as_of_date): " : "Temporal Routing Rule (as_of_date): "}</strong>
            {comparison.chain.amendment_rationale_th} — {comparison.chain.point_in_time_routing_rule}
          </div>
        </div>
      )}

      {activeTab === "graph-traverse" && (
        <div
          style={{
            background: "var(--color-surface)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="input"
              value={graphQuery}
              onChange={(e) => setGraphQuery(e.target.value)}
              placeholder={
                isTh
                  ? "ค้นหามาตราเพื่อสำรวจกราฟ (เช่น มาตรา 8, มาตรา 65 ทวิ, ฎีกา, BOI)…"
                  : "Enter section or provision (e.g. มาตรา 8, มาตรา 65 ทวิ, BOI)…"
              }
              style={{ flex: "1 1 240px", minHeight: "36px", fontSize: "13.5px" }}
            />
            {[1, 2, 3].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => {
                  setMaxHops(h);
                  runGraphTraverse(graphQuery, h);
                }}
                style={{
                  padding: "7px 11px",
                  border: 0,
                  cursor: "pointer",
                  font: "600 12px ui-monospace,Menlo,monospace",
                  background:
                    maxHops === h
                      ? "var(--color-accent)"
                      : "color-mix(in srgb,var(--color-text) 6%,transparent)",
                  color: maxHops === h ? "var(--on-accent)" : "var(--color-text)",
                }}
              >
                {h}-HOP
              </button>
            ))}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => runGraphTraverse(graphQuery, maxHops)}
              style={{ padding: "8px 14px", fontSize: "13px" }}
            >
              {isTh ? "สำรวจกราฟ →" : "Traverse Graph →"}
            </button>
          </div>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[
              ["มาตรา 8", "พ.ร.บ. ธุรกิจคนต่างด้าว ม.8"],
              ["มาตรา 65", "ประมวลรัษฎากร ม.65"],
              ["มาตรา 31", "BOI สิทธิประโยชน์ ม.31"],
              ["ฎีกา", "คำพิพากษาศาลฎีกา (Deka)"],
            ].map(([qVal, label]) => (
              <button
                key={qVal}
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setGraphQuery(qVal);
                  runGraphTraverse(qVal, maxHops);
                }}
                style={{ fontSize: "12px", padding: "4px 9px" }}
              >
                {label}
              </button>
            ))}
          </div>

          {graphData?.graph_stats && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))",
                gap: "8px",
              }}
            >
              <div style={{ padding: "12px", background: "var(--color-bg)" }}>
                <div style={{ font: "600 10.5px ui-monospace,Menlo,monospace", opacity: 0.7 }}>
                  PROVISION NODES
                </div>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>
                  {graphData.graph_stats.total_provision_nodes.toLocaleString()}
                </div>
              </div>
              <div style={{ padding: "12px", background: "var(--color-bg)" }}>
                <div style={{ font: "600 10.5px ui-monospace,Menlo,monospace", opacity: 0.7 }}>
                  :NEXT_PROVISION EDGES
                </div>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>
                  {graphData.graph_stats.total_sequential_edges.toLocaleString()}
                </div>
              </div>
              <div style={{ padding: "12px", background: "var(--color-bg)" }}>
                <div style={{ font: "600 10.5px ui-monospace,Menlo,monospace", opacity: 0.7 }}>
                  CROSS-REFERENCE EDGES
                </div>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>
                  {graphData.graph_stats.total_cross_reference_edges.toLocaleString()}
                </div>
              </div>
              <div style={{ padding: "12px", background: "var(--color-bg)" }}>
                <div style={{ font: "600 10.5px ui-monospace,Menlo,monospace", opacity: 0.7 }}>
                  RESOLVED / STUB KEYS
                </div>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>
                  {graphData.graph_stats.resolved_cross_references_count.toLocaleString()} /{" "}
                  {graphData.graph_stats.stub_awaiting_ingestion_count.toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {graphData?.hops && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {graphData.hops.slice(0, 10).map((hop, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "12px 14px",
                    background: "var(--color-bg)",
                    borderLeft:
                      hop.hop_distance === 0
                        ? "3px solid var(--color-accent)"
                        : "3px solid var(--color-divider)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        font: "600 11px ui-monospace,Menlo,monospace",
                        color: "var(--color-accent-700)",
                      }}
                    >
                      HOP {hop.hop_distance} · {hop.traversal_type} · {hop.edge_label}
                    </div>
                    {hop.chunk ? (
                      <>
                        <div style={{ fontWeight: 700, fontSize: "14px", marginTop: "2px" }}>
                          [{hop.chunk.authority_code}] {hop.chunk.title_th}
                        </div>
                        <div style={{ fontSize: "12.5px", opacity: 0.75, marginTop: "2px" }}>
                          Canonical Key: <code>{hop.chunk.canonical_provision_key}</code> ·{" "}
                          {hop.chunk.raw_text.slice(0, 140)}…
                        </div>
                      </>
                    ) : hop.stub_node ? (
                      <>
                        <div style={{ fontWeight: 700, fontSize: "14px", marginTop: "2px" }}>
                          [CANONICAL STUB] {hop.stub_node.instrument_hint} (
                          {hop.stub_node.section_code || hop.stub_node.canonical_key})
                        </div>
                        <div style={{ fontSize: "12px", opacity: 0.75 }}>
                          Key: <code>{hop.stub_node.canonical_key}</code> · Status:{" "}
                          {hop.stub_node.status} · Co-citations:{" "}
                          {hop.stub_node.incoming_citation_count} (Deka:{" "}
                          {hop.stub_node.citing_deka_count}, Rulings:{" "}
                          {hop.stub_node.citing_ruling_count})
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
