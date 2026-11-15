/**
 * REG24 — Stratified 30-Case Batch 1 (`rel.B01.rc2`) Legal Spot-Check Pack Generator
 *
 * Prepares a deterministic, side-by-side source-to-answer inspection workbook for Independent
 * Thai Legal Counsel + Dodo across 6 legal risk strata on `rel.B01.rc2` (`mfst.b01.mwi46hrg`).
 * Leaves `independent_legal_verdict: null` — automated checks NEVER substitute for human legal sign-off.
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
    legal_check_focus: "Requester facts (estate filing P.N.D.90) separated from official Section 47 bis ruling.",
  },
  {
    spotcheck_id: "LSC-02",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1903",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Animal feed supplement importer facts separated from Section 81(1)(ฉ) VAT exemption conclusion.",
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
    legal_check_focus: "Verify requester_facts != official_conclusion and exact rd.go.th origin URL.",
  },
  {
    spotcheck_id: "LSC-05",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/11340",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Historical 0811 ruling separation of facts vs official conclusion.",
  },
  {
    spotcheck_id: "LSC-06",
    stratum: "S1_remediated_facts_vs_ruling_separation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/6077",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "EV subsidy facts separated from CIT conclusion.",
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
    legal_check_focus: "Verify property sale-with-right-of-redemption tax ruling citations.",
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
    legal_check_focus: "Must select pre-2019 version (v1_pre2019) of Section 65 ter.",
  },
  {
    spotcheck_id: "LSC-13",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question: "ประมวลรัษฎากร มาตรา 65 ตรี ณ วันที่ 2025-01-15 ใช้บทบัญญัติรุ่นปัจจุบันใดบังคับ",
    mode: "standard",
    applicable_date: "2025-01-15",
    legal_check_focus: "Must select current post-Act-No.-48 version (v2_current) of Section 65 ter.",
  },
  {
    spotcheck_id: "LSC-14",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question: "ประมวลรัษฎากร มาตรา 47 ทวิ กำหนดหลักเกณฑ์เครดิตภาษีเงินปันผลไว้อย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Verbatim official rd.go.th Revenue Code Section 47 bis text.",
  },
  {
    spotcheck_id: "LSC-15",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question: "ประมวลรัษฎากร มาตรา 80/1 กำหนดอัตราภาษีมูลค่าเพิ่มร้อยละ 0 ในกรณีใดบ้าง",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Verbatim official rd.go.th Revenue Code Section 80/1 text.",
  },
  {
    spotcheck_id: "LSC-16",
    stratum: "S3_revenue_code_sections_and_temporal_versions",
    question: "ประมวลรัษฎากร มาตรา 65 กำหนดการคำนวณกำไรสุทธิเพื่อเสียภาษีเงินได้นิติบุคคลอย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Verbatim official rd.go.th Revenue Code Section 65 text.",
  },

  // Stratum 4: Quarantined External Citations Control (5 cases)
  {
    spotcheck_id: "LSC-17",
    stratum: "S4_quarantined_external_citation_suppression",
    question:
      "แสดงแนววินิจฉัยในหนังสือตอบข้อหารือ กค 0702/1493 กรณีการยกเว้นภาษีธุรกิจเฉพาะและอากรแสตมป์จากการเวนคืนอสังหาริมทรัพย์",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Shows RD ruling 0702/1493 + explicit coverage_warnings for quarantined Royal Decree 736.",
  },
  {
    spotcheck_id: "LSC-18",
    stratum: "S4_quarantined_external_citation_suppression",
    question: "พระราชกฤษฎีกา ฉบับที่ 736 บัญญัติหลักเกณฑ์ไว้อย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Direct statutory lookup of quarantined Royal Decree 736 must abstain (INSUFFICIENT_EVIDENCE).",
  },
  {
    spotcheck_id: "LSC-19",
    stratum: "S4_quarantined_external_citation_suppression",
    question: "พระราชกฤษฎีกา ฉบับที่ 773 บัญญัติหลักเกณฑ์การยกเว้นภาษีไว้อย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Direct statutory lookup of quarantined Royal Decree 773 must abstain (INSUFFICIENT_EVIDENCE).",
  },
  {
    spotcheck_id: "LSC-20",
    stratum: "S4_quarantined_external_citation_suppression",
    question: "พระราชกฤษฎีกา ฉบับที่ 9999 บัญญัติหลักเกณฑ์ไว้อย่างไร",
    mode: "standard",
    applicable_date: null,
    legal_check_focus: "Direct lookup of nonexistent Royal Decree 9999 must abstain (INSUFFICIENT_EVIDENCE).",
  },
  {
    spotcheck_id: "LSC-21",
    stratum: "S4_quarantined_external_citation_suppression",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/3734",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Expropriation ruling check: zero synthetic ext.dep.* passages in citations.",
  },

  // Stratum 5: Multi-Year Homonym Ruling Disambiguation & Thai Digits (4 cases)
  {
    spotcheck_id: "LSC-22",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Returns distinct canonical works for 2026 (68302.html) and 2012 (46391.html) without merging.",
  },
  {
    spotcheck_id: "LSC-23",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขไทย กค ๐๗๐๒ / ๖๓๖",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Thai-digit identifier parity with Arabic digits.",
  },
  {
    spotcheck_id: "LSC-24",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1248",
    mode: "exact_lookup",
    applicable_date: null,
    legal_check_focus: "Preserves both 2026 (68464.html) and 2014 (52540.html) homonym rulings distinctly.",
  },
  {
    spotcheck_id: "LSC-25",
    stratum: "S5_multi_year_homonym_ruling_disambiguation",
    question: "ค้นหาหนังสือตอบข้อหารือเลขที่ 0811(กม.02)/931",
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
    legal_check_focus: "Nonexistent RD ruling identifier must return INSUFFICIENT_EVIDENCE.",
  },
];

export async function buildB01LegalSpotCheckPack(storeDir?: string) {
  const dir =
    storeDir || path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const store = new DurableKnowledgeStore(dir);
  const st = store.getState();
  const rel = st.releases["rel.B01.rc2"];

  const items = [];
  for (const spec of B01_LEGAL_SPOTCHECK_30_SPECS) {
    const ans = await queryKnowledge(
      {
        question: spec.question,
        release_id: "rel.B01.rc2",
        mode: spec.mode,
        applicable_date: spec.applicable_date,
      },
      LEGAL_SPOTCHECK_ACTOR,
      { store }
    );
    const citations = ans.evidence.slice(0, 4).map((ev) => {
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

    items.push({
      ...spec,
      observed_release_id: ans.release_id,
      observed_status: ans.status,
      trace_id: ans.trace_id,
      coverage_warnings: ans.coverage_warnings,
      zero_synthetic_ext_dep_verified: !hasSyntheticExtDep,
      citations,
      answer_text: ans.answer,
      independent_legal_reviewer_verdict: null,
      independent_legal_reviewer_notes: null,
    });
  }

  const pack = {
    generated_at: new Date().toISOString(),
    release_id: "rel.B01.rc2",
    manifest_id: rel?.manifest_id || "mfst.b01.mwi46hrg",
    manifest_hash: rel?.manifest_hash || null,
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
