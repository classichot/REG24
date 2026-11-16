/**
 * REG24 — Task F5: Grounded Legal Answering, Claim Ledger, Comparison & Missing-Fact Abstention Engine
 *
 * Implements:
 * - SH-12, SH-14, SH-16
 * - AT05, AT08, AT11, AT12, AT13
 * - B01-U01 .. B01-U10
 */

import { verifyClaimAgainstPassages } from "./answer-verification";
import { isPassageCurrentlyAuthorizedAndActive } from "./evidence";
import { sha256Bytes, thaiDigitsToArabic } from "./identity";
import { retrieveAuthorizedKnowledge, type RetrievalStrategy } from "./retrieval";
import { getDefaultKnowledgeStore, type DurableKnowledgeStore } from "./store";
import type {
  Actor,
  AnswerStatus,
  Assertion,
  ClaimLedgerItem,
  EvidenceCard,
  GroundedAnswer,
  Passage,
  QueryRequest,
} from "./contracts";

function extractPassageUnitIndex(p: Passage): number {
  const lastSeg = p.structural_path[p.structural_path.length - 1] || "";
  const m = lastSeg.match(/Unit\s+(\d+)/i);
  if (m) return Number(m[1]);
  if (p.real_locator.kind === "text_byte_offset") return p.real_locator.byte_start ?? 0;
  return 0;
}

function reassembleOrderedSectionUnits(
  seed: Passage,
  releasePassages: Passage[],
  freshState: ReturnType<DurableKnowledgeStore["getState"]>,
  actor: Actor
): Passage[] {
  const sectionPrefix = seed.structural_path.slice(0, -1).join(" > ");
  const units = releasePassages
    .filter(
      (p) =>
        p.work_id === seed.work_id &&
        p.version_id === seed.version_id &&
        p.extraction_id === seed.extraction_id &&
        p.statement_role === seed.statement_role &&
        p.structural_path.slice(0, -1).join(" > ") === sectionPrefix &&
        isPassageCurrentlyAuthorizedAndActive(freshState, p, actor)
    )
    .sort(
      (a, b) =>
        extractPassageUnitIndex(a) - extractPassageUnitIndex(b) ||
        a.passage_id.localeCompare(b.passage_id)
    );
  return units.length > 0 ? units : [seed];
}

function findOrderedRequesterUnitsForWork(
  seedOfficial: Passage,
  releasePassages: Passage[],
  freshState: ReturnType<DurableKnowledgeStore["getState"]>,
  actor: Actor
): Passage[] {
  return releasePassages
    .filter(
      (p) =>
        p.work_id === seedOfficial.work_id &&
        p.version_id === seedOfficial.version_id &&
        p.extraction_id === seedOfficial.extraction_id &&
        p.statement_role.startsWith("requester_") &&
        isPassageCurrentlyAuthorizedAndActive(freshState, p, actor)
    )
    .sort(
      (a, b) =>
        extractPassageUnitIndex(a) - extractPassageUnitIndex(b) ||
        a.passage_id.localeCompare(b.passage_id)
    );
}

function ensureEvidenceCardsForPassages(
  passagesToEnsure: Passage[],
  liveEvidenceCards: EvidenceCard[],
  freshState: ReturnType<DurableKnowledgeStore["getState"]>,
  acceptedAssertions: Assertion[]
): void {
  const existingIds = new Set(liveEvidenceCards.map((ec) => ec.passage_id));
  for (const p of passagesToEnsure) {
    if (existingIds.has(p.passage_id)) continue;
    existingIds.add(p.passage_id);
    const work = freshState.works[p.work_id];
    const ver = freshState.versions[p.version_id];
    const art = freshState.artifacts[p.real_locator.artifact_id];
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
        const targetWork = freshState.works[a.object];
        return {
          work_id: a.object,
          label: targetWork?.title_th || a.object,
          predicate: a.predicate,
          resolved: Boolean(targetWork || a.object_type === "Agency"),
        };
      });
    liveEvidenceCards.push({
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
    });
  }
}

function detectMissingFactSignals(question: string): string[] {
  const questions: string[] = [];
  const unknownMatches =
    question.match(/(?:โดยไม่ทราบว่า|ยังไม่ทราบว่า|ไม่ทราบข้อเท็จจริงว่า|ไม่ระบุว่า|ไม่มีข้อมูลว่า)([^?。\n]+)/g) ||
    [];
  for (const m of unknownMatches) {
    const cleaned = m
      .replace(/^(?:โดยไม่ทราบว่า|ยังไม่ทราบว่า|ไม่ทราบข้อเท็จจริงว่า|ไม่ระบุว่า|ไม่มีข้อมูลว่า)\s*/, "")
      .trim();
    if (cleaned) {
      questions.push(`กรุณายืนยันข้อเท็จจริงสำคัญ: ${cleaned}`);
    }
  }
  return questions;
}

const AGENCY_LABELS_TH: Record<string, string> = {
  "reg.th.parliament": "รัฐสภา / ฝ่ายนิติบัญญัติ (reg.th.parliament)",
  "reg.th.cabinet": "คณะรัฐมนตรี / ฝ่ายบริหาร (reg.th.cabinet)",
  "reg.th.mof": "กระทรวงการคลัง (reg.th.mof)",
  "reg.th.rd": "กรมสรรพากร (reg.th.rd)",
  "reg.th.customs": "กรมศุลกากร (reg.th.customs)",
  "reg.th.excise": "กรมสรรพสามิต (reg.th.excise)",
  "reg.th.ocs": "สำนักงานคณะกรรมการกฤษฎีกา (reg.th.ocs)",
  "reg.th.opm": "สำนักนายกรัฐมนตรี (reg.th.opm)",
  "reg.th.moi": "กระทรวงมหาดไทย (reg.th.moi)",
};

export async function queryKnowledge(
  req: QueryRequest,
  actor: Actor,
  options?: {
    store?: DurableKnowledgeStore;
    retrievalStrategy?: RetrievalStrategy;
  }
): Promise<GroundedAnswer> {
  const startedAt = Date.now();
  const store = options?.store || getDefaultKnowledgeStore();
  const state = store.getState();

  const fallbackCandidateRel = Object.values(state.releases)
    .filter(
      (r) =>
        r.state === "READY_FOR_UAT" ||
        r.state === "ACCEPTED" ||
        r.state === "ACCEPTED_WITH_DECLARED_GAPS"
    )
    .sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) ||
        b.release_id.localeCompare(a.release_id)
    )[0]?.release_id;

  const releaseId = req.release_id || state.active_release_id || fallbackCandidateRel || "rel.B01.rc1";
  const releaseRec = state.releases[releaseId];
  const snapshotAt = releaseRec?.updated_at || new Date().toISOString();
  const traceId = `trc.${sha256Bytes(`${releaseId}:${actor.actor_id}:${req.question}:${startedAt}`).slice(0, 14)}`;

  const bundle = retrieveAuthorizedKnowledge(store, {
    question: req.question,
    release_id: releaseId,
    actor,
    applicable_date: req.applicable_date ?? null,
    comparison_work_ids: req.comparison_work_ids,
    strategy: options?.retrievalStrategy || "hybrid_with_graph",
  });

  const coverageWarnings: string[] = [...(releaseRec?.coverage_gaps || [])];

  // 1. Explicit nonexistent official ruling identifier -> Immediate clean abstention (AT12a, B01-U10)
  if (
    bundle.unresolved_explicit_ruling_ids.length > 0 &&
    (req.mode === "exact_lookup" ||
      bundle.unresolved_explicit_ruling_ids.length === bundle.explicit_ruling_ids_in_query.length)
  ) {
    const missingLabel = bundle.unresolved_explicit_ruling_ids.join(", ");
    const abstentionText = `ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่ ${missingLabel} ในคลังข้อมูลที่ผ่านการรับรองของ REG24 (${releaseId}) ระบบจึงระงับการสรุปข้อกฎหมายและไม่สร้างเลขที่เอกสารหรือแนววินิจฉัยขึ้นเอง`;
    return {
      release_id: releaseId,
      knowledge_snapshot_at: snapshotAt,
      status: "INSUFFICIENT_EVIDENCE",
      answer: abstentionText,
      claims: [
        {
          claim_id: `clm.${traceId}.abstain`,
          statement: abstentionText,
          claim_type: "abstention_notice",
          statement_role: "reg24_inference",
          supporting_passage_ids: [],
          applicable_version_id: null,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
        },
      ],
      evidence: [],
      assumptions: [],
      clarification_questions: [
        `กรุณาตรวจสอบเลขที่หนังสือตอบข้อหารือ (${missingLabel}) หรือวันที่ออกหนังสืออีกครั้ง`,
      ],
      coverage_warnings: coverageWarnings,
      applicable_date: req.applicable_date ?? null,
      model_policy_version: "reg24-grounded-legal-v1.1",
      trace_id: traceId,
      latency_ms: Math.max(1, Date.now() - startedAt),
    };
  }

  // 1b. Out-of-scope non-RD legal domain & quarantined external statute guard (Trial Scope Control)
  const qArabic = thaiDigitsToArabic(req.question);
  const hasTaxContext =
    /ภาษี|อากรแสตมป์|รัษฎากร|สรรพากร|หัก\s*ณ\s*ที่จ่าย|ภ\.ง\.ด\.|ภ\.พ\.|กค\s*\d|0\d{3}\s*\/|เครดิตภาษี|มูลค่าเพิ่ม|นิติบุคคล|บุคคลธรรมดา|ธุรกิจเฉพาะ/i.test(
      qArabic
    );
  const outOfScopeLawMatch = qArabic.match(
    /(พระราชบัญญัติคุ้มครองแรงงาน|กฎหมายแรงงาน|ประมวลกฎหมายอาญา|ประมวลกฎหมายวิธีพิจารณาความ(?:แพ่ง|อาญา)?|คำพิพากษาศาลฎีกา|พระราชบัญญัติประกันสังคม|พระราชบัญญัติล้มละลาย|พระราชบัญญัติศุลกากร|พิกัดอัตราศุลกากร)/
  );
  if (releaseId.startsWith("rel.B01.") && outOfScopeLawMatch && !hasTaxContext) {
    const uncoveredDomain = outOfScopeLawMatch[1];
    const scopeMsg = `ประเด็นคำถามเกี่ยวกับ "${uncoveredDomain}" อยู่นอกขอบเขตคลังข้อมูลที่ผ่านการรับรองในชุดทดลองใช้งานปัจจุบัน (${releaseId}: ครอบคลุมหนังสือตอบข้อหารือกรมสรรพากร 4,578 รายการ ประมวลรัษฎากร และกฎหมายลำดับรองของกรมสรรพากรที่ตรวจสอบต้นฉบับแล้วเท่านั้น) ระบบจึงระงับการตอบและไม่คาดเดาข้อกฎหมายนอกขอบเขต`;
    return {
      release_id: releaseId,
      knowledge_snapshot_at: snapshotAt,
      status: "INSUFFICIENT_EVIDENCE",
      answer: scopeMsg,
      claims: [
        {
          claim_id: `clm.${traceId}.out_of_scope`,
          statement: scopeMsg,
          claim_type: "abstention_notice",
          statement_role: "reg24_inference",
          supporting_passage_ids: [],
          applicable_version_id: null,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
        },
      ],
      evidence: [],
      assumptions: [],
      clarification_questions: [
        "หากต้องการถามภาระภาษีอากรตามประมวลรัษฎากรที่เกี่ยวข้องกับธุรกรรมนี้ กรุณาระบุประเด็นภาษีที่ต้องการตรวจสอบเพิ่มเติม",
      ],
      coverage_warnings: [...coverageWarnings, scopeMsg],
      applicable_date: req.applicable_date ?? null,
      model_policy_version: "reg24-grounded-legal-v1.1",
      trace_id: traceId,
      latency_ms: Math.max(1, Date.now() - startedAt),
    };
  }

  // Direct lookup of a quarantined Royal Decree's statutory text when no ruling is requested
  const directRdMatch = qArabic.match(/พระราชกฤษฎีกา[^0-9]{0,40}ฉบับที่\s*(\d+)/);
  if (
    directRdMatch &&
    bundle.explicit_ruling_ids_in_query.length === 0 &&
    !/ข้อหารือ|หนังสือตอบ|แนววินิจฉัย/.test(qArabic)
  ) {
    const rdNum = directRdMatch[1];
    const rdNumPattern = new RegExp(`ฉบับที่\\s*${rdNum}(?:\\D|$)`);
    const releasePassages = store.getPassagesForRelease(releaseId);
    const hasVerifiedRdWork = releasePassages.some((p) => {
      if (p.extraction_id.startsWith("ext.dep.")) return false;
      const w = state.works[p.work_id];
      if (!w) return false;
      return (
        w.work_id === `subreg.th.rc.royal_decree.${rdNum}` ||
        w.work_id === `subreg.th.rc.royal_decree_${rdNum}` ||
        (w.type === "SubordinateLegislation" &&
          w.title_th.includes("พระราชกฤษฎีกา") &&
          rdNumPattern.test(thaiDigitsToArabic(w.title_th)))
      );
    });
    if (!hasVerifiedRdWork) {
      const isQuarantinedRd = Object.values(state.unresolved_references).some(
        (u) =>
          rdNumPattern.test(thaiDigitsToArabic(u.raw_citation_text)) ||
          rdNumPattern.test(thaiDigitsToArabic(u.governing_instrument || "")) ||
          u.target_hint.endsWith(`.${rdNum}`) ||
          u.target_hint.endsWith(`_${rdNum}`)
      );
      const quarMsg = isQuarantinedRd
        ? `พระราชกฤษฎีกาฯ (ฉบับที่ ${rdNum}) ยังอยู่ในทะเบียนกักกันแหล่งอ้างอิงภายนอกที่รอการตรวจรับรองต้นฉบับ (usable_as_legal_evidence: false) ในชุดข้อมูล ${releaseId} ระบบจึงไม่สรุปหรือคาดเดาตัวบทมาตราของพระราชกฤษฎีกาฉบับดังกล่าวโดยไม่มีต้นฉบับที่ผ่านการรับรอง`
        : `ไม่พบตัวบทพระราชกฤษฎีกาฯ (ฉบับที่ ${rdNum}) ที่ผ่านการตรวจรับรองต้นฉบับในคลังข้อมูลชุด ${releaseId} ระบบจึงระงับการตอบและไม่คาดเดาตัวบทกฎหมาย`;
      return {
        release_id: releaseId,
        knowledge_snapshot_at: snapshotAt,
        status: "INSUFFICIENT_EVIDENCE",
        answer: quarMsg,
        claims: [
          {
            claim_id: `clm.${traceId}.quarantined_statute`,
            statement: quarMsg,
            claim_type: "abstention_notice",
            statement_role: "reg24_inference",
            supporting_passage_ids: [],
            applicable_version_id: null,
            factual_conditions: [],
            exceptions: [],
            counterevidence_passage_ids: [],
            verification_result: "VERIFIED",
          },
        ],
        evidence: [],
        assumptions: [],
        clarification_questions: [
          `หากต้องการดูแนววินิจฉัยหนังสือตอบข้อหารือกรมสรรพากรที่กล่าวถึงพระราชกฤษฎีกา (ฉบับที่ ${rdNum}) กรุณาระบุเลขที่หนังสือตอบข้อหารือหรือถามแนววินิจฉัยของกรมสรรพากรโดยตรง`,
        ],
        coverage_warnings: [...coverageWarnings, quarMsg],
        applicable_date: req.applicable_date ?? null,
        model_policy_version: "reg24-grounded-legal-v1.1",
        trace_id: traceId,
        latency_ms: Math.max(1, Date.now() - startedAt),
      };
    }
  }

  // 2. Final pre-delivery live authorization/withdrawal recheck (SH-16, AT08)
  const freshState = store.getState();
  let liveVerifiedHits = bundle.top_hits.filter((h) =>
    isPassageCurrentlyAuthorizedAndActive(freshState, h.passage, actor)
  );
  // In exact_lookup mode with an explicit ruling identifier OR explicit Act+Section lookup, scope citations strictly (B01-U01, B02-U01)
  if (
    req.mode === "exact_lookup" &&
    (bundle.explicit_ruling_ids_in_query.length > 0 ||
      (bundle.explicit_section_refs_in_query.length > 0 &&
        (bundle.explicit_instrument_hints_in_query?.length || 0) > 0))
  ) {
    const exactScoped = liveVerifiedHits.filter(
      (h) =>
        h.match_sources.includes("exact_id") ||
        (bundle.explicit_ruling_ids_in_query.length > 0 &&
          h.match_sources.includes("graph_hop") &&
          (freshState.works[h.passage.work_id]?.type === "Provision" ||
            freshState.works[h.passage.work_id]?.type === "ProvisionVersion"))
    );
    if (exactScoped.length > 0) {
      liveVerifiedHits = exactScoped;
    }
  }
  const liveEvidenceCards = bundle.evidence_cards.filter((ec) =>
    liveVerifiedHits.some((h) => h.passage.passage_id === ec.passage_id)
  );

  // 3. Insufficient evidence gate when no relevant authorized passage is found
  if (liveVerifiedHits.length === 0 || liveVerifiedHits[0].score < 1.15) {
    const msg =
      "ไม่พบหลักฐานข้อกฎหมายหรือหนังสือตอบข้อหารือที่ได้รับอนุญาตและตรงกับประเด็นคำถามอย่างเพียงพอในคลังข้อมูลชุดปัจจุบัน ระบบจึงไม่คาดเดาคำตอบทางภาษี";
    return {
      release_id: releaseId,
      knowledge_snapshot_at: snapshotAt,
      status: "INSUFFICIENT_EVIDENCE",
      answer: msg,
      claims: [
        {
          claim_id: `clm.${traceId}.insufficient`,
          statement: msg,
          claim_type: "abstention_notice",
          statement_role: "reg24_inference",
          supporting_passage_ids: [],
          applicable_version_id: null,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
        },
      ],
      evidence: [],
      assumptions: [],
      clarification_questions: [
        "กรุณาระบุประเภทภาษี เลขที่มาตราแห่งประมวลรัษฎากร หรือข้อเท็จจริงของธุรกรรมเพิ่มเติม",
      ],
      coverage_warnings: coverageWarnings,
      applicable_date: req.applicable_date ?? null,
      model_policy_version: "reg24-grounded-legal-v1.1",
      trace_id: traceId,
      latency_ms: Math.max(1, Date.now() - startedAt),
    };
  }

  const availablePassages: Passage[] = liveVerifiedHits.map((h) => h.passage);

  // Surface explicit coverage warning when top cited rulings reference quarantined external statutes (`usable_as_legal_evidence: false`)
  const topCitedWorkIds = new Set(availablePassages.slice(0, 4).map((p) => p.work_id));
  const quarantinedCitationsForAnswer = Array.from(
    new Set(
      Object.values(freshState.unresolved_references)
        .filter((u) => topCitedWorkIds.has(u.source_work_id) && !u.usable_as_legal_evidence)
        .map((u) => u.raw_citation_text)
    )
  ).slice(0, 4);
  if (quarantinedCitationsForAnswer.length > 0) {
    coverageWarnings.push(
      `หมายเหตุขอบเขตหลักฐาน: เอกสารที่อ้างอิงมีการกล่าวถึงกฎหมายภายนอกที่ยังอยู่ในทะเบียนกักกัน (usable_as_legal_evidence: false) ได้แก่ ${quarantinedCitationsForAnswer.join(", ")} — ระบบแสดงเฉพาะเนื้อหาหนังสือตอบข้อหารือ/บทบัญญัติที่รับรองต้นฉบับแล้ว และไม่ใช้ตัวบทที่ถูกกักกันเป็นหลักฐานยืนยัน`
    );
  }

  const isComparisonMode =
    req.mode === "comparison" ||
    (req.comparison_work_ids && req.comparison_work_ids.length >= 2) ||
    bundle.explicit_ruling_ids_in_query.length >= 2 ||
    /เปรียบเทียบ/.test(req.question);

  // Scope conditions & exceptions strictly to the primary work(s) being answered so Hop-2 neighbor rulings never leak unrelated company facts
  const conditionScopeWorkIds = new Set<string>(
    isComparisonMode
      ? availablePassages.slice(0, 4).map((p) => p.work_id)
      : availablePassages[0]
        ? [
            (
              availablePassages.find(
                (p) =>
                  p.statement_role === "official_conclusion" ||
                  p.statement_role === "statutory_text"
              ) || availablePassages[0]
            ).work_id,
          ]
        : []
  );
  const extractedConditions = new Set<string>();
  const extractedExceptions = new Set<string>();
  const isFalsePrefixFragment = (s: string) => /^หาก(?:ำไร|ฎหมาย)/.test(s.trim());
  for (const a of bundle.matched_assertions) {
    if (!conditionScopeWorkIds.has(a.subject)) continue;
    for (const c of a.qualifications.conditions || []) {
      if (!isFalsePrefixFragment(c)) extractedConditions.add(c);
    }
    for (const e of a.qualifications.exceptions || []) {
      if (!isFalsePrefixFragment(e)) extractedExceptions.add(e);
    }
  }

  // 4. Missing material facts check (AT12b, B01-U09)
  const explicitMissingFactQuestions = detectMissingFactSignals(req.question);
  if (explicitMissingFactQuestions.length > 0) {
    for (const cond of Array.from(extractedConditions).slice(0, 2)) {
      explicitMissingFactQuestions.push(`เงื่อนไขตามแนววินิจฉัยที่ต้องตรวจสอบ: ${cond}`);
    }
  }

  const claims: ClaimLedgerItem[] = [];
  const answerSections: string[] = [];
  const allReleasePassages = store.getPassagesForRelease(releaseId);
  const allAcceptedAssertions = store.getAcceptedAssertionsForRelease(releaseId);
  const verificationPassageMap = new Map<string, Passage>(
    availablePassages.map((p) => [p.passage_id, p])
  );

  if (isComparisonMode) {
    // Group hits by canonical work_id OR by version_id when comparing two versions of the same statutory provision (B01-U03, B02-U03)
    const distinctWorkIds = new Set(
      availablePassages
        .filter((p) => freshState.works[p.work_id]?.type !== "ProvisionVersion")
        .map((p) => p.work_id)
    );
    const firstWorkId = availablePassages[0]?.work_id;
    const versionsOfFirstWork = new Set(
      availablePassages.filter((p) => p.work_id === firstWorkId).map((p) => p.version_id)
    );
    const groupByVersion = distinctWorkIds.size <= 1 || versionsOfFirstWork.size >= 2;

    const byGroup = new Map<string, Passage[]>();
    for (const p of availablePassages) {
      const w = freshState.works[p.work_id];
      if (!groupByVersion && w?.type === "ProvisionVersion" && byGroup.size >= 2) continue;
      const key = groupByVersion ? `${p.work_id}::${p.version_id}` : p.work_id;
      const list = byGroup.get(key) || [];
      list.push(p);
      byGroup.set(key, list);
    }

    answerSections.push("### การเปรียบเทียบแนววินิจฉัยและรุ่นบทบัญญัติกฎหมายตามช่วงเวลา/ข้อเท็จจริง");
    let idx = 0;
    for (const [, workPassages] of byGroup.entries()) {
      if (idx >= 3) break;
      const workId = workPassages[0].work_id;
      const work = freshState.works[workId];
      const ver = freshState.versions[workPassages[0].version_id];
      const conclusionSeed =
        workPassages.find((p) => p.statement_role === "official_conclusion" || p.statement_role === "statutory_text") ||
        workPassages[0];
      const conclusionUnits = reassembleOrderedSectionUnits(
        conclusionSeed,
        allReleasePassages,
        freshState,
        actor
      );
      const requesterUnits =
        work?.type === "TaxRuling"
          ? findOrderedRequesterUnitsForWork(conclusionSeed, allReleasePassages, freshState, actor)
          : workPassages.filter((p) => p.statement_role.startsWith("requester_"));
      for (const u of [...conclusionUnits, ...requesterUnits]) {
        verificationPassageMap.set(u.passage_id, u);
      }
      ensureEvidenceCardsForPassages(
        [...conclusionUnits, ...requesterUnits],
        liveEvidenceCards,
        freshState,
        allAcceptedAssertions
      );

      const fullConclusionText = conclusionUnits.map((u) => u.exact_text).join("\n");
      const fullFactsText = requesterUnits.map((u) => u.exact_text).join("\n");
      const label = work?.official_identifiers[0]?.normalized || work?.title_th || workId;
      const appInterval = ver?.legal_applicability?.[0];
      const intervalNote =
        appInterval && (appInterval.valid_from || appInterval.valid_to)
          ? ` [ช่วงใช้บังคับ: ${appInterval.valid_from || "เดิม"} ถึง ${appInterval.valid_to || "ปัจจุบัน"}]`
          : ver?.raw_date_text
            ? ` ลงวันที่ ${ver.raw_date_text}`
            : "";

      const stmt = `[${label}${intervalNote}] ${work?.type === "TaxRuling" ? "แนววินิจฉัยกรมสรรพากร" : "บทบัญญัติกฎหมาย"}: ${fullConclusionText}`;
      const verCheck = verifyClaimAgainstPassages(
        {
          statement: stmt,
          supporting_passage_ids: conclusionUnits.map((u) => u.passage_id),
        },
        Array.from(verificationPassageMap.values())
      );

      claims.push({
        claim_id: `clm.${traceId}.cmp.${idx + 1}`,
        statement: stmt,
        claim_type: "fact_distinction",
        statement_role: conclusionSeed.statement_role,
        supporting_passage_ids: [
          ...conclusionUnits.map((u) => u.passage_id),
          ...requesterUnits.map((u) => u.passage_id),
        ],
        applicable_version_id: conclusionSeed.version_id,
        factual_conditions: Array.from(extractedConditions).slice(0, 3),
        exceptions: Array.from(extractedExceptions).slice(0, 3),
        counterevidence_passage_ids: [],
        verification_result: verCheck.verification_result,
      });

      answerSections.push(
        `- **กรณี/รุ่นที่ ${idx + 1}: ${work?.title_th || label} (\`${ver?.version_label || conclusionSeed.version_id}\`)${intervalNote}**` +
          (fullFactsText ? `\n  - *ข้อเท็จจริงของผู้หารือ*: ${fullFactsText}` : "") +
          `\n  - *${work?.type === "TaxRuling" ? "แนววินิจฉัยของกรมสรรพากร" : "เนื้อหาบทบัญญัติ"}*: ${fullConclusionText}`
      );
      idx += 1;
    }
  } else {
    // Primary authoritative passages (`official_conclusion` or `statutory_text`) separated cleanly from `requester_facts` (B01-U04)
    const officialPassages = availablePassages.filter(
      (p) => p.statement_role === "official_conclusion" || p.statement_role === "statutory_text"
    );
    const requesterPassages = availablePassages.filter((p) =>
      p.statement_role.startsWith("requester_")
    );

    const primaryOfficial = officialPassages[0] || availablePassages[0];
    const primaryWork = freshState.works[primaryOfficial.work_id];
    const primaryVer = freshState.versions[primaryOfficial.version_id];
    const primaryIdLabel =
      primaryWork?.official_identifiers[0]?.normalized || primaryWork?.title_th || primaryOfficial.work_id;

    // Reassemble ALL sequential units (Unit 1 .. Unit N) of the official conclusion / statutory section so multi-point rulings never truncate (DEF-B01-05)
    const officialUnits = reassembleOrderedSectionUnits(
      primaryOfficial,
      allReleasePassages,
      freshState,
      actor
    );
    const officialUnitIds = officialUnits.map((u) => u.passage_id);
    const fullOfficialText = officialUnits.map((u) => u.exact_text).join("\n");

    const requesterUnitsFromStore =
      primaryWork?.type === "TaxRuling"
        ? findOrderedRequesterUnitsForWork(primaryOfficial, allReleasePassages, freshState, actor)
        : [];
    const fallbackRequester = requesterPassages.find((rp) => rp.work_id === primaryOfficial.work_id);
    const requesterUnits =
      requesterUnitsFromStore.length > 0
        ? requesterUnitsFromStore
        : fallbackRequester
          ? [fallbackRequester]
          : [];

    for (const u of [...officialUnits, ...requesterUnits]) {
      verificationPassageMap.set(u.passage_id, u);
    }
    ensureEvidenceCardsForPassages(
      [...officialUnits, ...requesterUnits],
      liveEvidenceCards,
      freshState,
      allAcceptedAssertions
    );

    const officialStatement = `[${primaryIdLabel}] ${fullOfficialText}`;
    const verCheck = verifyClaimAgainstPassages(
      {
        statement: officialStatement,
        supporting_passage_ids: officialUnitIds,
      },
      Array.from(verificationPassageMap.values())
    );

    if (!verCheck.allow_confident_answer) {
      return {
        release_id: releaseId,
        knowledge_snapshot_at: snapshotAt,
        status: "REVIEW_REQUIRED",
        answer:
          "ระบบตรวจพบความขัดแย้งระหว่างข้อสรุปกับข้อความต้นฉบับที่อ้างอิง จึงระงับการตอบแบบยืนยันและส่งต่อเพื่อตรวจสอบ",
        claims: [
          {
            claim_id: `clm.${traceId}.blocked`,
            statement: officialStatement,
            claim_type: "abstention_notice",
            statement_role: primaryOfficial.statement_role,
            supporting_passage_ids: officialUnitIds,
            applicable_version_id: primaryOfficial.version_id,
            factual_conditions: [],
            exceptions: [],
            counterevidence_passage_ids: [],
            verification_result: verCheck.verification_result,
          },
        ],
        evidence: liveEvidenceCards,
        assumptions: [],
        clarification_questions: [],
        coverage_warnings: coverageWarnings,
        applicable_date: req.applicable_date ?? null,
        model_policy_version: "reg24-grounded-legal-v1.2",
        trace_id: traceId,
        latency_ms: Math.max(1, Date.now() - startedAt),
      };
    }

    claims.push({
      claim_id: `clm.${traceId}.official.1`,
      statement: officialStatement,
      claim_type: "direct_source_statement",
      statement_role: primaryOfficial.statement_role,
      supporting_passage_ids: officialUnitIds,
      applicable_version_id: primaryOfficial.version_id,
      factual_conditions: Array.from(extractedConditions).slice(0, 4),
      exceptions: Array.from(extractedExceptions).slice(0, 4),
      counterevidence_passage_ids: [],
      verification_result: verCheck.verification_result,
    });

    if (req.applicable_date) {
      answerSections.push(
        `**ขอบเขตวันที่มีผลบังคับใช้ที่พิจารณา**: \`${req.applicable_date}\` (อ้างอิงรุ่นกฎหมาย \`${primaryOfficial.version_id}\`)`
      );
    }

    if (requesterUnits.length > 0) {
      const fullRequesterText = requesterUnits.map((u) => u.exact_text).join("\n");
      claims.push({
        claim_id: `clm.${traceId}.requester.1`,
        statement: `[ข้อเท็จจริง/ประเด็นของผู้ขอหารือ ใน ${primaryIdLabel}] ${fullRequesterText}`,
        claim_type: "direct_source_statement",
        statement_role: requesterUnits[0].statement_role,
        supporting_passage_ids: requesterUnits.map((u) => u.passage_id),
        applicable_version_id: requesterUnits[0].version_id,
        factual_conditions: [],
        exceptions: [],
        counterevidence_passage_ids: [],
        verification_result: "VERIFIED",
      });
      answerSections.push(
        `**ข้อเท็จจริงและประเด็นของผู้ขอหารือ** (*มิใช่คำวินิจฉัยที่มีผลผูกพันเป็นการทั่วไป*):\n${fullRequesterText}`
      );
    }

    const isDraftOrHistory =
      primaryVer?.draft_or_enacted_status === "DRAFT_BILL" ||
      primaryVer?.draft_or_enacted_status === "LEGISLATIVE_HISTORY";

    if (isDraftOrHistory) {
      answerSections.push(
        `**สถานะทางกฎหมาย: ร่างกฎหมาย / เอกสารประกอบการพิจารณานิติบัญญัติ (\`${primaryVer?.draft_or_enacted_status}\`) — ยังไม่ได้ประกาศใช้บังคับเป็นกฎหมายในราชกิจจานุเบกษา จึงยังไม่มีผลผูกพันเป็นกฎหมายปัจจุบัน**`
      );
    }

    if (
      primaryWork?.type !== "TaxRuling" &&
      (primaryVer?.publication_date || primaryVer?.legal_applicability?.[0]?.valid_from)
    ) {
      const pubStr = primaryVer?.publication_date || "ไม่ปรากฏในหน้าต้นฉบับ";
      const effStr = primaryVer?.legal_applicability?.[0]?.valid_from || "ไม่ปรากฏ/ตามเงื่อนไขเฉพาะกาล";
      const condNote = primaryVer?.legal_applicability?.[0]?.conditions?.[0];
      answerSections.push(
        `**การแยกวันประกาศและวันเริ่มใช้บังคับ**: วันประกาศในราชกิจจานุเบกษา \`${pubStr}\` | วันที่มีผลเริ่มใช้บังคับ \`${effStr}\`${condNote ? ` (${condNote})` : ""}`
      );
    }

    const issuedByAsrt = bundle.matched_assertions.find(
      (a) => a.subject === primaryOfficial.work_id && a.predicate === "ISSUED_BY"
    );
    const madeUnderAsrt = bundle.matched_assertions.find(
      (a) => a.subject === primaryOfficial.work_id && a.predicate === "MADE_UNDER"
    );
    if (primaryWork?.type === "SubordinateLegislation" && (issuedByAsrt || madeUnderAsrt)) {
      const issuerName = issuedByAsrt
        ? AGENCY_LABELS_TH[issuedByAsrt.object] || issuedByAsrt.object
        : AGENCY_LABELS_TH[primaryWork.issuer_id] || primaryWork.issuer_id;
      const enablingWork = madeUnderAsrt ? freshState.works[madeUnderAsrt.object] : undefined;
      const enablingLabel =
        enablingWork?.title_th ||
        madeUnderAsrt?.qualifications.conditions?.[0] ||
        madeUnderAsrt?.object ||
        "ตามบทอาศัยอำนาจในตราสารต้นฉบับ";
      answerSections.push(
        `**การแยกหน่วยงานผู้ออกตราสารและกฎหมายแม่บท**: ผู้ออกตราสาร (\`ISSUED_BY\`): **${issuerName}** | อาศัยอำนาจตามกฎหมายแม่บท (\`MADE_UNDER\`): **${enablingLabel}**`
      );
    }

    answerSections.push(
      `**${isDraftOrHistory ? "สาระสำคัญของร่างกฎหมาย/รายงานวิเคราะห์ร่าง" : primaryOfficial.statement_role === "statutory_text" ? "บทบัญญัติกฎหมาย" : "แนววินิจฉัยของกรมสรรพากร"} (${primaryIdLabel}${primaryVer?.raw_date_text ? ` — ${primaryVer.raw_date_text}` : ""})**:\n${fullOfficialText}`
    );

    // When answering a B01 TaxRuling and an upgraded B02 statutory provision passage ACTUALLY linked (`INTERPRETS`/`CITES`) by this ruling is in availablePassages, surface it explicitly (B02-U09)!
    if (primaryWork?.type === "TaxRuling") {
      const primaryLinkedTargets = new Set(
        store
          .getAcceptedAssertionsForRelease(releaseId)
          .filter(
            (a) =>
              a.subject === primaryOfficial.work_id &&
              (a.predicate === "INTERPRETS" || a.predicate === "CITES")
          )
          .map((a) => a.object)
      );
      const linkedStatPsg = availablePassages.find(
        (p) =>
          p.work_id !== primaryOfficial.work_id &&
          primaryLinkedTargets.has(p.work_id) &&
          p.statement_role === "statutory_text" &&
          !p.extraction_id.startsWith("ext.dep.")
      );
      if (linkedStatPsg) {
        const statWork = freshState.works[linkedStatPsg.work_id];
        const statStmt = `[บทบัญญัติกฎหมายอ้างอิง B02: ${statWork?.title_th || linkedStatPsg.work_id}] ${linkedStatPsg.exact_text}`;
        claims.push({
          claim_id: `clm.${traceId}.b02_statute.1`,
          statement: statStmt,
          claim_type: "direct_source_statement",
          statement_role: "statutory_text",
          supporting_passage_ids: [linkedStatPsg.passage_id],
          applicable_version_id: linkedStatPsg.version_id,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
        });
        answerSections.push(
          `**บทบัญญัติกฎหมายแม่บทที่เชื่อมโยงจากคลังกฎหมาย B02 (${statWork?.title_th || linkedStatPsg.work_id})**:\n${linkedStatPsg.exact_text}`
        );
      }
    }

    if (extractedConditions.size > 0) {
      answerSections.push(
        `**เงื่อนไขสำคัญที่ต้องเป็นไปตามหลักเกณฑ์**:\n${Array.from(extractedConditions)
          .slice(0, 3)
          .map((c) => `- ${c}`)
          .join("\n")}`
      );
    }
    if (extractedExceptions.size > 0) {
      answerSections.push(
        `**ข้อยกเว้น / ข้อจำกัด**:\n${Array.from(extractedExceptions)
          .slice(0, 3)
          .map((e) => `- ${e}`)
          .join("\n")}`
      );
    }
    if (primaryWork?.type === "TaxRuling") {
      answerSections.push(
        `*หมายเหตุความแน่นอนทางกฎหมาย*: หนังสือตอบข้อหารือกรมสรรพากรเป็นการวินิจฉัยเฉพาะข้อเท็จจริงของผู้ขอหารือรายนั้น ภายใต้บทบัญญัติกฎหมายที่ใช้บังคับในขณะวินิจฉัย`
      );
    }
  }

  const topVer = availablePassages[0] ? freshState.versions[availablePassages[0].version_id] : undefined;
  const topIsDraft =
    topVer?.draft_or_enacted_status === "DRAFT_BILL" ||
    topVer?.draft_or_enacted_status === "LEGISLATIVE_HISTORY";

  let finalStatus: AnswerStatus = "ANSWERED";
  if (explicitMissingFactQuestions.length > 0) {
    finalStatus = "NEEDS_CLARIFICATION";
    answerSections.unshift(
      `**สถานะการวิเคราะห์: ต้องการข้อเท็จจริงเพิ่มเติม (\`NEEDS_CLARIFICATION\`)** เนื่องจากข้อเท็จจริงอันเป็นเงื่อนไขชี้ขาดยังไม่ปรากฏชัดเจน จึงสรุปหลักเกณฑ์ตามแนววินิจฉัยแบบมีเงื่อนไขไว้ดังนี้:`
    );
  } else if (topIsDraft) {
    finalStatus = "CONDITIONAL";
  } else if (
    extractedConditions.size > 0 &&
    req.mode !== "exact_lookup" &&
    /(?:หรือไม่|อย่างไร|ได้รับสิทธิหรือไม่|ต้องเสียภาษีหรือไม่)/.test(req.question) &&
    bundle.explicit_ruling_ids_in_query.length === 0
  ) {
    finalStatus = "CONDITIONAL";
  }

  return {
    release_id: releaseId,
    knowledge_snapshot_at: snapshotAt,
    status: finalStatus,
    answer: answerSections.join("\n\n"),
    claims,
    evidence: liveEvidenceCards,
    assumptions:
      primaryWorkIsRuling(freshState, availablePassages[0])
        ? ["แนววินิจฉัยหนังสือตอบข้อหารือใช้บังคับเฉพาะข้อเท็จจริงที่ตรงกับข้อหารือต้นฉบับ"]
        : [],
    clarification_questions: explicitMissingFactQuestions,
    coverage_warnings: coverageWarnings,
    applicable_date: req.applicable_date ?? null,
    model_policy_version: "reg24-grounded-legal-v1.1",
    trace_id: traceId,
    latency_ms: Math.max(1, Date.now() - startedAt),
  };
}

function primaryWorkIsRuling(
  state: ReturnType<DurableKnowledgeStore["getState"]>,
  psg?: Passage
): boolean {
  if (!psg) return false;
  return state.works[psg.work_id]?.type === "TaxRuling";
}
