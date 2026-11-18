/**
 * REG24 — Stratified 30-Case Batch 1 (`rel.B01.rc3`) Legal Spot-Check Pack Generator
 *
 * Explicitly separates:
 * 1. `technical_response_checks` (response status, citation resolution, zero synthetic `ext.dep.`,
 *    and full source-tail rendering — explicitly marked `establishes_legal_accuracy: false`), from
 * 2. `substantive_source_comparison` & `independent_legal_reviewer_verdict: null` (human Thai tax
 *    counsel verification against original `rd.go.th` / Google Drive official sources).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { queryKnowledge } from "../src/core/knowledge/query";
import { resolveAuthorizedEvidence } from "../src/core/knowledge/evidence";
import type { Actor } from "../src/core/knowledge/contracts";

const LEGAL_SPOTCHECK_ACTOR: Actor = {
  actor_id: "spotcheck.harness@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

export interface LegalSpotCheckCaseSpec {
  spotcheck_id: string;
  stratum:
    | "S1_remediated_facts_vs_ruling_separation"
    | "S2_subordinate_law_and_decree_precision"
    | "S3_revenue_code_sections_and_temporal_versions"
    | "S4_quarantined_external_citation_suppression"
    | "S5_multi_year_homonym_ruling_disambiguation"
    | "S6_out_of_scope_and_nonexistent_abstention";
  question: string;
  mode: "standard" | "exact_lookup" | "comparison";
  applicable_date: string | null;
  legal_check_focus: string;
}

export const B01_LEGAL_SPOTCHECK_30_SPECS: LegalSpotCheckCaseSpec[] = [
  // Stratum 1: Facts vs Official Ruling Separation (6 cases)
  {
    spotcheck_id: "LSC-01",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question:
      "ในหนังสือตอบข้อหารือ กค 0702/1494 ข้อเท็จจริงของกองมรดกผู้ขอคืนภาษีคืออะไร และกรมสรรพากรวินิจฉัยเรื่องเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ อย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus:
      "Requester facts (estate filing P.N.D.90) separated from complete 3-point Section 47 bis & Section 48 RD conclusion.",
  },
  {
    spotcheck_id: "LSC-02",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1903",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus:
      "Animal feed supplement importer facts separated from Section 81(2)(ก) juncto Section 81(1)(ง) VAT import exemption conclusion (subject to Department of Livestock Development animal-feed certification).",
  },
  {
    spotcheck_id: "LSC-03",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/634",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "96.5% gold jewelry import facts separated from non-exemption VAT conclusion.",
  },
  {
    spotcheck_id: "LSC-04",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/4825",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus:
      "Verify requester_facts != official_conclusion, all 4 numbered points rendered through Royal Decree 595 Section 4, and exact rd.go.th/65296.html URL.",
  },
  {
    spotcheck_id: "LSC-05",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/11340",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Historical 0811 ruling separation of facts vs complete official conclusion.",
  },
  {
    spotcheck_id: "LSC-06",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/6077",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus:
      "EV motorcycle subsidy & dealer-rebate facts separated from 2-point VAT (Sections 79, 79(1), 82/10(1)) and CIT exemption (Royal Decree 773 Section 3, quarantined external decree disclosed) conclusion.",
  },

  // Stratum 2: Subordinate Law & Royal Decree Precision (5 cases)
  {
    spotcheck_id: "LSC-07",
    stratum: "S2_subordinate_law_and_decree_precision",
    question:
      "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/13980 เรื่องการยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกา ฉบับที่ 244 มาตรา 3 (5)",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Confirm Royal Decree 244 Section 3(5) is linked (not Revenue Code Section 3).",
  },
  {
    spotcheck_id: "LSC-08",
    stratum: "S2_subordinate_law_and_decree_precision",
    question:
      "ตามหนังสือตอบข้อหารือ กค 0702/1248 การให้เช่าที่ดินระยะเวลา 30 ปี มูลค่า 1,470,993,502.74 บาท ต้องรับรู้รายได้เพื่อเสียภาษีเงินได้นิติบุคคลตามมาตรา 65 และคำสั่งกรมสรรพากรใด",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Numeric precision (1,470,993,502.74) and Departmental Instructions ท.ป. 1/2528 & ท.ป. 299/2561.",
  },
  {
    spotcheck_id: "LSC-09",
    stratum: "S2_subordinate_law_and_decree_precision",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/2751",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Verify subordinate Royal Decree / Ministerial Regulation references.",
  },
  {
    spotcheck_id: "LSC-10",
    stratum: "S2_subordinate_law_and_decree_precision",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/02557",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus:
      "Mandatory insurance business separation (life vs. non-life) CIT net-profit computation under Sections 65, 65 bis, and 65 ter.",
  },
  {
    spotcheck_id: "LSC-11",
    stratum: "S2_subordinate_law_and_decree_precision",
    question:
      "เปรียบเทียบการเสียภาษีมูลค่าเพิ่มระหว่างการขายสารเสริมสำหรับสัตว์ใน กค 0702/1903 กับการขายทองรูปพรรณความบริสุทธิ์ร้อยละ 96.5 ใน กค 0702/634",
    mode: "comparison",
    applicable_date: null,
    legal_check_focus: "Side-by-side comparison preserves negation (ได้รับยกเว้น vs ไม่ได้รับยกเว้น).",
  },

  // Stratum 3: Revenue Code Sections & Bitemporal Versions (5 cases)
  {
    spotcheck_id: "LSC-12",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question:
      "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2018-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
    mode: "standard",
    applicable_date: "2018-06-30",
    legal_check_focus:
      "Suppresses unverified pre-amendment historical version (`INSUFFICIENT_EVIDENCE` — never reconstructs historical law from current consolidated text) and warns to check actual accounting-period start date (`>= 1 ม.ค. 2561` under Act No. 51 B.E. 2562).",
  },
  {
    spotcheck_id: "LSC-13",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question:
      "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2024-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
    mode: "standard",
    applicable_date: "2024-06-30",
    legal_check_focus: "Point-in-time version selection after 2019 amendment.",
  },
  {
    spotcheck_id: "LSC-14",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question: "ค้นหาแนววินิจฉัยกรมสรรพากรเกี่ยวกับเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ แห่งประมวลรัษฎากร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Section 47 bis statutory text & ruling alignment.",
  },
  {
    spotcheck_id: "LSC-15",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question: "การจ่ายเงินได้ไปต่างประเทศต้องเสียภาษีเงินได้นิติบุคคลหัก ณ ที่จ่ายตามมาตรา 70 แห่งประมวลรัษฎากรอย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Cross-border Section 70 WHT scope & conditions.",
  },
  {
    spotcheck_id: "LSC-16",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question: "การส่งออกบริการหรือสินค้าได้รับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 ตามมาตรา 80/1 แห่งประมวลรัษฎากรในกรณีใด",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Zero-rate VAT Section 80/1 statutory conditions.",
  },

  // Stratum 4: Quarantined External Citation Suppression (4 cases)
  {
    spotcheck_id: "LSC-17",
    stratum: "S4_quarantined_external_citation_suppression",
    question:
      "แสดงแนววินิจฉัยในหนังสือตอบข้อหารือ กค 0702/1493 กรณีการยกเว้นภาษีธุรกิจเฉพาะและอากรแสตมป์จากการเวนคืนอสังหาริมทรัพย์",
    mode: "standard",
    applicable_date: null,
    legal_check_focus:
      "Ruling กค 0702/1493 rendered from verified RD source while warning that Royal Decree 736 remains quarantined.",
  },
  {
    spotcheck_id: "LSC-18",
    stratum: "S4_quarantined_external_citation_suppression",
    question: "ขอตัวบทมาตราทั้งหมดของพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ 736)",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Direct statutory text request for quarantined Royal Decree 736 must abstain cleanly.",
  },
  {
    spotcheck_id: "LSC-19",
    stratum: "S4_quarantined_external_citation_suppression",
    question: "ขอตัวบทมาตราทั้งหมดของพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ 773)",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Direct statutory text request for quarantined Royal Decree 773 must abstain cleanly.",
  },
  {
    spotcheck_id: "LSC-20",
    stratum: "S4_quarantined_external_citation_suppression",
    question: "ขอตัวบทมาตราทั้งหมดของพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ 750)",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Direct statutory text request for unverified Royal Decree 750 must abstain cleanly.",
  },

  // Stratum 5: Multi-Year Homonym Ruling Disambiguation (5 cases)
  {
    spotcheck_id: "LSC-21",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Exact identifier lookup with full non-truncated 0% VAT conclusion.",
  },
  {
    spotcheck_id: "LSC-22",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1230",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Exact VAT service tax-point ruling lookup with complete conclusion.",
  },
  {
    spotcheck_id: "LSC-23",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1255",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Exact 2569 CIT ruling lookup with complete multi-paragraph conclusion.",
  },
  {
    spotcheck_id: "LSC-24",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0706/พ./10877",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Special slash-prefix ruling identifier normalization (`กค 0706/พ./10877`).",
  },
  {
    spotcheck_id: "LSC-25",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811(กม.03)/366",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Parenthetical bureau-code ruling lookup fidelity.",
  },

  // Stratum 6: Out-of-Scope Non-RD Law & Nonexistent Ruling Abstention (5 cases)
  {
    spotcheck_id: "LSC-26",
    stratum: "S6_out_of_scope_and_nonexistent_abstention",
    question:
      "เลิกจ้างพนักงานทำงานครบ 3 ปี นายจ้างต้องจ่ายค่าชดเชยเท่าไรตามพระราชบัญญัติคุ้มครองแรงงาน",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Labour Protection Act (B05 scope) must abstain cleanly in B01 trial.",
  },
  {
    spotcheck_id: "LSC-27",
    stratum: "S6_out_of_scope_and_nonexistent_abstention",
    question: "ความผิดฐานฉ้อโกงตามประมวลกฎหมายอาญา มีอายุความร้องทุกข์กี่เดือน",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Criminal Code question must abstain cleanly in B01 trial.",
  },
  {
    spotcheck_id: "LSC-28",
    stratum: "S6_out_of_scope_and_nonexistent_abstention",
    question: "คำพิพากษาศาลฎีกาที่ 1234/2565 วินิจฉัยเรื่องสัญญาค้ำประกันไว้อย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Supreme Court Deka (B10 scope) must abstain cleanly in B01 trial.",
  },
  {
    spotcheck_id: "LSC-29",
    stratum: "S6_out_of_scope_and_nonexistent_abstention",
    question: "การจำแนกพิกัดอัตราศุลกากรขาเข้าเครื่องจักรตามพระราชบัญญัติศุลกากรต้องใช้พิกัดใด",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Pure Customs tariff classification (B03 scope) without RD tax context must abstain.",
  },
  {
    spotcheck_id: "LSC-30",
    stratum: "S6_out_of_scope_and_nonexistent_abstention",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/999999",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus:
      "เลขสมมติสำหรับทดสอบ ไม่ใช่ข้อหารือจริง · ผลที่คาดหมาย: ไม่พบข้อมูล / หลักฐานไม่เพียงพอ (Synthetic negative test — must return INSUFFICIENT_EVIDENCE and never invent or substitute a ruling).",
  },
];

export async function buildB01LegalSpotCheckPack(storeDir?: string) {
  const dir =
    storeDir || path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const store = new DurableKnowledgeStore(dir);
  const st = store.getState();
  const targetReleaseId = st.releases["rel.B01.rc5"]
    ? "rel.B01.rc5"
    : st.releases["rel.B01.rc4"]
      ? "rel.B01.rc4"
      : st.releases["rel.B01.rc3"]
        ? "rel.B01.rc3"
        : st.releases["rel.B01.rc2"]
          ? "rel.B01.rc2"
          : Object.keys(st.releases).sort().pop() || "rel.B01.rc5";
  const rel = st.releases[targetReleaseId];
  const allRelPassages = store.getPassagesForRelease(targetReleaseId);

  const items = [];
  for (const spec of B01_LEGAL_SPOTCHECK_30_SPECS) {
    const ans = await queryKnowledge(
      {
        question: spec.question,
        release_id: targetReleaseId,
        mode: spec.mode,
        applicable_date: spec.applicable_date,
      },
      LEGAL_SPOTCHECK_ACTOR,
      { store }
    );
    const citations = ans.evidence.slice(0, 6).map((ev) => {
      const resolved = resolveAuthorizedEvidence(store, ev.passage_id, LEGAL_SPOTCHECK_ACTOR);
      return {
        passage_id: ev.passage_id,
        work_id: ev.work_id,
        version_id: ev.version_id,
        official_identifier: ev.official_identifier,
        statement_role: ev.statement_role,
        authenticity_status: ev.authenticity_status,
        origin_uri: resolved.locator?.origin_uri || ev.locator.origin_uri,
        verbatim_excerpt: ev.exact_excerpt.slice(0, 280),
      };
    });
    const hasSyntheticExtDep = ans.evidence.some((ev) => {
      const p = st.passages[ev.passage_id];
      return p ? p.extraction_id.startsWith("ext.dep.") : false;
    });

    const primaryConcEv = ans.evidence.find(
      (ev) => ev.statement_role === "official_conclusion" || ev.statement_role === "statutory_text"
    );
    let sourceFullConclusionChars: number | null = null;
    let sourceFinalTailIncludedInAnswer: boolean | null = null;
    let sourceFinal100Chars: string | null = null;
    if (primaryConcEv) {
      const pSeed = st.passages[primaryConcEv.passage_id];
      const prefix = pSeed ? pSeed.structural_path.slice(0, -1).join(" > ") : "";
      const fullUnits = allRelPassages
        .filter(
          (p) =>
            p.work_id === primaryConcEv.work_id &&
            p.version_id === primaryConcEv.version_id &&
            p.statement_role === primaryConcEv.statement_role &&
            (!prefix || p.structural_path.slice(0, -1).join(" > ") === prefix)
        )
        .sort((a, b) => {
          const ua = Number((a.structural_path.at(-1) || "").replace(/\D+/g, "")) || 0;
          const ub = Number((b.structural_path.at(-1) || "").replace(/\D+/g, "")) || 0;
          return ua - ub;
        });
      const fullSourceText = fullUnits.map((u) => u.exact_text).join("\n");
      sourceFullConclusionChars = fullSourceText.length;
      sourceFinal100Chars = fullSourceText.slice(-100);
      sourceFinalTailIncludedInAnswer = Boolean(
        sourceFinal100Chars && ans.answer.includes(sourceFinal100Chars)
      );
    }

    const bulletLines = (ans.answer || "")
      .split("\n")
      .filter((line) => line.startsWith("- ") && !line.startsWith("- **"));
    const cutoffBulletCount = bulletLines.filter((b) => {
      const text = b.slice(2).trim();
      // Flag any legacy 220-char slice, dangling leading Thai vowel, or false date/word trigger
      return (
        /[\u0E40-\u0E44\u0E31]$/u.test(text) ||
        /^(?:หากำไร|หากฎหมาย|เมื่อ\s*(?:วันที่|วัน|เดือน|ปี|พ\.ศ\.|ใด(?:\s|$)))/u.test(text) ||
        (text.length >= 218 && text.length <= 242 && !/(?:รัษฎากร|ดังกล่าว|ได้|ต่อไป|เท่านั้น|แล้วแต่กรณี|\)|[0-9]{4})$/u.test(text))
      );
    }).length;

    const isSyntheticTest = spec.spotcheck_id === "LSC-30";
    items.push({
      ...spec,
      is_synthetic_test_reference: isSyntheticTest,
      synthetic_test_label_th: isSyntheticTest
        ? "เลขสมมติสำหรับทดสอบ ไม่ใช่ข้อหารือจริง"
        : null,
      expected_result_label_th: isSyntheticTest
        ? "ไม่พบข้อมูล / หลักฐานไม่เพียงพอ"
        : null,
      observed_release_id: ans.release_id,
      observed_status: ans.status,
      trace_id: ans.trace_id,
      coverage_warnings: ans.coverage_warnings,
      zero_synthetic_ext_dep_verified: !hasSyntheticExtDep,
      technical_response_checks: {
        establishes_substantive_legal_accuracy: false,
        status_code_returned: ans.status,
        all_citations_resolve: citations.every((c) => Boolean(c.origin_uri)),
        zero_synthetic_ext_dep: !hasSyntheticExtDep,
        source_full_conclusion_chars: sourceFullConclusionChars,
        full_conclusion_tail_rendered_in_answer: sourceFinalTailIncludedInAnswer,
        source_final_100_chars: sourceFinal100Chars,
        rendered_condition_or_exception_bullets: bulletLines.length,
        cutoff_condition_or_exception_bullets: cutoffBulletCount,
      },
      citations,
      answer_text: ans.answer,
      independent_legal_reviewer_verdict: null,
      independent_legal_reviewer_notes: null,
    });
  }

  const answeredItemsWithSource = items.filter(
    (i) => i.technical_response_checks.source_full_conclusion_chars !== null
  );

  const pack = {
    generated_at: new Date().toISOString(),
    release_id: targetReleaseId,
    manifest_id: rel?.manifest_id || null,
    manifest_hash: rel?.manifest_hash || null,
    evidence_classification_notice:
      "IMPORTANT: Automated technical checks (HTTP/AnswerStatus, snapshot parity, zero synthetic ext.dep., and verbatim tail completeness) verify pipeline mechanics ONLY and DO NOT by themselves establish substantive Thai tax-law accuracy. Substantive legal sign-off requires human Thai tax counsel inspection against original rd.go.th / Royal Gazette sources (`independent_legal_reviewer_verdict`).",
    automated_tests_replace_independent_legal_review: false,
    royal_decrees_736_773_policy: "EXCLUDED_QUARANTINED_UNLESS_REQUIRED_BY_TRIAL_QUESTIONS",
    total_cases: items.length,
    automated_guard_summary: {
      zero_synthetic_ext_dep_across_all_30: items.every((i) => i.zero_synthetic_ext_dep_verified),
      stratum_6_abstentions_passed: items
        .filter((i) => i.stratum === "S6_out_of_scope_and_nonexistent_abstention")
        .every((i) => i.observed_status === "INSUFFICIENT_EVIDENCE"),
      stratum_4_direct_quarantine_abstentions_passed: items
        .filter((i) => ["LSC-18", "LSC-19", "LSC-20"].includes(i.spotcheck_id))
        .every((i) => i.observed_status === "INSUFFICIENT_EVIDENCE"),
      lsc12_unverified_historical_statute_suppressed:
        items.find((i) => i.spotcheck_id === "LSC-12")?.observed_status === "INSUFFICIENT_EVIDENCE" &&
        (items.find((i) => i.spotcheck_id === "LSC-12")?.citations.length ?? 99) === 0,
      all_answered_cases_render_complete_source_tail: answeredItemsWithSource.every(
        (i) => i.technical_response_checks.full_conclusion_tail_rendered_in_answer === true
      ),
      zero_cutoff_condition_bullets_across_all_30: items.every(
        (i) => i.technical_response_checks.cutoff_condition_or_exception_bullets === 0
      ),
    },
    cases: items,
  };

  const outPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "b01_rc2_legal_spotcheck_pack_30cases.json"
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2), "utf8");
  return pack;
}

if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("generate-b01-legal-spotcheck-pack.ts")
) {
  buildB01LegalSpotCheckPack()
    .then((p) => {
      console.log(
        JSON.stringify(
          {
            release_id: p.release_id,
            manifest_id: p.manifest_id,
            total_cases: p.total_cases,
            automated_guard_summary: p.automated_guard_summary,
          },
          null,
          2
        )
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
