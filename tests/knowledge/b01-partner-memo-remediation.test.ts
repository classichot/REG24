import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore, type CanonicalPersistedState } from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";

const REVIEW_ACTOR: Actor = {
  actor_id: "partner.memo.verifier@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Partner Legal Review Memo Remediation (LSC-12, LSC-25, S-1..S-8, TQ-1..TQ-6)", () => {
  const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const spotCheckPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "b01_rc2_legal_spotcheck_pack_30cases.json"
  );
  const b01PackMdPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "Batch_1_30_Case_Legal_Review_Pack.md"
  );
  const b02ListMdPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "B02_170_Page_OCR_Pilot_Legal_Review_List.md"
  );

  it("1. Historical Law (LSC-12 & TQ-1, S-2): Suppresses unverified historical s.65 ตรี answers, checks accounting-period start date, and never fabricates pre-2019 versions", async () => {
    const store = new DurableKnowledgeStore(previewDir);
    const relId = "rel.B01.rc5";

    // Verify zero `v1_pre2019` passages exist in `rel.B01.rc5`
    const relPassages = store.getPassagesForRelease(relId);
    expect(relPassages.some((p) => p.version_id.includes("v1_pre2019"))).toBe(false);

    // LSC-12: FY as of 2018-06-30 -> clean suppression, zero citations, checks start date vs end date
    const lsc12 = await queryKnowledge(
      {
        question:
          "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2018-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
        release_id: relId,
        applicable_date: "2018-06-30",
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(lsc12.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(lsc12.evidence).toEqual([]);
    expect(lsc12.answer).toContain("ระงับการแสดงตัวบทประมวลรัษฎากร มาตรา 65 ตรี รุ่นย้อนหลัง");
    expect(lsc12.answer).toContain("วันเริ่มรอบระยะเวลาบัญชีจริง");
    expect(lsc12.answer).toContain("1 มกราคม พ.ศ. 2561");
    expect(lsc12.answer).toContain("1 กรกฎาคม 2560");
    expect(lsc12.answer).not.toContain("v1_pre2019");
    expect(lsc12.answer).not.toContain("ให้หักได้ไม่เกินห้าหมื่นบาท");

    // TQ-1: Political-party donation in FY ending 30 Jun 2561 -> must NOT apply amended s.65 ตรี(3)(ก)
    const tq1 = await queryKnowledge(
      {
        question:
          "บริษัทบริจาคเงินให้พรรคการเมืองในรอบระยะเวลาบัญชีสิ้นสุดวันที่ 30 มิถุนายน 2561 สามารถนำมาหักเป็นรายจ่ายตามมาตรา 65 ตรี (3)(ก) ได้หรือไม่",
        release_id: relId,
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(tq1.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(tq1.evidence).toEqual([]);
    expect(tq1.answer).toContain("ไม่อาจนำมาตรา 65 ตรี (3)(ก) ที่แก้ไขใหม่มาใช้บังคับได้");
    expect(tq1.answer).toContain("รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561");

    // LSC-13: Current FY 2024-06-30 -> honest consolidated rd.go.th header, operative summary, zero false Act No. 48 attribution
    const lsc13 = await queryKnowledge(
      {
        question:
          "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2024-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
        release_id: relId,
        applicable_date: "2024-06-30",
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(lsc13.status).toBe("ANSWERED");
    expect(lsc13.answer).toContain("สรุปหลักเกณฑ์สำคัญตามแหล่งอ้างอิง");
    expect(lsc13.answer).toContain("ตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบันตามข้อมูลทางการกรมสรรพากร");
    expect(lsc13.answer).not.toContain("ฉบับที่ 48");
    expect(lsc13.answer).not.toContain("2019-03-20");
    expect(lsc13.evidence.every((e) => e.work_id === "prov.th.rc.65_ตรี")).toBe(true);
  });

  it("2. Summons Period (LSC-25 & TQ-4, S-5): Preserves 2545 2-year quotation, labels internal legal memo, and attaches separately sourced s.19 5-year Director-General extension", async () => {
    const store = new DurableKnowledgeStore(previewDir);
    const relId = "rel.B01.rc5";

    const lsc25 = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811(กม.03)/366",
        release_id: relId,
        mode: "exact_lookup",
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(lsc25.status).toBe("ANSWERED");
    // 1. Preserves verbatim 2545 2-year statement
    expect(lsc25.answer).toContain(
      "อำนาจออกหมายเรียกผู้ยื่นรายการนั้นมาไต่สวน จะต้องกระทำภายในเวลาสองปี นับแต่วันที่ได้ยื่นรายการ ทั้งนี้ ตามมาตรา 19 แห่งประมวลรัษฎากร"
    );
    // 2. Labels internal Legal Affairs Bureau opinion accurately
    expect(lsc25.answer).toContain("บันทึกกองกฎหมาย");
    // 3. Distinguishes 2545 opinion from current law and states up-to-5-year DG extension & conditions
    expect(lsc25.answer).toContain("มิใช่คำอธิบายหลักกฎหมายปัจจุบันเรื่องกำหนดเวลาออกหมายเรียกที่ครบถ้วนสมบูรณ์");
    expect(lsc25.answer).toContain("อธิบดีกรมสรรพากร");
    expect(lsc25.answer).toContain("ไม่เกิน 5 ปีนับแต่วันที่ได้ยื่นรายการ");
    expect(lsc25.answer).toContain("เจตนาหลีกเลี่ยงภาษีอากร");
    expect(lsc25.answer).toContain("ประโยชน์ในการคืนภาษีอากร");
    expect(lsc25.answer).toContain("https://www.rd.go.th/5943.html#mata19");
    // 4. Both sources (กค 0811(กม.03)/366 & มาตรา 19) are cited in `evidence`
    expect(lsc25.evidence.some((e) => e.official_identifier.includes("0811(กม.03)/366"))).toBe(true);
    expect(lsc25.evidence.some((e) => e.work_id === "prov.th.rc.19")).toBe(true);

    // TQ-4: General summons after 2 years question
    const tq4 = await queryKnowledge(
      {
        question: "เจ้าพนักงานประเมินสามารถออกหมายเรียกตรวจสอบภาษีเมื่อพ้นกำหนด 2 ปีนับแต่วันยื่นแบบแสดงรายการได้หรือไม่ ตามมาตรา 19 แห่งประมวลรัษฎากร",
        release_id: relId,
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(["ANSWERED", "CONDITIONAL"]).toContain(tq4.status);
    expect(tq4.answer).toContain("ไม่เกิน 5 ปี");
    expect(tq4.answer).toContain("อธิบดี");
  });

  it("3. Citation Gate (S-1), Premise Check (S-3), Operative Summary (S-4), and Source Integrity (S-6) across all 30 LSC cases & TQ-2/3/5/6", async () => {
    const store = new DurableKnowledgeStore(previewDir);
    const relId = "rel.B01.rc5";
    const pack = JSON.parse(fs.readFileSync(spotCheckPath, "utf8")) as {
      cases: Array<{
        spotcheck_id: string;
        observed_status: string;
        answer_text: string;
        citations: Array<{ official_identifier: string; work_id: string }>;
      }>;
    };

    // S-1 Automated Citation Gate across ALL 30 LSC cases: every listed citation MUST appear in the rendered answer body!
    for (const c of pack.cases) {
      for (const cit of c.citations) {
        const bare = cit.official_identifier.replace(/^กค\s+/, "").trim();
        const appearsInBody =
          c.answer_text.includes(cit.official_identifier) ||
          (bare.length >= 4 && c.answer_text.includes(bare));
        expect(
          appearsInBody,
          `Unused citation '${cit.official_identifier}' leaked into ${c.spotcheck_id}`
        ).toBe(true);
      }
    }

    // LSC-05: Verbatim RD typo "มาตรา 46 ทวิ" preserved with explicit [sic] note, NOT quarantined as bogus statute
    const lsc05 = pack.cases.find((c) => c.spotcheck_id === "LSC-05")!;
    expect(lsc05.answer_text).toContain("มาตรา 46 ทวิ");
    expect(lsc05.answer_text).toContain("[sic]");
    expect(lsc05.answer_text).toContain("มาตรา 49 ทวิ");
    expect(lsc05.answer_text).not.toContain("usable_as_legal_evidence: false`: มาตรา 46 ทวิ");

    // LSC-07: Corrects false "income-tax exemption under RD 244 s.3(5)" premise -> SBT (`ภาษีธุรกิจเฉพาะ`) + zero unrelated rulings
    const lsc07 = pack.cases.find((c) => c.spotcheck_id === "LSC-07")!;
    expect(lsc07.answer_text).toContain("ข้อสังเกตความคลาดเคลื่อนของสมมติฐานในคำถาม");
    expect(lsc07.answer_text).toContain("มิใช่บทบัญญัติยกเว้นภาษีเงินได้");
    expect(lsc07.answer_text).toContain("อยู่ในบังคับต้องเสียภาษีธุรกิจเฉพาะ");
    expect(lsc07.citations.every((c) => c.official_identifier.includes("0811/13980"))).toBe(true);

    // LSC-11: Flags "การขาย" vs "การนำเข้า" premise mismatch, states comparison, and removes fake ruling "version" intervals
    const lsc11 = pack.cases.find((c) => c.spotcheck_id === "LSC-11")!;
    expect(lsc11.answer_text).toContain("ข้อสังเกตความคลาดเคลื่อนของสมมติฐานในคำถาม");
    expect(lsc11.answer_text).toContain("การนำเข้าสินค้าจากต่างประเทศ");
    expect(lsc11.answer_text).toContain("สรุปผลการเปรียบเทียบตามแนววินิจฉัยต้นฉบับ");
    expect(lsc11.answer_text).not.toContain("[ช่วงใช้บังคับ:");
    expect(
      lsc11.citations.every(
        (c) =>
          c.official_identifier.includes("0702/634") || c.official_identifier.includes("0702/1903")
      )
    ).toBe(true);

    // LSC-14, 15, 16: Honest consolidated statute banner (no 1 เมษายน 2482 / 28 กุมภาพันธ์ 2562 whole-section date) + grounded summary
    for (const id of ["LSC-14", "LSC-15", "LSC-16"]) {
      const sc = pack.cases.find((c) => c.spotcheck_id === id)!;
      expect(sc.answer_text, id).toContain("สรุปหลักเกณฑ์สำคัญตามแหล่งอ้างอิง");
      expect(sc.answer_text, id).toContain("ตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบันตามข้อมูลทางการกรมสรรพากร");
      expect(sc.answer_text, id).not.toContain("ใช้บังคับ 1 เมษายน 2482");
      expect(sc.answer_text, id).not.toContain("วันที่มีผลเริ่มใช้บังคับ `2019-02-28`");
    }

    // LSC-23: OCR garbage `นี้ที่ที่ซื้` removed against official rd.go.th/68530.html & no duplicated `[ข้อเสนอของผู้หารือ:` block
    const lsc23 = pack.cases.find((c) => c.spotcheck_id === "LSC-23")!;
    expect(lsc23.answer_text).not.toContain("นี้ที่ที่ซื้");
    expect(lsc23.answer_text).toContain("ในส่วนที่เกินจากมูลหนี้");
    expect(lsc23.answer_text).not.toContain("[ข้อเสนอของผู้หารือ:");

    // LSC-24 & Store-wide S-6 Canonical Provision Validator: zero `มาตรา ... แห่งประกาศ/คำสั่ง/ระเบียบ` anywhere in staging store!
    const lsc24 = pack.cases.find((c) => c.spotcheck_id === "LSC-24")!;
    expect(lsc24.answer_text).not.toContain("มาตรา 82/10(3) แห่งประกาศอธิบดีกรมสรรพากร");
    const rawState = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(path.join(previewDir, "canonical-state.json.gz"))).toString("utf8")
    ) as CanonicalPersistedState;
    const malformedUrefs = Object.values(rawState.unresolved_references).filter((u) =>
      /มาตรา.*แห่ง(?:ประกาศ|คำสั่ง|ระเบียบ)/.test(u.raw_citation_text)
    );
    expect(malformedUrefs).toEqual([]);

    // LSC-01 & LSC-03: HTML table header prefix (`ภาษีอากร กค ... ข้อหารือ`) stripped cleanly
    const lsc01 = pack.cases.find((c) => c.spotcheck_id === "LSC-01")!;
    const lsc03 = pack.cases.find((c) => c.spotcheck_id === "LSC-03")!;
    expect(lsc01.answer_text).not.toContain("เลขที่หนังสือกค 0702/1494");
    expect(lsc03.answer_text).not.toContain("เลขที่หนังสือกค 0702/634");

    // TQ-2 (undivided estate dividend credit fact-specific s.42 domicile), TQ-3 (film copyright email 0% VAT + s.78/1(1)(ก)), TQ-5 (RD 736 2561 expropriation), TQ-6 (descriptive 2555 กค 0702/636)
    const tq2 = await queryKnowledge(
      {
        question: "กองมรดกที่ยังมิได้แบ่งได้รับเงินปันผลจะมีสิทธิได้รับเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ หรือไม่ ตามข้อหารือ กค 0702/1494",
        release_id: relId,
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(tq2.answer).toContain("เฉพาะตามข้อเท็จจริงของรายนี้");
    expect(tq2.answer).toContain("มาตรา 42");

    const tq3 = await queryKnowledge(
      {
        question: "การขายลิขสิทธิ์ภาพยนตร์ให้ผู้ซื้อในต่างประเทศโดยส่งไฟล์ทางอีเมล เสียภาษีมูลค่าเพิ่มอัตราใดและจุดความรับผิดเกิดขึ้นเมื่อใด",
        release_id: relId,
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(tq3.answer).toContain("ร้อยละ 0");
    expect(tq3.answer).toContain("80/1 (2)");
    expect(tq3.answer).toContain("ฉบับที่ 105");
    expect(tq3.answer).toContain("78/1 (1) (ก)");

    const tq5 = await queryKnowledge(
      {
        question: "พระราชกฤษฎีกา (ฉบับที่ 736) ใช้บังคับกับการเวนคืนอสังหาริมทรัพย์ในปี 2561 หรือไม่",
        release_id: relId,
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(tq5.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(tq5.evidence).toEqual([]);

    const tq6 = await queryKnowledge(
      {
        question: "ตามหนังสือตอบข้อหารือ กค 0702/636 การโอนอสังหาริมทรัพย์โดยการให้เข้าถือกรรมสิทธิ์รวมต้องหักภาษีเงินได้ ณ ที่จ่ายอย่างไร",
        release_id: relId,
      },
      REVIEW_ACTOR,
      { store }
    );
    expect(tq6.status).toBe("ANSWERED");
    expect(tq6.answer).toContain("23 มกราคม 2555");
    expect(tq6.answer).toContain("https://www.rd.go.th/46391.html");
    expect(tq6.answer).not.toContain("https://www.rd.go.th/68302.html)**:");
  });

  it("4. Preview Security (S-8): Committed repo files (docs, scripts, src, and tests) contain ZERO _vercel_share tokens or legacy bypass secrets", () => {
    const b01Md = fs.readFileSync(b01PackMdPath, "utf8");
    const b02Md = fs.readFileSync(b02ListMdPath, "utf8");
    const scriptSrc = fs.readFileSync(
      path.resolve(process.cwd(), "scripts", "prepare-owner-legal-review-packs.ts"),
      "utf8"
    );
    const selfTestSrc = fs.readFileSync(__filename, "utf8");

    expect(b01Md).not.toContain("_vercel_share=");
    expect(b02Md).not.toContain("_vercel_share=");
    expect(scriptSrc).not.toMatch(/[?&]_vercel_share=[A-Za-z0-9_-]+/);

    // Verify by one-way SHA-256 digest ONLY so revoked plaintext tokens NEVER appear anywhere in code or tests!
    const REVOKED_SHARE_TOKEN_SHA256_SET = new Set([
      "7349478fe971665f8ca2079fea1b8cc933cc9988395a088b29234a62f6dd7106",
      "9a0a0c228233fc143efc171b0b194f143554d4bbab149153c43b152d6ee65558",
    ]);
    for (const content of [b01Md, b02Md, scriptSrc, selfTestSrc]) {
      const candidateTokens = content.match(/\b[A-Za-z0-9]{32}\b/g) || [];
      for (const cand of candidateTokens) {
        const digest = crypto.createHash("sha256").update(cand).digest("hex");
        expect(REVOKED_SHARE_TOKEN_SHA256_SET.has(digest)).toBe(false);
      }
    }
  });
});
