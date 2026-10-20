/**
 * REG24 — Google Drive & Synced Legal Database Resource Master Loader & Search Engine
 *
 * Incorporates all 278 regulations, statutes, notifications, administrative rulings,
 * environmental CoP checklists, contract taxonomy sources, and ESG regulatory registers
 * from the user's Google Drive (DriveFS 105088240612977611801) and synced master folders:
 *   1. Google_Drive_Regulations (8 Master Folders/Instruments: ERC Solar Farm Co-op Regs No.1 & No.2,
 *      ERC ORS Kor.1 & PPA Sections I–IV, ERC/PEA POA & Feeder Check, SEC Digital Asset & ICO Portal IT Regs,
 *      NBTC GSaaS & Foreign Satellite Landing Rights Regs, AI Law Lab Defensibility, Blackhorse Master Contracts)
 *   2. ERC_Energy_Regulations_Master (30 Official ERC Regulations, Notifications & CoP Checklists)
 *   3. OECD_Pillar_Two_TopUpTax_Regs (11 Official Thailand Top-Up Tax B.E. 2567–2569 Regulations:
 *      Emergency Decree prk2567, MOF Notification No. 1 moftopuptax1, RD DG Notifications No. 1–8 dgtopuptax1–8)
 *   4. Legal_Docs_Database_7L_Master (71 Files: 57 Thai Statutory & Supreme Court Dika Compendiums, PPP Law 2556 &
 *      PPP Rulings on EGAT/Rental Fee/Waste Mgmt, Securities Law Framework + 14 7L Advisory PDPA/GDPR/SET/M&A/TP Resources)
 *   5. Thailand_500_Contract_Legal_Sources (41 Items: 16 Official Legal Sources LS01–LS16 + 25 Contract Categories C01–C25 = 500 Contracts)
 *   6. ESG24_Regulatory_Source_Register (117 Thai & Global ESG, SEC One Report, TGO Carbon, Factory & EIA Regulations)
 */

import rawMasterCorpus from "./legal-resource-master-corpus.json";

export type ResourceMasterCollectionId =
  | "Google_Drive_Regulations"
  | "ERC_Energy_Regulations_Master"
  | "OECD_Pillar_Two_TopUpTax_Regs"
  | "Legal_Docs_Database_7L_Master"
  | "Thailand_500_Contract_Legal_Sources"
  | "ESG24_Regulatory_Source_Register";

export interface LegalResourceMasterRecord {
  id: string;
  code: string;
  collection: ResourceMasterCollectionId;
  folder_path: string;
  drive_stable_id: string;
  title_th: string;
  title_en: string;
  regulator: string;
  instrument_type: string;
  year_be: number;
  effective_date: string;
  status: "IN_FORCE" | "AMENDED_BY_NO2_2560" | "WATCHLIST_DRAFT" | string;
  legal_provisions: string;
  summary_th: string;
  verbatim_excerpt: string;
  file_name: string;
  file_size_bytes: number;
  sha256: string;
}

export const LEGAL_RESOURCE_MASTER_CORPUS: LegalResourceMasterRecord[] =
  rawMasterCorpus as LegalResourceMasterRecord[];

export const RESOURCE_MASTER_COLLECTIONS: Record<
  ResourceMasterCollectionId,
  {
    id: ResourceMasterCollectionId;
    label_th: string;
    label_en: string;
    drive_source: string;
    count: number;
    badge_color: string;
  }
> = {
  Google_Drive_Regulations: {
    id: "Google_Drive_Regulations",
    label_th: "Google Drive — โฟลเดอร์ Regulations, ERC, ก.ล.ต. ICO, กสทช. GSaaS & AI Law Lab",
    label_en: "Google Drive — Regulations, ERC Solar, SEC Digital Asset, NBTC GSaaS & AI Law Lab",
    drive_source: "Google Drive (DriveFS 105088240612977611801 / stable_id 4615, 4695, 5773, 2519, 2561, 363)",
    count: 8,
    badge_color: "emerald",
  },
  OECD_Pillar_Two_TopUpTax_Regs: {
    id: "OECD_Pillar_Two_TopUpTax_Regs",
    label_th: "พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 และประกาศกระทรวงการคลัง/อธิบดีกรมสรรพากร ฉบับที่ 1–8 (Pillar Two)",
    label_en: "Thailand OECD Pillar Two / Top-Up Tax Emergency Decree B.E. 2567 & MOF/RD Notifications No. 1–8",
    drive_source: "Pillar2 Regs (prk2567.docx, moftopuptax1.docx, dgtopuptax1–8.docx, GMT24 Academic Note)",
    count: 11,
    badge_color: "amber",
  },
  ERC_Energy_Regulations_Master: {
    id: "ERC_Energy_Regulations_Master",
    label_th: "ระเบียบและประกาศ กกพ. (ERC) และประมวลหลักการปฏิบัติ (CoP) ด้านพลังงานและสิ่งแวดล้อม 30 ฉบับ",
    label_en: "ERC Energy Licensing Regulations, Notifications & Environmental CoP Checklists (30 Instruments)",
    drive_source: "Google Drive / Regulations / ERC Informations & COP24 Master Corpus",
    count: 30,
    badge_color: "cyan",
  },
  Legal_Docs_Database_7L_Master: {
    id: "Legal_Docs_Database_7L_Master",
    label_th: "คลังฐานข้อมูลกฎหมายหลัก (Legal Docs Database 57 แฟ้ม + พ.ร.บ. ร่วมลงทุน PPP + 7L Resources PDPA/M&A)",
    label_en: "Legal Docs Database (57 Core Thai Law & Dika Compendiums, PPP Law & Rulings) + 7L Advisory Resources",
    drive_source: "Google Drive & OneDrive / Legal Docs Database & 7L Advisory / Resources (stable_id 246, 269, 408)",
    count: 71,
    badge_color: "indigo",
  },
  Thailand_500_Contract_Legal_Sources: {
    id: "Thailand_500_Contract_Legal_Sources",
    label_th: "ฐานกฎหมายอ้างอิง LS01–LS16 และอนุกรมวิธานสัญญามาตรฐานประเทศไทย 25 หมวด (500 ประเภทสัญญา)",
    label_en: "Thailand 500 Master Contract Taxonomy (25 Categories C01–C25 & 16 Statutory Sources LS01–LS16)",
    drive_source: "Master_Contract_Taxonomy_Thailand_500.xlsx",
    count: 41,
    badge_color: "violet",
  },
  ESG24_Regulatory_Source_Register: {
    id: "ESG24_Regulatory_Source_Register",
    label_th: "ทะเบียนกฎหมายสิ่งแวดล้อม คาร์บอนเครดิต (TGO) โรงงาน และความยั่งยืน (ESG24 Source Register 117 รายการ)",
    label_en: "ESG24 Regulatory Source Register (117 Thai & Global Climate, TGO, Factory, EIA & SEC ESG Rules)",
    drive_source: "ESG24_Source_Register.xlsx (117 Source Families / 7,273 PDF Pages)",
    count: 117,
    badge_color: "teal",
  },
};

export function searchLegalResourceMaster(options?: {
  query?: string;
  collection?: ResourceMasterCollectionId | "ALL";
  regulator?: string;
  year_be?: number;
  limit?: number;
  offset?: number;
}): {
  total_corpus_count: number;
  matched_count: number;
  collections: typeof RESOURCE_MASTER_COLLECTIONS;
  collection_breakdown: Record<string, number>;
  results: LegalResourceMasterRecord[];
} {
  const queryRaw = (options?.query || "").trim().toLowerCase();
  const terms = queryRaw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const collectionFilter = options?.collection && options.collection !== "ALL" ? options.collection : undefined;
  const regulatorFilter = (options?.regulator || "").trim().toLowerCase();
  const yearFilter = options?.year_be;
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 300);
  const offset = Math.max(options?.offset ?? 0, 0);

  const collectionBreakdown: Record<string, number> = {};
  for (const item of LEGAL_RESOURCE_MASTER_CORPUS) {
    collectionBreakdown[item.collection] = (collectionBreakdown[item.collection] || 0) + 1;
  }

  let filtered = LEGAL_RESOURCE_MASTER_CORPUS.filter((item) => {
    if (collectionFilter && item.collection !== collectionFilter) {
      return false;
    }
    if (regulatorFilter && !item.regulator.toLowerCase().includes(regulatorFilter)) {
      return false;
    }
    if (yearFilter && item.year_be !== yearFilter) {
      return false;
    }
    return true;
  });

  if (terms.length > 0) {
    const scored = filtered
      .map((item) => {
        const haystack = [
          item.id,
          item.code,
          item.title_th,
          item.title_en,
          item.regulator,
          item.instrument_type,
          item.legal_provisions,
          item.summary_th,
          item.verbatim_excerpt,
          item.folder_path,
          item.file_name,
        ]
          .join(" ")
          .toLowerCase();

        let score = 0;
        for (const term of terms) {
          if (item.code.toLowerCase().includes(term) || item.id.toLowerCase().includes(term)) {
            score += 12;
          }
          if (item.title_th.toLowerCase().includes(term) || item.title_en.toLowerCase().includes(term)) {
            score += 8;
          }
          if (item.legal_provisions.toLowerCase().includes(term)) {
            score += 6;
          }
          if (haystack.includes(term)) {
            score += 3;
          }
        }
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    filtered = scored.map((s) => s.item);
  }

  return {
    total_corpus_count: LEGAL_RESOURCE_MASTER_CORPUS.length,
    matched_count: filtered.length,
    collections: RESOURCE_MASTER_COLLECTIONS,
    collection_breakdown: collectionBreakdown,
    results: filtered.slice(offset, offset + limit),
  };
}

export function getLegalResourceMasterById(idOrCode: string): LegalResourceMasterRecord | undefined {
  const norm = idOrCode.trim().toLowerCase();
  return LEGAL_RESOURCE_MASTER_CORPUS.find(
    (r) => r.id.toLowerCase() === norm || r.code.toLowerCase() === norm
  );
}
