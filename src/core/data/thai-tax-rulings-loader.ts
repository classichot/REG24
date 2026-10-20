/**
 * REG24 — Official Thai Revenue Department Tax Rulings Corpus Loader & Search Engine
 * Source: OneDrive / Thai Tax Ruling (thai_tax_rulings_index.csv — 3,643 Official Rulings, B.E. 2543–2569)
 */

import rawCorpus from "./thai-tax-rulings-corpus.json";

export interface ThaiTaxRulingRecord {
  id: string;
  ruling_no: string;
  date: string;
  year_be: number;
  primary_tax_type: string;
  tax_types: string;
  subject: string;
  legal_provisions: string;
  facts: string;
  ruling: string;
  source_url: string;
  file: string;
}

export const THAI_TAX_RULINGS_CORPUS: ThaiTaxRulingRecord[] =
  rawCorpus as ThaiTaxRulingRecord[];

export const TAX_TYPE_LABELS: Record<
  string,
  { label_en: string; label_th: string; count: number }
> = {
  VAT: {
    label_en: "Value Added Tax (VAT)",
    label_th: "ภาษีมูลค่าเพิ่ม (VAT)",
    count: 1038,
  },
  Corporate_Income_Tax: {
    label_en: "Corporate Income Tax (CIT)",
    label_th: "ภาษีเงินได้นิติบุคคล (CIT)",
    count: 1014,
  },
  Personal_Income_Tax: {
    label_en: "Personal Income Tax (PIT)",
    label_th: "ภาษีเงินได้บุคคลธรรมดา (PIT)",
    count: 714,
  },
  Withholding_Tax: {
    label_en: "Withholding Tax (WHT)",
    label_th: "ภาษีเงินได้หัก ณ ที่จ่าย (WHT)",
    count: 527,
  },
  Specific_Business_Tax: {
    label_en: "Specific Business Tax (SBT)",
    label_th: "ภาษีธุรกิจเฉพาะ (SBT)",
    count: 142,
  },
  Stamp_Duty: {
    label_en: "Stamp Duty",
    label_th: "อากรแสตมป์",
    count: 99,
  },
  Other: {
    label_en: "Other / Double Tax Agreements (DTA)",
    label_th: "ภาษีอื่นๆ / อนุสัญญาภาษีซ้อน",
    count: 77,
  },
  Income_Tax_general: {
    label_en: "General Income Tax",
    label_th: "ภาษีเงินได้ทั่วไป",
    count: 24,
  },
  Petroleum_Income_Tax: {
    label_en: "Petroleum Income Tax",
    label_th: "ภาษีเงินได้ปิโตรเลียม",
    count: 4,
  },
  Business_Tax_old: {
    label_en: "Business Tax (Historical)",
    label_th: "ภาษีการค้า (เดิม)",
    count: 2,
  },
  Inheritance_Tax: {
    label_en: "Inheritance Tax",
    label_th: "ภาษีมรดก",
    count: 2,
  },
};

export function searchThaiTaxRulings(options: {
  query?: string;
  primary_tax_type?: string;
  year_be?: number;
  limit?: number;
  offset?: number;
}): {
  total_corpus_count: number;
  total_corpus_size: number;
  matched_count: number;
  total_matching: number;
  categories: typeof TAX_TYPE_LABELS;
  category_breakdown: Record<string, number>;
  results: ThaiTaxRulingRecord[];
  rulings: ThaiTaxRulingRecord[];
} {
  const q = (options.query || "").trim().toLowerCase();
  const taxFilter = (options.primary_tax_type || "").trim();
  const yearFilter = options.year_be ? Number(options.year_be) : null;
  const limit = Math.min(200, Math.max(1, options.limit || 50));
  const offset = Math.max(0, options.offset || 0);

  const filtered = THAI_TAX_RULINGS_CORPUS.filter((item) => {
    if (taxFilter && taxFilter !== "ALL" && item.primary_tax_type !== taxFilter) {
      return false;
    }
    if (yearFilter && item.year_be !== yearFilter) {
      return false;
    }
    if (!q) return true;
    return (
      item.ruling_no.toLowerCase().includes(q) ||
      item.subject.toLowerCase().includes(q) ||
      item.legal_provisions.toLowerCase().includes(q) ||
      item.ruling.toLowerCase().includes(q) ||
      item.facts.toLowerCase().includes(q)
    );
  });

  const sliced = filtered.slice(offset, offset + limit);
  const categoryBreakdown: Record<string, number> = Object.fromEntries(
    Object.entries(TAX_TYPE_LABELS).map(([k, v]) => [k, v.count])
  );

  return {
    total_corpus_count: THAI_TAX_RULINGS_CORPUS.length,
    total_corpus_size: THAI_TAX_RULINGS_CORPUS.length,
    matched_count: filtered.length,
    total_matching: filtered.length,
    categories: TAX_TYPE_LABELS,
    category_breakdown: categoryBreakdown,
    results: sliced,
    rulings: sliced,
  };
}
