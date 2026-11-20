/**
 * REG24 — Gate 1 Generalized Remediation Regression & New-Variant Verification Suite
 *
 * Verifies all 4 P0 workstreams without case-ID hardcoding:
 *   W1: Wrong authority presented as verified + Generalized VAT & §78/1(1) competing dates
 *   W2: Fact preservation, multi-turn turn-by-turn carry-forward (3rd-turn parity), zero template substitution
 *   W3: Evidence resolver consistency (0 synthetic /law-dependency/ URLs marked verified_online),
 *       zero nav/footer boilerplate, relevant-passage narrowing, and B1-09F ruling provenance
 *   W4: RC1 deterministic rejected-calculation staging fixture (0 leakage in answer/claims/envelope)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isNavigationOrBoilerplatePassageText,
  isSyntheticPlaceholderOfficialUrl,
  reopenSavedTraceableAnswer,
  resolveTraceableEvidenceById,
} from "../../src/core/knowledge/claim-traceability-engine";
import type { Actor } from "../../src/core/knowledge/contracts";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";

const STAGING_GZ = path.resolve(
  process.cwd(),
  "data",
  "knowledge-store-b01-rc2-staging",
  "canonical-state.json.gz"
);

const TEST_ACTOR: Actor = {
  actor_id: "qa.gate1.generalized",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Gate 1 Generalized Remediation (Workstreams 1–4)", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-gate1-remed-"));
    fs.copyFileSync(STAGING_GZ, path.join(tmpDir, "canonical-state.json.gz"));
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("W1: Domestic service VAT across pre-799 (2025-09-30), RD 799 (2025-10-01 / 2026-09-30), RD 807 (2026-10-01), absent date, and §78/1(1) competing dates", async () => {
    const basePrompt = (dateClause: string) =>
      `บริษัท นอร์ทสตาร์ โซลูชันส์ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการที่ปรึกษาด้านระบบสารสนเทศแก่บริษัทลูกค้าในกรุงเทพมหานคร ซึ่งใช้บริการทั้งหมดในประเทศไทย ${dateClause} ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราเท่าใด และตามกฎหมายฉบับใด`;

    // V1: Historical 2025-09-30 -> Gazette-verified RD 790 (2024-10-01..2025-09-30); MUST NOT credit RD 799, RD 807, or unrelated กค 0706/พ./7898
    const v1 = await queryKnowledge(
      { question: basePrompt("โดยออกใบกำกับภาษีและได้รับชำระค่าบริการครบถ้วนในวันเดียวกัน คือวันที่ 30 กันยายน 2568"), enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(v1.answer).not.toContain("0706/พ./7898");
    expect(v1.answer).toContain("ฉบับที่ 790");
    expect(v1.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.790")).toBe(true);
    expect(v1.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.799")).toBe(false);
    expect(v1.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.807")).toBe(false);

    // V2: 2025-10-01 -> RD 799
    const v2 = await queryKnowledge(
      { question: basePrompt("โดยออกใบกำกับภาษีและได้รับชำระค่าบริการครบถ้วนในวันเดียวกัน คือวันที่ 1 ตุลาคม 2568"), enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(v2.answer).toContain("ฉบับที่ 799");
    expect(v2.answer).not.toContain("0706/พ./7898");
    expect(v2.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.799")).toBe(true);
    expect(v2.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.807")).toBe(false);

    // V4: 2026-10-01 -> RD 807
    const v4 = await queryKnowledge(
      { question: basePrompt("โดยออกใบกำกับภาษีและได้รับชำระค่าบริการครบถ้วนในวันเดียวกัน คือวันที่ 1 ตุลาคม 2569"), enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(v4.answer).toContain("ฉบับที่ 807");
    expect(v4.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.807")).toBe(true);
    expect(v4.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.799")).toBe(false);

    // V8t1: Absent date -> asks/qualifies, does NOT return กค 0811/พ.12544 or default to RD 807
    const v8 = await queryKnowledge(
      { question: basePrompt(""), enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(v8.answer).not.toContain("0811/พ.12544");
    expect(v8.answer).toContain("ไม่เลือกอ้างฉบับล่าสุดโดยอัตโนมัติ");
    expect(v8.clarification_questions.length).toBeGreaterThan(0);

    // Competing domestic-service dates (§78/1(1)): invoice 25 Sep 2569, payment 5 Oct 2569, asked 12 Oct 2569 -> earliest statutory event (2026-09-25) => RD 799!
    const vComp = await queryKnowledge(
      {
        question:
          "บริษัท เอเป็กซ์ เทค จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการวางระบบแก่ลูกค้าในกรุงเทพมหานครซึ่งใช้บริการทั้งหมดในประเทศไทย โดยออกใบกำกับภาษีเมื่อวันที่ 25 กันยายน 2569 แต่ได้รับชำระค่าบริการเมื่อวันที่ 5 ตุลาคม 2569 (สอบถามเมื่อวันที่ 12 ตุลาคม 2569) ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราเท่าใด และตามกฎหมายฉบับใด",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(vComp.answer).toContain("มาตรา 78/1 (1)");
    expect(vComp.answer).toContain("2026-09-25");
    expect(vComp.answer).toContain("ฉบับที่ 799");
    expect(vComp.evidence.some((e) => e.work_id === "prov.th.rc.78/1")).toBe(true);
    expect(vComp.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.799")).toBe(true);
  }, 60_000);

  it("W1+W2: Export of service to Japan (V6t1 -> 0%, never shoe ruling กค 0811/พ.4347), follow-up used in Chonburi (V6t2 -> 7% RD 799), and explicit follow-up date change (V7t1 -> V7t2)", async () => {
    const qV6t1 =
      "บริษัท นอร์ทสตาร์ โซลูชันส์ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการออกแบบระบบสารสนเทศจากสำนักงานในกรุงเทพมหานครแก่บริษัทลูกค้าในประเทศญี่ปุ่น ส่งมอบงานทางอิเล็กทรอนิกส์ และลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในประเทศญี่ปุ่น ออกใบกำกับภาษีและได้รับชำระค่าบริการเมื่อวันที่ 15 สิงหาคม 2569 ต้องคิดภาษีมูลค่าเพิ่มในอัตราเท่าใด";
    const t1 = await queryKnowledge(
      { question: qV6t1, enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(t1.answer).toContain("ร้อยละ 0");
    expect(t1.answer).toContain("มาตรา 80/1 (2)");
    expect(t1.answer).not.toContain("0811/พ.4347");
    expect(t1.answer).not.toContain("รองเท้า");

    const qV6t2 =
      "ข้อมูลเพิ่มเติม: ความจริงลูกค้าญี่ปุ่นนำบริการออกแบบระบบดังกล่าวไปใช้ทั้งหมดที่สาขาของลูกค้าในจังหวัดชลบุรี ประเทศไทย ไม่ได้ใช้ที่สำนักงานในประเทศญี่ปุ่น อัตราภาษีมูลค่าเพิ่มและกฎหมายที่ใช้บังคับเป็นอย่างไร";
    const t2 = await queryKnowledge(
      {
        question: qV6t2,
        conversation_history: [
          { role: "user", content: qV6t1 },
          { role: "assistant", content: t1.answer },
        ],
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(t2.answer).toContain("ร้อยละ 7");
    expect(t2.answer).toContain("ฉบับที่ 799");
    expect(t2.answer).toContain("2026-08-15");

    // V7t1 (15 Oct 2569 -> RD 807) -> V7t2 (changed to 20 Mar 2569, NOT 15 Oct 2569 -> RD 799)
    const qV7t1 =
      "บริษัท นอร์ทสตาร์ โซลูชันส์ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการที่ปรึกษาด้านระบบสารสนเทศแก่บริษัทลูกค้าในกรุงเทพมหานคร ซึ่งใช้บริการทั้งหมดในประเทศไทย โดยออกใบกำกับภาษีและได้รับชำระค่าบริการครบถ้วนในวันเดียวกัน คือวันที่ 15 ตุลาคม 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราเท่าใด และตามกฎหมายฉบับใด";
    const v7t1 = await queryKnowledge(
      { question: qV7t1, enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(v7t1.answer).toContain("ฉบับที่ 807");

    const qV7t2 =
      "ข้อเท็จจริงเปลี่ยน: วันที่ออกใบกำกับภาษีและได้รับชำระค่าบริการที่ถูกต้องคือวันที่ 20 มีนาคม 2569 ไม่ใช่วันที่ 15 ตุลาคม 2569 อัตราภาษีมูลค่าเพิ่มและกฎหมายที่ใช้บังคับเป็นอย่างไร";
    const v7t2 = await queryKnowledge(
      {
        question: qV7t2,
        conversation_history: [
          { role: "user", content: qV7t1 },
          { role: "assistant", content: v7t1.answer },
        ],
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(v7t2.answer).toContain("ฉบับที่ 799");
    expect(v7t2.answer).toContain("2026-03-20");
    expect(v7t2.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.799")).toBe(true);
    expect(v7t2.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.807")).toBe(false);
  }, 60_000);

  it("W2: Condo/nephew (T09) preserves 'ห้องชุด' & 'หลานชาย' without substituting land/niece; 3rd-turn context (C1t1->C1t2->C1t3) matches fresh session; cash support to mother (H2t1) & friend ordination (H2t2) + condo to brother (H3)", async () => {
    // T09: Condo to nephew (บุตรชายของน้องสาว)
    const t09 = await queryKnowledge(
      {
        question:
          "นางวิไลวรรณยกห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภูมิ ซึ่งเป็นหลานชาย (บุตรชายของน้องสาวนางวิไลวรรณ) โดยเสน่หาไม่มีค่าตอบแทน และจดทะเบียนโอนกรรมสิทธิ์เมื่อวันที่ 18 สิงหาคม 2568 หนังสือสัญญาให้ระบุมูลค่า 6,000,000 บาท แต่ราคาประเมินทุนทรัพย์ของทางราชการที่ใช้ในการจดทะเบียนคือ 7,200,000 บาท การให้ครั้งนี้ไม่ได้เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณีใด นายภูมิต้องเสียภาษีเงินได้อย่างไร และต้องหักภาษี ณ ที่จ่ายเท่าใดในวันจดทะเบียน",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(t09.answer).toContain("ห้องชุด");
    expect(t09.answer).toContain("หลานชาย");
    expect(t09.answer).toContain("7,200,000");
    expect(t09.answer).not.toContain("หลานสาวที่เป็นบุตรของพี่หรือน้อง");

    // C1t1 -> C1t2 -> C1t3 vs Fresh Session
    const qC1t1 =
      "นายวิชัยโอนกรรมสิทธิ์ที่ดินเปล่าให้บุตรชายชอบด้วยกฎหมาย (ไม่ใช่บุตรบุญธรรม) โดยเสน่หาไม่มีค่าตอบแทน เมื่อวันที่ 15 พฤษภาคม 2568 มูลค่าที่แจ้งไว้ 28,000,000 บาท ปีนั้นไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น ภาษีเงินได้บุคคลธรรมดาเป็นอย่างไร";
    const c1t1 = await queryKnowledge(
      { question: qC1t1, enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(c1t1.answer).toContain("มาตรา 42 (26)");
    expect(c1t1.answer).toContain("400,000"); // (28M - 20M) * 5% = 400,000

    const qC1t2 =
      "เปลี่ยนข้อเท็จจริงเฉพาะตัวผู้รับโอน: ผู้รับโอนไม่ใช่บุตรชาย แต่เป็นหลานสาวซึ่งเป็นบุตรของพี่สาวแท้ๆ ของนายวิชัย โดยเป็นการโอนที่ดินแปลงเดิมโดยไม่มีค่าตอบแทนเนื่องในงานสมรสตามประเพณีในวันเดิม ในส่วนภาษีหัก ณ ที่จ่ายของผู้โอน ณ สำนักงานที่ดินต้องคำนวณอย่างไร";
    const c1t2 = await queryKnowledge(
      {
        question: qC1t2,
        conversation_history: [
          { role: "user", content: qC1t1 },
          { role: "assistant", content: c1t1.answer },
        ],
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(c1t2.answer).toContain("มาตรา 50 (5)");

    const qC1t3 =
      "แล้วในส่วนภาษีเงินได้บุคคลธรรมดาของผู้รับโอนล่ะ ต้องเสียภาษีหรือไม่ หรือได้รับยกเว้นเท่าใด";
    const c1t3 = await queryKnowledge(
      {
        question: qC1t3,
        conversation_history: [
          { role: "user", content: qC1t1 },
          { role: "assistant", content: c1t1.answer },
          { role: "user", content: qC1t2 },
          { role: "assistant", content: c1t2.answer },
        ],
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    const c1Fresh = await queryKnowledge(
      {
        question:
          "นายวิชัยโอนกรรมสิทธิ์ที่ดินเปล่าให้หลานสาวซึ่งเป็นบุตรของพี่สาวแท้ๆ ของตน โดยไม่มีค่าตอบแทนเนื่องในงานสมรสตามประเพณี เมื่อวันที่ 15 พฤษภาคม 2568 มูลค่าที่แจ้งไว้ 28,000,000 บาท ในส่วนภาษีเงินได้บุคคลธรรมดาของผู้รับโอน ต้องเสียภาษีหรือไม่ หรือได้รับยกเว้นเท่าใด",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(c1t3.answer).toContain("Flag for Legal Review");
    expect(c1t3.answer).toContain("มาตรา 54");
    expect(c1t3.answer).toContain("บุตรของพี่สาวแท้ๆ");
    expect(c1Fresh.answer).toContain("Flag for Legal Review");
    expect(c1Fresh.answer).toContain("มาตรา 54");

    // H2t1: Cash to mother (มารดาแท้ๆ) 24M -> §42(27) 20M exempt, 4M excess, 200k 5% elective — NEVER severance 0702/6277
    const qH2t1 =
      "นางสาวมินตรา โอนเงินสดผ่านธนาคารให้มารดาแท้ๆ เป็นค่าอุปการะเลี้ยงดู 24,000,000 บาท เมื่อวันที่ 12 มิถุนายน 2568 ปีนั้นไม่มีการให้รายการอื่น ภาษีเงินได้บุคคลธรรมดาของผู้รับเงินเป็นอย่างไร";
    const h2t1 = await queryKnowledge(
      { question: qH2t1, enable_tax_foundation_pilot: false },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(h2t1.answer).not.toContain("0702/6277");
    expect(h2t1.answer).toContain("มาตรา 42 (27)");
    expect(h2t1.answer).toContain("20,000,000");
    expect(h2t1.answer).toContain("4,000,000");
    expect(h2t1.answer).toContain("200,000");

    // H2t2: Follow-up changed to close friend (เพื่อนสนิท) ordination ceremony -> §42(28) 10M exempt, 14M excess, 700k 5%
    const qH2t2 =
      "ถ้าเปลี่ยนข้อเท็จจริงว่าผู้รับเงินไม่ใช่คนในครอบครัว แต่เป็นเพื่อนสนิทของนางสาวมินตรา โดยให้เงินสดจำนวนเดิม 24,000,000 บาท เป็นของขวัญเนื่องในพิธีอุปสมบทตามประเพณี เมื่อวันที่ 12 มิถุนายน 2568 ผลภาษีเงินได้บุคคลธรรมดาของผู้รับเงินเปลี่ยนไปอย่างไร";
    const h2t2 = await queryKnowledge(
      {
        question: qH2t2,
        conversation_history: [
          { role: "user", content: qH2t1 },
          { role: "assistant", content: h2t1.answer },
        ],
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(h2t2.answer).toContain("มาตรา 42 (28)");
    expect(h2t2.answer).toContain("10,000,000");
    expect(h2t2.answer).toContain("14,000,000");
    expect(h2t2.answer).toContain("700,000");
    expect(h2t2.answer).toContain("พิธีอุปสมบทตามประเพณี");
    expect(h2t2.answer).not.toContain("งานสมรส");

    // H3: Condo to brother (พี่ชายแท้ๆ) with unknown appraisal/acquisition/holding years
    const h3 = await queryKnowledge(
      {
        question:
          "นางสาวพิมพ์ชนกจะยกห้องชุดในจังหวัดเชียงใหม่ให้แก่นายธนกฤต ซึ่งเป็นพี่ชายแท้ๆ ของตน โดยเสน่หาไม่มีค่าตอบแทน และจะจดทะเบียนโอนในเดือนสิงหาคม 2568 ทั้งสองคาดว่าห้องชุดมีมูลค่าตามราคาตลาดประมาณ 14,000,000 บาท แต่ยังไม่ทราบราคาประเมินทุนทรัพย์ของทางราชการ และไม่ทราบว่านางสาวพิมพ์ชนกได้ห้องชุดมาด้วยวิธีใดและถือครองมาแล้วกี่ปี ต้องหักภาษี ณ ที่จ่าย ณ สำนักงานที่ดินเท่าใด และนายธนกฤตต้องเสียภาษีเงินได้บุคคลธรรมดาหรือไม่",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(h3.answer).toContain("ห้องชุด");
    expect(h3.answer).toContain("พี่ชายแท้ๆ");
    expect(h3.answer).toContain("มาตรา 50 (5)");
    expect(h3.answer).toContain("Flag for Legal Review");
  }, 60_000);

  it("W3: Evidence resolver consistency — zero synthetic /law-dependency/ URLs, zero nav boilerplate, narrowed passages, and B1-09F attaches กค 0702/5958", async () => {
    const res = await queryKnowledge(
      {
        question:
          "นายสมชายโอนที่ดินมูลค่า 25,000,000 บาท ให้แก่หลานสาว (บุตรสาวของน้องชายนายสมชาย) โดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 เป็นการให้เนื่องในงานสมรสตามประเพณี ผลทางภาษีเงินได้ของหลานสาวเป็นอย่างไร",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: true }
    );
    expect(res.traceable_answer).toBeTruthy();
    const env = res.traceable_answer!;

    // Confirm กค 0702/5958 is attached with its official RD URL
    const allRefs = env.claims.flatMap((c) => c.evidence_references);
    expect(allRefs.length).toBeGreaterThan(0);
    expect(allRefs.some((r) => r.doc_id === "work.th.rd.0702_5958_2015_04f2b49f")).toBe(true);

    // Every single pinned evidence ref MUST have a real official URL (0 synthetic /law-dependency/),
    // match resolveTraceableEvidenceById, match reopened answer, and contain 0 nav boilerplate!
    const reopened = reopenSavedTraceableAnswer(store, env.answer_revision, TEST_ACTOR);
    expect(reopened.found).toBe(true);
    const reopenedMap = new Map(
      reopened.answer!.claims.flatMap((c) => c.evidence_references).map((r) => [r.evidence_id, r])
    );

    const checkedIds = new Set<string>();
    for (const ref of allRefs) {
      if (checkedIds.has(ref.evidence_id)) continue;
      checkedIds.add(ref.evidence_id);
      expect(isSyntheticPlaceholderOfficialUrl(ref.official_url)).toBe(false);
      expect(ref.official_url).not.toContain("/law-dependency/");
      const resolved = resolveTraceableEvidenceById(store, ref.evidence_id, TEST_ACTOR);
      expect(resolved.ok).toBe(true);
      expect(resolved.evidence!.official_location.exact_official_url).not.toContain("/law-dependency/");
      expect(resolved.evidence!.official_location.exact_official_url).toBe(ref.official_url);
      expect(isNavigationOrBoilerplatePassageText(resolved.evidence!.verbatim_quote)).toBe(false);
      const rRef = reopenedMap.get(ref.evidence_id);
      expect(rRef?.official_url).toBe(ref.official_url);
    }
  }, 30_000);

  it("W4: RC1 deterministic rejected-calculation staging fixture — zero leakage of rejected figures/steps in answer, claims, or traceable envelope", async () => {
    const res = await queryKnowledge(
      {
        question:
          "บริษัท นอร์ทสตาร์ โซลูชันส์ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย ให้บริการที่ปรึกษาด้านระบบสารสนเทศแก่บริษัทลูกค้าในกรุงเทพมหานคร ซึ่งใช้บริการทั้งหมดในประเทศไทย โดยออกใบกำกับภาษีและได้รับชำระค่าบริการครบถ้วนในวันที่ 15 มีนาคม 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราเท่าใด และตามกฎหมายฉบับใด",
        enable_tax_foundation_pilot: false,
        qa_synthetic_fixture: "RC1_REJECTED_CALC",
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: true }
    );

    const serializedClaims = JSON.stringify(res.claims);
    const serializedEnvelope = JSON.stringify(res.traceable_answer);
    expect(res.answer).not.toContain("999,888");
    expect(res.answer).not.toContain("88.5");
    expect(res.answer).not.toContain("RC1_LEAK_SENTINEL");
    expect(serializedClaims).not.toContain("999,888");
    expect(serializedClaims).not.toContain("RC1_LEAK_SENTINEL");
    expect(serializedEnvelope).not.toContain("999,888");
    expect(serializedEnvelope).not.toContain("RC1_LEAK_SENTINEL");
    expect(
      res.coverage_warnings.some((w) => w.includes("calc.qa.rc1_synthetic_ungrounded_fixture"))
    ).toBe(true);
    // Legitimate VAT answer still succeeds cleanly!
    expect(res.answer).toContain("ฉบับที่ 799");
  }, 30_000);
});
