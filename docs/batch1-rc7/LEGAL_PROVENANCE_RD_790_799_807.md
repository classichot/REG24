# REG24 Batch 1 (`rel.B01.rc7`) — Legal Provenance Receipt: Royal Decrees 790, 799 & 807

> **Purpose**: Portable, repo-committed provenance packet for independent Legal review of the three VAT rate-reduction Royal Decrees (`790`, `799`, `807`) and their exact date boundaries. Contains zero Windows-local paths; every archived original PDF binary is committed directly in this repository under `data/knowledge-store-b01-rc2-staging/artifacts/<sha256>.bin`.

---

## 1. Visually Verified Official Royal Gazette Inventory

All 9 pages across `dc790.pdf`, `dc799.pdf`, and `dc807.pdf` were downloaded directly from the Thai Revenue Department (`www.rd.go.th`), SHA-256 hashed, archived immutably in the repository, and **visually verified page-by-page** (rendered at high DPI via PyMuPDF because the official Royal Gazette TCPDF files contain broken ToUnicode CMaps for Thai font glyphs, making naive PDF text extraction unreliable).

| Field | พ.ร.ฎ. (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗ | พ.ร.ฎ. (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘ | พ.ร.ฎ. (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙ |
|---|---|---|---|
| **Canonical Work ID** | `subreg.th.rc.royal_decree.790` | `subreg.th.rc.royal_decree.799` | `subreg.th.rc.royal_decree.807` |
| **Candidate Version (`rel.B01.rc7`)** | `ver.th.rc.royal_decree.790.v1` *(NEW)* | `ver.th.rc.royal_decree.799.v2` *(supersedes `v1` in `rc7`; `v1` preserved in `rc6`)* | `ver.th.rc.royal_decree.807.v2` *(supersedes `v1` in `rc7`; `v1` preserved in `rc6`)* |
| **Official RD Source URL** | https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf | https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf | https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf |
| **Archived Original PDF (Repo Path)** | [`8cee8f1d...a14e.bin`](../../data/knowledge-store-b01-rc2-staging/artifacts/8cee8f1d3715313f0538e99b1f6cb6887945e943ade089022a5d9d2bc8c5a14e.bin) | [`796b9aff...2ba3.bin`](../../data/knowledge-store-b01-rc2-staging/artifacts/796b9aff527081720587dcf5b378833eb09bac731c3cc941fea382ce18302ba3.bin) | [`a4e0c55a...ab70.bin`](../../data/knowledge-store-b01-rc2-staging/artifacts/a4e0c55a2324397af4079317d2a5138fa075fcd87eb9348771742ed7ad6dab70.bin) |
| **SHA-256 Checksum** | `8cee8f1d3715313f0538e99b1f6cb6887945e943ade089022a5d9d2bc8c5a14e` | `796b9aff527081720587dcf5b378833eb09bac731c3cc941fea382ce18302ba3` | `a4e0c55a2324397af4079317d2a5138fa075fcd87eb9348771742ed7ad6dab70` |
| **Byte Size / Page Count** | `93,999` bytes · `3` pages (`pdf_page` 0/1/2) | `94,325` bytes · `3` pages (`pdf_page` 0/1/2) | `106,820` bytes · `3` pages (`pdf_page` 0/1/2) |
| **Royal Gazette Citation** | เล่ม ๑๔๑ ตอนที่ ๕๗ ก หน้า ๑–๓ | เล่ม ๑๔๒ ตอนที่ ๕๙ ก หน้า ๑–๓ | เล่ม ๑๔๓ ตอนที่ ๕๐ ก หน้า ๒๐–๒๒ |
| **Enactment Date ("ให้ไว้ ณ วันที่")** | `2024-09-19` (๑๙ กันยายน พ.ศ. ๒๕๖๗) | `2025-09-13` (๑๓ กันยายน พ.ศ. ๒๕๖๘) | `2026-08-20` (๒๐ สิงหาคม พ.ศ. ๒๕๖๙) |
| **Gazette Publication Date** | `2024-09-20` (๒๐ กันยายน พ.ศ. ๒๕๖๗) | `2025-09-14` (๑๔ กันยายน พ.ศ. ๒๕๖๘) | `2026-08-23` (๒๓ สิงหาคม พ.ศ. ๒๕๖๙) |
| **Commencement Date (มาตรา ๒)** | `2024-10-01` (๑ ตุลาคม พ.ศ. ๒๕๖๗) | `2025-10-01` (๑ ตุลาคม พ.ศ. ๒๕๖๘) | `2026-10-01` (๑ ตุลาคม พ.ศ. ๒๕๖๙) |
| **Covered Transaction Period (มาตรา ๔)** | `2017-10-01` – `2025-09-30` | `2017-10-01` – `2026-09-30` | `2017-10-01` – `2027-09-30` |
| **Active Governing Window (Tested Endpoints)** | **`2024-10-01` – `2025-09-30`** | **`2025-10-01` – `2026-09-30`** | **`2026-10-01` – `2027-09-30`** |
| **VAT Rate Specified (มาตรา ๔)** | ร้อยละ ๖.๓ (+ ภาษีท้องถิ่น 1/9 = ๐.๗%, รวม **๗%**) | ร้อยละ ๖.๓ (+ ภาษีท้องถิ่น 1/9 = ๐.๗%, รวม **๗%**) | ร้อยละ ๖.๓ (+ ภาษีท้องถิ่น 1/9 = ๐.๗%, รวม **๗%**) |
| **Post-Expiry Rule (`is_temporary_rule: true`)** | Superseded by RD 799 on `2025-10-01` | Superseded by RD 807 on `2026-10-01` | Expires `2027-09-30`; on `2027-10-01` reverts to statutory `10%` under Revenue Code §80 unless a further decree is enacted |
| **Countersigning Minister (ผู้รับสนองพระบรมราชโองการ)** | แพทองธาร ชินวัตร นายกรัฐมนตรี | ภูมิธรรม เวชยชัย รองนายกรัฐมนตรี | อนุทิน ชาญวีรกูล นายกรัฐมนตรี |

---

## 2. Corrections Made vs. Preserved `rel.B01.rc6`

1. **Royal Decree 790 (`subreg.th.rc.royal_decree.790`)**: Previously **absent** in `rel.B01.rc6` (causing pre-`2025-10-01` VAT queries to report missing decree). Added as `v1` in `rel.B01.rc7` with 3 section-level passages (`sec_1_2` p.1, `sec_3_4` p.2, `note` p.3) and verified SHA-256 original PDF.
2. **Royal Decree 799 (`subreg.th.rc.royal_decree.799`)**: `rel.B01.rc6` (`v1`) recorded `publication_date: "2025-10-01"` (conflating commencement with Gazette publication). Corrected in `rel.B01.rc7` (`v2`) to separate `enactment_date: "2025-09-13"`, `publication_date: "2025-09-14"`, `commencement_date: "2025-10-01"`, and `covered_transaction_period: 2017-10-01..2026-09-30`. `v1` remains untouched in `rel.B01.rc6` for clean rollback.
3. **Royal Decree 807 (`subreg.th.rc.royal_decree.807`)**: `rel.B01.rc6` (`v1`) recorded `publication_date: "2026-10-01"` AND had **`valid_to: null`** (open-ended expiry bug on a temporary decree!). Corrected in `rel.B01.rc7` (`v2`) to separate `enactment_date: "2026-08-20"`, `publication_date: "2026-08-23"`, `commencement_date: "2026-10-01"`, `covered_transaction_period: 2017-10-01..2027-09-30`, and explicit `valid_to: "2027-09-30"` (`is_temporary_rule: true`).

---

## 3. Declared Coverage Gap (Unmasked)

- **Pre-`2023-10-01` VAT Reduction Decrees**: Royal Decree 780 (`2023-10-01` – `2024-09-30`) is present from the prior `dc780.doc` capture, while annual extension decrees between RD 646 (`2017`) and RD 780 (`2023`) are not yet individually Gazette-reverified with separate enactment/publication/commencement metadata.

---

## 4. Machine-Readable Receipt

See [`verified_royal_decrees.json`](./verified_royal_decrees.json) in this same directory.
