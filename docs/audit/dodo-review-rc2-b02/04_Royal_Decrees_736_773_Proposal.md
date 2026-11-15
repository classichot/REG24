# Royal Decrees No. 736 B.E. 2564 & No. 773 B.E. 2566: Independent Gazette Verification & Separate Hashed Candidate Proposal (`Instruction 2`)

> [!IMPORTANT]
> **Governance Posture Enforced (`Instruction 2`)**
> 1. **Both `B01` links remain 100% SUPPRESSED in current candidates (`rel.B01.rc2` & `rel.B02.rc1`)**: [`staging_candidates_rc2_b02`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_candidates_rc2_b02) contains **`0`** graph links to `subreg.th.rc.royal_decree.736` or `subreg.th.rc.royal_decree.773`.
> 2. **Quarantine records preserved and NEVER auto-marked as legal evidence**: Both `B01` `UnresolvedReferenceRecord` entries remain retained in the audit trail with `quarantine_status: "UNRESOLVED_QUARANTINED"` and `usable_as_legal_evidence: false` in **both** the current candidate store and the separate proposal store.
> 3. **Proposed links staged strictly in a separate, cryptographically hashed candidate (`rel.B02.rc2`)**: Materialized in isolated directory [`staging_proposed_b02_rc2_rd736_773`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_proposed_b02_rc2_rd736_773) via [`stage-rd736-773-proposed-candidate.ts`](file:///d:/Code/REG24/scripts/stage-rd736-773-proposed-candidate.ts), with machine-readable audit receipt [`rd736_773_proposed_candidate_receipt.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/rd736_773_proposed_candidate_receipt.json), pending independent human legal review and Owner decision.

---

## 1. Independent Royal Gazette Source Verification

Both instruments were verified directly against their native-text Royal Gazette (`ราชกิจจานุเบกษา`) PDF byte digests in the `B02` inventory and cross-checked word-for-word against the citing `B01` Revenue Department rulings.

### 1.1 Instrument Comparison Matrix

| Verification Dimension | **Royal Decree No. 736 B.E. 2564 (`พ.ร.ฎ. ฉบับที่ 736`)** | **Royal Decree No. 773 B.E. 2566 (`พ.ร.ฎ. ฉบับที่ 773`)** |
| :--- | :--- | :--- |
| **Canonical Work ID** | `subreg.th.rc.royal_decree.736` | `subreg.th.rc.royal_decree.773` |
| **Formal Thai Instrument Title (`มาตรา 1`)** | พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 736) พ.ศ. 2564 | พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 773) พ.ศ. 2566 |
| **Enabling Authority** | รัฐธรรมนูญแห่งราชอาณาจักรไทย มาตรา 175 ประกอบประมวลรัษฎากร มาตรา 3 (1) | รัฐธรรมนูญแห่งราชอาณาจักรไทย มาตรา 175 ประกอบประมวลรัษฎากร มาตรา 3 (1) |
| **Official Royal Gazette Citation** | **เล่ม 138 ตอนที่ 73 ก ราชกิจจานุเบกษา วันที่ 8 พฤศจิกายน 2564 หน้า 159–161** | **เล่ม 140 ตอนที่ 47 ก ราชกิจจานุเบกษา วันที่ 15 สิงหาคม 2566 หน้า 22–24** |
| **Verified Gazette PDF Files in `B02`** *(identical byte content across companion copies)* | 1. `Primary Law/Royal Decrees/17186446_Royal_Decree.pdf`<br>2. `RD/SBT/2021_RD_736_พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร.pdf`<br>**Bytes**: `147,061` (`3` pages)<br>**`SHA-256`**: `0cbb468ccf7694c4c96929cfc2a3fefea976bdc53d8bf1c682c85af6885fb183` | 1. `Primary Law/Royal Decrees/17208926_Royal_Decree.pdf`<br>2. `RD/CIT/2023_RD_773_พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร.pdf`<br>**Bytes**: `100,931` (`3` pages)<br>**`SHA-256`**: `1b04f02bdc56476fa925cf04bd3f6c5a83f25da27dbae538531063b14d9e4283` |
| **Given / Signature Date (`ให้ไว้ ณ วันที่`)** | `2021-11-07` (`7 พฤศจิกายน พ.ศ. 2564`) | `2023-08-12` (`12 สิงหาคม พ.ศ. 2566`) |
| **Gazette Publication Date** | **`2021-11-08`** (`8 พฤศจิกายน 2564`) | **`2023-08-15`** (`15 สิงหาคม 2566`) |
| **Formal Entry into Force (`มาตรา 2`)** | **`2021-11-09`** (*วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป*) | **`2023-08-16`** (*วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป*) |
| **Version Status** | Original enacted text (`ENACTED_ORIGINAL`; unamended as of `B02` inventory) | Original enacted text (`ENACTED_ORIGINAL`; unamended as of `B02` inventory) |
| **Substantive & Temporal Applicability** | **Retroactive substantive coverage from `2019-05-30` (`30 พฤษภาคม พ.ศ. 2562`) onwards**:<br>• `มาตรา 3`: Exempts Specific Business Tax (`SBT`, หมวด 5 ลักษณะ 2) for juristic-person landowners under RC s. `77/1` on receipts received from `30 May 2019` onwards from immovable property expropriation.<br>• `มาตรา 4`: Exempts Stamp Duty (`STAMP`, หมวด 6 ลักษณะ 2) on instruments executed from `30 May 2019` onwards transferring expropriated immovable property. | **Accounting-period conditional exemption (`มาตรา 3` & `มาตรา 4`)**:<br>• `มาตรา 3`: Exempts Corporate Income Tax (`CIT`, ส่วน 3 หมวด 3 ลักษณะ 2) for companies/juristic partnerships on state subsidy income under the EV car & motorcycle promotion measure **for the accounting period in which the subsidy is received**, subject to rules/conditions prescribed by the Director-General of the Excise Department.<br>• `มาตรา 4`: Clawback upon breach — tax exemption terminates and previously exempted income must be included back into net profit for the accounting period in which the right was used. |

---

## 2. Citing `B01` Rulings, Exact Applicable Sections & Excerpt-Completeness Disclosure

### 2.1 Case A — Ruling `กค 0702/1493` (`https://www.rd.go.th/68494.html`, Decision Date `2026-03-13`)
- **Citing Work ID**: `work.th.rd.gk_0702_1493_2026_c76989ef`
- **Preserved `B01` Quarantine Record**: `uref.work.th.rd.gk_0702_1493_2026_c76989ef.3` (`usable_as_legal_evidence: false`)
- **Facts & Official Conclusion Alignment**: A limited partnership (`ห้างหุ้นส่วนจำกัด`, a juristic person under RC s. `77/1`) entered an expropriation sale agreement with the Department of Highways under **Section 25 of the Expropriation and Acquisition of Immovable Property Act B.E. 2562 (`พ.ร.บ. ว่าด้วยการเวนคืนและการได้มาซึ่งอสังหาริมทรัพย์ พ.ศ. 2562`)** (`84,782,950 THB`). The Revenue Department ruled that:
  1. Compensation receipts are **exempt from Specific Business Tax** under **`มาตรา 3 (1)`** of Royal Decree No. 736 B.E. 2564; and
  2. Instruments executed for the transfer are **exempt from Stamp Duty** under **`มาตรา 4 (1)`** of Royal Decree No. 736 B.E. 2564.
- **Verbatim-Verified Sections Proposed for Linking**:
  - **`prov.th.rc.royal_decree.736.3_1` (`มาตรา 3 (1)`, Gazette Page `159`)**: 100% verbatim-complete in the verified Gazette PDF layer (`...ทั้งนี้ เฉพาะรายรับที่ได้รับตั้งแต่วันที่ 30 พฤษภาคม พ.ศ. 2562 เป็นต้นไป (1) รายรับที่เป็นเงินค่าทดแทนสำหรับการขายอสังหาริมทรัพย์ตามมาตรา 25 แห่งพระราชบัญญัติว่าด้วยการเวนคืนและการได้มาซึ่งอสังหาริมทรัพย์ พ.ศ. 2562`).
  - **`prov.th.rc.royal_decree.736.4_1` (`มาตรา 4 (1)`, Gazette Page `160`)**: 100% verbatim-complete in the verified Gazette PDF layer (`...ทั้งนี้ เฉพาะตราสารที่ได้กระทำตั้งแต่วันที่ 30 พฤษภาคม พ.ศ. 2562 เป็นต้นไป (1) การขายอสังหาริมทรัพย์ตามมาตรา 25 แห่งพระราชบัญญัติว่าด้วยการเวนคืนและการได้มาซึ่งอสังหาริมทรัพย์ พ.ศ. 2562`).

> [!WARNING]
> **Full Transparency Disclosure — Page 2 (`หน้า 160`) Excerpt Clip on Non-Cited Sub-Clause `มาตรา 4 (3)` & `มาตรา 5` of RD 736**
> During independent inspection of `b02-drive-manifest.json.gz` for `17186446_Royal_Decree.pdf` (`0cbb468c...`), we found that the pre-extracted manifest cap (`1,000` characters per page) clipped the bottom `~220` characters of **Page 2 (`หน้า 160`)** mid-word in sub-clause `มาตรา 4 (3)` (`...แห่งพระราชบัญญ...`) together with `มาตรา 5` (ministerial care-and-charge boilerplate), before resuming cleanly on Page 3 (`หน้า 161`, countersignature and `หมายเหตุ`).
> - **Impact on Ruling `กค 0702/1493`**: **None** on the substantive link — `มาตรา 1`, `มาตรา 2`, `มาตรา 3 (1)–(2)`, and `มาตรา 4 (1)–(2)` are **100% verbatim-complete**, and Ruling `กค 0702/1493` relies exclusively on **`มาตรา 3 (1)`** and **`มาตรา 4 (1)`** (Section 25 expropriation agreements).
> - **Zero Fabrication Enforced**: No missing characters were inferred or reconstructed for `มาตรา 4 (3)` or `มาตรา 5`, and `rel.B02.rc2` records an explicit `coverage_gaps` disclosure until full un-truncated PDF page re-extraction is run.

### 2.2 Case B — Ruling `กค 0702/6077` (`https://www.rd.go.th/68053.html`, Decision Date `2025-10-14`)
- **Citing Work ID**: `work.th.rd.gk_0702_6077_2025_47ed9f4a`
- **Preserved `B01` Quarantine Record**: `uref.work.th.rd.gk_0702_6077_2025_47ed9f4a.1` (`usable_as_legal_evidence: false`)
- **Facts & Official Conclusion Alignment**: Company `ก.` manufactures electric motorcycles under a Memorandum of Agreement with the Excise Department receiving an `18,000 THB/unit` state EV subsidy. Under **Issue 3 (Corporate Income Tax)** of the official ruling, the Revenue Department concluded that the EV subsidy is **exempt from Corporate Income Tax** under **Royal Decree No. 773 B.E. 2566**, provided the company complies with the rules, procedures, and conditions prescribed by the Director-General of the Excise Department.
- **Verbatim-Verified Sections Proposed for Linking** *(all 5 sections `มาตรา 1`–`มาตรา 5` across Pages `22–24` are 100% verbatim-complete with zero clipping)*:
  - **`prov.th.rc.royal_decree.773.3` (`มาตรา 3`, Gazette Page `22`)**: Grants CIT exemption on state EV car/motorcycle subsidies for the accounting period received, conditioned on Excise DG rules (`INTERPRETS`).
  - **`prov.th.rc.royal_decree.773.4` (`มาตรา 4`, Gazette Page `23`)**: Prescribes termination of exemption and income clawback if conditions in `มาตรา 3` are breached (`CITES`).

---

## 3. Separate Hashed Candidate Proposal (`rel.B02.rc2`) & Audit Trail

Per Instruction 2, `rel.B01.rc2` and `rel.B02.rc1` remain untouched with both links suppressed, while the proposed section-level links are isolated in **`rel.B02.rc2`**:

| Field | Current Candidate (`rel.B02.rc1` — Suppressed) | Proposed Candidate (`rel.B02.rc2` — Isolated Proposal Store) |
| :--- | :--- | :--- |
| **Isolated Store Path** | [`staging_candidates_rc2_b02`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_candidates_rc2_b02) | [`staging_proposed_b02_rc2_rd736_773`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_proposed_b02_rc2_rd736_773) |
| **`code_commit`** | `3c3034763128f22865c10c88274f468c5752bc09` | `3c3034763128f22865c10c88274f468c5752bc09` |
| **`manifest_id`** | **`mfst.b02.mwhjhg12`** (`inv.b02.mwhjhg12`) | **`mfst.b02.rc2_rd736_773`** (`inv.b02.rc2_rd736_773`) |
| **`inventory_hash` (`SHA-256`)** | `069b9d7f562ccf3ff074e132ab86159bb115b2fc446c842f1382fa3a7677d8ce` | **`e90924efd8aed175fe49bc48845c09e9d2e499cdc1dbf035a6b0fbd0e7b2c3fa`** |
| **`manifest_hash` (`SHA-256`)** | **`c0b6b5d9754e3a45d15035d2ffe116da73abbf2e252d8f017abfb51ab52aa0c8`** | **`a2f7ffa3d9b99a980ea642c02df493d7523c3ae4880053dd19827818e8d88ad6`** |
| **Store Snapshot `SHA-256` / WAL Seq** | `c9a798f114d29749bca5ceaf462830c90c5837596d25a93fffd8b16073b9973f` (`seq 1..34`) | `95f651600092bb528e65815f5df54bdc10b2e4009cd8b2a46a23833fb3892a3a` (`seq 1..36`) |
| **`supersession_lineage`** | Follows `rel.B01.rc2` (`mfst.b01.mwhjetdw`) | `supersedes_release_id: "rel.B02.rc1"`, `supersedes_manifest_id: "mfst.b02.mwhjhg12"`, `supersedes_manifest_hash: "c0b6b5d9..."` |
| **B01 -> RD 736 / RD 773 Links** | **`0` (100% suppressed)** | **`4` section-level ruling assertions + `4` parent `CONTAINS` assertions** (`8` ontology-certified assertions: `asrt.prop.ruling68494.interprets.rd736_s3_1`, `rd736_s4_1`, `asrt.prop.ruling68053.interprets.rd773_s3`, `cites.rd773_s4`, plus 4 `CONTAINS`) |
| **Quarantine Records (`usable_as_legal_evidence`)** | **`false`** (`UNRESOLVED_QUARANTINED`) | **`false`** (`UNRESOLVED_QUARANTINED` — preserved in audit ledger; **not** auto-marked `true`) |
| **Approval Status** | `READY_FOR_UAT` (`user_decision: null`) | `READY_FOR_UAT` (`user_decision: null` — awaiting human legal review & Owner decision) |
