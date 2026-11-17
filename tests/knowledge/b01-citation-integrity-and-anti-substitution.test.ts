import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { THAI_TAX_RULINGS_CORPUS } from "../../src/core/data/thai-tax-rulings-loader";
import { RD_DRIVE_MANIFEST } from "../../src/core/data/rd-drive-manifest-loader";
import { getRecoveredB01RulingTexts } from "../../src/core/data/verified-statutory-loader";
import {
  normalizeOfficialRulingIdentifier,
  parseThaiBuddhistDateToIso,
} from "../../src/core/knowledge/identity";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";

const TEST_ACTOR: Actor = {
  actor_id: "citation.integrity.verifier@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("B01 Core Product Requirement: Real Citation Accuracy, Anti-Silent-Substitution & Homonym Disambiguation", () => {
  const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const uiPagePath = path.resolve(process.cwd(), "src", "app", "admin", "knowledge", "batches", "page.tsx");
  const spotCheckPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "b01_rc2_legal_spotcheck_pack_30cases.json"
  );

  it("1. Labels Q8 (กค 0702/999999) and all synthetic negative test items clearly in Thai and shows expected abstention", () => {
    const uiSource = fs.readFileSync(uiPagePath, "utf8");
    expect(uiSource).toContain("เลขสมมติสำหรับทดสอบ ไม่ใช่ข้อหารือจริง");
    expect(uiSource).toContain("ผลที่คาดหมาย: ไม่พบข้อมูล / หลักฐานไม่เพียงพอ");

    const spotPack = JSON.parse(fs.readFileSync(spotCheckPath, "utf8"));
    const lsc30 = spotPack.cases.find((c: { spotcheck_id: string }) => c.spotcheck_id === "LSC-30");
    expect(lsc30).toBeDefined();
    expect(lsc30.is_synthetic_test_reference).toBe(true);
    expect(lsc30.synthetic_test_label_th).toBe("เลขสมมติสำหรับทดสอบ ไม่ใช่ข้อหารือจริง");
    expect(lsc30.expected_result_label_th).toBe("ไม่พบข้อมูล / หลักฐานไม่เพียงพอ");
    expect(lsc30.observed_status).toBe("INSUFFICIENT_EVIDENCE");
    expect(lsc30.answer_text).toContain("ไม่พบข้อมูล / หลักฐานไม่เพียงพอ");
    expect(lsc30.citations).toEqual([]);
  });

  it("2. Verifies 100% ruling number, Thai date, ISO date, source URL, and conclusion-tail parity across all active TaxRuling works in rel.B01.rc5", () => {
    const store = new DurableKnowledgeStore(previewDir);
    const st = store.getState();
    const relId = "rel.B01.rc5";
    expect(st.releases[relId]).toBeDefined();

    const corpusByUrl = new Map(THAI_TAX_RULINGS_CORPUS.map((c) => [c.source_url, c]));
    const manifestByUrl = new Map<string, (typeof RD_DRIVE_MANIFEST.ruling_files)[number]>();
    for (const rf of RD_DRIVE_MANIFEST.ruling_files) {
      if (!manifestByUrl.has(rf.source_url)) {
        manifestByUrl.set(rf.source_url, rf);
      }
    }

    const activeWithdrawals = new Set(
      Object.values(st.withdrawals)
        .filter((w) => w.active)
        .map((w) => w.target_id)
    );

    const relPassages = store.getPassagesForRelease(relId);
    const passagesByWork = new Map<string, typeof relPassages>();
    for (const p of relPassages) {
      const arr = passagesByWork.get(p.work_id) || [];
      arr.push(p);
      passagesByWork.set(p.work_id, arr);
    }

    let checkedActiveRulings = 0;
    const errors: string[] = [];

    for (const [wid, psgs] of passagesByWork.entries()) {
      const w = st.works[wid];
      if (!w || w.type !== "TaxRuling") continue;
      if (activeWithdrawals.has(wid)) continue;
      checkedActiveRulings += 1;

      const uris = Array.from(new Set(psgs.map((p) => p.real_locator.origin_uri)));
      if (uris.length !== 1) {
        errors.push(`MIXED_ORIGIN_URIS on ${wid}: ${uris.join(", ")}`);
        continue;
      }
      const originUri = uris[0];
      const cRec = corpusByUrl.get(originUri);
      const mRec = manifestByUrl.get(originUri);
      if (!cRec || !mRec) {
        errors.push(`MISSING_SOURCE_RECORD for ${wid} (${originUri})`);
        continue;
      }

      const workIdNorm = w.official_identifiers[0]?.normalized || "";
      if (/กค\s*กค/.test(workIdNorm) || !workIdNorm) {
        errors.push(`MALFORMED_RULING_NO on ${wid}: '${workIdNorm}'`);
      }
      const expectedNorm = normalizeOfficialRulingIdentifier(cRec.ruling_no);
      const wWithGk = workIdNorm.startsWith("กค ") ? workIdNorm : `กค ${workIdNorm}`;
      const eWithGk = expectedNorm.startsWith("กค ") ? expectedNorm : `กค ${expectedNorm}`;
      if (wWithGk !== eWithGk) {
        errors.push(`NUMBER_MISMATCH on ${wid} (${originUri}): got '${workIdNorm}', expected '${expectedNorm}'`);
      }

      const ver = st.versions[psgs[0].version_id];
      const decIso = ver?.decision_date || "";
      const rawDate = ver?.raw_date_text || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(decIso)) {
        errors.push(`INVALID_ISO_DATE on ${wid} (${originUri}): dec='${decIso}', raw='${rawDate}'`);
      }
      const expectedIso = parseThaiBuddhistDateToIso(cRec.date);
      if (!expectedIso || decIso !== expectedIso) {
        errors.push(
          `DATE_MISMATCH on ${wid} (${originUri}): got '${decIso}' ('${rawDate}'), expected '${expectedIso}' ('${cRec.date}')`
        );
      }

      // Verify full conclusion tail parity (including 0702/5137 & 0702/6847, stripping trailing cabinet เลขตู้ footer)
      const concUnits = psgs
        .filter((p) => p.statement_role === "official_conclusion")
        .sort((a, b) => {
          const ua = Number((a.structural_path.at(-1) || "").replace(/\D+/g, "")) || 0;
          const ub = Number((b.structural_path.at(-1) || "").replace(/\D+/g, "")) || 0;
          return ua - ub;
        });
      const concJoined = concUnits.map((u) => u.exact_text).join("").replace(/\s+/g, "");
      const recMap = getRecoveredB01RulingTexts();
      const rawExpected =
        cRec.ruling && cRec.ruling.trim() && cRec.ruling.trim() !== "-"
          ? cRec.ruling
          : recMap[cRec.id]?.full_text || "";
      const cleanedExpected = rawExpected
        .replace(/\s*แนว\s*วินิจฉัย\s*-\s*(?:เลขตู้\s*[0-9๐-๙/\-\s]{3,25})?$/u, "")
        .replace(/\s*เลขตู้\s*[0-9๐-๙/\-\s]{3,25}$/u, "")
        .trim();
      const tailLen = Math.min(50, Math.max(12, concJoined.length));
      const expectedTail = cleanedExpected.replace(/\s+/g, "").slice(-tailLen);
      if (expectedTail.length >= 12 && !concJoined.includes(expectedTail)) {
        errors.push(`CONCLUSION_TAIL_MISMATCH on ${wid} (${originUri})`);
      }
    }

    expect(errors).toEqual([]);
    expect(checkedActiveRulings).toBe(4568);
  });

  it("3. Enforces zero invented numbers and zero silent substitution across invalid, similar-looking, partial-invalid, and withdrawn ruling numbers", async () => {
    const store = new DurableKnowledgeStore(previewDir);
    const relId = "rel.B01.rc5";

    const negativeCases: Array<{
      label: string;
      question: string;
      mode: "standard" | "exact_lookup" | "comparison";
      mustMentionMissing: string;
      forbiddenNeighbor: string;
    }> = [
      {
        label: "Q8 synthetic nonexistent ruling",
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999",
        mode: "exact_lookup",
        mustMentionMissing: "กค 0702/999999",
        forbiddenNeighbor: "กค 0702/636",
      },
      {
        label: "Similar-looking number 1 digit off from real กค 0702/1494 in standard mode",
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1495 เรื่องเครดิตภาษีเงินปันผลมาตรา 47 ทวิ",
        mode: "standard",
        mustMentionMissing: "กค 0702/1495",
        forbiddenNeighbor: "กค 0702/1494",
      },
      {
        label: "Wrong bureau prefix กค 0706/1494 vs real กค 0702/1494 in standard mode",
        question: "ในหนังสือตอบข้อหารือ กค 0706/1494 กรมสรรพากรวินิจฉัยเรื่องกองมรดกอย่างไร",
        mode: "standard",
        mustMentionMissing: "กค 0706/1494",
        forbiddenNeighbor: "กค 0702/1494",
      },
      {
        label: "Malformed 3-digit bureau code กค 702/1494 in standard mode",
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 702/1494",
        mode: "standard",
        mustMentionMissing: "กค 702/1494",
        forbiddenNeighbor: "กค 0702/1494",
      },
      {
        label: "Alphanumeric suffix typo กค 0702/1494ก in standard mode",
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1494ก",
        mode: "standard",
        mustMentionMissing: "กค 0702/1494ก",
        forbiddenNeighbor: "แนววินิจฉัยของกรมสรรพากร (กค 0702/1494",
      },
      {
        label: "Partial invalid comparison (valid กค 0702/1494 + invalid กค 0702/1495)",
        question: "เปรียบเทียบแนววินิจฉัย กค 0702/1494 กับ กค 0702/1495",
        mode: "comparison",
        mustMentionMissing: "กค 0702/1495",
        forbiddenNeighbor: "กรณี/รุ่นที่ 1",
      },
      {
        label: "Withdrawn inquiry-only ruling กค 0706/10072",
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0706/10072",
        mode: "standard",
        mustMentionMissing: "กค 0706/10072",
        forbiddenNeighbor: "แนววินิจฉัยของกรมสรรพากร",
      },
    ];

    for (const nc of negativeCases) {
      const ans = await queryKnowledge(
        { question: nc.question, release_id: relId, mode: nc.mode },
        TEST_ACTOR,
        { store }
      );
      expect(ans.status, nc.label).toBe("INSUFFICIENT_EVIDENCE");
      expect(ans.answer, nc.label).toContain("ไม่พบข้อมูล / หลักฐานไม่เพียงพอ");
      expect(ans.answer, nc.label).toContain(nc.mustMentionMissing);
      expect(ans.answer, nc.label).not.toContain(nc.forbiddenNeighbor);
      expect(ans.evidence, nc.label).toEqual([]);
    }
  });

  it("4. Disambiguates real multi-year and same-year homonym ruling numbers by year/date and abstains on nonexistent years", async () => {
    const store = new DurableKnowledgeStore(previewDir);
    const relId = "rel.B01.rc5";

    // A. Bare lookup of กค 0702/636 -> answers 2569 ruling (68302.html) AND discloses 2555 sibling (46391.html)
    const bare636 = await queryKnowledge(
      { question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636", release_id: relId, mode: "exact_lookup" },
      TEST_ACTOR,
      { store }
    );
    expect(bare636.status).toBe("ANSWERED");
    expect(bare636.answer).toContain("5 กุมภาพันธ์ 2569");
    expect(bare636.answer).toContain("https://www.rd.go.th/68302.html");
    expect(bare636.answer).toContain("หมายเหตุข้อหารือเลขที่ซ้ำต่างฉบับในคลังกรมสรรพากร");
    expect(bare636.answer).toContain("23 มกราคม 2555");
    expect(bare636.answer).toContain("https://www.rd.go.th/46391.html");

    // B. Year-qualified lookup กค 0702/636 ปี 2555 -> selects 23 มกราคม 2555 (46391.html)
    const yr2555 = await queryKnowledge(
      { question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636 ปี 2555", release_id: relId, mode: "exact_lookup" },
      TEST_ACTOR,
      { store }
    );
    expect(yr2555.status).toBe("ANSWERED");
    expect(yr2555.answer).toContain("23 มกราคม 2555");
    expect(yr2555.answer).toContain("https://www.rd.go.th/46391.html");
    expect(yr2555.evidence[0].locator.origin_uri).toBe("https://www.rd.go.th/46391.html");
    expect(yr2555.evidence[0].raw_date_text).toBe("23 มกราคม 2555");

    // C. Nonexistent year for valid homonym number (กค 0702/636 ปี 2563) -> abstains without substituting 2569 or 2555!
    const yr2563 = await queryKnowledge(
      { question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636 ปี 2563", release_id: relId, mode: "exact_lookup" },
      TEST_ACTOR,
      { store }
    );
    expect(yr2563.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(yr2563.answer).toContain("ไม่พบข้อมูล / หลักฐานไม่เพียงพอ");
    expect(yr2563.answer).toContain("5 กุมภาพันธ์ 2569");
    expect(yr2563.answer).toContain("23 มกราคม 2555");
    expect(yr2563.evidence).toEqual([]);

    // D. Multi-year homonym กค 0702/1248 ปี 2557 -> selects 10 มีนาคม 2557 (52540.html) instead of 5 มีนาคม 2569 (68464.html)
    const r1248Be2557 = await queryKnowledge(
      { question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1248 ปี 2557", release_id: relId, mode: "exact_lookup" },
      TEST_ACTOR,
      { store }
    );
    expect(r1248Be2557.status).toBe("ANSWERED");
    expect(r1248Be2557.answer).toContain("10 มีนาคม 2557");
    expect(r1248Be2557.evidence[0].locator.origin_uri).toBe("https://www.rd.go.th/52540.html");

    // E. Same-year different-date pair กค 0706/4887: 15 พฤษภาคม 2549 (31913.html) vs 5 มิถุนายน 2549 (31900.html)
    const r4887May = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0706/4887 ลงวันที่ 15 พฤษภาคม 2549",
        release_id: relId,
        mode: "exact_lookup",
      },
      TEST_ACTOR,
      { store }
    );
    expect(r4887May.status).toBe("ANSWERED");
    expect(r4887May.answer).toContain("15 พฤษภาคม 2549");
    expect(r4887May.evidence[0].locator.origin_uri).toBe("https://www.rd.go.th/31913.html");

    const r4887Jun = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0706/4887 ลงวันที่ 5 มิถุนายน 2549",
        release_id: relId,
        mode: "exact_lookup",
      },
      TEST_ACTOR,
      { store }
    );
    expect(r4887Jun.status).toBe("ANSWERED");
    expect(r4887Jun.answer).toContain("5 มิถุนายน 2549");
    expect(r4887Jun.evidence[0].locator.origin_uri).toBe("https://www.rd.go.th/31900.html");
  });
});
