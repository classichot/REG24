/**
 * REG24 — Batch B01 Domain Extraction Profile: Revenue Department Tax Rulings (`extractB01`)
 * Implements B01_DEVELOPER_REQUIREMENTS.md Sections 3, 4 & 5 (B01-EX, B01-GR, B01-QA).
 */

import { chunkThaiLegalDocument } from "../extraction";
import {
  getRecoveredB01RulingTexts,
  getVerifiedStatutoryCorpus,
} from "../../data/verified-statutory-loader";
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

function stripRulingHeaderAndCabinetFooter(text: string): string {
  return text
    .replace(/^(?:ภาษีอากร|เลขที่หนังสือ)[\s\S]{0,950}?ข้อ\s*หารือ\s*:?\s*/u, "")
    .replace(/\s*เลขตู้\s*:?\s*[0-9๐-๙/\-\s]{3,25}$/u, "")
    .trim();
}

/**
 * Separates requester facts/questions from official Revenue Department conclusions (DEF-B01-01).
 * Handles:
 * 1. The 785 RD web-table records where `facts === ruling` with spaced `แนว วินิจฉัย` boundary;
 * 2. The 9 two-column PDF records where `แนว <first ruling line> วินิจฉัย <rest>` is interleaved;
 * 3. Continuous-prose letters pivoting on `กรมสรรพากรขอเรียนว่า` / `จึงวินิจฉัยว่า`;
 * 4. Explicit review flagging if non-empty `facts` and `ruling` remain identical.
 */
export function separateRulingFactsAndConclusion(params: {
  rawFacts?: string | null;
  rawRuling?: string | null;
  fullText: string;
  legacyId?: string | null;
}): {
  factsText: string;
  rulingText: string;
  wasMixedAndSplit: boolean;
  ambiguousUnresolvedMix: boolean;
} {
  const stripTrailingEmptyRulingRow = (s: string): string =>
    s
      .replace(/\s*แนว\s*วินิจฉัย\s*-\s*(?:เลขตู้\s*[0-9๐-๙/\-\s]{3,25})?$/u, "")
      .replace(/\s*เลขตู้\s*[0-9๐-๙/\-\s]{3,25}$/u, "")
      .trim();

  let fRaw = stripTrailingEmptyRulingRow(params.rawFacts || "");
  let rRaw = stripTrailingEmptyRulingRow(params.rawRuling || "");
  if (rRaw === "-") rRaw = "";

  // Recover full text from physical Google Drive PDF if corpus ruling field was empty/truncated
  if (!rRaw && params.legacyId) {
    const rec = getRecoveredB01RulingTexts()[params.legacyId];
    if (rec?.full_text) {
      const cleanedRec = stripTrailingEmptyRulingRow(rec.full_text);
      fRaw = cleanedRec;
      rRaw = "";
    }
  }

  const isIdentical = Boolean(fRaw && rRaw && fRaw === rRaw);
  const fAlreadySeparateFromR =
    Boolean(fRaw && rRaw) && !isIdentical && (rRaw.length < 40 || !fRaw.includes(rRaw.slice(0, 40)));
  const fHasRulingHeader =
    !fAlreadySeparateFromR &&
    /(?:แนว\s*วินิจฉั(?:ย|\s*:)|\.{2}DRFT|กระผมได้พิจารณาแล้วขอเรียนว่า)/u.test(fRaw) &&
    !/(?:มี|วาง|ตาม|เป็น|ประกอบกับ|ศึกษา)\s*แนว\s*วินิจฉัย/u.test(fRaw);

  if (!isIdentical && !fHasRulingHeader && rRaw) {
    return {
      factsText: stripRulingHeaderAndCabinetFooter(fRaw),
      rulingText: rRaw,
      wasMixedAndSplit: false,
      ambiguousUnresolvedMix: false,
    };
  }

  const source = stripTrailingEmptyRulingRow(fRaw || rRaw || params.fullText || "");

  // Pattern A: Standard / glued / typo (`แนววินิจฉั :`) `แนว วินิจฉัย` boundary
  const directRe = /แนว\s*วินิจฉั(?:ย(?:\s|:)*|\s*:)/gu;
  let splitMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = directRe.exec(source)) !== null) {
    const before = source.slice(Math.max(0, m.index - 16), m.index);
    if (!/(?:มี|วาง|ตาม|เป็น|ประกอบกับ|ศึกษา|แนวทาง|คำ)\s*$/u.test(before) && m.index > 30) {
      splitMatch = m;
      break;
    }
  }

  if (splitMatch) {
    const left = stripRulingHeaderAndCabinetFooter(source.slice(0, splitMatch.index));
    const right = stripTrailingEmptyRulingRow(source.slice(splitMatch.index + splitMatch[0].length));
    if (left && right && left !== "-" && left !== right) {
      return {
        factsText: left,
        rulingText: right,
        wasMixedAndSplit: true,
        ambiguousUnresolvedMix: false,
      };
    }
  }

  // Pattern B: Two-column interleaved `แนว <line 1 of ruling> วินิจฉัย <line 2+>` (9/794 records)
  const interleavedRe = /(?:^|\s)แนว\s+([^\n]{5,175}?)\s+วินิจฉัย\s+/u;
  const im = interleavedRe.exec(source);
  if (im && im.index !== undefined) {
    const left = stripRulingHeaderAndCabinetFooter(source.slice(0, im.index));
    const right = stripTrailingEmptyRulingRow(
      `${im[1].trim()} ${source.slice(im.index + im[0].length).trim()}`
    );
    if (left && right && left !== right) {
      return {
        factsText: left,
        rulingText: right,
        wasMixedAndSplit: true,
        ambiguousUnresolvedMix: false,
      };
    }
  }

  // Pattern C: Continuous official letter / RD HTML draft marker pivot clauses (`..DRFT`, `กระผมได้พิจารณาแล้วขอเรียนว่า`, `กรมสรรพากรขอเรียนว่า`)
  const prosePivotRe = /(?:\.{2}DRFT\s*|(?:[0-9]+\.\s*)?กระผมได้พิจารณาแล้วขอเรียนว่า|กรมสรรพากรขอเรียนว่า|จึงวินิจฉัยว่า|วินิจฉัยดังนี้)/u;
  const pm = prosePivotRe.exec(source);
  if (pm && pm.index > 20) {
    const left = stripRulingHeaderAndCabinetFooter(source.slice(0, pm.index));
    const right = stripTrailingEmptyRulingRow(
      source.slice(pm.index).replace(/^\.{2}DRFT\s*/u, "")
    );
    if (left && right && left !== right) {
      return {
        factsText: left,
        rulingText: right,
        wasMixedAndSplit: true,
        ambiguousUnresolvedMix: false,
      };
    }
  }

  // Fallback for genuine inquiry-only pages where RD published `แนว วินิจฉัย -` with no conclusion body (e.g. rd.go.th/30677.html):
  // Never duplicate `facts` into `ruling` and never fabricate an official conclusion!
  if (!rRaw && fRaw) {
    return {
      factsText: stripRulingHeaderAndCabinetFooter(fRaw),
      rulingText: "",
      wasMixedAndSplit: false,
      ambiguousUnresolvedMix: false,
    };
  }

  return {
    factsText: isIdentical ? "" : stripRulingHeaderAndCabinetFooter(fRaw),
    rulingText: rRaw.replace(/\s*เลขตู้\s*[0-9๐-๙/\-\s]{3,25}$/u, "").trim(),
    wasMixedAndSplit: false,
    ambiguousUnresolvedMix: isIdentical,
  };
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

function cleanCompleteThaiLegalClause(rawClause: string, isException: boolean): string | null {
  const collapsed = rawClause.replace(/\s+/g, " ").trim();
  if (collapsed.length < 18) return null;

  // Reject false lexical triggers (`หากำไร`, `หากฎหมาย`, `เมื่อใด`, `เมื่อวันที่ ...`)
  if (/^(?:หากำไร|หากฎหมาย|เมื่อ\s*(?:วันที่|วัน|เดือน|ปี|พ\.ศ\.|คราว|ครั้ง|ใด(?:\s|$)))/u.test(collapsed)) {
    return null;
  }

  // For exceptions (`เว้นแต่ ... ดังนั้น ...`), prefer stopping cleanly before a new consequence sentence (`ดังนั้น ...`)
  if (isException) {
    const excPivot = collapsed.match(
      /^([\s\S]{18,480}?)(?=\s+(?:ดังนั้น|กรณีดังกล่าวจึง|ฉะนั้น|อย่างไรก็ดี|อย่างไรก็ตาม|ส่วนกรณี|สำหรับกรณี|อนึ่ง|[0-9]+\.\s+(?:กรณี|ตาม|การ|บริษัท|ห้าง)))/u
    );
    if (excPivot && excPivot[1].trim().length >= 18) {
      const candidate = excPivot[1].trim().replace(/[,;:\s]+$/u, "");
      if (!/[\u0E40-\u0E44\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]$/u.test(candidate)) {
        return candidate;
      }
    }
  }

  if (collapsed.length <= 540) {
    if (/[\u0E40-\u0E44\u0E31]$/u.test(collapsed)) return null;
    return collapsed;
  }

  // If longer than 540 chars, ONLY cut at a genuine Thai legal sentence/consequence pivot — NEVER mid-word or at an arbitrary char count
  const cleanPivot = collapsed.match(
    /^([\s\S]{25,540}?)(?=\s+(?:ดังนั้น|กรณีดังกล่าวจึง|ฉะนั้น|อย่างไรก็ดี|อย่างไรก็ตาม|ส่วนกรณี|สำหรับกรณี|อนึ่ง|[0-9]+\.\s+(?:กรณี|ตาม|การ|บริษัท|ห้าง)))/u
  );
  if (cleanPivot && cleanPivot[1].trim().length >= 25) {
    const candidate = cleanPivot[1].trim().replace(/[,;:\s]+$/u, "");
    if (!/[\u0E40-\u0E44\u0E31]$/u.test(candidate)) {
      return candidate;
    }
  }

  // Otherwise suppress incomplete summary rather than emitting a truncated bullet (full conclusion is preserved above)
  return null;
}

export function extractConditionsAndExceptions(rulingText: string): {
  conditions: string[];
  exceptions: string[];
} {
  const conditions: string[] = [];
  const exceptions: string[] = [];

  const body = rulingText
    .replace(/^ข้อกฎหมายที่อ้างอิง:[^\n]*\n?/u, "")
    .replace(/^แนววินิจฉัย(?:ของ)?กรมสรรพากร:\s*/u, "")
    .trim();
  if (!body) return { conditions, exceptions };

  // Split into numbered sub-rulings / paragraphs first so bullets never bleed across point 1 -> point 2
  const segments = body
    .split(/\n{2,}|(?=\s+[0-9]+\.\s+(?:กรณี|ตาม|การ|บริษัท|ห้าง|บุคคล|เมื่อ|หาก|เงิน|สำหรับ|ในกรณี|ส่วน))/u)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const condTriggerRe =
    /(?:^|[\s()])((?:หาก(?!ำไร|ฎหมาย)|ในกรณีที่|เฉพาะกรณี(?:ที่)?|ทั้งนี้\s*(?:ต้อง|เฉพาะ)|โดยต้องปฏิบัติตาม|ภายใต้เงื่อนไข|ต่อเมื่อ|เมื่อ(?!(?:\s*(?:วันที่|วัน|เดือน|ปี|พ\.ศ\.|คราว|ครั้ง|ใด(?:\s|$)))))[\s\S]+)$/gu;
  const excTriggerRe =
    /(?:^|[\s()])((?:เว้นแต่|ยกเว้นกรณี|แต่ไม่รวมถึง|ไม่เข้าลักษณะเป็น|มิให้ใช้บังคับแก่)[\s\S]+)$/gu;

  for (const seg of segments) {
    // Walk all condition cue positions in this segment so a shorter concluding condition isn't shadowed by an 800-char opening narrative
    const cueRegex =
      /(?:^|[\s()])(หาก(?!ำไร|ฎหมาย)|ในกรณีที่|เฉพาะกรณี(?:ที่)?|ทั้งนี้\s*(?:ต้อง|เฉพาะ)|โดยต้องปฏิบัติตาม|ภายใต้เงื่อนไข|ต่อเมื่อ|เมื่อ(?!(?:\s*(?:วันที่|วัน|เดือน|ปี|พ\.ศ\.|คราว|ครั้ง|ใด(?:\s|$)))))/gu;
    let cm: RegExpExecArray | null;
    while ((cm = cueRegex.exec(seg)) !== null) {
      const startIdx = cm.index + (cm[0].length - cm[1].length);
      const cleaned = cleanCompleteThaiLegalClause(seg.slice(startIdx), false);
      if (cleaned) {
        conditions.push(cleaned);
        break; // Keep at most 1 clean condition per sub-ruling segment to avoid nested duplicates
      }
    }

    const excCueRegex =
      /(?:^|[\s()])(เว้นแต่|ยกเว้นกรณี|แต่ไม่รวมถึง|ไม่เข้าลักษณะเป็น|มิให้ใช้บังคับแก่)/gu;
    let em: RegExpExecArray | null;
    while ((em = excCueRegex.exec(seg)) !== null) {
      const startIdx = em.index + (em[0].length - em[1].length);
      const cleaned = cleanCompleteThaiLegalClause(seg.slice(startIdx), true);
      if (cleaned) {
        exceptions.push(cleaned);
        break;
      }
    }
  }

  void condTriggerRe;
  void excTriggerRe;

  return {
    conditions: [...new Set(conditions)].slice(0, 6),
    exceptions: [...new Set(exceptions)].slice(0, 6),
  };
}

export interface QuarantinedExternalCitation {
  citation_raw: string;
  normalized_key: string;
  governing_instrument: string;
  instrument_kind:
    | "REVENUE_CODE"
    | "ROYAL_DECREE"
    | "MINISTERIAL_REGULATION"
    | "CIVIL_AND_COMMERCIAL_CODE"
    | "STANDALONE_ACT"
    | "EMERGENCY_DECREE"
    | "OTHER_SUBREGULATION";
  section_label: string | null;
  owner_batch_hint: "B02" | "B07";
  reason: string;
}

const PALI_ORDINALS_PATTERN =
  "(?:อัฐารส|สัตตรส|เอกาทศ|ทวาทศ|ปัณรส|จตุทศ|เตรส|โสฬส|จัตวา|เบญจ|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ)";

export interface SourceSectionTypoSic {
  typo_section: string;
  intended_section: string;
  note_th: string;
}

/**
 * Detects verified typographical section numbers printed in official rd.go.th rulings (S-6 [sic] policy),
 * e.g. `มาตรา 46 ทวิ แห่งประมวลรัษฎากร` in `กค 0811/11340` (`rd.go.th/23767.html`) where both `ข้อกฎหมาย`
 * and the quoted statutory valuation language (`การโอนกรรมสิทธิ์หรือสิทธิครอบครองในอสังหาริมทรัพย์...`) are `มาตรา 49 ทวิ`.
 * Preserves verbatim RD source text untouched while preventing bogus quarantined section records.
 */
export function detectSourceSectionTyposSic(
  provisionsText: string,
  rulingText: string,
  originUri?: string | null
): SourceSectionTypoSic[] {
  const out: SourceSectionTypoSic[] = [];
  const normProv = thaiDigitsToArabic(provisionsText || "").replace(/\s+/g, " ");
  const normRuling = thaiDigitsToArabic(rulingText || "").replace(/\s+/g, " ");

  if (
    /มาตรา\s*46\s*ทวิ/.test(normRuling) &&
    (/มาตรา\s*49\s*ทวิ/.test(normProv) || /มาตรา\s*49\s*ทวิ/.test(normRuling))
  ) {
    const srcRef = originUri ? ` (${originUri})` : "";
    out.push({
      typo_section: "มาตรา 46 ทวิ",
      intended_section: "มาตรา 49 ทวิ",
      note_th: `ต้นฉบับทางการกรมสรรพากร${srcRef} พิมพ์เลขมาตราในแนววินิจฉัยเป็น "มาตรา 46 ทวิ แห่งประมวลรัษฎากร" [sic] โดยหัวข้อกฎหมายและบทบัญญัติที่ยกมาอ้างอิงจริงคือ "มาตรา 49 ทวิ แห่งประมวลรัษฎากร" ทั้งนี้ ระบบคงข้อความตามเอกสารต้นฉบับทุกประการโดยไม่แก้ไขถ้อยคำเอง`,
    });
  }
  return out;
}

export function extractCitedRevenueCodeAndSubRegulations(
  provisionsText: string,
  rulingText: string,
  requiredByWorkId: string,
  extraVerifiedKeys?: Set<string>
): {
  dependencies: DependencyRequest[];
  quarantinedCitations: QuarantinedExternalCitation[];
  citedRulings: string[];
  otherStatuteRefs: string[];
} {
  const combined = thaiDigitsToArabic(`${provisionsText}\n${rulingText}`);
  const compact = combined.replace(/\s+/g, " ");
  const verifiedCorpus = getVerifiedStatutoryCorpus();
  const deps = new Map<string, DependencyRequest>();
  const quarantined = new Map<string, QuarantinedExternalCitation>();
  const sourceTyposSic = detectSourceSectionTyposSic(provisionsText, rulingText);
  const sicTypoBaseSecs = new Set(
    sourceTyposSic.map((t) =>
      normalizeThaiLegalSectionRef(t.typo_section)
        .replace(/^มาตรา\s*/, "")
        .replace(/\s+/g, "_")
    )
  );

  const isVerifiedTarget = (key: string): boolean => {
    if (extraVerifiedKeys?.has(key)) return true;
    if (key === "prov.th.rc.65_ตรี") return true;
    if (key.startsWith("prov.th.rc.")) {
      return Boolean(verifiedCorpus.revenue_code_sections[key]);
    }
    return Boolean(verifiedCorpus.subordinate_and_amendment_works[key]);
  };

  // Span-based, chain-aware Thai section parser (DEF-B01-02)
  const secTokenSource = `(?:มาตรา|ม\\.)\\s*([0-9]+(?:\\/[0-9]+)?(?:\\s*${PALI_ORDINALS_PATTERN})?)(?:\\s*วรรค[^\\s,;()]+|\\s*\\([0-9ก-ฮ]+\\))*`;
  const secRegex = new RegExp(secTokenSource, "gu");
  const chainPrefixRegex = new RegExp(
    `^(?:\\s*(?:,|และ|หรือ|ถึง|ประกอบ|วรรค[ก-๙0-9]+|\\([0-9ก-ฮ]+\\))\\s*|\\s*${secTokenSource}\\s*)*`,
    "u"
  );

  const rcExplicit = new Map<string, string>(); // baseSec -> fullCleanLabel
  const rcUnattributed = new Map<string, string>();
  const nonRcBaseSecs = new Set<string>();

  let sm: RegExpExecArray | null;
  while ((sm = secRegex.exec(compact)) !== null) {
    const fullRawSec = normalizeThaiLegalSectionRef(sm[0]);
    const baseClean = normalizeThaiLegalSectionRef(`มาตรา ${sm[1]}`)
      .replace(/^มาตรา\s*/, "")
      .replace(/\s+/g, "_");
    const leadNumMatch = baseClean.match(/^[0-9]+/);
    const leadNum = leadNumMatch ? Number(leadNumMatch[0]) : 9999;

    const afterStart = sm.index + sm[0].length;
    const lookahead = compact.slice(afterStart, afterStart + 460);
    const chainMatch = chainPrefixRegex.exec(lookahead);
    const tail = chainMatch ? lookahead.slice(chainMatch[0].length) : lookahead;
    const prev = compact.slice(Math.max(0, sm.index - 110), sm.index);

    const crossedCommaSeparator = Boolean(chainMatch && /,/.test(chainMatch[0]));
    // Canonical provision parser (S-6): `มาตรา` belongs only to Codes, Acts, Emergency Decrees, Royal Decrees, or Ministerial Regulations —
    // NEVER to DG Notifications (`ประกาศ...`), Departmental Orders (`คำสั่ง...`), or Regulations (`ระเบียบ...`), which use `ข้อ`!
    const govTailMatch = crossedCommaSeparator
      ? tail.match(
          /^\s*(?:แห่ง|ตาม|ของ|ใน)\s*(ประมวล\s*รัษฎากร|พระราชกฤษฎีกา|พ\.ร\.ฎ\.|ประมวลกฎหมายแพ่งและพาณิชย์|ป\.พ\.พ\.|ประมวลกฎหมายที่ดิน|ประมวลกฎหมายอาญา|ประมวลกฎหมายวิธีพิจารณา[^\s,;]{0,40}|พระราชบัญญัติ|พ\.ร\.บ\.|พระราชกำหนด|พ\.ร\.ก\.|กฎกระทรวง)/u
        )
      : tail.match(
          /^\s*(?:แห่ง|ตาม|ของ|ใน)?\s*(ประมวล\s*รัษฎากร|พระราชกฤษฎีกา|พ\.ร\.ฎ\.|ประมวลกฎหมายแพ่งและพาณิชย์|ป\.พ\.พ\.|ประมวลกฎหมายที่ดิน|ประมวลกฎหมายอาญา|ประมวลกฎหมายวิธีพิจารณา[^\s,;]{0,40}|พระราชบัญญัติ|พ\.ร\.บ\.|พระราชกำหนด|พ\.ร\.ก\.|กฎกระทรวง)/u
        );
    let govHead = govTailMatch ? govTailMatch[1].replace(/\s+/g, "") : null;

    if (!govHead) {
      const govPrevMatch = prev.match(
        /(ประมวล\s*รัษฎากร|พระราชกฤษฎีกา[^,;]{0,95}|พ\.ร\.ฎ\.[^,;]{0,65}|ประมวลกฎหมายแพ่งและพาณิชย์|ป\.พ\.พ\.|พระราชบัญญัติ[^,;]{0,85}|พ\.ร\.บ\.[^,;]{0,65}|กฎกระทรวง[^,;]{0,65})\s*$/u
      );
      if (govPrevMatch) {
        const ptxt = govPrevMatch[1];
        if (/พระราชกฤษฎีกา|พ\.ร\.ฎ\./u.test(ptxt)) govHead = "พระราชกฤษฎีกา";
        else if (/แพ่ง|ป\.พ\.พ\./u.test(ptxt)) govHead = "ประมวลกฎหมายแพ่งและพาณิชย์";
        else if (/กฎกระทรวง/u.test(ptxt)) govHead = "กฎกระทรวง";
        else if (/พระราชบัญญัติ|พ\.ร\.บ\./u.test(ptxt) && !/แก้ไขเพิ่มเติมประมวล\s*รัษฎากร/u.test(ptxt)) {
          govHead = "พระราชบัญญัติ";
        } else if (/รัษฎากร/u.test(ptxt)) {
          govHead = "ประมวลรัษฎากร";
        }
      }
    }

    if (govHead === "ประมวลรัษฎากร") {
      // Thai Revenue Code has Sections 1..129 (+ bis/ter/etc.)
      if (leadNum >= 1 && leadNum <= 129 && !/^[0-9]+\/25[0-9]{2}$/.test(baseClean)) {
        rcExplicit.set(baseClean, `มาตรา ${baseClean.replace(/_/g, " ")}`);
      }
    } else if (govHead === "พระราชกฤษฎีกา" || govHead === "พ.ร.ฎ.") {
      nonRcBaseSecs.add(baseClean);
      const rdNumM = tail.slice(0, 240).match(/ฉบับที่\s*([0-9]+)/) || prev.match(/ฉบับที่\s*([0-9]+)/);
      if (rdNumM) {
        const rdNum = rdNumM[1];
        const rdKey = `subreg.th.rc.royal_decree.${rdNum}`;
        const rdTitle = `พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ ${rdNum})`;
        if (isVerifiedTarget(rdKey)) {
          if (!deps.has(rdKey)) {
            deps.set(rdKey, {
              citation_raw: `${fullRawSec} แห่ง${rdTitle}`,
              normalized_key: rdKey,
              target_type: "SubordinateLegislation",
              instrument_title_th: rdTitle,
              section_label: fullRawSec,
              owner_batch_id: "B02",
              first_loaded_by_batch_id: "B01",
              required_by_work_id: requiredByWorkId,
            });
          }
        } else {
          const qKey = `${rdKey}#${fullRawSec}`;
          quarantined.set(qKey, {
            citation_raw: `${fullRawSec} แห่ง${rdTitle}`,
            normalized_key: rdKey,
            governing_instrument: rdTitle,
            instrument_kind: "ROYAL_DECREE",
            section_label: fullRawSec,
            owner_batch_hint: "B02",
            reason:
              "Section belongs to Royal Decree (not Revenue Code); quarantined as unresolved until verbatim Royal Decree text is verified (DEF-B01-02 / DEF-B01-03).",
          });
        }
      } else {
        const qKey = `subreg.th.royal_decree.unnumbered#${fullRawSec}`;
        quarantined.set(qKey, {
          citation_raw: `${fullRawSec} แห่งพระราชกฤษฎีกา`,
          normalized_key: "subreg.th.royal_decree.unspecified",
          governing_instrument: "พระราชกฤษฎีกา",
          instrument_kind: "ROYAL_DECREE",
          section_label: fullRawSec,
          owner_batch_hint: "B02",
          reason: "Royal Decree section citation without verified decree number; quarantined.",
        });
      }
    } else if (govHead === "ประมวลกฎหมายแพ่งและพาณิชย์" || govHead === "ป.พ.พ.") {
      nonRcBaseSecs.add(baseClean);
      const cccKey = `prov.th.ccc.${baseClean}`;
      quarantined.set(cccKey, {
        citation_raw: `${fullRawSec} แห่งประมวลกฎหมายแพ่งและพาณิชย์`,
        normalized_key: cccKey,
        governing_instrument: "ประมวลกฎหมายแพ่งและพาณิชย์",
        instrument_kind: "CIVIL_AND_COMMERCIAL_CODE",
        section_label: fullRawSec,
        owner_batch_hint: "B02",
        reason:
          "Civil and Commercial Code provision cited in tax ruling; kept strictly separate from Revenue Code and quarantined while CCC text is unverified.",
      });
    } else if (govHead === "กฎกระทรวง") {
      nonRcBaseSecs.add(baseClean);
      const mrNumM = tail.slice(0, 180).match(/ฉบับที่\s*([0-9]+)/) || prev.match(/ฉบับที่\s*([0-9]+)/);
      const mrNum = mrNumM ? mrNumM[1] : null;
      const mrKey = mrNum ? `subreg.th.rc.min_reg.${mrNum}` : "subreg.th.rc.min_reg.unspecified";
      const mrTitle = mrNum
        ? `กฎกระทรวง ฉบับที่ ${mrNum} ออกตามความในประมวลรัษฎากร`
        : "กฎกระทรวง";
      if (mrNum && isVerifiedTarget(mrKey)) {
        if (!deps.has(mrKey)) {
          deps.set(mrKey, {
            citation_raw: `${fullRawSec} แห่ง${mrTitle}`,
            normalized_key: mrKey,
            target_type: "SubordinateLegislation",
            instrument_title_th: mrTitle,
            section_label: fullRawSec,
            owner_batch_id: "B02",
            first_loaded_by_batch_id: "B01",
            required_by_work_id: requiredByWorkId,
          });
        }
      } else {
        quarantined.set(`${mrKey}#${fullRawSec}`, {
          citation_raw: `${fullRawSec} แห่ง${mrTitle}`,
          normalized_key: mrKey,
          governing_instrument: mrTitle,
          instrument_kind: "MINISTERIAL_REGULATION",
          section_label: fullRawSec,
          owner_batch_hint: "B02",
          reason: "Ministerial Regulation provision quarantined until verbatim text is verified.",
        });
      }
    } else if (govHead !== null) {
      nonRcBaseSecs.add(baseClean);
      const actTitleMatch = tail.match(
        /^\s*(?:แห่ง|ตาม|ของ|ใน)?\s*((?:พระราชบัญญัติ|พ\.ร\.บ\.|พระราชกำหนด|พ\.ร\.ก\.|ประมวลกฎหมาย)[^,;\n]{3,110}?(?:พ\.ศ\.\s*[0-9]{4}|พุทธศักราช\s*[0-9]{4})?)(?=\s|$|,)/u
      );
      const govTitle = actTitleMatch ? actTitleMatch[1].trim() : govHead;
      const actSlug = sha256Bytes(govTitle).slice(0, 10);
      const actKey = `prov.th.ext.${actSlug}.${baseClean}`;
      quarantined.set(actKey, {
        citation_raw: `${fullRawSec} แห่ง${govTitle}`,
        normalized_key: actKey,
        governing_instrument: govTitle,
        instrument_kind: /พระราชกำหนด|พ\.ร\.ก\./u.test(govTitle)
          ? "EMERGENCY_DECREE"
          : /พระราชบัญญัติ|พ\.ร\.บ\./u.test(govTitle)
            ? "STANDALONE_ACT"
            : "OTHER_SUBREGULATION",
        section_label: fullRawSec,
        owner_batch_hint: /อาหารสัตว์|เวนคืน|สิ่งปลูกสร้าง|จัดสรรที่ดิน|อาคารชุด/u.test(govTitle) ? "B07" : "B02",
        reason:
          "External non-Revenue-Code statutory provision cited in ruling; isolated from Revenue Code and quarantined while external statute text is unverified.",
      });
    } else {
      // Unattributed section mention: ONLY eligible as Revenue Code if ruling mentions ประมวลรัษฎากร,
      // section number is within RC 1..129, AND this section number was NOT bound to an external Act/RD/CCC in this ruling!
      if (
        /ประมวล\s*รัษฎากร/u.test(compact) &&
        leadNum >= 1 &&
        leadNum <= 129 &&
        !/^[0-9]+\/25[0-9]{2}$/.test(baseClean)
      ) {
        rcUnattributed.set(baseClean, `มาตรา ${baseClean.replace(/_/g, " ")}`);
      }
    }
  }

  // Finalize Revenue Code section dependencies (explicit OR unattributed-and-uncollided)
  const finalRcSecs = new Map<string, string>(rcExplicit);
  for (const [bSec, lbl] of rcUnattributed.entries()) {
    if (!nonRcBaseSecs.has(bSec) && !finalRcSecs.has(bSec)) {
      finalRcSecs.set(bSec, lbl);
    }
  }

  for (const [baseSec, cleanLabel] of finalRcSecs.entries()) {
    if (sicTypoBaseSecs.has(baseSec)) {
      // Verified source typo in official RD text (e.g. `มาตรา 46 ทวิ` [sic] for `มาตรา 49 ทวิ` in LSC-05):
      // do not convert an official typo into a bogus quarantined statute citation.
      continue;
    }
    const normKey = `prov.th.rc.${baseSec}`;
    if (isVerifiedTarget(normKey)) {
      deps.set(normKey, {
        citation_raw: `${cleanLabel} แห่งประมวลรัษฎากร`,
        normalized_key: normKey,
        target_type: "ProvisionVersion",
        instrument_title_th: "ประมวลรัษฎากร",
        section_label: cleanLabel,
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B01",
        required_by_work_id: requiredByWorkId,
      });
    } else {
      quarantined.set(normKey, {
        citation_raw: `${cleanLabel} แห่งประมวลรัษฎากร`,
        normalized_key: normKey,
        governing_instrument: "ประมวลรัษฎากร",
        instrument_kind: "REVENUE_CODE",
        section_label: cleanLabel,
        owner_batch_hint: "B02",
        reason:
          "Cited Revenue Code section (e.g. repealed historical provision) not present in verified consolidated text; quarantined as unresolved rather than generating placeholder text.",
      });
    }
  }

  // 2. Whole-instrument Royal Decrees issued under Revenue Code (`พระราชกฤษฎีกา ... (ฉบับที่ NNN)`)
  const rdMatches =
    compact.match(/พระราชกฤษฎีกา[^(]{0,80}\(ฉบับที่\s*([0-9]+)\)(?:\s*พ\.ศ\.\s*([0-9]{4}))?/g) || [];
  for (const m of rdMatches) {
    const numM = m.match(/ฉบับที่\s*([0-9]+)/);
    if (!numM) continue;
    const normKey = `subreg.th.rc.royal_decree.${numM[1]}`;
    const titleTh = `พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ ${numM[1]})`;
    if (isVerifiedTarget(normKey)) {
      if (!deps.has(normKey)) {
        deps.set(normKey, {
          citation_raw: m.replace(/\s+/g, " ").trim(),
          normalized_key: normKey,
          target_type: "SubordinateLegislation",
          instrument_title_th: titleTh,
          section_label: null,
          owner_batch_id: "B02",
          first_loaded_by_batch_id: "B01",
          required_by_work_id: requiredByWorkId,
        });
      }
    } else if (!Array.from(quarantined.values()).some((q) => q.normalized_key === normKey)) {
      quarantined.set(normKey, {
        citation_raw: m.replace(/\s+/g, " ").trim(),
        normalized_key: normKey,
        governing_instrument: titleTh,
        instrument_kind: "ROYAL_DECREE",
        section_label: null,
        owner_batch_hint: "B02",
        reason:
          "Royal Decree cited in ruling does not yet have verified verbatim statutory text in staging; quarantined as unresolved.",
      });
    }
  }

  // 3. Departmental Orders / DG VAT Notifications (`คำสั่งกรมสรรพากรที่ ท.ป. X/YYYY`, `ประกาศอธิบดีกรมสรรพากร ... (ฉบับที่ N)`)
  const tpMatches = compact.match(/คำสั่งกรมสรรพากร\s*ที่\s*ท\.ป\.\s*([0-9]+\/[0-9]{4})/g) || [];
  for (const m of tpMatches) {
    const codeM = m.match(/([0-9]+)\/([0-9]{4})/);
    if (!codeM) continue;
    const normKey = `subreg.th.rd.order_tp.${codeM[1]}_${codeM[2]}`;
    const titleTh = `คำสั่งกรมสรรพากร ที่ ท.ป. ${codeM[1]}/${codeM[2]}`;
    if (isVerifiedTarget(normKey)) {
      if (!deps.has(normKey)) {
        deps.set(normKey, {
          citation_raw: m.replace(/\s+/g, " ").trim(),
          normalized_key: normKey,
          target_type: "SubordinateLegislation",
          instrument_title_th: titleTh,
          section_label: null,
          owner_batch_id: "B02",
          first_loaded_by_batch_id: "B01",
          required_by_work_id: requiredByWorkId,
        });
      }
    } else {
      quarantined.set(normKey, {
        citation_raw: m.replace(/\s+/g, " ").trim(),
        normalized_key: normKey,
        governing_instrument: titleTh,
        instrument_kind: "OTHER_SUBREGULATION",
        section_label: null,
        owner_batch_hint: "B02",
        reason: "Departmental Order ท.ป. quarantined as unresolved until verbatim text is verified.",
      });
    }
  }

  const dgVatMatches =
    compact.match(/ประกาศอธิบดีกรมสรรพากร\s*เกี่ยวกับภาษีมูลค่าเพิ่ม\s*\(ฉบับที่\s*([0-9]+)\)/g) || [];
  for (const m of dgVatMatches) {
    const codeM = m.match(/ฉบับที่\s*([0-9]+)/);
    if (!codeM) continue;
    const normKey = `subreg.th.rd.dg_vat.${codeM[1]}`;
    const titleTh = `ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ ${codeM[1]})`;
    if (isVerifiedTarget(normKey)) {
      if (!deps.has(normKey)) {
        deps.set(normKey, {
          citation_raw: m.replace(/\s+/g, " ").trim(),
          normalized_key: normKey,
          target_type: "SubordinateLegislation",
          instrument_title_th: titleTh,
          section_label: null,
          owner_batch_id: "B02",
          first_loaded_by_batch_id: "B01",
          required_by_work_id: requiredByWorkId,
        });
      }
    } else {
      quarantined.set(normKey, {
        citation_raw: m.replace(/\s+/g, " ").trim(),
        normalized_key: normKey,
        governing_instrument: titleTh,
        instrument_kind: "OTHER_SUBREGULATION",
        section_label: null,
        owner_batch_hint: "B02",
        reason: "DG VAT Notification quarantined as unresolved until verbatim text is verified.",
      });
    }
  }

  // 4. Cited other RD rulings
  const citedRulings = (compact.match(/กค\s*[0-9]{4}(?:\([^)]+\))?\s*\/\s*(?:พ\.\s*)?[0-9]+/g) || []).map(
    (x) => normalizeOfficialRulingIdentifier(x)
  );

  // 5. Non-Revenue-Code external Acts mentioned without section numbers
  const otherActs =
    compact.match(/พระราชบัญญัติ[^\s\n(]{4,70}\s*พ\.ศ\.\s*[0-9]{4}/g) || [];
  for (const actRaw of otherActs) {
    const act = actRaw.trim();
    if (/ประมวล\s*รัษฎากร/u.test(act)) continue;
    if (!Array.from(quarantined.values()).some((q) => q.governing_instrument.includes(act))) {
      const slug = sha256Bytes(act).slice(0, 10);
      quarantined.set(`statute.th.ext.${slug}`, {
        citation_raw: act,
        normalized_key: `statute.th.ext.${slug}`,
        governing_instrument: act,
        instrument_kind: "STANDALONE_ACT",
        section_label: null,
        owner_batch_hint: /อาหารสัตว์|เวนคืน|สิ่งปลูกสร้าง|จัดสรรที่ดิน|อาคารชุด/u.test(act) ? "B07" : "B02",
        reason:
          "External standalone Act cited in ruling; quarantined explicitly as unresolved dependency rather than generating placeholder law.",
      });
    }
  }

  return {
    dependencies: Array.from(deps.values()),
    quarantinedCitations: Array.from(quarantined.values()),
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
    (fullText.match(
      /[0-9๐-๙]{1,2}\s*(?:มกราคม|กุมภาพันธ์|กุมพาภัณฑ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(?:พ\.ศ\.\s*)?[0-9๐-๙]{4}/
    ) || [])[0] ||
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

  const separated = separateRulingFactsAndConclusion({
    rawFacts: meta.facts,
    rawRuling: meta.ruling,
    fullText,
    legacyId: meta.legacy_id || null,
  });
  if (separated.ambiguousUnresolvedMix) {
    reviewReasons.push("MIXED_FACTS_AND_RULING_REQUIRES_REVIEW");
  }

  const taxTypes = normalizeB01TaxTypes(meta.tax_types || meta.primary_tax_type || "", fullText);
  const relevantPeriods = extractRelevantPeriods(`${separated.factsText}\n${separated.rulingText}`);
  const parsedFacts = splitRequesterFactsQuestionAndProposal(separated.factsText);
  const rdBody = (separated.rulingText || fullText).trim();
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

  const releaseId = input.release_id || `rel.${input.batch_id}.rc1`;
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
        raw_text: parsedFacts.facts,
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

  // 5. Explicit UnresolvedReferenceRecord quarantine for external or unverified statutory citations (SH-17 / DEF-B01-02 / DEF-B01-03)
  const unresolvedReferences: UnresolvedReferenceRecord[] = citations.quarantinedCitations.map(
    (qc, idx) => ({
      unresolved_ref_id: `uref.${workId}.${idx + 1}`,
      source_work_id: workId,
      source_version_id: versionId,
      source_passage_id: decisiveEvidenceIds[0],
      raw_citation_text: qc.citation_raw,
      target_hint: qc.section_label ? `${qc.normalized_key}#${qc.section_label}` : qc.normalized_key,
      governing_instrument: qc.governing_instrument,
      section_label: qc.section_label,
      quarantine_status: "UNRESOLVED_QUARANTINED",
      usable_as_legal_evidence: false,
      owner_batch_hint: qc.owner_batch_hint,
      reason: qc.reason,
      created_at: new Date().toISOString(),
    })
  );

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
