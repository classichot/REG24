/**
 * REG24 — Batch B01 Domain Extraction Profile: Revenue Department Tax Rulings (`extractB01`)
 * Implements B01_DEVELOPER_REQUIREMENTS.md Sections 3, 4 & 5 (B01-EX, B01-GR, B01-QA).
 */

import { chunkThaiLegalDocument } from "../extraction";
import {
  buildDeterministicWorkId,
  normalizeOfficialRulingIdentifier,
  normalizeThaiLegalSectionRef,
  parseThaiBuddhistDateToIso,
  sha256Bytes,
  thaiDigitsToArabic,
} from "../identity";
import type {
  Assertion,
  B01ExtractedDomainFields,
  DependencyRequest,
  LegalVersion,
  LegalWork,
  Passage,
  ProfileInput,
  ProfileResult,
  UnresolvedReferenceRecord,
} from "../contracts";

const TAX_TYPE_MAP: Record<string, string> = {
  Corporate_Income_Tax: "CIT",
  VAT: "VAT",
  Withholding_Tax: "WHT",
  Personal_Income_Tax: "PIT",
  Stamp_Duty: "Stamp",
  Specific_Business_Tax: "SBT",
  Other: "General",
  Income_Tax_general: "General",
  Petroleum_Income_Tax: "General",
  Business_Tax_old: "General",
  Inheritance_Tax: "General",
};

export function normalizeB01TaxTypes(rawTaxTypes: string, fullText: string): string[] {
  const out = new Set<string>();
  for (const part of (rawTaxTypes || "").split(/[;,/]+/).map((x) => x.trim()).filter(Boolean)) {
    out.add(TAX_TYPE_MAP[part] || part);
  }
  if (out.size === 0) {
    if (/ภาษีเงินได้นิติบุคคล/.test(fullText)) out.add("CIT");
    if (/ภาษีมูลค่าเพิ่ม/.test(fullText)) out.add("VAT");
    if (/หัก\s*ณ\s*ที่จ่าย/.test(fullText)) out.add("WHT");
    if (/ภาษีเงินได้บุคคลธรรมดา/.test(fullText)) out.add("PIT");
    if (/อากรแสตมป์/.test(fullText)) out.add("Stamp");
    if (/ภาษีธุรกิจเฉพาะ/.test(fullText)) out.add("SBT");
    if (out.size === 0) out.add("General");
  }
  return Array.from(out);
}

function extractRelevantPeriods(text: string): string[] {
  const norm = thaiDigitsToArabic(text);
  const periods = new Set<string>();
  const matches =
    norm.match(/(?:ปีภาษี|รอบระยะเวลาบัญชี|พ\.ศ\.|วันที่\s+\d{1,2}\s+[^\s\d]+\s+)\s*25\d{2}/g) || [];
  for (const m of matches.slice(0, 6)) {
    periods.add(m.replace(/\s+/g, " ").trim());
  }
  return Array.from(periods);
}

function splitRequesterFactsQuestionAndProposal(factsText: string): {
  facts: string | null;
  question: string | null;
  proposed_treatment: string | null;
} {
  if (!factsText || !factsText.trim()) {
    return { facts: null, question: null, proposed_treatment: null };
  }
  const clean = factsText.trim();
  const qMatch = clean.match(
    /((?:จึงขอหารือว่า|จึงขอทราบว่า|มีประเด็นข้อหารือว่า|ขอหารือว่า|จะต้องเสียภาษี[^。\n]*หรือไม่)[\s\S]*)$/
  );
  const propMatch = clean.match(
    /((?:บริษัทฯ?\s*เห็นว่า|ผู้ร้องเห็นว่า|ความเห็นของผู้หารือ)[\s\S]*?)(?=จึงขอหารือ|จึงขอทราบ|$)/
  );

  return {
    facts: clean,
    question: qMatch ? qMatch[1].trim() : null,
    proposed_treatment: propMatch ? propMatch[1].trim() : null,
  };
}

function extractConditionsAndExceptions(rulingText: string): {
  conditions: string[];
  exceptions: string[];
} {
  const conditions: string[] = [];
  const exceptions: string[] = [];

  const condRegex = /(?:หาก|เมื่อ|ทั้งนี้\s*ต้อง|โดยต้องปฏิบัติตาม|ภายใต้เงื่อนไข)[^。\n]{10,220}/g;
  const excRegex = /(?:เว้นแต่|ยกเว้นกรณี|แต่ไม่รวมถึง|ไม่เข้าลักษณะเป็น)[^。\n]{10,220}/g;

  for (const m of rulingText.match(condRegex) || []) {
    conditions.push(m.trim());
  }
  for (const m of rulingText.match(excRegex) || []) {
    exceptions.push(m.trim());
  }
  return {
    conditions: [...new Set(conditions)].slice(0, 6),
    exceptions: [...new Set(exceptions)].slice(0, 6),
  };
}

export function extractCitedRevenueCodeAndSubRegulations(
  provisionsText: string,
  rulingText: string,
  requiredByWorkId: string
): {
  dependencies: DependencyRequest[];
  citedRulings: string[];
  otherStatuteRefs: string[];
} {
  const combined = thaiDigitsToArabic(`${provisionsText}\n${rulingText}`);
  const deps = new Map<string, DependencyRequest>();

  // 1. Revenue Code Sections (`มาตรา ... แห่งประมวลรัษฎากร` or sections in `legal_provisions` when Revenue Code is present)
  const mentionsRevenueCode = /ประมวลรัษฎากร/.test(combined);
  const secMatches =
    combined.match(
      /มาตรา\s*[0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?(?:\s*\([0-9ก-ฮ]+\))*/g
    ) || [];

  for (const rawSec of secMatches) {
    const cleanSec = normalizeThaiLegalSectionRef(rawSec);
    // Avoid attaching sections that belong explicitly to another Act (e.g., Expropriation Act or CCC) as Revenue Code sections!
    const afterIdx = combined.indexOf(rawSec) + rawSec.length;
    const trailingContext = combined.slice(afterIdx, afterIdx + 95);
    if (/แห่งพระราชบัญญัติ|แห่งประมวลกฎหมายแพ่ง/.test(trailingContext) && !/ประมวลรัษฎากร/.test(trailingContext)) {
      continue;
    }
    if (!mentionsRevenueCode && !/แห่งประมวลรัษฎากร/.test(trailingContext)) {
      continue;
    }

    const baseSecMatch = cleanSec.match(
      /^มาตรา\s*([0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?)/
    );
    const baseSec = baseSecMatch ? baseSecMatch[1].replace(/\s+/g, "_") : cleanSec;
    const normKey = `prov.th.rc.${baseSec}`;
    if (!deps.has(normKey)) {
      deps.set(normKey, {
        citation_raw: `${cleanSec} แห่งประมวลรัษฎากร`,
        normalized_key: normKey,
        target_type: "ProvisionVersion",
        instrument_title_th: "ประมวลรัษฎากร",
        section_label: cleanSec,
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B01",
        required_by_work_id: requiredByWorkId,
      });
    }
  }

  // 2. Royal Decrees issued under Revenue Code (`พระราชกฤษฎีกา ... (ฉบับที่ NNN)`)
  const rdMatches = combined.match(/พระราชกฤษฎีกา[^(]{0,60}\(ฉบับที่\s*([0-9]+)\)(?:\s*พ\.ศ\.\s*([0-9]{4}))?/g) || [];
  for (const m of rdMatches) {
    const numM = m.match(/ฉบับที่\s*([0-9]+)/);
    if (!numM) continue;
    const normKey = `subreg.th.rc.royal_decree.${numM[1]}`;
    if (!deps.has(normKey)) {
      deps.set(normKey, {
        citation_raw: m.replace(/\s+/g, " ").trim(),
        normalized_key: normKey,
        target_type: "SubordinateLegislation",
        instrument_title_th: `พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ ${numM[1]})`,
        section_label: null,
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B01",
        required_by_work_id: requiredByWorkId,
      });
    }
  }

  // 3. Departmental Orders / DG VAT Notifications (`คำสั่งกรมสรรพากรที่ ท.ป. X/YYYY`, `ประกาศอธิบดีกรมสรรพากร ... (ฉบับที่ N)`)
  const tpMatches = combined.match(/คำสั่งกรมสรรพากร\s*ที่\s*ท\.ป\.\s*([0-9]+\/[0-9]{4})/g) || [];
  for (const m of tpMatches) {
    const codeM = m.match(/([0-9]+)\/([0-9]{4})/);
    if (!codeM) continue;
    const normKey = `subreg.th.rd.order_tp.${codeM[1]}_${codeM[2]}`;
    if (!deps.has(normKey)) {
      deps.set(normKey, {
        citation_raw: m.replace(/\s+/g, " ").trim(),
        normalized_key: normKey,
        target_type: "SubordinateLegislation",
        instrument_title_th: `คำสั่งกรมสรรพากร ที่ ท.ป. ${codeM[1]}/${codeM[2]}`,
        section_label: null,
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B01",
        required_by_work_id: requiredByWorkId,
      });
    }
  }

  const dgVatMatches =
    combined.match(/ประกาศอธิบดีกรมสรรพากร\s*เกี่ยวกับภาษีมูลค่าเพิ่ม\s*\(ฉบับที่\s*([0-9]+)\)/g) || [];
  for (const m of dgVatMatches) {
    const codeM = m.match(/ฉบับที่\s*([0-9]+)/);
    if (!codeM) continue;
    const normKey = `subreg.th.rd.dg_vat.${codeM[1]}`;
    if (!deps.has(normKey)) {
      deps.set(normKey, {
        citation_raw: m.replace(/\s+/g, " ").trim(),
        normalized_key: normKey,
        target_type: "SubordinateLegislation",
        instrument_title_th: `ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ ${codeM[1]})`,
        section_label: null,
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B01",
        required_by_work_id: requiredByWorkId,
      });
    }
  }

  // 4. Cited other RD rulings
  const citedRulings = (combined.match(/กค\s*[0-9]{4}(?:\([^)]+\))?\s*\/\s*(?:พ\.\s*)?[0-9]+/g) || []).map(
    (x) => normalizeOfficialRulingIdentifier(x)
  );

  // 5. Non-Revenue-Code external Acts (e.g., Animal Feed Quality Control Act B.E. 2558, Expropriation Act B.E. 2562) -> explicit unresolved references if not loaded!
  const otherActs =
    combined.match(/พระราชบัญญัติ[^\s\n(]{4,70}\s*พ\.ศ\.\s*[0-9]{4}/g) || [];

  return {
    dependencies: Array.from(deps.values()),
    citedRulings: [...new Set(citedRulings)],
    otherStatuteRefs: [...new Set(otherActs.map((x) => x.trim()))],
  };
}

/**
 * Mandatory B01 Extraction Profile (`extractB01`).
 * Never writes directly to accepted graph objects; returns validated domain fields, passages,
 * proposed assertions, dependency requests, unresolved references, and review reasons.
 */
export async function extractB01(input: ProfileInput): Promise<ProfileResult> {
  const meta = (input.source_metadata || {}) as {
    ruling_no?: string;
    date?: string;
    primary_tax_type?: string;
    tax_types?: string;
    subject?: string;
    legal_provisions?: string;
    facts?: string;
    ruling?: string;
    legacy_id?: string;
  };

  const fullText = input.extraction.normalized_text || input.extraction.raw_text;
  const rawLetterMatch =
    meta.ruling_no ||
    (fullText.match(/กค\s*[0-9๐-๙]{4}(?:\([^)]+\))?\s*\/\s*(?:พ\.\s*)?[0-9๐-๙]+/) || [])[0] ||
    null;

  const normLetterNo = rawLetterMatch ? normalizeOfficialRulingIdentifier(rawLetterMatch) : null;
  const rawDate =
    meta.date ||
    (fullText.match(/[0-9๐-๙]{1,2}\s+[^\s\d]{3,15}\s+(?:พ\.ศ\.\s*)?[0-9๐-๙]{4}/) || [])[0] ||
    null;
  const isoDate = parseThaiBuddhistDateToIso(rawDate);

  const reviewReasons: string[] = [];
  if (!normLetterNo) {
    reviewReasons.push("MISSING_OFFICIAL_RD_LETTER_NUMBER");
  }
  if (!isoDate) {
    reviewReasons.push("MISSING_OR_UNPARSABLE_RULING_ISSUE_DATE");
  }

  const workId =
    input.candidate_work_id ||
    buildDeterministicWorkId({
      doc_type: "TaxRuling",
      issuer_id: "reg.th.rd",
      normalized_identifier: normLetterNo || input.artifact.artifact_id,
      issue_year_ce: isoDate ? isoDate.slice(0, 4) : null,
      access_scope: input.access_scope,
    });

  const versionId = input.candidate_version_id || `ver.${workId.replace(/^work\./, "")}.v1`;
  const subjectTh =
    meta.subject?.trim() ||
    (normLetterNo ? `หนังสือตอบข้อหารือกรมสรรพากร ที่ ${normLetterNo}` : "หนังสือตอบข้อหารือกรมสรรพากร");

  const taxTypes = normalizeB01TaxTypes(meta.tax_types || meta.primary_tax_type || "", fullText);
  const relevantPeriods = extractRelevantPeriods(`${meta.facts || ""}\n${fullText}`);
  const parsedFacts = splitRequesterFactsQuestionAndProposal(meta.facts || "");
  const rdBody = (meta.ruling || fullText).trim();
  const { conditions, exceptions } = extractConditionsAndExceptions(rdBody);

  const work: LegalWork = {
    work_id: workId,
    type: "TaxRuling",
    issuer_id: "reg.th.rd",
    jurisdiction: "TH",
    title_th: normLetterNo ? `${normLetterNo} — ${subjectTh}` : subjectTh,
    official_identifiers: normLetterNo
      ? [
          {
            raw: rawLetterMatch!,
            normalized: normLetterNo,
            kind: "rd_letter_no",
          },
        ]
      : [],
    identity_evidence: [input.artifact.artifact_id],
    aliases: [meta.legacy_id, rawLetterMatch, normLetterNo].filter((x): x is string => Boolean(x)),
    owner_batch_id: "B01",
    first_loaded_by_batch_id: "B01",
  };

  const version: LegalVersion = {
    version_id: versionId,
    work_id: workId,
    version_label: "v1",
    legal_applicability: [
      {
        valid_from: isoDate,
        valid_to: null,
        conditions: [
          "ใช้เฉพาะข้อเท็จจริงของผู้ขอหารือรายนี้เท่านั้น (Administrative tax ruling bound to stated requester facts)",
          ...conditions,
        ],
        date_status: isoDate ? "verified" : "unknown_restricted",
      },
    ],
    publication_date: isoDate,
    decision_date: isoDate,
    raw_date_text: rawDate,
    temporal_evidence_ids: [input.artifact.artifact_id],
    known_from: input.artifact.fetched_at,
    known_to: null,
    access_scope: input.access_scope,
  };

  const releaseId = `rel.${input.batch_id}.rc1`;
  const headerLabel = `${normLetterNo || workId} (${rawDate || "ไม่ปรากฏวันที่"}) — ${subjectTh}`;
  const passages: Passage[] = [];

  if (parsedFacts.facts) {
    passages.push(
      ...chunkThaiLegalDocument({
        work_id: workId,
        version_id: versionId,
        extraction_id: input.extraction.extraction_id,
        release_id: releaseId,
        artifact_id: input.artifact.artifact_id,
        origin_uri: input.artifact.origin_uri,
        locator_kind: input.artifact.MIME === "application/pdf" ? "pdf_page" : "html_structural",
        structural_selector_prefix: "article > section.requester-facts",
        header_label: headerLabel,
        structural_path_prefix: [normLetterNo || workId, "ข้อเท็จจริงและประเด็นหารือของผู้เสียภาษี"],
        raw_text: parsedFacts.proposed_treatment
          ? `${parsedFacts.facts}\n[ข้อเสนอของผู้หารือ: ${parsedFacts.proposed_treatment}]`
          : parsedFacts.facts,
        statement_role: parsedFacts.proposed_treatment
          ? "requester_proposed_treatment"
          : "requester_facts",
        access_scope: input.access_scope,
      })
    );
  }

  const conclusionPassages = chunkThaiLegalDocument({
    work_id: workId,
    version_id: versionId,
    extraction_id: input.extraction.extraction_id,
    release_id: releaseId,
    artifact_id: input.artifact.artifact_id,
    origin_uri: input.artifact.origin_uri,
    locator_kind: input.artifact.MIME === "application/pdf" ? "pdf_page" : "html_structural",
    structural_selector_prefix: "article > section.rd-ruling",
    header_label: headerLabel,
    structural_path_prefix: [normLetterNo || workId, "แนววินิจฉัยของกรมสรรพากร"],
    raw_text: meta.legal_provisions
      ? `ข้อกฎหมายที่อ้างอิง: ${meta.legal_provisions}\nแนววินิจฉัยกรมสรรพากร: ${rdBody}`
      : rdBody,
    statement_role: "official_conclusion",
    access_scope: input.access_scope,
  });
  passages.push(...conclusionPassages);

  // Link adjacent passages across facts -> conclusion so requester position and RD response remain navigable
  for (let i = 0; i < passages.length; i++) {
    passages[i].adjacent_ids = {
      previous_id: i > 0 ? passages[i - 1].passage_id : null,
      next_id: i < passages.length - 1 ? passages[i + 1].passage_id : null,
    };
  }

  const decisiveEvidenceIds = conclusionPassages.map((p) => p.passage_id);
  const factsEvidenceIds = passages
    .filter((p) => p.statement_role.startsWith("requester_"))
    .map((p) => p.passage_id);

  const citations = extractCitedRevenueCodeAndSubRegulations(
    meta.legal_provisions || "",
    rdBody,
    workId
  );

  const proposedAssertions: Assertion[] = [];

  // 1. ISSUED_BY -> Revenue Department (`reg.th.rd`)
  proposedAssertions.push({
    assertion_id: `asrt.issued_by.${workId}`,
    release_id: releaseId,
    subject: workId,
    subject_type: "TaxRuling",
    predicate: "ISSUED_BY",
    object: "reg.th.rd",
    object_type: "Agency",
    qualifications: { conditions: [], exceptions: [], tax_types: taxTypes },
    evidence_ids: decisiveEvidenceIds.slice(0, 1),
    statement_role: "official_conclusion",
    state: "PROPOSED",
    review_id: null,
    validity: { valid_from: isoDate, valid_to: null },
    confidence: 1.0,
    legal_certainty: "administrative_ruling_specific_facts",
    scope: input.access_scope,
  });

  // 2. ADDRESSES_ISSUE & CONSIDERS_FACT_PATTERN (B01-GR)
  for (const tt of taxTypes) {
    const issueId = `issue.tax.${tt.toLowerCase()}`;
    proposedAssertions.push({
      assertion_id: `asrt.issue.${workId}.${tt.toLowerCase()}`,
      release_id: releaseId,
      subject: workId,
      subject_type: "TaxRuling",
      predicate: "ADDRESSES_ISSUE",
      object: issueId,
      object_type: "Issue",
      qualifications: { conditions, exceptions, tax_types: [tt] },
      evidence_ids: decisiveEvidenceIds.slice(0, 1),
      statement_role: "official_conclusion",
      state: "PROPOSED",
      review_id: null,
      validity: { valid_from: isoDate, valid_to: null },
      confidence: 0.99,
      legal_certainty: "administrative_ruling_specific_facts",
      scope: input.access_scope,
    });
  }

  if (factsEvidenceIds.length > 0) {
    const fpId = `fact.${sha256Bytes(`${workId}:facts`).slice(0, 12)}`;
    proposedAssertions.push({
      assertion_id: `asrt.fact.${workId}`,
      release_id: releaseId,
      subject: workId,
      subject_type: "TaxRuling",
      predicate: "CONSIDERS_FACT_PATTERN",
      object: fpId,
      object_type: "FactPattern",
      qualifications: {
        conditions,
        exceptions,
        tax_types: taxTypes,
        applicable_period: relevantPeriods[0] || null,
      },
      evidence_ids: factsEvidenceIds.slice(0, 1),
      statement_role: "requester_facts",
      state: "PROPOSED",
      review_id: null,
      validity: { valid_from: isoDate, valid_to: null },
      confidence: 0.99,
      legal_certainty: "administrative_ruling_specific_facts",
      scope: input.access_scope,
    });
  }

  // 3. INTERPRETS & CITES links to resolved B02-owned Revenue Code provisions / sub-regulations
  for (const dep of citations.dependencies) {
    proposedAssertions.push({
      assertion_id: `asrt.interprets.${workId}.${dep.normalized_key}`,
      release_id: releaseId,
      subject: workId,
      subject_type: "TaxRuling",
      predicate: "INTERPRETS",
      object: dep.normalized_key,
      object_type: dep.target_type,
      qualifications: {
        conditions,
        exceptions,
        tax_types: taxTypes,
        applicable_period: relevantPeriods[0] || null,
      },
      evidence_ids: decisiveEvidenceIds.slice(0, 1),
      statement_role: "official_conclusion",
      state: "PROPOSED",
      review_id: null,
      validity: { valid_from: isoDate, valid_to: null },
      confidence: 0.99,
      legal_certainty: "administrative_ruling_specific_facts",
      scope: input.access_scope,
    });

    proposedAssertions.push({
      assertion_id: `asrt.cites.${workId}.${dep.normalized_key}`,
      release_id: releaseId,
      subject: workId,
      subject_type: "TaxRuling",
      predicate: "CITES",
      object: dep.normalized_key,
      object_type: dep.target_type,
      qualifications: { conditions: [], exceptions: [], tax_types: taxTypes },
      evidence_ids: decisiveEvidenceIds.slice(0, 1),
      statement_role: "official_conclusion",
      state: "PROPOSED",
      review_id: null,
      validity: { valid_from: isoDate, valid_to: null },
      confidence: 1.0,
      legal_certainty: "administrative_ruling_specific_facts",
      scope: input.access_scope,
    });
  }

  // 4. HAS_CONDITION & HAS_EXCEPTION attached to the ruling's legal interpretation (B01-GR)
  conditions.forEach((condText, idx) => {
    proposedAssertions.push({
      assertion_id: `asrt.cond.${workId}.${idx + 1}`,
      release_id: releaseId,
      subject: workId,
      subject_type: "TaxRuling",
      predicate: "HAS_CONDITION",
      object: decisiveEvidenceIds[0],
      object_type: "Passage",
      qualifications: { conditions: [condText], exceptions: [] },
      evidence_ids: decisiveEvidenceIds.slice(0, 1),
      statement_role: "condition_clause",
      state: "PROPOSED",
      review_id: null,
      validity: { valid_from: isoDate, valid_to: null },
      confidence: 0.99,
      legal_certainty: "administrative_ruling_specific_facts",
      scope: input.access_scope,
    });
  });

  exceptions.forEach((excText, idx) => {
    proposedAssertions.push({
      assertion_id: `asrt.exc.${workId}.${idx + 1}`,
      release_id: releaseId,
      subject: workId,
      subject_type: "TaxRuling",
      predicate: "HAS_EXCEPTION",
      object: decisiveEvidenceIds[0],
      object_type: "Passage",
      qualifications: { conditions: [], exceptions: [excText] },
      evidence_ids: decisiveEvidenceIds.slice(0, 1),
      statement_role: "exception_clause",
      state: "PROPOSED",
      review_id: null,
      validity: { valid_from: isoDate, valid_to: null },
      confidence: 0.99,
      legal_certainty: "administrative_ruling_specific_facts",
      scope: input.access_scope,
    });
  });

  // 5. Explicit UnresolvedReferenceRecord for external non-Revenue-Code statutes not loaded in B01 (SH-17)
  const unresolvedReferences: UnresolvedReferenceRecord[] = citations.otherStatuteRefs
    .filter((act) => !act.includes("ประมวลรัษฎากร"))
    .map((act, idx) => ({
      unresolved_ref_id: `uref.${workId}.${idx + 1}`,
      source_work_id: workId,
      source_version_id: versionId,
      source_passage_id: decisiveEvidenceIds[0],
      raw_citation_text: act,
      target_hint: act,
      owner_batch_hint: /อาหารสัตว์|เวนคืน|สิ่งปลูกสร้าง/.test(act) ? "B07" : "B02",
      reason:
        "External non-tax sector statute cited in ruling facts/reasoning; recorded explicitly as unresolved dependency rather than fabricating placeholder law.",
      created_at: new Date().toISOString(),
    }));

  const domainFields: B01ExtractedDomainFields = {
    official_letter_no_raw: rawLetterMatch,
    official_letter_no_normalized: normLetterNo,
    issue_date_raw: rawDate,
    issue_date_iso: isoDate,
    tax_types: taxTypes,
    relevant_tax_periods: relevantPeriods,
    subject_th: subjectTh,
    requester_facts: parsedFacts.facts,
    requester_question: parsedFacts.question,
    requester_proposed_treatment: parsedFacts.proposed_treatment,
    rd_reasoning: rdBody,
    rd_conclusion: rdBody,
    conditions,
    exceptions,
    cited_provisions_raw: meta.legal_provisions ? [meta.legal_provisions] : [],
    cited_rulings_raw: citations.citedRulings.filter((r) => r !== normLetterNo),
    identity_or_date_unknown_restricted: !normLetterNo || !isoDate,
  };

  return {
    work,
    version,
    passages,
    proposed_assertions: proposedAssertions,
    dependency_requests: citations.dependencies,
    unresolved_references: unresolvedReferences,
    domain_fields: domainFields,
    review_reasons: reviewReasons,
  };
}
