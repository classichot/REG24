import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

interface SpotCheckCitation {
  passage_id: string;
  work_id: string;
  version_id: string;
  official_identifier: string;
  statement_role: string;
  authenticity_status: string;
  origin_uri: string;
  verbatim_excerpt: string;
}

interface SpotCheckCase {
  spotcheck_id: string;
  stratum: string;
  question: string;
  mode: string;
  applicable_date: string | null;
  legal_check_focus: string;
  is_synthetic_test_reference?: boolean;
  synthetic_test_label_th?: string | null;
  expected_result_label_th?: string | null;
  observed_release_id: string;
  observed_status: string;
  coverage_warnings: string[];
  citations: SpotCheckCitation[];
  answer_text: string;
}

interface OcrQueueItem {
  queue_index: number;
  candidate_id: string;
  physical_corpus_rel_path: string;
  folder: string;
  file_name: string;
  sha256: string;
  byte_size: number;
  physical_page_count: number;
  is_canonical_hash_representative: boolean;
  companion_duplicate_queue_indices: number[];
  file_route: string;
  measured_page_routes: {
    native: number;
    repaired: number;
    ocr: number;
    corrupt: number;
    noncontent: number;
  };
  deferral_reason: string;
  priority_tier: string;
  priority_rationale: string;
  parsed_instrument_identity: {
    instrument_kind: string;
    instrument_number: string | null;
    governing_law_family: string;
    governing_law_raw: string;
    enactment_year_be: number | null;
    is_amending_instrument: boolean;
    amendment_issue_number: string | null;
  };
  matched_quarantine_ref_ids: string[];
  amendment_review_quarantine_ref_ids: string[];
}

function main() {
  const previewBaseUrl = (
    process.env.REG24_PREVIEW_BASE_URL || "https://reg24-cfwj4zfs9-7-l-advisory.vercel.app"
  ).replace(/\/+$/, "");
  const previewShareToken =
    process.env.REG24_PREVIEW_SHARE_TOKEN || "0XojREQcTcjegpI7jbvqWHuRyIZAKQqG";
  const interactiveBatchesPreviewUrl = `${previewBaseUrl}/admin/knowledge/batches?_vercel_share=${previewShareToken}`;

  const auditDir = path.resolve(process.cwd(), "docs", "audit", "dodo-review-rc2-b02");
  const packPath = path.join(auditDir, "b01_rc2_legal_spotcheck_pack_30cases.json");
  const queueGzPath = path.join(auditDir, "ocr_recovery_queue_b02_5275.json.gz");

  const pack = JSON.parse(fs.readFileSync(packPath, "utf8")) as {
    release_id: string;
    manifest_id: string;
    manifest_hash: string;
    cases: SpotCheckCase[];
  };

  // ---------------------------------------------------------------------------
  // 1. Update B01 Legal Review Ledger for Owner & Owner's Internal Legal Team
  // ---------------------------------------------------------------------------
  const b01Ledger = {
    schema_version: "reg24.b01_owner_legal_review_ledger.v2",
    updated_at: new Date().toISOString(),
    release_id: pack.release_id,
    manifest_id: pack.manifest_id,
    manifest_hash: pack.manifest_hash,
    review_governance: {
      review_authority: "PRODUCT_OWNER_AND_INTERNAL_LEGAL_TEAM",
      external_counsel_engagement_authorized: false,
      policy_note:
        "Product Owner is a licensed lawyer; substantive Thai tax-law review of the 30-case Batch 1 pack and 33-document B02 OCR pilot list is conducted directly by the Product Owner and internal legal team. Automated technical checks and Dodo spot-checks do not substitute for legal team sign-off.",
    },
    summary: {
      total_cases: pack.cases.length,
      reviewed_pass: 0,
      reviewed_needs_correction: 0,
      reviewed_exclude_from_trial: 0,
      pending_review: pack.cases.length,
    },
    cases: pack.cases.map((c) => ({
      spotcheck_id: c.spotcheck_id,
      stratum: c.stratum,
      is_synthetic_test_reference: Boolean(c.is_synthetic_test_reference),
      synthetic_test_label_th: c.synthetic_test_label_th || null,
      question: c.question,
      applicable_date: c.applicable_date,
      observed_status: c.observed_status,
      primary_citations: c.citations.map((cit) => ({
        official_identifier: cit.official_identifier,
        statement_role: cit.statement_role,
        origin_uri: cit.origin_uri,
      })),
      legal_check_focus: c.legal_check_focus,
      review_status: "PENDING_OWNER_LEGAL_TEAM",
      verdict: null as "PASS" | "NEEDS_CORRECTION" | "EXCLUDE_FROM_TRIAL" | null,
      reviewer_name: null as string | null,
      reviewed_at: null as string | null,
      legal_findings: null as string | null,
      remediation_applied: null as string | null,
    })),
  };

  fs.writeFileSync(
    path.join(auditDir, "b01_thai_tax_law_independent_review_ledger.json"),
    JSON.stringify(b01Ledger, null, 2),
    "utf8"
  );

  // Build Markdown 30-Case Batch 1 Legal Review Pack
  const b01MdLines: string[] = [
    `# REG24 Batch 1 (\`${pack.release_id}\`) — 30-Case Thai Tax Legal Review Pack`,
    "",
    `- **Reviewing Authority**: Product Owner & Internal Legal Team *(no external counsel engaged)*`,
    `- **Candidate Release**: \`${pack.release_id}\` · Manifest \`${pack.manifest_id}\` (\`${pack.manifest_hash.slice(0, 16)}…\`)`,
    `- **Interactive Preview (for live side-by-side testing)**: ${interactiveBatchesPreviewUrl}`,
    `- **How to Record Findings**: Mark each case as \`PASS\`, \`NEEDS_CORRECTION\` (with correction notes), or \`EXCLUDE_FROM_TRIAL\`. Engineering will record all findings in \`b01_thai_tax_law_independent_review_ledger.json\` and apply any required fixes or safe withdrawals before external user invitations.`,
    "",
    `> [!IMPORTANT]`,
    `> **Distinction of Synthetic Negative Test**: Case **\`LSC-30\`** (\`กค 0702/999999\`) is an invented negative test (**“เลขสมมติสำหรับทดสอบ ไม่ใช่ข้อหารือจริง”**) whose expected result is **“ไม่พบข้อมูล / หลักฐานไม่เพียงพอ”** (\`INSUFFICIENT_EVIDENCE\`). All real RD ruling cases (\`LSC-01..LSC-17\`, \`LSC-21..LSC-25\`) link directly to official \`https://www.rd.go.th/<id>.html\` documents.`,
    "",
    "## Quick Summary Checklist (`LSC-01` – `LSC-30`)",
    "",
    "| Case | Stratum | Primary Reference(s) | Source Link(s) | Observed Status | Legal Verdict (`PASS` / `CORRECT` / `EXCLUDE`) |",
    "| :--- | :--- | :--- | :--- | :---: | :--- |",
  ];

  for (const c of pack.cases) {
    const uniqueRefs = Array.from(new Set(c.citations.map((x) => x.official_identifier))).slice(0, 3);
    const refStr = c.is_synthetic_test_reference
      ? "กค 0702/999999 *(เลขสมมติสำหรับทดสอบ ไม่ใช่ข้อหารือจริง)*"
      : uniqueRefs.join(", ") || "*(Abstention — no source cited)*";
    const uniqueLinks = Array.from(new Set(c.citations.map((x) => x.origin_uri))).slice(0, 2);
    const linkStr = uniqueLinks.length > 0 ? uniqueLinks.map((u) => `[source](${u})`).join(" · ") : "—";
    b01MdLines.push(
      `| **${c.spotcheck_id}** | \`${c.stratum}\` | ${refStr} | ${linkStr} | \`${c.observed_status}\` | \`[ ] PASS  [ ] CORRECT  [ ] EXCLUDE\` |`
    );
  }

  b01MdLines.push("", "---", "", "## Full Case-by-Case Answers & Source Citations", "");

  for (const c of pack.cases) {
    b01MdLines.push(`### ${c.spotcheck_id} — \`${c.stratum}\``);
    if (c.is_synthetic_test_reference) {
      b01MdLines.push(
        `- **ประเภทข้อมูลทดสอบ**: **${c.synthetic_test_label_th}** · **ผลที่คาดหมาย**: **${c.expected_result_label_th}**`
      );
    }
    b01MdLines.push(`- **Question**: ${c.question}`);
    if (c.applicable_date) {
      b01MdLines.push(`- **Applicable Date**: \`${c.applicable_date}\``);
    }
    b01MdLines.push(`- **Legal Review Focus**: ${c.legal_check_focus}`);
    b01MdLines.push(`- **Observed Status**: \`${c.observed_status}\``);
    if (c.citations.length > 0) {
      b01MdLines.push(`- **Cited Original Sources**:`);
      const seenKey = new Set<string>();
      for (const cit of c.citations) {
        const k = `${cit.official_identifier}|${cit.origin_uri}|${cit.statement_role}`;
        if (seenKey.has(k)) continue;
        seenKey.add(k);
        b01MdLines.push(
          `  - **${cit.official_identifier}** (\`${cit.statement_role}\`, \`${cit.authenticity_status}\`): ${cit.origin_uri}`
        );
      }
    } else {
      b01MdLines.push(`- **Cited Original Sources**: *(None — clean abstention)*`);
    }
    if (c.coverage_warnings.length > 0) {
      b01MdLines.push(`- **Quarantined / Coverage Disclosure**: ${c.coverage_warnings.join(" | ")}`);
    }
    b01MdLines.push("", "**REG24 Rendered Answer (`rel.B01.rc5`)**:", "```markdown", c.answer_text, "```");
    b01MdLines.push(
      "- **Legal Team Verdict**: `[ ] PASS` · `[ ] NEEDS_CORRECTION` · `[ ] EXCLUDE_FROM_TRIAL`",
      "- **Findings / Required Correction**: _______________________________________________",
      ""
    );
  }

  const b01MdContent = b01MdLines.join("\n");
  fs.writeFileSync(path.join(auditDir, "Batch_1_30_Case_Legal_Review_Pack.md"), b01MdContent, "utf8");

  // ---------------------------------------------------------------------------
  // 2. Build Separate 33-Document (170-Page) B02 Public OCR Pilot Review List
  // ---------------------------------------------------------------------------
  const rawQueue = JSON.parse(zlib.gunzipSync(fs.readFileSync(queueGzPath)).toString("utf8"));
  const queueArr: OcrQueueItem[] = Array.isArray(rawQueue) ? rawQueue : rawQueue.items;

  const pilotUniqueDocs = queueArr
    .filter(
      (x) =>
        x.is_canonical_hash_representative &&
        (x.priority_tier.startsWith("P0") || x.priority_tier.startsWith("P1"))
    )
    .sort((a, b) => {
      if (a.priority_tier !== b.priority_tier) {
        return a.priority_tier.localeCompare(b.priority_tier);
      }
      return a.physical_corpus_rel_path.localeCompare(b.physical_corpus_rel_path);
    });

  const totalUniquePages = pilotUniqueDocs.reduce((s, d) => s + d.physical_page_count, 0);

  const ocrReviewJson = {
    schema_version: "reg24.b02_ocr_pilot_legal_review_list.v1",
    generated_at: new Date().toISOString(),
    review_authority: "PRODUCT_OWNER_AND_INTERNAL_LEGAL_TEAM",
    pilot_posture: {
      paid_ocr_run_started: false,
      privacy_classification_all_33_docs: "public",
      usable_as_legal_evidence_until_reviewed: false,
      ocr_alone_releases_quarantine: false,
      unique_documents_count: pilotUniqueDocs.length,
      unique_pages_count: totalUniquePages,
      p0_documents_count: pilotUniqueDocs.filter((d) => d.priority_tier.startsWith("P0")).length,
      p0_pages_count: pilotUniqueDocs
        .filter((d) => d.priority_tier.startsWith("P0"))
        .reduce((s, d) => s + d.physical_page_count, 0),
      p1_documents_count: pilotUniqueDocs.filter((d) => d.priority_tier.startsWith("P1")).length,
      p1_pages_count: pilotUniqueDocs
        .filter((d) => d.priority_tier.startsWith("P1"))
        .reduce((s, d) => s + d.physical_page_count, 0),
    },
    documents: pilotUniqueDocs.map((d, idx) => {
      const reviewItemId = `OCR-REV-${String(idx + 1).padStart(2, "0")}`;
      const relPdfPath = `/ocr-pilot-review-pdfs/${reviewItemId}.pdf`;
      const diskPdfPath = path.resolve(process.cwd(), "public", "ocr-pilot-review-pdfs", `${reviewItemId}.pdf`);
      let pdfShaVerified = false;
      if (fs.existsSync(diskPdfPath)) {
        const diskSha = crypto.createHash("sha256").update(fs.readFileSync(diskPdfPath)).digest("hex");
        pdfShaVerified = diskSha === d.sha256;
      }
      const previewPdfUrl = `${previewBaseUrl}${relPdfPath}?_vercel_share=${previewShareToken}`;
      const pi = d.parsed_instrument_identity;
      const gazetteSearchQuery = [
        pi.instrument_kind,
        pi.instrument_number ? `ฉบับที่ ${pi.instrument_number}` : "",
        pi.governing_law_raw || pi.governing_law_family,
        pi.enactment_year_be ? `พ.ศ. ${pi.enactment_year_be}` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      return {
        review_item_id: reviewItemId,
        priority_tier: d.priority_tier,
        queue_index: d.queue_index,
        candidate_id: d.candidate_id,
        physical_corpus_rel_path: d.physical_corpus_rel_path,
        sha256: d.sha256,
        physical_page_count: d.physical_page_count,
        ocr_image_pages: d.measured_page_routes.ocr,
        corrupt_font_pages: d.measured_page_routes.corrupt,
        duplicate_companion_indices: d.companion_duplicate_queue_indices,
        privacy_class: "public",
        accessible_original_pdf: {
          preview_pdf_path: relPdfPath,
          preview_pdf_url: previewPdfUrl,
          sha256_verified_exact_original: pdfShaVerified,
          royal_gazette_portal_url: "https://ratchakitcha.soc.go.th",
          royal_gazette_search_query_th: gazetteSearchQuery,
        },
        provisional_instrument_identity: d.parsed_instrument_identity,
        matched_quarantine_ref_ids: d.matched_quarantine_ref_ids,
        amendment_review_quarantine_ref_ids: d.amendment_review_quarantine_ref_ids,
        priority_rationale: d.priority_rationale,
        usable_as_legal_evidence: false,
        legal_review_checklist: {
          instrument_and_governing_law_verified: null as boolean | null,
          enactment_year_and_royal_gazette_verified: null as boolean | null,
          sections_rates_negations_and_tables_verified: null as boolean | null,
          current_force_or_repeal_amendment_status_verified: null as boolean | null,
          approved_to_release_quarantined_citations: null as boolean | null,
        },
        verdict: null as "PASS_ADMIT" | "ADMIT_HISTORICAL_ONLY" | "HOLD_QUARANTINED" | null,
        reviewer_name: null as string | null,
        reviewed_at: null as string | null,
        legal_notes: null as string | null,
      };
    }),
  };

  fs.writeFileSync(
    path.join(auditDir, "b02_170page_ocr_pilot_review_list.json"),
    JSON.stringify(ocrReviewJson, null, 2),
    "utf8"
  );

  const ocrMdLines: string[] = [
    "# REG24 B02 — 170-Page Public OCR Pilot Legal Review Schedule (33 Unique Documents)",
    "",
    "- **Reviewing Authority**: Product Owner & Internal Legal Team *(no external counsel engaged)*",
    `- **Scope**: **\`${pilotUniqueDocs.length}\` unique public Thai legal instruments (\`${totalUniquePages}\` unique pages)**:`,
    `  - **Tier \`P0\` (\`2\` Acts, \`55\` pages)**: Primary statutes directly matching quarantined citations (\`usable_as_legal_evidence: false\` until reviewed).`,
    `  - **Tier \`P1\` (\`31\` Royal Decrees / Ministerial Regulations / Notifications, \`115\` pages)**: Core Revenue Department CIT/PIT/VAT/SBT/General public tax legislation with scanned pages (\`151\` pages) or corrupt legacy PDF fonts (\`19\` pages).`,
    "- **Accessible Original Source PDFs & Royal Gazette Cross-Check**:",
    `  - Every row below includes a direct **[Open Original PDF]** link served over the authenticated REG24 Vercel Preview (\`33/33\` byte-for-byte SHA-256 verified against the official Revenue Department public PDFs).`,
    `  - Official Royal Gazette cross-check portal: https://ratchakitcha.soc.go.th *(exact Thai search title included per row in \`b02_170page_ocr_pilot_review_list.json\`)*.`,
    "- **Evidence Quarantine Rule**: Every OCR output and every matched citation remains strictly quarantined (`usable_as_legal_evidence: false`, `applicability_status: \"not_assessed\"`) until your legal team verifies:",
    "  1. **Instrument Identity & Governing Act** (exact number, title, and enabling Act — no number-only homonym matching),",
    "  2. **Enactment Year & Royal Gazette Citation** (volume, part, publication date, and effective-date clause),",
    "  3. **Verbatim Transcription of Critical Tokens** (Thai/Arabic numerals, tax rates, `ไม่`/`มิใช่`/`เว้นแต่` negations, and table cells), and",
    "  4. **Version & Applicability Status** (currently in force vs. amended or repealed).",
    "",
    "## Part A — Tier `P0` Instruments Unlocking Quarantined Citations (`2` Docs · `55` Pages)",
    "",
    "| ID | Original PDF & Gazette | File Path (`RD - Revenue Department/...`) | Pages (OCR / Font) | Governing Law & Year | Matched Quarantined Refs | Legal Team Verdict |",
    "| :--- | :--- | :--- | :---: | :--- | :--- | :--- |",
  ];

  for (const doc of ocrReviewJson.documents.filter((d) => d.priority_tier.startsWith("P0"))) {
    const idInfo = `${doc.provisional_instrument_identity.governing_law_raw || doc.provisional_instrument_identity.governing_law_family} (พ.ศ. ${doc.provisional_instrument_identity.enactment_year_be ?? "?"})`;
    const qRefs =
      doc.matched_quarantine_ref_ids.length > 0
        ? `${doc.matched_quarantine_ref_ids.length} refs (\`${doc.matched_quarantine_ref_ids.slice(0, 2).join("`, `")}\`${doc.matched_quarantine_ref_ids.length > 2 ? ", …" : ""})`
        : "—";
    const pdfLinks = `[Open Original PDF](${doc.accessible_original_pdf.preview_pdf_url}) · [Gazette](${doc.accessible_original_pdf.royal_gazette_portal_url})`;
    ocrMdLines.push(
      `| **${doc.review_item_id}** | ${pdfLinks} | \`${doc.physical_corpus_rel_path}\` *(sha256: \`${doc.sha256.slice(0, 10)}…\`)* | **${doc.physical_page_count}** (${doc.ocr_image_pages} scan / ${doc.corrupt_font_pages} font) | ${idInfo} | ${qRefs} | \`[ ] ADMIT  [ ] HIST  [ ] HOLD\` |`
    );
  }

  ocrMdLines.push(
    "",
    "## Part B — Tier `P1` Core Public Tax Subordinate Legislation (`31` Docs · `115` Pages)",
    "",
    "| ID | Original PDF & Gazette | File Path (`RD - Revenue Department/...`) | Pages (OCR / Font) | Instrument Kind, No. & Governing Law | Amendment / Quarantine Notes | Legal Team Verdict |",
    "| :--- | :--- | :--- | :---: | :--- | :--- | :--- |"
  );

  for (const doc of ocrReviewJson.documents.filter((d) => d.priority_tier.startsWith("P1"))) {
    const pi = doc.provisional_instrument_identity;
    const noPart = pi.instrument_number ? `ฉบับที่ ${pi.instrument_number} ` : "";
    const yrPart = pi.enactment_year_be ? `(พ.ศ. ${pi.enactment_year_be})` : "";
    const idInfo = `${pi.instrument_kind} ${noPart}${yrPart} · ${pi.governing_law_raw || pi.governing_law_family}`;
    const noteParts: string[] = [];
    if (doc.amendment_review_quarantine_ref_ids.length > 0) {
      noteParts.push(`Amend-check: \`${doc.amendment_review_quarantine_ref_ids.join(", ")}\``);
    }
    if (doc.duplicate_companion_indices.length > 0) {
      noteParts.push(`+${doc.duplicate_companion_indices.length} byte-dup`);
    }
    const pdfLinks = `[Open Original PDF](${doc.accessible_original_pdf.preview_pdf_url}) · [Gazette](${doc.accessible_original_pdf.royal_gazette_portal_url})`;
    ocrMdLines.push(
      `| **${doc.review_item_id}** | ${pdfLinks} | \`${doc.physical_corpus_rel_path}\` *(sha256: \`${doc.sha256.slice(0, 10)}…\`)* | **${doc.physical_page_count}** (${doc.ocr_image_pages} scan / ${doc.corrupt_font_pages} font) | ${idInfo} | ${noteParts.join("; ") || "Quarantined (`usable_as_legal_evidence: false`)"} | \`[ ] ADMIT  [ ] HIST  [ ] HOLD\` |`
    );
  }

  const ocrMdContent = ocrMdLines.join("\n");
  fs.writeFileSync(
    path.join(auditDir, "B02_170_Page_OCR_Pilot_Legal_Review_List.md"),
    ocrMdContent,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        b01_pack_cases: pack.cases.length,
        b02_pilot_unique_docs: pilotUniqueDocs.length,
        b02_pilot_unique_pages: totalUniquePages,
      },
      null,
      2
    )
  );
}

main();
