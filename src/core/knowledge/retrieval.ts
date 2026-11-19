/**
 * REG24 — Task F5: Hybrid Legal Retrieval Engine (Exact Identifier + Scoped Lexical + Vector + Bounded <=2-Hop Graph)
 *
 * Implements:
 * - SH-12, SH-13, SH-16
 * - AT05 (Effective-date interval selection)
 * - AT08 (Pre-retrieval & graph-traversal scope + live withdrawal enforcement)
 */

import { isPassageCurrentlyAuthorizedAndActive } from "./evidence";
import {
  normalizeOfficialRulingIdentifier,
  normalizeThaiLegalSectionRef,
  parseThaiBuddhistDateToIso,
  thaiDigitsToArabic,
} from "./identity";
import {
  normalizeBilingualQueryForRetrieval,
  parseFlexibleThaiOrEnglishDateToIso,
} from "./temporal-versioning";
import {
  computeDeterministicLegalEmbedding,
  cosineSimilarity,
  loadGraphProjectionSnapshot,
  loadLexicalProjectionSnapshot,
  loadVectorProjectionSnapshot,
  tokenizeThaiLegalForIndex,
} from "./projections";
import type { Actor, Assertion, EvidenceCard, Passage } from "./contracts";
import type { CanonicalPersistedState, DurableKnowledgeStore } from "./store";

const taxRulingSubjectIndexCache = new WeakMap<
  CanonicalPersistedState,
  { workCount: number; entries: Array<{ work_id: string; subjPart: string }> }
>();

function getPrecomputedTaxRulingSubjects(
  state: CanonicalPersistedState
): Array<{ work_id: string; subjPart: string }> {
  const workCount = Object.keys(state.works).length;
  const cached = taxRulingSubjectIndexCache.get(state);
  if (cached && cached.workCount === workCount) {
    return cached.entries;
  }
  const entries: Array<{ work_id: string; subjPart: string }> = [];
  for (const w of Object.values(state.works)) {
    if (w.type !== "TaxRuling") continue;
    const subjPart = thaiDigitsToArabic(w.title_th.replace(/^[^—]+—\s*/, ""))
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
    if (subjPart.length >= 26 || subjPart.includes("กรณี")) {
      entries.push({ work_id: w.work_id, subjPart });
    }
  }
  taxRulingSubjectIndexCache.set(state, { workCount, entries });
  return entries;
}

export type RetrievalStrategy = "exact_lexical" | "hybrid_no_graph" | "hybrid_with_graph";

export interface RankedPassageHit {
  passage: Passage;
  score: number;
  match_sources: Array<"exact_id" | "lexical" | "vector" | "graph_hop">;
}

export interface HomonymRulingWorkSummary {
  work_id: string;
  raw_date_text: string;
  decision_date: string | null;
  title_th: string;
  origin_uri: string;
}

export interface RetrievalBundle {
  release_id: string;
  strategy: RetrievalStrategy;
  explicit_ruling_ids_in_query: string[];
  resolved_explicit_ruling_ids?: string[];
  explicit_section_refs_in_query: string[];
  explicit_instrument_hints_in_query?: string[];
  unresolved_explicit_ruling_ids: string[];
  year_mismatched_ruling_lookups?: Array<{
    ruling_id: string;
    requested_qualifier: string;
    available_versions: HomonymRulingWorkSummary[];
  }>;
  homonym_ruling_groups?: Array<{
    ruling_id: string;
    pinned_by_date_or_year: boolean;
    works: HomonymRulingWorkSummary[];
  }>;
  top_hits: RankedPassageHit[];
  evidence_cards: EvidenceCard[];
  matched_assertions: Assertion[];
}

function isVersionApplicableOnDate(
  state: CanonicalPersistedState,
  passage: Passage,
  applicableDate: string | null | undefined,
  explicitlyQueriedWorkIds: Set<string>
): boolean {
  if (!applicableDate) return true;
  const ver = state.versions[passage.version_id];
  const work = state.works[passage.work_id];
  if (!ver || !ver.legal_applicability || ver.legal_applicability.length === 0) {
    return true;
  }

  // If the user explicitly asked for a specific TaxRuling by letter number, allow retrieving it so we can display its date context;
  // for consolidated statutory Provisions (`is_consolidated_derived === true`), keep them in candidatePool so `evaluateStatutoryVersionApplicability`
  // can evaluate per-clause `amendment_ledger` (`ACCOUNTING_PERIOD_START`, `ASSESSABLE_TAX_YEAR`, `TRANSACTION_OR_EVENT_DATE`) instead of dropping via scalar `valid_from`!
  if (explicitlyQueriedWorkIds.has(passage.work_id) && work?.type === "TaxRuling") {
    return true;
  }
  if (ver.is_consolidated_derived) {
    return true;
  }

  // Check applicability interval [valid_from, valid_to]
  for (const interval of ver.legal_applicability) {
    if (interval.date_status === "unknown_restricted") {
      // Unknown dates cannot be silently asserted as governing a specific historical date unless it's the only general work
      if (work?.type === "ProvisionVersion") return false;
      continue;
    }
    const afterStart = !interval.valid_from || applicableDate >= interval.valid_from;
    const beforeEnd = !interval.valid_to || applicableDate <= interval.valid_to;
    if (afterStart && beforeEnd) {
      return true;
    }
  }

  // For TaxRuling: if the ruling was issued after applicableDate, exclude it from governing an earlier date (AT13),
  // EXCEPT when no earlier ruling exists and it's interpreting a timeless Revenue Code provision without date conflict.
  return false;
}

export function extractExplicitIdentifiersFromQuery(question: string): {
  rulingIds: string[];
  sectionRefs: string[];
  instrumentHints: string[];
} {
  const { normalizedQuestionForIdentifiers } = normalizeBilingualQueryForRetrieval(question);
  const arabic = thaiDigitsToArabic(normalizedQuestionForIdentifiers);
  // Match standard 'กค 0702/636', historical 4-digit RD bureau codes ('0811(กม)/806', 'กค 0706/พ./1234'),
  // and similar-looking / malformed ruling codes ('กค 702/1494', 'กค 0702-999999', 'กค 0702/1494ก') so typos never silently substitute!
  const rawRulings: string[] = [
    ...(arabic.match(
      /(?:(?:กค\s*)+[0-9]{2,5}(?:\s*\([^)]+\))?\s*[\/\-]\s*(?:[ก-ฮA-Za-z.]+\s*[\/\-]?\s*)?[0-9]+[ก-ฮA-Za-z]*|(?<![0-9/.\-])0[0-9]{3}(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮA-Za-z.]+\s*\/?\s*)?[0-9]+[ก-ฮA-Za-z]*)/g
    ) || []),
  ];
  const contextualRulingRe =
    /(?:หนังสือตอบข้อหารือ|ข้อหารือ|เลขที่หนังสือ)(?:\s*(?:กรมสรรพากร|ที่|เลขที่|เลขไทย))*\s*([1-9][0-9]{2,4}\s*[\/\-]\s*[0-9]+[ก-ฮA-Za-z]*)/g;
  let ctxM: RegExpExecArray | null;
  while ((ctxM = contextualRulingRe.exec(arabic)) !== null) {
    rawRulings.push(ctxM[1]);
  }
  const rulingIds = [...new Set(rawRulings.map((r) => normalizeOfficialRulingIdentifier(r)))];

  const rawSecs =
    arabic.match(
      /(?:มาตรา|ข้อ)\s*[0-9]+(?:\/[0-9]+)?(?:\s*(?:อัฏฐารส|สัตตรส|เอกาทศ|ทวาทศ|จตุทศ|ปัณรส|จัตวา|เบญจ|เตรส|โสฬส|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ))?(?:\s*\([0-9ก-ฮ]+\))*/g
    ) || [];
  const sectionRefs = [...new Set(rawSecs.map((s) => normalizeThaiLegalSectionRef(s)))];

  const instrumentHints: string[] = [];
  const strippedSubordinateRc = arabic.replace(
    /(?:พระราชบัญญัติแก้ไขเพิ่มเติม|ออกตามความใน)\s*ประมวลรัษฎากร/g,
    ""
  );
  if (/ประมวลรัษฎากร/.test(strippedSubordinateRc)) {
    instrumentHints.push("ประมวลรัษฎากร");
  }
  const statMatches =
    arabic.match(
      /(?:ร่าง)?(?:พระราชบัญญัติประกอบรัฐธรรมนูญ|พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศอธิบดีกรมสรรพากร|ประกาศกรมศุลกากร|ประกาศกรมสรรพสามิต|ประกาศกระทรวงการคลัง|คำสั่งกรมสรรพากร|คำสั่งกรมสรรพสามิต)[^\n?]{2,180}?(?=\s*(?:มาตรา\s*[0-9]|ข้อ\s*[0-9]|บัญญัติว่า|กำหนดไว้อย่างไร|กำหนดหลักเกณฑ์อย่างไร|มีผลใช้บังคับ|ประกาศในราชกิจจา|เริ่มใช้บังคับ|คืออะไร|ว่าอย่างไร|เป็นกฎหมายที่ใช้บังคับ|หรือไม่|$))/g
    ) || [];
  for (const sm of statMatches) {
    const cleaned = sm.replace(/\s+/g, " ").trim();
    if (cleaned.length >= 8) {
      instrumentHints.push(cleaned);
    }
  }

  return {
    rulingIds,
    sectionRefs,
    instrumentHints: [...new Set(instrumentHints)],
  };
}

export function retrieveAuthorizedKnowledge(
  store: DurableKnowledgeStore,
  params: {
    question: string;
    release_id: string;
    actor: Actor;
    applicable_date?: string | null;
    comparison_work_ids?: string[];
    controlling_work_ids?: string[];
    incidental_premise_section_ids?: string[];
    demote_rulings_before_iso?: string | null;
    strategy?: RetrievalStrategy;
    graph_source?: "graph_projection_snapshot" | "canonical_assertions";
    max_passages?: number;
  }
): RetrievalBundle {
  const strategy = params.strategy || "hybrid_with_graph";
  const maxPassages = params.max_passages ?? 12;
  const state = store.getState();

  const { normalizedQuestionForIdentifiers, bilingualExpandedQuery } =
    normalizeBilingualQueryForRetrieval(params.question);
  const { rulingIds, sectionRefs, instrumentHints } = extractExplicitIdentifiersFromQuery(
    params.question
  );
  const queryAsksAboutDraft = /ร่างพระราชบัญญัติ|ร่างกฎหมาย|วิเคราะห์ร่าง|กรรมาธิการ|มาตรา\s*77/.test(
    thaiDigitsToArabic(normalizedQuestionForIdentifiers)
  );
  const queryIsVersionComparison = /เปรียบเทียบ|ก่อนแก้ไข|หลังแก้ไข|ฉบับเดิม|ฉบับปัจจุบัน/.test(
    normalizedQuestionForIdentifiers
  );

  const workMatchesInstrumentHint = (w: CanonicalPersistedState["works"][string]): boolean => {
    if (instrumentHints.length === 0) return true;
    const isRevenueCodeCore =
      w.work_id === "statute.th.revenue_code" ||
      w.work_id.startsWith("prov.th.rc.") ||
      w.work_id.startsWith("sched.th.rc.");
    const controllingHintSet = new Set(params.controlling_work_ids || []);
    // Revenue Code sections/schedules are the parent law of RC Amending Acts, Royal Decrees, MinRegs & TP Orders;
    // when identified as a co-controlling authority on a legal fact-application query, do not penalize them when a subordinate instrument number is also named!
    if (isRevenueCodeCore && controllingHintSet.has(w.work_id)) {
      const hasNonRcForeignActHint = instrumentHints.some((h) =>
        /ประมวลกฎหมายแพ่งและพาณิชย์|คุ้มครองแรงงาน|บริษัทมหาชนจำกัด|ภาษีป้าย|ภาษีเงินได้ปิโตรเลียม|ภาษีการรับมรดก|ศุลกากร|สรรพสามิต|คณะกรรมการกฤษฎีกา/.test(
          h
        )
      );
      const hasRcHint = instrumentHints.some((h) =>
        /ประมวลรัษฎากร|พระราชกฤษฎีกา|กฎกระทรวง|คำสั่งกรมสรรพากร|ประกาศอธิบดี/.test(h)
      );
      if (!hasNonRcForeignActHint || hasRcHint) {
        return true;
      }
    }
    const hay = thaiDigitsToArabic(
      `${w.title_th} ${(w.aliases || []).join(" ")} ${(w.official_identifiers || []).map((o) => o.normalized).join(" ")}`
    ).replace(/\s+/g, " ");
    return instrumentHints.some((hint) => {
      const hNorm = thaiDigitsToArabic(hint).replace(/\s+/g, " ").trim();
      if (hNorm === "ประมวลรัษฎากร") {
        return (
          w.work_id === "statute.th.revenue_code" ||
          w.work_id.startsWith("prov.th.rc.") ||
          w.work_id.startsWith("sched.th.rc.")
        );
      }
      // If the query specifies an explicit instrument issue number `(ฉบับที่ N)` or `ท.ป. X/YYYY`, strictly enforce it!
      const chabapM = hNorm.match(/ฉบับที่\s*([0-9]+)/);
      if (chabapM) {
        const numRe = new RegExp(`ฉบับที่\\s*${chabapM[1]}(?![0-9])`);
        if (!numRe.test(hay)) return false;
      }
      const tpM = hNorm.match(/(?:ท\.ป\.|ป\.)\s*([0-9]+\/[0-9]{4})/);
      if (tpM && !hay.includes(tpM[1])) {
        return false;
      }
      if (hay.includes(hNorm)) return true;
      if (chabapM) {
        // Instrument type + exact `ฉบับที่ N` match
        const typePrefix = hNorm.split(/\s*(?:\(|ฉบับที่|ออกตามความ|ว่าด้วย)/)[0].trim();
        return typePrefix.length >= 6 && hay.includes(typePrefix);
      }
      const stem = hNorm.split(/\s*(?:พ\.ศ\.)/)[0].trim();
      return stem.length >= 14 && hay.includes(stem);
    });
  };

  // Map explicit ruling IDs to canonical works in scope
  const allAuthorizedPassages = store
    .getPassagesForRelease(params.release_id)
    .filter((p) => isPassageCurrentlyAuthorizedAndActive(state, p, params.actor));

  const authorizedWorkIds = new Set(allAuthorizedPassages.map((p) => p.work_id));

  const explicitWorkIds = new Set<string>(params.comparison_work_ids || []);
  const secondarySectionWorkIds = new Set<string>();
  const wrongInstrumentSectionWorkIds = new Set<string>();
  const excludedHomonymWorkIds = new Set<string>();
  const unresolvedExplicitRulingIds: string[] = [];
  const resolvedExplicitRulingIds: string[] = [];
  const yearMismatchedRulingLookups: NonNullable<RetrievalBundle["year_mismatched_ruling_lookups"]> = [];
  const homonymRulingGroups: NonNullable<RetrievalBundle["homonym_ruling_groups"]> = [];

  const qArabicForQualifier = thaiDigitsToArabic(normalizedQuestionForIdentifiers)
    .replace(/\s+/g, " ")
    .trim();
  const extractRulingDateOrYearQualifier = (
    rId: string
  ): { rawQualifier: string; isoDate: string | null; yearCe: string | null } | null => {
    const bare = rId.replace(/^กค\s+/, "");
    const flexPattern = bare
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\(/g, "\\s*\\(\\s*")
      .replace(/\)/g, "\\s*\\)\\s*")
      .replace(/\//g, "\\s*\\/\\s*");
    const rRe = new RegExp(`(?:กค\\s*)?${flexPattern}`, "i");
    const mLoc = rRe.exec(qArabicForQualifier);
    const afterText = mLoc ? qArabicForQualifier.slice(mLoc.index + mLoc[0].length) : "";

    const fullDateRe =
      /^\s*(?:,|\()?\s*(?:ลงวันที่|ฉบับลงวันที่|วันที่)?\s*([0-9]{1,2}\s*(?:มกราคม|กุมภาพันธ์|กุมพาภัณฑ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(?:พ\.ศ\.\s*)?25[3-7][0-9])/;
    const dm = afterText.match(fullDateRe);
    if (dm) {
      const iso = parseThaiBuddhistDateToIso(dm[1]);
      if (iso) {
        return { rawQualifier: dm[1].trim(), isoDate: iso, yearCe: iso.slice(0, 4) };
      }
    }

    const yearRe =
      /^\s*(?:\(\s*(?:ปี\s*(?:พ\.ศ\.\s*)?|พ\.ศ\.\s*)?(25[3-7][0-9])\s*\)|(?:ปี(?:\s*พ\.ศ\.)?|พ\.ศ\.|ฉบับปี)\s*(25[3-7][0-9]))/;
    const ym = afterText.match(yearRe);
    if (ym) {
      const beStr = ym[1] || ym[2];
      return {
        rawQualifier: `ปี พ.ศ. ${beStr}`,
        isoDate: null,
        yearCe: String(Number(beStr) - 543),
      };
    }

    if (rulingIds.length === 1) {
      const globalDatedRe =
        /(?:ลงวันที่|ฉบับลงวันที่)\s*([0-9]{1,2}\s*(?:มกราคม|กุมภาพันธ์|กุมพาภัณฑ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(?:พ\.ศ\.\s*)?25[3-7][0-9])/;
      const gdm = qArabicForQualifier.match(globalDatedRe);
      if (gdm) {
        const iso = parseThaiBuddhistDateToIso(gdm[1]);
        if (iso) {
          return { rawQualifier: gdm[1].trim(), isoDate: iso, yearCe: iso.slice(0, 4) };
        }
      }
      const globalRulingYearRe =
        /(?<!ปีภาษี\s*)(?<!รอบระยะเวลาบัญชี\s*)(?<!รอบบัญชี\s*)(?:ฉบับปี(?:\s*พ\.ศ\.)?|ลงปี(?:\s*พ\.ศ\.)?|\(\s*(?:ปี\s*(?:พ\.ศ\.\s*)?|พ\.ศ\.\s*)(25[3-7][0-9])\s*\))\s*(25[3-7][0-9])?/;
      const gym = qArabicForQualifier.match(globalRulingYearRe);
      const beYr = gym?.[1] || gym?.[2];
      if (beYr) {
        return {
          rawQualifier: `ปี พ.ศ. ${beYr}`,
          isoDate: null,
          yearCe: String(Number(beYr) - 543),
        };
      }
    }
    return null;
  };

  const summarizeHomonymWork = (w: CanonicalPersistedState["works"][string]): HomonymRulingWorkSummary => {
    const vers = Object.values(state.versions).filter((v) => v.work_id === w.work_id);
    const ver = vers[0];
    const psg = allAuthorizedPassages.find((p) => p.work_id === w.work_id);
    return {
      work_id: w.work_id,
      raw_date_text: ver?.raw_date_text || "",
      decision_date: ver?.decision_date || ver?.publication_date || null,
      title_th: w.title_th,
      origin_uri: psg?.real_locator.origin_uri || "",
    };
  };

  for (const rId of rulingIds) {
    const rIdWithPrefix = rId.startsWith("กค ") ? rId : `กค ${rId}`;
    const rIdWithoutPrefix = rId.replace(/^กค\s+/, "");
    const matchedWorks = Object.values(state.works).filter(
      (w) =>
        w.type === "TaxRuling" &&
        authorizedWorkIds.has(w.work_id) &&
        w.official_identifiers.some(
          (oid) =>
            oid.normalized === rId ||
            oid.normalized === rIdWithPrefix ||
            oid.normalized === rIdWithoutPrefix
        )
    );
    if (matchedWorks.length === 0) {
      unresolvedExplicitRulingIds.push(rId);
      continue;
    }

    const allSummaries = matchedWorks
      .map(summarizeHomonymWork)
      .sort((a, b) => (b.decision_date || "").localeCompare(a.decision_date || ""));
    const qual = extractRulingDateOrYearQualifier(rId);

    if (qual) {
      const filtered = matchedWorks.filter((mw) => {
        const s = allSummaries.find((x) => x.work_id === mw.work_id);
        const dec = s?.decision_date || "";
        if (qual.isoDate) return dec === qual.isoDate;
        if (qual.yearCe) return dec.slice(0, 4) === qual.yearCe;
        return true;
      });
      if (filtered.length === 0) {
        for (const mw of matchedWorks) excludedHomonymWorkIds.add(mw.work_id);
        yearMismatchedRulingLookups.push({
          ruling_id: rId,
          requested_qualifier: qual.rawQualifier,
          available_versions: allSummaries,
        });
        continue;
      }
      resolvedExplicitRulingIds.push(rId);
      const keptSet = new Set(filtered.map((x) => x.work_id));
      for (const mw of matchedWorks) {
        if (keptSet.has(mw.work_id)) explicitWorkIds.add(mw.work_id);
        else excludedHomonymWorkIds.add(mw.work_id);
      }
      if (filtered.length > 1) {
        homonymRulingGroups.push({
          ruling_id: rId,
          pinned_by_date_or_year: true,
          works: allSummaries.filter((x) => keptSet.has(x.work_id)),
        });
      }
    } else {
      resolvedExplicitRulingIds.push(rId);
      for (const mw of matchedWorks) explicitWorkIds.add(mw.work_id);
      if (matchedWorks.length > 1) {
        homonymRulingGroups.push({
          ruling_id: rId,
          pinned_by_date_or_year: false,
          works: allSummaries,
        });
      }
    }
  }

  for (const sRef of sectionRefs) {
    const baseMatch = sRef.match(
      /^(?:มาตรา|ข้อ)\s*([0-9]+(?:\/[0-9]+)?(?:\s*(?:อัฏฐารส|สัตตรส|เอกาทศ|ทวาทศ|จตุทศ|ปัณรส|จัตวา|เบญจ|เตรส|โสฬส|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ))?)/
    );
    const prefixWord = sRef.startsWith("ข้อ") ? "ข้อ" : "มาตรา";
    const normBase = baseMatch ? `${prefixWord} ${baseMatch[1].replace(/\s+/g, " ").trim()}` : sRef;
    for (const w of Object.values(state.works)) {
      if (!authorizedWorkIds.has(w.work_id)) continue;
      if (
        w.type !== "Provision" &&
        w.type !== "ProvisionVersion" &&
        w.type !== "Statute" &&
        w.type !== "SubordinateLegislation"
      ) {
        continue;
      }
      const idMatchesExact = w.official_identifiers.some((oid) => oid.normalized === sRef);
      const idMatchesBase =
        normBase !== sRef && w.official_identifiers.some((oid) => oid.normalized === normBase);
      if (!idMatchesExact && !idMatchesBase) continue;

      if (!workMatchesInstrumentHint(w)) {
        wrongInstrumentSectionWorkIds.add(w.work_id);
        continue;
      }
      if (idMatchesExact) {
        explicitWorkIds.add(w.work_id);
      } else {
        secondarySectionWorkIds.add(w.work_id);
      }
    }
  }

  // Also match named Statute / SubordinateLegislation instruments directly when queried by title or explicit code!
  const qNormFullRaw = thaiDigitsToArabic(params.question).replace(/\s+/g, " ").trim();
  const qNormFull = thaiDigitsToArabic(normalizedQuestionForIdentifiers).replace(/\s+/g, " ").trim();
  const exactFullTitleWorkIds = new Set<string>();
  const nonGenericHints = instrumentHints.filter((h) => h !== "ประมวลรัษฎากร");
  for (const w of Object.values(state.works)) {
    if (!authorizedWorkIds.has(w.work_id)) continue;
    if (w.type === "TaxRuling" || w.type === "Provision" || w.type === "ProvisionVersion") continue;
    if (
      !queryAsksAboutDraft &&
      state.versions[`ver.${w.work_id.replace(/^(?:work\.|statute\.|subreg\.)/, "")}.v1_legislative_draft`]
    ) {
      continue;
    }
    const wTitleNorm = thaiDigitsToArabic(w.title_th).replace(/\s+/g, " ").trim();
    if (wTitleNorm.length >= 10 && (qNormFullRaw.includes(wTitleNorm) || qNormFull.includes(wTitleNorm))) {
      explicitWorkIds.add(w.work_id);
      exactFullTitleWorkIds.add(w.work_id);
      continue;
    }
    if (sectionRefs.length === 0 && nonGenericHints.length > 0 && workMatchesInstrumentHint(w)) {
      explicitWorkIds.add(w.work_id);
    }
  }

  const normalizedApplicableDate =
    parseFlexibleThaiOrEnglishDateToIso(params.applicable_date) ||
    params.applicable_date ||
    null;

  // Filter passages by temporal applicability (AT05, AT13), preserving multi-version comparison when requested (B02-U03)
  let candidatePool = allAuthorizedPassages.filter((p) =>
    queryIsVersionComparison && !normalizedApplicableDate
      ? true
      : isVersionApplicableOnDate(state, p, normalizedApplicableDate, explicitWorkIds)
  );
  // Fallback if applicable_date filtered out rulings whose ruling issue_date is in BE 2569 while querying general tax rules without explicit historical statute conflict
  if (candidatePool.length === 0 && normalizedApplicableDate && sectionRefs.length === 0) {
    candidatePool = allAuthorizedPassages.filter((p) => state.works[p.work_id]?.type !== "ProvisionVersion");
  }

  const passageById = new Map(candidatePool.map((p) => [p.passage_id, p]));
  const passagesByWorkId = new Map<string, Passage[]>();
  for (const p of candidatePool) {
    const arr = passagesByWorkId.get(p.work_id);
    if (arr) arr.push(p);
    else passagesByWorkId.set(p.work_id, [p]);
  }

  const scoreMap = new Map<
    string,
    { score: number; sources: Set<"exact_id" | "lexical" | "vector" | "graph_hop"> }
  >();

  const addScore = (
    passageId: string,
    delta: number,
    src: "exact_id" | "lexical" | "vector" | "graph_hop"
  ) => {
    if (!passageById.has(passageId)) return;
    const cur = scoreMap.get(passageId) || { score: 0, sources: new Set() };
    cur.score += delta;
    cur.sources.add(src);
    scoreMap.set(passageId, cur);
  };

  // Stage 1: Exact identifier & comparison work boost (always outranks fuzzy lexical/vector scores)
  const unpinnedHomonymWorkIds = new Set(
    homonymRulingGroups
      .filter((g) => !g.pinned_by_date_or_year && g.works.length > 1)
      .flatMap((g) => g.works.map((w) => w.work_id))
  );
  const genericLookupStopwords = new Set([
    "ค้นหา",
    "หนังสือ",
    "หนังสือตอบ",
    "หนังสือตอบข้อหารือ",
    "ตอบข้อหารือ",
    "ข้อหารือ",
    "เลขที่",
    "กรมสรรพากร",
    "แนววินิจฉัย",
    "วินิจฉัย",
    "อย่างไร",
    "หรือไม่",
    "เรื่อง",
    "ตาม",
    "กรณี",
  ]);
  const qTokens = tokenizeThaiLegalForIndex(bilingualExpandedQuery);
  const distinctiveHomonymTokens = qTokens.filter(
    (t) =>
      t.length >= 3 &&
      !genericLookupStopwords.has(t) &&
      !/^(?:กค|[0-9]{2,6})$/.test(t)
  );
  // Also check explicit non-tax-period year mention (e.g. "กค 0702/636 ... ปี 2555") when disambiguating homonyms
  const looseBeYears = new Set<string>(
    (qArabicForQualifier.match(/(?<!ปีภาษี\s*)(?<!รอบระยะเวลาบัญชี\s*)(?:ปี(?:\s*พ\.ศ\.)?|พ\.ศ\.)\s*(25[3-7][0-9])/g) || [])
      .map((s) => s.match(/(25[3-7][0-9])/)?.[1] || "")
      .filter(Boolean)
  );

  const incidentalPremiseSet = new Set(params.incidental_premise_section_ids || []);
  for (const wid of explicitWorkIds) {
    const fullTitleBonus = exactFullTitleWorkIds.has(wid) ? 8.0 : 0.0;
    const workPassages = passagesByWorkId.get(wid) || [];
    const wMeta = state.works[wid];
    const isIncidentalPremiseOnly = Boolean(
      incidentalPremiseSet.size > 0 &&
        !(params.controlling_work_ids || []).includes(wid) &&
        wMeta?.official_identifiers.some((oid) => incidentalPremiseSet.has(oid.normalized))
    );
    let homonymTopicBonus = 0;
    if (unpinnedHomonymWorkIds.has(wid)) {
      const wObj = state.works[wid];
      const wVer = workPassages[0] ? state.versions[workPassages[0].version_id] : undefined;
      const wCombined = thaiDigitsToArabic(
        `${wObj?.title_th || ""} ${workPassages.map((wp) => wp.exact_text).join(" ")}`
      ).toLowerCase();
      for (const dt of distinctiveHomonymTokens) {
        if (wCombined.includes(dt)) {
          const inTitle = thaiDigitsToArabic(wObj?.title_th || "").toLowerCase().includes(dt);
          homonymTopicBonus += inTitle ? 3.5 : 1.5;
        }
      }
      const wBeYear = wVer?.decision_date ? String(Number(wVer.decision_date.slice(0, 4)) + 543) : "";
      if (wBeYear && looseBeYears.has(wBeYear)) {
        homonymTopicBonus += 10.0;
      }
    }
    for (const p of workPassages) {
      const ver = state.versions[p.version_id];
      const decYr = Number((ver?.decision_date || "").slice(0, 4)) || 2000;
      const recencyTieBreak =
        state.works[wid]?.type === "TaxRuling"
          ? Math.max(0, Math.min(0.08, ((decYr - 1990) / 45) * 0.06))
          : 0;
      const roleBoost = isIncidentalPremiseOnly
        ? 4.0
        : p.statement_role === "official_conclusion" || p.statement_role === "statutory_text"
          ? 40.0
          : 32.0;
      addScore(p.passage_id, roleBoost + fullTitleBonus + homonymTopicBonus + recencyTieBreak, "exact_id");
    }
  }

  // Hierarchy-of-Authority Controlling Law Boost (`LEGAL_FACT_APPLICATION` mode):
  // Ensures controlling Revenue Code provisions, schedules, amending Acts, and governing subordinate laws
  // rank deterministically ahead of random lexical TaxRulings!
  for (const [ctrlIdx, ctrlWid] of (params.controlling_work_ids || []).entries()) {
    const ctrlPassages = passagesByWorkId.get(ctrlWid) || [];
    const priorityBoost = Math.max(28.0, 44.0 - ctrlIdx * 1.2);
    for (const cp of ctrlPassages) {
      if (cp.statement_role === "statutory_text" || cp.statement_role === "official_conclusion") {
        addScore(cp.passage_id, priorityBoost, "exact_id");
      }
    }
  }
  for (const wid of secondarySectionWorkIds) {
    if (explicitWorkIds.has(wid)) continue;
    for (const p of passagesByWorkId.get(wid) || []) {
      addScore(p.passage_id, 24.0, "exact_id");
    }
  }

  // Stage 2: Scoped Lexical Candidate Generation (Top 40)
  const lexicalScored: Array<{ passage_id: string; lexScore: number }> = [];

  if (qTokens.length > 0) {
    const lexSnap = loadLexicalProjectionSnapshot(store, params.release_id);
    if (lexSnap && candidatePool.length > 800) {
      const totalDocs = Math.max(1, lexSnap.passage_count || candidatePool.length);
      const hitAccum = new Map<string, number>();
      const denom = Math.sqrt(Math.max(4, qTokens.length));
      for (const qt of qTokens) {
        if (qt.length < 2) continue;
        const posted = lexSnap.inverted_index[qt];
        if (!posted || posted.length === 0) continue;
        const idf = Math.log(1 + totalDocs / (1 + posted.length));
        const lenWeight = qt.length >= 6 ? 2.4 : qt.length >= 4 ? 1.5 : 0.8;
        const delta = idf * lenWeight;
        for (const pid of posted) {
          if (!passageById.has(pid)) continue;
          hitAccum.set(pid, (hitAccum.get(pid) || 0) + delta);
        }
      }
      // Refine top 250 IDF candidates + any exact ruling/statute header-subject matches
      const qClean = thaiDigitsToArabic(params.question).replace(/\s+/g, " ").toLowerCase().trim();
      for (const entry of getPrecomputedTaxRulingSubjects(state)) {
        if (!qClean.includes(entry.subjPart)) continue;
        const wPsgs = passagesByWorkId.get(entry.work_id);
        if (!wPsgs) continue;
        for (const p of wPsgs) {
          hitAccum.set(p.passage_id, (hitAccum.get(p.passage_id) || 0) + 40.0);
        }
      }
      const preTop = Array.from(hitAccum.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 350);
      for (const [pid, idfHits] of preTop) {
        const p = passageById.get(pid)!;
        const w = state.works[p.work_id];
        const hdrNorm = thaiDigitsToArabic(p.contextualized_header).replace(/\s+/g, " ").toLowerCase();
        const bodyNorm = thaiDigitsToArabic(p.exact_text).toLowerCase();
        let exactBonus = 0;
        let hasFullSubjMatch = false;
        for (const qt of qTokens) {
          if (qt.length >= 5 && (hdrNorm.includes(qt) || bodyNorm.includes(qt))) {
            exactBonus += hdrNorm.includes(qt) ? 1.8 : 0.9;
          }
        }
        // Boost when full TaxRuling subject title appears in the question (never matching `มาตรา 80` inside `มาตรา 80/1`!)
        if (w?.type === "TaxRuling") {
          const subjPart = thaiDigitsToArabic(w.title_th.replace(/^[^—]+—\s*/, ""))
            .replace(/\s+/g, " ")
            .toLowerCase()
            .trim();
          if ((subjPart.length >= 26 || subjPart.includes("กรณี")) && qClean.includes(subjPart)) {
            hasFullSubjMatch = true;
          }
        }
        const rawLexRatio = (idfHits + exactBonus) / (denom * 4.5);
        const baseLex =
          rawLexRatio <= 4.0 ? rawLexRatio : 4.0 + Math.log1p(rawLexRatio - 4.0) * 1.5;
        const normalizedLex = hasFullSubjMatch ? baseLex + 10.5 : baseLex;
        lexicalScored.push({ passage_id: pid, lexScore: normalizedLex });
      }
    } else {
      for (const p of candidatePool) {
        const work = state.works[p.work_id];
        const docText = `${(work?.official_identifiers || []).map((i) => i.normalized).join(" ")} ${p.contextualized_header} ${p.exact_text}`;
        const docNorm = thaiDigitsToArabic(docText).toLowerCase();
        let hits = 0;
        for (const qt of qTokens) {
          if (qt.length < 2) continue;
          if (docNorm.includes(qt)) {
            hits += qt.length >= 5 ? 2.0 : 1.0;
          }
        }
        if (hits > 0) {
          const normScore = hits / Math.sqrt(Math.max(4, qTokens.length));
          lexicalScored.push({ passage_id: p.passage_id, lexScore: normScore });
        }
      }
    }
  }

  lexicalScored
    .sort((a, b) => b.lexScore - a.lexScore)
    .slice(0, 40)
    .forEach((item, rank) => {
      const rrf = 1 / (15 + rank);
      addScore(item.passage_id, item.lexScore * 2.5 + rrf * 10, "lexical");
    });

  // Stage 2b: Data-Driven Statutory `amendment_ledger` Concept Indexing across B01..B10
  // Runs even when a ruling ID is also present in the prompt so mixed ruling + historical-law questions
  // always surface the implicated statutory `LegalWork` into `top_hits` for temporal applicability evaluation.
  {
    const qSubstrHay = thaiDigitsToArabic(bilingualExpandedQuery).toLowerCase();
    for (const [wid, wPsgs] of passagesByWorkId.entries()) {
      const w = state.works[wid];
      if (!w || w.type === "TaxRuling" || wPsgs.length === 0) continue;
      const ver = state.versions[wPsgs[0].version_id];
      const ledger = ver?.amendment_ledger;
      if (!ledger || ledger.length === 0) continue;
      for (const item of ledger) {
        if (!item.amending_work_id) continue;
        let kwHits = 0;
        let hasSpecificPhrase = false;
        for (const kw of item.topic_keywords || []) {
          if (kw.length < 5 || kw.startsWith("(")) continue;
          if (/^(?:ในต่างประเทศ|ในประเทศไทย|ในราชอาณาจักร|นอกประเทศ)/.test(kw)) continue;
          if (qSubstrHay.includes(kw.toLowerCase())) {
            kwHits += 1;
            if (kw.length >= 9 || kw.includes(" ")) hasSpecificPhrase = true;
          }
        }
        if (hasSpecificPhrase || kwHits >= 2) {
          const statBoost = Math.min(26.0, 14.0 + kwHits * 4.0);
          for (const sp of wPsgs) {
            addScore(sp.passage_id, statBoost, "lexical");
          }
          if (item.amending_work_id) {
            for (const ap of passagesByWorkId.get(item.amending_work_id) || []) {
              addScore(ap.passage_id, 12.0, "lexical");
            }
          }
          break;
        }
      }
    }
  }

  // Stage 3: Scoped Vector Candidate Generation (Top 40) when strategy != exact_lexical
  if (strategy !== "exact_lexical") {
    const qVec = computeDeterministicLegalEmbedding(bilingualExpandedQuery);
    const vecSnap = loadVectorProjectionSnapshot(store, params.release_id);
    const vecScored: Array<{ passage_id: string; sim: number }> = [];

    for (const p of candidatePool) {
      const storedVec = vecSnap?.vectors[`vec.${p.passage_id}`]?.values;
      if (!storedVec && candidatePool.length > 1500) continue;
      const pVec =
        storedVec || computeDeterministicLegalEmbedding(`${p.contextualized_header} ${p.exact_text}`);
      const sim = cosineSimilarity(qVec, pVec);
      // Require meaningful similarity (>= 0.24) so unrelated private/random queries abstain cleanly
      if (sim >= 0.24) {
        vecScored.push({ passage_id: p.passage_id, sim });
      }
    }

    vecScored
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 40)
      .forEach((item, rank) => {
        const rrf = 1 / (20 + rank);
        addScore(item.passage_id, item.sim * 2.2 + rrf * 6, "vector");
      });
  }

  // Stage 4: Bounded <=2-hop Graph Expansion (`INTERPRETS`, `CITES`, `HAS_CONDITION`, `HAS_EXCEPTION`, co-interpreted provisions)
  const graphSource = params.graph_source ?? "graph_projection_snapshot";
  const diskGraphSnap =
    graphSource === "graph_projection_snapshot"
      ? loadGraphProjectionSnapshot(store, params.release_id)
      : null;

  const acceptedAssertions: Assertion[] = diskGraphSnap
    ? diskGraphSnap.edges
        .filter(
          (e) =>
            (e.scope === "scope.platform.public" ||
              params.actor.authorized_scopes.includes(e.scope)) &&
            state.assertions[e.assertion_id]?.state === "ACCEPTED" &&
            !state.withdrawals[e.subject]?.active &&
            !state.withdrawals[e.object]?.active
        )
        .map((e) => state.assertions[e.assertion_id])
    : store
        .getAcceptedAssertionsForRelease(params.release_id)
        .filter(
          (a) =>
            a.scope === "scope.platform.public" ||
            params.actor.authorized_scopes.includes(a.scope)
        );

  if (strategy === "hybrid_with_graph" && scoreMap.size > 0) {
    const sortedInitial = Array.from(scoreMap.entries()).sort((a, b) => b[1].score - a[1].score);
    const seedWorkIdList: string[] = [];
    for (const [pid] of sortedInitial) {
      const p = passageById.get(pid);
      if (p && !seedWorkIdList.includes(p.work_id)) {
        seedWorkIdList.push(p.work_id);
        if (seedWorkIdList.length >= 10) break;
      }
    }
    for (const lexTop of lexicalScored.slice(0, 4)) {
      const lp = passageById.get(lexTop.passage_id);
      if (lp && !seedWorkIdList.includes(lp.work_id)) {
        seedWorkIdList.push(lp.work_id);
      }
    }
    const seedWorkIds = new Set(seedWorkIdList);

    // Hop 1: Direct provisions interpreted/cited by seed rulings + sibling passages (requester_facts <-> official_conclusion)
    const hop1ProvisionIds = new Set<string>();
    for (const wid of seedWorkIds) {
      const workPsgs = passagesByWorkId.get(wid) || [];
      let maxRequesterSiblingScore = 0;
      for (const p of workPsgs) {
        if (!p.statement_role.startsWith("requester_")) continue;
        const cur = scoreMap.get(p.passage_id);
        if (cur && !cur.sources.has("exact_id") && cur.score > maxRequesterSiblingScore) {
          maxRequesterSiblingScore = cur.score;
        }
      }
      for (const p of workPsgs) {
        const ownScore = scoreMap.get(p.passage_id)?.score || 0;
        const transferredNeeded =
          p.statement_role === "official_conclusion" && maxRequesterSiblingScore > ownScore
            ? (maxRequesterSiblingScore - ownScore) + 2.2
            : 1.8;
        const siblingBoost =
          p.statement_role === "official_conclusion" ? transferredNeeded : 1.0;
        addScore(p.passage_id, siblingBoost, "graph_hop");
      }
    }

    // Pass 1: Collect rulings interpreting the queried provision, prioritizing direct INTERPRETS on explicitWorkIds over CITES, then lexical/vector overlap!
    const reverseOverlapCandidates: Array<{
      workId: string;
      maxExistingScore: number;
      isDirectInterprets: boolean;
    }> = [];
    const pureInterpretsCandidates: string[] = [];
    const pureCitesCandidates: string[] = [];
    const seenReverseObjects = new Map<string, boolean>();
    for (const asrt of acceptedAssertions) {
      if (
        seedWorkIds.has(asrt.subject) &&
        (asrt.predicate === "INTERPRETS" ||
          asrt.predicate === "CITES" ||
          asrt.predicate === "MADE_UNDER" ||
          asrt.predicate === "AMENDS" ||
          asrt.predicate === "REPEALS" ||
          asrt.predicate === "CONTAINS")
      ) {
        if (!wrongInstrumentSectionWorkIds.has(asrt.object)) {
          hop1ProvisionIds.add(asrt.object);
        }
      }
      if (seedWorkIds.has(asrt.object) && asrt.predicate === "AMENDS") {
        hop1ProvisionIds.add(asrt.subject);
      }
      if (
        seedWorkIds.has(asrt.object) &&
        (asrt.predicate === "INTERPRETS" || asrt.predicate === "CITES")
      ) {
        const directInterp = explicitWorkIds.has(asrt.object) && asrt.predicate === "INTERPRETS";
        const prevDirect = seenReverseObjects.get(asrt.subject);
        if (prevDirect === true || (prevDirect === false && !directInterp)) {
          continue;
        }
        seenReverseObjects.set(asrt.subject, directInterp);
        const subjPassages = passagesByWorkId.get(asrt.subject) || [];
        let maxExisting = 0;
        for (const sp of subjPassages) {
          const cur = scoreMap.get(sp.passage_id)?.score || 0;
          if (cur > maxExisting) maxExisting = cur;
        }
        if (maxExisting > 0) {
          const existingIdx = reverseOverlapCandidates.findIndex((x) => x.workId === asrt.subject);
          if (existingIdx >= 0) {
            reverseOverlapCandidates[existingIdx].isDirectInterprets = directInterp;
          } else {
            reverseOverlapCandidates.push({
              workId: asrt.subject,
              maxExistingScore: maxExisting,
              isDirectInterprets: directInterp,
            });
          }
        } else if (directInterp && pureInterpretsCandidates.length < 16) {
          pureInterpretsCandidates.push(asrt.subject);
        } else if (!directInterp && pureCitesCandidates.length < 16) {
          pureCitesCandidates.push(asrt.subject);
        }
      }
    }
    reverseOverlapCandidates.sort((a, b) => {
      if (a.isDirectInterprets !== b.isDirectInterprets) {
        return a.isDirectInterprets ? -1 : 1;
      }
      return b.maxExistingScore - a.maxExistingScore;
    });
    const isProvisionSurveyQuery =
      /(?:มีหนังสือตอบข้อหารือใด|ข้อหารือใดที่ตีความ|แนววินิจฉัยใดที่ตีความ|มีแนววินิจฉัยใดบ้างที่ตีความ)/.test(
        params.question
      );
    let reverseLexGraphAdded = 0;
    for (const cand of reverseOverlapCandidates.slice(0, 15)) {
      const boost = isProvisionSurveyQuery
        ? cand.isDirectInterprets
          ? 20.0
          : 14.0
        : cand.isDirectInterprets
          ? 3.5
          : 2.0;
      for (const p of passagesByWorkId.get(cand.workId) || []) {
        if (p.statement_role === "official_conclusion" || scoreMap.has(p.passage_id)) {
          addScore(p.passage_id, boost, "graph_hop");
        }
      }
      reverseLexGraphAdded += 1;
    }
    // Pass 2: Also surface representative rulings interpreting the provision when query was pure provision-navigation
    if (isProvisionSurveyQuery || scoreMap.size < 4) {
      for (const subjWorkId of [...pureInterpretsCandidates, ...pureCitesCandidates]) {
        if (reverseLexGraphAdded >= 18) break;
        const isDirectInterp = pureInterpretsCandidates.includes(subjWorkId);
        for (const p of passagesByWorkId.get(subjWorkId) || []) {
          if (p.statement_role === "official_conclusion") {
            addScore(
              p.passage_id,
              isProvisionSurveyQuery ? (isDirectInterp ? 16.5 : 12.5) : isDirectInterp ? 3.0 : 2.0,
              "graph_hop"
            );
            reverseLexGraphAdded += 1;
            break;
          }
        }
      }
    }

    // Add passages of Hop 1 statutory provisions
    for (const provId of hop1ProvisionIds) {
      for (const p of passagesByWorkId.get(provId) || []) {
        addScore(p.passage_id, 2.6, "graph_hop");
      }
    }

    // Hop 2: Other rulings interpreting the exact same statutory provision (surfaces contrary/distinguishing rulings!)
    if (hop1ProvisionIds.size > 0) {
      let hop2Added = 0;
      for (const asrt of acceptedAssertions) {
        if (hop2Added >= 6) break;
        if (asrt.predicate === "INTERPRETS" && hop1ProvisionIds.has(asrt.object) && !seedWorkIds.has(asrt.subject)) {
          for (const p of passagesByWorkId.get(asrt.subject) || []) {
            if (p.statement_role === "official_conclusion") {
              addScore(p.passage_id, 1.4, "graph_hop");
              hop2Added += 1;
              break;
            }
          }
        }
      }
    }
  }

  const queryAsksForRulingOnProvision =
    rulingIds.length === 0 &&
    sectionRefs.length > 0 &&
    /(?:หนังสือตอบข้อหารือใด|ข้อหารือใด|แนววินิจฉัยใด)/.test(params.question);

  // Rerank top 40 with per-(work_id, version_id) diversity cap so a 15-chunk verbatim statute never crowds out interpreting TaxRulings
  const sortedCandidates: RankedPassageHit[] = Array.from(scoreMap.entries())
    .map(([pid, entry]) => {
      const psg = passageById.get(pid)!;
      const ver = state.versions[psg.version_id];
      const work = state.works[psg.work_id];
      // Boost official_conclusion and statutory_text slightly over requester_facts during final rerank
      let roleMult = 1.0;
      if (psg.statement_role === "official_conclusion" || psg.statement_role === "statutory_text") {
        roleMult = 1.12;
      }
      if (
        queryAsksForRulingOnProvision &&
        work?.type === "TaxRuling" &&
        psg.statement_role === "official_conclusion" &&
        entry.sources.has("graph_hop")
      ) {
        roleMult *= 2.65;
      }
      // Prevent same-numbered section from a DIFFERENT Act or year-excluded homonym ruling from contaminating lookup
      if (wrongInstrumentSectionWorkIds.has(psg.work_id) || excludedHomonymWorkIds.has(psg.work_id)) {
        roleMult *= 0.02;
      }
      // Prevent un-enacted draft bills / committee reports from ranking as governing law unless explicitly queried (B02-U06)
      if (
        !queryAsksAboutDraft &&
        (ver?.draft_or_enacted_status === "DRAFT_BILL" ||
          ver?.draft_or_enacted_status === "LEGISLATIVE_HISTORY")
      ) {
        roleMult *= 0.2;
      }
      // Demote superseded pre-amendment case-specific TaxRulings when a controlling post-amendment statute governs
      if (
        params.demote_rulings_before_iso &&
        work?.type === "TaxRuling" &&
        !explicitWorkIds.has(psg.work_id) &&
        ver?.decision_date &&
        ver.decision_date < params.demote_rulings_before_iso
      ) {
        roleMult *= 0.18;
      }
      return {
        passage: psg,
        score: Number((entry.score * roleMult).toFixed(4)),
        match_sources: Array.from(entry.sources),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 48);

  const primarySelected: RankedPassageHit[] = [];
  const overflowSelected: RankedPassageHit[] = [];
  const countByWorkVer = new Map<string, number>();
  for (const hit of sortedCandidates) {
    const key = `${hit.passage.work_id}::${hit.passage.version_id}`;
    const c = countByWorkVer.get(key) || 0;
    const hitWork = state.works[hit.passage.work_id];
    const perWorkCap =
      (hitWork?.type === "Provision" || hitWork?.type === "ProvisionVersion") &&
      qTokens.length > 8 &&
      rulingIds.length === 0
        ? 2
        : 4;
    if (c < perWorkCap) {
      primarySelected.push(hit);
      countByWorkVer.set(key, c + 1);
    } else {
      overflowSelected.push(hit);
    }
  }
  const rankedHits: RankedPassageHit[] = [...primarySelected, ...overflowSelected].slice(0, maxPassages);

  const selectedWorkIds = new Set(rankedHits.map((h) => h.passage.work_id));
  const matchedAssertions = acceptedAssertions.filter(
    (a) => selectedWorkIds.has(a.subject) || selectedWorkIds.has(a.object)
  );

  const evidenceCards: EvidenceCard[] = rankedHits.map((hit) => {
    const p = hit.passage;
    const work = state.works[p.work_id];
    const ver = state.versions[p.version_id];
    const art = state.artifacts[p.real_locator.artifact_id];

    const relatedProvisions = acceptedAssertions
      .filter(
        (a) =>
          a.subject === p.work_id &&
          (a.predicate === "INTERPRETS" ||
            a.predicate === "CITES" ||
            a.predicate === "MADE_UNDER" ||
            a.predicate === "AMENDS" ||
            a.predicate === "REPEALS" ||
            a.predicate === "ISSUED_BY")
      )
      .map((a) => {
        const targetWork = state.works[a.object];
        return {
          work_id: a.object,
          label: targetWork?.title_th || a.object,
          predicate: a.predicate,
          resolved: Boolean(targetWork || a.object_type === "Agency"),
        };
      });

    return {
      passage_id: p.passage_id,
      work_id: p.work_id,
      version_id: p.version_id,
      official_identifier:
        work?.official_identifiers[0]?.normalized || work?.title_th || p.work_id,
      title_th: work?.title_th || p.contextualized_header,
      authority_type: work?.type || "TaxRuling",
      authenticity_status: art?.authenticity_status || "verified_corpus_mirror",
      is_derivative: Boolean(art?.is_derivative),
      statement_role: p.statement_role,
      issue_or_effective_date:
        ver?.decision_date || ver?.publication_date || ver?.legal_applicability?.[0]?.valid_from || null,
      raw_date_text: ver?.raw_date_text || null,
      exact_excerpt: p.exact_text,
      locator: p.real_locator,
      related_provisions: relatedProvisions,
    };
  });

  return {
    release_id: params.release_id,
    strategy,
    explicit_ruling_ids_in_query: rulingIds,
    resolved_explicit_ruling_ids: resolvedExplicitRulingIds,
    explicit_section_refs_in_query: sectionRefs,
    explicit_instrument_hints_in_query: instrumentHints,
    unresolved_explicit_ruling_ids: unresolvedExplicitRulingIds,
    year_mismatched_ruling_lookups: yearMismatchedRulingLookups,
    homonym_ruling_groups: homonymRulingGroups,
    top_hits: rankedHits,
    evidence_cards: evidenceCards,
    matched_assertions: matchedAssertions,
  };
}
