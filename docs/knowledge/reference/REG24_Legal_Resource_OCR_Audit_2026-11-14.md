# REG24 Legal Resource OCR Readiness Audit

Audit date: 14 November 2026 (Asia/Bangkok).

Source: [Legal Database Resource Master](https://drive.google.com/drive/folders/1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm).

## Conclusion

This collection is mixed, not predominantly straightforward text extraction. In a reproducible random sample of 120 PDFs, 52 (43.3%) were candidates for direct extraction with cleanup, 7 (5.8%) required legacy font/symbol repair, 20 (16.7%) had seriously corrupted extracted text, 33 (27.5%) had no usable text, and 8 (6.7%) needed page-level review or mixed-page processing. Repair can reduce OCR demand; corrupted text is not automatically a requirement to OCR every page.

## Inventory measured from Drive metadata

| Metric | Measured result |
|---|---:|
| Main folders | 88 |
| Descendant folders traversed | 534 |
| Unique Drive files | 56,064 |
| Total reported file size | 41.2509 GB |
| PDF files | 54,072 (96.45% of files) |
| PDF size | 33.8328 GB |
| Other files | 1,992 |
| Other file size | 7.4181 GB |

GB and MB are decimal. These are physical file counts, not unique legal instruments or judgments. Archives may contain many documents and superseded datasets may duplicate material. Native Google file sizes are metadata sizes, not guaranteed exported sizes. No content deduplication was performed. All folder listings were traversed; 10 folders reaching the 1,000-item listing limit were additionally paginated through search. Their subfolders were checked separately. No listing errors remained.

## Random PDF sample

Population: 54,072 PDFs. Sample: 120 PDFs without replacement, shuffled from sorted Drive IDs using deterministic seed 20261114. Every sampled PDF was downloaded and all 914 pages were inspected programmatically with PyMuPDF for text quantity, unusual characters and image coverage. Extracted-text previews were reviewed to distinguish readable Thai from garbled text. Two illustrative pages were rendered for visual checks. Poppler pdftotext independently reproduced broken extraction on one TISI example. No OCR model was run and this was not a human transcription accuracy benchmark.

| Routing category | Files | Sample share | Sample file size, MB | Pages in those files |
|---|---:|---:|---:|---:|
| Direct extraction with cleanup | 52 | 43.3% | 8.33 | 215 |
| Legacy font/symbol repair | 7 | 5.8% | 1.77 | 49 |
| Corrupted text: repair or OCR | 20 | 16.7% | 3.45 | 65 |
| No usable text: OCR | 33 | 27.5% | 12.06 | 170 |
| Mixed pages/review | 8 | 6.7% | 21.34 | 415 |

The page column is the total pages in files assigned to each routing category, not the number of pages proven to require OCR. Mixed files include a 388-page parliamentary document and strongly skew the page and byte totals. Sample-wide image-only detection identified 353 pages, including pages within mixed documents. Blank pages, covers and image coverage need human-aware routing rather than automatic OCR billing.

### What can be estimated

- Approximately half of PDF files may be handled through direct extraction plus font/text repair; the other half needs OCR, more substantial recovery or page-level review.
- The 33/120 no-usable-text result suggests roughly 15,000 PDFs in that route if the sample generalizes. The 20/120 corruption result suggests roughly 9,000 additional PDFs requiring font recovery or OCR. These are planning estimates, not counted production backlogs.
- Sampling uncertainty is material: the 27.5% no-usable-text share has an approximate 95% Wilson interval of 20.3%-36.1%, before classification and population issues. The 43.3% direct-extraction share has an approximate interval of 34.8%-52.3%.
- An exact corpus-wide OCR GB or page total is NOT established. Do not multiply the file percentages by 33.83 GB: document sizes differ greatly. Archives were not unpacked, and the largest books were not all sampled.

## Specific findings

- Revenue Department: 9 of 10 sampled PDFs were readable extraction candidates; several visibly originated from HTML rendered to PDF. One was corrupt. This is encouraging for the sampled RD rulings, not proof that all RD files are clean.
- Council of State Opinions: 13 of 17 sampled PDFs were readable candidates and 4 needed page review. Some extracted passages repeat words or line fragments; coordinate-aware extraction and duplicate-text cleanup are needed before legal retrieval.
- TISI: 11 of 13 sampled files had corrupted text, 1 had no usable text and 1 was readable. A PDF can look perfectly clear on screen while extraction yields substitutions such as Ö, @ and Latin characters. Try verified font recovery; otherwise use OCR on affected pages.
- BOT: 6 of 11 sampled files had no usable text, 1 had corrupted text, 1 needed legacy-font repair and 3 were readable.
- Primary Law: 8 of 10 sampled files had no usable text. SEC: 6 of 10 had no usable text, 1 was corrupt and 3 were readable. These small folder samples are directional, not reliable standalone folder percentages.
- Deka Database is 5.465 GB but only 71.0 MB is standalone PDFs. Much consists of TXT corpora, ZIPs, GZIP indexes and related versions. One small TXT corpus was read and contained Thai judgment text and source metadata. Text files do not require OCR, but archive contents, completeness and duplicate/superseded versions still require validation.

## Large-document checks

Ten larger PDFs were deliberately selected as a separate, nonrandom check. Eight were available for inspection; two downloads did not complete and are not classified. Targeted checks are excluded from the 120-file percentages. Five documents were then checked on every page and had no embedded text at all: 923 pages and approximately 292 MB combined.

| Document | Folder | MB | Pages | Observed result |
|---|---|---:|---:|---|
| [คู่มือ การดำเนินคดีภาษีอากร.pdf](https://drive.google.com/file/d/1_HGTTie0Kfin8HFB7pVhPEeZvuzyce2L/view) | Law Books | 96.93 | 404 | All 404 pages have no embedded text |
| [ภาระภาษีและการวางแผนภาษี ในการประกอบธุรกิจ เทคโนโลยีดิจิทัล.pdf](https://drive.google.com/file/d/11MYYN3i8sxcb_jHij0i5dIF3NQO4mUdB/view) | Law Books | 80.19 | 292 | All 292 pages have no embedded text |
| [พิกัด ภาษี เรือ โรง ร้าน ตึก แพ.pdf](https://drive.google.com/file/d/1TuF3u5-sJ41ccuoB7xAoOPm5vSxtXDNq/view) | Thai law book | 89.27 | — | Download incomplete; not classified |
| [ทฤษฎีภาษีและทางปฏิบัติ_บุญชนะ อัตถากร_2500.pdf](https://drive.google.com/file/d/15-MW0j0yryBeNnYR7V4InGgQ9MtwPW4w/view) | Thai law book | 66.75 | 160 | All 160 pages have no embedded text |
| [NIDA_08f3b592.pdf](https://drive.google.com/file/d/1Mb2LvOAo49wEpPUy9jAmyjGHKCHV6r6v/view) | Law Thesis Library | 75.26 | 446 | Five spaced pages inspected; mixed or corrupt text; see audit notes |
| [AU_b0b8be6c.pdf](https://drive.google.com/file/d/17C8UT_nnMi16xvotT_9gEbxfPy7B_A-e/view) | Law Thesis Library | 68.39 | 164 | Five spaced pages inspected; mixed or corrupt text; see audit notes |
| [2004-06-25_CCRuling_37-2546_RG2004-000164_downsampled.pdf](https://drive.google.com/file/d/1xJ-Kq5ncNy14kQC-5gf5ZEtFyCC6YglI/view) | Constitutional Court | 10.48 | 111 | Five spaced pages inspected; mixed or corrupt text; see audit notes |
| [1998-08-03_CCRuling_3-2541_RG1998-001593.pdf](https://drive.google.com/file/d/1KqwUuO3WeB_DZgSTxoJ8jYv2h7Bo5xv4/view) | Constitutional Court | 4.25 | — | Download incomplete; not classified |
| [admc-01012-651156-1f-690903-0000848978.pdf](https://drive.google.com/file/d/1_HSHlUqGiZw2Wli-1cxwgVLUhqgKzyQd/view) | Deka Database | 31.61 | 35 | All 35 pages have no embedded text |
| [admc-01012-671795-1f-690903-0000849021.pdf](https://drive.google.com/file/d/1Bw9JqDR0pOHQauiBjAmLzyhD9eDIUY1s/view) | Deka Database | 16.48 | 32 | All 32 pages have no embedded text |

The NIDA thesis had readable Thai on several inspected pages and a nearly textless page. The AU thesis produced badly corrupted output on inspected body pages. The 111-page Constitutional Court PDF had both no-text pages and corrupt encoded text. These checks show why file size alone cannot determine OCR need.

## Recommended ingestion route for REG24

1. Identify real file format, unpack archives in a controlled staging area and deduplicate by content hash and legal-document identity before spending on OCR.
2. Extract embedded text page by page. Validate actual Thai content, dates, section numbers and text order; do not accept a document merely because extraction returned characters.
3. Repair known legacy font mappings, duplicate spans and Thai combining characters where deterministic recovery can be verified against the rendered source.
4. OCR only pages failing those checks or containing scans/text rendered as shapes. Preserve good extracted pages and combine outputs with page provenance.
5. Compare critical citations, dates, amounts and legal section numbers against the page image; quarantine uncertain output before creating GraphRAG nodes and edges.
6. Produce a full page manifest with file ID, hash, page count, source bytes, route and quality flags. Sum OCR pages after deduplication to establish a defensible OCR cost and completion-time estimate.

## Full top-level folder inventory

| Folder | Files | Total GB | PDFs | PDF GB |
|---|---:|---:|---:|---:|
| BOT - Bank of Thailand | 6,920 | 5.5436 | 6,912 | 5.5429 |
| Deka Database | 274 | 5.4649 | 14 | 0.0710 |
| Council of State Opinions | 7,528 | 2.5014 | 7,524 | 2.4999 |
| Construction Regulations | 1,849 | 1.5606 | 1,838 | 1.5597 |
| Primary Law | 5,737 | 1.5521 | 5,733 | 1.5504 |
| MD Regulations | 931 | 1.4770 | 930 | 1.4769 |
| Law Books | 10 | 1.4645 | 9 | 1.4645 |
| Constitutional Court | 92 | 1.3835 | 46 | 0.0418 |
| OIC - Office of Insurance Commission | 1,371 | 1.3598 | 1,367 | 1.3597 |
| DIT - Department of Internal Trade | 797 | 1.1010 | 796 | 1.1009 |
| Excise - Excise Department | 670 | 1.0536 | 667 | 1.0535 |
| Law Thesis Library | 114 | 0.9980 | 113 | 0.9980 |
| Thai law book | 149 | 0.9644 | 148 | 0.9644 |
| Legal Forms | 1,657 | 0.7928 | 873 | 0.3945 |
| DEDE & EPPO Regulations | 413 | 0.6690 | 410 | 0.6689 |
| NHRC Regulations | 267 | 0.6338 | 266 | 0.6337 |
| DFT - Department of Foreign Trade | 643 | 0.6168 | 624 | 0.6148 |
| CGD Regulations | 362 | 0.5935 | 353 | 0.5887 |
| Ombudsman Regulations | 149 | 0.5758 | 146 | 0.5756 |
| Labor & Social Regulations | 1,190 | 0.5010 | 1,165 | 0.4995 |
| Environment Regulations | 567 | 0.4722 | 561 | 0.4721 |
| DLT Regulations | 861 | 0.4384 | 859 | 0.4383 |
| RD - Revenue Department | 5,150 | 0.4381 | 5,143 | 0.4374 |
| Advisory Back Up Doc | 916 | 0.4277 | 368 | 0.2859 |
| SEC - Securities and Exchange Commission Thailand | 1,753 | 0.4268 | 1,749 | 0.4265 |
| DIP - Department of Intellectual Property | 431 | 0.4032 | 417 | 0.4029 |
| DOEB | 537 | 0.3643 | 535 | 0.3643 |
| LED Regulations | 302 | 0.3389 | 299 | 0.3388 |
| FDA Regulations | 991 | 0.3258 | 989 | 0.3257 |
| SET - Stock Exchange of Thailand | 760 | 0.3240 | 742 | 0.3106 |
| DOE - Department of Employment | 553 | 0.3112 | 551 | 0.3111 |
| IEAT - Industrial Estate Authority of Thailand | 85 | 0.2999 | 84 | 0.2999 |
| TISI Regulations | 2,506 | 0.2806 | 2,505 | 0.2803 |
| Customs - Customs Department | 143 | 0.2759 | 135 | 0.2602 |
| Cabinet Resolutions | 144 | 0.2711 | 123 | 0.2019 |
| NBTC | 409 | 0.2707 | 406 | 0.2706 |
| Parliament | 40 | 0.2703 | 39 | 0.2703 |
| DBD - Department of Business Development | 424 | 0.2627 | 419 | 0.2625 |
| TCCT - Trade Competition Commission of Thailand | 480 | 0.2588 | 477 | 0.2587 |
| PDPC Regulations | 276 | 0.2545 | 275 | 0.2545 |
| Public Administration Regulations | 748 | 0.2482 | 728 | 0.2464 |
| Treasury & SEPO Regulations | 141 | 0.2054 | 140 | 0.2053 |
| MOPH Other Regulations | 725 | 0.2018 | 724 | 0.2018 |
| ERC - Energy Regulatory Commission | 297 | 0.1997 | 294 | 0.1996 |
| NCSA | 75 | 0.1815 | 74 | 0.1815 |
| AMLO - Anti-Money Laundering Office | 206 | 0.1775 | 191 | 0.1669 |
| Energy Transition Law | 57 | 0.1629 | 55 | 0.1628 |
| BOI - Board of Investment | 321 | 0.1401 | 316 | 0.1399 |
| DPIM Regulations | 215 | 0.1371 | 212 | 0.1368 |
| Health | 203 | 0.1335 | 199 | 0.1334 |
| ETDA Regulations | 229 | 0.1228 | 207 | 0.1138 |
| Roads & Rail Regulations | 182 | 0.1013 | 181 | 0.1012 |
| DOH Health Regulations | 67 | 0.0998 | 66 | 0.0998 |
| EEC Regulations | 88 | 0.0997 | 87 | 0.0996 |
| Carbon & Climate Regulations | 32 | 0.0993 | 31 | 0.0993 |
| DOPA & DDPM Regulations | 136 | 0.0993 | 135 | 0.0993 |
| ECT Regulations | 359 | 0.0968 | 358 | 0.0967 |
| Thai Bar - เนติบัณฑิตยสภา | 44 | 0.0899 | 43 | 0.0899 |
| DMF - Department of Mineral Fuels | 157 | 0.0874 | 154 | 0.0873 |
| Justice & Courts Regulations | 410 | 0.0836 | 407 | 0.0836 |
| Legal Articles Library | 73 | 0.0829 | 69 | 0.0791 |
| OAP Regulations | 192 | 0.0764 | 191 | 0.0764 |
| Aviation Regulation | 175 | 0.0763 | 173 | 0.0762 |
| CPD Cooperatives Regulations | 87 | 0.0722 | 86 | 0.0721 |
| Education & Culture Regulations | 248 | 0.0692 | 242 | 0.0691 |
| OCPB Regulations | 137 | 0.0659 | 133 | 0.0655 |
| OIE Regulations | 51 | 0.0519 | 49 | 0.0519 |
| Security & Foreign Affairs Regulations | 229 | 0.0501 | 227 | 0.0500 |
| Attorney General Regulations | 211 | 0.0490 | 210 | 0.0490 |
| OCSB Regulations | 223 | 0.0439 | 222 | 0.0439 |
| DDC Regulations | 232 | 0.0421 | 231 | 0.0421 |
| DITP - Department of International Trade Promotion | 44 | 0.0404 | 43 | 0.0404 |
| State Audit Office (OAG) | 146 | 0.0364 | 145 | 0.0363 |
| DPA Regulations | 47 | 0.0279 | 46 | 0.0279 |
| NACC Regulations | 185 | 0.0252 | 184 | 0.0252 |
| Agriculture Regulations | 135 | 0.0235 | 133 | 0.0235 |
| PDMO Regulations | 94 | 0.0214 | 93 | 0.0214 |
| FPO Regulations | 75 | 0.0168 | 74 | 0.0168 |
| DIPROM Regulations | 49 | 0.0157 | 48 | 0.0157 |
| HSS Regulations | 74 | 0.0155 | 68 | 0.0154 |
| Misc Royal Decrees | 61 | 0.0151 | 50 | 0.0147 |
| AI & Platform Law | 7 | 0.0151 | 6 | 0.0151 |
| Cross-Border Data & Cloud | 7 | 0.0090 | 6 | 0.0089 |
| Council of State (กฤษฎีกา) | 61 | 0.0057 | 60 | 0.0057 |
| Space Law | 18 | 0.0049 | 17 | 0.0049 |
| DIW Regulations | 15 | 0.0048 | 14 | 0.0048 |
| Misc Gazette | 41 | 0.0037 | 40 | 0.0037 |
| Bond Default Forensics | 2 | 0.0001 | 0 | 0.0000 |
| (root) | 2 | 0.0000 | 0 | 0.0000 |

## Random-sample evidence manifest

Direct extraction means a candidate for extraction plus cleanup, not a legal-accuracy certification. Classification is a triage assessment from programmatic page checks and text-preview review.

| # | File | Folder | MB | Pages | Route |
|---|---|---|---:|---:|---|
| 1 | [2011-06-10_CMSBNotification_ทจ.12-2554_หลักเกณฑ์ เงื่อนไข และวิธีการในการเข้าถื.pdf](https://drive.google.com/file/d/12JHLUDGiBSp8HEgPTO-rbm8V-Vj_tUi7/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.232 | 29 | Direct extraction with cleanup |
| 2 | [OCS_Opinion_2513-0034.pdf](https://drive.google.com/file/d/1WGSrnyqoexT7rfNfD0DH_DiuGoqpWVr4/view?usp=drivesdk) | Council of State Opinions | 0.122 | 2 | Direct extraction with cleanup |
| 3 | [2018-07-26_DGNotification_General7_dgrule7.pdf](https://drive.google.com/file/d/1srN9uDT7-VTbClaIEC58hgqeAU-Xh7eH/view?usp=drivesdk) | RD - Revenue Department | 0.101 | 2 | Direct extraction with cleanup |
| 4 | [2025-03-27_Notification_BE2567-63360_น้ำพริกแกง-พ.ศ.-2567.pdf](https://drive.google.com/file/d/1q9-Dng9OBLSB8Nrobey16avPcwXVz3es/view?usp=drivesdk) | TISI Regulations | 0.093 | 2 | Corrupted text: repair or OCR |
| 5 | [2025-04-01_Notification_BE2568-65408_นาโนเทคโนโลยี---การประเมินประสิทธิภาพของสารแขวนลอยนาโนท.pdf](https://drive.google.com/file/d/1HgBKGiDDOhuYvtxw3lyCD5Qx08Nks9tl/view?usp=drivesdk) | TISI Regulations | 0.077 | 2 | Corrupted text: repair or OCR |
| 6 | [2026-07-15_SECOfficeNotification_สน.7-2569_หลักเกณฑ์ เงื่อนไข และวิธีการจัดการกองทุนส่วนบุคคลที่มิใช่กอ.pdf](https://drive.google.com/file/d/1Z8fhACWbjKA1cV6QI-2Dc6Pxe5X8n9-P/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.425 | 21 | Corrupted text: repair or OCR |
| 7 | [2022-12-01_Order_140-2565_Appointment-Consumer-Committee-CPK-Zone-4.pdf](https://drive.google.com/file/d/1K-ELBqZeK0w8jyBhvuMP0VzlK55k62lk/view?usp=drivesdk) | ERC - Energy Regulatory Commission | 0.392 | 2 | No usable text: OCR |
| 8 | [2015-00-00_ETCNotification_มธอ.3-2558_ประกาศคณะกรรมการธุรกรรมทางอิเล็กทรอนิกส์_เรื่อง_มาตรฐานรหัสประเทศ_(CODE_FOR_COUNTRIES)_-_มธอ._3-2558.pdf](https://drive.google.com/file/d/1XURzhhkF67-efHJNM9T_XLrgwalycGOc/view?usp=drivesdk) | ETDA Regulations | 0.405 | 12 | Direct extraction with cleanup |
| 9 | [2006-11-15_SECBoardNotification_กจ.36-2549_การเสนอขายใบแสดงสิทธิในผลประโยชน์ที่เกิดจากหลักทรั.pdf](https://drive.google.com/file/d/1qVmhN0-oHd256PaggQM1M1uEnrwZukVS/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.057 | 1 | No usable text: OCR |
| 10 | [2023-01-23_Notification_RG140-5ก-p14_เรื่อง_หลักเกณฑ์และวิธีการประเมินและคัดเลือกบุคคลและผลงานเพื่อเลื่.pdf](https://drive.google.com/file/d/1gFhvGs_G1_Bo9_vEZWZOB7N074RY9Yr_/view?usp=drivesdk) | NACC Regulations | 0.069 | 2 | Direct extraction with cleanup |
| 11 | [ภ.ง.ด. 51 รอบฯ ปี 2568.pdf](https://drive.google.com/file/d/1UBKFkVyObbYLNFI36Ej22fPO1ejj7tPZ/view?usp=drivesdk) | Legal Forms | 1.081 | 2 | Direct extraction with cleanup |
| 12 | [2025-07-08_Notification_BE2568-74695_เครน---หลักการออกแบบสำหรับภาระและการรวมภาระ-เล่ม-2-เครนแบ.pdf](https://drive.google.com/file/d/1To4LyAKX1Z8x7-5B8LtL6fmCWPNi0ZSV/view?usp=drivesdk) | TISI Regulations | 0.077 | 2 | Corrupted text: repair or OCR |
| 13 | [OCS_Opinion_2547-0438.pdf](https://drive.google.com/file/d/1T_b-nz8F5WAmse_NA2SJjMwpkDg9UOTZ/view?usp=drivesdk) | Council of State Opinions | 0.179 | 3 | Direct extraction with cleanup |
| 14 | [1117784.pdf](https://drive.google.com/file/d/1lRew1hE0h7D3tGU2Nwps4eUYqmNXjN5R/view?usp=drivesdk) | Primary Law | 0.043 | 3 | No usable text: OCR |
| 15 | [2026-00-00_DBD Notification_2569_กำหนดแบบพิมพ์การให้บริการข้อมูลธุรกิจ.pdf](https://drive.google.com/file/d/1-nGpudV342fy0PFCvQlCiKzC37JnrsBq/view?usp=drivesdk) | DBD - Department of Business Development | 1.452 | 3 | No usable text: OCR |
| 16 | [2025-08-27_Notification_BE2568-81202_เทคโนโลยีสารสนเทศ---ศูนย์ข้อมูล---แนวทางปฏิบัติสำหรับศูนย.pdf](https://drive.google.com/file/d/15UfNZdB63BVsG71_NGiBPMpXtyoNwXay/view?usp=drivesdk) | TISI Regulations | 0.089 | 3 | Corrupted text: repair or OCR |
| 17 | [OCS_Opinion_2485-0127.pdf](https://drive.google.com/file/d/1xjUzYn293SOkSDhixNuPXAf86YN88Vcp/view?usp=drivesdk) | Council of State Opinions | 0.154 | 2 | Direct extraction with cleanup |
| 18 | [2022-06_ประกาศ_FastTrack_สิทธิบัตร_มิถุนายน2022.pdf](https://drive.google.com/file/d/1Wjy6kaeMxgPOg3QRpkftHd7CB3A0l_9P/view?usp=drivesdk) | DIP - Department of Intellectual Property | 0.375 | 1 | No usable text: OCR |
| 19 | [กฎกระทรวงว่าด้วยการแบ่งระดับและการเทียบระดับการศึกษานอกระบบ และการศึกษาตามอัธยาศัย พ.ศ. 2546.pdf](https://drive.google.com/file/d/1KsEScCSdyT-V5Jrhb9EMkpfcj6Tbk0mF/view?usp=drivesdk) | Education & Culture Regulations | 0.033 | 4 | Corrupted text: repair or OCR |
| 20 | [2023-09-15_RDOrder_ท.491-2566_T491A.pdf](https://drive.google.com/file/d/1RzZ_el21BVXYizrCUopP-23q1qBmo8qI/view?usp=drivesdk) | RD - Revenue Department | 0.076 | 2 | Direct extraction with cleanup |
| 21 | [OCS_Opinion_2505-0186.pdf](https://drive.google.com/file/d/1F94bOtnOJm8DxJD0sh5p8vZ4gbrMWmLA/view?usp=drivesdk) | Council of State Opinions | 0.086 | 2 | Mixed pages/review |
| 22 | [1995-05-25_Circular_FIPCS-25380536_การซักซ้อมความเข้าใจเกี่ยวกับการเบิกถอนเงินกู้ยืมใน loan syndication.pdf](https://drive.google.com/file/d/1RvBxOwLuFdjCsQJdv7XCx-KGlhzJHUNB/view?usp=drivesdk) | BOT - Bank of Thailand | 0.023 | 1 | No usable text: OCR |
| 23 | [S21 - MOPH Notification Designating COVID-19 Emergency Patients.pdf](https://drive.google.com/file/d/1xfCPKRpEyjlUxQIYrYyZscuDwjzBqNK4/view?usp=drivesdk) | HSS Regulations | 0.106 | 1 | Direct extraction with cleanup |
| 24 | [2008-09-15_Ruling_0702-5887_โอนที่ดินกลับคืนกองมรดก.pdf](https://drive.google.com/file/d/121yRaFT-CclfzTfvReBwJUsNre5v2Q9N/view?usp=drivesdk) | RD - Revenue Department | 0.028 | 1 | Direct extraction with cleanup |
| 25 | [2025-01-01_Guideline-Other_R2-05496-ธปท.ว._5496_2568_บล.__05496 ธปท.ว. 5496 2568 (บล.).pdf](https://drive.google.com/file/d/1ASkIPqTbadzhn6mDO4sPhuHtno1EdHG-/view?usp=drivesdk) | BOT - Bank of Thailand | 0.235 | 2 | Direct extraction with cleanup |
| 26 | [2017-04-21_2017-000718.pdf](https://drive.google.com/file/d/1rdOY3HgZQw_7ehQeTN3XH7e-c6bUr9ot/view?usp=drivesdk) | FDA Regulations | 0.039 | 1 | Direct extraction with cleanup |
| 27 | [OCS_Opinion_2544-0685.pdf](https://drive.google.com/file/d/17J8-3x6XSlM79rQc1JsccGpegtN5TbeB/view?usp=drivesdk) | Council of State Opinions | 0.205 | 4 | Mixed pages/review |
| 28 | [LED159_2015-10-09_Regulation.pdf](https://drive.google.com/file/d/1grCeHbw2t3Wt4uqo0cMCg50qvpUo-Zgu/view?usp=drivesdk) | LED Regulations | 0.033 | 1 | Direct extraction with cleanup |
| 29 | [2015-07-13_Ruling_0702-6536_การยกเว้นอากรแสตมป์จากสัญญารับจ้างที่ปรึ.pdf](https://drive.google.com/file/d/1Z_S1PAi8IWfCe2pen2VR63ImsqgyWixI/view?usp=drivesdk) | RD - Revenue Department | 0.031 | 1 | Direct extraction with cleanup |
| 30 | [2024-10-18_Circular_NA_Revision-Members.pdf](https://drive.google.com/file/d/1vDVANlHfiOWWwX2t9nRYTpKT7Hv4uPvS/view?usp=drivesdk) | SET - Stock Exchange of Thailand | 0.422 | 9 | Direct extraction with cleanup |
| 31 | [2017-03-28_Circular_กลต.นจ.(ว)13-2560_นำส่งและซักซ้อมความเข้าใจเรื่องการแก้ไขป.pdf](https://drive.google.com/file/d/1yxlamXP7scUsi2xyD9viapt1uibjMDO3/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 1.802 | 8 | No usable text: OCR |
| 32 | [2026-03-12_Notification_BE2569-107497_กายอุปกรณ์เทียมและกายอุปกรณ์เสริม---ส่วนรยางค์ที่ขาดไป.pdf](https://drive.google.com/file/d/1QW02CjXwynJM0kZHslxTMM5Tzbvp3k84/view?usp=drivesdk) | TISI Regulations | 0.105 | 2 | Corrupted text: repair or OCR |
| 33 | [0000-00-00_ETDANotification_NA_ประกาศ_สพธอ._เรื่อง_มาตรการตรวจสอบการใช้ดุลพินิจ.pdf](https://drive.google.com/file/d/16rhA7PdcvTi691bLz97Uk5z0kRF4rttX/view?usp=drivesdk) | ETDA Regulations | 1.129 | 1 | No usable text: OCR |
| 34 | [2018-04-05_Ruling_0702-พ.-2753_การให้บริการแก่บริษัทในต่างประเทศ.pdf](https://drive.google.com/file/d/1V5DFNnKnq-tKbyM7qwItykhhTkFYjGzU/view?usp=drivesdk) | RD - Revenue Department | 0.034 | 2 | Direct extraction with cleanup |
| 35 | [OCS_Opinion_2561-0554.pdf](https://drive.google.com/file/d/1QHifOsUF1Pih1rrwi4pdCEiIm-X4oo-d/view?usp=drivesdk) | Council of State Opinions | 0.170 | 4 | Direct extraction with cleanup |
| 36 | [2063384.pdf](https://drive.google.com/file/d/1dRSVbGAMzMAPnKmTXIV_0NDvGl_kCZiG/view?usp=drivesdk) | Primary Law | 0.068 | 4 | Direct extraction with cleanup |
| 37 | [1594141.pdf](https://drive.google.com/file/d/1KH5tFD8h63Dgswtb42BnCbrQxEBNVrHD/view?usp=drivesdk) | Primary Law | 0.156 | 6 | No usable text: OCR |
| 38 | [2017-08-04_2017-010819.pdf](https://drive.google.com/file/d/1K6ZWaem4O3JvSUAf1jwTioBs7Bu_vaig/view?usp=drivesdk) | FDA Regulations | 0.116 | 6 | Direct extraction with cleanup |
| 39 | [2025-03-27_Notification_BE2567-63624_เชื้อเพลิงชีวมวล---การหาสัดส่วนฝุ่นในเม็ด-พ.ศ.-2567.pdf](https://drive.google.com/file/d/1yKKCyq-TTT4RXjFTkfUTqVlwxYTwvokf/view?usp=drivesdk) | TISI Regulations | 0.076 | 2 | Corrupted text: repair or OCR |
| 40 | [2002-10-21_AD1004_vLtadWxQ4IAvXMVM.pdf](https://drive.google.com/file/d/16_FoxIaejR_lLLD-6rA2CSIPKVunD9J4/view?usp=drivesdk) | DFT - Department of Foreign Trade | 0.444 | 3 | No usable text: OCR |
| 41 | [2004-01-07_Ruling_0706-107_ขายสินค้าพร้อมบริการติดตั้ง.pdf](https://drive.google.com/file/d/1y0mqPQYlVJ8Yt0Ow8KNUbO-VSEDwtYeJ/view?usp=drivesdk) | RD - Revenue Department | 0.048 | 1 | Direct extraction with cleanup |
| 42 | [2010-10-05_Notification_11-BE2553_กำหนดมาตรฐานข้อกำหนดทั่วไปสำหรับหน่วยรับรองคุ_rk1851612.pdf](https://drive.google.com/file/d/192qay2cy0aPP-H_I-dPWIgpN2bpZaRSL/view?usp=drivesdk) | TISI Regulations | 0.920 | 18 | No usable text: OCR |
| 43 | [undated_Notice_BE2550_Queen Sirikit WHO award coin - MOF issue announcement.pdf](https://drive.google.com/file/d/1RWGAxmhJqsq34USeXitAa7KUEBgx_cNt/view?usp=drivesdk) | Health | 0.094 | 2 | Legacy font/symbol repair |
| 44 | [1999-06-04_Circular_FIPCS-25420927_การกำหนดรหัสกำกับเอกสารของธนาคาร.pdf](https://drive.google.com/file/d/1bpwql-76BONvwG4BcAL04we7GoyZ9orQ/view?usp=drivesdk) | BOT - Bank of Thailand | 0.424 | 10 | Direct extraction with cleanup |
| 45 | [OCS_Opinion_2565-1493.pdf](https://drive.google.com/file/d/1V4rUZsMd_xfEybkwDsFCp8Fa3R_vPfUg/view?usp=drivesdk) | Council of State Opinions | 2.424 | 5 | Mixed pages/review |
| 46 | [OAP110_BE2550_Board Rule_ระเบียบคณะกรรมการพลังงานปรมาณูเพื่อสันติ ว่าด้วยการรับรองเจ้าหน้าที่ปฏิบัติงานเดินเครื่องปฏิกรณ์ปรมา.pdf](https://drive.google.com/file/d/1vLg2p517IjZ_YESqzmz71g4XhKELAgxZ/view?usp=drivesdk) | OAP Regulations | 0.646 | 33 | Legacy font/symbol repair |
| 47 | [2002_Act_พระราชบัญญัติโอนที่ดินซึ่งเป็นสาธารณสมบัติของแผ่นดิน ในท้องที่แขวงวังทองหลาง .pdf](https://drive.google.com/file/d/1qRdILse5VDvwPm93IZA45CY6J7RguUiR/view?usp=drivesdk) | Construction Regulations | 0.092 | 4 | Mixed pages/review |
| 48 | [OCS_Opinion_2527-0507.pdf](https://drive.google.com/file/d/1xXiF8BvphRteZZ5-kuEBk1cOthiqv809/view?usp=drivesdk) | Council of State Opinions | 0.287 | 5 | Direct extraction with cleanup |
| 49 | [1982-09-24_MOI-Labour_1494195.pdf](https://drive.google.com/file/d/1Z-hNJGGHG3KyRXDhuq_bfc-SNp914a7h/view?usp=drivesdk) | Labor & Social Regulations | 0.053 | 2 | No usable text: OCR |
| 50 | [2020-01-24_Notification_13-BE2562_กำหนดมาตรฐานการตรวจสอบและรับรองแห่งชาติก๊าซเร_rk17116622.pdf](https://drive.google.com/file/d/1M_hdnA3vCj2352PPAMKyPAndq7rum_ZI/view?usp=drivesdk) | TISI Regulations | 0.122 | 2 | Direct extraction with cleanup |
| 51 | [2005-06-07_Ruling_0706-4622_ให้บริการฝึกอบรมออนไลน์.pdf](https://drive.google.com/file/d/1cZaPaB8_137fzb-PgfyLUG8Bvpv19Jnq/view?usp=drivesdk) | RD - Revenue Department | 0.052 | 1 | Direct extraction with cleanup |
| 52 | [1123469.pdf](https://drive.google.com/file/d/10LSeM2zYniH7LhOmTO0sJJVS1tf-J39K/view?usp=drivesdk) | Primary Law | 0.060 | 3 | No usable text: OCR |
| 53 | [2023-04-19_MOF Notification_FIPCS-25660079_การจำหน่ายตั๋วเงินคลังเพื่อการบริหารหนี้ ในปีงบประมาณ พ.ศ. 2566 ครั้ง.pdf](https://drive.google.com/file/d/1SzR1F3sw3blsdCd2FVfU8o2nZF4pTiHb/view?usp=drivesdk) | BOT - Bank of Thailand | 1.311 | 5 | Corrupted text: repair or OCR |
| 54 | [1991-02-19_MinisterialRegulation_No1-BE2534_Social-Security-Act-MR-No1.pdf](https://drive.google.com/file/d/1Quo7AEHxY_rPKFAed47d33GS_oOQwymV/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.027 | 2 | No usable text: OCR |
| 55 | [2000-06-05_SECOfficeNotification_1-2543_ประกาศนายทะเบียนกองทุนสำรองเลี้ยงชีพเรื่.pdf](https://drive.google.com/file/d/1uQT_qnrX_5Kh56YDNNLj1uy7zSqZxfAy/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.051 | 2 | Direct extraction with cleanup |
| 56 | [2025-08-30_Notification_BE2568-81661_การทดสอบความทนไฟ---ชิ้นส่วนต่าง-ๆ-ของโครงสร้างอาคาร-เล่ม-3.pdf](https://drive.google.com/file/d/1EgRc9O1ZP7-miYW8rsJRmr91xIbRET8d/view?usp=drivesdk) | TISI Regulations | 0.078 | 3 | Corrupted text: repair or OCR |
| 57 | [2017-02-13_Act_BE2560_National-Competitiveness-Enhancement-for-Targeted-Industries-Act_EN.pdf](https://drive.google.com/file/d/1b4f0Q_6GzdTjniY5u7bAGKkHEflX1vS9/view?usp=drivesdk) | BOI - Board of Investment | 0.134 | 12 | Direct extraction with cleanup |
| 58 | [2025-11-18_MOFNotification_IncomeVAT859_mn859A.pdf](https://drive.google.com/file/d/1W5LagQm4TvBsOIcFbUv2ZFktKSYs8kZd/view?usp=drivesdk) | RD - Revenue Department | 0.049 | 1 | Corrupted text: repair or OCR |
| 59 | [1102332_Act.pdf](https://drive.google.com/file/d/1ZF6Bc6GIoVXVsIu7dYAeHt-Nyeu8uSYK/view?usp=drivesdk) | Primary Law | 0.318 | 13 | No usable text: OCR |
| 60 | [1999-02-12_Circular_FIPCS-25421503_การรายงานแบบธต.11 ธต.21 รายงานการรับซื้อเงินตราต่างประเทศค่าของส่งออก ร.pdf](https://drive.google.com/file/d/1KGkAIum23Id5fjy72L2AM5XewGcC7Opi/view?usp=drivesdk) | BOT - Bank of Thailand | 0.044 | 2 | No usable text: OCR |
| 61 | [2020-12-23_RegistrarNotification_BE2563_กำหนดแบบคำขอรับใบอนุญาต-คำขอต่ออายุใบอนุญาต-และแบบ_025334.pdf](https://drive.google.com/file/d/1YYcNIak5t84KDbzHjNYBNl3QsbQ7g-NW/view?usp=drivesdk) | OIC - Office of Insurance Commission | 0.295 | 8 | Direct extraction with cleanup |
| 62 | [OCS_Opinion_2553-0593.pdf](https://drive.google.com/file/d/1Ucqf5fOW_mO-45k8fQkdNR3_EANiUxOx/view?usp=drivesdk) | Council of State Opinions | 0.347 | 5 | Direct extraction with cleanup |
| 63 | [2007-12-04_Circular_กลต.น.(ว)44-2550_การลงทุนในสัญญาซื้อขายล่วงหน้าหรือตราสาร.pdf](https://drive.google.com/file/d/1j6-ZdSLtWRvMhXR3n_s962yeF7xRZlAX/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.060 | 1 | No usable text: OCR |
| 64 | [act151_rk224492.pdf](https://drive.google.com/file/d/1dsT3ga-xftdBMdA_P-aMKdt3IRT_pnFu/view?usp=drivesdk) | Justice & Courts Regulations | 0.067 | 3 | Legacy font/symbol repair |
| 65 | [OCS_Opinion_2555-0449.pdf](https://drive.google.com/file/d/19aZu8oNibzHpLG6wt8hA-GHJkgcc5XKi/view?usp=drivesdk) | Council of State Opinions | 0.139 | 4 | Direct extraction with cleanup |
| 66 | [1994_RD_พระราชกฤษฎีกากำหนดเขตที่ดิน ในท้องที่ตำบลวังท่าดี ตำบลท่าแดง ตำบลเพชรละคร อำเภ.pdf](https://drive.google.com/file/d/1X1Z4jKl50aFPcLNXCxVGzD9owjWuW7Tu/view?usp=drivesdk) | Construction Regulations | 0.133 | 4 | No usable text: OCR |
| 67 | [2023-03-14_MDNotif_na_ประกาศกรมเจ้าท่า ที่ 43 2566 เรื่อง ปรับปรุงหลักเกณฑ์.pdf](https://drive.google.com/file/d/1mLv5v6qBLqhmPPr1gWgaadwYiLtxzQwg/view?usp=drivesdk) | MD Regulations | 0.198 | 5 | Mixed pages/review |
| 68 | [1658310.pdf](https://drive.google.com/file/d/1VYjokrj7GBGzrXvK9eqXdyEmIXncjYRK/view?usp=drivesdk) | Primary Law | 0.057 | 2 | No usable text: OCR |
| 69 | [Senate-AP_R-1030_Bankruptcy-amend_bill-analysis.pdf](https://drive.google.com/file/d/17zBmfLSPzLwSkpHGrj8gVWMltLGQRW9y/view?usp=drivesdk) | Parliament | 16.126 | 388 | Mixed pages/review |
| 70 | [2026-08-23_Notification_BE2569-124632_คุณภาพของข้อมูล-เล่ม-51-ธรรมาภิบาลของข้อมูล-การแลกเปลี่ย.pdf](https://drive.google.com/file/d/18V9M5MvrQ_CVenUIeeqQBQukhANg0VTe/view?usp=drivesdk) | TISI Regulations | 0.129 | 3 | Corrupted text: repair or OCR |
| 71 | [2025-03-05_ICNotification_No3-BE2568_การประเมินราคาทรัพย์สินและหนี้สินของบริษัทประกันชี.pdf](https://drive.google.com/file/d/1FcUo_MGDUWrlfbnvU115USZTvi1chtZy/view?usp=drivesdk) | OIC - Office of Insurance Commission | 0.054 | 2 | Corrupted text: repair or OCR |
| 72 | [OP0494_DBD.pdf](https://drive.google.com/file/d/1FWGA-8r-AQslLm1Ym56GyGpI0pnbvJj0/view?usp=drivesdk) | Legal Forms | 0.776 | 1 | Legacy font/symbol repair |
| 73 | [unknown_Form_-_จง15_คำขอจัดหาคนหางานจากจังหวัดอื่น_65125.pdf](https://drive.google.com/file/d/1ScrMmM2_WyhPy9p2XlVFmCf75dHuvad6/view?usp=drivesdk) | DOE - Department of Employment | 0.097 | 4 | Direct extraction with cleanup |
| 74 | [2009-01-16_SECBoardNotification_กน.1-2552_การกำหนดลักษณะบุคคลที่จัดการเงินทุนสัญญา.pdf](https://drive.google.com/file/d/1zTQE9djUBPORPDrygEqslQpml9VfzVLH/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.110 | 2 | No usable text: OCR |
| 75 | [2025-09-19_TariffSchedule_Part16_Consolidated.pdf](https://drive.google.com/file/d/1xvhVRQwrpqfctvT-BKK54lEQEnsFHCcc/view?usp=drivesdk) | Excise - Excise Department | 0.068 | 2 | Direct extraction with cleanup |
| 76 | [OCS_Opinion_2479-0090.pdf](https://drive.google.com/file/d/1wYLpbhUWabuuAG0ZyY0n5GfzasrlqpQB/view?usp=drivesdk) | Council of State Opinions | 0.158 | 2 | Direct extraction with cleanup |
| 77 | [2565-11_ประกาศ_FastTrack_สิทธิบัตร_พฤศจิกายน2565.pdf](https://drive.google.com/file/d/1QgZROfl3YPbLFj0kFsdTlkrnr0bHYnps/view?usp=drivesdk) | DIP - Department of Intellectual Property | 0.378 | 1 | No usable text: OCR |
| 78 | [2015-04-10_DFT2833_94a58d630d4c12a2.pdf](https://drive.google.com/file/d/1_u3hqcvyX1lVd0957U604QJQts9madB0/view?usp=drivesdk) | DFT - Department of Foreign Trade | 0.019 | 2 | No usable text: OCR |
| 79 | [2025-01-21_Notification_BE2567-56405_เครื่องดับเพลิงยกหิ้ว-คาร์บอนไดออกไซด์-พ.ศ.-2567.pdf](https://drive.google.com/file/d/1jUXjWvJSz7beXrmqTla_2onagiVqZD5i/view?usp=drivesdk) | TISI Regulations | 0.081 | 2 | Corrupted text: repair or OCR |
| 80 | [2000-07-26_Circular_FIPCS-25431513_การให้ความช่วยเหลือทางการเงินแก่วิสาหกิจขนาดกลางและขนาดย่อม (SMEs) ที่.pdf](https://drive.google.com/file/d/1v9n6lI2BYXavJXsa6ewmCK-H4qIM5wu6/view?usp=drivesdk) | BOT - Bank of Thailand | 0.293 | 5 | Direct extraction with cleanup |
| 81 | [OCS_Opinion_2552-0627.pdf](https://drive.google.com/file/d/14kMkOE_9hjkxuwJ31Vs9EJ3aZiQblaf8/view?usp=drivesdk) | Council of State Opinions | 0.295 | 6 | Direct extraction with cleanup |
| 82 | [พระราชบัญญัติว่าด้วยเหรียญเฉลิมพระเกียรติและเหรียญที่ระลึก พ.ศ. 2548.pdf](https://drive.google.com/file/d/1O0gdEJyRHfkC3xmbWce0n29K_84-5Xvd/view?usp=drivesdk) | Security & Foreign Affairs Regulations | 0.075 | 3 | Legacy font/symbol repair |
| 83 | [OCS_Opinion_2552-0110.pdf](https://drive.google.com/file/d/1NVy0S7Zwek3SZIFd6b99LBRTS5U-30K3/view?usp=drivesdk) | Council of State Opinions | 0.225 | 5 | Direct extraction with cleanup |
| 84 | [2026-08-07_MDOrder_na_คำสั่งกรมเจ้าท่า ที่ 597 2569 เรื่อง แก้ไขเพิ่มเติมคำส.pdf](https://drive.google.com/file/d/1-DrbW0-FNc8Or3EQdbkZVjarklYgY1n8/view?usp=drivesdk) | MD Regulations | 0.062 | 2 | Corrupted text: repair or OCR |
| 85 | [OCS_Opinion_2510-0192.pdf](https://drive.google.com/file/d/1Y67pCHP-LautwtdFSqARBUSFCZPUGQY7/view?usp=drivesdk) | Council of State Opinions | 0.141 | 3 | Mixed pages/review |
| 86 | [2026-08-27_EDNotif_No2_Liquor-QR-Stamps-No2.pdf](https://drive.google.com/file/d/1pOtH3K5JpBatvkunSAqlr2a7mA2vBkOV/view?usp=drivesdk) | Excise - Excise Department | 0.061 | 1 | Corrupted text: repair or OCR |
| 87 | [2021-01-04_Decision-Merger_na_1)-บริษัท-ฮ.-และบริษัท-ค.-และ-2)-บริษัท-ฮ.-และบริษัท-น..pdf](https://drive.google.com/file/d/1u4epl-F2YY404VI0KoJhDBM-gEj9qkyW/view?usp=drivesdk) | TCCT - Trade Competition Commission of Thailand | 0.259 | 5 | Direct extraction with cleanup |
| 88 | [2022_MR_384_กฎกระทรวง ออกตามความในประมวลรัษฎากร ว่าด้วยการดำเนินการเกี่ย.pdf](https://drive.google.com/file/d/19pQIB9KH9leTpD1mAht80tHHurZUUgSn/view?usp=drivesdk) | RD - Revenue Department | 0.124 | 7 | Direct extraction with cleanup |
| 89 | [2000-11-01_Circular_FIPCS-25431551_การรับพันธบัตรรัฐวิสาหกิจเข้าซื้อขายตามระเบียบว่าด้วยการซื้อขายพั.pdf](https://drive.google.com/file/d/1315ei5Sjis_KbRvcw13hpBiE33HT3cHX/view?usp=drivesdk) | BOT - Bank of Thailand | 0.032 | 1 | Legacy font/symbol repair |
| 90 | [2016-08-03_SECBoardNotification_กน.5-2559_หลักเกณฑ์เงื่อนไขและวิธีการในการกู้ยืมเง.pdf](https://drive.google.com/file/d/1DIczS3Abz038AxL5LFxTWv45HI-r46Ct/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.061 | 2 | No usable text: OCR |
| 91 | [2009-11-11_Regulation_2552_Appeals-Objections.pdf](https://drive.google.com/file/d/1ej1ZckL3_-ZnE_thmOTbF3oXUBx_Bpv1/view?usp=drivesdk) | ERC - Energy Regulatory Commission | 0.077 | 6 | Legacy font/symbol repair |
| 92 | [2015-12-22_SECBoardNotification_กจ.-29-2558_การยกเว้นการยื่นแบบแสดงรายการข้อมูลการเส.pdf](https://drive.google.com/file/d/1aR3GAqEmJpj2NY7uw4zEsoe4ERGFG1lz/view?usp=drivesdk) | SEC - Securities and Exchange Commission Thailand | 0.023 | 1 | Direct extraction with cleanup |
| 93 | [2011-11-29_WageCttee_1908015.pdf](https://drive.google.com/file/d/1RV4GW-47Nyy-4HdwkCr811InhuULarYs/view?usp=drivesdk) | Labor & Social Regulations | 0.045 | 3 | Direct extraction with cleanup |
| 94 | [2018-02-20_Regulation_ระเบียบกรมสรรพสามิต ว่าด้วยการส่งเงิน การยกเว้นการส่งเงินเข้ากองทุนน้ำ.pdf](https://drive.google.com/file/d/1aJX_dvruVXQxMyYTtxG0UfDzEaJIVg2i/view?usp=drivesdk) | DEDE & EPPO Regulations | 0.047 | 2 | Direct extraction with cleanup |
| 95 | [OCS_Opinion_2521-0420.pdf](https://drive.google.com/file/d/1m8HI0q2gXPLk88LTQms-cQWTAiC8VQST/view?usp=drivesdk) | Council of State Opinions | 0.205 | 5 | Direct extraction with cleanup |
| 96 | [1996-01-26_Circular_FIPCS-25390594_กำหนดให้ยื่นแบบรายงานฐานะการเงินและผลการดำเนินงานแยกสำหรับ ธุรกิจ.pdf](https://drive.google.com/file/d/17nZ845bQGqp9tLStjEfLTWnVBcz9sWS9/view?usp=drivesdk) | BOT - Bank of Thailand | 1.031 | 45 | No usable text: OCR |
| 97 | [2012-01-17_ETCNotification_BE2555_ประกาศคณะกรรมการธุรกรรมทางอิเล็กทรอนิกส์_เรื่อง_การรับรองสิ่งพิมพ์ออก_พ.ศ._2555.pdf](https://drive.google.com/file/d/1paGLs60xh2j5PbYHgSSwI00hT9IpTmEq/view?usp=drivesdk) | ETDA Regulations | 0.076 | 6 | Direct extraction with cleanup |
| 98 | [2016-03-01_Circular_FIPCS-25590043_ค่าธรรมเนียมและค่าปรับที่เกี่ยวข้องกับการใช้เงินสภาพคล่องระหว่างว.pdf](https://drive.google.com/file/d/1BDgfCA4QkJQtXVI3SrJ2Pf0qae8YDgUy/view?usp=drivesdk) | BOT - Bank of Thailand | 0.157 | 3 | No usable text: OCR |
| 99 | [2010-09-07_Circular_FIPCS-25530188_ซักซ้อมวิธีปฏิบัติเกี่ยวกับดอกเบี้ยเงินฝาก.pdf](https://drive.google.com/file/d/18pJfJ368ZwFSRpkpk-B-HYuM66xahIMA/view?usp=drivesdk) | BOT - Bank of Thailand | 0.031 | 1 | No usable text: OCR |
| 100 | [2024-11-26_NEPC_3-2567_reso_lpg-price_2135.pdf](https://drive.google.com/file/d/1_Wq-SwL5wxQytVlCCVgVgyM7krQrLzsw/view?usp=drivesdk) | DEDE & EPPO Regulations | 0.107 | 2 | Direct extraction with cleanup |
| 101 | [2024-08-07_DLT-Notification_BE2567_ประกาศกรมการขนส่งทางบก เรื่อง ให้ผู้ได้รับใบอนุญาตจัดตั้งสถา.pdf](https://drive.google.com/file/d/1n3eLEmHyNTmGy6rEnwqj84L31oPjUb8I/view?usp=drivesdk) | DLT Regulations | 0.048 | 1 | Corrupted text: repair or OCR |
| 102 | [2023-09-13_NHSO_Notification_NHSO Notification on Payment of Health Service Expenses (No. 2) B.E. 2566.pdf](https://drive.google.com/file/d/1evynq_UFVe6SVHY_f34WZSB5wkEwOR5j/view?usp=drivesdk) | MOPH Other Regulations | 0.095 | 3 | Direct extraction with cleanup |
| 103 | [1305125.pdf](https://drive.google.com/file/d/1v0l0e7JBVZ5gWT8eRzYQumg5_vKkJXXX/view?usp=drivesdk) | Primary Law | 0.064 | 3 | No usable text: OCR |
| 104 | [1113077_Act.pdf](https://drive.google.com/file/d/1etIXgHUr6hzfwofj23XEoY3IYxfeAKaz/view?usp=drivesdk) | Primary Law | 0.065 | 3 | No usable text: OCR |
| 105 | [ท.ป.3.pdf](https://drive.google.com/file/d/1rKz-BVioXOwcGuPcbjVkUO1exchkkqaT/view?usp=drivesdk) | Legal Forms | 0.443 | 1 | Corrupted text: repair or OCR |
| 106 | [2016-01-18_MDOrder_na_คำสั่งกรมเจ้าท่า ที่ 886 2558 เรื่อง มอบหมายให้เจ้าหน้.pdf](https://drive.google.com/file/d/1oR2a63KKEurl4x7xXbiNtaWqxzSm9xhN/view?usp=drivesdk) | MD Regulations | 0.023 | 1 | Direct extraction with cleanup |
| 107 | [140A020N0000000010600.pdf](https://drive.google.com/file/d/1ZZRMOU9YsNeYGx2WiuMQmLj58wXG-t6B/view?usp=drivesdk) | Primary Law | 0.112 | 3 | Direct extraction with cleanup |
| 108 | [2025-10-21_Notification_BE2568-89474_อาหารสัตว์---การหาไฟเทสแอคทิวิตี-พ.ศ.-2568.pdf](https://drive.google.com/file/d/19PMxplEUM7b1HPX0LDvydr-zHihFrRGd/view?usp=drivesdk) | TISI Regulations | 0.077 | 3 | Corrupted text: repair or OCR |
| 109 | [2011-07-12_DOENotification_-_ประกาศกรมการจัดหางาน_เรื่อง_กำหนดสถานที่ยื่นคำขอและแจ้ง.pdf](https://drive.google.com/file/d/1Qfuv7Ddo1XcTlX9Wz901ZKsSyxyvlAMi/view?usp=drivesdk) | DOE - Department of Employment | 0.031 | 2 | Direct extraction with cleanup |
| 110 | [OCS_Opinion_2533-0054.pdf](https://drive.google.com/file/d/1-ECokldA9nWtHjfTLoejYpQlm_ZHHSHN/view?usp=drivesdk) | Council of State Opinions | 0.068 | 1 | Direct extraction with cleanup |
| 111 | [กฎกระทรวง ฉบับที่ 4 (พ.ศ. 2539) ออกตามความในพระราชบัญญัติโบราณสถาน โบราณวัตถุ ศิลปวัตถุ และพิพิธภัณฑสถานแห่งชาติ พ.ศ. 2504.pdf](https://drive.google.com/file/d/1Y8yVZEI15JN1dCjXaSWP53jDnATalHV4/view?usp=drivesdk) | Education & Culture Regulations | 0.385 | 16 | No usable text: OCR |
| 112 | [1034668.pdf](https://drive.google.com/file/d/1FgxZqDa8eYKMS4lmBC9jk-5nquzyZfc9/view?usp=drivesdk) | Primary Law | 0.157 | 3 | No usable text: OCR |
| 113 | [OCS_Opinion_2538-0055.pdf](https://drive.google.com/file/d/1GXBl3tlMRgYzKvCUSaOORFyACKS8EY7x/view?usp=drivesdk) | Council of State Opinions | 0.268 | 4 | Direct extraction with cleanup |
| 114 | [2013-05-22_Ruling_0702-4420_การหักลดหย่อนเงินบริจาค.pdf](https://drive.google.com/file/d/15TdgJWocqMF9zC_aw7XvAtmU2mwTjnqI/view?usp=drivesdk) | RD - Revenue Department | 0.030 | 1 | Direct extraction with cleanup |
| 115 | [2015-02-06_MinReg_2032928.pdf](https://drive.google.com/file/d/1suhi70sfZUD2Yde9DOFcKVqZaMbe5UMg/view?usp=drivesdk) | Labor & Social Regulations | 0.076 | 7 | Direct extraction with cleanup |
| 116 | [1996-06-21_Circular_FIPCS-25390629_รายงานการดำรงสินทรัพย์สภาพคล่อง (ของกิจการวิเทศธนกิจ).pdf](https://drive.google.com/file/d/1ZRvnpKnoEslp7ifFoUfi_Vd5YZQ1KPIn/view?usp=drivesdk) | BOT - Bank of Thailand | 0.191 | 6 | No usable text: OCR |
| 117 | [2015-05-29_Ministerial-Regulation_BE2555_กฎกระทรวงกำหนดความปลอดภัยในการรับจ้างบรรทุกคนโดยสา_a19.pdf](https://drive.google.com/file/d/1BGytnm30NXV1K9o8j5hT_O05mvF55h_h/view?usp=drivesdk) | DLT Regulations | 1.819 | 5 | No usable text: OCR |
| 118 | [2025-04-21_Notification_BE2568-66470_โซเดียมและโพแทสเซียมซิลิเกตสำหรับใช้ในอุตสาหกรรม---การว.pdf](https://drive.google.com/file/d/1r_MdkvWlh9lSqyr6XJ0HIpyN7D4ebXBG/view?usp=drivesdk) | TISI Regulations | 0.079 | 3 | Corrupted text: repair or OCR |
| 119 | [2023-12-21_MDNotif_No14_ประกาศกรมเจ้าท่าที่ 317 2566 เรื่อง บัญชีเรือเฝ้าระว.pdf](https://drive.google.com/file/d/12eSdr6XRmYw26ZzBNxHwHkGrHCxR0rQO/view?usp=drivesdk) | MD Regulations | 2.074 | 4 | Mixed pages/review |
| 120 | [1979_RD_พระราชกฤษฎีกาให้ใช้พระราชบัญญัติควบคุมอาคาร พ.ศ. ๒๕๒๒ ในเขตสุขาภิบาลยุหว่า อำเภอสันป่าตอง จังหวัดเชียงใหม่ พ.ศ. ๒๕๒๓.pdf](https://drive.google.com/file/d/1SVvUkI46FG_dvCJclpPEVpp-VP9oEg9d/view?usp=drivesdk) | Construction Regulations | 0.048 | 2 | No usable text: OCR |
