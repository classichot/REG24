# Candidate Manifests (`rel.B01.rc2` & `rel.B02.rc1`), Quarantine Ledger, Coverage Impact & OCR Recovery Queue (Instructions 1, 2 & 4)

> [!IMPORTANT]
> **Candidate Preparation Scope Only (No UAT Opened, No Production Promotion)**
> Per Owner Instructions 1, 2 & 4 (`2026-11-15`), `rel.B01.rc2` and `rel.B02.rc1` were prepared strictly inside isolated staging ([`staging_candidates_rc2_b02`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_candidates_rc2_b02)) cloned read-only from `data/knowledge-store`.
> - **`rel.B01.rc1` & Owner chat approval preserved intact (`Instruction 2`)**: `manifest_id = mfst.b01.mwgj0yb3`, `manifest_hash = 2059e51ee9bf2ba3fe26fc8f0b6abb4e5ed942be0a2e3cace8df116a41c2e444`, `9,744` passages, `35,805` assertions, `reports/B01_*.json`, and `wal.jsonl` `seq 1..14` remain 100% unaltered.
> - **Zero Owner UAT decisions recorded**: `active_release_id = null`, and `user_decision = null` on `rel.B01.rc1`, `rel.B01.rc2`, and `rel.B02.rc1`.
> - **Protected repo canonical store untouched**: [`canonical-state.json.gz`](file:///d:/Code/REG24/data/knowledge-store/canonical-state.json.gz) verified before and after at `SHA-256 = 08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9`.

---

## 1. Immutable Code & Candidate Manifest Identifiers

Machine-readable package summary: [`staging_rc2_b02_candidate_package.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_rc2_b02_candidate_package.json) (also bundled in-repo at `docs/audit/dodo-review-rc2-b02/`).

### 1.1 Immutable Code Identifiers
- **Untouched Production Base (`main`)**: `7df41c4ca1f63059b8d187e4014f2cb16886972d` (`7df41c4`)
- **Immutable Remediation Code Commit (`src/ scripts/ tests/ prisma/`)**: **`e9c2ffc3b7c0a4f9c5a0bd2d66767d1dbe8966b5`** (`e9c2ffc`, `working_tree_dirty: false`)

### 1.2 Release & Manifest Lineage (`store_revision = 34`, `34` Monotonic Hash-Chained WAL Entries)

| Field | Preserved `rel.B01.rc1` (Audit Trail) | Candidate `rel.B01.rc2` (Remediated B01) | Candidate `rel.B02.rc1` (Primary Law & Sub-Regs) |
| :--- | :--- | :--- | :--- |
| **`release_id`** | `rel.B01.rc1` | **`rel.B01.rc2`** | **`rel.B02.rc1`** |
| **State / `user_decision`** | `READY_FOR_UAT` / `null` | `READY_FOR_UAT` / `null` | `READY_FOR_UAT` / `null` |
| **`code_commit`** | `3f1da6e243625f551d658a17d0c786c13dc74562` | **`e9c2ffc3b7c0a4f9c5a0bd2d66767d1dbe8966b5`** | **`e9c2ffc3b7c0a4f9c5a0bd2d66767d1dbe8966b5`** |
| **`supersession_lineage`** | *(Preserved baseline)* | `supersedes_release_id: "rel.B01.rc1"`, `supersedes_manifest_id: "mfst.b01.mwgj0yb3"`, `prior_chat_approval_preserved: true` | `previous_accepted_release_id: "rel.B01.rc2"` *(staging candidate chain only)* |
| **`manifest_id`** | `mfst.b01.mwgj0yb3` | **`mfst.b01.mwhh9ec3`** | **`mfst.b02.mwhhbx89`** |
| **`inventory_snapshot_id`** | `inv.b01.mwgj0yb3` | **`inv.b01.mwhh9ec3`** | **`inv.b02.mwhhbx89`** |
| **`inventory_hash` (`SHA-256`)** | `73bae3ac43010507f888d5d22f58143749d5ca1692ad14824f33b6d7a200e60d` | `73bae3ac43010507f888d5d22f58143749d5ca1692ad14824f33b6d7a200e60d` | `069b9d7f562ccf3ff074e132ab86159bb115b2fc446c842f1382fa3a7677d8ce` |
| **`manifest_hash` (`SHA-256`)** | `2059e51ee9bf2ba3fe26fc8f0b6abb4e5ed942be0a2e3cace8df116a41c2e444` | **`0dd66c57f27aa93844083267cba1a5372e4b61b9c3d598f7d508796abf160e4c`** | **`54bd47c5a67cee4684f61795c46289c5c2d296180475f731fd5f75cc608cf3b7`** |
| **Total Reconciled Candidates** | `5,150` (`0` silent drops) | **`5,150`** (`0` silent drops, `0` failed) | **`7,335`** (`7,323` Drive + `12` Customs RAR; `0` silent drops, `0` failed) |
| **Processed Admitted Candidates** | `4,578` | **`4,578`** (`4,563` new + `2` reused + `13` attached) | **`2,024`** (`1,837` new + `4` reused + `183` attached) |
| **Canonical Works Created / Reused** | `4,563` / `532` (incl. `531` stubs) | **`4,563` created / `381` reused** (`0` stubs) | **`9,093` created** (incl. section-level `Provision` works) / **`20` reused** |
| **Passages (Own / Chain)** | `9,744` (incl. `531` `ext.dep.*`) | **`10,665`** (`0` `ext.dep.*`) | **`12,770` own / `23,435` cumulative** (`0` `ext.dep.*`) |
| **Accepted Assertions (Own / Chain)** | `35,805` (incl. `1,548` mislinks) | **`33,366`** (`0` mislinks) | **`24,012` own / `57,378` cumulative** (`0` mislinks) |
| **Quarantined Unresolved Citations** | `21` (`rel.B01.rc1` origin) | **`1,389` cumulative** (`21` `rc1` + `1,368` `rc2`; `8` shared/overwritten IDs -> `1,381` active keys before `B02`) | **`1,421` cumulative** (`21` `rc1` + `1,368` `rc2` + `32` `b02`; `100%` `usable_as_legal_evidence: false`) |

---

## 2. Itemised Quarantine Ledger, Suppressed Graph Links & Coverage Impact (`1,421` Items)

Full itemised ledger (`ledger_index: 1..1421`, including citing work, origin URI, raw citation, governing instrument, `suppressed_graph_link`, and projection-exclusion booleans): [`quarantine_ledger_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/quarantine_ledger_rc2_b02.json).

### 2.1 Policy & Projection-Exclusion Verification
- `all_marked_unresolved_quarantined`: **`true` (`1,421 / 1,421`)**
- `all_marked_usable_as_legal_evidence_false`: **`true` (`1,421 / 1,421`)**
- `all_retained_in_audit_trail`: **`true` (`1,421 / 1,421` — `0` deleted)**
- `zero_leakage_into_trusted_passages_or_graph_edges`: **`true`**
- `zero_suppressed_citation_edges_in_projections`: **`true` (`0 / 1,421` suppressed `(source_work_id -> target_hint)` edges in `rel.B01.rc2` or `rel.B02.rc1` graph snapshots)**
- `rc2_synthetic_ext_dep_passages` / `b02_chain_synthetic_ext_dep_passages`: **`0` / `0`**
- **Cross-Batch Transparency Note**: `2` of the `850` distinct `target_hint` IDs quarantined during `rel.B01.rc2` (`subreg.th.rc.royal_decree.736` and `subreg.th.rc.royal_decree.773`) subsequently received **authentic Royal Gazette PDF representations** in `rel.B02.rc1` (`RD/SBT/2021_RD_736_...pdf` and `RD/CIT/2023_RD_773_...pdf`). Per Instruction 1, their `rel.B01.rc2` `UnresolvedReferenceRecord` entries (`uref.work.th.rd.gk_0702_1493_2026_c76989ef.3` and `uref.work.th.rd.gk_0702_6077_2025_47ed9f4a.1`) remain retained in the audit ledger with `usable_as_legal_evidence: false` and their B01->B02 citation edges remain suppressed (`0` edges) until explicitly reconciled in a post-review release.

### 2.2 Coverage Impact of Quarantine Across `rel.B01.rc2` & `rel.B02.rc1`

| Release | Total Canonical Works in Scope | Works with `0` Quarantined Citations | Works Citing `>= 1` Quarantined External Target | Active Verified Graph Assertions | Suppressed Unverified Graph Links | Runtime Retrieval Impact |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| **`rel.B01.rc2`** (Tax Rulings) | `4,561` unique `TaxRuling` works (`4,578` files) | **`3,734` (`81.87%`)** | `827` (`18.13%`) | **`33,366`** | `1,368` (`INTERPRETS_OR_CITES_PROVISION`) | **100% (`4,561 / 4,561`)** of tax rulings remain retrievable via their own verbatim `requester_facts` and `official_conclusion` passages; only the unverified external target node/edge is withheld from legal evidence. |
| **`rel.B02.rc1`** (Primary Law & Sub-Regs) | `9,005` `B02` canonical works (`2,024` files) | **`8,973` (`99.64%`)** | `32` (`0.36%`) | **`24,012` own / `57,378` chain** | `32` (`ISSUED_UNDER` enabling-statute links) | **100%** of admitted `B02` statutory/subordinate passages remain retrievable with SHA-256 PDF page provenance; `32` enabling-statute links await canonical parent matching. |

### 2.3 Breakdown of All `1,421` Quarantined Items by Reason & Release Origin
- **By Release Origin**: `rel.B01.rc1` (preserved baseline): **`21`** | `rel.B01.rc2`: **`1,368`** | `rel.B02.rc1`: **`32`** -> **`1,421` Total** (`850` distinct `target_hint` IDs across `876` citing works).

| Quarantine Reason | Count | Suppressed Graph Link Predicate |
| :--- | ---: | :--- |
| External non-Revenue-Code statutory/subordinate provision cited in ruling; isolated from Revenue Code while verbatim target text is unverified | `621` | `INTERPRETS_OR_CITES_PROVISION` |
| Civil and Commercial Code (`ป.พ.พ.`) provision cited in tax ruling; kept strictly separate from Revenue Code while CCC text is unverified | `241` | `INTERPRETS_OR_CITES_PROVISION` |
| External standalone Act (`พระราชบัญญัติ...`) cited in ruling; quarantined explicitly as unresolved dependency | `189` | `INTERPRETS_OR_CITES_PROVISION` |
| Section belongs to numbered Royal Decree (not Revenue Code; e.g., RD `244` s. `3(5)` in Ruling `0811/13980`); quarantined until verbatim Royal Decree text is verified | `129` | `INTERPRETS_OR_CITES_PROVISION` |
| Numbered Royal Decree cited in ruling without verified verbatim text in `B01` staging | `56` | `INTERPRETS_OR_CITES_PROVISION` |
| Cited Revenue Code section (repealed historical provision: `มาตรา 77/10`, `66 ตรี`, `8 ทวิ`, `7 ฉ`, `71/1`) absent from current consolidated text | `41` | `INTERPRETS_OR_CITES_PROVISION` |
| Royal Decree section citation without decree number (`มาตรา ... แห่งพระราชกฤษฎีกา`) | `33` | `INTERPRETS_OR_CITES_PROVISION` |
| Enabling statute citation (`อาศัยอำนาจตามความใน...`) in `B02` subordinate legislation pending canonical statute match | `32` | `ISSUED_UNDER` |
| Departmental Order (`คำสั่งกรมสรรพากร ที่ ท.ป. ...`) quarantined until verbatim text is verified | `21` | `INTERPRETS_OR_CITES_PROVISION` |
| Ministerial Regulation (`กฎกระทรวง...`) provision quarantined until verbatim text is verified | `19` | `INTERPRETS_OR_CITES_PROVISION` |
| Director-General VAT Notification (`ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม...`) quarantined until verbatim text is verified | `18` | `INTERPRETS_OR_CITES_PROVISION` |
| External non-tax sector statute cited in ruling background (`พ.ร.บ. ธนาคารออมสิน`, `พ.ร.บ. อาคารชุด`, etc.) | `13` | `INTERPRETS_OR_CITES_PROVISION` |
| Legacy `rel.B01.rc1` unresolved statutory target text (`STATUTORY_TARGET_TEXT_NOT_VERIFIED_QUARANTINED`) preserved in audit ledger | `8` | `INTERPRETS_OR_CITES_PROVISION` |
| **Total Retained in Quarantine Audit Ledger** | **`1,421`** | **`0` edges in trusted graph** |

---

## 3. Excluded-Data Coverage & Itemised `5,275`-File OCR Recovery Queue

- **Excluded & Deferred Coverage Export**: [`excluded_and_deferred_coverage_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/excluded_and_deferred_coverage_rc2_b02.json)
- **OCR Recovery Queue Summary**: [`ocr_recovery_queue_summary.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/ocr_recovery_queue_summary.json)
- **Full Itemised `5,275`-File OCR Queue (`queue_index: 1..5275` with SHA-256, bytes, page routes & priority tier)**: [`ocr_recovery_queue_b02_5275.json.gz`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/ocr_recovery_queue_b02_5275.json.gz)

### 3.1 Candidate Accounting Across Both Batches (`0` Silent Drops, `0` Fabricated Text)
- **`rel.B01.rc2` (`5,150` files)**: `4,563` `PUBLISHED_NEW` + `2` `REUSED_EXISTING` + `13` `ATTACHED_REPRESENTATION` (`4,578` admitted rulings = `100%` of `Rulings/`, including `1,426` backfill) + `572` `REJECTED_OUT_OF_SCOPE` (`570` non-ruling RD tax regulations routed to `B02` + `2` root `.gsheet` indexes) + **`0` `DEFERRED_WITH_REASON`**.
- **`rel.B02.rc1` (`7,335` candidates = `7,323` Drive files + `12` unpacked Customs RAR PDFs)**: `1,837` `PUBLISHED_NEW` + `4` `REUSED_EXISTING` + `183` `ATTACHED_REPRESENTATION` (`2,024` admitted verified PDFs) + `36` `REJECTED_OUT_OF_SCOPE` (`18` CSV/index files, `15` foreign Myanmar reference laws, `2` `.rar` container wrappers whose `12` inner PDFs were unpacked, `1` 0-page stub) + **`5,275` `DEFERRED_WITH_REASON`**.

### 3.2 Measured `5,275`-File OCR Recovery Queue Breakdown (`41,247` Physical Pages, `2.4237 GB`)

| Priority Tier | Files | Physical Pages | Bytes | Scope & Recovery Purpose |
| :--- | ---: | ---: | ---: | :--- |
| **`P0_UNLOCKS_QUARANTINED_CITATION`** | `1` | `1` | `653,474` | Directly matches a currently quarantined `B01`/`B02` subordinate citation |
| **`P1_CORE_TAX_CORPORATE_STATUTE`** | `35` | `206` | `9,382,689` | Historical Revenue Code Royal Decrees (`RD 11`), Ministerial Regs (`MR 126`), Petroleum Income Tax Act (`2514`), core tax/corporate instruments |
| **`P2_SECTORAL_PRIMARY_LAW`** | `3,311` | `29,663` | `1,005,655,701` | Sectoral Acts & Royal Decrees in `Primary Law/`, `Council of State (กฤษฎีกา)`, `Parliament/` |
| **`P3_HISTORICAL_GAZETTE_GENERAL`** | `1,928` | `11,377` | `1,407,976,160` | Historical Royal Gazette image scans & Excise/Customs schedules (`40,172` image-OCR pages + `1,075` corrupt legacy-font pages across queue) |
| **Total Queued (`DEFERRED_WITH_REASON`)** | **`5,275`** | **`41,247`** | **`2,423,668,024`** | **`0` fabricated or inferred characters admitted** |

### 3.3 Folder-Level OCR Queue Distribution

| Source Folder | Deferred Files | Total Pages | Image-OCR Pages | Legacy-Font Pages |
| :--- | ---: | ---: | ---: | ---: |
| `Primary Law` | `4,591` | `36,938` | `36,031` | `907` |
| `Excise - Excise Department` | `421` | `2,581` | `2,581` | `0` |
| `RD` (`CIT` `38`, `General` `62`, `VAT` `24`, `WHT` `11`, `SBT` `6`, `PIT` `3`) | `144` | `684` | `533` | `151` |
| `Customs - Customs Department` (+ `1` unpacked RAR scan) | `69` | `651` | `651` | `0` |
| `Council of State (กฤษฎีกา)` | `36` | `161` | `144` | `17` |
| `Parliament` | `10` | `217` | `217` | `0` |
| `Misc Royal Decrees` & `Misc Gazette` | `4` | `15` | `15` | `0` |
| **Total** | **`5,275`** | **`41,247`** | **`40,172`** | **`1,075`** |
