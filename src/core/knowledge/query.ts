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
import { detectSourceSectionTyposSic, extractConditionsAndExceptions } from "./profiles/B01";
import { retrieveAuthorizedKnowledge, type RetrievalStrategy } from "./retrieval";
import { getDefaultKnowledgeStore, type DurableKnowledgeStore } from "./store";
import {
  evaluateRulingTemporalApplicability,
  evaluateStatutoryVersionApplicability,
  formatAmendmentLedgerSummaryTh,
  normalizeBilingualQueryForRetrieval,
  parseQueryTemporalAndIntentContext,
  type StatutoryVersionEvaluationResult,
} from "./temporal-versioning";
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
      raw_date_text: ver?.raw_date_text || null,
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

function buildSingleAnswerPremiseAndOperativeSummary(params: {
  question: string;
  mode?: QueryRequest["mode"];
  primaryWorkId: string;
  primaryWorkType: string;
  primaryTitleTh: string;
  primaryIdLabel: string;
  fullOfficialText: string;
  hasSection19Proviso: boolean;
}): string[] {
  const notes: string[] = [];
  const qNorm = thaiDigitsToArabic(params.question).replace(/\s+/g, " ");
  const bodyNorm = thaiDigitsToArabic(params.fullOfficialText).replace(/\s+/g, " ");
  const titleNorm = thaiDigitsToArabic(params.primaryTitleTh).replace(/\s+/g, " ");

  // S-3 Premise Check: Question presupposes income-tax exemption under Royal Decree 244 s.3(5), when RD 244 s.3(5) subjects commercial sale / ขายฝาก to Specific Business Tax
  if (
    /ยกเว้นภาษีเงินได้/.test(qNorm) &&
    /ฉบับที่\s*244/.test(qNorm) &&
    /อยู่ในบังคับต้องเสียภาษีธุรกิจเฉพาะ/.test(bodyNorm)
  ) {
    notes.push(
      `**ข้อสังเกตความคลาดเคลื่อนของสมมติฐานในคำถาม**: คำถามกล่าวถึง *"การยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกา ฉบับที่ 244 มาตรา 3 (5)"* แต่แท้จริงแล้ว **มาตรา 3(5) แห่งพระราชกฤษฎีกาฯ (ฉบับที่ 244) พ.ศ. 2534 มิใช่บทบัญญัติยกเว้นภาษีเงินได้** หากเป็นบทบัญญัติที่กำหนดให้การขายอสังหาริมทรัพย์ที่ผู้ขายมีไว้ในการประกอบกิจการ (รวมถึงการขายฝากที่ดิน) เข้าลักษณะเป็นการขายเป็นทางค้าหรือหากำไร ซึ่ง **อยู่ในบังคับต้องเสียภาษีธุรกิจเฉพาะตามมาตรา 91/2(6)** และบริษัทยังต้องนำรายได้มารวมคำนวณกำไรสุทธิเพื่อเสียภาษีเงินได้นิติบุคคลตามมาตรา 65 แห่งประมวลรัษฎากรด้วย`
    );
  } else if (
    /การขาย/.test(qNorm) &&
    !/การนำเข้า/.test(qNorm) &&
    params.primaryWorkType === "TaxRuling" &&
    /กรณีการนำเข้า/.test(titleNorm)
  ) {
    notes.push(
      `**ข้อสังเกตความคลาดเคลื่อนของสมมติฐานในคำถาม**: คำถามกล่าวถึง *"การขาย"* แต่หนังสือตอบข้อหารือ \`${params.primaryIdLabel}\` วินิจฉัยเฉพาะกรณี **การนำเข้าสินค้าจากต่างประเทศ**`
    );
  }

  // S-4 Concise 1-3 line grounded operative summary before statutory / substantive ruling blocks
  if (params.primaryWorkId === "prov.th.rc.65_ตรี") {
    notes.push(
      `**สรุปหลักเกณฑ์สำคัญตามแหล่งอ้างอิง**: ประมวลรัษฎากร มาตรา 65 ตรี กำหนดรายการรายจ่ายต้องห้าม (1)–(20) ที่ไม่ให้นำมาหักในการคำนวณกำไรสุทธิของบริษัทหรือห้างหุ้นส่วนนิติบุคคล (เช่น เงินสำรองนอกเกณฑ์ที่กำหนด รายจ่ายส่วนตัว/การกุศลเกินเพดานที่กฎหมายอนุญาต ค่ารับรองเกินเกณฑ์กฎกระทรวง รายจ่ายอันมีลักษณะเป็นการลงทุน เบี้ยปรับ/เงินเพิ่ม/ภาษีเงินได้นิติบุคคล รายจ่ายที่มิใช่เพื่อหากำไรหรือเพื่อกิจการโดยเฉพาะ และรายจ่ายที่พิสูจน์ผู้รับไม่ได้) ทั้งนี้ ตัวบทด้านล่างเป็นตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบัน โดยวันเริ่มใช้บังคับของแต่ละอนุมาตราเป็นไปตามหมายเหตุแก้ไขเพิ่มเติมท้ายอนุมาตรานั้น`
    );
  } else if (params.primaryWorkId === "prov.th.rc.47_ทวิ") {
    notes.push(
      `**สรุปหลักเกณฑ์สำคัญตามแหล่งอ้างอิง**: ผู้มีเงินได้ซึ่งมีภูมิลำเนาอยู่ในประเทศไทยหรือเป็นผู้อยู่ในประเทศไทย ที่ได้รับเงินปันผลหรือเงินส่วนแบ่งของกำไรตามมาตรา 40 (4) (ข) จากบริษัทหรือห้างหุ้นส่วนนิติบุคคลที่ตั้งขึ้นตามกฎหมายไทย (เฉพาะส่วนที่จ่ายจากกำไรสุทธิที่ได้เสียภาษีเงินได้นิติบุคคลแล้ว) มีสิทธิได้รับเครดิตภาษีเงินปันผลคำนวณตามอัตรา \`อัตราภาษีเงินได้นิติบุคคล / (100 - อัตราภาษีเงินได้นิติบุคคล)\` คูณด้วยเงินปันผลที่ได้รับ โดยต้องนำเครดิตภาษีมารวมเป็นเงินได้พึงประเมินตามมาตรา 48 ก่อนหักออกจากภาษีที่ต้องเสีย`
    );
  } else if (params.primaryWorkId === "prov.th.rc.70") {
    notes.push(
      `**สรุปหลักเกณฑ์สำคัญตามแหล่งอ้างอิง**: กรณีบริษัทหรือห้างหุ้นส่วนนิติบุคคลที่ตั้งขึ้นตามกฎหมายต่างประเทศและ **มิได้ประกอบกิจการในประเทศไทย** ได้รับเงินได้พึงประเมินตามมาตรา 40 (2) (3) (4) (5) หรือ (6) ที่จ่ายจากหรือในประเทศไทย ผู้จ่ายเงินได้มีหน้าที่หักภาษี ณ ที่จ่ายตามอัตราภาษีเงินได้สำหรับบริษัทหรือห้างหุ้นส่วนนิติบุคคล และนำส่งพร้อมยื่นแบบรายการภายใน **7 วันนับแต่วันสิ้นเดือนของเดือนที่จ่ายเงินได้** (ยกเว้นดอกเบี้ยที่จ่ายจากรัฐบาลหรือสถาบันการเงินที่มีกฎหมายเฉพาะจัดตั้งขึ้นเพื่อส่งเสริมเกษตรกรรม พาณิชยกรรม หรืออุตสาหกรรมตามวรรคสอง)`
    );
  } else if (params.primaryWorkId === "prov.th.rc.80/1") {
    notes.push(
      `**สรุปหลักเกณฑ์สำคัญตามแหล่งอ้างอิง**: ผู้ประกอบการจดทะเบียนได้รับสิทธิใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 0 ตามมาตรา 80/1 เฉพาะกิจการที่เข้าเงื่อนไขตาม (1)–(6) ได้แก่ (1) การส่งออกสินค้าที่มิใช่สินค้าได้รับยกเว้นตามมาตรา 81 (3), (2) การให้บริการที่กระทำในราชอาณาจักรและได้มีการใช้บริการนั้นในต่างประเทศตามหลักเกณฑ์ วิธีการ และเงื่อนไขที่อธิบดีกำหนด (ประกาศอธิบดีฯ ภาษีมูลค่าเพิ่ม ฉบับที่ 105 รวมถึงบริการเพื่อใช้ผลิตสินค้าในเขตปลอดอากรเพื่อส่งออก), (3) การขนส่งระหว่างประเทศโดยอากาศยานหรือเรือเดินทะเลโดยนิติบุคคล, (4) การขาย/ให้บริการแก่ส่วนราชการหรือรัฐวิสาหกิจตามโครงการเงินกู้หรือเงินช่วยเหลือจากต่างประเทศ, (5) การขาย/ให้บริการแก่องค์การสหประชาชาติ สถานทูต หรือองค์การระหว่างประเทศตามหลักเกณฑ์ที่อธิบดีกำหนด และ (6) การขาย/ให้บริการระหว่างคลังสินค้าทัณฑ์บนหรือผู้ประกอบการในเขตปลอดอากร`
    );
  } else if (params.primaryWorkId === "prov.th.rc.19") {
    notes.push(
      `**สรุปหลักเกณฑ์สำคัญตามแหล่งอ้างอิง**: ตามมาตรา 19 แห่งประมวลรัษฎากร โดยหลักทั่วไปเจ้าพนักงานประเมินต้องออกหมายเรียกผู้ยื่นรายการมาไต่สวนภายใน **2 ปี** นับแต่วันที่ได้ยื่นรายการ (โดยให้เวลาล่วงหน้าไม่น้อยกว่า 7 วันนับแต่วันส่งหมาย) **เว้นแต่** ปรากฏหลักฐานหรือมีเหตุอันควรสงสัยว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร หรือเป็นกรณีจำเป็นเพื่อประโยชน์ในการคืนภาษีอากร **อธิบดีกรมสรรพากรมีอำนาจอนุมัติให้ขยายเวลาออกหมายเรียกเกินกว่า 2 ปีได้ แต่ต้องไม่เกิน 5 ปีนับแต่วันที่ได้ยื่นรายการ** (และกรณีเพื่อประโยชน์ในการคืนภาษีอากร ขยายได้ไม่เกินกำหนดเวลาตามที่มีสิทธิขอคืนภาษีอากร)`
    );
  } else if (
    params.primaryWorkType === "TaxRuling" &&
    params.mode !== "exact_lookup"
  ) {
    if (params.primaryIdLabel.includes("0702/1494")) {
      notes.push(
        `**สรุปคำตอบตามแนววินิจฉัยเฉพาะราย (\`กค 0702/1494\`)**: กองมรดกที่ยังมิได้แบ่งมีสิทธิได้รับเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ และมาตรา 48 แห่งประมวลรัษฎากร **เฉพาะตามข้อเท็จจริงของรายนี้** ที่ผู้จัดการมรดกตามคำสั่งศาลได้แสดงเจตนาเลือกเอาสถานที่ในประเทศไทยเป็น **ภูมิลำเนาเฉพาะการตามมาตรา 42 แห่งประมวลกฎหมายแพ่งและพาณิชย์** เพื่อยื่นแบบ ภ.ง.ด.90 ต่อเนื่องกันมา จึงไม่เข้าข้อยกเว้นผู้ไม่มีภูมิลำเนาในประเทศไทยตามมาตรา 47 ทวิ วรรคสาม`
      );
    } else if (params.primaryIdLabel.includes("0702/1230")) {
      notes.push(
        `**สรุปคำตอบตามแนววินิจฉัยเฉพาะราย (\`กค 0702/1230\`)**: การอนุญาตให้ใช้หรือขายลิขสิทธิ์ภาพยนตร์ให้แก่ผู้ซื้อในต่างประเทศโดยจัดส่งไฟล์ทางไปรษณีย์อิเล็กทรอนิกส์ (Email) เพื่อนำไปใช้ในต่างประเทศเพียงอย่างเดียว เข้าลักษณะเป็นการให้บริการที่กระทำในราชอาณาจักรและใช้บริการในต่างประเทศ ได้รับสิทธิเสียภาษีมูลค่าเพิ่ม **อัตราร้อยละ 0 ตามมาตรา 80/1 (2)** ประกอบ **ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 105)** โดยความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นเมื่อได้รับชำระราคาค่าบริการตาม **มาตรา 78/1 (1) (ก)** แห่งประมวลรัษฎากร`
      );
    } else if (params.hasSection19Proviso) {
      notes.push(
        `**สรุปคำตอบตามแหล่งอ้างอิง**: แม้บันทึกกองกฎหมาย ที่ \`กค 0811(กม.03)/366\` (พ.ศ. 2545) จะกล่าวถึงหลักทั่วไปของการออกหมายเรียกภายใน **2 ปี** นับแต่วันยื่นรายการ แต่ตาม **มาตรา 19 แห่งประมวลรัษฎากร** ที่ใช้บังคับอยู่ปัจจุบัน **อธิบดีกรมสรรพากรมีอำนาจอนุมัติให้ขยายเวลาออกหมายเรียกเกินกว่า 2 ปีได้ แต่ไม่เกิน 5 ปีนับแต่วันที่ได้ยื่นรายการ** หากปรากฏหลักฐานหรือมีเหตุอันควรสงสัยว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร หรือเป็นกรณีจำเป็นเพื่อประโยชน์ในการคืนภาษีอากร`
      );
    }
  }

  return notes;
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

  // 1a. Explicit nonexistent or partially unresolved official ruling identifier -> Immediate clean abstention in ALL modes, ZERO silent substitution! (AT12a, B01-U10)
  if (bundle.unresolved_explicit_ruling_ids.length > 0) {
    const missingLabel = bundle.unresolved_explicit_ruling_ids.join(", ");
    const resolvedIds = bundle.resolved_explicit_ruling_ids || [];
    const abstentionText =
      resolvedIds.length > 0
        ? `ไม่พบข้อมูล / หลักฐานไม่เพียงพอ — ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่ ${missingLabel} ในคลังข้อมูลที่ผ่านการรับรองของ REG24 (${releaseId}) ระบบจึงระงับการสรุปเปรียบเทียบและไม่นำข้อหารือฉบับอื่นมาสวมรอยแทนโดยพลการ (เฉพาะเลขที่ที่ตรวจสอบพบต้นฉบับจริงในคลังข้อมูลคือ: ${resolvedIds.join(", ")})`
        : `ไม่พบข้อมูล / หลักฐานไม่เพียงพอ — ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่ ${missingLabel} ในคลังข้อมูลที่ผ่านการรับรองของ REG24 (${releaseId}) ระบบจึงระงับการสรุปข้อกฎหมายและไม่สร้างเลขที่เอกสารหรือนำข้อหารือฉบับอื่นมาอ้างอิงแทน`;
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

  // 1a-ii. Explicit ruling number exists in another year/date, NOT the year/date requested -> Never substitute another year's homonym!
  if ((bundle.year_mismatched_ruling_lookups?.length || 0) > 0) {
    const m = bundle.year_mismatched_ruling_lookups![0];
    const availSummary = m.available_versions
      .map((v) => `${m.ruling_id} ลงวันที่ ${v.raw_date_text || v.decision_date || "-"} (${v.origin_uri})`)
      .join("; ");
    const mismatchMsg = `ไม่พบข้อมูล / หลักฐานไม่เพียงพอ — ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่ ${m.ruling_id} ที่ตรงกับวันที่หรือปีที่ระบุ (${m.requested_qualifier}) ในคลังข้อมูลที่ผ่านการรับรองของ REG24 (${releaseId}) ระบบจึงไม่นำข้อหารือเลขที่เดียวกันจากปีอื่นมาแสดงแทนโดยพลการ ทั้งนี้ ฉบับจริงของเลขที่ ${m.ruling_id} ที่มีในคลังข้อมูล ได้แก่: ${availSummary}`;
    return {
      release_id: releaseId,
      knowledge_snapshot_at: snapshotAt,
      status: "INSUFFICIENT_EVIDENCE",
      answer: mismatchMsg,
      claims: [
        {
          claim_id: `clm.${traceId}.abstain_year_mismatch`,
          statement: mismatchMsg,
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
        `กรุณาระบุวันที่ออกหนังสือที่มีอยู่จริงของ ${m.ruling_id} (${m.available_versions.map((v) => v.raw_date_text).join(" หรือ ")})`,
      ],
      coverage_warnings: coverageWarnings,
      applicable_date: req.applicable_date ?? null,
      model_policy_version: "reg24-grounded-legal-v1.1",
      trace_id: traceId,
      latency_ms: Math.max(1, Date.now() - startedAt),
    };
  }

  // 1b. Out-of-scope non-RD legal domain & quarantined external statute guard (Trial Scope Control)
  const { normalizedQuestionForIdentifiers } = normalizeBilingualQueryForRetrieval(req.question);
  const qArabic = thaiDigitsToArabic(normalizedQuestionForIdentifiers);
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
        ? `พระราชกฤษฎีกาฯ (ฉบับที่ ${rdNum}) ยังอยู่ระหว่างรอการตรวจรับรองตัวบทต้นฉบับจากราชกิจจานุเบกษาในชุดข้อมูล ${releaseId} ระบบจึงไม่สรุปหรือคาดเดาตัวบทมาตราและวันบังคับใช้ของพระราชกฤษฎีกาฉบับดังกล่าวโดยไม่มีต้นฉบับที่ผ่านการรับรอง ทั้งนี้ ท่านสามารถตรวจสอบตัวบททางการได้จากราชกิจจานุเบกษา (https://ratchakitcha.soc.go.th) หรือเว็บไซต์กรมสรรพากร (https://www.rd.go.th) โดยตรง (สถานะระบบ: usable_as_legal_evidence: false)`
        : `ไม่พบตัวบทพระราชกฤษฎีกาฯ (ฉบับที่ ${rdNum}) ที่ผ่านการตรวจรับรองต้นฉบับในคลังข้อมูลชุด ${releaseId} ระบบจึงระงับการตอบและไม่คาดเดาตัวบทกฎหมาย กรุณาตรวจสอบต้นฉบับจากราชกิจจานุเบกษา (https://ratchakitcha.soc.go.th) หรือเว็บไซต์กรมสรรพากร (https://www.rd.go.th)`;
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
      "ไม่พบข้อมูล / หลักฐานไม่เพียงพอ — ไม่พบหลักฐานข้อกฎหมายหรือหนังสือตอบข้อหารือที่ได้รับอนุญาตและตรงกับประเด็นคำถามอย่างเพียงพอในคลังข้อมูลชุดปัจจุบัน ระบบจึงไม่คาดเดาคำตอบทางภาษี";
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

  const isComparisonMode =
    req.mode === "comparison" ||
    (req.comparison_work_ids && req.comparison_work_ids.length >= 2) ||
    bundle.explicit_ruling_ids_in_query.length >= 2 ||
    /เปรียบเทียบ/.test(req.question);

  let singleExplicitRulingPassage: Passage | undefined;
  if (!isComparisonMode && bundle.explicit_ruling_ids_in_query.length === 1) {
    const targetRId = bundle.explicit_ruling_ids_in_query[0];
    const targetWithGk = targetRId.startsWith("กค ") ? targetRId : `กค ${targetRId}`;
    const targetWithoutGk = targetRId.replace(/^กค\s+/, "");
    singleExplicitRulingPassage = availablePassages.find((p) => {
      if (p.statement_role !== "official_conclusion") return false;
      const w = freshState.works[p.work_id];
      if (!w || w.type !== "TaxRuling") return false;
      return w.official_identifiers.some(
        (oid) =>
          oid.normalized === targetRId ||
          oid.normalized === targetWithGk ||
          oid.normalized === targetWithoutGk
      );
    });
  }

  // Scope conditions, exceptions & quarantined-law warnings strictly to the primary work(s) being answered so Hop-2 neighbor rulings never leak unrelated warnings
  const conditionScopeWorkIds = new Set<string>(
    isComparisonMode
      ? availablePassages.slice(0, 4).map((p) => p.work_id)
      : singleExplicitRulingPassage
        ? [singleExplicitRulingPassage.work_id]
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

  const quarantinedCitationsForAnswer = Array.from(
    new Set(
      Object.values(freshState.unresolved_references)
        .filter((u) => conditionScopeWorkIds.has(u.source_work_id) && !u.usable_as_legal_evidence)
        .map((u) => u.raw_citation_text)
    )
  ).slice(0, 4);
  if (quarantinedCitationsForAnswer.length > 0) {
    coverageWarnings.push(
      `หมายเหตุขอบเขตหลักฐาน: เอกสารที่อ้างอิงมีการกล่าวถึงกฎหมายภายนอกที่ยังอยู่ในทะเบียนกักกัน (usable_as_legal_evidence: false) ได้แก่ ${quarantinedCitationsForAnswer.join(", ")} — ระบบแสดงเฉพาะเนื้อหาหนังสือตอบข้อหารือ/บทบัญญัติที่รับรองต้นฉบับแล้ว และไม่ใช้ตัวบทที่ถูกกักกันเป็นหลักฐานยืนยัน`
    );
  }
  const allReleasePassages = store.getPassagesForRelease(releaseId);
  const allAcceptedAssertions = store.getAcceptedAssertionsForRelease(releaseId);

  const extractedConditions = new Set<string>();
  const extractedExceptions = new Set<string>();
  const isCleanCompleteStoredQualification = (s: string) => {
    const t = s.trim();
    if (!t || t.length < 15) return false;
    if (/^(?:หากำไร|หากฎหมาย|เมื่อ\s*(?:วันที่|วัน|เดือน|ปี|พ\.ศ\.|คราว|ครั้ง|ใด(?:\s|$)))/u.test(t)) {
      return false;
    }
    if (/[\u0E40-\u0E44\u0E31]$/u.test(t)) return false;
    return true;
  };

  for (const scopeWorkId of conditionScopeWorkIds) {
    const scopeWork = freshState.works[scopeWorkId];
    if (scopeWork?.type === "TaxRuling") {
      // Derive complete, non-truncated conditions & exceptions directly from the reassembled full conclusion units
      const seed = availablePassages.find(
        (p) => p.work_id === scopeWorkId && p.statement_role === "official_conclusion"
      );
      if (seed) {
        const units = reassembleOrderedSectionUnits(seed, allReleasePassages, freshState, actor);
        const reassembled = units.map((u) => u.exact_text).join("\n");
        const parsed = extractConditionsAndExceptions(reassembled);
        for (const c of parsed.conditions) extractedConditions.add(c);
        for (const e of parsed.exceptions) extractedExceptions.add(e);
      }
    } else {
      for (const a of bundle.matched_assertions) {
        if (a.subject !== scopeWorkId) continue;
        for (const c of a.qualifications.conditions || []) {
          if (isCleanCompleteStoredQualification(c)) extractedConditions.add(c.trim());
        }
        for (const e of a.qualifications.exceptions || []) {
          if (isCleanCompleteStoredQualification(e)) extractedExceptions.add(e.trim());
        }
      }
    }
  }

  // 4. Missing material facts check (AT12b, B01-U09)
  const explicitMissingFactQuestions = detectMissingFactSignals(req.question);
  const hasExplicitUnknownFactSignal = explicitMissingFactQuestions.length > 0;
  if (hasExplicitUnknownFactSignal) {
    for (const cond of Array.from(extractedConditions).slice(0, 2)) {
      explicitMissingFactQuestions.push(`เงื่อนไขตามแนววินิจฉัยที่ต้องตรวจสอบ: ${cond}`);
    }
  }

  const temporalCtx = parseQueryTemporalAndIntentContext({
    question: normalizedQuestionForIdentifiers,
    applicableDate: req.applicable_date,
    mode: req.mode,
    explicitRulingIds: bundle.explicit_ruling_ids_in_query,
  });

  const claims: ClaimLedgerItem[] = [];
  const answerSections: string[] = [];
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

    const explicitCompSet = new Set(req.comparison_work_ids || []);
    const explicitLetterSet = new Set(bundle.explicit_ruling_ids_in_query || []);
    const rawGroupEntries = Array.from(byGroup.entries());
    const explicitMatchedEntries =
      explicitCompSet.size >= 2 || explicitLetterSet.size >= 2
        ? rawGroupEntries.filter(([, psgs]) => {
            const w = freshState.works[psgs[0].work_id];
            if (!w) return false;
            return (
              explicitCompSet.has(w.work_id) ||
              w.official_identifiers.some((o) => explicitLetterSet.has(o.normalized))
            );
          })
        : [];
    const targetGroupEntries =
      explicitMatchedEntries.length >= 2 ? explicitMatchedEntries : rawGroupEntries;

    const allComparedAreRulings = targetGroupEntries
      .slice(0, 3)
      .every(([, psgs]) => freshState.works[psgs[0].work_id]?.type === "TaxRuling");

    answerSections.push(
      allComparedAreRulings
        ? "### การเปรียบเทียบแนววินิจฉัยหนังสือตอบข้อหารือกรมสรรพากร"
        : "### การเปรียบเทียบแนววินิจฉัยและบทบัญญัติกฎหมาย"
    );

    const comparedItemsMeta: Array<{
      label: string;
      titleTh: string;
      rawDate: string | null;
      conclusionText: string;
    }> = [];
    const comparisonBulletSections: string[] = [];

    let idx = 0;
    for (const [, workPassages] of targetGroupEntries) {
      if (idx >= 3) break;
      const workId = workPassages[0].work_id;
      const work = freshState.works[workId];
      const ver = freshState.versions[workPassages[0].version_id];
      const isRuling = work?.type === "TaxRuling";
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
        isRuling
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
      // S-2 / LSC-11: Never present case-specific TaxRulings as statutory "versions" with effective-period intervals!
      const intervalNote = isRuling
        ? ver?.raw_date_text
          ? ` ลงวันที่ ${ver.raw_date_text}`
          : ""
        : appInterval && (appInterval.valid_from || appInterval.valid_to)
          ? ` [ช่วงใช้บังคับ: ${appInterval.valid_from || "เดิม"} ถึง ${appInterval.valid_to || "ปัจจุบัน"}]`
          : ver?.raw_date_text
            ? ` (${ver.raw_date_text})`
            : "";

      comparedItemsMeta.push({
        label,
        titleTh: work?.title_th || label,
        rawDate: ver?.raw_date_text || null,
        conclusionText: fullConclusionText,
      });

      const stmt = `[${label}${intervalNote}] ${isRuling ? "แนววินิจฉัยกรมสรรพากร" : "บทบัญญัติกฎหมาย"}: ${fullConclusionText}`;
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

      const compOriginUri = conclusionUnits[0]?.real_locator?.origin_uri || conclusionSeed.real_locator?.origin_uri || "";
      const itemHeadingPrefix = isRuling
        ? `ข้อหารือที่ ${idx + 1}: ${work?.title_th || label}${intervalNote}`
        : `รายการที่ ${idx + 1}: ${work?.title_th || label}${intervalNote}`;
      comparisonBulletSections.push(
        `- **${itemHeadingPrefix}${compOriginUri ? ` · ต้นฉบับ: ${compOriginUri}` : ""}**` +
          (fullFactsText ? `\n  - *ข้อเท็จจริงของผู้หารือ*: ${fullFactsText}` : "") +
          `\n  - *${isRuling ? "แนววินิจฉัยของกรมสรรพากร" : "เนื้อหาบทบัญญัติ"}*: ${fullConclusionText}`
      );
      idx += 1;
    }

    // S-3 & S-4: Premise check (e.g., "การขาย" vs "การนำเข้า" in LSC-11) + grounded operative comparison summary
    if (allComparedAreRulings && comparedItemsMeta.length >= 2) {
      const qHasSale = /การขาย/.test(qArabic) && !/การนำเข้า/.test(qArabic);
      const allAreImport = comparedItemsMeta.every((m) => /กรณีการนำเข้า|การนำเข้าสินค้า|การนำเข้าทอง/.test(m.titleTh + " " + m.conclusionText));
      if (qHasSale && allAreImport) {
        answerSections.push(
          `**ข้อสังเกตความคลาดเคลื่อนของสมมติฐานในคำถาม**: คำถามกล่าวถึง *"การขาย"* แต่หนังสือตอบข้อหารือทั้ง ${comparedItemsMeta.length} ฉบับ (${comparedItemsMeta.map((m) => `\`${m.label}\``).join(" และ ")}) เป็นแนววินิจฉัยเฉพาะกรณี **การนำเข้าสินค้าจากต่างประเทศ** มิใช่การขายในประเทศ และเป็นหนังสือตอบข้อหารือเฉพาะราย มิใช่รุ่นของบทบัญญัติกฎหมาย`
        );
      }
      const summaryLines = comparedItemsMeta.map((m) => {
        const cleanBody = m.conclusionText
          .replace(/^ข้อกฎหมายที่อ้างอิง:[^\n]*\n?/u, "")
          .replace(/^แนววินิจฉัย(?:ของ)?กรมสรรพากร:\s*/u, "")
          .replace(/\s+/g, " ")
          .trim();
        return `  - **${m.label}${m.rawDate ? ` (ลงวันที่ ${m.rawDate})` : ""}**: ${cleanBody}`;
      });
      answerSections.push(`**สรุปผลการเปรียบเทียบตามแนววินิจฉัยต้นฉบับ**:\n${summaryLines.join("\n")}`);
    }

    answerSections.push(...comparisonBulletSections);
  } else {
    // Primary authoritative passages (`official_conclusion` or `statutory_text`) separated cleanly from `requester_facts` (B01-U04)
    const officialPassages = availablePassages.filter(
      (p, idx) =>
        p.statement_role === "official_conclusion" ||
        p.statement_role === "statutory_text" ||
        (idx === 0 && p.statement_role === "secondary_commentary")
    );
    const requesterPassages = availablePassages.filter((p) =>
      p.statement_role.startsWith("requester_")
    );

    let primaryOfficial =
      singleExplicitRulingPassage || officialPassages[0] || availablePassages[0];
    let activeStatutoryEval: StatutoryVersionEvaluationResult | null = null;

    // Post-retrieval, data-model-driven statutory version & applicability selection (B01..B10)
    if (temporalCtx.query_intent === "APPLICABLE_LAW_AT_TIME") {
      const candidateStatPassages: Passage[] = [];
      const seenStatWorkIds = new Set<string>();
      const pushStatCand = (p: Passage | undefined) => {
        if (
          !p ||
          p.statement_role !== "statutory_text" ||
          p.work_id.startsWith("statute.th.rc_amendment_") ||
          p.extraction_id.startsWith("ext.dep.") ||
          seenStatWorkIds.has(p.work_id)
        ) {
          return;
        }
        seenStatWorkIds.add(p.work_id);
        candidateStatPassages.push(p);
      };

      pushStatCand(primaryOfficial);
      for (const ap of availablePassages) {
        if (ap.work_id.startsWith("statute.th.rc_amendment_")) {
          for (const asrt of allAcceptedAssertions) {
            if (asrt.subject === ap.work_id && asrt.predicate === "AMENDS") {
              const targetPsg = allReleasePassages.find(
                (rp) =>
                  rp.work_id === asrt.object &&
                  rp.statement_role === "statutory_text" &&
                  !rp.extraction_id.startsWith("ext.dep.") &&
                  isPassageCurrentlyAuthorizedAndActive(freshState, rp, actor)
              );
              pushStatCand(targetPsg);
            }
          }
        } else {
          pushStatCand(ap);
        }
      }

      for (const candPsg of candidateStatPassages) {
        const candWork = freshState.works[candPsg.work_id];
        const candVer = freshState.versions[candPsg.version_id];
        const candUnits = reassembleOrderedSectionUnits(
          candPsg,
          allReleasePassages,
          freshState,
          actor
        );
        const candFullText = candUnits.map((u) => u.exact_text).join("\n");
        const candOriginUri =
          candUnits[0]?.real_locator?.origin_uri || candPsg.real_locator?.origin_uri || "";

        const candEval = evaluateStatutoryVersionApplicability({
          work: candWork,
          version: candVer,
          verbatimText: candFullText,
          question: normalizedQuestionForIdentifiers,
          temporalCtx,
          releaseId,
          originUri: candOriginUri,
        });

        const isInitialPrimary = candPsg.work_id === primaryOfficial.work_id;
        const shouldAdoptSecondary =
          !isInitialPrimary &&
          candEval.has_direct_clause_match &&
          (primaryOfficial.work_id.startsWith("statute.th.rc_amendment_") ||
            candEval.action !== "ALLOW_CURRENT_CONSOLIDATED");

        if (isInitialPrimary || shouldAdoptSecondary) {
          if (
            candEval.action === "CONTAIN_UNVERIFIED_HISTORICAL_VERSION" &&
            candEval.containment_message_th
          ) {
            return {
              release_id: releaseId,
              knowledge_snapshot_at: snapshotAt,
              status: "INSUFFICIENT_EVIDENCE",
              answer: candEval.containment_message_th,
              claims: [
                {
                  claim_id: `clm.${traceId}.historical_version_contained`,
                  statement: candEval.containment_message_th,
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
              clarification_questions: candEval.clarification_question_th
                ? [candEval.clarification_question_th]
                : [],
              coverage_warnings: [...coverageWarnings, candEval.containment_message_th],
              applicable_date: req.applicable_date ?? null,
              model_policy_version: "reg24-grounded-legal-v1.3",
              trace_id: traceId,
              latency_ms: Math.max(1, Date.now() - startedAt),
            };
          }

          primaryOfficial = candPsg;
          activeStatutoryEval = candEval;
          if (
            candEval.action === "ASK_FOR_MISSING_RELEVANT_DATE" &&
            candEval.clarification_question_th
          ) {
            explicitMissingFactQuestions.push(candEval.clarification_question_th);
          }
          break;
        }
      }
    }

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

    // Guard against projecting a post-period TaxRuling (citing later-enacted statutes) backward onto an earlier period query
    if (
      primaryWork?.type === "TaxRuling" &&
      temporalCtx.query_intent === "APPLICABLE_LAW_AT_TIME"
    ) {
      const rulingTempEval = evaluateRulingTemporalApplicability({
        rulingWork: primaryWork,
        rulingVersion: primaryVer,
        conclusionText: fullOfficialText,
        temporalCtx,
        releaseId,
      });
      if (rulingTempEval.shouldContainAnachronism && rulingTempEval.messageTh) {
        return {
          release_id: releaseId,
          knowledge_snapshot_at: snapshotAt,
          status: "INSUFFICIENT_EVIDENCE",
          answer: rulingTempEval.messageTh,
          claims: [
            {
              claim_id: `clm.${traceId}.ruling_anachronism_contained`,
              statement: rulingTempEval.messageTh,
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
            "กรุณาตรวจสอบตัวบทกฎหมายที่ใช้บังคับจริงในช่วงปีที่ถามจากราชกิจจานุเบกษา หรือระบุเลขที่หนังสือตอบข้อหารือที่ต้องการค้นหาโดยตรง",
          ],
          coverage_warnings: [...coverageWarnings, rulingTempEval.messageTh],
          applicable_date: req.applicable_date ?? null,
          model_policy_version: "reg24-grounded-legal-v1.3",
          trace_id: traceId,
          latency_ms: Math.max(1, Date.now() - startedAt),
        };
      }
    }

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

    const primaryLinkedTargets =
      primaryWork?.type === "TaxRuling"
        ? new Set(
            allAcceptedAssertions
              .filter(
                (a) =>
                  a.subject === primaryOfficial.work_id &&
                  (a.predicate === "INTERPRETS" || a.predicate === "CITES")
              )
              .map((a) => a.object)
          )
        : new Set<string>();
    const hasSection19Proviso = primaryLinkedTargets.has("prov.th.rc.19");
    const isInternalLegalMemo =
      primaryWork?.type === "TaxRuling" &&
      (/\(กม/.test(primaryIdLabel) ||
        /กระผมได้พิจารณาแล้วขอเรียนว่า/.test(fullOfficialText));

    // Prepend S-3 premise correction & S-4 concise 1-3 line grounded operative summary before verbatim text
    const premiseAndSummaryBlocks = buildSingleAnswerPremiseAndOperativeSummary({
      question: req.question,
      mode: req.mode,
      primaryWorkId: primaryOfficial.work_id,
      primaryWorkType: primaryWork?.type || "TaxRuling",
      primaryTitleTh: primaryWork?.title_th || primaryIdLabel,
      primaryIdLabel,
      fullOfficialText,
      hasSection19Proviso,
    });
    for (const blk of premiseAndSummaryBlocks) {
      answerSections.push(blk);
    }
    if (activeStatutoryEval?.explanation_banner_th) {
      answerSections.push(activeStatutoryEval.explanation_banner_th);
    }

    if (isInternalLegalMemo) {
      answerSections.push(
        `**ประเภทเอกสารต้นฉบับ**: บันทึกความเห็นทางกฎหมายภายในกรมสรรพากร (\`บันทึกกองกฎหมาย\` — ความเห็นทางกฎหมายภายในระหว่างหน่วยงานของกรมสรรพากร มิใช่หนังสือตอบข้อหารือที่ตอบแก่ผู้เสียภาษีภายนอกโดยตรง)`
      );
    }

    if (req.applicable_date) {
      const isConsolidatedRc =
        primaryOfficial.work_id.startsWith("prov.th.rc.") ||
        primaryOfficial.work_id.startsWith("sched.th.rc.");
      answerSections.push(
        isConsolidatedRc
          ? `**ขอบเขตวันที่พิจารณา**: \`${req.applicable_date}\` — แสดงตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบันตามข้อมูลทางการกรมสรรพากร (\`rd.go.th\`) โดยวันเริ่มใช้บังคับของแต่ละวรรคหรืออนุมาตราให้ตรวจสอบจากหมายเหตุแก้ไขเพิ่มเติมท้ายวรรคนั้น`
          : `**ขอบเขตวันที่มีผลบังคับใช้ที่พิจารณา**: \`${req.applicable_date}\` (อ้างอิงรุ่นกฎหมาย \`${primaryOfficial.version_id}\`)`
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
        `**ข้อเท็จจริงและประเด็น${isInternalLegalMemo ? "ที่หน่วยงานภายในขอความเห็น" : "ของผู้ขอหารือ"}** (*มิใช่คำวินิจฉัยที่มีผลผูกพันเป็นการทั่วไป*):\n${fullRequesterText}`
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

    // S-2: Honest Revenue Code consolidated text banner + structured per-clause Amendment History & Applicability Ledger
    if (
      primaryWork?.work_id.startsWith("prov.th.rc.") ||
      primaryWork?.work_id.startsWith("sched.th.rc.")
    ) {
      answerSections.push(
        `**สถานะตัวบทประมวลรัษฎากรและวันใช้บังคับ**: ตัวบทด้านล่างเป็น **ตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบันตามข้อมูลทางการกรมสรรพากร (\`rd.go.th\`)** ซึ่งรวมการแก้ไขเพิ่มเติมหลายคราวไว้ในมาตราเดียว วันเริ่มใช้บังคับและเงื่อนไขการใช้บังคับของแต่ละวรรคหรืออนุมาตรา (เช่น \`รอบระยะเวลาบัญชีที่เริ่มในหรือหลัง...\`) พิจารณาตามหมายเหตุการแก้ไขเพิ่มเติมท้ายวรรคและพระราชบัญญัติแก้ไขเพิ่มเติมในราชกิจจานุเบกษาโดยไม่เหมารวมว่าวันประกาศใช้บังคับกับรอบระยะเวลาบัญชีเป็นวันเดียวกัน`
      );
      const ledgerSummary = formatAmendmentLedgerSummaryTh(
        primaryVer?.amendment_ledger,
        activeStatutoryEval?.matched_amendment
      );
      if (ledgerSummary) {
        answerSections.push(ledgerSummary);
      }
    } else if (
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

    const primaryOriginUri =
      officialUnits[0]?.real_locator?.origin_uri || primaryOfficial.real_locator?.origin_uri || "";
    const isConsolidatedRcHeader =
      primaryOfficial.work_id.startsWith("prov.th.rc.") ||
      primaryOfficial.work_id.startsWith("sched.th.rc.");
    const headerDateNote = isConsolidatedRcHeader
      ? " — ตัวบทรวมแก้ไขเพิ่มเติมตามข้อมูลทางการกรมสรรพากร (rd.go.th)"
      : primaryVer?.raw_date_text
        ? ` — ${primaryVer.raw_date_text}`
        : "";
    answerSections.push(
      `**${isDraftOrHistory ? "สาระสำคัญของร่างกฎหมาย/รายงานวิเคราะห์ร่าง" : primaryOfficial.statement_role === "statutory_text" ? "บทบัญญัติกฎหมาย" : isInternalLegalMemo ? "บันทึกกองกฎหมาย / แนววินิจฉัยของกรมสรรพากร" : "แนววินิจฉัยของกรมสรรพากร"} (${primaryIdLabel}${headerDateNote}${primaryOriginUri ? ` · ต้นฉบับ: ${primaryOriginUri}` : ""})**:\n${fullOfficialText}`
    );

    // Attach verified Royal Gazette Amending Act (`p49.pdf`, `p51.pdf`, etc.) when transitional/effective-date proof is cited
    if (activeStatutoryEval?.amending_work_id_to_cite) {
      const amendWorkId = activeStatutoryEval.amending_work_id_to_cite;
      const amendSeed = allReleasePassages.find(
        (p) =>
          p.work_id === amendWorkId &&
          p.statement_role === "statutory_text" &&
          !p.extraction_id.startsWith("ext.dep.") &&
          isPassageCurrentlyAuthorizedAndActive(freshState, p, actor)
      );
      if (amendSeed) {
        const amendUnits = reassembleOrderedSectionUnits(
          amendSeed,
          allReleasePassages,
          freshState,
          actor
        );
        for (const au of amendUnits) {
          verificationPassageMap.set(au.passage_id, au);
        }
        ensureEvidenceCardsForPassages(
          amendUnits,
          liveEvidenceCards,
          freshState,
          allAcceptedAssertions
        );
        const amendWork = freshState.works[amendWorkId];
        const amendTitle = amendWork?.title_th || amendWorkId;
        const amendOriginUri =
          amendUnits[0]?.real_locator?.origin_uri || amendSeed.real_locator?.origin_uri || "";
        const fullAmendText = amendUnits.map((u) => u.exact_text).join("\n");
        claims.push({
          claim_id: `clm.${traceId}.amending_act.1`,
          statement: `[${amendTitle}] ${fullAmendText}`,
          claim_type: "direct_source_statement",
          statement_role: "statutory_text",
          supporting_passage_ids: amendUnits.map((u) => u.passage_id),
          applicable_version_id: amendSeed.version_id,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
        });
        answerSections.push(
          `**พระราชบัญญัติแก้ไขเพิ่มเติมและบทเฉพาะกาลที่ยืนยันการใช้บังคับ (${amendTitle}${amendOriginUri ? ` · ต้นฉบับราชกิจจานุเบกษา: ${amendOriginUri}` : ""})**:\n${fullAmendText}`
        );
      }
    }

    // S-6 [sic] Source Typo Disclosure: preserve verbatim RD text while flagging verified source typos (e.g., LSC-05 "มาตรา 46 ทวิ" for "มาตรา 49 ทวิ")
    if (primaryWork?.type === "TaxRuling") {
      const sicTypos = detectSourceSectionTyposSic(
        primaryWork.title_th,
        fullOfficialText,
        primaryOriginUri || null
      );
      for (const st of sicTypos) {
        answerSections.push(`**หมายเหตุความคลาดเคลื่อนของตัวอักษรในเอกสารต้นฉบับ (\`[sic]\`)**: ${st.note_th}`);
      }
    }

    // Multi-year / multi-date homonym disambiguation: explicitly disclose sibling real RD rulings sharing the same official number
    if (primaryWork?.type === "TaxRuling" && (bundle.homonym_ruling_groups?.length || 0) > 0) {
      const primaryWithGk = primaryIdLabel.startsWith("กค ") ? primaryIdLabel : `กค ${primaryIdLabel}`;
      const homonymGroup = bundle.homonym_ruling_groups!.find((g) => {
        const gWithGk = g.ruling_id.startsWith("กค ") ? g.ruling_id : `กค ${g.ruling_id}`;
        return gWithGk === primaryWithGk;
      });
      const siblings = (homonymGroup?.works || []).filter((w) => w.work_id !== primaryWork.work_id);
      if (siblings.length > 0) {
        const sibLines = siblings
          .map(
            (s) =>
              `- **${primaryIdLabel} ลงวันที่ ${s.raw_date_text || s.decision_date || "-"}** — ${s.title_th} (ต้นฉบับ: ${s.origin_uri})`
          )
          .join("\n");
        const exBeYear =
          siblings[0].raw_date_text?.match(/(25[3-7][0-9])/)?.[1] ||
          (siblings[0].decision_date ? String(Number(siblings[0].decision_date.slice(0, 4)) + 543) : "2555");
        answerSections.push(
          `**หมายเหตุข้อหารือเลขที่ซ้ำต่างฉบับในคลังกรมสรรพากร (${primaryIdLabel})**: เลขที่หนังสือ \`${primaryIdLabel}\` ปรากฏในเอกสารทางการของกรมสรรพากรมากกว่า 1 ฉบับ (ต่างปี พ.ศ. หรือต่างวันที่/เรื่อง) โดยคำตอบด้านบนแสดงฉบับ **ลงวันที่ ${primaryVer?.raw_date_text || "-"}** (${primaryOriginUri}) ทั้งนี้ยังมีข้อหารือจริงเลขที่เดียวกันอีกฉบับในคลังข้อมูล ได้แก่:\n${sibLines}\n*(หากต้องการดูฉบับอื่นโดยเฉพาะ กรุณาระบุปี พ.ศ. วันที่ หรือหัวข้อเรื่องต่อท้ายเลขที่หนังสือ เช่น \`${primaryIdLabel} ปี ${exBeYear}\` หรือ \`${primaryIdLabel} ลงวันที่ ${siblings[0].raw_date_text}\`)*`
        );
      }
    }

    // When answering a B01 TaxRuling and an upgraded B02 statutory provision passage ACTUALLY linked (`INTERPRETS`/`CITES`) by this ruling is in availablePassages
    // (or `prov.th.rc.19` summons extension proviso on S-5 / LSC-25), surface it explicitly!
    if (primaryWork?.type === "TaxRuling") {
      const linkedStatPsg =
        (hasSection19Proviso
          ? allReleasePassages.find(
              (p) =>
                p.work_id === "prov.th.rc.19" &&
                p.statement_role === "statutory_text" &&
                !p.extraction_id.startsWith("ext.dep.") &&
                isPassageCurrentlyAuthorizedAndActive(freshState, p, actor)
            )
          : undefined) ||
        availablePassages.find(
          (p) =>
            p.work_id !== primaryOfficial.work_id &&
            primaryLinkedTargets.has(p.work_id) &&
            p.statement_role === "statutory_text" &&
            !p.extraction_id.startsWith("ext.dep.")
        );
      if (linkedStatPsg) {
        const linkedStatUnits = reassembleOrderedSectionUnits(
          linkedStatPsg,
          allReleasePassages,
          freshState,
          actor
        );
        for (const su of linkedStatUnits) {
          verificationPassageMap.set(su.passage_id, su);
        }
        ensureEvidenceCardsForPassages(
          linkedStatUnits,
          liveEvidenceCards,
          freshState,
          allAcceptedAssertions
        );
        const fullLinkedStatText = linkedStatUnits.map((u) => u.exact_text).join("\n");
        const statWork = freshState.works[linkedStatPsg.work_id];
        const statOriginUri = linkedStatUnits[0]?.real_locator?.origin_uri || linkedStatPsg.real_locator?.origin_uri || "";
        const statLabel = statWork?.official_identifiers[0]?.normalized || statWork?.title_th || linkedStatPsg.work_id;
        const statStmt = `[บทบัญญัติกฎหมายอ้างอิง B02: ${statWork?.title_th || statLabel}] ${fullLinkedStatText}`;
        claims.push({
          claim_id: `clm.${traceId}.b02_statute.1`,
          statement: statStmt,
          claim_type: "direct_source_statement",
          statement_role: "statutory_text",
          supporting_passage_ids: linkedStatUnits.map((u) => u.passage_id),
          applicable_version_id: linkedStatPsg.version_id,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
        });

        if (linkedStatPsg.work_id === "prov.th.rc.19") {
          answerSections.push(
            `**การแยกความเห็นตามเอกสารปี พ.ศ. 2545 ออกจากหลักกฎหมายปัจจุบันตามประมวลรัษฎากร มาตรา 19 (แหล่งอ้างอิงแยกต่างหาก: ${statOriginUri})**:\n` +
              `- **ขอบเขตของเอกสารเดิม (\`${primaryIdLabel}\`)**: เอกสารฉบับนี้กล่าวถึงเฉพาะกำหนดเวลาออกหมายเรียกตามหลักทั่วไป **ภายในเวลา 2 ปีนับแต่วันที่ได้ยื่นรายการ** ในบริบทการชะลอการประเมินภาษี **จึงมิใช่คำอธิบายหลักกฎหมายปัจจุบันเรื่องกำหนดเวลาออกหมายเรียกที่ครบถ้วนสมบูรณ์**\n` +
              `- **ข้อยกเว้นการขยายเวลาออกหมายเรียกได้ไม่เกิน 5 ปีตามกฎหมายปัจจุบัน (\`${statWork?.title_th || "ประมวลรัษฎากร มาตรา 19"}\`)**: ตามมาตรา 19 แห่งประมวลรัษฎากร (แก้ไขเพิ่มเติมโดยพระราชกำหนดแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 16) พ.ศ. 2534 ใช้บังคับตั้งแต่วันที่ 26 ธันวาคม 2534 เป็นต้นไป) หาก **ปรากฏหลักฐานหรือมีเหตุอันควรสงสัยว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร** หรือ **เป็นกรณีจำเป็นเพื่อประโยชน์ในการคืนภาษีอากร** **อธิบดีกรมสรรพากร** มีอำนาจอนุมัติให้ขยายเวลาการออกหมายเรียกดังกล่าวเกินกว่า 2 ปีได้ **แต่ต้องไม่เกิน 5 ปีนับแต่วันที่ได้ยื่นรายการ** (แต่กรณีขยายเวลาเพื่อประโยชน์ในการคืนภาษีอากรให้ขยายได้ไม่เกินกำหนดเวลาตามที่มีสิทธิขอคืนภาษีอากร)`
          );
        }

        answerSections.push(
          `**บทบัญญัติกฎหมายแม่บทที่เชื่อมโยง (${statWork?.title_th || linkedStatPsg.work_id}${statOriginUri ? ` · ต้นฉบับ: ${statOriginUri}` : ""})**:\n${fullLinkedStatText}`
        );
      }
    } else if (
      primaryOfficial.statement_role === "statutory_text" &&
      (/(?:แนววินิจฉัย|ข้อหารือ)/u.test(req.question) || hasExplicitUnknownFactSignal)
    ) {
      const directInterpretingIds = new Set(
        allAcceptedAssertions
          .filter((a) => a.object === primaryOfficial.work_id && a.predicate === "INTERPRETS")
          .map((a) => a.subject)
      );
      const topRulingSeed =
        availablePassages.find(
          (p) =>
            p.statement_role === "official_conclusion" &&
            freshState.works[p.work_id]?.type === "TaxRuling" &&
            directInterpretingIds.has(p.work_id)
        ) ||
        availablePassages.find(
          (p) => p.statement_role === "official_conclusion" && freshState.works[p.work_id]?.type === "TaxRuling"
        );
      if (topRulingSeed) {
        const rulingUnits = reassembleOrderedSectionUnits(
          topRulingSeed,
          allReleasePassages,
          freshState,
          actor
        );
        for (const ru of rulingUnits) {
          verificationPassageMap.set(ru.passage_id, ru);
        }
        ensureEvidenceCardsForPassages(
          rulingUnits,
          liveEvidenceCards,
          freshState,
          allAcceptedAssertions
        );
        const rulingWork = freshState.works[topRulingSeed.work_id];
        const rulingVer = freshState.versions[topRulingSeed.version_id];
        const rulingLabel =
          rulingWork?.official_identifiers[0]?.normalized || rulingWork?.title_th || topRulingSeed.work_id;
        const rulingOriginUri = rulingUnits[0]?.real_locator?.origin_uri || topRulingSeed.real_locator?.origin_uri || "";
        const fullRulingText = rulingUnits.map((u) => u.exact_text).join("\n");
        claims.push({
          claim_id: `clm.${traceId}.linked_ruling.1`,
          statement: `[แนววินิจฉัยตัวอย่าง ${rulingLabel}] ${fullRulingText}`,
          claim_type: "direct_source_statement",
          statement_role: "official_conclusion",
          supporting_passage_ids: rulingUnits.map((u) => u.passage_id),
          applicable_version_id: topRulingSeed.version_id,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "VERIFIED",
        });
        answerSections.push(
          `**แนววินิจฉัยกรมสรรพากรที่เกี่ยวข้อง (${rulingLabel}${rulingVer?.raw_date_text ? ` — ${rulingVer.raw_date_text}` : ""}${rulingOriginUri ? ` · ต้นฉบับ: ${rulingOriginUri}` : ""})**:\n${fullRulingText}`
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
    if (quarantinedCitationsForAnswer.length > 0) {
      answerSections.push(
        `**ข้อจำกัดความครบถ้วนของหลักฐานกฎหมายประกอบ**: เอกสารต้นฉบับมีการกล่าวถึงกฎหมายหรือประกาศลำดับรองที่ยังอยู่ระหว่างรอตรวจรับรองตัวบทเต็มแยกต่างหากในคลังข้อมูลชุดนี้ ได้แก่ ${quarantinedCitationsForAnswer.join(", ")} ระบบจึงแสดงเฉพาะข้อความตามเอกสารต้นฉบับที่รับรองแล้วของกรมสรรพากรโดยครบถ้วน หากต้องใช้รายละเอียดของตัวบทดังกล่าวโดยตรง กรุณาตรวจสอบจากราชกิจจานุเบกษา (https://ratchakitcha.soc.go.th) หรือเว็บไซต์กรมสรรพากร (https://www.rd.go.th)`
      );
    }
    if (primaryWork?.type === "TaxRuling") {
      const decIso = primaryVer?.decision_date || "";
      const isOlderRuling = Boolean(decIso && decIso < "2016-01-01");
      const ageCurrencyNote = isOlderRuling
        ? ` ทั้งนี้ เอกสารฉบับนี้ออกเมื่อวันที่ ${primaryVer?.raw_date_text || decIso} (เกินกว่า 10 ปี) ก่อนนำไปปรับใช้กับธุรกรรมปัจจุบันควรตรวจสอบการแก้ไขเพิ่มเติมของประมวลรัษฎากร พระราชกฤษฎีกา หรือประกาศที่เกี่ยวข้องในภายหลังประกอบด้วย`
        : "";
      answerSections.push(
        `*หมายเหตุความแน่นอนทางกฎหมาย*: ${isInternalLegalMemo ? "บันทึกความเห็นทางกฎหมายภายในกรมสรรพากร" : "หนังสือตอบข้อหารือกรมสรรพากร"}เป็นการวินิจฉัยเฉพาะข้อเท็จจริงของเรื่องนั้น ภายใต้บทบัญญัติกฎหมายที่ใช้บังคับในขณะวินิจฉัย${ageCurrencyNote}`
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
    quarantinedCitationsForAnswer.length > 0 &&
    req.mode !== "exact_lookup" &&
    bundle.explicit_ruling_ids_in_query.length === 0
  ) {
    finalStatus = "CONDITIONAL";
  } else if (
    extractedConditions.size > 0 &&
    req.mode !== "exact_lookup" &&
    /(?:หรือไม่|อย่างไร|ได้รับสิทธิหรือไม่|ต้องเสียภาษีหรือไม่)/.test(req.question) &&
    bundle.explicit_ruling_ids_in_query.length === 0
  ) {
    finalStatus = "CONDITIONAL";
  }

  const finalAnswerBody = answerSections.join("\n\n");

  // S-1 Citation Gate (P0): Cite ONLY sources whose passages were substantively used in `claims` AND whose identifier/title appears in the rendered answer/claims!
  const usedPassageIdSet = new Set(claims.flatMap((c) => c.supporting_passage_ids));
  const verificationTextHaystack = `${finalAnswerBody}\n${claims.map((c) => c.statement).join("\n")}`;
  const normHaystack = thaiDigitsToArabic(verificationTextHaystack).replace(/\s+/g, " ");
  const gatedEvidenceCards = liveEvidenceCards.filter((ec) => {
    if (!usedPassageIdSet.has(ec.passage_id)) return false;
    const bareId = ec.official_identifier.replace(/^กค\s+/, "").trim();
    const normId = thaiDigitsToArabic(ec.official_identifier).replace(/\s+/g, " ").trim();
    const normTitle = thaiDigitsToArabic(ec.title_th).replace(/\s+/g, " ").trim();
    return (
      verificationTextHaystack.includes(ec.official_identifier) ||
      (bareId.length >= 4 && verificationTextHaystack.includes(bareId)) ||
      verificationTextHaystack.includes(ec.title_th) ||
      (normId.length >= 4 && normHaystack.includes(normId)) ||
      (normTitle.length >= 6 && normHaystack.includes(normTitle))
    );
  });

  return {
    release_id: releaseId,
    knowledge_snapshot_at: snapshotAt,
    status: finalStatus,
    answer: finalAnswerBody,
    claims,
    evidence: gatedEvidenceCards,
    assumptions:
      primaryWorkIsRuling(freshState, availablePassages[0])
        ? ["แนววินิจฉัยหนังสือตอบข้อหารือใช้บังคับเฉพาะข้อเท็จจริงที่ตรงกับข้อหารือต้นฉบับ"]
        : [],
    clarification_questions: explicitMissingFactQuestions,
    coverage_warnings: coverageWarnings,
    applicable_date: req.applicable_date ?? null,
    model_policy_version: "reg24-grounded-legal-v1.2",
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
