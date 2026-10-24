/**
 * REG24 — Google Drive Legal Database Resource Master Loader & Search Engine
 *
 * Master Folder: https://drive.google.com/drive/folders/1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm
 *
 * Incorporates all 2,034 regulation & judicial files across all 17 Authority Folders in
 * "Legal Database Resource Master" plus 278 deep statutory/contract/ESG records (2,312 total):
 *
 *   17 Authority Subfolders in Legal Database Resource Master (2,034 files):
 *   1. DBD — Department of Business Development (113 files | Folder ID: 1rzEBsNIfbHoB37J2Nt05E60EDEZaVkgM)
 *   2. SET — Stock Exchange of Thailand (41 files | Subfolders: Regulations, Notifications, Guidelines)
 *   3. SEC — Securities and Exchange Commission Thailand (18 files)
 *   4. RD — Revenue Department (81 files | Subfolders: CIT, PIT, VAT, WHT, SBT, Stamp, Top-up Tax Pillar Two, Transfer Pricing)
 *   5. BOI — Board of Investment (124 files)
 *   6. ERC — Energy Regulatory Commission (92 files)
 *   7. DMF — Department of Mineral Fuels (130 files)
 *   8. Customs — Customs Department (92 files)
 *   9. Excise — Excise Department (125 files)
 *  10. DFT — Department of Foreign Trade (178 files)
 *  11. DIP — Department of Intellectual Property (280 files)
 *  12. DITP — Department of International Trade Promotion (21 files)
 *  13. TCCT — Trade Competition Commission of Thailand (424 files)
 *  14. BOT — Bank of Thailand (69 files)
 *  15. AMLO — Anti-Money Laundering Office (143 files)
 *  16. Health — MOPH / FDA / HSS / Medical Council / NHSO (65 files | 7 Subfolders)
 *  17. Deka Database — Supreme Court & Specialized Courts Jurisprudence (38 files | Full Deka Rulings & JSONL Index)
 *
 *   Plus 6 Specialized Deep-Extraction Collections (278 records):
 *  18. Google_Drive_Regulations (8 Instruments)
 *  19. OECD_Pillar_Two_TopUpTax_Regs (11 Full-Text DOCX Statutory Extracts)
 *  20. ERC_Energy_Regulations_Master (30 CoP & Licensing Checklists)
 *  21. Legal_Docs_Database_7L_Master (71 Compendiums & 7L Advisory Guides)
 *  22. Thailand_500_Contract_Legal_Sources (41 Contract Taxonomy & Statutory Sources)
 *  23. ESG24_Regulatory_Source_Register (117 Climate, TGO, Factory & SEC ESG Sources)
 */

import rawMasterCorpus from "./legal-resource-master-corpus.json";
import rawLegalFormsCatalog from "./legal-forms-master-catalog.json";

export type ResourceMasterCollectionId =
  | "DBD_Business_Development"
  | "SET_Stock_Exchange"
  | "SEC_Securities_Exchange"
  | "RD_Revenue_Department"
  | "BOI_Board_of_Investment"
  | "ERC_Energy_Commission"
  | "DMF_Mineral_Fuels"
  | "Customs_Department"
  | "Excise_Department"
  | "DFT_Foreign_Trade"
  | "DIP_Intellectual_Property"
  | "DITP_Trade_Promotion"
  | "TCCT_Trade_Competition"
  | "BOT_Bank_of_Thailand"
  | "AMLO_Anti_Money_Laundering"
  | "Health_Public_Health_FDA"
  | "Deka_Supreme_Court_Database"
  | "Google_Drive_Regulations"
  | "ERC_Energy_Regulations_Master"
  | "OECD_Pillar_Two_TopUpTax_Regs"
  | "Legal_Docs_Database_7L_Master"
  | "Thailand_500_Contract_Legal_Sources"
  | "ESG24_Regulatory_Source_Register"
  | "Legal_Forms_Master_Catalog";

export interface LegalFormsCatalogRecord {
  id: string;
  code: string;
  category_code: string;
  category_folder: string;
  authority_th: string;
  category_description_en: string;
  title: string;
  file_name: string;
  file_extension: string;
  mime_type: string;
  file_size_bytes: number;
  folder_path: string;
  drive_stable_id: string;
  drive_file_id: string;
  drive_url: string;
  is_court_or_agency_form: boolean;
  strict_layout_lock: boolean;
  version_package: string;
  sha256: string;
  form_index_number?: number | null;
  form_index_code?: string | null;
  thai_form_code?: string;
  is_canonical_553_form?: boolean;
  license_scope?: "INTERNAL_OWN_USE_ONLY";
  external_sharing_prohibited?: boolean;
  license_notice_th?: string;
  license_notice_en?: string;
  extracted_form_text?: string;
  fillable_fields?: string[];
  pdf_companion_drive_id?: string;
  pdf_companion_url?: string;
}

export const LEGAL_FORMS_MASTER_CATALOG: LegalFormsCatalogRecord[] =
  rawLegalFormsCatalog as LegalFormsCatalogRecord[];

export const CANONICAL_553_LEGAL_FORMS: LegalFormsCatalogRecord[] =
  LEGAL_FORMS_MASTER_CATALOG.filter((f) => f.is_canonical_553_form === true);

export const LEGAL_FORMS_DRIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1jNJtHzWoJfGZdDqHzPbuZshNzbOwk-or";

export const LEGAL_FORMS_INDEX_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/14Ri-BTPefdCtqk1nFAJE9-MKOVqTataE_vvJm5ogvvg/edit";

export interface LegalResourceMasterRecord {
  id: string;
  code: string;
  collection: ResourceMasterCollectionId;
  authority_code?: string;
  folder_path: string;
  drive_stable_id: string;
  drive_url?: string;
  title_th: string;
  title_en: string;
  regulator: string;
  instrument_type: string;
  year_be: number;
  effective_date: string;
  status: "IN_FORCE" | "SUPERSEDED" | "AMENDED_BY_NO2_2560" | "WATCHLIST_DRAFT" | string;
  legal_provisions: string;
  summary_th: string;
  verbatim_excerpt: string;
  file_name: string;
  file_size_bytes: number;
  sha256: string;
}

export const LEGAL_RESOURCE_MASTER_CORPUS: LegalResourceMasterRecord[] =
  rawMasterCorpus as LegalResourceMasterRecord[];

export const MASTER_DRIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm";

export interface MasterAuthorityFolderMeta {
  code: string;
  collection: ResourceMasterCollectionId;
  short_name: string;
  folder_name: string;
  label_th: string;
  label_en: string;
  drive_folder_id: string;
  drive_folder_url: string;
  subfolders: string[];
  count: number;
}

export const MASTER_AUTHORITY_FOLDERS: MasterAuthorityFolderMeta[] = [
  {
    code: "DBD",
    collection: "DBD_Business_Development",
    short_name: "DBD",
    folder_name: "DBD - Department of Business Development",
    label_th: "กรมพัฒนาธุรกิจการค้า (DBD) — กฎหมายหุ้นส่วนบริษัท มหาชน คนต่างด้าว และการบัญชี",
    label_en: "DBD — Department of Business Development (Corporate, Foreign Business Act & Accounting)",
    drive_folder_id: "1rzEBsNIfbHoB37J2Nt05E60EDEZaVkgM",
    drive_folder_url: "https://drive.google.com/drive/folders/1rzEBsNIfbHoB37J2Nt05E60EDEZaVkgM",
    subfolders: [],
    count: 113,
  },
  {
    code: "SET",
    collection: "SET_Stock_Exchange",
    short_name: "SET",
    folder_name: "SET - Stock Exchange of Thailand",
    label_th: "ตลาดหลักทรัพย์แห่งประเทศไทย (SET) — ข้อบังคับ ประกาศ และแนวทางบริษัทจดทะเบียน",
    label_en: "SET — Stock Exchange of Thailand (Regulations, Notifications & Guidelines)",
    drive_folder_id: "1gQhTyb9Sa3vRoCl7ybyW3pilfnT6jjH_",
    drive_folder_url: "https://drive.google.com/drive/folders/1gQhTyb9Sa3vRoCl7ybyW3pilfnT6jjH_",
    subfolders: ["Regulations", "Notifications", "Guidelines"],
    count: 41,
  },
  {
    code: "SEC",
    collection: "SEC_Securities_Exchange",
    short_name: "SEC",
    folder_name: "SEC - Securities and Exchange Commission Thailand",
    label_th: "สำนักงาน ก.ล.ต. (SEC Thailand) — ประกาศคณะกรรมการกำกับตลาดทุน ตราสารหนี้ และหุ้นกู้",
    label_en: "SEC — Securities and Exchange Commission Thailand (Capital Market Notifications)",
    drive_folder_id: "14GpOTTS7h8Fx9SyEOn8TYOTwNYhXbvJB",
    drive_folder_url: "https://drive.google.com/drive/folders/14GpOTTS7h8Fx9SyEOn8TYOTwNYhXbvJB",
    subfolders: [],
    count: 18,
  },
  {
    code: "RD",
    collection: "RD_Revenue_Department",
    short_name: "RD",
    folder_name: "RD - Revenue Department",
    label_th: "กรมสรรพากร (RD) — CIT, PIT, VAT, WHT, SBT, อากรแสตมป์, Pillar Two & Transfer Pricing",
    label_en: "RD — Revenue Department (CIT, PIT, VAT, WHT, SBT, Stamp, Pillar Two, Transfer Pricing)",
    drive_folder_id: "1sJHpmTR1uEiEcFo3B0bVSfkX1P5HPsi6",
    drive_folder_url: "https://drive.google.com/drive/folders/1sJHpmTR1uEiEcFo3B0bVSfkX1P5HPsi6",
    subfolders: ["CIT", "PIT", "VAT", "WHT", "SBT", "Stamp", "Top-up Tax (Pillar Two)", "Transfer Pricing"],
    count: 81,
  },
  {
    code: "BOI",
    collection: "BOI_Board_of_Investment",
    short_name: "BOI",
    folder_name: "BOI - Board of Investment",
    label_th: "สำนักงานคณะกรรมการส่งเสริมการลงทุน (BOI) — นโยบายส่งเสริมการลงทุน สิทธิประโยชน์ และ Smart Visa",
    label_en: "BOI — Board of Investment (Investment Promotion Policies, Incentives & Smart Visa)",
    drive_folder_id: "1O_y2gYVNmj4D9jB4ZI4aHc9a4XQeFlq5",
    drive_folder_url: "https://drive.google.com/drive/folders/1O_y2gYVNmj4D9jB4ZI4aHc9a4XQeFlq5",
    subfolders: [],
    count: 124,
  },
  {
    code: "ERC",
    collection: "ERC_Energy_Commission",
    short_name: "ERC",
    folder_name: "ERC - Energy Regulatory Commission",
    label_th: "สำนักงานคณะกรรมการกำกับกิจการพลังงาน (กกพ. / ERC) — ใบอนุญาตพลังงาน อัตราค่าไฟฟ้า และ PPA",
    label_en: "ERC — Energy Regulatory Commission (Power Licensing, FiT, Tariffs & Grid Regulations)",
    drive_folder_id: "1DCCntM2MmZ3d8l8PB_cjMkiMZAv7GDAT",
    drive_folder_url: "https://drive.google.com/drive/folders/1DCCntM2MmZ3d8l8PB_cjMkiMZAv7GDAT",
    subfolders: [],
    count: 92,
  },
  {
    code: "DMF",
    collection: "DMF_Mineral_Fuels",
    short_name: "DMF",
    folder_name: "DMF - Department of Mineral Fuels",
    label_th: "กรมเชื้อเพลิงธรรมชาติ (DMF) — กฎหมายปิโตรเลียม สัมปทาน แบ่งปันผลผลิต (PSC) และรื้อถอนแท่น",
    label_en: "DMF — Department of Mineral Fuels (Petroleum Act, Concessions, PSC & Decommissioning)",
    drive_folder_id: "1jCDwAEoCWs7UspUJ99h4IHedRWX6s0y-",
    drive_folder_url: "https://drive.google.com/drive/folders/1jCDwAEoCWs7UspUJ99h4IHedRWX6s0y-",
    subfolders: [],
    count: 130,
  },
  {
    code: "CUSTOMS",
    collection: "Customs_Department",
    short_name: "Customs",
    folder_name: "Customs - Customs Department",
    label_th: "กรมศุลกากร (Customs) — พ.ร.บ. ศุลกากร พิกัดอัตราศุลกากร เขตปลอดอากร และคำวินิจฉัยอุทธรณ์",
    label_en: "Customs — Customs Department (Customs Act, Tariffs, Valuation & Appeal Rulings)",
    drive_folder_id: "1BaWRZgpQbEl7hl8Xsh3vPXMZsDjXkgxv",
    drive_folder_url: "https://drive.google.com/drive/folders/1BaWRZgpQbEl7hl8Xsh3vPXMZsDjXkgxv",
    subfolders: [],
    count: 92,
  },
  {
    code: "EXCISE",
    collection: "Excise_Department",
    short_name: "Excise",
    folder_name: "Excise - Excise Department",
    label_th: "กรมสรรพสามิต (Excise) — พ.ร.บ. ภาษีสรรพสามิต พิกัดอัตราภาษี มาตรการ EV และแบตเตอรี่",
    label_en: "Excise — Excise Department (Excise Tax Act, Tariff Schedules & EV/Battery Measures)",
    drive_folder_id: "1r9buiqHavK-pOVDw3lnjuX-y5Gex_YAA",
    drive_folder_url: "https://drive.google.com/drive/folders/1r9buiqHavK-pOVDw3lnjuX-y5Gex_YAA",
    subfolders: [],
    count: 125,
  },
  {
    code: "DFT",
    collection: "DFT_Foreign_Trade",
    short_name: "DFT",
    folder_name: "DFT - Department of Foreign Trade",
    label_th: "กรมการค้าต่างประเทศ (DFT) — การส่งออก-นำเข้า ถิ่นกำเนิดสินค้า FTA และการตอบโต้การทุ่มตลาด (AD/CVD)",
    label_en: "DFT — Department of Foreign Trade (Export-Import Controls, Rules of Origin, FTA & AD/CVD)",
    drive_folder_id: "1XCcLJfgz1WLwfuGkGfju3ojvqAxWTUzL",
    drive_folder_url: "https://drive.google.com/drive/folders/1XCcLJfgz1WLwfuGkGfju3ojvqAxWTUzL",
    subfolders: [],
    count: 178,
  },
  {
    code: "DIP",
    collection: "DIP_Intellectual_Property",
    short_name: "DIP",
    folder_name: "DIP - Department of Intellectual Property",
    label_th: "กรมทรัพย์สินทางปัญญา (DIP) — สิทธิบัตร เครื่องหมายการค้า ลิขสิทธิ์ ความลับทางการค้า และ GI",
    label_en: "DIP — Department of Intellectual Property (Patents, Trademarks, Copyright, Trade Secrets & GI)",
    drive_folder_id: "16mP-VcR_RZl41JSyPb5O8nYk-1Uzr5wt",
    drive_folder_url: "https://drive.google.com/drive/folders/16mP-VcR_RZl41JSyPb5O8nYk-1Uzr5wt",
    subfolders: [],
    count: 280,
  },
  {
    code: "DITP",
    collection: "DITP_Trade_Promotion",
    short_name: "DITP",
    folder_name: "DITP - Department of International Trade Promotion",
    label_th: "กรมส่งเสริมการค้าระหว่างประเทศ (DITP) — SMEs Pro-active, Thailand Trust Mark และระเบียบอุดหนุนการค้า",
    label_en: "DITP — Department of International Trade Promotion (SME Pro-active & Export Promotion Rules)",
    drive_folder_id: "1J3v1MBMRJo6QTBnsv6-8TJYL2cR8Cn4U",
    drive_folder_url: "https://drive.google.com/drive/folders/1J3v1MBMRJo6QTBnsv6-8TJYL2cR8Cn4U",
    subfolders: [],
    count: 21,
  },
  {
    code: "TCCT",
    collection: "TCCT_Trade_Competition",
    short_name: "TCCT",
    folder_name: "TCCT - Trade Competition Commission of Thailand",
    label_th: "สำนักงานคณะกรรมการการแข่งขันทางการค้า (กขค. / TCCT) — ควบรวมธุรกิจ อำนาจเหนือตลาด Credit Term และคำวินิจฉัย",
    label_en: "TCCT — Trade Competition Commission of Thailand (Merger Control, Dominance, Credit Terms & Rulings)",
    drive_folder_id: "1qlvpJ75tLWBgBSR5Roo6_fI14w8n2MuP",
    drive_folder_url: "https://drive.google.com/drive/folders/1qlvpJ75tLWBgBSR5Roo6_fI14w8n2MuP",
    subfolders: [],
    count: 424,
  },
  {
    code: "BOT",
    collection: "BOT_Bank_of_Thailand",
    short_name: "BOT",
    folder_name: "BOT - Bank of Thailand",
    label_th: "ธนาคารแห่งประเทศไทย (ธปท. / BOT) — ควบคุมการแลกเปลี่ยนเงิน สถาบันการเงิน และระบบการชำระเงิน",
    label_en: "BOT — Bank of Thailand (Exchange Control, Financial Institutions & Payment Systems)",
    drive_folder_id: "1ogA-OJLKZZP4BQDGxzrZ2f_JDwwwNNQF",
    drive_folder_url: "https://drive.google.com/drive/folders/1ogA-OJLKZZP4BQDGxzrZ2f_JDwwwNNQF",
    subfolders: [],
    count: 69,
  },
  {
    code: "AMLO",
    collection: "AMLO_Anti_Money_Laundering",
    short_name: "AMLO",
    folder_name: "AMLO - Anti-Money Laundering Office",
    label_th: "สำนักงานป้องกันและปราบปรามการฟอกเงิน (ปปง. / AMLO) — กฎหมายฟอกเงิน KYC/CDD และรายงานธุรกรรม",
    label_en: "AMLO — Anti-Money Laundering Office (AML/CFT Act, KYC/CDD & Transaction Reporting)",
    drive_folder_id: "1v0A2tcjqs_xPnaff2FDy3hQQfbA01P3v",
    drive_folder_url: "https://drive.google.com/drive/folders/1v0A2tcjqs_xPnaff2FDy3hQQfbA01P3v",
    subfolders: [],
    count: 143,
  },
  {
    code: "HEALTH",
    collection: "Health_Public_Health_FDA",
    short_name: "Health",
    folder_name: "Health",
    label_th: "กฎหมายสาธารณสุข (Health) — พ.ร.บ. สถานพยาบาล โฆษณาอาหาร/ยา (อย.) แพทยสภา และ สปสช.",
    label_en: "Health — Healthcare Acts, Hospitals & Clinics, FDA Advertising, Medical Council & NHSO",
    drive_folder_id: "1yCcf--L1g11uRCqagTCjwdhdnh_C-piv",
    drive_folder_url: "https://drive.google.com/drive/folders/1yCcf--L1g11uRCqagTCjwdhdnh_C-piv",
    subfolders: [
      "Acts",
      "Hospitals & Clinics",
      "Advertising - Facilities",
      "Advertising - FDA products",
      "Medical Council",
      "NHSO",
      "Consumer Protection",
    ],
    count: 65,
  },
  {
    code: "DEKA",
    collection: "Deka_Supreme_Court_Database",
    short_name: "Deka Database",
    folder_name: "Deka Database",
    label_th: "ฐานข้อมูลคำพิพากษาศาลฎีกาและศาลชำนัญพิเศษ (Deka Database) — ฎีกาภาษีอากร พาณิชย์ ปกครอง และรัฐธรรมนูญ",
    label_en: "Deka Database — Supreme Court, Administrative, Tax, Specialized Appeal & Constitutional Courts",
    drive_folder_id: "1BpwNu1FmibYUDLtQ6PnEnt6OeogXAvDc",
    drive_folder_url: "https://drive.google.com/drive/folders/1BpwNu1FmibYUDLtQ6PnEnt6OeogXAvDc",
    subfolders: [
      "01_Supreme_Court_Deka",
      "02_Administrative_Court",
      "03_Tax_Court",
      "04_Specialized_Appeal_Court",
      "05_Constitutional_Court",
    ],
    count: 38,
  },
];

export const RESOURCE_MASTER_COLLECTIONS: Record<
  ResourceMasterCollectionId,
  {
    id: ResourceMasterCollectionId;
    label_th: string;
    label_en: string;
    drive_source: string;
    drive_url?: string;
    count: number;
    badge_color: string;
  }
> = {
  DBD_Business_Development: {
    id: "DBD_Business_Development",
    label_th: "DBD — กรมพัฒนาธุรกิจการค้า (113 ฉบับ)",
    label_en: "DBD — Department of Business Development (113 Files)",
    drive_source: "Legal Database Resource Master / DBD (1rzEBsNIfbHoB37J2Nt05E60EDEZaVkgM)",
    drive_url: "https://drive.google.com/drive/folders/1rzEBsNIfbHoB37J2Nt05E60EDEZaVkgM",
    count: 113,
    badge_color: "emerald",
  },
  SET_Stock_Exchange: {
    id: "SET_Stock_Exchange",
    label_th: "SET — ตลาดหลักทรัพย์แห่งประเทศไทย (41 ฉบับ)",
    label_en: "SET — Stock Exchange of Thailand (41 Files: Regulations, Notifications, Guidelines)",
    drive_source: "Legal Database Resource Master / SET (1gQhTyb9Sa3vRoCl7ybyW3pilfnT6jjH_)",
    drive_url: "https://drive.google.com/drive/folders/1gQhTyb9Sa3vRoCl7ybyW3pilfnT6jjH_",
    count: 41,
    badge_color: "cyan",
  },
  SEC_Securities_Exchange: {
    id: "SEC_Securities_Exchange",
    label_th: "SEC — สำนักงาน ก.ล.ต. (18 ฉบับ)",
    label_en: "SEC — Securities and Exchange Commission Thailand (18 Files)",
    drive_source: "Legal Database Resource Master / SEC (14GpOTTS7h8Fx9SyEOn8TYOTwNYhXbvJB)",
    drive_url: "https://drive.google.com/drive/folders/14GpOTTS7h8Fx9SyEOn8TYOTwNYhXbvJB",
    count: 18,
    badge_color: "indigo",
  },
  RD_Revenue_Department: {
    id: "RD_Revenue_Department",
    label_th: "RD — กรมสรรพากร: CIT, PIT, VAT, WHT, Pillar Two, Transfer Pricing (81 ฉบับ)",
    label_en: "RD — Revenue Department: CIT, PIT, VAT, WHT, Pillar Two, Transfer Pricing (81 Files)",
    drive_source: "Legal Database Resource Master / RD (1sJHpmTR1uEiEcFo3B0bVSfkX1P5HPsi6)",
    drive_url: "https://drive.google.com/drive/folders/1sJHpmTR1uEiEcFo3B0bVSfkX1P5HPsi6",
    count: 81,
    badge_color: "amber",
  },
  BOI_Board_of_Investment: {
    id: "BOI_Board_of_Investment",
    label_th: "BOI — สำนักงานคณะกรรมการส่งเสริมการลงทุน (124 ฉบับ)",
    label_en: "BOI — Board of Investment (124 Files)",
    drive_source: "Legal Database Resource Master / BOI (1O_y2gYVNmj4D9jB4ZI4aHc9a4XQeFlq5)",
    drive_url: "https://drive.google.com/drive/folders/1O_y2gYVNmj4D9jB4ZI4aHc9a4XQeFlq5",
    count: 124,
    badge_color: "violet",
  },
  ERC_Energy_Commission: {
    id: "ERC_Energy_Commission",
    label_th: "ERC — สำนักงานคณะกรรมการกำกับกิจการพลังงาน กกพ. (92 ฉบับ)",
    label_en: "ERC — Energy Regulatory Commission (92 Files)",
    drive_source: "Legal Database Resource Master / ERC (1DCCntM2MmZ3d8l8PB_cjMkiMZAv7GDAT)",
    drive_url: "https://drive.google.com/drive/folders/1DCCntM2MmZ3d8l8PB_cjMkiMZAv7GDAT",
    count: 92,
    badge_color: "teal",
  },
  DMF_Mineral_Fuels: {
    id: "DMF_Mineral_Fuels",
    label_th: "DMF — กรมเชื้อเพลิงธรรมชาติ (130 ฉบับ)",
    label_en: "DMF — Department of Mineral Fuels (130 Files)",
    drive_source: "Legal Database Resource Master / DMF (1jCDwAEoCWs7UspUJ99h4IHedRWX6s0y-)",
    drive_url: "https://drive.google.com/drive/folders/1jCDwAEoCWs7UspUJ99h4IHedRWX6s0y-",
    count: 130,
    badge_color: "amber",
  },
  Customs_Department: {
    id: "Customs_Department",
    label_th: "Customs — กรมศุลกากร (92 ฉบับ)",
    label_en: "Customs — Customs Department (92 Files)",
    drive_source: "Legal Database Resource Master / Customs (1BaWRZgpQbEl7hl8Xsh3vPXMZsDjXkgxv)",
    drive_url: "https://drive.google.com/drive/folders/1BaWRZgpQbEl7hl8Xsh3vPXMZsDjXkgxv",
    count: 92,
    badge_color: "cyan",
  },
  Excise_Department: {
    id: "Excise_Department",
    label_th: "Excise — กรมสรรพสามิต (125 ฉบับ)",
    label_en: "Excise — Excise Department (125 Files)",
    drive_source: "Legal Database Resource Master / Excise (1r9buiqHavK-pOVDw3lnjuX-y5Gex_YAA)",
    drive_url: "https://drive.google.com/drive/folders/1r9buiqHavK-pOVDw3lnjuX-y5Gex_YAA",
    count: 125,
    badge_color: "emerald",
  },
  DFT_Foreign_Trade: {
    id: "DFT_Foreign_Trade",
    label_th: "DFT — กรมการค้าต่างประเทศ (178 ฉบับ)",
    label_en: "DFT — Department of Foreign Trade (178 Files)",
    drive_source: "Legal Database Resource Master / DFT (1XCcLJfgz1WLwfuGkGfju3ojvqAxWTUzL)",
    drive_url: "https://drive.google.com/drive/folders/1XCcLJfgz1WLwfuGkGfju3ojvqAxWTUzL",
    count: 178,
    badge_color: "indigo",
  },
  DIP_Intellectual_Property: {
    id: "DIP_Intellectual_Property",
    label_th: "DIP — กรมทรัพย์สินทางปัญญา (280 ฉบับ)",
    label_en: "DIP — Department of Intellectual Property (280 Files)",
    drive_source: "Legal Database Resource Master / DIP (16mP-VcR_RZl41JSyPb5O8nYk-1Uzr5wt)",
    drive_url: "https://drive.google.com/drive/folders/16mP-VcR_RZl41JSyPb5O8nYk-1Uzr5wt",
    count: 280,
    badge_color: "violet",
  },
  DITP_Trade_Promotion: {
    id: "DITP_Trade_Promotion",
    label_th: "DITP — กรมส่งเสริมการค้าระหว่างประเทศ (21 ฉบับ)",
    label_en: "DITP — Department of International Trade Promotion (21 Files)",
    drive_source: "Legal Database Resource Master / DITP (1J3v1MBMRJo6QTBnsv6-8TJYL2cR8Cn4U)",
    drive_url: "https://drive.google.com/drive/folders/1J3v1MBMRJo6QTBnsv6-8TJYL2cR8Cn4U",
    count: 21,
    badge_color: "teal",
  },
  TCCT_Trade_Competition: {
    id: "TCCT_Trade_Competition",
    label_th: "TCCT — สำนักงานคณะกรรมการการแข่งขันทางการค้า กขค. (424 ฉบับ)",
    label_en: "TCCT — Trade Competition Commission of Thailand (424 Files)",
    drive_source: "Legal Database Resource Master / TCCT (1qlvpJ75tLWBgBSR5Roo6_fI14w8n2MuP)",
    drive_url: "https://drive.google.com/drive/folders/1qlvpJ75tLWBgBSR5Roo6_fI14w8n2MuP",
    count: 424,
    badge_color: "amber",
  },
  BOT_Bank_of_Thailand: {
    id: "BOT_Bank_of_Thailand",
    label_th: "BOT — ธนาคารแห่งประเทศไทย ธปท. (69 ฉบับ)",
    label_en: "BOT — Bank of Thailand (69 Files)",
    drive_source: "Legal Database Resource Master / BOT (1ogA-OJLKZZP4BQDGxzrZ2f_JDwwwNNQF)",
    drive_url: "https://drive.google.com/drive/folders/1ogA-OJLKZZP4BQDGxzrZ2f_JDwwwNNQF",
    count: 69,
    badge_color: "cyan",
  },
  AMLO_Anti_Money_Laundering: {
    id: "AMLO_Anti_Money_Laundering",
    label_th: "AMLO — สำนักงานป้องกันและปราบปรามการฟอกเงิน ปปง. (143 ฉบับ)",
    label_en: "AMLO — Anti-Money Laundering Office (143 Files)",
    drive_source: "Legal Database Resource Master / AMLO (1v0A2tcjqs_xPnaff2FDy3hQQfbA01P3v)",
    drive_url: "https://drive.google.com/drive/folders/1v0A2tcjqs_xPnaff2FDy3hQQfbA01P3v",
    count: 143,
    badge_color: "emerald",
  },
  Health_Public_Health_FDA: {
    id: "Health_Public_Health_FDA",
    label_th: "Health — กฎหมายสาธารณสุข อย. สถานพยาบาล แพทยสภา และ สปสช. (65 ฉบับ)",
    label_en: "Health — Public Health, Hospitals, FDA Advertising, Medical Council & NHSO (65 Files)",
    drive_source: "Legal Database Resource Master / Health (1yCcf--L1g11uRCqagTCjwdhdnh_C-piv)",
    drive_url: "https://drive.google.com/drive/folders/1yCcf--L1g11uRCqagTCjwdhdnh_C-piv",
    count: 65,
    badge_color: "teal",
  },
  Deka_Supreme_Court_Database: {
    id: "Deka_Supreme_Court_Database",
    label_th: "Deka Database — คำพิพากษาศาลฎีกาและศาลชำนัญพิเศษ (38 ฉบับ)",
    label_en: "Deka Database — Supreme Court, Tax, Administrative & Constitutional Rulings (38 Files)",
    drive_source: "Legal Database Resource Master / Deka Database (1BpwNu1FmibYUDLtQ6PnEnt6OeogXAvDc)",
    drive_url: "https://drive.google.com/drive/folders/1BpwNu1FmibYUDLtQ6PnEnt6OeogXAvDc",
    count: 38,
    badge_color: "indigo",
  },
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
  Legal_Forms_Master_Catalog: {
    id: "Legal_Forms_Master_Catalog",
    label_th: "คลังแบบฟอร์มศาลและส่วนราชการมาตรฐาน (553 แบบฟอร์มหลัก + 19 ไฟล์ประกอบ = 572 ไฟล์ | เฉพาะใช้ภายในองค์กร)",
    label_en: "Legal Forms Master Catalog — 553 Canonical Forms (L FORM 2024 V.4.1 | Internal Own-Use Only)",
    drive_source: "Legal Database Resource Master / Legal Forms (1jNJtHzWoJfGZdDqHzPbuZshNzbOwk-or)",
    drive_url: "https://drive.google.com/drive/folders/1jNJtHzWoJfGZdDqHzPbuZshNzbOwk-or",
    count: 572,
    badge_color: "amber",
  },
};

function convertCatalogFormToResourceRecord(form: LegalFormsCatalogRecord): LegalResourceMasterRecord {
  const indexTag = form.form_index_code ? `[${form.form_index_code}] ` : "";
  const fieldsStr =
    form.fillable_fields && form.fillable_fields.length > 0
      ? ` | ช่องกรอกข้อมูล: ${form.fillable_fields.join(", ")}`
      : "";
  const bodySnippet = form.extracted_form_text
    ? ` | ข้อความในแบบฟอร์ม: ${form.extracted_form_text.slice(0, 360)}`
    : "";
  return {
    id: form.id,
    code: form.form_index_code || form.code,
    collection: "Legal_Forms_Master_Catalog",
    authority_code: form.category_code,
    folder_path: form.folder_path,
    drive_stable_id: form.drive_file_id,
    drive_url: form.drive_url,
    title_th: `${indexTag}[${form.category_folder}] ${form.title}`,
    title_en: `${indexTag}[${form.category_code}] ${form.title} (${form.category_description_en})`,
    regulator: form.authority_th,
    instrument_type: form.is_canonical_553_form
      ? `Canonical Legal Form #${form.form_index_number}/553 (.${form.file_extension} — Own-Use Only)`
      : form.is_court_or_agency_form
        ? `Official Court/Agency Form (.${form.file_extension})`
        : `L FORM Resource (.${form.file_extension})`,
    year_be: 2567,
    effective_date: "2024-01-01",
    status: "IN_FORCE",
    legal_provisions: `${form.category_description_en} — ${form.version_package} (Strict Layout Lock: ${form.strict_layout_lock ? "YES" : "NO"} | License: INTERNAL_OWN_USE_ONLY)`,
    summary_th: `แบบฟอร์มราชการและศาล (${form.version_package}) หมวด ${form.category_folder} (${form.authority_th}): ${form.title}${fieldsStr}. [อนุญาตให้ใช้งานเฉพาะภายในองค์กร ห้ามเผยแพร่ภายนอก]`,
    verbatim_excerpt: `Source: ${form.folder_path} | Index: ${form.form_index_code || "AUX"} | Category: ${form.authority_th} | License: INTERNAL_OWN_USE_ONLY (External Sharing Prohibited)${bodySnippet} | Google Drive ID: ${form.drive_file_id}`,
    file_name: form.file_name,
    file_size_bytes: form.file_size_bytes,
    sha256: form.sha256,
  };
}

export function searchLegalFormsMasterCatalog(options?: {
  query?: string;
  category_code?: string;
  only_official_forms?: boolean;
  only_canonical_553?: boolean;
  limit?: number;
  offset?: number;
}): {
  total_catalog_files: number;
  canonical_553_forms_count: number;
  official_forms_count: number;
  matched_count: number;
  drive_folder_url: string;
  index_sheet_url: string;
  license_policy: {
    scope: "INTERNAL_OWN_USE_ONLY";
    external_sharing_prohibited: true;
    notice_th: string;
    notice_en: string;
  };
  categories: Array<{
    category_code: string;
    category_folder: string;
    authority_th: string;
    category_description_en: string;
    count: number;
  }>;
  results: LegalFormsCatalogRecord[];
} {
  const queryRaw = (options?.query || "").trim().toLowerCase();
  const terms = queryRaw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const categoryFilter = (options?.category_code || "").trim().toUpperCase();
  const onlyOfficial = options?.only_official_forms ?? false;
  const onlyCanonical553 = options?.only_canonical_553 ?? false;
  const limit = Math.min(Math.max(options?.limit ?? 60, 1), 600);
  const offset = Math.max(options?.offset ?? 0, 0);

  const pool = onlyCanonical553 ? CANONICAL_553_LEGAL_FORMS : LEGAL_FORMS_MASTER_CATALOG;

  const catMap = new Map<
    string,
    {
      category_code: string;
      category_folder: string;
      authority_th: string;
      category_description_en: string;
      count: number;
    }
  >();

  for (const r of pool) {
    const existing = catMap.get(r.category_code);
    if (existing) {
      existing.count += 1;
    } else {
      catMap.set(r.category_code, {
        category_code: r.category_code,
        category_folder: r.category_folder,
        authority_th: r.authority_th,
        category_description_en: r.category_description_en,
        count: 1,
      });
    }
  }

  let filtered = pool.filter((item) => {
    if (onlyOfficial && !item.is_court_or_agency_form) return false;
    if (
      categoryFilter &&
      categoryFilter !== "ALL" &&
      item.category_code.toUpperCase() !== categoryFilter &&
      item.category_folder.toUpperCase() !== categoryFilter
    ) {
      return false;
    }
    return true;
  });

  if (terms.length > 0) {
    filtered = filtered.filter((item) => {
      const hay = [
        item.id,
        item.code,
        item.form_index_code || "",
        item.thai_form_code || "",
        item.category_code,
        item.category_folder,
        item.authority_th,
        item.category_description_en,
        item.title,
        item.folder_path,
        item.extracted_form_text || "",
        (item.fillable_fields || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  return {
    total_catalog_files: LEGAL_FORMS_MASTER_CATALOG.length,
    canonical_553_forms_count: CANONICAL_553_LEGAL_FORMS.length,
    official_forms_count: LEGAL_FORMS_MASTER_CATALOG.filter((r) => r.is_court_or_agency_form).length,
    matched_count: filtered.length,
    drive_folder_url: LEGAL_FORMS_DRIVE_FOLDER_URL,
    index_sheet_url: LEGAL_FORMS_INDEX_SHEET_URL,
    license_policy: {
      scope: "INTERNAL_OWN_USE_ONLY",
      external_sharing_prohibited: true,
      notice_th:
        "แบบฟอร์มทั้ง 553 รายการได้รับอนุญาตให้ใช้งานเฉพาะภายในองค์กรของผู้ถือสิทธิ์เท่านั้น ห้ามเผยแพร่หรือส่งต่อภายนอก",
      notice_en:
        "All 553 legal forms are licensed for your internal own-use only. External sharing or redistribution is prohibited.",
    },
    categories: Array.from(catMap.values()).sort((a, b) => b.count - a.count),
    results: filtered.slice(offset, offset + limit),
  };
}

export function searchLegalResourceMaster(options?: {
  query?: string;
  collection?: ResourceMasterCollectionId | "ALL";
  authority_code?: string;
  regulator?: string;
  year_be?: number;
  limit?: number;
  offset?: number;
}): {
  total_corpus_count: number;
  matched_count: number;
  master_drive_folder_url: string;
  authority_folders: MasterAuthorityFolderMeta[];
  collections: typeof RESOURCE_MASTER_COLLECTIONS;
  collection_breakdown: Record<string, number>;
  results: LegalResourceMasterRecord[];
} {
  const queryRaw = (options?.query || "").trim().toLowerCase();
  const terms = queryRaw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const collectionFilter =
    options?.collection && options.collection !== "ALL" ? options.collection : undefined;
  const authorityCodeFilter = (options?.authority_code || "").trim().toUpperCase();
  const regulatorFilter = (options?.regulator || "").trim().toLowerCase();
  const yearFilter = options?.year_be;
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500);
  const offset = Math.max(options?.offset ?? 0, 0);

  const collectionBreakdown: Record<string, number> = {};
  for (const item of LEGAL_RESOURCE_MASTER_CORPUS) {
    collectionBreakdown[item.collection] = (collectionBreakdown[item.collection] || 0) + 1;
  }
  collectionBreakdown["Legal_Forms_Master_Catalog"] = LEGAL_FORMS_MASTER_CATALOG.length;

  const combinedSourcePool: LegalResourceMasterRecord[] =
    collectionFilter === "Legal_Forms_Master_Catalog" || authorityCodeFilter === "LFORM"
      ? LEGAL_FORMS_MASTER_CATALOG.map(convertCatalogFormToResourceRecord)
      : LEGAL_RESOURCE_MASTER_CORPUS;

  let filtered = combinedSourcePool.filter((item) => {
    if (collectionFilter && item.collection !== collectionFilter) {
      return false;
    }
    if (
      authorityCodeFilter &&
      authorityCodeFilter !== "ALL" &&
      authorityCodeFilter !== "LFORM" &&
      (item.authority_code || "").toUpperCase() !== authorityCodeFilter
    ) {
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
          item.authority_code || "",
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
          if (
            item.code.toLowerCase().includes(term) ||
            item.id.toLowerCase().includes(term) ||
            (item.authority_code || "").toLowerCase() === term
          ) {
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
    master_drive_folder_url: MASTER_DRIVE_FOLDER_URL,
    authority_folders: MASTER_AUTHORITY_FOLDERS,
    collections: RESOURCE_MASTER_COLLECTIONS,
    collection_breakdown: collectionBreakdown,
    results: filtered.slice(offset, offset + limit),
  };
}

export function getLegalResourceMasterById(idOrCode: string): LegalResourceMasterRecord | undefined {
  const norm = idOrCode.trim().toLowerCase();
  const primary = LEGAL_RESOURCE_MASTER_CORPUS.find(
    (r) => r.id.toLowerCase() === norm || r.code.toLowerCase() === norm
  );
  if (primary) return primary;
  const formMatch = LEGAL_FORMS_MASTER_CATALOG.find(
    (f) =>
      f.id.toLowerCase() === norm ||
      f.code.toLowerCase() === norm ||
      (f.form_index_code || "").toLowerCase() === norm
  );
  return formMatch ? convertCatalogFormToResourceRecord(formMatch) : undefined;
}
