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
  thaiDigitsToArabic,
} from "./identity";
import {
  computeDeterministicLegalEmbedding,
  cosineSimilarity,
  loadLexicalProjectionSnapshot,
  loadVectorProjectionSnapshot,
  tokenizeThaiLegalForIndex,
} from "./projections";
import type { Actor, Assertion, EvidenceCard, Passage } from "./contracts";
import type { CanonicalPersistedState, DurableKnowledgeStore } from "./store";

export type RetrievalStrategy = "exact_lexical" | "hybrid_no_graph" | "hybrid_with_graph";

export interface RankedPassageHit {
  passage: Passage;
  score: number;
  match_sources: Array<"exact_id" | "lexical" | "vector" | "graph_hop">;
}

export interface RetrievalBundle {
  release_id: string;
  strategy: RetrievalStrategy;
  explicit_ruling_ids_in_query: string[];
  explicit_section_refs_in_query: string[];
  unresolved_explicit_ruling_ids: string[];
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
  // for statutory Provisions (`prov.th.rc.65_ตรี`), ALWAYS enforce `legal_applicability` intervals (`v1_pre2019` vs `v2_current`)!
  if (explicitlyQueriedWorkIds.has(passage.work_id) && work?.type === "TaxRuling") {
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
} {
  const arabic = thaiDigitsToArabic(question);
  // Match both 'กค 0702/636' and historical 4-digit RD bureau codes like '0811(กม)/806' or 'กค 0706/พ./1234'
  const rawRulings =
    arabic.match(
      /(?:กค\s*[0-9]{4}|0[0-9]{3})(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮA-Za-z.]+\s*\/?\s*)?[0-9]+/g
    ) || [];
  const rulingIds = [...new Set(rawRulings.map((r) => normalizeOfficialRulingIdentifier(r)))];

  const rawSecs =
    arabic.match(
      /มาตรา\s*[0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?(?:\s*\([0-9ก-ฮ]+\))*/g
    ) || [];
  const sectionRefs = [...new Set(rawSecs.map((s) => normalizeThaiLegalSectionRef(s)))];

  return { rulingIds, sectionRefs };
}

export function retrieveAuthorizedKnowledge(
  store: DurableKnowledgeStore,
  params: {
    question: string;
    release_id: string;
    actor: Actor;
    applicable_date?: string | null;
    comparison_work_ids?: string[];
    strategy?: RetrievalStrategy;
    max_passages?: number;
  }
): RetrievalBundle {
  const strategy = params.strategy || "hybrid_with_graph";
  const maxPassages = params.max_passages ?? 12;
  const state = store.getState();

  const { rulingIds, sectionRefs } = extractExplicitIdentifiersFromQuery(params.question);

  // Map explicit ruling IDs to canonical works in scope
  const allAuthorizedPassages = store
    .getPassagesForRelease(params.release_id)
    .filter((p) => isPassageCurrentlyAuthorizedAndActive(state, p, params.actor));

  const authorizedWorkIds = new Set(allAuthorizedPassages.map((p) => p.work_id));

  const explicitWorkIds = new Set<string>(params.comparison_work_ids || []);
  const secondarySectionWorkIds = new Set<string>();
  const unresolvedExplicitRulingIds: string[] = [];

  for (const rId of rulingIds) {
    const rIdWithPrefix = rId.startsWith("กค ") ? rId : `กค ${rId}`;
    const rIdWithoutPrefix = rId.replace(/^กค\s+/, "");
    const matchedWorks = Object.values(state.works).filter(
      (w) =>
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
    } else {
      for (const mw of matchedWorks) explicitWorkIds.add(mw.work_id);
    }
  }

  for (const sRef of sectionRefs) {
    const baseMatch = sRef.match(
      /^มาตรา\s*([0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?)/
    );
    const normBase = baseMatch ? `มาตรา ${baseMatch[1].replace(/\s+/g, " ").trim()}` : sRef;
    for (const w of Object.values(state.works)) {
      if (!authorizedWorkIds.has(w.work_id)) continue;
      if (w.type !== "Provision" && w.type !== "ProvisionVersion" && w.type !== "Statute") {
        continue;
      }
      if (w.official_identifiers.some((oid) => oid.normalized === sRef)) {
        explicitWorkIds.add(w.work_id);
      } else if (
        normBase !== sRef &&
        w.official_identifiers.some((oid) => oid.normalized === normBase)
      ) {
        secondarySectionWorkIds.add(w.work_id);
      }
    }
  }

  // Filter passages by temporal applicability (AT05, AT13)
  let candidatePool = allAuthorizedPassages.filter((p) =>
    isVersionApplicableOnDate(state, p, params.applicable_date, explicitWorkIds)
  );
  // Fallback if applicable_date filtered out rulings whose ruling issue_date is in BE 2569 while querying general tax rules without explicit historical statute conflict
  if (candidatePool.length === 0 && params.applicable_date && sectionRefs.length === 0) {
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
  for (const wid of explicitWorkIds) {
    for (const p of passagesByWorkId.get(wid) || []) {
      const roleBoost = p.statement_role === "official_conclusion" || p.statement_role === "statutory_text" ? 40.0 : 32.0;
      addScore(p.passage_id, roleBoost, "exact_id");
    }
  }
  for (const wid of secondarySectionWorkIds) {
    if (explicitWorkIds.has(wid)) continue;
    for (const p of passagesByWorkId.get(wid) || []) {
      addScore(p.passage_id, 24.0, "exact_id");
    }
  }

  // Stage 2: Scoped Lexical Candidate Generation (Top 40)
  const qTokens = tokenizeThaiLegalForIndex(params.question);
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
      // Refine top 250 IDF candidates with exact substring & header phrase matching
      const preTop = Array.from(hitAccum.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 250);
      const qClean = thaiDigitsToArabic(params.question).toLowerCase().trim();
      for (const [pid, idfHits] of preTop) {
        const p = passageById.get(pid)!;
        const hdrNorm = thaiDigitsToArabic(p.contextualized_header).toLowerCase();
        const bodyNorm = thaiDigitsToArabic(p.exact_text).toLowerCase();
        let exactBonus = 0;
        for (const qt of qTokens) {
          if (qt.length >= 5 && (hdrNorm.includes(qt) || bodyNorm.includes(qt))) {
            exactBonus += hdrNorm.includes(qt) ? 1.8 : 0.9;
          }
        }
        // Boost when full subject title inside contextualized_header appears in the question
        const subjPart = hdrNorm.split("|").pop()?.trim() || "";
        if (subjPart.length >= 6 && qClean.includes(subjPart)) {
          exactBonus += 8.0;
        }
        // Normalize IDF-weighted score onto the calibrated [0, 4.0] lexical scale so Stage 1 & Stage 4 remain balanced
        const normalizedLex = Math.min(4.0, (idfHits + exactBonus) / (denom * 4.5));
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

  // Stage 3: Scoped Vector Candidate Generation (Top 40) when strategy != exact_lexical
  if (strategy !== "exact_lexical") {
    const qVec = computeDeterministicLegalEmbedding(params.question);
    const vecSnap = loadVectorProjectionSnapshot(store, params.release_id);
    const vecScored: Array<{ passage_id: string; sim: number }> = [];

    for (const p of candidatePool) {
      const storedVec = vecSnap?.vectors[`vec.${p.passage_id}`]?.values;
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
  const acceptedAssertions = store
    .getAcceptedAssertionsForRelease(params.release_id)
    .filter((a) => a.scope === "scope.platform.public" || params.actor.authorized_scopes.includes(a.scope));

  if (strategy === "hybrid_with_graph" && scoreMap.size > 0) {
    const seedTopPassages = Array.from(scoreMap.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 8)
      .map(([pid]) => passageById.get(pid)!)
      .filter(Boolean);

    const seedWorkIds = new Set(seedTopPassages.map((p) => p.work_id));

    // Hop 1: Direct provisions interpreted/cited by seed rulings + sibling passages (requester_facts <-> official_conclusion)
    const hop1ProvisionIds = new Set<string>();
    for (const wid of seedWorkIds) {
      for (const p of passagesByWorkId.get(wid) || []) {
        addScore(
          p.passage_id,
          p.statement_role === "official_conclusion" ? 1.8 : 1.0,
          "graph_hop"
        );
      }
    }

    // Pass 1: Collect rulings interpreting the queried provision, sort by highest lexical/vector fact overlap descending, then boost top 15!
    const reverseOverlapCandidates: Array<{ workId: string; maxExistingScore: number }> = [];
    const pureGraphCandidates: string[] = [];
    const seenReverseSubjects = new Set<string>();
    for (const asrt of acceptedAssertions) {
      if (seedWorkIds.has(asrt.subject) && (asrt.predicate === "INTERPRETS" || asrt.predicate === "CITES")) {
        hop1ProvisionIds.add(asrt.object);
      }
      if (
        seedWorkIds.has(asrt.object) &&
        (asrt.predicate === "INTERPRETS" || asrt.predicate === "CITES") &&
        !seenReverseSubjects.has(asrt.subject)
      ) {
        seenReverseSubjects.add(asrt.subject);
        const subjPassages = passagesByWorkId.get(asrt.subject) || [];
        let maxExisting = 0;
        for (const sp of subjPassages) {
          const cur = scoreMap.get(sp.passage_id)?.score || 0;
          if (cur > maxExisting) maxExisting = cur;
        }
        if (maxExisting > 0) {
          reverseOverlapCandidates.push({ workId: asrt.subject, maxExistingScore: maxExisting });
        } else if (pureGraphCandidates.length < 16) {
          pureGraphCandidates.push(asrt.subject);
        }
      }
    }
    reverseOverlapCandidates.sort((a, b) => b.maxExistingScore - a.maxExistingScore);
    let reverseLexGraphAdded = 0;
    for (const cand of reverseOverlapCandidates.slice(0, 15)) {
      for (const p of passagesByWorkId.get(cand.workId) || []) {
        if (p.statement_role === "official_conclusion" || scoreMap.has(p.passage_id)) {
          addScore(p.passage_id, 18.0, "graph_hop");
        }
      }
      reverseLexGraphAdded += 1;
    }
    // Pass 2: Also surface representative rulings interpreting the provision when query was pure provision-navigation
    for (const subjWorkId of pureGraphCandidates) {
      if (reverseLexGraphAdded >= 18) break;
      for (const p of passagesByWorkId.get(subjWorkId) || []) {
        if (p.statement_role === "official_conclusion") {
          addScore(p.passage_id, 14.5, "graph_hop");
          reverseLexGraphAdded += 1;
          break;
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

  // Rerank top 30 -> return top `maxPassages`
  const rankedHits: RankedPassageHit[] = Array.from(scoreMap.entries())
    .map(([pid, entry]) => {
      const psg = passageById.get(pid)!;
      // Boost official_conclusion and statutory_text slightly over requester_facts during final rerank
      let roleMult = 1.0;
      if (psg.statement_role === "official_conclusion" || psg.statement_role === "statutory_text") {
        roleMult = 1.12;
      }
      return {
        passage: psg,
        score: Number((entry.score * roleMult).toFixed(4)),
        match_sources: Array.from(entry.sources),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .slice(0, maxPassages);

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
          (a.predicate === "INTERPRETS" || a.predicate === "CITES")
      )
      .map((a) => {
        const targetWork = state.works[a.object];
        return {
          work_id: a.object,
          label: targetWork?.title_th || a.object,
          predicate: a.predicate,
          resolved: Boolean(targetWork),
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
      exact_excerpt: p.exact_text,
      locator: p.real_locator,
      related_provisions: relatedProvisions,
    };
  });

  return {
    release_id: params.release_id,
    strategy,
    explicit_ruling_ids_in_query: rulingIds,
    explicit_section_refs_in_query: sectionRefs,
    unresolved_explicit_ruling_ids: unresolvedExplicitRulingIds,
    top_hits: rankedHits,
    evidence_cards: evidenceCards,
    matched_assertions: matchedAssertions,
  };
}
