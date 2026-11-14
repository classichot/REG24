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
import { sha256Bytes } from "./identity";
import { retrieveAuthorizedKnowledge, type RetrievalStrategy } from "./retrieval";
import { getDefaultKnowledgeStore, type DurableKnowledgeStore } from "./store";
import type {
  Actor,
  AnswerStatus,
  ClaimLedgerItem,
  GroundedAnswer,
  Passage,
  QueryRequest,
} from "./contracts";

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

  const fallbackCandidateRel = Object.values(state.releases).find(
    (r) => r.state === "READY_FOR_UAT" || r.state === "ACCEPTED" || r.state === "ACCEPTED_WITH_DECLARED_GAPS"
  )?.release_id;

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

  // 2. Final pre-delivery live authorization/withdrawal recheck (SH-16, AT08)
  const freshState = store.getState();
  let liveVerifiedHits = bundle.top_hits.filter((h) =>
    isPassageCurrentlyAuthorizedAndActive(freshState, h.passage, actor)
  );
  // In exact_lookup mode with an explicit ruling identifier, scope citations strictly to the matched canonical ruling(s) + direct statutory hops (B01-U01)
  if (req.mode === "exact_lookup" && bundle.explicit_ruling_ids_in_query.length > 0) {
    const exactScoped = liveVerifiedHits.filter(
      (h) =>
        h.match_sources.includes("exact_id") ||
        (h.match_sources.includes("graph_hop") &&
          freshState.works[h.passage.work_id]?.type === "ProvisionVersion")
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

  // Collect conditions & exceptions from matched graph assertions
  const extractedConditions = new Set<string>();
  const extractedExceptions = new Set<string>();
  for (const a of bundle.matched_assertions) {
    for (const c of a.qualifications.conditions || []) extractedConditions.add(c);
    for (const e of a.qualifications.exceptions || []) extractedExceptions.add(e);
  }

  // 4. Missing material facts check (AT12b, B01-U09)
  const explicitMissingFactQuestions = detectMissingFactSignals(req.question);
  if (explicitMissingFactQuestions.length > 0) {
    for (const cond of Array.from(extractedConditions).slice(0, 2)) {
      explicitMissingFactQuestions.push(`เงื่อนไขตามแนววินิจฉัยที่ต้องตรวจสอบ: ${cond}`);
    }
  }

  const isComparisonMode =
    req.mode === "comparison" ||
    (req.comparison_work_ids && req.comparison_work_ids.length >= 2) ||
    bundle.explicit_ruling_ids_in_query.length >= 2 ||
    /เปรียบเทียบ/.test(req.question);

  const claims: ClaimLedgerItem[] = [];
  const answerSections: string[] = [];

  if (isComparisonMode) {
    // Group hits by canonical work_id so each ruling's facts, conditions, and conclusion stay distinct (B01-U03)
    const byWork = new Map<string, Passage[]>();
    for (const p of availablePassages) {
      const w = freshState.works[p.work_id];
      if (w?.type === "ProvisionVersion" && byWork.size >= 2) continue;
      const list = byWork.get(p.work_id) || [];
      list.push(p);
      byWork.set(p.work_id, list);
    }

    answerSections.push("### การเปรียบเทียบแนววินิจฉัยและข้อกฎหมายตามข้อเท็จจริงแต่ละกรณี");
    let idx = 0;
    for (const [workId, workPassages] of byWork.entries()) {
      if (idx >= 3) break;
      const work = freshState.works[workId];
      const ver = freshState.versions[workPassages[0].version_id];
      const conclusionPsg =
        workPassages.find((p) => p.statement_role === "official_conclusion" || p.statement_role === "statutory_text") ||
        workPassages[0];
      const factsPsg = workPassages.find((p) => p.statement_role.startsWith("requester_"));
      const label = work?.official_identifiers[0]?.normalized || work?.title_th || workId;

      const stmt = `[${label}${ver?.raw_date_text ? ` ลงวันที่ ${ver.raw_date_text}` : ""}] แนววินิจฉัยกรมสรรพากร: ${conclusionPsg.exact_text}`;
      const verCheck = verifyClaimAgainstPassages(
        { statement: stmt, supporting_passage_ids: [conclusionPsg.passage_id] },
        availablePassages
      );

      claims.push({
        claim_id: `clm.${traceId}.cmp.${idx + 1}`,
        statement: stmt,
        claim_type: "fact_distinction",
        statement_role: conclusionPsg.statement_role,
        supporting_passage_ids: [
          conclusionPsg.passage_id,
          ...(factsPsg ? [factsPsg.passage_id] : []),
        ],
        applicable_version_id: conclusionPsg.version_id,
        factual_conditions: Array.from(extractedConditions).slice(0, 3),
        exceptions: Array.from(extractedExceptions).slice(0, 3),
        counterevidence_passage_ids: [],
        verification_result: verCheck.verification_result,
      });

      answerSections.push(
        `- **กรณีที่ ${idx + 1}: ${work?.title_th || label}**` +
          (factsPsg ? `\n  - *ข้อเท็จจริงของผู้หารือ*: ${factsPsg.exact_text.slice(0, 280)}${factsPsg.exact_text.length > 280 ? "..." : ""}` : "") +
          `\n  - *แนววินิจฉัยของกรมสรรพากร*: ${conclusionPsg.exact_text}`
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

    const officialStatement = `[${primaryIdLabel}] ${primaryOfficial.exact_text}`;
    const verCheck = verifyClaimAgainstPassages(
      {
        statement: officialStatement,
        supporting_passage_ids: [primaryOfficial.passage_id],
      },
      availablePassages
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
            supporting_passage_ids: [primaryOfficial.passage_id],
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
        model_policy_version: "reg24-grounded-legal-v1.1",
        trace_id: traceId,
        latency_ms: Math.max(1, Date.now() - startedAt),
      };
    }

    claims.push({
      claim_id: `clm.${traceId}.official.1`,
      statement: officialStatement,
      claim_type: "direct_source_statement",
      statement_role: primaryOfficial.statement_role,
      supporting_passage_ids: [primaryOfficial.passage_id],
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

    const matchingRequester = requesterPassages.find((rp) => rp.work_id === primaryOfficial.work_id);
    if (matchingRequester) {
      claims.push({
        claim_id: `clm.${traceId}.requester.1`,
        statement: `[ข้อเท็จจริง/ประเด็นของผู้ขอหารือ ใน ${primaryIdLabel}] ${matchingRequester.exact_text}`,
        claim_type: "direct_source_statement",
        statement_role: matchingRequester.statement_role,
        supporting_passage_ids: [matchingRequester.passage_id],
        applicable_version_id: matchingRequester.version_id,
        factual_conditions: [],
        exceptions: [],
        counterevidence_passage_ids: [],
        verification_result: "VERIFIED",
      });
      answerSections.push(
        `**ข้อเท็จจริงและประเด็นของผู้ขอหารือ** (*มิใช่คำวินิจฉัยที่มีผลผูกพันเป็นการทั่วไป*):\n${matchingRequester.exact_text}`
      );
    }

    answerSections.push(
      `**${primaryOfficial.statement_role === "statutory_text" ? "บทบัญญัติกฎหมาย" : "แนววินิจฉัยของกรมสรรพากร"} (${primaryIdLabel}${primaryVer?.raw_date_text ? ` ลงวันที่ ${primaryVer.raw_date_text}` : ""})**:\n${primaryOfficial.exact_text}`
    );

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

  let finalStatus: AnswerStatus = "ANSWERED";
  if (explicitMissingFactQuestions.length > 0) {
    finalStatus = "NEEDS_CLARIFICATION";
    answerSections.unshift(
      `**สถานะการวิเคราะห์: ต้องการข้อเท็จจริงเพิ่มเติม (\`NEEDS_CLARIFICATION\`)** เนื่องจากข้อเท็จจริงอันเป็นเงื่อนไขชี้ขาดยังไม่ปรากฏชัดเจน จึงสรุปหลักเกณฑ์ตามแนววินิจฉัยแบบมีเงื่อนไขไว้ดังนี้:`
    );
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
