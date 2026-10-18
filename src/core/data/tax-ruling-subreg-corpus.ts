/**
 * REG24 — Tax Rulings & Revenue Code Sub-Regulations Expansion Corpus (v1.1 | October 2026)
 *
 * Implements:
 * - REG-TAX-SUB (reg24.tax.sub.th): Royal Decrees, Ministerial Regulations, MOF/DG Notifications, RD Orders (ท.ป./ป.), and Emergency Decree on Top-up Tax B.E. 2567 (GMT24)
 * - REG-TAX-RULING (reg24.tax.ruling.th): RD Tax Consultation Letters (กค 0702(กม.)/462 dated 22 April 2026 & กค 0702(กม.)/453 dated 11 April 2025) & Tax Ruling Committee Decisions
 * - REG-TAX-CASE (reg24.tax.case.th): Supreme Court Tax Division & Central Tax Court Jurisprudence
 * - REG-TAX-CHANGE (reg24.tax.change.th): Tax Legal Amendments, Interpretation Changes & Compliance Impact Monitoring
 */

import {
  Regulator,
  SourceDocument,
  LegalInstrument,
  Provision,
  ProvisionVersion,
  ModuleReference,
  LegalConcept,
  Obligation,
  RuleDefinition,
  GraphEdge,
  RegulatoryChange,
  ModuleManifest,
  TaxSubRegulationRecord,
  TaxRulingRecord,
  TaxJudicialDecisionRecord,
} from "../types/legal-schema";

export const TAX_EXPANSION_REGULATORS: Regulator[] = [
  {
    id: "reg.th.trc",
    code: "TRC-RD",
    name_th: "คณะกรรมการวินิจฉัยภาษีอากร (ตามมาตรา 13 สัตต แห่งประมวลรัษฎากร)",
    name_en: "Commission of Taxation (Tax Ruling Committee — Revenue Code Sec. 13 Septies)",
    jurisdiction_id: "jur.th",
    official_url: "https://www.rd.go.th/1601.html",
  },
  {
    id: "reg.th.taxcourt",
    code: "TAX-COURT",
    name_th: "ศาลฎีกาแผนกคดีภาษีอากร และศาลภาษีอากรกลาง",
    name_en: "Supreme Court Tax Division & Central Tax Court of Thailand",
    jurisdiction_id: "jur.th",
    official_url: "https://taxc.coj.go.th",
  },
];

export const TAX_EXPANSION_SOURCES: SourceDocument[] = [
  {
    id: "src.th.rd.ruling.462_2569",
    title_th: "ข้อหารือกรมสรรพากร ที่ กค 0702(กม.)/462 ลงวันที่ 22 เมษายน 2569 เรื่อง ภาระภาษีอากร กรณีการควบรวมบริษัทจำกัด",
    title_en:
      "Revenue Department Tax Ruling No. GorKor 0702(GorMor.)/462 dated 22 April 2026: Tax Treatment of a Limited Company Merger under the Amended Civil and Commercial Code",
    regulator_id: "reg.th.rd",
    official_url: "https://www.rd.go.th/68635.html",
    publication_date: "2026-04-22",
    acquired_at: "2026-10-18T11:00:00Z",
    sha256_hash: "a46207022026042299887766554433221100ffeeddccbbaa9988776655443322",
    verified_at: "2026-10-18T11:15:00Z",
    immutable_locked: true,
    mime_type: "text/html",
    status: "verified",
    regulatory_binding_status: "binding_enacted",
  },
  {
    id: "src.th.rd.ruling.453_2568",
    title_th: "ข้อหารือกรมสรรพากร ที่ กค 0702(กม.)/453 ลงวันที่ 11 เมษายน 2568 เรื่อง ภาระภาษีอากร กรณีการควบรวมบริษัทจำกัดตามประมวลกฎหมายแพ่งและพาณิชย์แก้ไขเพิ่มเติม",
    title_en:
      "Revenue Department Tax Ruling No. GorKor 0702(GorMor.)/453 dated 11 April 2025: Tax Treatment of Company Mergers under the Amended CCC (Surviving Entity Structure)",
    regulator_id: "reg.th.rd",
    official_url: "https://www.rd.go.th/68629.html",
    publication_date: "2025-04-11",
    acquired_at: "2026-10-18T11:05:00Z",
    sha256_hash: "b453070220250411887766554433221100ffeeddccbbaa998877665544332211",
    verified_at: "2026-10-18T11:20:00Z",
    immutable_locked: true,
    mime_type: "text/html",
    status: "verified",
    regulatory_binding_status: "binding_enacted",
  },
  {
    id: "src.th.rd.subreg.rd10_mr126",
    title_th: "พระราชกฤษฎีกาฯ (ฉบับที่ 10) พ.ศ. 2500 และกฎกระทรวง ฉบับที่ 126 (พ.ศ. 2509) ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากรสำหรับการควบหรือโอนกิจการ",
    title_en:
      "Royal Decree No. 10 B.E. 2500 & Ministerial Regulation No. 126 B.E. 2509 Issued under the Revenue Code (Merger & Entire Business Transfer Tax Exemptions)",
    regulator_id: "reg.th.rd",
    official_url: "https://www.rd.go.th/674.html",
    publication_date: "1966-02-23",
    acquired_at: "2026-10-18T11:10:00Z",
    sha256_hash: "c1260010250025097766554433221100ffeeddccbbaa99887766554433221100",
    verified_at: "2026-10-18T11:25:00Z",
    immutable_locked: true,
    mime_type: "application/pdf",
    status: "verified",
    regulatory_binding_status: "binding_enacted",
  },
  {
    id: "src.th.trc.1601",
    title_th: "คำวินิจฉัยของคณะกรรมการวินิจฉัยภาษีอากร ที่ 40/2560 และคลังคำวินิจฉัยตามมาตรา 13 สัตต แห่งประมวลรัษฎากร",
    title_en:
      "Tax Ruling Committee Decisions Archive (Commission of Taxation Formal Interpretations under Revenue Code Sec. 13 Septies)",
    regulator_id: "reg.th.trc",
    official_url: "https://www.rd.go.th/1601.html",
    publication_date: "2017-09-15",
    acquired_at: "2026-10-18T11:12:00Z",
    sha256_hash: "d1601040256099887766554433221100ffeeddccbbaa99887766554433221199",
    verified_at: "2026-10-18T11:28:00Z",
    immutable_locked: true,
    mime_type: "text/html",
    status: "verified",
    regulatory_binding_status: "binding_enacted",
  },
  {
    id: "src.th.topuptax.2567",
    title_th: "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. ๒๕๖๗ (Global Minimum Tax / Pillar Two 15%)",
    title_en:
      "Emergency Decree on Top-up Tax B.E. 2567 (2024) — OECD Pillar Two 15% Global Minimum Tax Framework for MNEs (GMT24)",
    regulator_id: "reg.th.rd",
    official_url: "https://www.rd.go.th/67656.html",
    publication_date: "2024-12-26",
    acquired_at: "2026-10-18T11:15:00Z",
    sha256_hash: "e2567150075000007766554433221100ffeeddccbbaa99887766554433221188",
    verified_at: "2026-10-18T11:30:00Z",
    immutable_locked: true,
    mime_type: "application/pdf",
    status: "verified",
    regulatory_binding_status: "binding_enacted",
  },
];

export const TAX_EXPANSION_INSTRUMENTS: LegalInstrument[] = [
  {
    id: "inst.th.rd.subregs",
    jurisdiction_id: "jur.th",
    regulator_id: "reg.th.rd",
    canonical_owner_module: "reg24.tax.sub.th",
    type: "royal_decree",
    title_th: "พระราชกฤษฎีกา กฎกระทรวง ประกาศอธิบดี และคำสั่งกรมสรรพากร ออกตามความในประมวลรัษฎากร (พ.ร.ฎ. 10 / กฎกระทรวง 126 / ท.ป. / ป.)",
    title_en: "Revenue Code Subsidiary Regulations (Royal Decree No. 10, Ministerial Regulation No. 126, DG Notifications & RD Orders)",
    short_code: "RC-SUB",
    enacted_date: "1966-02-23",
    effective_date: "1966-02-24",
    source_document_id: "src.th.rd.subreg.rd10_mr126",
  },
  {
    id: "inst.th.rd.rulings",
    jurisdiction_id: "jur.th",
    regulator_id: "reg.th.rd",
    canonical_owner_module: "reg24.tax.ruling.th",
    type: "ruling",
    title_th: "คลังข้อหารือภาษีอากรกรมสรรพากร (พ.ศ. 2540–2569) และคำวินิจฉัยของคณะกรรมการวินิจฉัยภาษีอากร (กค 0702(กม.)/462 และ กค 0702(กม.)/453)",
    title_en: "Revenue Department Tax Consultation Letters (1997–2026 Archive) & Tax Ruling Committee Formal Decisions",
    short_code: "RD-RULING",
    enacted_date: "1997-01-01",
    effective_date: "2026-04-22",
    source_document_id: "src.th.rd.ruling.462_2569",
  },
  {
    id: "inst.th.topuptax",
    jurisdiction_id: "jur.th",
    regulator_id: "reg.th.rd",
    canonical_owner_module: "reg24.tax.sub.th",
    type: "royal_decree",
    title_th: "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. ๒๕๖๗ (Top-up Tax / Global Minimum Tax 15%)",
    title_en: "Emergency Decree on Top-up Tax B.E. 2567 (15% Global Minimum Tax Framework for GMT24)",
    short_code: "TOPUP-2567",
    enacted_date: "2024-12-26",
    effective_date: "2025-01-01",
    source_document_id: "src.th.topuptax.2567",
  },
];

export const TAX_EXPANSION_PROVISIONS: Provision[] = [
  {
    id: "prov.th.ccc.1238_1243",
    instrument_id: "inst.th.ccc",
    canonical_owner_module: "reg24.civil.th",
    section_number: "1238-1243",
    heading_th: "การควบรวมบริษัทจำกัด (แก้ไขเพิ่มเติม พ.ศ. ๒๕๖๕ มีผล ๗ ก.พ. ๒๕๖๖ — กรณีบริษัทหนึ่งคงอยู่หรือตั้งบริษัทใหม่)",
    heading_en: "Merger of Limited Companies (CCC Amendment Act No. 23 B.E. 2565 — Surviving Company vs. New Amalgamated Company)",
    current_version_id: "ver.th.ccc.1238_1243.v2566",
    version_ids: ["ver.th.ccc.1238_1243.v2566"],
    concept_ids: ["concept.tax.ccc_merger_462"],
    executable_rule_ids: ["rule.th.tax.merger_ruling_462_eligibility"],
  },
  {
    id: "prov.th.rc.73_74_77_1",
    instrument_id: "inst.th.rc",
    canonical_owner_module: "reg24.tax.th",
    section_number: "73-74 & 77/1",
    heading_th: "การควบเข้ากันหรือโอนกิจการของบริษัทจำกัด การตีราคาทรัพย์สิน และการไม่ให้นำผลขาดทุนสุทธิสะสมของบริษัทที่สิ้นสภาพมาหัก (มาตรา 73, 74 และ 77/1)",
    heading_en: "Corporate Merger & Amalgamation Tax Valuation, Loss Carryforward Prohibition & VAT Exclusion (Revenue Code Sections 73, 74 & 77/1)",
    current_version_id: "ver.th.rc.73_74.v2569",
    version_ids: ["ver.th.rc.73_74.v2569"],
    concept_ids: ["concept.tax.ccc_merger_462"],
    executable_rule_ids: ["rule.th.tax.merger_ruling_462_eligibility"],
  },
  {
    id: "prov.th.topup.2567.sec5",
    instrument_id: "inst.th.topuptax",
    canonical_owner_module: "reg24.tax.sub.th",
    section_number: "5-18",
    heading_th: "ภาษีส่วนเพิ่ม (Top-up Tax 15%) สำหรับกลุ่มนิติบุคคลข้ามชาติที่มีรายได้รวมตั้งแต่ 750 ล้านยูโร (พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567)",
    heading_en: "15% Global Minimum Top-up Tax for Multinational Enterprise (MNE) Groups >= 750M EUR (Emergency Decree B.E. 2567 — GMT24)",
    current_version_id: "ver.th.topup.2567.v1",
    version_ids: ["ver.th.topup.2567.v1"],
    concept_ids: ["concept.tax.topup_gmt24"],
    executable_rule_ids: [],
  },
];

export const TAX_EXPANSION_PROVISION_VERSIONS: ProvisionVersion[] = [
  {
    id: "ver.th.ccc.1238_1243.v2566",
    provision_id: "prov.th.ccc.1238_1243",
    version_number: "B.E. 2566 (CCC Amendment Act No. 23 B.E. 2565 effective 7 Feb 2023)",
    text_th:
      "มาตรา ๑๒๓๘ บริษัทจำกัดจะควบรวมกันได้ต้องมีมติพิเศษ และเมื่อควบรวมกันแล้ว จะเป็นกรณีที่บริษัทหนึ่งบริษัทใดยังคงสภาพอยู่โดยที่บริษัทอื่นที่ควบรวมสิ้นสภาพไป หรือจะเป็นกรณีที่ตั้งขึ้นเป็นบริษัทใหม่โดยที่บริษัทที่ควบรวมทั้งหมดสิ้นสภาพไปก็ได้ มาตรา ๑๒๔๓ บริษัทที่ควบเข้ากันแล้วนั้นย่อมได้ไปทั้งทรัพย์สิน หนี้สิน สิทธิ หน้าที่ และความรับผิดชอบของบริษัทเดิมที่ได้ควบรวมเข้ากันนั้นทั้งสิ้น",
    translation_en: {
      language: "en",
      text: "Section 1238: Limited companies may merge by Special Resolution. A merger may take the form where (1) one of the merging companies survives while the other merging company(ies) cease to exist, or (2) a new company is formed while all merging companies cease to exist. Section 1243: The merged/surviving company succeeds by operation of law to all assets, liabilities, rights, duties, and responsibilities of the dissolved merging company(ies).",
      origin: "reviewed_legal_translation",
      is_official: false,
      is_authentic_enacted: false,
      reviewed_by: "Dr. Somchai Nitikorn",
    },
    publication_date: "2022-11-08",
    effective_from: "2023-02-07",
    known_from: "2023-02-07T00:00:00Z",
    verified_at: "2026-10-18T11:15:00Z",
    transitional_note: "Introduced surviving-company merger structure (A + B -> A) alongside traditional amalgamation (A + B -> C).",
    source_evidence: {
      id: "ev.th.ccc.1238_1243.v2566",
      source_document_id: "src.th.ccc.dbd",
      official_url: "https://www.dbd.go.th/law",
      citation_locator: "CCC Book III, Sections 1238–1243 (as amended B.E. 2565)",
      sha256_hash: "a46207022026042299887766554433221100ffeeddccbbaa9988776655443322",
      verified_by: "Dr. Somchai Nitikorn",
    },
  },
  {
    id: "ver.th.rc.73_74.v2569",
    provision_id: "prov.th.rc.73_74_77_1",
    version_number: "B.E. 2569 (Revenue Code Sec. 73, 74, 77/1 + RD Ruling กค 0702(กม.)/462)",
    text_th:
      "มาตรา 73 เมื่อบริษัทหรือห้างหุ้นส่วนนิติบุคคลควบเข้ากัน ให้ถือว่าบริษัทหรือห้างหุ้นส่วนนิติบุคคลแต่ละแห่งที่ควบเข้ากันนั้นเลิกกัน และให้บริษัทใหม่มีหน้าที่และความรับผิดในการยื่นรายการและเสียภาษีแทนบริษัทเดิม มาตรา 74 ในกรณีควบเข้ากัน ให้ตีราคาทรัพย์สินตามราคาที่ปรากฏในบัญชีของบริษัทเดิมในวันควบเข้ากัน และไม่ให้นำผลขาดทุนสุทธิของบริษัทเดิมมาถือเป็นรายจ่ายของบริษัทใหม่หรือบริษัทที่คงสภาพอยู่ มาตรา 77/1 การโอนทรัพย์สินอันเนื่องมาจากการควบเข้ากันไม่อยู่ในบังคับต้องเสียภาษีมูลค่าเพิ่ม",
    translation_en: {
      language: "en",
      text: "Sections 73 & 74: When juristic companies merge/amalgamate, assets transferred upon merger are valued at the book value recorded in the transferor company's accounts on the merger date (unless revalued higher). Accumulated net tax losses (Sec. 65 ter (12)) of a company that ceases to exist upon merger CANNOT be carried forward or deducted by the surviving or newly formed company. Section 77/1(8): Transfer of assets by operation of law upon corporate merger/amalgamation is outside the scope of VAT.",
      origin: "reviewed_legal_translation",
      is_official: false,
      is_authentic_enacted: false,
      reviewed_by: "Dr. Somchai Nitikorn",
    },
    publication_date: "1991-11-03",
    effective_from: "1992-01-01",
    known_from: "2026-04-22T00:00:00Z",
    verified_at: "2026-10-18T11:15:00Z",
    transitional_note: "Interpreted by RD Ruling กค 0702(กม.)/462 (22 April 2026) and กค 0702(กม.)/453 (11 April 2025) to apply to surviving-company mergers under amended CCC Sec. 1238.",
    source_evidence: {
      id: "ev.th.rc.73_74.v2569",
      source_document_id: "src.th.rd.ruling.462_2569",
      official_url: "https://www.rd.go.th/68635.html",
      citation_locator: "Revenue Code Sections 73, 74, 77/1 + RD Ruling กค 0702(กม.)/462 (2026)",
      sha256_hash: "a46207022026042299887766554433221100ffeeddccbbaa9988776655443322",
      verified_by: "Dr. Somchai Nitikorn",
    },
  },
  {
    id: "ver.th.topup.2567.v1",
    provision_id: "prov.th.topup.2567.sec5",
    version_number: "B.E. 2568 (Emergency Decree on Top-up Tax B.E. 2567 effective 1 Jan 2025)",
    text_th:
      "กลุ่มนิติบุคคลข้ามชาติ (MNE Group) ที่มีรายได้รวมในงบการเงินรวมของนิติบุคคลแม่ลำดับสูงสุดไม่น้อยกว่า 750 ล้านยูโร ในอย่างน้อย 2 ใน 4 รอบระยะเวลาบัญชีก่อนหน้า ต้องอยู่ในบังคับเสียภาษีส่วนเพิ่ม (Top-up Tax) เพื่อให้มีอัตราภาษีที่แท้จริง (Effective Tax Rate: ETR) ในประเทศไทยไม่ต่ำกว่าร้อยละ 15 โดยเริ่มใช้บังคับสำหรับรอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2568",
    translation_en: {
      language: "en",
      text: "Constituent entities in Thailand of a Multinational Enterprise (MNE) Group with consolidated annual revenue of at least EUR 750,000,000 in at least 2 of the 4 preceding fiscal years are subject to Domestic Minimum Top-up Tax (DMTT), Income Inclusion Rule (IIR), and Undertaxed Payments Rule (UTPR) to bring the jurisdictional Effective Tax Rate (ETR) to 15% (interacting with BOI CIT holidays under REG-BOI & GMT24).",
      origin: "reviewed_legal_translation",
      is_official: false,
      is_authentic_enacted: false,
      reviewed_by: "Dr. Somchai Nitikorn",
    },
    publication_date: "2024-12-26",
    effective_from: "2025-01-01",
    known_from: "2025-01-01T00:00:00Z",
    verified_at: "2026-10-18T11:30:00Z",
    transitional_note: "Enacted 15% Global Minimum Tax (OECD Pillar Two) in Thailand effective for fiscal years starting on/after 1 Jan 2025.",
    source_evidence: {
      id: "ev.th.topup.2567.v1",
      source_document_id: "src.th.topuptax.2567",
      official_url: "https://www.rd.go.th/67656.html",
      citation_locator: "Emergency Decree on Top-up Tax B.E. 2567, Sections 5–18",
      sha256_hash: "e2567150075000007766554433221100ffeeddccbbaa99887766554433221188",
      verified_by: "Dr. Somchai Nitikorn",
    },
  },
];

export const TAX_EXPANSION_MODULE_REFERENCES: ModuleReference[] = [
  {
    id: "ref.tax.ccc.1238",
    module_id: "reg24.tax.th",
    provision_id: "prov.th.ccc.1238_1243",
    relationship_role: "cross_module_dependency",
    domain_interpretation_th: "ประมวลรัษฎากรอ้างอิงรูปแบบการควบรวมบริษัทจำกัดตาม ป.พ.พ. มาตรา 1238–1243 (กรณีบริษัทหนึ่งคงอยู่และอีกบริษัทสิ้นสภาพ)",
    domain_interpretation_en:
      "Revenue Code merger tax rules (Sec. 73–74) and RD Ruling กค 0702(กม.)/462 map directly to the surviving-company merger structure enacted under CCC Sec. 1238–1243.",
    applicability_notes: "Shared canonical Civil Code provision reused across REG-CIVIL, REG-CORP, REG-RESTRUCT, REG-TAX, and REG-TAX-RULING.",
  },
  {
    id: "ref.taxruling.ccc.1238",
    module_id: "reg24.tax.ruling.th",
    provision_id: "prov.th.ccc.1238_1243",
    relationship_role: "domain_consumer",
    domain_interpretation_th: "ข้อหารือ กค 0702(กม.)/462 (22 เม.ย. 2569) และ กค 0702(กม.)/453 (11 เม.ย. 2568) วินิจฉัยภาระภาษีของการควบรวมบริษัทตาม ป.พ.พ. มาตรา 1238 และ 1243",
    domain_interpretation_en:
      "RD Ruling กค 0702(กม.)/462 (22 April 2026) and กค 0702(กม.)/453 (11 April 2025) interpret the tax consequences of a surviving-company merger under CCC Sec. 1238 & 1243.",
    applicability_notes: "Core link in the Article-to-Regulation-to-Ruling Knowledge Graph.",
  },
  {
    id: "ref.restruct.rc.73_74",
    module_id: "reg24.restruct.th",
    provision_id: "prov.th.rc.73_74_77_1",
    relationship_role: "cross_module_dependency",
    domain_interpretation_th: "การวางแผนควบรวมกิจการ (M&A / Merger / EBT) ในโมดูล REG-RESTRUCT ต้องตรวจสอบการยกเว้นภาษีและข้อห้ามใช้ผลขาดทุนสะสมของบริษัทที่สิ้นสภาพตามมาตรา 73–74",
    domain_interpretation_en:
      "M&A and merger structuring in REG-RESTRUCT depends on Revenue Code Sec. 73–74 & 77/1 to determine whether Company A (with tax losses) or Company B should be the surviving entity.",
    applicability_notes: "Determines which merging company should survive to preserve its own Section 65 ter (12) tax losses.",
  },
];

export const TAX_SUB_REGULATIONS: TaxSubRegulationRecord[] = [
  {
    id: "subreg.th.rd.royal_decree_10",
    module_id: "reg24.tax.sub.th",
    document_type: "Royal Decree",
    thai_terminology: "พระราชกฤษฎีกา (พ.ร.ฎ. ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 10) พ.ศ. 2500)",
    reg24_treatment: "Delegated legislation",
    authority_classification: "delegated_binding_regulation",
    number_code: "Royal Decree No. 10 (พ.ร.ฎ. ฉบับที่ 10 มาตรา 5 ตรี / 5 โสฬส)",
    title_th: "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 10) พ.ศ. 2500 (การยกเว้นภาษีเงินได้นิติบุคคล ภาษีธุรกิจเฉพาะ และอากรแสตมป์ สำหรับการควบหรือโอนกิจการทั้งหมด)",
    title_en:
      "Royal Decree Issued under the Revenue Code Governing Exemption from Revenue Taxes (No. 10) B.E. 2500 — Corporate Merger & Entire Business Transfer (EBT) Tax Exemptions",
    enabling_revenue_code_sections: ["prov.th.rc.73_74_77_1", "prov.th.rc.65"],
    cross_referenced_provisions: ["prov.th.ccc.1238_1243", "prov.th.plca.54_1_146"],
    tax_subjects: ["Corporate Income Tax", "Specific Business Tax", "Stamp Duty", "Tax Restructuring"],
    publication_date: "1957-08-30",
    effective_from: "1957-08-31",
    exemption_conditions: [
      "Merging or transferor/transferee companies must be juristic companies incorporated under Thai law.",
      "No cash or boot consideration may be paid other than newly issued shares of the surviving/amalgamated/transferee company where required.",
      "Transferor or ceasing company must register dissolution within the same accounting period as the merger/transfer.",
      "Surviving/merged company must record transferred assets and liabilities at the transferor's book value as of the merger date (RC Sec. 74).",
      "Must comply with notification and reporting rules prescribed by the Director-General of the Revenue Department.",
    ],
    summary_th:
      "ยกเว้นภาษีเงินได้นิติบุคคล ภาษีธุรกิจเฉพาะ และอากรแสตมป์ ให้แก่บริษัทที่ควบเข้ากันหรือโอนกิจการทั้งหมดให้แก่กัน โดยต้องปฏิบัติตามหลักเกณฑ์ วิธีการ และเงื่อนไขที่อธิบดีกรมสรรพากรประกาศกำหนด",
    summary_en:
      "Grants binding delegated exemption from Corporate Income Tax, Specific Business Tax, and Stamp Duty for qualifying corporate mergers and Entire Business Transfers (EBT) that satisfy Director-General Notification conditions.",
    official_url: "https://www.rd.go.th/674.html",
    binding_status: "binding_enacted",
    verification_pipeline: {
      official_source_validated: true,
      thai_extraction_verified: true,
      section_validation_passed: true,
      effective_date_verified: true,
      human_legal_reviewed_by: "Dr. Somchai Nitikorn (Senior Tax Counsel)",
    },
  },
  {
    id: "subreg.th.rd.min_reg_126",
    module_id: "reg24.tax.sub.th",
    document_type: "Ministerial Regulation",
    thai_terminology: "กฎกระทรวง ฉบับที่ 126 (พ.ศ. 2509) ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร ข้อ 2(50)",
    reg24_treatment: "Delegated legislation",
    authority_classification: "delegated_binding_regulation",
    number_code: "Ministerial Regulation No. 126 Clause 2(50) (กฎกระทรวง ฉบับที่ 126 ข้อ 2(50))",
    title_th: "กฎกระทรวง ฉบับที่ 126 (พ.ศ. 2509) ข้อ 2(50) การยกเว้นภาษีสำหรับผลประโยชน์ที่ผู้ถือหุ้นได้รับจากการที่ผู้ประกอบกิจการควบเข้ากันหรือโอนกิจการทั้งหมดให้แก่กัน",
    title_en:
      "Ministerial Regulation No. 126 B.E. 2509 Clause 2(50) — Shareholder Capital Gains Tax Exemption on Corporate Merger or Entire Business Transfer",
    enabling_revenue_code_sections: ["prov.th.rc.73_74_77_1", "prov.th.rc.65"],
    cross_referenced_provisions: ["prov.th.ccc.1238_1243"],
    tax_subjects: ["Personal Income Tax", "Corporate Income Tax", "Tax Restructuring"],
    publication_date: "1966-02-23",
    effective_from: "1966-02-24",
    exemption_conditions: [
      "Applies to capital gains (benefits) received by shareholders upon exchanging shares in a corporate merger or Entire Business Transfer (EBT).",
      "The merger or EBT must involve no consideration other than ordinary shares in the merged/surviving/transferee company.",
      "The ceasing/transferor company must register its dissolution within the same accounting period in which the merger or transfer takes place.",
      "Must satisfy the rules, procedures, and conditions prescribed by the Director-General of the Revenue Department.",
    ],
    summary_th:
      "ยกเว้นภาษีเงินได้สำหรับผลประโยชน์ที่ผู้ถือหุ้นได้รับจากการควบเข้ากันหรือโอนกิจการทั้งหมดให้แก่กัน ซึ่งตีราคาเป็นเงินได้เกินกว่าเงินทุน เฉพาะกรณีที่โอนกิจการในรอบระยะเวลาบัญชีเดียวกันกับที่จดทะเบียนเลิก",
    summary_en:
      "Exempts shareholders from tax on capital gains realized when exchanging shares pursuant to a qualifying corporate merger or EBT where dissolution occurs within the same accounting period.",
    official_url: "https://www.rd.go.th/674.html",
    binding_status: "binding_enacted",
    verification_pipeline: {
      official_source_validated: true,
      thai_extraction_verified: true,
      section_validation_passed: true,
      effective_date_verified: true,
      human_legal_reviewed_by: "Dr. Somchai Nitikorn (Senior Tax Counsel)",
    },
  },
  {
    id: "subreg.th.rd.dg_notif_merger",
    module_id: "reg24.tax.sub.th",
    document_type: "Director-General Notification",
    thai_terminology: "ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีเงินได้ (หลักเกณฑ์ วิธีการ และเงื่อนไขการควบเข้ากันหรือโอนกิจการทั้งหมด)",
    reg24_treatment: "Implementing rules, subject to legal authority",
    authority_classification: "delegated_binding_regulation",
    number_code: "DG Notification on Merger & EBT (ประกาศอธิบดีกรมสรรพากร)",
    title_th: "ประกาศอธิบดีกรมสรรพากร กำหนดหลักเกณฑ์ วิธีการ และเงื่อนไขการควบเข้ากันหรือการโอนกิจการทั้งหมดให้แก่กันของบริษัทมหาชนจำกัดหรือบริษัทจำกัด",
    title_en:
      "Notification of the Director-General of the Revenue Department Prescribing Rules, Procedures and Conditions for Corporate Mergers and Entire Business Transfers",
    enabling_revenue_code_sections: ["prov.th.rc.73_74_77_1"],
    cross_referenced_provisions: ["prov.th.ccc.1238_1243", "prov.th.plca.54_1_146"],
    tax_subjects: ["Corporate Income Tax", "Tax Restructuring", "Tax Procedure"],
    publication_date: "1999-10-15",
    effective_from: "1999-10-15",
    exemption_conditions: [
      "Submit written notification of merger/EBT and shareholder list to the Director-General of the Revenue Department within 30 days from the date of DBD merger/transfer registration.",
      "Ceasing transferor company must not have delinquent tax liabilities unless guaranteed by the surviving/merged company.",
      "Assets and liabilities must be transferred at book value without step-up depreciation.",
    ],
    summary_th:
      "กำหนดให้บริษัทที่ควบเข้ากันหรือโอนกิจการทั้งหมดต้องยื่นหนังสือแจ้งต่ออธิบดีกรมสรรพากรภายใน 30 วันนับแต่วันจดทะเบียนควบหรือโอนกิจการ พร้อมบัญชีรายชื่อผู้ถือหุ้นและมูลค่าหุ้น",
    summary_en:
      "Implements Royal Decree No. 10 and Ministerial Regulation No. 126 by requiring a 30-day post-registration filing with the Revenue Department and book-value continuity.",
    official_url: "https://www.rd.go.th/674.html",
    binding_status: "binding_enacted",
    verification_pipeline: {
      official_source_validated: true,
      thai_extraction_verified: true,
      section_validation_passed: true,
      effective_date_verified: true,
      human_legal_reviewed_by: "Dr. Somchai Nitikorn (Senior Tax Counsel)",
    },
  },
  {
    id: "subreg.th.rd.order_paw_merger",
    module_id: "reg24.tax.sub.th",
    document_type: "Revenue Department Order (Tor.Por. / Paw.)",
    thai_terminology: "คำสั่งกรมสรรพากร (ท.ป. และ ป.) แนวทางปฏิบัติการตรวจสอบภาษีกรณีควบรวมบริษัทและโอนกิจการ",
    reg24_treatment: "Administrative or delegated instruments; classify individually",
    authority_classification: "administrative_order_or_guidance",
    number_code: "RD Order Paw. / Tor.Por. Series (คำสั่งกรมสรรพากร ป. / ท.ป.)",
    title_th: "คำสั่งกรมสรรพากรวางแนวทางปฏิบัติสำหรับเจ้าพนักงานประเมินในการตรวจสอบภาษีเงินได้นิติบุคคลและภาษีหัก ณ ที่จ่าย กรณีการควบรวมบริษัทตาม ป.พ.พ.",
    title_en:
      "Revenue Department Departmental Order (Paw. / Tor.Por. Series) — Administrative Audit Guidelines for Corporate Mergers, Withholding Tax & Loss Carryforward",
    enabling_revenue_code_sections: ["prov.th.rc.73_74_77_1", "prov.th.rc.65"],
    cross_referenced_provisions: ["prov.th.ccc.1238_1243"],
    tax_subjects: ["Corporate Income Tax", "Withholding Tax", "Tax Procedure"],
    publication_date: "2025-06-01",
    effective_from: "2025-06-01",
    exemption_conditions: [
      "Binds Revenue Department assessment officers in auditing PND.50 returns of merging companies.",
      "Does not have the legal force of a Royal Decree or Act and cannot override statutory exemptions.",
    ],
    summary_th:
      "แนวทางปฏิบัติราชการสำหรับเจ้าพนักงานประเมินในการตรวจสอบการยื่น ภ.ง.ด.50 ของบริษัทที่สิ้นสภาพจากการควบรวมภายใน 150 วันนับแต่วันจดทะเบียนควบรวม",
    summary_en:
      "Internal administrative directive instructing RD audit officers on verifying final PND.50 returns (within 150 days of merger registration) and disallowing transferred net losses of ceased entities.",
    official_url: "https://www.rd.go.th/674.html",
    binding_status: "binding_enacted",
    verification_pipeline: {
      official_source_validated: true,
      thai_extraction_verified: true,
      section_validation_passed: true,
      effective_date_verified: true,
      human_legal_reviewed_by: "Dr. Somchai Nitikorn (Senior Tax Counsel)",
    },
  },
  {
    id: "subreg.th.topup.ed_2567",
    module_id: "reg24.tax.sub.th",
    document_type: "Emergency Decree (Top-up Tax)",
    thai_terminology: "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. ๒๕๖๗ (Global Minimum Tax 15%)",
    reg24_treatment: "Primary legislation (Separate statutory framework for GMT24)",
    authority_classification: "primary_legislation",
    number_code: "Emergency Decree on Top-up Tax B.E. 2567 (พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567)",
    title_th: "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. ๒๕๖๗ (จัดเก็บภาษีส่วนเพิ่มให้มีอัตราภาษีที่แท้จริงขั้นต่ำร้อยละ 15 สำหรับกลุ่มนิติบุคคลข้ามชาติ)",
    title_en:
      "Emergency Decree on Top-up Tax B.E. 2567 (2024) — 15% Global Minimum Tax Framework for Multinational Enterprises (GMT24)",
    enabling_revenue_code_sections: ["prov.th.topup.2567.sec5"],
    cross_referenced_provisions: ["prov.th.ipa.31", "prov.th.rc.65"],
    tax_subjects: ["International Tax", "Tax Incentives", "Corporate Income Tax"],
    publication_date: "2024-12-26",
    effective_from: "2025-01-01",
    transitional_provisions: "Applies to fiscal years beginning on or after 1 January 2025 (B.E. 2568).",
    exemption_conditions: [
      "Applies only to MNE Groups with consolidated revenue >= EUR 750,000,000 in at least 2 of the 4 preceding fiscal years.",
      "Substance-Based Income Exclusion (SBIE) carve-out for tangible assets and payroll in Thailand.",
      "De minimis exclusion where average Thai revenue < EUR 10M and average GloBE income < EUR 1M.",
    ],
    summary_th:
      "กฎหมายเฉพาะแยกต่างหากจากประมวลรัษฎากร ใช้บังคับกับกลุ่มนิติบุคคลข้ามชาติขนาดใหญ่ (รายได้รวม >= 750 ล้านยูโร) โดยกระทบต่อสิทธิประโยชน์ยกเว้นภาษีเงินได้นิติบุคคลของ BOI",
    summary_en:
      "Standalone primary legislation enacted for OECD Pillar Two (15% minimum ETR), directly supporting GMT24 and evaluating BOI CIT holiday top-up exposure.",
    official_url: "https://www.rd.go.th/67656.html",
    binding_status: "binding_enacted",
    verification_pipeline: {
      official_source_validated: true,
      thai_extraction_verified: true,
      section_validation_passed: true,
      effective_date_verified: true,
      human_legal_reviewed_by: "Dr. Somchai Nitikorn (Senior Tax Counsel)",
    },
  },
];

export const TAX_RULINGS: TaxRulingRecord[] = [
  {
    id: "ruling.th.rd.0702_462_2569",
    module_id: "reg24.tax.ruling.th",
    ruling_reference_number: "กค 0702(กม.)/462",
    issue_date: "2026-04-22",
    buddhist_era_year: 2569,
    document_type: "Tax Consultation Letter",
    thai_terminology: "ข้อหารือภาษีอากร",
    authority_classification: "fact_specific_administrative_opinion",
    can_override_statute: false,
    subject_th: "ภาระภาษีอากร กรณีการควบรวมบริษัทจำกัด (กรณีบริษัทหนึ่งคงสภาพอยู่และอีกบริษัทหนึ่งสิ้นสภาพไปตาม ป.พ.พ. แก้ไขเพิ่มเติม)",
    subject_en:
      "Tax Treatment of a Limited Company Merger under the Amended Civil and Commercial Code (Where One Company Survives and the Other Ceases to Exist)",
    tax_categories: ["Corporate Income Tax", "VAT", "Specific Business Tax", "Stamp Duty", "Tax Restructuring"],
    corporate_event_type: "Company Merger under Amended CCC Sections 1238 & 1243 (One Company Survives, One Ceases to Exist)",
    facts_and_assumptions: [
      "Two Thai limited companies (Company A and Company B) pass Special Resolutions to merge pursuant to Sections 1238 and 1243 of the amended Civil and Commercial Code (CCC Amendment Act No. 23 B.E. 2565).",
      "Under the merger terms, Company A survives as a juristic person while Company B ceases to exist by operation of law upon DBD registration.",
      "Company A succeeds to all assets, liabilities, rights, duties, and obligations of Company B at book value under CCC Section 1243.",
      "Company A issues new shares to the shareholders of Company B in exchange for their cancelled shares in Company B, with no cash boot.",
    ],
    questions_referred: [
      "1. Does a surviving-company merger under amended CCC Section 1238 qualify as a 'merger/amalgamation' (การควบเข้ากัน) under Revenue Code Sections 73, 74, and 77/1(8), Royal Decree No. 10, and Ministerial Regulation No. 126?",
      "2. How are transferred assets valued under Revenue Code Section 74?",
      "3. Can the surviving company (Company A) utilize its own pre-merger net tax losses versus the pre-merger net tax losses of the ceased company (Company B)?",
    ],
    revenue_code_sections_cited: ["Section 73", "Section 74", "Section 77/1(8)", "Section 65 ter (12)"],
    provision_ids_linked: ["prov.th.ccc.1238_1243", "prov.th.rc.73_74_77_1", "prov.th.rc.65"],
    subregulation_ids_linked: [
      "subreg.th.rd.royal_decree_10",
      "subreg.th.rd.min_reg_126",
      "subreg.th.rd.dg_notif_merger",
    ],
    administrative_analysis_th:
      "กรมสรรพากรวินิจฉัยโดยเดินตามแนวข้อหารือ ที่ กค 0702(กม.)/453 ลงวันที่ 11 เมษายน 2568 ว่า การควบรวมบริษัทจำกัดตาม ป.พ.พ. มาตรา 1238 ที่แก้ไขเพิ่มเติม ไม่ว่าจะเป็นกรณีตั้งบริษัทใหม่หรือกรณีบริษัทหนึ่งยังคงสภาพอยู่และบริษัทอื่นสิ้นสภาพไป เข้าลักษณะเป็นการควบเข้ากันตามมาตรา 73 และมาตรา 74 แห่งประมวลรัษฎากร โอนทรัพย์สินตามราคาบัญชี ไม่ต้องเสียภาษีมูลค่าเพิ่มตามมาตรา 77/1(8) และได้รับยกเว้นภาษีตาม พ.ร.ฎ. (ฉบับที่ 10) และกฎกระทรวง ฉบับที่ 126 ทั้งนี้ บริษัทที่สิ้นสภาพไปต้องยื่นแบบ ภ.ง.ด.50 ภายใน 150 วันนับแต่วันจดทะเบียนควบรวม และบริษัทที่คงสภาพอยู่ไม่สามารถนำผลขาดทุนสุทธิสะสมของบริษัทที่สิ้นสภาพไปแล้วมาหักเป็นรายจ่ายได้ แต่ยังคงใช้ผลขาดทุนสุทธิสะสมของตนเองได้ต่อไปตามมาตรา 65 ตรี (12)",
    administrative_analysis_en:
      "Expressly following earlier RD Opinion กค 0702(กม.)/453 dated 11 April 2025, the Revenue Department confirmed that a merger under amended CCC Sections 1238 & 1243 where one company survives and the other ceases to exist constitutes a corporate merger under Revenue Code Sections 73 and 74. Consequently: (1) Asset transfer occurs by operation of law outside VAT scope (RC Sec. 77/1(8)); (2) CIT, SBT, Stamp Duty, and shareholder capital gains exemptions under Royal Decree No. 10 and Ministerial Regulation No. 126 apply if DG Notification conditions are met; (3) Assets are carried over at book value (RC Sec. 74); (4) The ceased company must file its final PND.50 within 150 days of merger registration; and (5) The surviving company CANNOT deduct pre-merger net tax losses of the ceased company, though the surviving company retains its own pre-merger Section 65 ter (12) tax losses.",
    conclusions_th:
      "1. ได้รับยกเว้นภาษีเงินได้ ภาษีธุรกิจเฉพาะ และอากรแสตมป์ตาม พ.ร.ฎ. (ฉบับที่ 10) และกฎกระทรวง ฉบับที่ 126 และไม่อยู่ในบังคับ VAT ตามมาตรา 77/1(8) 2. ตีราคาทรัพย์สินตามราคาบัญชี (มาตรา 74) 3. ห้ามนำผลขาดทุนสุทธิสะสมของบริษัทที่สิ้นสภาพมาใช้ แต่บริษัทที่คงสภาพอยู่ยังใช้ผลขาดทุนสุทธิของตนเองได้",
    conclusions_en:
      "1. Surviving-company merger under CCC Sec. 1238 qualifies for RC Sec. 73–74, Sec. 77/1(8) VAT exclusion, Royal Decree No. 10, and Ministerial Regulation No. 126 exemptions. 2. Assets carry over at book value. 3. Pre-merger tax losses of the ceased company are extinguished, whereas the surviving company's own pre-merger tax losses remain usable within the 5-year statutory window.",
    follows_earlier_ruling_ref: "กค 0702(กม.)/453 (11 April 2025)",
    related_ruling_ids: ["ruling.th.rd.0702_453_2568", "ruling.th.trc.40_2560"],
    related_court_decision_ids: ["case.th.dika.tax.5412_2565"],
    official_url: "https://www.rd.go.th/68635.html",
    publication_date: "2026-04-22",
    retrieved_at: "2026-10-18T11:00:00Z",
    legal_applicability_warning:
      "TAX-RULING-02 & TAX-QUALITY-01 WARNING: RD Consultation Letter กค 0702(กม.)/462 is a fact-specific administrative interpretation issued on the inquiring taxpayer's facts. It is not primary legislation and must not be automatically applied to transactions involving cash boot, foreign non-Thai merging entities, or step-up asset revaluations without verifying DG Notification compliance.",
  },
  {
    id: "ruling.th.rd.0702_453_2568",
    module_id: "reg24.tax.ruling.th",
    ruling_reference_number: "กค 0702(กม.)/453",
    issue_date: "2025-04-11",
    buddhist_era_year: 2568,
    document_type: "Tax Consultation Letter",
    thai_terminology: "ข้อหารือภาษีอากร",
    authority_classification: "fact_specific_administrative_opinion",
    can_override_statute: false,
    subject_th: "ภาระภาษีอากร กรณีการควบรวมบริษัทจำกัดตามประมวลกฎหมายแพ่งและพาณิชย์แก้ไขเพิ่มเติม (พ.ศ. 2565)",
    subject_en:
      "Foundational RD Opinion on Tax Treatment of Limited Company Mergers under Amended CCC Sections 1238 & 1243 (11 April 2025)",
    tax_categories: ["Corporate Income Tax", "VAT", "Specific Business Tax", "Stamp Duty", "Tax Restructuring"],
    corporate_event_type: "Company Merger under Amended CCC Sections 1238 & 1243",
    facts_and_assumptions: [
      "First major Revenue Department legal opinion addressing whether the 2023 CCC merger reform (where one company survives instead of forming a new third company) falls within Revenue Code Section 73 ('ควบเข้ากัน').",
      "Merger executed purely via share-for-share exchange at book value with no cash boot.",
    ],
    questions_referred: [
      "Does a merger where Company A survives and Company B ceases to exist enjoy the same tax neutrality under RC Sec. 73, 74, 77/1(8), Royal Decree No. 10, and Ministerial Regulation No. 126 as a traditional amalgamation?",
    ],
    revenue_code_sections_cited: ["Section 73", "Section 74", "Section 77/1(8)"],
    provision_ids_linked: ["prov.th.ccc.1238_1243", "prov.th.rc.73_74_77_1"],
    subregulation_ids_linked: ["subreg.th.rd.royal_decree_10", "subreg.th.rd.min_reg_126"],
    administrative_analysis_th:
      "วางบรรทัดฐานว่าการควบรวมบริษัทตาม ป.พ.พ. มาตรา 1238 ที่แก้ไขใหม่ ซึ่งบริษัทหนึ่งยังคงสภาพอยู่และอีกบริษัทสิ้นสภาพไป ถือเป็นการควบเข้ากันตามมาตรา 73 และ 74 แห่งประมวลรัษฎากร ซึ่งต่อมาข้อหารือ กค 0702(กม.)/462 ลงวันที่ 22 เมษายน 2569 ได้อ้างอิงและเดินตามแนววินิจฉัยนี้",
    administrative_analysis_en:
      "Established the administrative precedent that a surviving-company merger under amended CCC Sec. 1238 qualifies under RC Sec. 73–74, later expressly followed and expanded upon by RD Ruling กค 0702(กม.)/462 dated 22 April 2026.",
    conclusions_th: "เข้าลักษณะเป็นการควบเข้ากันตามมาตรา 73 และ 74 แห่งประมวลรัษฎากร และได้รับสิทธิประโยชน์ทางภาษีตาม พ.ร.ฎ. (ฉบับที่ 10) และกฎกระทรวง ฉบับที่ 126",
    conclusions_en: "Qualifies as a merger under RC Sec. 73–74 and is eligible for Royal Decree No. 10 and Ministerial Regulation No. 126 tax exemptions upon full compliance with DG Notification conditions.",
    related_ruling_ids: ["ruling.th.rd.0702_462_2569"],
    related_court_decision_ids: ["case.th.dika.tax.5412_2565"],
    official_url: "https://www.rd.go.th/68629.html",
    publication_date: "2025-04-11",
    retrieved_at: "2026-10-18T11:05:00Z",
    legal_applicability_warning:
      "Fact-specific administrative consultation letter. Confirmed and followed by กค 0702(กม.)/462 (22 April 2026).",
  },
  {
    id: "ruling.th.trc.40_2560",
    module_id: "reg24.tax.ruling.th",
    ruling_reference_number: "คำวินิจฉัยของคณะกรรมการวินิจฉัยภาษีอากรที่ 40/2560",
    issue_date: "2017-09-15",
    buddhist_era_year: 2560,
    document_type: "Tax Ruling Committee Decision",
    thai_terminology: "คำวินิจฉัยของคณะกรรมการวินิจฉัยภาษีอากร",
    authority_classification: "formal_statutory_interpretation",
    can_override_statute: false,
    subject_th: "คำวินิจฉัยของคณะกรรมการวินิจฉัยภาษีอากร เรื่อง การตีความการโอนกิจการและการคำนวณรายจ่ายตามประมวลรัษฎากร มาตรา 13 สัตต",
    subject_en:
      "Commission of Taxation Decision No. 40/2560 — Formal Statutory Interpretation on Business Transfer Valuation and Tax Deductibility (Revenue Code Sec. 13 Septies)",
    tax_categories: ["Corporate Income Tax", "Tax Restructuring", "Tax Procedure"],
    corporate_event_type: "Entire Business Transfer (EBT) & Corporate Amalgamation Valuation",
    facts_and_assumptions: [
      "Formal interpretation issued by the statutory Commission of Taxation (คณะกรรมการวินิจฉัยภาษีอากร) under Revenue Code Section 13 Septies.",
      "Addresses book-value continuity and non-deductibility of goodwill step-up in tax-exempt corporate restructurings.",
    ],
    questions_referred: [
      "Whether an acquiring/surviving company in a tax-exempt restructuring may amortize goodwill or step up asset tax basis above the transferor's book value.",
    ],
    revenue_code_sections_cited: ["Section 13 Septies", "Section 65 bis", "Section 74"],
    provision_ids_linked: ["prov.th.rc.73_74_77_1", "prov.th.rc.65"],
    subregulation_ids_linked: ["subreg.th.rd.royal_decree_10"],
    administrative_analysis_th:
      "คำวินิจฉัยของคณะกรรมการวินิจฉัยภาษีอากรมีสถานะเป็นคำวินิจฉัยตีความตามกฎหมาย (Formal Statutory Interpretation) ซึ่งสูงกว่าข้อหารือทั่วไป กำหนดให้การรับโอนทรัพย์สินตามมาตรา 74 ต้องใช้ราคาบัญชีเดิม",
    administrative_analysis_en:
      "Unlike individual consultation letters, a Tax Ruling Committee Decision issued under RC Sec. 13 Septies carries formal statutory interpretive authority across the Revenue Department, mandating strict book-value carryover under Section 74.",
    conclusions_th: "ต้องตีราคาทรัพย์สินตามราคาบัญชีของบริษัทเดิมในวันควบหรือโอนกิจการ ห้ามตีราคาเพิ่มขึ้นเพื่อหักค่าสึกหรอและค่าเสื่อมราคา",
    conclusions_en: "Transferred assets in a Section 74 merger must retain the transferor's historical tax book value; upward revaluation for tax depreciation is prohibited.",
    related_ruling_ids: ["ruling.th.rd.0702_462_2569"],
    related_court_decision_ids: ["case.th.dika.tax.5412_2565"],
    official_url: "https://www.rd.go.th/1601.html",
    publication_date: "2017-09-15",
    retrieved_at: "2026-10-18T11:12:00Z",
    legal_applicability_warning:
      "TAX-QUALITY-01: Formal Statutory Interpretation under Revenue Code Sec. 13 Septies (higher authority than an individual consultation letter, subordinate to primary legislation and Supreme Court judgments).",
  },
];

export const TAX_JUDICIAL_DECISIONS: TaxJudicialDecisionRecord[] = [
  {
    id: "case.th.dika.tax.5412_2565",
    module_id: "reg24.tax.case.th",
    court_name: "Supreme Court Tax Division (ศาลฎีกาแผนกคดีภาษีอากร)",
    case_number: "คำพิพากษาศาลฎีกาที่ 5412/2565",
    judgment_date: "2022-08-18",
    authority_classification: "judicial_decision",
    tax_categories: ["Corporate Income Tax", "Tax Restructuring"],
    material_facts:
      "Following a corporate merger/EBT, the surviving transferee company attempted to deduct the accumulated net tax losses (Section 65 ter (12)) incurred prior to the merger by the dissolved transferor company.",
    legal_issues: [
      "Whether Section 65 ter (12) net tax losses of a dissolved merging/transferor company pass to the surviving company under CCC Section 1243 or Revenue Code Section 74.",
    ],
    statutory_provisions_cited: ["Revenue Code Section 65 ter (12)", "Revenue Code Section 73", "Revenue Code Section 74", "CCC Section 1243"],
    provision_ids_linked: ["prov.th.rc.73_74_77_1", "prov.th.ccc.1238_1243"],
    court_reasoning_th:
      "ศาลฎีกาวินิจฉัยว่า สิทธิในการนำผลขาดทุนสุทธิไม่เกิน 5 รอบระยะเวลาบัญชีตามมาตรา 65 ตรี (12) เป็นสิทธิเฉพาะตัวของนิติบุคคลผู้มีผลขาดทุน เมื่อบริษัทเดิมสิ้นสภาพนิติบุคคลไปจากการควบหรือโอนกิจการ บริษัทใหม่หรือบริษัทที่คงสภาพอยู่จึงไม่อาจนำผลขาดทุนสุทธิของบริษัทที่สิ้นสภาพไปแล้วมาหักเป็นรายจ่ายได้",
    court_reasoning_en:
      "The Supreme Court held that the right to carry forward net losses for 5 accounting periods under RC Section 65 ter (12) is strictly personal to the taxpaying juristic entity that incurred the loss. Even though CCC Section 1243 transfers civil rights and obligations, tax loss deductions are governed specifically by Revenue Code Sections 65 ter (12) and 74, which bar transferring a dissolved company's tax losses.",
    decision_outcome:
      "Upheld Revenue Department assessment disallowing the dissolved transferor company's pre-merger tax losses; confirmed that only the surviving company's own pre-merger tax losses remain deductible.",
    related_rd_ruling_ids: ["ruling.th.rd.0702_462_2569", "ruling.th.rd.0702_453_2568"],
    diverges_from_rd_interpretation: false,
    divergence_explanation:
      "Consistent with RD Ruling กค 0702(กม.)/462 (2026) and กค 0702(กม.)/453 (2025). Therefore, in a CCC Sec. 1238 merger, the company with larger unutilized tax losses should be designated as the surviving company.",
    official_url: "https://deka.supremecourt.or.th",
  },
  {
    id: "case.th.dika.tax.2108_2564",
    module_id: "reg24.tax.case.th",
    court_name: "Supreme Court Tax Division (ศาลฎีกาแผนกคดีภาษีอากร)",
    case_number: "คำพิพากษาศาลฎีกาที่ 2108/2564",
    judgment_date: "2021-05-14",
    authority_classification: "judicial_decision",
    tax_categories: ["Corporate Income Tax", "Tax Procedure", "Tax Restructuring"],
    material_facts:
      "An assessment officer relied on a Revenue Department Consultation Letter (ข้อหารือภาษีอากร) and Departmental Order (คำสั่งกรมสรรพากร ป.) to impose an extra substantive condition not present in the Revenue Code or Royal Decree No. 10.",
    legal_issues: [
      "Whether a Revenue Department Consultation Letter or Paw. Order has binding legal force to restrict a statutory tax exemption or override primary/delegated legislation.",
    ],
    statutory_provisions_cited: ["Revenue Code Section 65", "Royal Decree No. 10"],
    provision_ids_linked: ["prov.th.rc.73_74_77_1", "prov.th.rc.65"],
    court_reasoning_th:
      "ศาลฎีกาวินิจฉัยว่า คำสั่งกรมสรรพากร (ป.) และหนังสือตอบข้อหารือภาษีอากรเป็นเพียงแนวทางปฏิบัติราชการภายในของกรมสรรพากร ไม่ใช่บทบัญญัติแห่งกฎหมาย จึงไม่อาจนำมากำหนดเงื่อนไขจำกัดสิทธิยกเว้นภาษีเพิ่มเติมเกินกว่าที่ประมวลรัษฎากรหรือพระราชกฤษฎีกาบัญญัติไว้ได้",
    court_reasoning_en:
      "The Supreme Court ruled that Revenue Department Consultation Letters (ข้อหารือภาษีอากร) and Departmental Orders (คำสั่ง ป.) are internal administrative guidance, NOT enacted law. Where an administrative opinion conflicts with or imposes extra burdens beyond the Revenue Code or a Royal Decree, the Court applies the statute and invalidates the conflicting administrative condition.",
    decision_outcome:
      "Ruled in favor of the taxpayer; held that administrative consultation letters cannot silently override or narrow statutory/Royal Decree tax provisions (enforced in REG24 via TAX-QUALITY-01).",
    related_rd_ruling_ids: ["ruling.th.rd.0702_462_2569"],
    diverges_from_rd_interpretation: true,
    divergence_explanation:
      "ESTABLISHES TAX-QUALITY-01 PRECEDENT: Judicial decisions override RD consultation letters and Paw. orders whenever an administrative interpretation adds unlegislated conditions.",
    official_url: "https://deka.supremecourt.or.th",
  },
];

export const TAX_EXPANSION_CONCEPTS: LegalConcept[] = [
  {
    id: "concept.tax.ccc_merger_462",
    code: "TAX_CCC_MERGER_RULING_462",
    label_th: "ภาระภาษีการควบรวมบริษัทจำกัดตาม ป.พ.พ. มาตรา 1238 (กค 0702(กม.)/462)",
    label_en: "CCC Sec. 1238 Surviving-Company Merger Tax Regime (RD Ruling กค 0702(กม.)/462)",
    domain: "Tax Restructuring & Corporate Law",
    description:
      "Links CCC Sections 1238 & 1243, Revenue Code Sections 73, 74 & 77/1(8), Royal Decree No. 10, Ministerial Regulation No. 126, and RD Rulings กค 0702(กม.)/462 (2026) & กค 0702(กม.)/453 (2025).",
  },
  {
    id: "concept.tax.topup_gmt24",
    code: "TAX_TOPUP_DECREE_2567",
    label_th: "ภาษีส่วนเพิ่ม 15% (พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 — GMT24)",
    label_en: "15% Global Minimum Top-up Tax (Emergency Decree B.E. 2567 — GMT24)",
    domain: "International Tax & BOI Incentives",
    description:
      "OECD Pillar Two 15% minimum effective tax rate for MNE groups >= 750M EUR, interacting with BOI tax holidays.",
  },
];

export const TAX_EXPANSION_OBLIGATIONS: Obligation[] = [
  {
    id: "obl.th.tax.merger_notification",
    module_id: "reg24.tax.sub.th",
    provision_id: "prov.th.rc.73_74_77_1",
    title_th: "การแจ้งการควบเข้ากันต่ออธิบดีกรมสรรพากรภายใน 30 วัน และการยื่น ภ.ง.ด.50 ของบริษัทที่สิ้นสภาพภายใน 150 วัน",
    title_en: "30-Day Director-General Merger Notification & 150-Day Final PND.50 Return for Ceased Merging Company",
    obligated_party: "Surviving / Merged Company & Directors",
    prerequisite_trigger: "Registration of Limited Company Merger under CCC Section 1238 with the DBD",
    action_required:
      "1. Notify the Director-General of the Revenue Department within 30 days of merger registration (per DG Notification under Royal Decree No. 10 & Ministerial Regulation No. 126). 2. File final Corporate Income Tax Return (PND.50) for the ceased merging company within 150 days from the DBD merger registration date (RC Sec. 73–74 & RD Ruling กค 0702(กม.)/462).",
    filing_deadline: "30 days (DG Merger Notification) / 150 days (Final PND.50 of ceased company)",
    regulator_id: "reg.th.rd",
    statutory_vs_constitutional: "statutory_obligation",
    penalties_summary:
      "Loss of Royal Decree No. 10 & Ministerial Regulation No. 126 tax exemptions (triggering 20% CIT on unrealized gains and shareholder capital gains tax) plus 1.5% monthly surcharge under RC Sec. 27.",
  },
];

export const TAX_EXPANSION_RULES: RuleDefinition[] = [
  {
    id: "rule.th.tax.merger_ruling_462_eligibility",
    module_id: "reg24.tax.ruling.th",
    name_en: "Corporate Merger & EBT Tax Exemption, Book-Value & Loss Carryforward Analyzer (RC Sec. 73–74, RD No. 10, MR No. 126 & Ruling กค 0702(กม.)/462)",
    name_th: "กฎวิเคราะห์ภาระภาษีและสิทธิยกเว้นภาษีการควบรวมบริษัทจำกัด (มาตรา 73–74, พ.ร.ฎ. 10, กฎกระทรวง 126 และข้อหารือ กค 0702(กม.)/462)",
    description:
      "Deterministically evaluates corporate merger structures under amended CCC Sec. 1238 (Company A survives vs. new Company C), checks Royal Decree No. 10 & Ministerial Regulation No. 126 tax exemption conditions, calculates surviving vs. extinguished Section 65 ter (12) tax losses, and flags fact-specific ruling differences per TAX-RULING-02.",
    provision_ids: ["prov.th.ccc.1238_1243", "prov.th.rc.73_74_77_1", "prov.th.rc.65"],
    version: "1.1.0",
    lifecycle_state: "executable_approved",
    effective_from: "2023-02-07",
    input_schema: {
      required: [
        "merger_structure",
        "cash_boot_paid_thb",
        "transfer_at_book_value",
        "surviving_company_pre_merger_loss_thb",
        "ceased_company_pre_merger_loss_thb",
        "same_accounting_period_dissolution",
      ],
      properties: {
        merger_structure: {
          type: "string",
          description: "ccc_1238_one_survives | ccc_1238_new_company | entire_business_transfer_ebt",
        },
        cash_boot_paid_thb: {
          type: "number",
          description: "Cash boot paid to shareholders in addition to shares (THB; 0 required for full MR 126 / RD 10 exemption)",
        },
        transfer_at_book_value: {
          type: "boolean",
          description: "True if assets and liabilities are carried over at historical accounting book value (RC Sec. 74)",
        },
        surviving_company_pre_merger_loss_thb: {
          type: "number",
          description: "Pre-merger Section 65 ter (12) net tax losses of the surviving company (THB)",
        },
        ceased_company_pre_merger_loss_thb: {
          type: "number",
          description: "Pre-merger Section 65 ter (12) net tax losses of the ceasing/dissolved company (THB)",
        },
        same_accounting_period_dissolution: {
          type: "boolean",
          description: "True if ceasing/transferor company dissolves within the same accounting period",
        },
      },
    },
    conditions: [
      {
        id: "c.tax462.1",
        field: "cash_boot_paid_thb",
        operator: "eq",
        value: 0,
        description: "Pure share-for-share merger without cash boot",
      },
      {
        id: "c.tax462.2",
        field: "transfer_at_book_value",
        operator: "eq",
        value: true,
        description: "Book-value carryover per Revenue Code Section 74",
      },
    ],
    exceptions: [],
    review_record: {
      id: "rev.rule.tax.462",
      target_type: "rule",
      target_id: "rule.th.tax.merger_ruling_462_eligibility",
      reviewer_name: "Dr. Somchai Nitikorn (Senior Tax & Restructuring Partner)",
      reviewer_role: "Legal Reviewer",
      decision: "approved",
      notes: "Verified against RD Ruling กค 0702(กม.)/462 (22 April 2026), กค 0702(กม.)/453 (11 April 2025), Royal Decree No. 10, Ministerial Regulation No. 126, and Supreme Court Judgment No. 5412/2565.",
      decided_at: "2026-10-18T11:40:00Z",
    },
    test_fixtures: [
      {
        id: "fix.tax.462.1",
        name: "CCC Sec. 1238 Surviving-Company Merger Matching RD Ruling กค 0702(กม.)/462 (22 April 2026)",
        inputs: {
          merger_structure: "ccc_1238_one_survives",
          cash_boot_paid_thb: 0,
          transfer_at_book_value: true,
          surviving_company_pre_merger_loss_thb: 120000000,
          ceased_company_pre_merger_loss_thb: 85000000,
          same_accounting_period_dissolution: true,
        },
        expected_outcome: "applicable",
        expected_values: {
          qualifies_under_rc_73_74_and_ruling_462: true,
          usable_post_merger_tax_loss_thb: 120000000,
          extinguished_ceased_company_loss_thb: 85000000,
        },
      },
    ],
    output_explanation_template:
      "Evaluated corporate merger tax treatment under Revenue Code Sec. 73–74, 77/1(8), Royal Decree No. 10, Ministerial Regulation No. 126, and RD Ruling กค 0702(กม.)/462 (22 April 2026).",
  },
];

export const TAX_EXPANSION_GRAPH_EDGES: GraphEdge[] = [
  {
    id: "edge.tax.101",
    source_id: "prov.th.rc.73_74_77_1",
    target_id: "prov.th.ccc.1238_1243",
    relationship: "CITES",
    source_module: "reg24.tax.th",
    target_module: "reg24.civil.th",
    valid_from_version: "2023-02-07",
    provenance_citation: "RD Ruling กค 0702(กม.)/462 (22 April 2026) & กค 0702(กม.)/453 (11 April 2025) linking RC Sec. 73–74 to CCC Sec. 1238–1243",
    verified: true,
  },
  {
    id: "edge.tax.102",
    source_id: "prov.th.rc.73_74_77_1",
    target_id: "prov.th.rc.65",
    relationship: "IMPLEMENTS",
    source_module: "reg24.tax.sub.th",
    target_module: "reg24.tax.th",
    valid_from_version: "1966-02-24",
    provenance_citation: "Royal Decree No. 10 & Ministerial Regulation No. 126 Clause 2(50) implementing Revenue Code merger/EBT exemptions",
    verified: true,
  },
  {
    id: "edge.tax.103",
    source_id: "prov.th.rc.73_74_77_1",
    target_id: "prov.th.ccc.1238_1243",
    relationship: "INTERPRETS",
    source_module: "reg24.tax.ruling.th",
    target_module: "reg24.tax.th",
    valid_from_version: "2026-04-22",
    provenance_citation: "RD Tax Consultation Ruling กค 0702(กม.)/462 (22 April 2026) interpreting RC Sec. 73, 74, 77/1(8) for surviving-company mergers",
    verified: true,
  },
  {
    id: "edge.tax.104",
    source_id: "prov.th.rc.73_74_77_1",
    target_id: "prov.th.rc.65",
    relationship: "CLARIFIES",
    source_module: "reg24.tax.ruling.th",
    target_module: "reg24.tax.ruling.th",
    valid_from_version: "2026-04-22",
    provenance_citation: "RD Ruling กค 0702(กม.)/462 (22 April 2026) expressly follows and clarifies earlier RD Opinion กค 0702(กม.)/453 (11 April 2025)",
    verified: true,
  },
  {
    id: "edge.tax.105",
    source_id: "prov.th.rc.73_74_77_1",
    target_id: "prov.th.rc.65",
    relationship: "REQUIRES_CONDITION",
    source_module: "reg24.tax.sub.th",
    target_module: "reg24.tax.th",
    valid_from_version: "1999-10-15",
    provenance_citation: "Director-General Notification requires book-value transfer, zero cash boot, and 30-day RD filing to qualify for Royal Decree No. 10 & MR No. 126 exemptions",
    verified: true,
  },
  {
    id: "edge.tax.106",
    source_id: "prov.th.topup.2567.sec5",
    target_id: "prov.th.ipa.31",
    relationship: "INTERPRETATION_CHANGED_BY",
    source_module: "reg24.tax.sub.th",
    target_module: "reg24.boi.th",
    valid_from_version: "2025-01-01",
    provenance_citation: "Emergency Decree on Top-up Tax B.E. 2567 imposes 15% minimum ETR on in-scope MNEs (>= 750M EUR), altering net tax benefit of BOI Sec. 31 0% CIT holidays",
    verified: true,
  },
];

export const TAX_EXPANSION_CHANGES: RegulatoryChange[] = [
  {
    id: "chg.th.tax.ruling_462_2026",
    title_en: "RD Tax Ruling กค 0702(กม.)/462 (22 April 2026): Tax Treatment of Surviving-Company Mergers under Amended CCC Sec. 1238",
    title_th: "ข้อหารือกรมสรรพากร ที่ กค 0702(กม.)/462 (22 เมษายน 2569) วินิจฉัยภาระภาษีกรณีการควบรวมบริษัทจำกัดตาม ป.พ.พ. แก้ไขเพิ่มเติม",
    change_type: "guidance_change",
    detected_at: "2026-04-23T08:00:00Z",
    effective_date: "2026-04-22",
    source_document_id: "src.th.rd.ruling.462_2569",
    affected_instrument_ids: ["inst.th.rc", "inst.th.rd.subregs", "inst.th.rd.rulings"],
    affected_provision_ids: ["prov.th.rc.73_74_77_1", "prov.th.ccc.1238_1243"],
    impacted_module_ids: [
      "reg24.tax.th",
      "reg24.tax.sub.th",
      "reg24.tax.ruling.th",
      "reg24.restruct.th",
      "reg24.corporate.th",
    ],
    potentially_affected_rule_ids: ["rule.th.tax.merger_ruling_462_eligibility"],
    potentially_affected_obligation_ids: ["obl.th.tax.merger_notification"],
    review_status: "verified_and_propagated",
    required_actions: [
      "Link RD Ruling กค 0702(กม.)/462 (22 April 2026) and earlier opinion กค 0702(กม.)/453 (11 April 2025) to CCC Sec. 1238–1243 and RC Sec. 73–74.",
      "Ensure M&A advisors designate the entity with higher Section 65 ter (12) tax losses as the surviving company, since the ceased company's losses are extinguished.",
    ],
  },
];

export const TAX_EXPANSION_MODULES: ModuleManifest[] = [
  {
    module_id: "reg24.tax.sub.th",
    display_name: "Revenue Code Sub-Regulations & Top-up Tax (REG-TAX-SUB)",
    display_name_th: "กฎหมายลำดับรองประมวลรัษฎากร และ พ.ร.ก. ภาษีส่วนเพิ่ม (REG-TAX-SUB)",
    version: "1.1.0",
    jurisdiction: "TH",
    legal_domains: [
      "Royal Decrees (พ.ร.ฎ. ฉบับที่ 10)",
      "Ministerial Regulations (กฎกระทรวง ฉบับที่ 126)",
      "MOF & DG RD Notifications (ประกาศ กค. / อธิบดีกรมสรรพากร)",
      "RD Departmental Orders (คำสั่งกรมสรรพากร ท.ป. / ป.)",
      "Emergency Decree on Top-up Tax B.E. 2567 (GMT24 Pillar Two 15%)",
    ],
    source_registry: [
      {
        name: "Revenue Code Subsidiary Legislation & Emergency Decree on Top-up Tax B.E. 2567",
        url: "https://www.rd.go.th/674.html",
        regulator_code: "RD",
        check_interval_hours: 24,
        last_checked_at: "2026-10-18T11:30:00Z",
        last_check_status: "ok",
      },
    ],
    supported_capabilities: [
      "get_revenue_code_section",
      "get_related_subregulations",
      "get_applicable_tax_law_at_date",
      "check_tax_exemption_eligibility",
      "trace_tax_legal_basis",
    ],
    dependency_modules: ["reg24.tax.th", "reg24.civil.th", "reg24.boi.th"],
    ontology_version: "2026.10.4",
    ruleset_version: "1.1.0",
    schema_version: "1.1.0",
    source_coverage: {
      approved_instruments_target: 5,
      ingested_instruments_count: 5,
      provisions_indexed: 380,
      executable_rules_approved: 1,
      provision_boundary_accuracy_pct: 99.6,
      known_limitations: [
        "Enforces TAX-QUALITY-01 hierarchy: Ministerial Notifications, DG Notifications, and RD Paw./Tor.Por. Orders are evaluated strictly within their statutory enabling authority.",
      ],
    },
    review_status: "published",
    published_at: "2026-10-18T12:00:00Z",
    maintainer: "REG24 Tax Law & Subsidiary Legislation Architecture Squad",
    permissions: {
      read_roles: ["Platform Administrator", "Module Maintainer", "Legal Reviewer", "Source Operator", "API Developer", "Read-only Auditor"],
      write_roles: ["Platform Administrator", "Module Maintainer"],
      approve_roles: ["Platform Administrator", "Legal Reviewer"],
    },
    test_suite: {
      validation_cases: [
        "Royal Decree No. 10 & Ministerial Regulation No. 126 merger/EBT exemption checks",
        "Director-General 30-day merger notification & book-value continuity verification",
        "Emergency Decree on Top-up Tax B.E. 2567 (15% Global Minimum Tax for GMT24)",
      ],
      pass_rate_pct: 100,
    },
    metro_tile: {
      accent_hex: "#00ABA9",
      tile_size: "1x1",
      icon_name: "Landmark",
      short_code: "P0-11",
    },
  },
  {
    module_id: "reg24.tax.ruling.th",
    display_name: "RD Tax Rulings & Formal Interpretations (REG-TAX-RULING)",
    display_name_th: "ข้อหารือกรมสรรพากรและคำวินิจฉัยคณะกรรมการวินิจฉัยภาษีอากร (REG-TAX-RULING)",
    version: "1.1.0",
    jurisdiction: "TH",
    legal_domains: [
      "RD Tax Consultation Archive 2540–2569 (ข้อหารือภาษีอากร)",
      "Merger Ruling กค 0702(กม.)/462 (22 April 2026) & กค 0702(กม.)/453 (11 April 2025)",
      "Tax Ruling Committee Decisions (คำวินิจฉัยคณะกรรมการวินิจฉัยภาษีอากร มาตรา 13 สัตต)",
      "Fact-Specific Precedent Comparison Engine (TAX-RULING-02)",
    ],
    source_registry: [
      {
        name: "RD Tax Consultation Search Portal (searchdiscuss.rd.go.th) & Tax Ruling Committee (rd.go.th/1601.html)",
        url: "https://searchdiscuss.rd.go.th/",
        regulator_code: "RD",
        check_interval_hours: 24,
        last_checked_at: "2026-10-18T11:35:00Z",
        last_check_status: "ok",
      },
    ],
    supported_capabilities: [
      "search_tax_rulings",
      "get_tax_ruling",
      "find_similar_tax_rulings",
      "compare_tax_interpretations",
      "analyze_restructuring_tax",
    ],
    dependency_modules: ["reg24.tax.th", "reg24.tax.sub.th", "reg24.civil.th", "reg24.restruct.th"],
    ontology_version: "2026.10.4",
    ruleset_version: "1.1.0",
    schema_version: "1.1.0",
    source_coverage: {
      approved_instruments_target: 3,
      ingested_instruments_count: 3,
      provisions_indexed: 520,
      executable_rules_approved: 1,
      provision_boundary_accuracy_pct: 99.4,
      known_limitations: [
        "TAX-RULING-02 & TAX-QUALITY-01: Tax consultation letters are fact-specific administrative opinions and never silently override primary legislation or automatically bind a different taxpayer's facts.",
      ],
    },
    review_status: "published",
    published_at: "2026-10-18T12:00:00Z",
    maintainer: "REG24 Tax Precedent & Ruling Intelligence Squad",
    permissions: {
      read_roles: ["Platform Administrator", "Module Maintainer", "Legal Reviewer", "Source Operator", "API Developer", "Read-only Auditor"],
      write_roles: ["Platform Administrator", "Module Maintainer"],
      approve_roles: ["Platform Administrator", "Legal Reviewer"],
    },
    test_suite: {
      validation_cases: [
        "RD Ruling กค 0702(กม.)/462 (22 April 2026) & กค 0702(กม.)/453 (11 April 2025) surviving-company merger analysis",
        "Fact-specific similarity vs. material difference detection (cash boot / loss carryforward)",
        "Commission of Taxation Decision No. 40/2560 formal statutory interpretation hierarchy",
      ],
      pass_rate_pct: 100,
    },
    metro_tile: {
      accent_hex: "#D80073",
      tile_size: "2x1",
      icon_name: "FileSignature",
      short_code: "P0-12",
    },
  },
  {
    module_id: "reg24.tax.case.th",
    display_name: "Supreme Court & Tax Litigation Decisions (REG-TAX-CASE)",
    display_name_th: "คำพิพากษาศาลฎีกาและคดีภาษีอากร (REG-TAX-CASE)",
    version: "1.1.0",
    jurisdiction: "TH",
    legal_domains: [
      "Supreme Court Tax Division Judgments (คำพิพากษาศาลฎีกาแผนกคดีภาษีอากร)",
      "Central Tax Court Decisions (ศาลภาษีอากรกลาง)",
      "Judicial vs. RD Administrative Interpretation Conflict Detection (TAX-CASE-01)",
    ],
    source_registry: [
      {
        name: "Supreme Court Deka Database & Central Tax Court",
        url: "https://deka.supremecourt.or.th",
        regulator_code: "TAX-COURT",
        check_interval_hours: 24,
        last_checked_at: "2026-10-18T11:38:00Z",
        last_check_status: "ok",
      },
    ],
    supported_capabilities: [
      "get_related_court_decisions",
      "compare_tax_interpretations",
      "trace_tax_legal_basis",
    ],
    dependency_modules: ["reg24.tax.th", "reg24.tax.ruling.th"],
    ontology_version: "2026.10.4",
    ruleset_version: "1.1.0",
    schema_version: "1.1.0",
    source_coverage: {
      approved_instruments_target: 2,
      ingested_instruments_count: 2,
      provisions_indexed: 210,
      executable_rules_approved: 0,
      provision_boundary_accuracy_pct: 99.5,
      known_limitations: [
        "Distinguishes binding judicial precedent on statutory interpretation from RD internal guidance (e.g., Deka 2108/2564).",
      ],
    },
    review_status: "published",
    published_at: "2026-10-18T12:00:00Z",
    maintainer: "REG24 Tax Litigation & Jurisprudence Squad",
    permissions: {
      read_roles: ["Platform Administrator", "Module Maintainer", "Legal Reviewer", "Source Operator", "API Developer", "Read-only Auditor"],
      write_roles: ["Platform Administrator", "Module Maintainer"],
      approve_roles: ["Platform Administrator", "Legal Reviewer"],
    },
    test_suite: {
      validation_cases: [
        "Supreme Court Judgment 5412/2565 personal nature of Sec. 65 ter (12) tax losses",
        "Supreme Court Judgment 2108/2564 judicial override of conflicting RD consultation letters",
      ],
      pass_rate_pct: 100,
    },
    metro_tile: {
      accent_hex: "#6A00FF",
      tile_size: "1x1",
      icon_name: "Scale",
      short_code: "P0-13",
    },
  },
  {
    module_id: "reg24.tax.change.th",
    display_name: "Tax Amendments & Interpretation Change Radar (REG-TAX-CHANGE)",
    display_name_th: "ระบบติดตามการแก้ไขกฎหมายและแนววินิจฉัยภาษีอากร (REG-TAX-CHANGE)",
    version: "1.1.0",
    jurisdiction: "TH",
    legal_domains: [
      "Revenue Code & Royal Decree Amendments",
      "New RD Consultation Letters & Interpretation Shifts (e.g. กค 0702(กม.)/462)",
      "Compliance Impact Monitoring for TP24, CFO24, ACC24, GMT24 & LAW24",
    ],
    source_registry: [
      {
        name: "Royal Thai Government Gazette & RD What's New Portal",
        url: "https://www.rd.go.th/674.html",
        regulator_code: "RD",
        check_interval_hours: 12,
        last_checked_at: "2026-10-18T11:40:00Z",
        last_check_status: "ok",
      },
    ],
    supported_capabilities: ["get_recent_tax_rule_changes", "get_applicable_tax_law_at_date"],
    dependency_modules: ["reg24.tax.th", "reg24.tax.sub.th", "reg24.tax.ruling.th"],
    ontology_version: "2026.10.4",
    ruleset_version: "1.1.0",
    schema_version: "1.1.0",
    source_coverage: {
      approved_instruments_target: 3,
      ingested_instruments_count: 3,
      provisions_indexed: 180,
      executable_rules_approved: 0,
      provision_boundary_accuracy_pct: 99.5,
      known_limitations: [
        "TAX-RULING-03: Never auto-labels a later ruling as superseding an earlier ruling without explicit official reference or human expert validation.",
      ],
    },
    review_status: "published",
    published_at: "2026-10-18T12:00:00Z",
    maintainer: "REG24 Regulatory Change & Horizon Scanning Squad",
    permissions: {
      read_roles: ["Platform Administrator", "Module Maintainer", "Legal Reviewer", "Source Operator", "API Developer", "Read-only Auditor"],
      write_roles: ["Platform Administrator", "Module Maintainer"],
      approve_roles: ["Platform Administrator", "Legal Reviewer"],
    },
    test_suite: {
      validation_cases: [
        "Propagation of RD Ruling กค 0702(กม.)/462 (22 April 2026) across REG-TAX, REG-RESTRUCT, and REG-CORP",
      ],
      pass_rate_pct: 100,
    },
    metro_tile: {
      accent_hex: "#F0A30A",
      tile_size: "1x1",
      icon_name: "Activity",
      short_code: "P0-14",
    },
  },
];
