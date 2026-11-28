import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyFactDelta,
  buildStructuredCaseFactLedger,
  computeLedgerStateHash,
} from "../../src/core/knowledge/case-fact-ledger";
import { queryKnowledge, type RealAppEvidenceAssemblyCapture } from "../../src/core/knowledge/query";
import * as cte from "../../src/core/knowledge/claim-traceability-engine";
import { DurableKnowledgeStore, setDefaultKnowledgeStoreForTesting } from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";

type AssembledPacketItem = RealAppEvidenceAssemblyCapture["actual_model_packet"][number];

const QA_ACTOR: Actor = {
  actor_id: "trial.user.vat4_synthetic@reg24.th",
  role: "reader",
  tenant_id: "tenant.trial.vat4_synthetic",
  authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.vat4_synthetic"],
  csrf_verified: true,
};

function cloneCanonicalStoreToTemp(prefix: string): { dir: string; store: DurableKnowledgeStore } {
  const srcDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const gz = path.join(srcDir, "canonical-state.json.gz");
  if (fs.existsSync(gz)) {
    fs.copyFileSync(gz, path.join(dir, "canonical-state.json.gz"));
  } else {
    fs.copyFileSync(path.join(srcDir, "canonical-state.json"), path.join(dir, "canonical-state.json"));
  }
  const store = new DurableKnowledgeStore(dir);
  return { dir, store };
}

describe("REG24 Batch 1 — Four Open VAT Defects from 4137d63 (Independent Synthetic Repros)", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeEach(() => {
    const cloned = cloneCanonicalStoreToTemp("reg24-vat4-");
    tmpDir = cloned.dir;
    store = cloned.store;
    setDefaultKnowledgeStoreForTesting(store);
  });

  afterEach(() => {
    setDefaultKnowledgeStoreForTesting(null);
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Defect 1: Actual place of service use (Tokyo office, foreign office + Thai
  // provincial branch, foreign address alone, follow-ups, §80/1(2) + 105/181)
  // =========================================================================
  it("VAT4-D1A: captures 'ใช้ผลของบริการทั้งหมดที่สำนักงานในโตเกียว' as full overseas, explicit foreign office + Thai provincial branch as MIXED, partial provincial branch as remainder-unknown, foreign address alone as NOT proving use, and binds §80/1(2) + DG VAT 105 + 181", async () => {
    // 1. Output used entirely at Tokyo office (performed in Thailand, delivered online, billed abroad)
    const tokyoFullPrompt =
      "บริษัท สยามดิจิทัล จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ทำงานออกแบบระบบในประเทศไทยและส่งมอบงานทางออนไลน์แก่บริษัทผู้ว่าจ้าง โดยผู้ว่าจ้างใช้ผลของบริการทั้งหมดที่สำนักงานในโตเกียว ค่าบริการ 120,000 บาท ได้รับชำระค่าบริการและออกใบกำกับภาษีเมื่อวันที่ 15 ตุลาคม 2569 ต้องเสียภาษีมูลค่าเพิ่มอัตราใดและเป็นเงินเท่าใด";
    const tokyoLedger = buildStructuredCaseFactLedger({
      question: tokyoFullPrompt,
      applicableDate: null,
    });
    expect(
      tokyoLedger.material_facts.find((f) => f.fact_key === "vat_place_of_use")?.normalized_category
    ).toBe("SERVICE_USED_ENTIRELY_ABROAD_EXPORT");

    // Evidence assembly for eligible export service MUST include §80/1(2) AND Notification 105 as amended by 181!
    let tokyoPack: AssembledPacketItem[] = [];
    await queryKnowledge(
      {
        question: tokyoFullPrompt,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      QA_ACTOR,
      {
        store,
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (ev) => {
          tokyoPack = ev.actual_model_packet;
        },
      }
    );
    expect(
      tokyoPack.some((p) => p.work_id === "prov.th.rc.80/1" && p.evidence_role === "governing")
    ).toBe(true);
    expect(
      tokyoPack.some(
        (p) => p.work_id === "subreg.th.rd.dg_vat.105" && p.evidence_role === "governing"
      )
    ).toBe(true);
    expect(
      tokyoPack.some(
        (p) => p.work_id === "subreg.th.rd.dg_vat.181" && p.evidence_role === "governing"
      )
    ).toBe(true);

    // 2. Explicit use at BOTH a foreign office (Tokyo) AND a Thai provincial branch (Chiang Mai) -> MIXED!
    const mixedOfficeBranchPrompt =
      "บริษัท สยามดิจิทัล จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการออกแบบระบบแก่ลูกค้าในญี่ปุ่น โดยลูกค้าใช้ผลของบริการทั้งที่สำนักงานในโตเกียวและที่สาขาเชียงใหม่ ค่าบริการ 120,000 บาท ได้รับชำระค่าบริการและออกใบกำกับภาษีเมื่อวันที่ 15 ตุลาคม 2569 ต้องเสียภาษีมูลค่าเพิ่มอัตราใดและเป็นเงินเท่าใด";
    const mixedLedger = buildStructuredCaseFactLedger({
      question: mixedOfficeBranchPrompt,
      applicableDate: null,
    });
    expect(
      mixedLedger.material_facts.find((f) => f.fact_key === "vat_place_of_use")?.normalized_category
    ).toBe("SERVICE_USED_MIXED_THAILAND_AND_ABROAD");

    // 3. Partial use at Thai provincial branch ONLY (remainder unstated) -> PARTIALLY_THAILAND_REMAINDER_UNKNOWN
    const partialChiangMai = buildStructuredCaseFactLedger({
      question:
        "บริษัทไทยจดทะเบียน VAT ให้บริการที่ปรึกษาแก่ลูกค้าในโตเกียว โดยลูกค้าใช้ผลของบริการบางส่วนที่สาขาเชียงใหม่ ค่าบริการ 100,000 บาท รับชำระวันที่ 15 ตุลาคม 2569",
      applicableDate: null,
    });
    expect(
      partialChiangMai.material_facts.find((f) => f.fact_key === "vat_place_of_use")
        ?.normalized_category
    ).toBe("SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN");

    // 4. Foreign address / performance / delivery / billing ONLY proves NOTHING about place of use!
    const foreignAddressOnly = buildStructuredCaseFactLedger({
      question:
        "บริษัท สยามดิจิทัล จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ทำงานให้บริการที่ปรึกษาในประเทศไทย ส่งมอบรายงานทางอีเมล และวางบิลไปยังลูกค้าที่มีสำนักงานในโตเกียว ค่าบริการ 120,000 บาท ได้รับชำระค่าบริการเมื่อวันที่ 15 ตุลาคม 2569 ต้องเสียภาษีมูลค่าเพิ่มอัตราใด",
      applicableDate: null,
    });
    const addrPlace = foreignAddressOnly.material_facts.find(
      (f) => f.fact_key === "vat_place_of_use"
    )?.normalized_category;
    expect(addrPlace).not.toBe("SERVICE_USED_ENTIRELY_ABROAD_EXPORT");
    expect(addrPlace).not.toBe("SERVICE_USED_IN_THAILAND_DOMESTIC");

    // 5. Follow-up correction applies the EXACT same rule (Tokyo office -> Tokyo office + Chiang Mai branch)
    const followUpMixed = buildStructuredCaseFactLedger({
      question:
        "ขอแก้ไขข้อเท็จจริงว่า ลูกค้าใช้ผลของบริการทั้งที่สำนักงานในโตเกียวและที่สาขาเชียงใหม่ ส่วนวันที่และค่าบริการคงเดิม",
      applicableDate: null,
      conversationHistory: [{ role: "user", content: tokyoFullPrompt }],
    });
    expect(
      followUpMixed.material_facts.find((f) => f.fact_key === "vat_place_of_use")
        ?.normalized_category
    ).toBe("SERVICE_USED_MIXED_THAILAND_AND_ABROAD");
    expect(followUpMixed.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-15");
    expect(computeLedgerStateHash(followUpMixed)).not.toBe(computeLedgerStateHash(tokyoLedger));
  });

  // =========================================================================
  // Defect 2: Event typing (actual use -> SERVICE_USE never PAYMENT/INVOICE)
  // & targeted follow-up replacement preserving real use & unrelated installments
  // =========================================================================
  it("VAT4-D2A: stated date of actual service use belongs ONLY to SERVICE_USE (never PAYMENT or INVOICE), never invents same-day INVOICE, and earlier qualifying SERVICE_USE controls under §78/1(1)-(2)", () => {
    const prompt =
      "บริษัท สยามที่ปรึกษา จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการวิเคราะห์ระบบซึ่งลูกค้าใช้บริการในประเทศไทย ค่าบริการ 100,000 บาท ลูกค้าใช้ผลของบริการจริงเมื่อวันที่ 25 กันยายน 2569 และบริษัทได้รับชำระค่าบริการเมื่อวันที่ 5 ตุลาคม 2569 ต้องเสียภาษีมูลค่าเพิ่มอัตราใดและตามพระราชกฤษฎีกาฉบับใด";
    const ledger = buildStructuredCaseFactLedger({ question: prompt, applicableDate: null });
    const events = ledger.temporal_facts.transaction_or_event_dates;

    const sep25Kinds = events.filter((e) => e.iso_date === "2026-09-25").map((e) => e.event_type);
    expect(sep25Kinds).toContain("SERVICE_USE");
    expect(sep25Kinds).not.toContain("PAYMENT");
    expect(sep25Kinds).not.toContain("INVOICE");

    const oct5Kinds = events.filter((e) => e.iso_date === "2026-10-05").map((e) => e.event_type);
    expect(oct5Kinds).toContain("PAYMENT");
    expect(oct5Kinds).not.toContain("INVOICE");

    expect(ledger.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-25");
  });

  it("VAT4-D2B: follow-up moving PAYMENT & INVOICE removes old PAYMENT/INVOICE dates while preserving genuinely dated SERVICE_USE on the old date and unrelated installments", () => {
    // 1. Real SERVICE_USE on 30 Sep MUST survive when Turn 2 moves ONLY PAYMENT and INVOICE from 30 Sep -> 1 Oct!
    const t1WithSameDayRealUse =
      "บริษัท สยามที่ปรึกษา จำกัด ผู้ประกอบการจดทะเบียน VAT ให้บริการในประเทศไทย ค่าบริการ 100,000 บาท ลูกค้าเริ่มใช้บริการจริงเมื่อวันที่ 30 กันยายน 2569 และบริษัทออกใบกำกับภาษีพร้อมได้รับชำระค่าบริการเมื่อวันที่ 30 กันยายน 2569";
    const t2MovePayInvOnly =
      "ขอแก้ไขเฉพาะวันออกใบกำกับภาษีและวันได้รับชำระค่าบริการจากวันที่ 30 กันยายน 2569 เป็นวันที่ 1 ตุลาคม 2569 ส่วนวันที่ลูกค้าใช้บริการจริงคงเดิม";
    const ledger1 = buildStructuredCaseFactLedger({
      question: t1WithSameDayRealUse,
      applicableDate: null,
    });
    const ledger2 = buildStructuredCaseFactLedger({
      question: t2MovePayInvOnly,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: t1WithSameDayRealUse }],
    });
    const evs2 = ledger2.temporal_facts.transaction_or_event_dates;
    expect(evs2.some((e) => e.event_type === "SERVICE_USE" && e.iso_date === "2026-09-30")).toBe(
      true
    );
    expect(evs2.some((e) => e.event_type === "PAYMENT" && e.iso_date === "2026-09-30")).toBe(false);
    expect(evs2.some((e) => e.event_type === "INVOICE" && e.iso_date === "2026-09-30")).toBe(false);
    expect(evs2.some((e) => e.event_type === "PAYMENT" && e.iso_date === "2026-10-01")).toBe(true);
    expect(evs2.some((e) => e.event_type === "INVOICE" && e.iso_date === "2026-10-01")).toBe(true);
    expect(ledger2.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-30");
    expect(computeLedgerStateHash(ledger2)).not.toBe(computeLedgerStateHash(ledger1));

    // 2. Moving BOTH distinct invoice date (28 Sep -> 2 Oct) AND payment date (30 Sep -> 5 Oct) leaves ZERO stale old dates!
    const t1SplitDates =
      "บริษัท สยามที่ปรึกษา จำกัด ผู้ประกอบการจดทะเบียน VAT ให้บริการซึ่งใช้บริการในประเทศไทย ค่าบริการ 100,000 บาท ออกใบกำกับภาษีเต็มจำนวนเมื่อวันที่ 28 กันยายน 2569 และได้รับชำระค่าบริการเมื่อวันที่ 30 กันยายน 2569";
    const t2MoveBoth =
      "ขอแก้ไขวันออกใบกำกับภาษีจากวันที่ 28 กันยายน 2569 เป็นวันที่ 2 ตุลาคม 2569 และแก้ไขวันรับชำระค่าบริการจากวันที่ 30 กันยายน 2569 เป็นวันที่ 5 ตุลาคม 2569";
    const ledgerSplit2 = buildStructuredCaseFactLedger({
      question: t2MoveBoth,
      applicableDate: null,
      conversationHistory: [{ role: "user", content: t1SplitDates }],
    });
    const splitEvs2 = ledgerSplit2.temporal_facts.transaction_or_event_dates;
    expect(splitEvs2.some((e) => e.event_type === "INVOICE" && e.iso_date === "2026-09-28")).toBe(
      false
    );
    expect(splitEvs2.some((e) => e.event_type === "PAYMENT" && e.iso_date === "2026-09-30")).toBe(
      false
    );
    expect(splitEvs2.some((e) => e.event_type === "INVOICE" && e.iso_date === "2026-10-02")).toBe(
      true
    );
    expect(splitEvs2.some((e) => e.event_type === "PAYMENT" && e.iso_date === "2026-10-05")).toBe(
      true
    );
    expect(ledgerSplit2.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-02");
  });

  // =========================================================================
  // Defect 3: Scope exception check to applicable provision (§80/1(2) vs §80/1(1))
  // and filter editorial annotations like ( ดูคำสั่งกรมสรรพากร ที่ ป.97/2543 )
  // =========================================================================
  it("VAT4-D3A & D3B: §80/1(2) service-export claim is NOT blocked by §80/1(1)'s §81(3) carve-out or editorial ป.97/2543 annotation, while the real §81(3) goods-export exception under §80/1(1) stays operative", () => {
    const state = store.getState();
    const p80_1 = Object.values(state.passages).find(
      (p) => p.work_id === "prov.th.rc.80/1" && /มาตรา\s*81\s*\(3\)/.test(p.exact_text)
    )!;
    const p105 = Object.values(state.passages).find(
      (p) => p.work_id === "subreg.th.rd.dg_vat.105" && /ข้อ\s*1/.test(p.exact_text)
    )!;
    const p181 = Object.values(state.passages).find(
      (p) => p.work_id === "subreg.th.rd.dg_vat.181" && /ข้อ\s*1/.test(p.exact_text)
    )!;
    expect(p80_1).toBeTruthy();
    expect(p105).toBeTruthy();
    expect(p181).toBeTruthy();

    // D3A: Supported §80/1(2) service-export claim mentioning "หลักเกณฑ์" / "วิธีการ" (without mentioning "ยกเว้น"/"เว้นแต่"/§81(3)/ป.97/2543)
    // On unmodified 4137d63, claim-traceability-engine.ts:1985-2016 lets §80/1(1)'s "ยกเว้นภาษีมูลค่าเพิ่มตามมาตรา 81 (3)" + editorial "( ดูคำสั่งกรมสรรพากร ที่ ป.97/2543 )"
    // bleed 220 chars across "(2)" and reject this valid §80/1(2) service claim as "conflicting"!
    const servicesClaimText =
      "การให้บริการที่กระทำในราชอาณาจักรและใช้ผลของบริการทั้งหมดในต่างประเทศ (สำนักงานในโตเกียว) ต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 ตามมาตรา 80/1 (2) และหลักเกณฑ์ วิธีการ ตามประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 105) ซึ่งแก้ไขเพิ่มเติมโดยฉบับที่ 181 คิดเป็นภาษีมูลค่าเพิ่ม 0 บาท จากฐานค่าบริการ 120,000 บาท";
    const servicesValidated = cte.validateAndBuildTraceableAnswer(store, {
      answer_id: "ans.vat4.d3a.services",
      revision_number: 1,
      channel: "chat",
      question: "ให้บริการจากไทยและใช้บริการทั้งหมดที่สำนักงานในโตเกียว เสีย VAT เท่าใด",
      as_of_date: "2026-10-15",
      release_id: "rel.B01.rc8",
      actor: QA_ACTOR,
      authorized_candidate_ids: new Set([p80_1.passage_id, p105.passage_id, p181.passage_id]),
      proposed_claims: [
        {
          claim_id: "clm.vat4.d3a.1",
          text: servicesClaimText,
          claim_type: "legal_proposition",
          verified_calculation_numeric_tokens: ["0", "120000", "120,000"],
          support_groups: [
            {
              group_id: "grp.1",
              role: "statutory_premise",
              evidence_ids: [p80_1.passage_id, p105.passage_id, p181.passage_id],
            },
          ],
        },
      ],
      persist_atomically: false,
    });
    expect(
      servicesValidated.status,
      `D3A rejected unexpectedly (passage=${p80_1.passage_id}): ${JSON.stringify(servicesValidated.unresolved_issues)}`
    ).toBe("complete");
    expect(servicesValidated.claims.length).toBe(1);
    expect(servicesValidated.claims[0]?.verification_decision).toBe("supported");

    // D3B: Real §81(3) goods-export carve-out under §80/1(1) MUST STAY OPERATIVE!
    const goodsCarveoutViolationText =
      "การส่งออกสินค้าทุกประเภทตามมาตรา 80/1 (1) รวมถึงการส่งออกสินค้าตามมาตรา 81 (3) ต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0 ทุกกรณีโดยไม่มีข้อยกเว้น";
    const goodsValidated = cte.validateAndBuildTraceableAnswer(store, {
      answer_id: "ans.vat4.d3b.goods_carveout",
      revision_number: 1,
      channel: "chat",
      question: "การส่งออกสินค้าตามมาตรา 81 (3) เสีย VAT ร้อยละ 0 ตามมาตรา 80/1 (1) หรือไม่",
      as_of_date: "2026-10-15",
      release_id: "rel.B01.rc8",
      actor: QA_ACTOR,
      authorized_candidate_ids: new Set([p80_1.passage_id]),
      proposed_claims: [
        {
          claim_id: "clm.vat4.d3b.1",
          text: goodsCarveoutViolationText,
          claim_type: "legal_proposition",
          verified_calculation_numeric_tokens: ["0"],
          support_groups: [
            {
              group_id: "grp.1",
              role: "statutory_premise",
              evidence_ids: [p80_1.passage_id],
            },
          ],
        },
      ],
      persist_atomically: false,
    });
    expect(goodsValidated.status).not.toBe("complete");
    expect(goodsValidated.claims.length).toBe(0);
    expect(
      goodsValidated.unresolved_issues.some((u) => u.reason_code === "CONTRADICTING_EXCEPTION_UNRESOLVED")
    ).toBe(true);

    // Also test non-"ทุกกรณี" direct §80/1(1) goods claim omitting the §81(3) carve-out on §81(3) goods!
    const goodsDirectCarveoutOmission =
      "การส่งออกสินค้าตามมาตรา 81 (3) ต้องเสียภาษีมูลค่าเพิ่มตามมาตรา 80/1 (1) ในอัตราร้อยละ 0";
    const goodsDirectValidated = cte.validateAndBuildTraceableAnswer(store, {
      answer_id: "ans.vat4.d3b.goods_direct",
      revision_number: 1,
      channel: "chat",
      question: "การส่งออกสินค้าตามมาตรา 81 (3) เสีย VAT ร้อยละ 0 หรือไม่",
      as_of_date: "2026-10-15",
      release_id: "rel.B01.rc8",
      actor: QA_ACTOR,
      authorized_candidate_ids: new Set([p80_1.passage_id]),
      proposed_claims: [
        {
          claim_id: "clm.vat4.d3b.2",
          text: goodsDirectCarveoutOmission,
          claim_type: "legal_proposition",
          verified_calculation_numeric_tokens: ["0"],
          support_groups: [
            {
              group_id: "grp.1",
              role: "statutory_premise",
              evidence_ids: [p80_1.passage_id],
            },
          ],
        },
      ],
      persist_atomically: false,
    });
    expect(goodsDirectValidated.status).not.toBe("complete");
    expect(goodsDirectValidated.claims.length).toBe(0);
    expect(
      goodsDirectValidated.unresolved_issues.some(
        (u) => u.reason_code === "CONTRADICTING_EXCEPTION_UNRESOLVED"
      )
    ).toBe(true);
  });

  // =========================================================================
  // Defect 4: Stop assigning dates to undated delivery (both clause orders)
  // paired with an explicitly dated goods-delivery control
  // =========================================================================
  it("VAT4-D4A & D4B: keeps undated delivery undated in BOTH clause orders (never copying nearby payment/invoice date), while explicitly dated goods delivery still emits DELIVERY and controls under §78(1)", () => {
    // Clause order 1: Undated delivery BEFORE dated payment & invoice
    const order1Prompt =
      "บริษัท สยามซอฟต์ จำกัด ผู้ประกอบการจดทะเบียน VAT ส่งมอบซอฟต์แวร์ให้ลูกค้าในประเทศไทย โดยได้รับชำระค่าบริการและออกใบกำกับภาษีเมื่อวันที่ 30 กันยายน 2569 ค่าบริการ 100,000 บาท";
    const l1 = buildStructuredCaseFactLedger({ question: order1Prompt, applicableDate: null });
    expect(
      l1.temporal_facts.transaction_or_event_dates.some((e) => e.event_type === "DELIVERY")
    ).toBe(false);
    expect(
      l1.temporal_facts.transaction_or_event_dates.some(
        (e) => e.event_type === "PAYMENT" && e.iso_date === "2026-09-30"
      )
    ).toBe(true);

    // Undated goods delivery BEFORE dated invoice/payment
    const order1GoodsUndated =
      "บริษัท ก. จำกัด ส่งมอบสินค้าให้ผู้ซื้อแล้ว โดยออกใบกำกับภาษีและได้รับชำระราคาเมื่อวันที่ 30 กันยายน 2569 มูลค่า 50,000 บาท";
    const l1g = buildStructuredCaseFactLedger({
      question: order1GoodsUndated,
      applicableDate: null,
    });
    expect(
      l1g.temporal_facts.transaction_or_event_dates.some((e) => e.event_type === "DELIVERY")
    ).toBe(false);

    // Clause order 2: Dated payment & invoice BEFORE undated delivery
    const order2Prompt =
      "บริษัท สยามซอฟต์ จำกัด ผู้ประกอบการจดทะเบียน VAT ได้รับชำระค่าบริการและออกใบกำกับภาษีเมื่อวันที่ 30 กันยายน 2569 และส่งมอบงานซอฟต์แวร์ให้ลูกค้าโดยไม่ได้ระบุวันที่ส่งมอบ";
    const l2 = buildStructuredCaseFactLedger({ question: order2Prompt, applicableDate: null });
    expect(
      l2.temporal_facts.transaction_or_event_dates.some((e) => e.event_type === "DELIVERY")
    ).toBe(false);

    const order2NoExplicitUndatedNote =
      "บริษัท สยามซอฟต์ จำกัด ผู้ประกอบการจดทะเบียน VAT ได้รับชำระค่าบริการและออกใบกำกับภาษีเมื่อวันที่ 30 กันยายน 2569 พร้อมส่งมอบรายงานให้ลูกค้าทางออนไลน์";
    const l2b = buildStructuredCaseFactLedger({
      question: order2NoExplicitUndatedNote,
      applicableDate: null,
    });
    expect(
      l2b.temporal_facts.transaction_or_event_dates.some((e) => e.event_type === "DELIVERY")
    ).toBe(false);

    // Follow-up moving payment/invoice 30 Sep -> 1 Oct MUST NOT leave behind a phantom DELIVERY on 30 Sep!
    const l1FollowUp = buildStructuredCaseFactLedger({
      question:
        "ขอแก้ไขวันออกใบกำกับภาษีและวันได้รับชำระค่าบริการจากวันที่ 30 กันยายน 2569 เป็นวันที่ 1 ตุลาคม 2569 ส่วนข้อเท็จจริงอื่นคงเดิม",
      applicableDate: null,
      conversationHistory: [{ role: "user", content: order1Prompt }],
    });
    expect(
      l1FollowUp.temporal_facts.transaction_or_event_dates.some((e) => e.event_type === "DELIVERY")
    ).toBe(false);
    expect(l1FollowUp.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-01");

    // D4B Control: Explicitly dated goods delivery MUST still emit DELIVERY and control under §78(1)!
    const datedGoodsPrompt =
      "บริษัท ทดสอบสินค้า จำกัด ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศมูลค่า 50,000 บาท ส่งมอบสินค้าเมื่อวันที่ 29 กันยายน 2569 และออกใบกำกับภาษีพร้อมได้รับชำระราคาเมื่อวันที่ 1 ตุลาคม 2569";
    const lgDated = buildStructuredCaseFactLedger({
      question: datedGoodsPrompt,
      applicableDate: null,
    });
    expect(
      lgDated.temporal_facts.transaction_or_event_dates.some(
        (e) => e.event_type === "DELIVERY" && e.iso_date === "2026-09-29"
      )
    ).toBe(true);
    expect(lgDated.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-29");

    // Same-day explicitly dated goods delivery + invoice MUST still emit DELIVERY + INVOICE!
    const datedSameDayGoods =
      "บริษัท ทดสอบสินค้า จำกัด ผู้ประกอบการจดทะเบียน VAT ขายสินค้าในประเทศมูลค่า 50,000 บาท ส่งมอบสินค้าและออกใบกำกับภาษีในวันที่ 5 พฤศจิกายน 2569";
    const lgSameDay = buildStructuredCaseFactLedger({
      question: datedSameDayGoods,
      applicableDate: null,
    });
    expect(
      lgSameDay.temporal_facts.transaction_or_event_dates.some(
        (e) => e.event_type === "DELIVERY" && e.iso_date === "2026-11-05"
      )
    ).toBe(true);
    expect(
      lgSameDay.temporal_facts.transaction_or_event_dates.some(
        (e) => e.event_type === "INVOICE" && e.iso_date === "2026-11-05"
      )
    ).toBe(true);
  });
});
