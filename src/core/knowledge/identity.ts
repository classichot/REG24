/**
 * REG24 — Cryptographic Byte Hashing, Thai Identifier Normalization & Legal Identity Resolution
 * Implements SH-07, SH-08, SH-09, AT01, AT02, AT03, AT04, AT08.
 */

import * as crypto from "node:crypto";
import type { KnowledgeEntityType } from "../graph/graph-schema";
import type { BatchId, IdentityAction, LegalWork } from "./contracts";
import type { DurableKnowledgeStore } from "./store";

export function sha256Bytes(input: Buffer | Uint8Array | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function thaiDigitsToArabic(text: string): string {
  return text.replace(/[๐-๙]/g, (ch) => String(ch.charCodeAt(0) - 0x0e50));
}

export function arabicDigitsToThai(text: string): string {
  return text.replace(/[0-9]/g, (ch) => String.fromCharCode(0x0e50 + Number(ch)));
}

export function normalizeOfficialRulingIdentifier(raw: string): string {
  if (!raw || !raw.trim()) return "";
  let s = thaiDigitsToArabic(raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/_/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  // Normalize "กค0702/636", "กค  0702 / 636", "กค กค 0706/พ./4756", "ที่ กค 0702(กม.) / 462" -> "กค 0702/636" or "กค 0702(กม.)/462"
  s = s.replace(/^(?:เลขที่หนังสือ|ที่)\s*/i, "");
  s = s.replace(/^(?:กค\s*){2,}/i, "กค ");
  s = s.replace(/^กค\s*([0-9]{2,5})/i, "กค $1");
  s = s.replace(/\s*\(\s*([^)]+?)\s*\)\s*/g, "($1)");
  s = s.replace(/\s*\/\s*/g, "/");
  s = s.replace(/\/\s*พ\.\s*/g, "/พ.");
  return s.trim();
}

const THAI_PALI_ORDINALS_RE =
  /(^|[0-9/])\s*(อัฐารส|สัตตรส|เอกาทศ|ทวาทศ|ปัณรส|จตุทศ|เตรส|โสฬส|จัตวา|เบญจ|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ)(?=\s|$|\()/g;

export function normalizeThaiLegalSectionRef(raw: string): string {
  return thaiDigitsToArabic(raw || "")
    .replace(THAI_PALI_ORDINALS_RE, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

const THAI_MONTHS: Record<string, string> = {
  มกราคม: "01",
  "ม.ค.": "01",
  กุมภาพันธ์: "02",
  กุมพาภัณฑ์: "02",
  "ก.พ.": "02",
  มีนาคม: "03",
  "มี.ค.": "03",
  เมษายน: "04",
  "เม.ย.": "04",
  พฤษภาคม: "05",
  "พ.ค.": "05",
  มิถุนายน: "06",
  "มิ.ย.": "06",
  กรกฎาคม: "07",
  กรกฏาคม: "07",
  "ก.ค.": "07",
  สิงหาคม: "08",
  "ส.ค.": "08",
  กันยายน: "09",
  "ก.ย.": "09",
  ตุลาคม: "10",
  "ต.ค.": "10",
  พฤศจิกายน: "11",
  "พ.ย.": "11",
  ธันวาคม: "12",
  "ธ.ค.": "12",
};

/**
 * Parses Thai Buddhist Era dates (e.g. "5 กุมภาพันธ์ 2569" or "ลงวันที่ 22 เมษายน พ.ศ. ๒๕๖๙")
 * into ISO-8601 YYYY-MM-DD. Never fabricates a date when missing or invalid (SH-10).
 */
export function parseThaiBuddhistDateToIso(rawDate: string | null | undefined): string | null {
  if (!rawDate || !rawDate.trim()) return null;
  const normalized = thaiDigitsToArabic(rawDate).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const yr = Number(normalized.slice(0, 4));
    if (yr >= 2400) {
      return `${yr - 543}${normalized.slice(4)}`;
    }
    if (yr >= 1900 && yr <= 2200) {
      return normalized;
    }
    return null;
  }

  const m = normalized.match(/(\d{1,2})\s*([ก-๙.]+?)\s*(?:พ\.ศ\.\s*)?(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const monthCode = THAI_MONTHS[m[2]];
  let year = Number(m[3]);
  if (!monthCode || day < 1 || day > 31) return null;
  if (year >= 2400) {
    year -= 543;
  }
  if (year < 1850 || year > 2150) return null;
  return `${String(year).padStart(4, "0")}-${monthCode}-${String(day).padStart(2, "0")}`;
}

export function buildDeterministicWorkId(params: {
  doc_type: KnowledgeEntityType;
  issuer_id: string;
  instrument_code?: string;
  normalized_identifier: string;
  issue_year_ce?: string | null;
  disambiguator?: string | null;
  access_scope: string;
}): string {
  // Cross-tenant private materials never share canonical public IDs (SH-09 / AT08)
  const scopePrefix =
    params.access_scope === "scope.platform.public"
      ? "pub"
      : `priv_${sha256Bytes(params.access_scope).slice(0, 8)}`;

  if (params.doc_type === "TaxRuling" && params.normalized_identifier) {
    const slug = params.normalized_identifier
      .replace(/^กค\s*/i, "gk_")
      .replace(/[^a-zA-Z0-9ก-๙]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    const yrPart = params.issue_year_ce ? `_${params.issue_year_ce}` : "";
    const disambigSlug = params.disambiguator
      ? `_${params.disambiguator.replace(/^ruling\.th\.rd\./i, "rd").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase()}`
      : "";
    const hashInput = params.disambiguator
      ? `${scopePrefix}|TaxRuling|${params.issuer_id}|${params.normalized_identifier}|${params.issue_year_ce || ""}|${params.disambiguator}`
      : `${scopePrefix}|TaxRuling|${params.issuer_id}|${params.normalized_identifier}|${params.issue_year_ce || ""}`;
    const hashTail = sha256Bytes(hashInput).slice(0, 8);
    return scopePrefix === "pub"
      ? `work.th.rd.${slug}${yrPart}${disambigSlug}_${hashTail}`
      : `work.${scopePrefix}.rd.${slug}${disambigSlug}_${hashTail}`;
  }

  const composite = `${scopePrefix}|${params.doc_type}|${params.issuer_id}|${params.instrument_code || ""}|${params.normalized_identifier}`;
  const digest = sha256Bytes(composite).slice(0, 14);
  return `work.th.${params.doc_type.toLowerCase()}.${digest}`;
}

export function normalizeTitleForAmbiguityCheck(title: string): string {
  return thaiDigitsToArabic(title || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/ฉบับเพิ่มเติม|ฉบับแก้ไข|สำเนา|copy|v\d+/gi, " ")
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface IdentityResolutionInput {
  doc_type: KnowledgeEntityType;
  issuer_id: string;
  instrument_code?: string;
  official_identifier: string;
  title: string;
  issue_date: string | null;
  access_scope: string;
  actual_bytes_sha256?: string;
  extractor_version?: string;
  is_verified_amendment?: boolean;
  legacy_id?: string;
  owner_batch_id?: BatchId;
}

export interface IdentityResolutionOutcome {
  work_id: string;
  existing_work: LegalWork | null;
  identity_action: IdentityAction;
  requires_review: boolean;
  reason: string;
}

export function resolveCanonicalWorkIdentity(
  store: DurableKnowledgeStore,
  input: IdentityResolutionInput
): IdentityResolutionOutcome {
  const isPublic = input.access_scope === "scope.platform.public";

  // 1. Legacy crosswalk lookup (SH-07) — only within matching scope
  if (input.legacy_id && isPublic) {
    const mappedWorkId = store.getCrosswalkTarget(input.legacy_id);
    if (mappedWorkId) {
      const existing = store.getWork(mappedWorkId);
      if (existing) {
        return evaluateExistingWorkAction(store, existing, input, "Resolved via durable legacy crosswalk");
      }
    }
  }

  const normId =
    input.doc_type === "TaxRuling"
      ? normalizeOfficialRulingIdentifier(input.official_identifier)
      : normalizeThaiLegalSectionRef(input.official_identifier);

  const issueIso = parseThaiBuddhistDateToIso(input.issue_date);
  const issueYearCe = issueIso ? issueIso.slice(0, 4) : null;

  // 2. Exact official identifier + issuer + instrument scope match
  if (normId) {
    const candidates = store.findWorksByNormalizedIdentifier(normId).filter((w) => {
      const wScopeIsPublic = !w.work_id.startsWith("work.priv_");
      if (wScopeIsPublic !== isPublic) return false;
      if (isPublic === false && !w.work_id.includes(sha256Bytes(input.access_scope).slice(0, 8))) {
        return false;
      }
      if (w.type !== input.doc_type || w.issuer_id !== input.issuer_id) return false;
      // AT04: Same section number under DIFFERENT instruments MUST remain distinct!
      if ((w.instrument_code || "") !== (input.instrument_code || "")) return false;
      // Distinct rulings sharing number in different years OR different full dates stay distinct unless one is undated
      if (input.doc_type === "TaxRuling" && issueIso) {
        const existingVersions = store.getVersionsForWork(w.work_id);
        const existingFullDates = existingVersions
          .map((v) => (v.decision_date || v.publication_date || "").trim())
          .filter(Boolean);
        if (existingFullDates.length > 0 && !existingFullDates.includes(issueIso)) {
          return false;
        }
      } else if (input.doc_type === "TaxRuling" && issueYearCe) {
        const existingVersions = store.getVersionsForWork(w.work_id);
        const existingYears = existingVersions
          .map((v) => (v.decision_date || v.publication_date || "").slice(0, 4))
          .filter(Boolean);
        if (existingYears.length > 0 && !existingYears.includes(issueYearCe)) {
          return false;
        }
      }
      return true;
    });

    if (candidates.length === 1) {
      return evaluateExistingWorkAction(
        store,
        candidates[0],
        input,
        `Matched verified official identifier '${normId}'`
      );
    }
    if (candidates.length > 1) {
      return {
        work_id: candidates[0].work_id,
        existing_work: candidates[0],
        identity_action: "REVIEW_IDENTITY_CONFLICT",
        requires_review: true,
        reason: `Multiple existing works (${candidates.length}) match identifier '${normId}'; human consolidation review required (SH-07).`,
      };
    }

    const workId = buildDeterministicWorkId({
      doc_type: input.doc_type,
      issuer_id: input.issuer_id,
      instrument_code: input.instrument_code,
      normalized_identifier: normId,
      issue_year_ce: issueYearCe,
      access_scope: input.access_scope,
    });
    return {
      work_id: workId,
      existing_work: null,
      identity_action: "CREATE_NEW_WORK",
      requires_review: false,
      reason: `New canonical work for verified identifier '${normId}'`,
    };
  }

  // 3. Missing official identifier: check normalized title collision in same scope & type (AT04)
  const normTitle = normalizeTitleForAmbiguityCheck(input.title);
  if (normTitle.length >= 6) {
    const similar = store.listAllWorks().filter((w) => {
      if (w.type !== input.doc_type || w.issuer_id !== input.issuer_id) return false;
      const wNormTitle = normalizeTitleForAmbiguityCheck(w.title_th);
      return (
        wNormTitle === normTitle ||
        (wNormTitle.length >= 8 && (wNormTitle.includes(normTitle) || normTitle.includes(wNormTitle)))
      );
    });

    if (similar.length > 0) {
      const provisionalId = `work.th.conflict.${sha256Bytes(`${input.access_scope}|${input.title}|${input.actual_bytes_sha256 || ""}`).slice(0, 12)}`;
      return {
        work_id: provisionalId,
        existing_work: similar[0],
        identity_action: "REVIEW_IDENTITY_CONFLICT",
        requires_review: true,
        reason: `Missing official identifier and title '${input.title}' collides with existing work '${similar[0].work_id}'; silent merge prohibited (AT04).`,
      };
    }
  }

  const fallbackId = `work.th.unnum.${sha256Bytes(`${input.access_scope}|${input.doc_type}|${input.issuer_id}|${input.title}`).slice(0, 12)}`;
  return {
    work_id: fallbackId,
    existing_work: null,
    identity_action: "CREATE_NEW_WORK",
    requires_review: true,
    reason: "Created unnumbered work flagged for identity verification",
  };
}

function evaluateExistingWorkAction(
  store: DurableKnowledgeStore,
  existing: LegalWork,
  input: IdentityResolutionInput,
  matchReason: string
): IdentityResolutionOutcome {
  if (input.is_verified_amendment) {
    return {
      work_id: existing.work_id,
      existing_work: existing,
      identity_action: "NEW_LEGAL_VERSION",
      requires_review: false,
      reason: `${matchReason}; verified legal amendment creates NEW_LEGAL_VERSION`,
    };
  }

  if (input.actual_bytes_sha256) {
    const extractions = store.getExtractionsForWork(existing.work_id);
    const artifacts = extractions
      .map((e) => store.getArtifact(e.artifact_id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a));

    const sameByteArtifact = artifacts.find(
      (a) =>
        a.actual_bytes_sha256 === input.actual_bytes_sha256 &&
        a.access_scope === input.access_scope
    );

    if (sameByteArtifact) {
      const sameExtractor = extractions.some(
        (e) =>
          e.artifact_id === sameByteArtifact.artifact_id &&
          e.extractor_version === (input.extractor_version || "native-v1")
      );
      if (sameExtractor) {
        return {
          work_id: existing.work_id,
          existing_work: existing,
          identity_action: "SKIP_UNCHANGED",
          requires_review: false,
          reason: `${matchReason}; exact bytes and extractor config already accepted`,
        };
      }
      // SH-09 / AT03: Improved OCR or updated parser on existing representation creates NEW_EXTRACTION_REVISION, NOT a legal amendment!
      return {
        work_id: existing.work_id,
        existing_work: existing,
        identity_action: "NEW_EXTRACTION_REVISION",
        requires_review: false,
        reason: `${matchReason}; same artifact bytes with new extractor '${input.extractor_version}' creates NEW_EXTRACTION_REVISION`,
      };
    }
  }

  return {
    work_id: existing.work_id,
    existing_work: existing,
    identity_action: "ATTACH_REPRESENTATION",
    requires_review: false,
    reason: `${matchReason}; different format/mirror attached as SourceRepresentation without creating duplicate LegalWork`,
  };
}
