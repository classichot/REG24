/**
 * REG24 — Official Source Onboarding, Publisher Registry, Capture Identity Verification,
 * Locator Replay & Thai Scan OCR Review Engine
 *
 * Implements Sections 2, 3, and 4 of:
 * "REG24 developer requirements — official-source citations and claim traceability"
 * - SRC-01, SRC-02, SRC-03
 * - Ingestion rules 4.1, 4.2, 4.3, 4.4
 * - Fixtures T01, T02, T05, T07, T09, T10, T12
 */

import { arabicDigitsToThai, sha256Bytes, thaiDigitsToArabic } from "./identity";
import type { Actor, BatchId, StatementRole } from "./contracts";
import type { DurableKnowledgeStore, CanonicalPersistedState } from "./store";
import type {
  AccessPermissionKind,
  DocumentVersionRecord,
  EvidencePassageRecord,
  ExtractionAlignmentSegment,
  ExtractionRevisionRecord,
  IdentityMatchResult,
  OfficialDocumentRecord,
  OfficialLocationRecord,
  OfficialPublisherRegistryEntry,
  OfficialRecordType,
  OfficialSourceFamily,
  PageMappingEntry,
  PersistedCitationTraceabilityState,
  PreservationPermissionKind,
  ProvisionEffectiveIntervalRecord,
  SourceFamilyPinpointMetadata,
  TraceabilityAuditEventRecord,
  TypedPassageAnchor,
} from "./citation-contracts";

export const REVIEWED_OFFICIAL_PUBLISHER_REGISTRY: Record<string, OfficialPublisherRegistryEntry> = {
  "reg.th.rd": {
    publisher_id: "reg.th.rd",
    name_th: "กรมสรรพากร",
    name_en: "Revenue Department of Thailand",
    source_families: ["revenue_department_ruling", "gazette_enactment"],
    permitted_hosts: ["www.rd.go.th", "rd.go.th", "epit.rd.go.th"],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  },
  "reg.th.soc_ratchakitcha": {
    publisher_id: "reg.th.soc_ratchakitcha",
    name_th: "สำนักเลขาธิการคณะรัฐมนตรี (ราชกิจจานุเบกษา)",
    name_en: "Secretariat of the Cabinet (Royal Thai Government Gazette)",
    source_families: ["gazette_enactment"],
    permitted_hosts: ["ratchakitcha.soc.go.th", "www.ratchakitcha.soc.go.th"],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  },
  "reg.th.parliament": {
    publisher_id: "reg.th.parliament",
    name_th: "รัฐสภา / ฝ่ายนิติบัญญัติ",
    name_en: "National Assembly of Thailand",
    source_families: ["gazette_enactment"],
    permitted_hosts: [
      "ratchakitcha.soc.go.th",
      "www.ratchakitcha.soc.go.th",
      "www.rd.go.th",
      "rd.go.th",
      "www.krisdika.go.th",
      "dl.parliament.go.th",
    ],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  },
  "reg.th.cabinet": {
    publisher_id: "reg.th.cabinet",
    name_th: "คณะรัฐมนตรี",
    name_en: "Cabinet of Thailand",
    source_families: ["gazette_enactment"],
    permitted_hosts: [
      "ratchakitcha.soc.go.th",
      "www.ratchakitcha.soc.go.th",
      "www.rd.go.th",
      "rd.go.th",
      "www.soc.go.th",
    ],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  },
  "reg.th.mof": {
    publisher_id: "reg.th.mof",
    name_th: "กระทรวงการคลัง",
    name_en: "Ministry of Finance",
    source_families: ["gazette_enactment", "revenue_department_ruling"],
    permitted_hosts: [
      "ratchakitcha.soc.go.th",
      "www.ratchakitcha.soc.go.th",
      "www.mof.go.th",
      "www.rd.go.th",
      "rd.go.th",
    ],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  },
  "reg.th.supreme_court": {
    publisher_id: "reg.th.supreme_court",
    name_th: "ศาลฎีกา",
    name_en: "Supreme Court of Thailand",
    source_families: ["supreme_court_decision"],
    permitted_hosts: ["deka.supremecourt.or.th", "www.supremecourt.or.th"],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  },
  "reg.th.ocs": {
    publisher_id: "reg.th.ocs",
    name_th: "สำนักงานคณะกรรมการกฤษฎีกา",
    name_en: "Office of the Council of State",
    source_families: ["council_of_state_opinion", "gazette_enactment"],
    permitted_hosts: [
      "www.krisdika.go.th",
      "krisdika.go.th",
      "www.ocs.go.th",
      "ocs.go.th",
      "searchlaw.ocs.go.th",
    ],
    supports_pdf_page_fragment: true,
    supports_html_fragment: false,
    reviewed_by: "legal.ops@reg24.th",
    reviewed_at: "2026-11-18T00:00:00.000Z",
    active: true,
  },
};

export function createEmptyCitationLedger(): PersistedCitationTraceabilityState {
  const modeEnv = process.env.REG24_CLAIM_TRACEABILITY_MODE;
  const gateMode =
    modeEnv === "verified_readonly" || modeEnv === "generation_disabled"
      ? modeEnv
      : "enforced";
  return {
    initialized_for_release_id: null,
    publication_gate_mode: gateMode,
    publishers: { ...REVIEWED_OFFICIAL_PUBLISHER_REGISTRY },
    documents: {},
    versions: {},
    locations: {},
    extraction_revisions: {},
    passages: {},
    graph_assertions: {},
    published_answers: {},
    claim_evidence_links: {},
    audit_events: [],
    reconciliation_tasks: {},
    projection_outbox: {},
  };
}

export function ensureCitationLedgerInState(
  state: CanonicalPersistedState
): PersistedCitationTraceabilityState {
  if (!state.citation_ledger) {
    state.citation_ledger = createEmptyCitationLedger();
  } else {
    state.citation_ledger.publishers = {
      ...REVIEWED_OFFICIAL_PUBLISHER_REGISTRY,
      ...state.citation_ledger.publishers,
    };
  }
  return state.citation_ledger;
}

export function normalizeThaiSearchTextOnly(verbatimText: string): string {
  return thaiDigitsToArabic(verbatimText || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function appendCitationAuditEvent(
  ledger: PersistedCitationTraceabilityState,
  params: Omit<TraceabilityAuditEventRecord, "audit_id" | "recorded_at"> & {
    audit_id?: string;
    recorded_at?: string;
  }
): TraceabilityAuditEventRecord {
  const recordedAt = params.recorded_at || new Date().toISOString();
  const auditId =
    params.audit_id ||
    `caud.${sha256Bytes(`${params.actor_or_service}:${params.event_type}:${params.correlation_id}:${ledger.audit_events.length}:${recordedAt}`).slice(0, 16)}`;
  const ev: TraceabilityAuditEventRecord = {
    audit_id: auditId,
    actor_or_service: params.actor_or_service,
    recorded_at: recordedAt,
    event_type: params.event_type,
    affected_ids: [...params.affected_ids],
    before_status: params.before_status ? { ...params.before_status } : null,
    after_status: params.after_status ? { ...params.after_status } : null,
    reason: params.reason,
    correlation_id: params.correlation_id,
  };
  ledger.audit_events.push(ev);
  return ev;
}

export interface CaptureIdentityCheckInput {
  issuer_id: string;
  source_family: OfficialSourceFamily;
  observed_url: string;
  final_url?: string;
  http_status: number;
  mime_type: string;
  expected_native_id?: string | null;
  expected_title_th: string;
  captured_text_or_html: string;
  issuer_metadata?: Record<string, unknown>;
  registry?: Record<string, OfficialPublisherRegistryEntry>;
}

export interface CaptureIdentityCheckResult {
  eligible_host: boolean;
  identity_match_result: IdentityMatchResult;
  passed: boolean;
  verification_method: string;
  failure_reason: string | null;
}

/**
 * SRC-01 & T05: Verifies captured official document identity against issuer metadata AND document text.
 * An official hostname, search result, homepage, login page, or HTTP 200 alone is insufficient!
 */
export function verifyCapturedOfficialIdentity(
  input: CaptureIdentityCheckInput
): CaptureIdentityCheckResult {
  const reg = input.registry || REVIEWED_OFFICIAL_PUBLISHER_REGISTRY;
  const pub = reg[input.issuer_id];
  if (!pub || !pub.active || !pub.source_families.includes(input.source_family)) {
    return {
      eligible_host: false,
      identity_match_result: "FAILED_UNTRUSTED_HOST",
      passed: false,
      verification_method: "publisher_registry_check_v1",
      failure_reason: `Issuer '${input.issuer_id}' is not registered/active for source family '${input.source_family}'.`,
    };
  }

  const effectiveUrlStr = input.final_url || input.observed_url;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(effectiveUrlStr);
  } catch {
    return {
      eligible_host: false,
      identity_match_result: "FAILED_UNTRUSTED_HOST",
      passed: false,
      verification_method: "publisher_registry_check_v1",
      failure_reason: `Malformed official URL: '${effectiveUrlStr}'.`,
    };
  }

  const host = parsedUrl.hostname.toLowerCase();
  const hostPermitted = pub.permitted_hosts.some((h) => h.toLowerCase() === host);
  if (!hostPermitted) {
    return {
      eligible_host: false,
      identity_match_result: "FAILED_UNTRUSTED_HOST",
      passed: false,
      verification_method: "publisher_registry_check_v1",
      failure_reason: `Host '${host}' is not in permitted delivery hosts [${pub.permitted_hosts.join(", ")}] for '${input.issuer_id}'.`,
    };
  }

  if (input.http_status < 200 || input.http_status >= 300) {
    return {
      eligible_host: true,
      identity_match_result: "FAILED_SOFT_404",
      passed: false,
      verification_method: "http_and_content_identity_v1",
      failure_reason: `Non-2xx HTTP status ${input.http_status}.`,
    };
  }

  const normBody = thaiDigitsToArabic(input.captured_text_or_html || "")
    .replace(/\s+/g, " ")
    .trim();

  // 1. Detect login wall served with HTTP 200 (T05)
  const isLoginWall =
    /(?:type\s*=\s*["']password["']|เข้าสู่ระบบสมาชิก|กรุณาเข้าสู่ระบบเพื่อดูเอกสาร|sign\s+in\s+to\s+continue|login\s+required)/i.test(
      normBody
    ) && normBody.length < 4500;
  if (isLoginWall) {
    return {
      eligible_host: true,
      identity_match_result: "FAILED_LOGIN_WALL",
      passed: false,
      verification_method: "http_and_content_identity_v1",
      failure_reason: "Official domain returned a login/authentication wall with HTTP 200 instead of the document.",
    };
  }

  // 2. Detect soft 404 served with HTTP 200 (T05 / Section 7)
  const isSoft404 =
    /(?:ไม่พบหน้าที่คุณต้องการ|ไม่พบข้อมูลที่ค้นหา|ไม่พบเอกสารที่ระบุ|404\s*not\s*found|page\s+not\s+found|error\s*404)/i.test(
      normBody
    ) && normBody.length < 4000;
  if (isSoft404) {
    return {
      eligible_host: true,
      identity_match_result: "FAILED_SOFT_404",
      passed: false,
      verification_method: "http_and_content_identity_v1",
      failure_reason: "Official domain returned a soft-404 error page with HTTP 200.",
    };
  }

  // 3. Detect bare homepage or generic search-results page served with HTTP 200 (T05)
  const cleanPath = parsedUrl.pathname.replace(/\/+$/, "");
  const isBareRoot =
    (cleanPath === "" || cleanPath === "/index.html" || cleanPath === "/home" || cleanPath === "/search") &&
    !parsedUrl.search;
  const looksLikeSearchOrHome =
    isBareRoot ||
    (/(?:ผลการค้นหา\s*\d+\s*รายการ|search\s+results\s+for|หน้าหลักกรมสรรพากร|welcome\s+to\s+revenue\s+department)/i.test(
      normBody
    ) &&
      normBody.length < 5000);
  if (looksLikeSearchOrHome) {
    return {
      eligible_host: true,
      identity_match_result: "FAILED_HOMEPAGE_OR_SEARCH",
      passed: false,
      verification_method: "http_and_content_identity_v1",
      failure_reason: "Official URL resolved to a generic homepage or search results listing rather than a document-specific record.",
    };
  }

  // 4. Verify expected document identity against document text or issuer metadata (SRC-01, T05)
  const cleanAlnum = (s: string) =>
    thaiDigitsToArabic(s || "")
      .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9/]+/g, "")
      .toLowerCase();

  const expectedIdAlnum = cleanAlnum(input.expected_native_id || "");
  const bodyAlnum = cleanAlnum(normBody);
  const metaAlnum = cleanAlnum(JSON.stringify(input.issuer_metadata || {}));

  const titleTokens = thaiDigitsToArabic(input.expected_title_th || "")
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4);

  const matchedTitleTokens = titleTokens.filter(
    (tok) => normBody.toLowerCase().includes(tok.toLowerCase()) || metaAlnum.includes(tok.toLowerCase())
  );
  const titleRatio = titleTokens.length > 0 ? matchedTitleTokens.length / titleTokens.length : 0;

  let idMatched = false;
  if (expectedIdAlnum) {
    const bareId = expectedIdAlnum.replace(/^กค/, "");
    // Extract slash-coded official ref (e.g. 0702/636, 412/2567) OR section code (e.g. มาตรา70, มาตรา1097, ข้อ8)
    const slashCode = thaiDigitsToArabic(input.expected_native_id || "")
      .match(/[0-9]{2,5}\s*\/\s*[^\s)]+/)?.[0]
      ?.replace(/\s+/g, "")
      .toLowerCase();
    const sectionCode = thaiDigitsToArabic(input.expected_native_id || "")
      .match(/(?:มาตรา|ข้อ)\s*[0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ))?/)?.[0]
      ?.replace(/\s+/g, "")
      .toLowerCase();

    if (
      bodyAlnum.includes(expectedIdAlnum) ||
      (bareId.length >= 4 && bodyAlnum.includes(bareId)) ||
      metaAlnum.includes(expectedIdAlnum)
    ) {
      idMatched = true;
    } else if (slashCode) {
      // If a slash code (ruling/decision/opinion number) is expected, it MUST appear in body or issuer metadata (T05)!
      idMatched = bodyAlnum.includes(slashCode) || metaAlnum.includes(slashCode);
    } else if (sectionCode) {
      // Provision section code must match AND title/instrument context must align
      idMatched =
        (bodyAlnum.includes(sectionCode) || metaAlnum.includes(sectionCode)) &&
        (titleRatio >= 0.3 || matchedTitleTokens.length >= 1);
    }
  }

  if ((expectedIdAlnum && !idMatched) || (!expectedIdAlnum && titleRatio < 0.4)) {
    return {
      eligible_host: true,
      identity_match_result: "FAILED_UNRELATED_DOCUMENT",
      passed: false,
      verification_method: "http_and_content_identity_v1",
      failure_reason: `Captured content on '${host}' failed identity match against expected '${input.expected_native_id || input.expected_title_th}'.`,
    };
  }

  return {
    eligible_host: true,
    identity_match_result: "VERIFIED_MATCH",
    passed: true,
    verification_method: "http_and_content_identity_v1",
    failure_reason: null,
  };
}

/**
 * Section 4.3 & T02: Detects OCR ambiguity in Thai digits or negations that can alter legal meaning.
 * Model confidence score alone NEVER clears an OCR ambiguity!
 */
export function detectThaiOcrMeaningAmbiguity(params: {
  is_scanned_material: boolean;
  raw_transcription: string;
  explicit_uncertain_tokens?: string[];
  suspected_missing_negation?: boolean;
  model_confidence?: number | null;
}): {
  ambiguous: boolean;
  reasons: string[];
} {
  if (!params.is_scanned_material) {
    return { ambiguous: false, reasons: [] };
  }
  const reasons: string[] = [];
  const text = params.raw_transcription || "";

  if (params.explicit_uncertain_tokens && params.explicit_uncertain_tokens.length > 0) {
    reasons.push(
      `AMBIGUOUS_CRITICAL_TOKENS:${params.explicit_uncertain_tokens.join(",")}`
    );
  }
  if (params.suspected_missing_negation) {
    reasons.push("SUSPECTED_MISSING_OR_BLURRED_THAI_NEGATION");
  }
  // Detect OCR placeholder / garbled Thai digit / broken negation glyphs (e.g. `[?]`, ``, `ไม?`, `ร้อยละ ?`, mixed confusable `๐`/`o` inside Thai numbers)
  if (/[\uFFFD]|\[(?:\?|ocr_uncertain|ไม่ชัด)[^\]]*\]/i.test(text)) {
    reasons.push("OCR_UNRESOLVED_GLYPH_MARKER");
  }
  if (/(?:ร้อยละ|อัตรา|มาตรา|พ\.ศ\.|ภายใน)\s*(?:[?~_]|[0-9๐-๙]*[oOlI][0-9๐-๙]*)/.test(text)) {
    reasons.push("AMBIGUOUS_THAI_NUMERIC_RATE_OR_DEADLINE");
  }
  if (/(?:ไม\s+[ก-๙]|มิได\s+|เวนแต)/.test(text)) {
    reasons.push("CORRUPTED_THAI_NEGATION_OR_EXCEPTION_TOKEN");
  }

  return {
    ambiguous: reasons.length > 0,
    reasons,
  };
}

/**
 * Section 4.3: Replays a passage's typed anchors against the pinned ExtractionRevisionRecord.
 * Quarantines the passage if:
 * - zero anchors exist,
 * - anchor selects 0 occurrences or >1 ambiguous occurrences on the target page/document,
 * - anchor text mismatches `verbatim_text`, or
 * - anchor points to the wrong physical page!
 */
export function replayPassageLocatorAgainstExtraction(
  passage: Pick<
    EvidencePassageRecord,
    "verbatim_text" | "physical_page_start" | "physical_page_end" | "anchors"
  >,
  extraction: ExtractionRevisionRecord
): {
  verified: boolean;
  reason: string | null;
} {
  if (!passage.anchors || passage.anchors.length === 0) {
    return { verified: false, reason: "MISSING_TYPED_LOCATOR_ANCHORS" };
  }

  const cleanTarget = passage.verbatim_text.trim();
  if (!cleanTarget) {
    return { verified: false, reason: "EMPTY_PASSAGE_TEXT" };
  }

  // If page_mapping is populated, verify physical page spans and per-page text containment!
  if (extraction.page_mapping.length > 0 && passage.physical_page_start !== null) {
    const startPage = passage.physical_page_start;
    const endPage = passage.physical_page_end ?? startPage;
    if (startPage < 1 || endPage < startPage) {
      return { verified: false, reason: `INVALID_ONE_BASED_PAGE_SPAN:${startPage}-${endPage}` };
    }

    const spannedPages = extraction.page_mapping.filter(
      (pm) => pm.physical_page_one_based >= startPage && pm.physical_page_one_based <= endPage
    );
    if (spannedPages.length !== endPage - startPage + 1) {
      return {
        verified: false,
        reason: `LOCATOR_PAGE_OUT_OF_RANGE:Requested pages ${startPage}..${endPage}, extraction has ${extraction.page_mapping.length} pages`,
      };
    }

    const combinedSpanText = spannedPages
      .map((pm) => pm.page_text_verbatim)
      .join("\n")
      .replace(/\r\n/g, "\n");
    const normCombined = combinedSpanText.replace(/\s+/g, " ").trim();
    const normTarget = cleanTarget.replace(/\s+/g, " ").trim();

    // Count occurrences on the selected page span
    let countOnSelectedPages = 0;
    let searchIdx = 0;
    while (normTarget.length > 0) {
      const found = normCombined.indexOf(normTarget, searchIdx);
      if (found === -1) break;
      countOnSelectedPages++;
      searchIdx = found + Math.max(1, normTarget.length);
    }

    if (countOnSelectedPages === 0) {
      // Check if it actually lives on a DIFFERENT page (wrong page highlight!)
      const otherPage = extraction.page_mapping.find((pm) =>
        pm.page_text_verbatim.replace(/\s+/g, " ").includes(normTarget)
      );
      if (otherPage) {
        return {
          verified: false,
          reason: `LOCATOR_WRONG_PAGE:Passage found on physical page ${otherPage.physical_page_one_based}, not ${startPage}..${endPage}`,
        };
      }
      return {
        verified: false,
        reason: "LOCATOR_TEXT_MISMATCH_ON_PINNED_PAGES",
      };
    }

    if (countOnSelectedPages > 1) {
      // Disambiguate using quote_prefix / quote_suffix or bbox if provided
      const hasDisambiguator = passage.anchors.some(
        (a) =>
          Boolean(a.quote_prefix || a.quote_suffix) ||
          (Array.isArray(a.bbox_normalized) && a.bbox_normalized.length === 4)
      );
      if (!hasDisambiguator) {
        return {
          verified: false,
          reason: `LOCATOR_AMBIGUOUS_MULTIPLE_MATCHES:${countOnSelectedPages} occurrences on page span without prefix/suffix or bbox`,
        };
      }
    }

    // Verify anchor printed page labels match page_mapping if specified
    for (const anchor of passage.anchors) {
      if (anchor.physical_page_one_based !== undefined) {
        const pm = extraction.page_mapping.find(
          (p) => p.physical_page_one_based === anchor.physical_page_one_based
        );
        if (!pm) {
          return {
            verified: false,
            reason: `ANCHOR_PAGE_MISSING:${anchor.physical_page_one_based}`,
          };
        }
      }
    }

    return { verified: true, reason: null };
  }

  // Unpaginated HTML / text extraction replay
  const rawFull = extraction.raw_transcription.replace(/\s+/g, " ").trim();
  const normTarget = cleanTarget.replace(/\s+/g, " ").trim();
  let occurrences = 0;
  let pos = 0;
  while (normTarget.length > 0) {
    const idx = rawFull.indexOf(normTarget, pos);
    if (idx === -1) break;
    occurrences++;
    pos = idx + Math.max(1, normTarget.length);
  }

  if (occurrences === 0) {
    return { verified: false, reason: "LOCATOR_TEXT_MISMATCH_AGAINST_RAW_TRANSCRIPTION" };
  }
  if (occurrences > 1) {
    const anchor = passage.anchors[0];
    if (anchor?.quote_prefix || anchor?.quote_suffix || anchor?.structural_selector) {
      const contextualNeedle = `${anchor.quote_prefix || ""}${cleanTarget}${anchor.quote_suffix || ""}`
        .replace(/\s+/g, " ")
        .trim();
      if (contextualNeedle !== normTarget && rawFull.includes(contextualNeedle)) {
        return { verified: true, reason: null };
      }
      if (anchor.structural_selector) {
        return { verified: true, reason: null };
      }
    }
    return {
      verified: false,
      reason: `LOCATOR_AMBIGUOUS_HTML_MATCHES:${occurrences}`,
    };
  }

  return { verified: true, reason: null };
}

export function formatHumanPinpointTh(params: {
  source_family: OfficialSourceFamily;
  record_type: OfficialRecordType;
  section_paragraph_path: string[];
  physical_page_start: number | null;
  physical_page_end: number | null;
  printed_page_start: string | null;
  printed_page_end: string | null;
  pinpoint_meta?: SourceFamilyPinpointMetadata;
}): string {
  const parts: string[] = [];
  if (params.record_type === "official_summary") {
    parts.push("สรุปย่อทางการ");
  }

  if (params.physical_page_start !== null) {
    const end = params.physical_page_end ?? params.physical_page_start;
    parts.push(
      end > params.physical_page_start
        ? `PDF หน้า ${params.physical_page_start}–${end}`
        : `PDF หน้า ${params.physical_page_start}`
    );
  }

  const printedStart = params.printed_page_start || params.pinpoint_meta?.gazette_printed_page || null;
  const printedEnd = params.printed_page_end || printedStart;
  if (printedStart) {
    parts.push(
      printedEnd && printedEnd !== printedStart
        ? `หน้าพิมพ์ ${printedStart}–${printedEnd}`
        : `หน้าพิมพ์ ${printedStart}`
    );
  }

  if (params.pinpoint_meta?.provision_label) {
    parts.push(params.pinpoint_meta.provision_label);
  }
  if (params.pinpoint_meta?.paragraph_label) {
    parts.push(params.pinpoint_meta.paragraph_label);
  }
  if (params.pinpoint_meta?.reasoning_or_disposition_section) {
    parts.push(params.pinpoint_meta.reasoning_or_disposition_section);
  }
  if (params.pinpoint_meta?.ruling_part) {
    const roleMap: Record<NonNullable<SourceFamilyPinpointMetadata["ruling_part"]>, string> = {
      facts: "ส่วนข้อเท็จจริง",
      question: "ส่วนประเด็นหารือ",
      answer_reasoning: "ส่วนเหตุผลแนววินิจฉัย",
      answer_conclusion: "ส่วนสรุปแนววินิจฉัย",
    };
    parts.push(roleMap[params.pinpoint_meta.ruling_part]);
  }

  if (parts.length === 0 && params.section_paragraph_path.length > 0) {
    parts.push(params.section_paragraph_path.join(" · "));
  }
  return parts.join(" · ") || "ข้อความต้นฉบับตามรุ่นที่อ้างอิง";
}

export interface OnboardOfficialSourceInput {
  batch_id: BatchId;
  release_id: string;
  source_family: OfficialSourceFamily;
  issuer_id: string;
  source_native_id: string | null;
  reviewed_surrogate_id?: string | null;
  original_title_th: string;
  language?: "th" | "en" | "mixed";
  record_type?: OfficialRecordType;
  access_permission?: AccessPermissionKind;
  preservation_permission?: PreservationPermissionKind;
  access_scope?: string;
  access_conditions_th?: string | null;
  observed_url: string;
  durable_landing_url?: string | null;
  redirect_history?: string[];
  http_status?: number;
  mime_type: string;
  captured_bytes: Buffer | Uint8Array | string;
  captured_at?: string;
  publication_date?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  applicability_rules_th?: string[];
  affected_provisions?: ProvisionEffectiveIntervalRecord[];
  predecessor_version_id?: string | null;
  is_verified_amendment?: boolean;
  pinpoint_metadata?: SourceFamilyPinpointMetadata;
  parser_or_ocr_version?: string;
  is_scanned_material?: boolean;
  model_confidence?: number | null;
  explicit_uncertain_ocr_tokens?: string[];
  suspected_missing_negation?: boolean;
  pages?: Array<{
    physical_page_one_based: number;
    printed_page_label?: string | null;
    width_pt?: number;
    height_pt?: number;
    rotation_deg?: 0 | 90 | 180 | 270;
    page_text_verbatim: string;
    scan_image_data_uri_or_ref?: string | null;
  }>;
  passages_input?: Array<{
    passage_id?: string;
    verbatim_text: string;
    surrounding_before?: string;
    surrounding_after?: string;
    section_paragraph_path: string[];
    statement_role: StatementRole;
    physical_page_start?: number | null;
    physical_page_end?: number | null;
    printed_page_start?: string | null;
    printed_page_end?: string | null;
    anchors: TypedPassageAnchor[];
    pinpoint_override?: SourceFamilyPinpointMetadata;
  }>;
  actor_id?: string;
}

export interface OnboardOfficialSourceResult {
  doc: OfficialDocumentRecord;
  version: DocumentVersionRecord;
  location: OfficialLocationRecord;
  extraction_revision: ExtractionRevisionRecord;
  passages: EvidencePassageRecord[];
  idempotent_version_reused: boolean;
  byte_change_quarantined: boolean;
  reconciliation_task_id: string | null;
  review_queue_id: string | null;
}

/**
 * Normal ingestion entry point for native PDFs, HTML records, and Thai scans (Sections 2, 3, 4, 10.1).
 * Atomic across document, version, location, extraction revision, passages, review queue, and audit events.
 */
export function onboardOfficialSourceDocument(
  store: DurableKnowledgeStore,
  input: OnboardOfficialSourceInput
): OnboardOfficialSourceResult {
  const rawBytes =
    typeof input.captured_bytes === "string"
      ? Buffer.from(input.captured_bytes, "utf8")
      : Buffer.from(input.captured_bytes);
  const storedBlob = store.storeImmutableArtifactBytes(rawBytes);
  const capturedAt = input.captured_at || new Date().toISOString();
  const actorId = input.actor_id || "ingestion.service@reg24.th";
  const accessScope =
    input.access_scope ||
    (input.access_permission && input.access_permission !== "public"
      ? `scope.restricted.${input.access_permission}`
      : "scope.platform.public");

  const combinedText =
    input.pages && input.pages.length > 0
      ? input.pages.map((p) => p.page_text_verbatim).join("\n\n")
      : typeof input.captured_bytes === "string"
        ? input.captured_bytes
        : rawBytes.toString("utf8");

  return store.transactSync(
    "ONBOARD_OFFICIAL_SOURCE_DOCUMENT",
    (state) => {
      const ledger = ensureCitationLedgerInState(state);
      const isThirdPartyRecord = input.record_type === "third_party_discovery";

      const identityCheck = isThirdPartyRecord
        ? {
            eligible_host: false,
            identity_match_result: "FAILED_UNTRUSTED_HOST" as IdentityMatchResult,
            passed: false,
            verification_method: "third_party_discovery_intake_v1",
            failure_reason: "Third-party copy retained for discovery only (SRC-02); excluded from verified publication.",
          }
        : verifyCapturedOfficialIdentity({
            issuer_id: input.issuer_id,
            source_family: input.source_family,
            observed_url: input.observed_url,
            final_url:
              input.redirect_history && input.redirect_history.length > 0
                ? input.redirect_history[input.redirect_history.length - 1]
                : input.observed_url,
            http_status: input.http_status ?? 200,
            mime_type: input.mime_type,
            expected_native_id: input.source_native_id,
            expected_title_th: input.original_title_th,
            captured_text_or_html: combinedText,
            issuer_metadata: input.pinpoint_metadata as Record<string, unknown> | undefined,
            registry: ledger.publishers,
          });

      const predVerInLedger = input.predecessor_version_id
        ? ledger.versions[input.predecessor_version_id]
        : undefined;
      const idKey = input.source_native_id || input.reviewed_surrogate_id || input.original_title_th;
      const docId =
        predVerInLedger?.doc_id ||
        `odoc.${sha256Bytes(`${accessScope}|${input.source_family}|${input.issuer_id}|${idKey}`).slice(0, 16)}`;

      const preservationPerm: PreservationPermissionKind =
        input.preservation_permission || "retained_artifact_permitted";
      const accessPerm: AccessPermissionKind = input.access_permission || "public";
      const recordType: OfficialRecordType = input.record_type || "full_record";

      let docEligible = true;
      let docIneligibleReason: string | null = null;
      if (recordType === "third_party_discovery") {
        docEligible = false;
        docIneligibleReason = "THIRD_PARTY_COPY_DISCOVERY_ONLY_SRC02";
      } else if (preservationPerm === "metadata_only_ineligible") {
        docEligible = false;
        docIneligibleReason = "NO_DURABLE_PASSAGE_REPLAY_PERMISSION_SRC03";
      } else if (!identityCheck.passed) {
        docEligible = false;
        docIneligibleReason = `IDENTITY_VERIFICATION_FAILED:${identityCheck.identity_match_result}`;
      }

      const existingDoc = ledger.documents[docId];
      const doc: OfficialDocumentRecord = existingDoc
        ? {
            ...existingDoc,
            eligible_for_citation: existingDoc.eligible_for_citation || docEligible,
            ineligible_reason: docEligible ? null : docIneligibleReason,
          }
        : {
            doc_id: docId,
            source_family: input.source_family,
            issuer_id: input.issuer_id,
            source_native_id: input.source_native_id,
            reviewed_surrogate_id: input.reviewed_surrogate_id || null,
            is_reviewed_surrogate: Boolean(!input.source_native_id && input.reviewed_surrogate_id),
            original_title_th: input.original_title_th,
            language: input.language || "th",
            record_type: recordType,
            access_permission: accessPerm,
            preservation_permission: preservationPerm,
            access_scope: accessScope,
            access_conditions_th:
              input.access_conditions_th ||
              (accessPerm === "restricted_external_official"
                ? "เอกสารต้นฉบับบนเว็บไซต์ทางการต้องเข้าสู่ระบบหรือมีสิทธิ์ตามเงื่อนไขของหน่วยงานผู้ออกเอกสาร"
                : null),
            eligible_for_citation: docEligible,
            ineligible_reason: docIneligibleReason,
            canonical_work_id: null,
            owner_batch_id: input.batch_id,
            created_at: capturedAt,
          };
      ledger.documents[docId] = doc;

      // Section 4.1 & T09: Idempotent version check (same doc_id + same SHA-256 reuses existing version!)
      const existingVersionsForDoc = Object.values(ledger.versions).filter((v) => v.doc_id === docId);
      const identicalByteVersion = existingVersionsForDoc.find(
        (v) => v.artifact_sha256 === storedBlob.sha256
      );

      let byteChangeQuarantined = false;
      let version: DocumentVersionRecord;
      let idempotentVersionReused = false;

      if (identicalByteVersion) {
        idempotentVersionReused = true;
        version = identicalByteVersion;
      } else {
        // Check if another version was captured from the SAME URL with different bytes without explicit amendment flag (4.1)
        const priorSameUrlLoc = Object.values(ledger.locations).find(
          (l) => l.doc_id === docId && l.exact_official_url === input.observed_url && l.version_id
        );
        const unverifiedSameUrlByteChange =
          Boolean(priorSameUrlLoc) && !input.is_verified_amendment && !input.predecessor_version_id;
        if (unverifiedSameUrlByteChange) {
          byteChangeQuarantined = true;
        }

        const verSeed = `${docId}|${storedBlob.sha256}|${input.effective_from || "na"}`;
        const versionId = `over.${sha256Bytes(verSeed).slice(0, 16)}`;
        version = {
          version_id: versionId,
          doc_id: docId,
          artifact_sha256: storedBlob.sha256,
          captured_at: capturedAt,
          artifact_ref: storedBlob.immutable_uri,
          mime_type: input.mime_type,
          byte_size: storedBlob.size,
          source_metadata: { ...(input.pinpoint_metadata || {}) },
          publication_date: input.publication_date ?? null,
          publication_date_status: input.publication_date ? "known" : "unknown_explicit",
          effective_from: input.effective_from ?? null,
          effective_to: input.effective_to ?? null,
          effective_date_status: input.effective_from
            ? input.effective_to
              ? "known"
              : "open_ended"
            : "unknown_explicit",
          applicability_rules_th: [...(input.applicability_rules_th || [])],
          affected_provisions: [...(input.affected_provisions || [])],
          predecessor_version_id: input.predecessor_version_id || null,
          amending_version_ids: [],
          byte_change_classification: byteChangeQuarantined
            ? "unclassified_byte_change_quarantined"
            : input.is_verified_amendment
              ? "verified_legal_amendment"
              : "initial_capture",
          canonical_version_id: null,
          created_at: capturedAt,
        };
        ledger.versions[versionId] = version;

        if (input.predecessor_version_id && ledger.versions[input.predecessor_version_id]) {
          const pred = ledger.versions[input.predecessor_version_id];
          if (!pred.amending_version_ids.includes(versionId)) {
            pred.amending_version_ids.push(versionId);
          }
          if (input.effective_from && !pred.effective_to) {
            // Close predecessor interval on day before new version effective_from
            const d = new Date(`${input.effective_from}T00:00:00.000Z`);
            if (!Number.isNaN(d.getTime())) {
              d.setUTCDate(d.getUTCDate() - 1);
              pred.effective_to = d.toISOString().slice(0, 10);
            }
          }
        }
      }

      // SRC-02: Optional durable landing record if direct asset URLs expire
      let landingLocId: string | null = null;
      if (input.durable_landing_url) {
        landingLocId = `oloc.land.${sha256Bytes(`${docId}|${input.durable_landing_url}`).slice(0, 14)}`;
        if (!ledger.locations[landingLocId]) {
          ledger.locations[landingLocId] = {
            location_id: landingLocId,
            doc_id: docId,
            version_id: version.version_id,
            exact_official_url: input.durable_landing_url,
            role: "durable_landing_record",
            parent_landing_location_id: null,
            original_observed_url: input.durable_landing_url,
            redirect_history: [],
            prior_urls: [],
            first_verified_at: capturedAt,
            last_verified_at: capturedAt,
            last_successful_verified_at: identityCheck.passed ? capturedAt : null,
            verification_method: identityCheck.verification_method,
            identity_match_result: identityCheck.identity_match_result,
            link_health: identityCheck.passed ? "verified_online" : "quarantined_identity_failure",
            last_http_status: input.http_status ?? 200,
            failure_reason: identityCheck.failure_reason,
            is_active_primary: false,
          };
        }
      }

      const finalUrl =
        input.redirect_history && input.redirect_history.length > 0
          ? input.redirect_history[input.redirect_history.length - 1]
          : input.observed_url;
      const locId = `oloc.${sha256Bytes(`${docId}|${version.version_id}|${finalUrl}`).slice(0, 16)}`;
      const location: OfficialLocationRecord = ledger.locations[locId] || {
        location_id: locId,
        doc_id: docId,
        version_id: version.version_id,
        exact_official_url: finalUrl,
        role: isThirdPartyRecord
          ? "third_party_discovery"
          : landingLocId
            ? "expiring_direct_asset"
            : "primary_official",
        parent_landing_location_id: landingLocId,
        original_observed_url: input.observed_url,
        redirect_history: [...(input.redirect_history || [])],
        prior_urls: [],
        first_verified_at: capturedAt,
        last_verified_at: capturedAt,
        last_successful_verified_at: identityCheck.passed ? capturedAt : null,
        verification_method: identityCheck.verification_method,
        identity_match_result: identityCheck.identity_match_result,
        link_health: identityCheck.passed ? "verified_online" : "quarantined_identity_failure",
        last_http_status: input.http_status ?? 200,
        failure_reason: identityCheck.failure_reason,
        is_active_primary: true,
      };
      ledger.locations[locId] = location;

      // SRC-02: Create reconciliation task if third-party copy
      let reconciliationTaskId: string | null = null;
      if (isThirdPartyRecord) {
        reconciliationTaskId = `rtask.${sha256Bytes(`${docId}|${input.observed_url}`).slice(0, 14)}`;
        if (!ledger.reconciliation_tasks[reconciliationTaskId]) {
          ledger.reconciliation_tasks[reconciliationTaskId] = {
            task_id: reconciliationTaskId,
            discovery_doc_id: docId,
            observed_url: input.observed_url,
            target_hint: input.source_native_id || input.original_title_th,
            reason:
              "Only third-party copy observed; reconcile to an official publisher record before verified publication (SRC-02).",
            status: "OPEN",
            created_at: capturedAt,
            resolved_at: null,
          };
        }
      }

      // Extraction revision (idempotent for same version_id + parser_or_ocr_version)
      const parserVer = input.parser_or_ocr_version || (input.is_scanned_material ? "typhoon-ocr-v1.5" : "native-pdf-html-v1");
      const extRevId = `erev.${sha256Bytes(`${version.version_id}|${parserVer}|rev1`).slice(0, 16)}`;

      const pageMapping: PageMappingEntry[] = (input.pages || []).map((p) => ({
        physical_page_one_based: p.physical_page_one_based,
        printed_page_label: p.printed_page_label ?? arabicDigitsToThai(String(p.physical_page_one_based)),
        width_pt: p.width_pt ?? 595,
        height_pt: p.height_pt ?? 842,
        rotation_deg: p.rotation_deg ?? 0,
        is_scanned_page: Boolean(input.is_scanned_material),
        scan_image_data_uri_or_ref: p.scan_image_data_uri_or_ref ?? null,
        page_text_verbatim: p.page_text_verbatim,
      }));

      const ocrAmbiguity = detectThaiOcrMeaningAmbiguity({
        is_scanned_material: Boolean(input.is_scanned_material),
        raw_transcription: combinedText,
        explicit_uncertain_tokens: input.explicit_uncertain_ocr_tokens,
        suspected_missing_negation: input.suspected_missing_negation,
        model_confidence: input.model_confidence,
      });

      const alignmentMap: ExtractionAlignmentSegment[] = pageMapping.map((pm, idx) => ({
        segment_index: idx,
        physical_page_one_based: pm.physical_page_one_based,
        printed_page_label: pm.printed_page_label,
        raw_start: 0,
        raw_end: pm.page_text_verbatim.length,
        normalized_start: 0,
        normalized_end: normalizeThaiSearchTextOnly(pm.page_text_verbatim).length,
      }));

      const existingExt = ledger.extraction_revisions[extRevId];
      const extractionRevision: ExtractionRevisionRecord = existingExt || {
        extraction_revision_id: extRevId,
        version_id: version.version_id,
        parent_revision_id: null,
        parser_or_ocr_version: parserVer,
        model_confidence: input.model_confidence ?? null,
        is_scanned_material: Boolean(input.is_scanned_material),
        page_mapping: pageMapping,
        raw_transcription: combinedText,
        normalized_search_text: normalizeThaiSearchTextOnly(combinedText),
        alignment_map: alignmentMap,
        ocr_ambiguity_detected: ocrAmbiguity.ambiguous,
        ocr_ambiguity_reasons: ocrAmbiguity.reasons,
        ocr_review_crop_bbox:
          ocrAmbiguity.ambiguous && input.passages_input?.[0]?.anchors?.[0]?.bbox_normalized
            ? input.passages_input[0].anchors[0].bbox_normalized
            : ocrAmbiguity.ambiguous
              ? [0.08, 0.18, 0.92, 0.48]
              : null,
        ocr_review_page_one_based: ocrAmbiguity.ambiguous ? pageMapping[0]?.physical_page_one_based ?? 1 : null,
        review_status: !identityCheck.passed
          ? "QUARANTINED"
          : ocrAmbiguity.ambiguous
            ? "AWAITING_THAI_REVIEW"
            : "VERIFIED_NATIVE",
        reviewer_id: null,
        reviewed_at: null,
        correction_note: null,
        created_at: capturedAt,
      };
      ledger.extraction_revisions[extRevId] = extractionRevision;

      // Queue review item if identity check failed (T05), byte change unclassified (4.1), or OCR ambiguous (T02)
      let reviewQueueId: string | null = null;
      if (!identityCheck.passed || byteChangeQuarantined || ocrAmbiguity.ambiguous) {
        reviewQueueId = `rev.${sha256Bytes(`${docId}|${version.version_id}|${extRevId}`).slice(0, 14)}`;
        if (!state.reviews[reviewQueueId]) {
          state.reviews[reviewQueueId] = {
            review_id: reviewQueueId,
            batch_id: input.batch_id,
            release_id: input.release_id,
            work_id: doc.canonical_work_id,
            candidate_id: null,
            category: !identityCheck.passed
              ? "AMBIGUOUS_IDENTITY"
              : "CRITICAL_TOKEN_UNCERTAINTY",
            stratum: input.source_family,
            severity: "CRITICAL",
            summary: !identityCheck.passed
              ? `Identity check failed (${identityCheck.identity_match_result}): ${identityCheck.failure_reason}`
              : byteChangeQuarantined
                ? `Byte change detected at existing URL '${input.observed_url}'; classify before treating as amendment.`
                : `Thai scan OCR ambiguity (${ocrAmbiguity.reasons.join("; ")}); model confidence=${input.model_confidence ?? "n/a"} cannot auto-clear.`,
            evidence_locator_summary: `${input.observed_url} (page=${extractionRevision.ocr_review_page_one_based ?? 1})`,
            status: "PENDING",
            reviewer_id: null,
            decision_note: null,
            created_at: capturedAt,
            decided_at: null,
          };
        }
      }

      // Build and replay passages (Section 4.3)
      const rawPassageSpecs: NonNullable<OnboardOfficialSourceInput["passages_input"]> =
        input.passages_input && input.passages_input.length > 0
          ? input.passages_input
          : [
              {
                verbatim_text: combinedText.trim(),
                surrounding_before: "",
                surrounding_after: "",
                section_paragraph_path: [input.original_title_th],
                statement_role: "statutory_text" as StatementRole,
                physical_page_start: pageMapping[0]?.physical_page_one_based ?? null,
                physical_page_end:
                  pageMapping.length > 0
                    ? pageMapping[pageMapping.length - 1].physical_page_one_based
                    : null,
                printed_page_start: pageMapping[0]?.printed_page_label ?? null,
                printed_page_end:
                  pageMapping.length > 0
                    ? pageMapping[pageMapping.length - 1].printed_page_label
                    : null,
                anchors:
                  pageMapping.length > 0
                    ? pageMapping.map((pm) => ({
                        anchor_kind: (input.is_scanned_material
                          ? "scan_bbox_span"
                          : "pdf_page_span") as TypedPassageAnchor["anchor_kind"],
                        physical_page_one_based: pm.physical_page_one_based,
                        printed_page_label: pm.printed_page_label,
                        page_width_pt: pm.width_pt,
                        page_height_pt: pm.height_pt,
                        rotation_deg: pm.rotation_deg,
                        bbox_normalized: [0.08, 0.12, 0.92, 0.88] as [number, number, number, number],
                      }))
                    : [
                        {
                          anchor_kind: "html_text_quote" as const,
                          structural_selector: "article > section[1]",
                          exact_quote: combinedText.trim().slice(0, 240),
                        },
                      ],
              },
            ];

      const builtPassages: EvidencePassageRecord[] = rawPassageSpecs.map((spec, idx) => {
        // Stable opaque passage ID across reindexing: tied to version_id + structural_path + role, NOT mutable index generation!
        const stableSeed = `${version.version_id}|${spec.statement_role}|${spec.section_paragraph_path.join("/")}|${idx + 1}`;
        const passageId = spec.passage_id || `epsg.${sha256Bytes(stableSeed).slice(0, 16)}`;
        const replay = replayPassageLocatorAgainstExtraction(
          {
            verbatim_text: spec.verbatim_text,
            physical_page_start: spec.physical_page_start ?? null,
            physical_page_end: spec.physical_page_end ?? spec.physical_page_start ?? null,
            anchors: spec.anchors,
          },
          extractionRevision
        );

        const pinpointMeta: SourceFamilyPinpointMetadata = {
          ...(input.pinpoint_metadata || {}),
          ...(spec.pinpoint_override || {}),
        };
        const humanPinpoint = formatHumanPinpointTh({
          source_family: input.source_family,
          record_type: doc.record_type,
          section_paragraph_path: spec.section_paragraph_path,
          physical_page_start: spec.physical_page_start ?? null,
          physical_page_end: spec.physical_page_end ?? spec.physical_page_start ?? null,
          printed_page_start: spec.printed_page_start ?? null,
          printed_page_end: spec.printed_page_end ?? spec.printed_page_start ?? null,
          pinpoint_meta: pinpointMeta,
        });

        const eligible =
          doc.eligible_for_citation &&
          !byteChangeQuarantined &&
          extractionRevision.review_status !== "AWAITING_THAI_REVIEW" &&
          extractionRevision.review_status !== "QUARANTINED" &&
          replay.verified;

        const quarantineReason = !doc.eligible_for_citation
          ? doc.ineligible_reason
          : byteChangeQuarantined
            ? "UNCLASSIFIED_URL_BYTE_CHANGE"
            : extractionRevision.review_status === "AWAITING_THAI_REVIEW"
              ? `OCR_AMBIGUITY_AWAITING_THAI_REVIEW:${extractionRevision.ocr_ambiguity_reasons.join(",")}`
              : !replay.verified
                ? replay.reason
                : null;

        const existingPsg = ledger.passages[passageId];
        const psgRecord: EvidencePassageRecord = existingPsg || {
          passage_id: passageId,
          extraction_revision_id: extractionRevision.extraction_revision_id,
          version_id: version.version_id,
          doc_id: doc.doc_id,
          verbatim_text: spec.verbatim_text,
          normalized_search_text: normalizeThaiSearchTextOnly(spec.verbatim_text),
          text_sha256: sha256Bytes(spec.verbatim_text),
          surrounding_before: spec.surrounding_before || "",
          surrounding_after: spec.surrounding_after || "",
          section_paragraph_path: [...spec.section_paragraph_path],
          statement_role: spec.statement_role,
          physical_page_start: spec.physical_page_start ?? null,
          physical_page_end: spec.physical_page_end ?? spec.physical_page_start ?? null,
          printed_page_start: spec.printed_page_start ?? null,
          printed_page_end: spec.printed_page_end ?? spec.printed_page_start ?? null,
          anchors: spec.anchors,
          human_pinpoint_th: humanPinpoint,
          source_family_pinpoint: pinpointMeta,
          locator_replay_status: replay.verified ? "VERIFIED" : "QUARANTINED",
          quarantine_reason: quarantineReason,
          eligible_for_publication: eligible,
          access_scope: accessScope,
          created_at: capturedAt,
        };
        ledger.passages[passageId] = psgRecord;

        // Enqueue retryable search/vector outbox projections (Section 3)
        for (const targetStore of ["lexical", "vector"] as const) {
          const outboxId = `cobx.${sha256Bytes(`${targetStore}|${passageId}|${psgRecord.extraction_revision_id}`).slice(0, 14)}`;
          if (!ledger.projection_outbox[outboxId]) {
            ledger.projection_outbox[outboxId] = {
              outbox_id: outboxId,
              target_store: targetStore,
              entity_kind: "passage",
              entity_id: passageId,
              attempt_count: 1,
              status: "COMPLETED",
              last_error: null,
              created_at: capturedAt,
              completed_at: capturedAt,
            };
          }
        }

        return psgRecord;
      });

      appendCitationAuditEvent(ledger, {
        actor_or_service: actorId,
        event_type: !identityCheck.passed
          ? "IDENTITY_QUARANTINED"
          : ocrAmbiguity.ambiguous
            ? "OCR_AMBIGUITY_QUARANTINED"
            : "SOURCE_CAPTURED",
        affected_ids: [
          doc.doc_id,
          version.version_id,
          location.location_id,
          extractionRevision.extraction_revision_id,
          ...builtPassages.map((p) => p.passage_id),
        ],
        before_status: idempotentVersionReused ? { version_reused: version.version_id } : null,
        after_status: {
          eligible_for_citation: doc.eligible_for_citation,
          identity_match_result: identityCheck.identity_match_result,
          extraction_review_status: extractionRevision.review_status,
          eligible_passages: builtPassages.filter((p) => p.eligible_for_publication).length,
        },
        reason:
          identityCheck.failure_reason ||
          (ocrAmbiguity.ambiguous
            ? `Quarantined scan pending Thai-language review: ${ocrAmbiguity.reasons.join(",")}`
            : "Verified official source captured and locators replayed"),
        correlation_id: `corr.ingest.${version.version_id}`,
      });

      return {
        doc,
        version,
        location,
        extraction_revision: extractionRevision,
        passages: builtPassages,
        idempotent_version_reused: idempotentVersionReused,
        byte_change_quarantined: byteChangeQuarantined,
        reconciliation_task_id: reconciliationTaskId,
        review_queue_id: reviewQueueId,
      };
    },
    { actorId }
  );
}

/**
 * Section 4.3 & T02: Completes human Thai-language review of a quarantined scan extraction.
 * Creates a NEW immutable ExtractionRevisionRecord (`parent_revision_id` points to the original OCR
 * revision so the raw OCR remains permanently auditable!) and updates passage eligibility after locator replay.
 */
export function submitThaiScanOcrReviewCorrection(
  store: DurableKnowledgeStore,
  params: {
    extraction_revision_id: string;
    corrected_pages: Array<{
      physical_page_one_based: number;
      corrected_text_verbatim: string;
    }>;
    corrected_passages: Array<{
      passage_id: string;
      corrected_verbatim_text: string;
      bbox_normalized?: [number, number, number, number];
    }>;
    reviewer: Actor;
    correction_note: string;
  }
): {
  new_extraction_revision: ExtractionRevisionRecord;
  original_extraction_revision: ExtractionRevisionRecord;
  updated_passages: EvidencePassageRecord[];
} {
  if (params.reviewer.role !== "legal_reviewer" && params.reviewer.role !== "product_owner") {
    throw new Error("FORBIDDEN_403: Only a Thai legal_reviewer or product_owner can clear OCR ambiguity.");
  }

  return store.transactSync(
    "SUBMIT_THAI_SCAN_OCR_REVIEW_CORRECTION",
    (state) => {
      const ledger = ensureCitationLedgerInState(state);
      const origRev = ledger.extraction_revisions[params.extraction_revision_id];
      if (!origRev) {
        throw new Error(`NOT_FOUND_404: Extraction revision '${params.extraction_revision_id}' not found.`);
      }

      const reviewedAt = new Date().toISOString();
      const updatedPages: PageMappingEntry[] = origRev.page_mapping.map((pm) => {
        const patch = params.corrected_pages.find(
          (cp) => cp.physical_page_one_based === pm.physical_page_one_based
        );
        return patch
          ? { ...pm, page_text_verbatim: patch.corrected_text_verbatim }
          : { ...pm };
      });
      const combinedCorrected = updatedPages.map((p) => p.page_text_verbatim).join("\n\n");

      const newRevId = `erev.${sha256Bytes(`${origRev.version_id}|reviewed|${origRev.extraction_revision_id}|${combinedCorrected}`).slice(0, 16)}`;
      const newRev: ExtractionRevisionRecord = {
        extraction_revision_id: newRevId,
        version_id: origRev.version_id,
        parent_revision_id: origRev.extraction_revision_id,
        parser_or_ocr_version: `${origRev.parser_or_ocr_version}+human-thai-reviewed`,
        model_confidence: origRev.model_confidence,
        is_scanned_material: origRev.is_scanned_material,
        page_mapping: updatedPages,
        raw_transcription: combinedCorrected,
        normalized_search_text: normalizeThaiSearchTextOnly(combinedCorrected),
        alignment_map: updatedPages.map((pm, idx) => ({
          segment_index: idx,
          physical_page_one_based: pm.physical_page_one_based,
          printed_page_label: pm.printed_page_label,
          raw_start: 0,
          raw_end: pm.page_text_verbatim.length,
          normalized_start: 0,
          normalized_end: normalizeThaiSearchTextOnly(pm.page_text_verbatim).length,
        })),
        ocr_ambiguity_detected: false,
        ocr_ambiguity_reasons: [],
        ocr_review_crop_bbox: origRev.ocr_review_crop_bbox ?? null,
        ocr_review_page_one_based: origRev.ocr_review_page_one_based ?? null,
        review_status: "REVIEWED_CORRECTED",
        reviewer_id: params.reviewer.actor_id,
        reviewed_at: reviewedAt,
        correction_note: params.correction_note,
        created_at: reviewedAt,
      };
      ledger.extraction_revisions[newRevId] = newRev;

      const doc = ledger.documents[ledger.versions[origRev.version_id]?.doc_id || ""];
      const updatedPassages: EvidencePassageRecord[] = [];

      for (const patch of params.corrected_passages) {
        const existingPsg = ledger.passages[patch.passage_id];
        if (!existingPsg) continue;
        const nextAnchors = existingPsg.anchors.map((a, idx) =>
          idx === 0 && patch.bbox_normalized
            ? { ...a, bbox_normalized: patch.bbox_normalized }
            : { ...a }
        );
        const replay = replayPassageLocatorAgainstExtraction(
          {
            verbatim_text: patch.corrected_verbatim_text,
            physical_page_start: existingPsg.physical_page_start,
            physical_page_end: existingPsg.physical_page_end,
            anchors: nextAnchors,
          },
          newRev
        );
        if (!replay.verified) {
          throw new Error(
            `LOCATOR_REPLAY_FAILED_AFTER_CORRECTION: ${replay.reason || "Corrected passage did not replay cleanly against corrected page text."}`
          );
        }

        // Passage keeps its stable opaque ID while advancing to the reviewed extraction revision!
        const nextPsg: EvidencePassageRecord = {
          ...existingPsg,
          extraction_revision_id: newRev.extraction_revision_id,
          verbatim_text: patch.corrected_verbatim_text,
          normalized_search_text: normalizeThaiSearchTextOnly(patch.corrected_verbatim_text),
          text_sha256: sha256Bytes(patch.corrected_verbatim_text),
          anchors: nextAnchors,
          locator_replay_status: "VERIFIED",
          quarantine_reason: null,
          eligible_for_publication: Boolean(doc?.eligible_for_citation ?? true),
        };
        ledger.passages[nextPsg.passage_id] = nextPsg;
        updatedPassages.push(nextPsg);
      }

      // Mark corresponding review queue item RESOLVED
      for (const rq of Object.values(state.reviews)) {
        if (rq.status === "PENDING" && rq.summary.includes("OCR ambiguity")) {
          rq.status = "CORRECTED";
          rq.reviewer_id = params.reviewer.actor_id;
          rq.decision_note = params.correction_note;
          rq.decided_at = reviewedAt;
        }
      }

      appendCitationAuditEvent(ledger, {
        actor_or_service: params.reviewer.actor_id,
        event_type: "OCR_THAI_REVIEW_COMPLETED",
        affected_ids: [
          origRev.extraction_revision_id,
          newRev.extraction_revision_id,
          ...updatedPassages.map((p) => p.passage_id),
        ],
        before_status: {
          parent_revision_id: origRev.extraction_revision_id,
          review_status: origRev.review_status,
        },
        after_status: {
          new_revision_id: newRev.extraction_revision_id,
          review_status: newRev.review_status,
          eligible_passages: updatedPassages.map((p) => p.passage_id),
        },
        reason: params.correction_note,
        correlation_id: `corr.ocr_review.${newRev.extraction_revision_id}`,
      });

      return {
        new_extraction_revision: newRev,
        original_extraction_revision: origRev,
        updated_passages: updatedPassages,
      };
    },
    { actorId: params.reviewer.actor_id }
  );
}
