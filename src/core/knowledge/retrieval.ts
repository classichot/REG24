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

  // If the user explicitly asked for a specific ruling number by ID, allow retrieving it so we can display its date warning
  if (explicitlyQueriedWorkIds.has(passage.work_id)) {
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
  const rawRulings =
    arabic.match(/กค\s*[0-9]{4}(?:\([^)]+\))?\s*\/\s*(?:พ\.\s*)?[0-9]+/g) || [];
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
  const unresolvedExplicitRulingIds: string[] = [];

  for (const rId of rulingIds) {
    const matchedWorks = Object.values(state.works).filter(
      (w) =>
        authorizedWorkIds.has(w.work_id) &&
        w.official_identifiers.some((oid) => oid.normalized === rId)
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
      if (
        w.official_identifiers.some(
          (oid) => oid.normalized === sRef || oid.normalized === normBase
        ) ||
        w.title_th.includes(normBase)
      ) {
        explicitWorkIds.add(w.work_id);
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

  // Stage 1: Exact identifier & comparison work boost
  for (const p of candidatePool) {
    if (explicitWorkIds.has(p.work_id)) {
      const roleBoost = p.statement_role === "official_conclusion" || p.statement_role === "statutory_text" ? 12.0 : 9.0;
      addScore(p.passage_id, roleBoost, "exact_id");
    }
  }

  // Stage 2: Scoped Lexical Candidate Generation (Top 40)
  const qTokens = tokenizeThaiLegalForIndex(params.question);
  const lexicalScored: Array<{ passage_id: string; lexScore: number }> = [];

  if (qTokens.length > 0) {
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
    for (const p of candidatePool) {
      if (seedWorkIds.has(p.work_id)) {
        addScore(
          p.passage_id,
          p.statement_role === "official_conclusion" ? 1.8 : 1.0,
          "graph_hop"
        );
      }
    }

    for (const asrt of acceptedAssertions) {
      if (seedWorkIds.has(asrt.subject) && (asrt.predicate === "INTERPRETS" || asrt.predicate === "CITES")) {
        hop1ProvisionIds.add(asrt.object);
      }
      if (seedWorkIds.has(asrt.object) && (asrt.predicate === "INTERPRETS" || asrt.predicate === "CITES")) {
        // Query hit a ProvisionVersion -> pull rulings that INTERPRET that provision!
        for (const p of candidatePool) {
          if (p.work_id === asrt.subject) {
            addScore(p.passage_id, 3.2, "graph_hop");
          }
        }
      }
    }

    // Add passages of Hop 1 statutory provisions
    for (const p of candidatePool) {
      if (hop1ProvisionIds.has(p.work_id)) {
        addScore(p.passage_id, 2.6, "graph_hop");
      }
    }

    // Hop 2: Other rulings interpreting the exact same statutory provision (surfaces contrary/distinguishing rulings!)
    if (hop1ProvisionIds.size > 0) {
      const hop2RulingIds = new Set<string>();
      for (const asrt of acceptedAssertions) {
        if (asrt.predicate === "INTERPRETS" && hop1ProvisionIds.has(asrt.object) && !seedWorkIds.has(asrt.subject)) {
          hop2RulingIds.add(asrt.subject);
        }
      }
      let hop2Added = 0;
      for (const p of candidatePool) {
        if (hop2Added >= 6) break;
        if (hop2RulingIds.has(p.work_id) && p.statement_role === "official_conclusion") {
          addScore(p.passage_id, 1.4, "graph_hop");
          hop2Added += 1;
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
