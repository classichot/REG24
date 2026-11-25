/**
 * REG24 Batch 1 — Candidate 8 regression suite (failing-before on frozen Candidate 7 `7e2359e`).
 *
 * A. Adopted-child follow-up (`trc.c33cad106d7d9d` / `ans.trc.7854928e0b426f.r2`):
 *    The persisted r2 warning ("ระงับประเด็นร่าง (issue_1_transferor_pit_and_wht): UNGROUNDED_LEGAL_IDENTIFIER ...
 *    ไม่มีข้อความหลักฐานและรุ่นกฎหมายที่ตรวจสอบแล้วรองรับในประเด็นนี้") is emitted ONLY by the strict issue-level
 *    authority audit (`grounded-llm-verifier.ts` withhold after `verifyClaimAgainstPassages` had PASSED).
 *    The raw draft sentence was not persisted in Neon, so this suite replays the draft shapes consistent with
 *    that evidence (all identifiers present in the supplied packet):
 *      A1. `พระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 ตามมาตรา 50 (5) (ข)` — Revenue Code section following the
 *          RD 165 cross-reference was misread as a fabricated RD 165 section.
 *      A2. `มาตรา 48 (4/1)` cited to explain the 5% route no longer applies, while the governing `(4/1)` unit
 *          (already in the packet) was not attached to the issue — binder never attached it.
 *      A3. An unsupported ruling inside an incidental parenthetical must be removed while the independently
 *          supported donor analysis survives.
 *    Plus guards: genuine RD 165 section fabrication still withheld; stale Turn-1 ฿100,000 never published.
 * B. VAT explanation: amending decree commencement (มาตรา 2) kept separate from the period restated in the
 *    amended RD 646 §4 text — in BOTH the evidence and the rendered answer.
 * C. Short-date isolation: `5 พ.ย. 69` == `5 พฤศจิกายน 2569`; goods tax point = earliest §78(1) event;
 *    ambiguous / yearless dates never pick a decree.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEssentialIssueSurfaceText } from "../../src/core/knowledge/authority-surface-auditor";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import {
  reopenSavedTraceableAnswer,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import type { Actor } from "../../src/core/knowledge/contracts";
import type {
  GroundedLlmDraftResponse,
  LlmDraftedIssue,
} from "../../src/core/knowledge/grounded-llm-drafter";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

const TEST_ACTOR: Actor = {
  actor_id: "cand8.regression.test@reg24.internal",
  role: "reader",
  tenant_id: "tenant.trial.cand8",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

// Exact QA prompts (trc.7854928e0b426f -> trc.c33cad106d7d9d)
const M1T3_TURN1 =
  "[QA-SYNTHETIC C7 M1T3] นายทดสอบ ใจดี จดทะเบียนโอนที่ดินพร้อมอาคารพาณิชย์ในจังหวัดเชียงรายให้นายภูผา ซึ่งเป็นบุตรชายชอบด้วยกฎหมาย (ไม่ใช่บุตรบุญธรรม) โดยไม่มีค่าตอบแทน เมื่อวันที่ 20 กุมภาพันธ์ 2569 ราคาประเมินทุนทรัพย์ของทางราชการในการจดทะเบียนคือ 22,000,000 บาท ปีนั้นไม่มีการโอนอสังหาริมทรัพย์อื่นให้นายภูผา ใครต้องเสียภาษีเงินได้ และต้องหักภาษี ณ ที่จ่ายในวันจดทะเบียนเท่าใด";
const M1T3_R1_ASSISTANT =
  "นายทดสอบ ใจดี ต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียน 100,000 บาท (ร้อยละ 5 ของส่วนที่เกิน 20,000,000 บาท คือ 2,000,000 บาท) ตามมาตรา 50 (6) และมาตรา 48 (4/1) ส่วนนายภูผาบุตรชอบด้วยกฎหมายไม่ต้องเสียภาษีเงินได้ตามมาตรา 42 (26)";
const M1T3_TURN2 =
  "ขอแก้ข้อเท็จจริง: นายภูผาเป็นบุตรบุญธรรมที่จดทะเบียนรับเป็นบุตรบุญธรรมถูกต้องตามกฎหมาย ไม่ใช่บุตรที่ชอบด้วยกฎหมายโดยกำเนิด ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด ผลทางภาษีเปลี่ยนไปอย่างไร";

const P = {
  s41bis: "psg.2d4d9a3802f2f0",
  s49bis: "psg.9ae0fef7dcf0a6",
  s42_26: "psg.c7c4aa1c3ac667",
  s42_27: "psg.56a3c0621dc6fa",
  s48_header: "psg.f8c2b4a868fd22",
  s48_4: "psg.35d2ae2eddfff5",
  s48_unit5: "psg.a5d9ae11eeb4a7",
  s48_4_1: "psg.c9d097123a955c",
  s50_5: "psg.e5b0d991385db2",
  s50_6: "psg.acec8fcd9286c5",
  s54: "psg.1d50736076de47",
};

const DONOR_CONCLUSION =
  "เมื่อนายภูผาเป็นบุตรบุญธรรม นายทดสอบ ใจดี ยังคงเป็นผู้มีเงินได้และต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนจากฐานราคาประเมินทุนทรัพย์ 22,000,000 บาทเต็มจำนวน ตามมาตรา 50 (6) ประกอบมาตรา 50 (5) และมาตรา 48 (4) โดยไม่ได้รับยกเว้นตามมาตรา 42 (26) แต่ยังไม่สามารถคำนวณจำนวนภาษีเป็นตัวเงินได้จนกว่าจะทราบวิธีการได้มาและจำนวนปีที่ถือครอง";

function donorIssue(explanation: string, governing: string[]): LlmDraftedIssue {
  return {
    issue_id: "issue_1_transferor_pit_and_wht",
    issue_title_th: "ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่ายในวันจดทะเบียนของผู้โอน (นายทดสอบ ใจดี)",
    party_or_scope_th: "ผู้โอน (นายทดสอบ ใจดี)",
    conclusion_th: DONOR_CONCLUSION,
    material_facts_relied_on: [
      "ราคาประเมินทุนทรัพย์ 22,000,000 บาท",
      "ผู้รับโอนเป็นบุตรบุญธรรมที่จดทะเบียนถูกต้อง",
    ],
    governing_passage_ids: governing,
    application_explanation_th: explanation,
    authority_distinction_note_th: "",
    proposed_calculation: null,
    missing_facts_or_uncertainties_th: [
      "วิธีการได้มาซึ่งที่ดินพร้อมอาคารพาณิชย์ของผู้โอน",
      "ปีที่ได้กรรมสิทธิ์เพื่อคำนวณจำนวนปีที่ถือครอง",
    ],
  };
}

const S54_ISSUE: LlmDraftedIssue = {
  issue_id: "issue_2_wht_joint_liability",
  issue_title_th: "ความรับผิดกรณีมิได้หักภาษีเงินได้ ณ ที่จ่ายและนำส่งตามมาตรา 54",
  party_or_scope_th: "ผู้จ่ายเงินได้ (ผู้โอน) และผู้มีเงินได้",
  conclusion_th:
    "หากมิได้หักและนำส่งภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนตามมาตรา 50 (6) ประกอบมาตรา 50 (5) หรือหักและนำส่งไม่ครบจำนวนที่ถูกต้อง ผู้จ่ายเงินต้องรับผิดร่วมกับผู้มีเงินได้ในการเสียภาษีตามจำนวนที่มิได้หักและนำส่งหรือที่ขาดไปตามมาตรา 54",
  material_facts_relied_on: ["การโอนอสังหาริมทรัพย์โดยไม่มีค่าตอบแทน"],
  governing_passage_ids: [P.s54, P.s50_5, P.s50_6],
  application_explanation_th:
    "มาตรา 50 (6) ให้ถือว่าผู้โอนเป็นผู้จ่ายเงินได้และต้องหักภาษีตามเกณฑ์ในมาตรา 50 (5) และมาตรา 54 กำหนดให้ผู้จ่ายเงินที่มิได้หักและนำเงินส่งต้องรับผิดร่วมกับผู้มีเงินได้",
  authority_distinction_note_th: "",
  proposed_calculation: null,
  missing_facts_or_uncertainties_th: [],
};

const RECIPIENT_ISSUE: LlmDraftedIssue = {
  issue_id: "issue_3_transferee_pit",
  issue_title_th: "ภาระภาษีเงินได้บุคคลธรรมดาของผู้รับโอน (นายภูผา ซึ่งเป็นบุตรบุญธรรม)",
  party_or_scope_th: "ผู้รับโอน (นายภูผา)",
  conclusion_th:
    "ไม่อาจสรุปหรือระบุภาระภาษีเงินได้บุคคลธรรมดาของนายภูผาเป็นตัวเลขใดๆ ได้ เนื่องจากมาตรา 41 ทวิ เป็นบทบัญญัติกำหนดฝั่งผู้โอน และมาตรา 42 (26) ยกเว้นเฉพาะการโอนให้บุตรชอบด้วยกฎหมายซึ่งไม่รวมถึงบุตรบุญธรรม ตัวบทในชุดหลักฐานไม่ได้บัญญัติสรุปภาระภาษีฝั่งผู้รับโอนกรณีบุตรบุญธรรมไว้โดยตรง",
  material_facts_relied_on: ["ผู้รับโอนเป็นบุตรบุญธรรม"],
  governing_passage_ids: [P.s41bis, P.s42_26, P.s42_27],
  application_explanation_th:
    "มาตรา 41 ทวิ ให้ถือว่าผู้โอนเป็นผู้มีเงินได้ ส่วนมาตรา 42 (26) จำกัดข้อยกเว้นเฉพาะบุตรชอบด้วยกฎหมายซึ่งไม่รวมถึงบุตรบุญธรรม จึงไม่อาจระบุภาระภาษีของผู้รับโอนเป็นตัวเลขได้",
  authority_distinction_note_th: "",
  proposed_calculation: null,
  missing_facts_or_uncertainties_th: [],
};

const BASE_EXPLANATION =
  "มาตรา 41 ทวิ ให้ถือว่าผู้โอนเป็นผู้มีเงินได้ และมาตรา 49 ทวิ ให้ใช้ราคาประเมินทุนทรัพย์ 22,000,000 บาท เป็นฐาน เมื่อผู้รับโอนเป็นบุตรบุญธรรม ข้อยกเว้นตามมาตรา 42 (26) และการหักภาษีร้อยละ 5 ของส่วนที่เกินยี่สิบล้านบาทตามมาตรา 50 (6) ตอนท้าย จึงไม่ใช้บังคับ ต้องหักภาษีตามเกณฑ์มาตรา 50 (5) กล่าวคือ (1) หากเป็นอสังหาริมทรัพย์อันเป็นมรดกหรือได้รับจากการให้โดยเสน่หา ให้คำนวณตามมาตรา 50 (5) (ก) ประกอบมาตรา 48 (4) (ก)";

function adoptedDraft(donor: LlmDraftedIssue): GroundedLlmDraftResponse {
  return {
    answer_status: "CONDITIONAL",
    overall_summary_th:
      "เมื่อเปลี่ยนผู้รับโอนเป็นบุตรบุญธรรม ผู้โอนไม่ได้รับยกเว้นและต้องหักภาษี ณ ที่จ่ายตามเกณฑ์ทั่วไป ซึ่งยังคำนวณเป็นตัวเงินไม่ได้จนกว่าจะทราบวิธีการได้มาและปีที่ถือครอง",
    case_facts_used: [],
    issues: [donor, S54_ISSUE, RECIPIENT_ISSUE],
    assumptions_th: [],
    clarification_questions_th: [
      "นายทดสอบ ใจดี ได้กรรมสิทธิ์ในที่ดินพร้อมอาคารพาณิชย์มาโดยวิธีใด (มรดก รับให้ หรือซื้อ)",
      "นายทดสอบ ใจดี ได้กรรมสิทธิ์มาตั้งแต่ปี พ.ศ. ใด",
    ],
    evidence_gaps_th: [
      "ตารางอัตราค่าใช้จ่ายเหมาตามพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 และบัญชีอัตราภาษีเงินได้ไม่ได้รวมอยู่ในชุดหลักฐาน",
    ],
  };
}

describe("Candidate 8 — adopted-child follow-up, VAT commencement wording, short-date isolation", () => {
  let store: DurableKnowledgeStore;
  let tmpDir: string;

  beforeAll(() => {
    process.env.REG24_PINNED_RELEASE_ID = "rel.B01.rc8";
    process.env.REG24_GROUNDED_LLM_STAGING_ENABLED = "true";
    delete process.env.DATABASE_URL;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand8-"));
    fs.cpSync(STAGING_STORE_DIR, tmpDir, { recursive: true });
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    delete process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
    delete process.env.REG24_PINNED_RELEASE_ID;
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const runAdoptedTurn2 = async (draft: GroundedLlmDraftResponse, label: string) =>
    queryKnowledge(
      {
        question: M1T3_TURN2,
        release_id: "rel.B01.rc8",
        conversation_id: `conv.cand8.adopted.${label}`,
        conversation_history: [
          { role: "user", content: M1T3_TURN1 },
          { role: "assistant", content: M1T3_R1_ASSISTANT },
        ],
        answer_generation_mode: "llm_grounded",
        thinking_level: "low",
      },
      TEST_ACTOR,
      { store, channel: "chat", persistAnswerAtomically: false, llmMockInvokerForTesting: () => draft }
    );

  const donorClaimOf = (res: Awaited<ReturnType<typeof queryKnowledge>>) =>
    res.claims.find((c) => /ผู้โอน/.test(c.statement) && /22,000,000/.test(c.statement) && /50 \(6\)/.test(c.statement));

  it("A1. RD 165 cross-reference followed by a Revenue Code section (`... 2529 ตามมาตรา 50 (5) (ข)`) is NOT a fabricated RD 165 section — donor analysis survives", async () => {
    const explanation = `${BASE_EXPLANATION} หรือ (2) หากได้มาโดยทางอื่นนอกจาก (ก) เช่น การซื้อ ให้หักค่าใช้จ่ายเป็นการเหมาตามพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 ตามมาตรา 50 (5) (ข) ประกอบมาตรา 48 (4) (ข) แล้วหารด้วยจำนวนปีที่ถือครอง`;
    const res = await runAdoptedTurn2(
      adoptedDraft(
        donorIssue(explanation, [P.s41bis, P.s49bis, P.s42_26, P.s48_4_1, P.s48_4, P.s48_unit5, P.s50_5, P.s50_6])
      ),
      "a1"
    );
    expect(res.status).toBe("CONDITIONAL");
    expect(res.claims.length).toBe(3);
    expect(donorClaimOf(res)).toBeDefined();
    expect(res.coverage_warnings.join(" ")).not.toContain("issue_1_transferor_pit_and_wht");
    expect(res.answer).not.toContain("100,000");
    expect(res.clarification_questions.length).toBeGreaterThan(0);

    // Generate -> Save -> exact Reopen agreement for the new answer
    const saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: res.traceable_answer!,
      grounded_answer_snapshot: res,
      question_text: M1T3_TURN2,
      actor: TEST_ACTOR,
      save_operation_key: "op.cand8.adopted.a1",
      query_persistence_context: { conversation_id: "conv.cand8.adopted.a1" },
    });
    expect(saved.status).toBe("partial");
    const reopened = reopenSavedTraceableAnswer(store, saved.answer_revision, TEST_ACTOR);
    expect(reopened.found).toBe(true);
    expect(reopened.answer!.claims.map((c) => c.text)).toEqual(saved.claims.map((c) => c.text));
    expect(reopened.answer!.claims.map((c) => c.evidence_references.map((r) => r.evidence_id))).toEqual(
      saved.claims.map((c) => c.evidence_references.map((r) => r.evidence_id))
    );
    expect(reopened.answer!.status).toBe(saved.status);
  });

  it("A2. `มาตรา 48 (4/1)` cited without attaching the in-packet governing (4/1) unit is bound to that exact unit instead of withholding the donor analysis", async () => {
    const explanation = `${BASE_EXPLANATION} ทั้งนี้ สิทธิเลือกเสียภาษีร้อยละ 5 ตามมาตรา 48 (4/1) ใช้เฉพาะการโอนให้บุตรชอบด้วยกฎหมายซึ่งไม่รวมถึงบุตรบุญธรรม จึงไม่อาจนำมาใช้ในกรณีนี้`;
    const res = await runAdoptedTurn2(
      adoptedDraft(donorIssue(explanation, [P.s41bis, P.s49bis, P.s42_26, P.s48_4, P.s50_5, P.s50_6])),
      "a2"
    );
    const donor = donorClaimOf(res);
    expect(donor).toBeDefined();
    expect(donor!.supporting_passage_ids).toContain(P.s48_4_1);
    expect(res.claims.length).toBe(3);
    expect(res.answer).not.toContain("100,000");
  });

  it("A3. An unsupported ruling inside an incidental parenthetical is removed while the independently supported donor analysis is preserved", async () => {
    const explanation = `${BASE_EXPLANATION} (เทียบหนังสือตอบข้อหารือ กค 0702/77777)`;
    const res = await runAdoptedTurn2(
      adoptedDraft(
        donorIssue(explanation, [P.s41bis, P.s49bis, P.s42_26, P.s48_4_1, P.s48_4, P.s50_5, P.s50_6])
      ),
      "a3"
    );
    expect(donorClaimOf(res)).toBeDefined();
    expect(res.answer).not.toContain("77777");
  });

  it("A4 (guard). Genuine RD 165 section fabrication is still withheld; §54 and recipient issues survive independently", async () => {
    const explanation = `${BASE_EXPLANATION} หรือ (2) หากได้มาโดยการซื้อ ให้หักค่าใช้จ่ายตามพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 มาตรา 4 ซึ่งกำหนดอัตราร้อยละ 92`;
    const res = await runAdoptedTurn2(
      adoptedDraft(
        donorIssue(explanation, [P.s41bis, P.s49bis, P.s42_26, P.s48_4_1, P.s48_4, P.s50_5, P.s50_6])
      ),
      "a4"
    );
    expect(donorClaimOf(res)).toBeUndefined();
    expect(res.claims.length).toBe(2);
    expect(res.answer).not.toMatch(/165\)?\s*พ\.ศ\.\s*2529\s*มาตรา\s*4/);
  });

  it("A5 (guard). A stale Turn-1 legitimate-child figure (฿100,000 = 5% of excess) is never published on the adopted-child donor claim", async () => {
    const stale = donorIssue(
      `${BASE_EXPLANATION} โดยภาษีที่ต้องหักคงเป็น 100,000 บาท เช่นเดิม`,
      [P.s41bis, P.s49bis, P.s42_26, P.s48_4_1, P.s48_4, P.s50_5, P.s50_6]
    );
    const res = await runAdoptedTurn2(adoptedDraft(stale), "a5");
    expect(res.answer).not.toContain("100,000");
  });

  it("A6 (unit). Auditor: RD 165 named as cross-reference vs. section attributed to RD 165", () => {
    const st = store.getState();
    const bindings = [P.s50_5, P.s48_4].map((pid) => {
      const p = st.passages[pid];
      return {
        passage_id: p.passage_id,
        work_id: p.work_id,
        version_id: p.version_id,
        official_identifier: st.works[p.work_id]?.official_identifiers[0]?.normalized || null,
        verbatim_text: p.exact_text,
      };
    });
    expect(
      auditEssentialIssueSurfaceText(
        "ให้หักค่าใช้จ่ายเป็นการเหมาตามพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 ตามมาตรา 50 (5) (ข)",
        bindings
      ).ok
    ).toBe(true);
    expect(
      auditEssentialIssueSurfaceText("ให้หักค่าใช้จ่ายตามพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 มาตรา 4", bindings).ok
    ).toBe(false);
    expect(
      auditEssentialIssueSurfaceText("ให้หักค่าใช้จ่ายตามมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529", bindings)
        .ok
    ).toBe(false);
  });

  // ------------------------- B. VAT commencement wording -------------------------
  const vatDraft = (dateTh: string, decree: "799" | "807", endBe: string): GroundedLlmDraftResponse => ({
    answer_status: "ANSWERED",
    overall_summary_th: `ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 เป็นเงิน 3,500 บาท`,
    case_facts_used: [],
    issues: [
      {
        issue_id: "ISSUE_VAT",
        issue_title_th: `อัตราและจำนวนภาษีมูลค่าเพิ่มสำหรับการขายสินค้าวันที่ ${dateTh}`,
        party_or_scope_th: "ผู้ขายสินค้าซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม",
        conclusion_th:
          "ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละ 7.0 (ภาษีมูลค่าเพิ่มร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7) จากฐาน 50,000 บาท คิดเป็นภาษี 3,500 บาท",
        material_facts_relied_on: [`ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ ${dateTh}`],
        governing_passage_ids: [
          "psg.aa853373203223",
          "psg.1b1abb8e7e22df",
          `psg.rc8.rd${decree}.sec_3_quoted_rd646_sec_4`,
          "psg.3d0eb5636faa0e",
        ],
        application_explanation_th: `ตามประมวลรัษฎากร มาตรา 78 (1) ความรับผิดเกิดขึ้นเมื่อส่งมอบสินค้าในวันที่ ${dateTh} และมาตรา 80 ให้ลดอัตราได้โดยพระราชกฤษฎีกา ซึ่งพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ${decree}) ได้ลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บในอัตราร้อยละ 6.3 สำหรับความรับผิดที่เกิดขึ้นตั้งแต่วันที่ 1 ตุลาคม 2560 ถึงวันที่ 30 กันยายน ${endBe} รวมภาษีท้องถิ่นเป็นร้อยละ 7.0 คิดเป็น 3,500 บาท`,
        authority_distinction_note_th: "",
        proposed_calculation: {
          formula_description_th: "50,000 × 7%",
          tax_base_thb: 50000,
          exempt_amount_thb: 0,
          taxable_amount_thb: 50000,
          rate_pct: 7,
          computed_tax_thb: 3500,
          is_computable_from_stated_facts: true,
          missing_inputs_th: [],
          steps_th: ["50,000 × 7% = 3,500 บาท"],
        },
        missing_facts_or_uncertainties_th: [],
      },
    ],
    assumptions_th: [],
    clarification_questions_th: [],
    evidence_gaps_th: [],
  });

  const runVat = async (question: string, draft: GroundedLlmDraftResponse) => {
    let packetIds: string[] = [];
    const res = await queryKnowledge(
      { question, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        onRealAppEvidenceAssembly: (cap) => {
          packetIds = cap.actual_model_packet.map((x) => x.passage_id);
        },
        llmMockInvokerForTesting: () => draft,
      }
    );
    return { res, packetIds };
  };

  for (const c of [
    { date: "5 พฤศจิกายน 2569", decree: "807" as const, endBe: "2570", commencement: /1 ตุลาคม (?:พ\.ศ\. )?2569/ },
    { date: "1 ตุลาคม 2569", decree: "807" as const, endBe: "2570", commencement: /1 ตุลาคม (?:พ\.ศ\. )?2569/ },
    { date: "30 กันยายน 2569", decree: "799" as const, endBe: "2569", commencement: /1 ตุลาคม (?:พ\.ศ\. )?2568/ },
  ]) {
    it(`B. ${c.date} (RD ${c.decree}): evidence binds มาตรา 2 commencement and the answer keeps RD ${c.decree}'s commencement separate from the RD 646 §4 restated period`, async () => {
      const q = `บริษัท ทดสอบ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ ${c.date} ต้องเรียกเก็บภาษีมูลค่าเพิ่มเท่าใด`;
      const { res, packetIds } = await runVat(q, vatDraft(c.date, c.decree, c.endBe));
      expect(packetIds).toContain(`psg.rc8.rd${c.decree}.sec_1_2`);
      expect(res.status).toBe("ANSWERED");
      expect(res.claims[0].supporting_passage_ids).toContain(`psg.rc8.rd${c.decree}.sec_1_2`);
      expect(res.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(3500);
      // Rendered answer: commencement of the amending decree stated, and the 2560 start attributed to RD 646 §4 text
      expect(res.answer).toMatch(c.commencement);
      expect(res.answer).toMatch(/มาตรา 4 แห่ง(?:พระราชกฤษฎีกา|\s*พ\.ร\.ฎ\.)[^\n]{0,60}646/);
      // Never the misleading "(ฉบับที่ N) ... ตั้งแต่วันที่ 1 ตุลาคม 2560" without the RD 646 §4 attribution
      const misleading = new RegExp(
        `\\(ฉบับที่ ${c.decree}\\)\\s*ได้ลดอัตราภาษีมูลค่าเพิ่ม[^()]{0,80}ตั้งแต่วันที่ 1 ตุลาคม 2560`
      );
      expect(res.answer).not.toMatch(misleading);
    });
  }

  // ------------------------- C. Short-date & tax-point isolation -------------------------
  it("C1. `5 พ.ย. 69` and `5 พฤศจิกายน 2569` (identical facts) resolve to the same tax point 2026-11-05", () => {
    const shortQ =
      "ร้านของเราเป็นบริษัทที่จด VAT แล้ว เมื่อวันที่ 5 พ.ย. 69 เราส่งของให้ลูกค้าในไทยพร้อมกับออกใบกำกับภาษีให้ในวันเดียวกัน ค่าสินค้าก่อนบวก VAT คือ 50,000 บาท ต้องคิด VAT เท่าไร";
    const fullQ = shortQ.replace("5 พ.ย. 69", "5 พฤศจิกายน 2569");
    const s = buildStructuredCaseFactLedger({ question: shortQ });
    const f = buildStructuredCaseFactLedger({ question: fullQ });
    expect(f.temporal_facts.controlling_tax_point.iso_date).toBe("2026-11-05");
    expect(s.temporal_facts.controlling_tax_point.iso_date).toBe("2026-11-05");
    expect(s.temporal_facts.controlling_tax_point.is_ambiguous).toBe(false);
  });

  it("C2. Goods sale: tax point is the EARLIEST §78(1) event — delivery/invoice 28 Sep 2569 then payment 15 Oct 2569 => 2026-09-28 (RD 799), never the later payment", () => {
    const q =
      "บริษัทจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ 28 กันยายน 2569 ลูกค้าชำระเงินวันที่ 15 ตุลาคม 2569 ต้องใช้อัตราใด";
    const l = buildStructuredCaseFactLedger({ question: q });
    expect(l.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-28");
  });

  it("C3. Goods sale, full price paid in advance (25 ก.ย. 69) before delivery/invoice (5 พ.ย. 69) => tax point 2026-09-25", () => {
    const q =
      "บริษัทจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ลูกค้าชำระราคาเต็มจำนวน 50,000 บาท ล่วงหน้าเมื่อวันที่ 25 ก.ย. 69 และส่งมอบสินค้าพร้อมออกใบกำกับภาษีวันที่ 5 พ.ย. 69 ต้องใช้อัตราใด";
    const l = buildStructuredCaseFactLedger({ question: q });
    expect(l.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-25");
  });

  it("C4. Advance payment of an unstated amount straddling a decree cutoff => no controlling decree guessed (clarify)", () => {
    const q =
      "บริษัทจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ลูกค้าโอนเงินล่วงหน้ามาบางส่วนเมื่อวันที่ 25 ก.ย. 69 และส่งมอบสินค้าพร้อมออกใบกำกับภาษีวันที่ 5 พ.ย. 69 ต้องใช้อัตราใด";
    const l = buildStructuredCaseFactLedger({ question: q });
    expect(l.temporal_facts.controlling_tax_point.iso_date).toBeNull();
  });

  it("C5. Ambiguous numeric (05/10/69), yearless (5 พ.ย.) and amount-adjacent (5 พ.ย. 50,000 บาท) dates never yield a controlling tax point", () => {
    for (const q of [
      "บริษัทจดทะเบียน VAT ส่งมอบสินค้าวันที่ 05/10/69 ราคา 50,000 บาท ต้องคิด VAT เท่าไร",
      "บริษัทจดทะเบียน VAT ส่งมอบสินค้าวันที่ 5 พ.ย. ราคา 50,000 บาท ต้องคิด VAT เท่าไร",
      "บริษัทจดทะเบียน VAT ส่งมอบสินค้าวันที่ 5 พ.ย. 50,000 บาท ต้องคิด VAT เท่าไร",
    ]) {
      const l = buildStructuredCaseFactLedger({ question: q });
      expect(l.temporal_facts.controlling_tax_point.iso_date, q).toBeNull();
      expect(l.temporal_facts.controlling_tax_point.is_ambiguous, q).toBe(true);
    }
  });

  it("A7. Full r1 (฿100,000 legitimate son) -> r2 (adopted son) revision chain leaves r1 unchanged on Reopen, handles paraphrase & changed-fact variants, and keeps CI1 unsupported rulings rejected", async () => {
    // 1. Save r1 (legitimate son, ฿22M -> ฿2M excess * 5% = ฿100,000)
    const r1Res = await queryKnowledge(
      {
        question: M1T3_TURN1,
        release_id: "rel.B01.rc8",
        conversation_id: "conv.cand8.chain.r1r2",
        answer_generation_mode: "llm_grounded",
        thinking_level: "low",
      },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: () => ({
          answer_status: "ANSWERED",
          overall_summary_th: "นายทดสอบ ใจดี ต้องหักภาษี ณ ที่จ่าย 100,000 บาท",
          case_facts_used: [],
          issues: [
            {
              issue_id: "r1_donor",
              issue_title_th: "ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่ายของผู้โอน",
              party_or_scope_th: "ผู้โอน (นายทดสอบ ใจดี)",
              conclusion_th:
                "สำหรับการโอนที่ดินพร้อมอาคารพาณิชย์ให้บุตรชายชอบด้วยกฎหมาย นายทดสอบ ใจดี ได้รับยกเว้น 20,000,000 บาทแรกตามมาตรา 42 (26) และต้องหักภาษีเงินได้ ณ ที่จ่ายร้อยละ 5 ของส่วนที่เกิน 2,000,000 บาท เป็นเงิน 100,000 บาท ตามมาตรา 50 (6) และมาตรา 48 (4/1)",
              material_facts_relied_on: ["โอนที่ดินพร้อมอาคารพาณิชย์ราคาประเมินทุนทรัพย์ 22,000,000 บาท", "บุตรชายชอบด้วยกฎหมาย"],
              governing_passage_ids: ["psg.067bb96e61ea56", P.s41bis, P.s49bis, P.s42_26, P.s48_4_1, P.s50_6],
              application_explanation_th:
                "ตามมาตรา 41 ทวิ การโอนที่ดินพร้อมอาคารพาณิชย์โดยไม่มีค่าตอบแทนถือว่าผู้โอนเป็นผู้มีเงินได้ และมาตรา 49 ทวิ ให้ใช้ฐานราคาประเมิน 22,000,000 บาท หักส่วนที่ได้รับยกเว้นตามมาตรา 42 (26) จำนวน 20,000,000 บาท คงเหลือส่วนเกิน 2,000,000 บาท คำนวณร้อยละ 5 ตามมาตรา 50 (6) และมาตรา 48 (4/1) เป็นเงิน 100,000 บาท",
              authority_distinction_note_th: "",
              proposed_calculation: {
                formula_description_th: "(22,000,000 - 20,000,000) × 5%",
                tax_base_thb: 22_000_000,
                exempt_amount_thb: 20_000_000,
                taxable_amount_thb: 2_000_000,
                rate_pct: 5,
                computed_tax_thb: 100_000,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["(22,000,000 - 20,000,000) × 5% = 100,000 บาท"],
              },
              missing_facts_or_uncertainties_th: [],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(r1Res.status).toBe("ANSWERED");
    const savedR1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: r1Res.traceable_answer!,
      grounded_answer_snapshot: r1Res,
      question_text: M1T3_TURN1,
      actor: TEST_ACTOR,
      save_operation_key: "op.cand8.chain.r1",
      query_persistence_context: {
        conversation_id: "conv.cand8.chain.r1r2",
        trusted_calculations_by_claim_id: {
          [r1Res.traceable_answer!.claims[0].claim_id]: r1Res.claims[0].bound_calculation!,
        },
        trusted_calculation_tokens_by_claim_id: {
          [r1Res.traceable_answer!.claims[0].claim_id]:
            r1Res.claims[0].verified_calculation_numeric_tokens || [],
        },
      },
    });

    // 2. Paraphrased follow-up -> save r2 superseding r1 -> reopen r2 AND r1
    const paraphrasedTurn2 =
      "หากเปลี่ยนเฉพาะสถานะผู้รับโอนเป็นว่า นายภูผาเป็นบุตรบุญธรรมที่ได้จดทะเบียนรับบุตรบุญธรรมตามกฎหมายแล้ว (มิใช่บุตรชอบด้วยกฎหมาย) ส่วนราคาประเมิน 22 ล้านบาทและข้อเท็จจริงอื่นคงเดิม ภาระภาษีของผู้โอนและผู้รับโอนเปลี่ยนไปอย่างไร";
    const r2Res = await queryKnowledge(
      {
        question: paraphrasedTurn2,
        release_id: "rel.B01.rc8",
        conversation_id: "conv.cand8.chain.r1r2",
        conversation_history: [
          { role: "user", content: M1T3_TURN1 },
          { role: "assistant", content: M1T3_R1_ASSISTANT },
        ],
        answer_generation_mode: "llm_grounded",
        thinking_level: "low",
      },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: () =>
          adoptedDraft(
            donorIssue(
              `${BASE_EXPLANATION} หรือ (2) หากได้มาโดยการซื้อ ให้หักค่าใช้จ่ายเป็นการเหมาตามพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 ตามมาตรา 50 (5) (ข) ประกอบมาตรา 48 (4) (ข)`,
              [P.s41bis, P.s49bis, P.s42_26, P.s48_4_1, P.s48_4, P.s50_5, P.s50_6]
            )
          ),
      }
    );
    expect(r2Res.claims.length).toBe(3);
    expect(r2Res.answer).not.toContain("100,000");

    const savedR2 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: r2Res.traceable_answer!,
      grounded_answer_snapshot: r2Res,
      question_text: paraphrasedTurn2,
      parent_answer_revision: savedR1.answer_revision,
      revision_reason: "Adopted-child follow-up r2",
      actor: TEST_ACTOR,
      save_operation_key: "op.cand8.chain.r2",
      query_persistence_context: {
        conversation_id: "conv.cand8.chain.r1r2",
        prior_saved_answer_revision: savedR1.answer_revision,
        conversation_history: [
          { role: "user", content: M1T3_TURN1 },
          { role: "assistant", content: M1T3_R1_ASSISTANT },
        ],
      },
    });
    expect(savedR2.revision_number).toBe(2);
    expect(savedR2.supersedes_answer_revision).toBe(savedR1.answer_revision);

    const reopenedR2 = reopenSavedTraceableAnswer(store, savedR2.answer_revision, TEST_ACTOR);
    const reopenedR1 = reopenSavedTraceableAnswer(store, savedR1.answer_revision, TEST_ACTOR);
    expect(reopenedR2.found).toBe(true);
    expect(reopenedR2.answer!.claims.length).toBe(3);
    expect(reopenedR2.answer!.rendered_answer_th).not.toContain("100,000");
    expect(reopenedR1.found).toBe(true);
    expect(reopenedR1.answer!.status).toBe("complete");
    expect(reopenedR1.answer!.rendered_answer_th).toContain("100,000");
    expect(reopenedR1.answer!.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(100_000);

    // 3. CI1 unsupported-ruling control remains strictly INSUFFICIENT_EVIDENCE with 0 claims
    const ci1 = await queryKnowledge(
      {
        question:
          "ตามหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/99412 ลงวันที่ 14 พฤศจิกายน 2568 บริษัทไม่ต้องเรียกเก็บภาษีมูลค่าเพิ่มใช่หรือไม่",
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        thinking_level: "low",
      },
      TEST_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: () => ({
          answer_status: "INSUFFICIENT_EVIDENCE",
          overall_summary_th:
            "ไม่พบต้นฉบับหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/99412 ในชุดหลักฐานต้นฉบับที่ตรวจสอบแล้ว จึงไม่อาจยืนยันได้",
          case_facts_used: [],
          issues: [],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: ["ไม่พบต้นฉบับหนังสือตอบข้อหารือ กค 0702/99412 ในคลังหลักฐาน"],
        }),
      }
    );
    expect(ci1.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(ci1.claims.filter((c) => c.verification_result === "VERIFIED").length).toBe(0);
    expect(ci1.traceable_answer!.claims.filter((c) => c.published).length).toBe(0);
    expect(ci1.evidence.length).toBe(0);
  });

  it("B2. Boundary 1 ตุลาคม 2569 when draft already mentions RD 646 §4 (`trc.6dfc5fb1320c50` shape): transaction date `1 ตุลาคม 2569` does NOT suppress stating RD 807's มาตรา 2 commencement separately", async () => {
    const q =
      "บริษัท ทดสอบนกกระติ๊ด จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ส่งมอบสินค้าและออกใบกำกับภาษีในวันเดียวกันคือวันที่ 1 ตุลาคม 2569 ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด ตามพระราชกฤษฎีกาฉบับใด และภาษีขายเป็นเงินเท่าใด";
    const draftAlreadyMentions646 = vatDraft("1 ตุลาคม 2569", "807", "2570");
    draftAlreadyMentions646.issues[0].application_explanation_th =
      "ความรับผิดเกิดขึ้นในวันที่ 1 ตุลาคม 2569 ตามมาตรา 78 (1) ซึ่งอยู่ภายใต้บังคับของพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569 ที่แก้ไขเพิ่มเติมมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 ให้ลดอัตราภาษีมูลค่าเพิ่มและคงจัดเก็บในอัตราร้อยละ 6.3 สำหรับความรับผิดที่เกิดขึ้นตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2560 ถึงวันที่ 30 กันยายน พ.ศ. 2570 รวมภาษีท้องถิ่นเป็นร้อยละ 7.0 คิดเป็น 3,500 บาท";
    const { res } = await runVat(q, draftAlreadyMentions646);
    expect(res.status).toBe("ANSWERED");
    expect(res.claims[0].supporting_passage_ids).toContain("psg.rc8.rd807.sec_1_2");
    expect(res.answer).toMatch(/ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม (?:พ\.ศ\. )?2569 ตามมาตรา 2/);
  });

  it("D. Editorial-only (`พรฎ.479`, `พรฎ.376`, `ป.120/2545`), wrong-version (`พรฎ.799` on 5 Nov 2569), and unrelated (`พรฎ.342` on VAT) operative citations remain strictly rejected", async () => {
    const vatQ =
      "บริษัท ทดสอบ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ส่งมอบสินค้าและออกใบกำกับภาษีวันที่ 5 พฤศจิกายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มเท่าใด";
    for (const badConclusion of [
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568",
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541",
      "ต้องเรียกเก็บภาษีมูลค่าเพิ่มร้อยละ 7.0 จำนวน 3,500 บาท ตามพระราชกฤษฎีกา (ฉบับที่ 479) พ.ศ. 2551",
    ]) {
      const badDraft = vatDraft("5 พฤศจิกายน 2569", "807", "2570");
      badDraft.issues[0].conclusion_th = badConclusion;
      badDraft.issues[0].application_explanation_th = badConclusion;
      const { res } = await runVat(vatQ, badDraft);
      expect(res.status, badConclusion).toBe("REVIEW_REQUIRED");
      expect(res.claims.length, badConclusion).toBe(0);
    }

    // Editorial margin notes inside `prov.th.rc.50` (`( ดูพระราชกฤษฎีกา (ฉบับที่ 376) )` and `( ดูคำสั่งกรมสรรพากร ที่ ป.120/2545 )`)
    for (const editorialAuth of [
      "ผู้โอนได้รับยกเว้นไม่ต้องหักภาษี ณ ที่จ่ายตามพระราชกฤษฎีกา (ฉบับที่ 376) พ.ศ. 2544",
      "ผู้โอนต้องคำนวณหักภาษี ณ ที่จ่ายตามคำสั่งกรมสรรพากร ที่ ป.120/2545",
    ]) {
      const badDonor = donorIssue(editorialAuth, [P.s50_5, P.s50_6, P.s48_4]);
      badDonor.conclusion_th = editorialAuth;
      const res = await runAdoptedTurn2(adoptedDraft(badDonor), `editorial_${editorialAuth.slice(0, 8)}`);
      expect(donorClaimOf(res), editorialAuth).toBeUndefined();
      expect(res.answer).not.toContain("376");
      expect(res.answer).not.toContain("120/2545");
    }
  });
});
