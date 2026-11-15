# Candidate Manifests (`rel.B01.rc2`, Limited-Scope `rel.B02.rc1`, & Proposed `rel.B02.rc2`), Quarantine Ledger & `5,275`-Item OCR Recovery Plan (Instructions 2 & 3)

> [!WARNING]
> **Explicit `B02` Scope Classification — `LIMITED-SCOPE CANDIDATE` (`Instruction 3`)**
> **`rel.B02.rc1` is a `LIMITED-SCOPE CANDIDATE`, NOT complete Batch 02 corpus coverage:**
> - **Admitted & Verified Now**: **`2,024 / 7,335`** physical candidates (**`27.59%`** of files; `12,851` `B02` passages, `9,093` canonical statute/section works) with verified native-PDF text and SHA-256 page provenance.
> - **Deferred Pending Verified OCR (`DEFERRED_WITH_REASON`)**: **`5,275 / 7,335`** physical PDFs (**`71.92%`** of files; `41,247` physical pages, `2.4237 GB`) consisting of image-only historical Royal Gazette scans (`40,172` pages) and unmapped legacy-font PDFs (`1,075` pages), with **`0` fabricated or inferred characters**.
> - **Rejected Out-of-Scope**: **`36 / 7,335`** (`0.49%` — CSV index sheets, foreign Myanmar laws, `.rar` outer wrappers whose `12` inner PDFs were unpacked, and `1` zero-page stub).
> - **Gate Posture**: Candidate preparation in isolated staging only — **formal Owner UAT has NOT been opened, no automated test pass replaces human legal review, and no production promotion is authorised**.

---

## 1. Immutable Code & Candidate Manifest Identifiers

- **Candidate Package Summary**: [`staging_rc2_b02_candidate_package.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_rc2_b02_candidate_package.json)
- **Separate Hashed RD 736/773 Proposal Receipt**: [`rd736_773_proposed_candidate_receipt.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/rd736_773_proposed_candidate_receipt.json) & [`Royal_Decrees_736_773_Independent_Verification_and_Candidate_Proposal.md`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/Royal_Decrees_736_773_Independent_Verification_and_Candidate_Proposal.md)
- **Untouched Production Base (`main`)**: `7df41c4ca1f63059b8d187e4014f2cb16886972d` (`canonical-state.json.gz` verified untouched at `SHA-256 = 08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9`)
- **Immutable Remediation Code Commit (`src/ scripts/ tests/ prisma/`)**: **`3c3034763128f22865c10c88274f468c5752bc09`** (`3c30347`, `working_tree_dirty: false`)

### 1.1 Release & Manifest Lineage (`store_revision = 34` in Current Store; `36` in Isolated Proposal Store)

| Field | Preserved `rel.B01.rc1` (Audit Baseline) | Candidate `rel.B01.rc2` (Full-Scope B01) | Candidate `rel.B02.rc1` (**`LIMITED-SCOPE CANDIDATE`**, Suppressed) | Separate Proposal `rel.B02.rc2` (Isolated RD 736/773 Proposal) |
| :--- | :--- | :--- | :--- | :--- |
| **Scope Classification** | Historical Baseline | `FULL_BATCH_CANDIDATE` (`4,578 / 4,578` in-scope rulings) | **`LIMITED_SCOPE_CANDIDATE`** (`2,024 / 7,335` files; `5,275` deferred) | **`LIMITED_SCOPE_CANDIDATE`** (`rel.B02.rc1` + verified RD 736/773 section links) |
| **State / `user_decision`** | `READY_FOR_UAT` / `null` | `READY_FOR_UAT` / `null` | `READY_FOR_UAT` / `null` | `READY_FOR_UAT` / `null` |
| **`code_commit`** | `3f1da6e243625f551d658a17d0c786c13dc74562` | **`3c3034763128f22865c10c88274f468c5752bc09`** | **`3c3034763128f22865c10c88274f468c5752bc09`** | **`3c3034763128f22865c10c88274f468c5752bc09`** |
| **`supersession_lineage`** | *(Preserved intact)* | `supersedes_release_id: "rel.B01.rc1"`, `prior_chat_approval_preserved: true` | `previous_accepted_release_id: "rel.B01.rc2"` | `supersedes_release_id: "rel.B02.rc1"` (`mfst.b02.mwhjhg12`) |
| **`manifest_id`** | `mfst.b01.mwgj0yb3` | **`mfst.b01.mwhjetdw`** | **`mfst.b02.mwhjhg12`** | **`mfst.b02.rc2_rd736_773`** |
| **`inventory_hash` (`SHA-256`)** | `73bae3ac43010507f888d5d22f58143749d5ca1692ad14824f33b6d7a200e60d` | `73bae3ac43010507f888d5d22f58143749d5ca1692ad14824f33b6d7a200e60d` | `069b9d7f562ccf3ff074e132ab86159bb115b2fc446c842f1382fa3a7677d8ce` | `e90924efd8aed175fe49bc48845c09e9d2e499cdc1dbf035a6b0fbd0e7b2c3fa` |
| **`manifest_hash` (`SHA-256`)** | `2059e51ee9bf2ba3fe26fc8f0b6abb4e5ed942be0a2e3cace8df116a41c2e444` | **`c3dfcafdf156404a578b9cbd7aee0534a7d4eb9f276382b34e5dd86ba994ead3`** | **`c0b6b5d9754e3a45d15035d2ffe116da73abbf2e252d8f017abfb51ab52aa0c8`** | **`a2f7ffa3d9b99a980ea642c02df493d7523c3ae4880053dd19827818e8d88ad6`** |
| **Passages (Own / Chain)** | `9,744` (incl. `531` stubs) | **`10,665`** (`0` stubs) | **`12,851` own / `23,516` chain** (`0` stubs) | **`12,855` own / `23,520` chain** (`0` stubs) |
| **Accepted Assertions (Own / Chain)** | `35,805` (incl. `1,548` mislinks) | **`33,366`** (`0` mislinks) | **`24,020` own / `57,386` chain** (`0` RD 736/773 links) | **`24,028` own / `57,394` chain** (`+8` verified RD 736/773 assertions) |
| **Quarantined Unresolved Items** | `21` | **`1,381` active** (`21` `rc1` + `1,368` `rc2`, `8` shared keys) | **`1,421` cumulative** (`100%` `usable_as_legal_evidence: false`) | **`1,421` cumulative** (`100%` `usable_as_legal_evidence: false`) |

---

## 2. Itemised Quarantine Ledger & Suppressed Graph Links (`1,421` Items)

Full itemised ledger (`ledger_index: 1..1421`): [`quarantine_ledger_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/quarantine_ledger_rc2_b02.json).
- **Invariants Verified**: `all_marked_unresolved_quarantined: true` (`1,421 / 1,421`), `all_marked_usable_as_legal_evidence_false: true` (`1,421 / 1,421`), `all_retained_in_audit_trail: true` (`0` deleted), `zero_leakage_into_trusted_passages_or_graph_edges: true`, and **`0` links to `subreg.th.rc.royal_decree.736` or `subreg.th.rc.royal_decree.773` in `rel.B01.rc2` or `rel.B02.rc1`**.
- **Breakdown by Reason (`1,421` Total)**: External non-RC statutory/subordinate citations (`621`), Civil and Commercial Code `ป.พ.พ.` (`241`), standalone external Acts (`189`), numbered Royal Decree section citations incl. RD `244` s. `3(5)` (`129`), numbered Royal Decrees incl. suppressed RD `736` & `773` (`56`), repealed historical RC sections (`41`), unnumbered Royal Decree refs (`33`), `B02` enabling-statute refs (`32`), Departmental Orders `ท.ป.` (`21`), Ministerial Regulations (`19`), DG VAT Notifications (`18`), non-tax sector Acts (`13`), and preserved `rel.B01.rc1` baseline entries (`8`).

---

## 3. Concrete Impact & Recovery Plan for the `5,275` Deferred `B02` Items (`Instruction 3`)

- **Full Itemised `5,275`-File Queue**: [`ocr_recovery_queue_b02_5275.json.gz`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/ocr_recovery_queue_b02_5275.json.gz) | **Summary**: [`ocr_recovery_queue_summary.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/ocr_recovery_queue_summary.json) | **Excluded Coverage**: [`excluded_and_deferred_coverage_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/excluded_and_deferred_coverage_rc2_b02.json)

### 3.1 Concrete Legal & Retrieval Impact While `5,275` Files Remain Deferred

| Legal Domain / Folder | Admitted Now (`rel.B02.rc1`) | Deferred (`DEFERRED_WITH_REASON`) | Concrete User / Legal Impact in `rel.B02.rc1` |
| :--- | ---: | ---: | :--- |
| **Core Revenue Code & Modern RD Tax Framework** (`verified-statutory-loader` + `RD/` native PDFs) | **`326` RC sections + `1,000+` modern RD decrees/regulations/orders** | `144` older `RD/` PDFs (`684` pages: `533` image scans, `151` legacy-font pages) | Current Revenue Code lookups, modern Royal Decrees/Ministerial Regs/`ท.ป.` orders, and bitemporal `มาตรา 65 ตรี` work **end-to-end**; older scanned RD notifications/decrees not in the verified statutory corpus abstain (`INSUFFICIENT_EVIDENCE`) or keep citing `B01` links quarantined rather than guessing. |
| **General Primary Law (`Primary Law/` Acts & Royal Decrees)** | `~680` modern native-layer Acts & Royal Decrees | **`4,591` files (`36,938` pages: `36,031` image scans, `907` legacy-font)** | Pre-digital Royal Gazette Acts/Decrees (pre-`~2555` image scans) and non-tax sectoral statutes are **absent from `rel.B02.rc1` retrieval**; `189` external Act citations and `129` older Royal Decree section citations from `B01` remain quarantined (`usable_as_legal_evidence: false`). |
| **Excise & Customs Tariffs / Notifications** (`Excise/`, `Customs/`) | `~310` modern native-layer PDFs (incl. `11` unpacked Customs RAR PDFs) | **`490` files (`3,232` image-scan pages: `421` Excise + `69` Customs)** | Historical Excise/Customs scanned schedules cannot be answered from `rel.B02.rc1` and deterministically return `INSUFFICIENT_EVIDENCE`. |
| **Council of State, Parliament & Misc Gazette** | Modern native-layer opinions & draft bills (`DRAFT_BILL` isolated) | **`50` files (`393` pages)** | Older scanned Council of State (`กฤษฎีกา`) opinions remain unavailable until verified OCR completion (`B09` / `B02-OCR`). |

### 3.2 Concrete 4-Wave Verified OCR & Font-Remapping Recovery Plan (`rel.B02.ocr_wave1` .. `wave4`)

No deferred file may enter trusted retrieval until it passes the 6-stage verification gate: **(1) Page-level routing** (`40,172` raster scan pages vs `1,075` legacy PUA/WinAnsi Thai font-table pages) -> **(2) Deterministic glyph-map recovery or Thai legal OCR** (preserving Thai/Arabic digits, section numbers `มาตรา`/`ข้อ`, and Gazette headers) -> **(3) Automated token & checksum gate** (`critical_token_confidence >= 0.99` on section numbers, dates, tax rates, and negation particles `ไม่`/`เว้นแต่`; `0` inferred lines) -> **(4) Human legal sampling & low-confidence adjudication** -> **(5) Hashed incremental release staging** (`rel.B02.ocr_waveN`, preserving prior manifests) -> **(6) Explicit cross-batch quarantine reconciliation** (requiring separate review before flipping any `UnresolvedReferenceRecord`).

| Recovery Wave | Queue Priority Tier | Files | Pages | Scope & Exit Milestone |
| :--- | :--- | ---: | ---: | :--- |
| **Wave 1 (`P0` + `P1`)** | `P0_UNLOCKS_QUARANTINED_CITATION` (`1`) + `P1_CORE_TAX_CORPORATE_STATUTE` (`35`) + `144` remaining `RD/` tax scans | **`180`** | **`891`** | Completes **100% of Revenue Department (`RD/`) tax statutes & regulations** and unlocks quarantined core tax citations (`< 1` batch run + 100% human section-header check). |
| **Wave 2 (Legacy-Font Remap)** | Remaining `Primary Law` & `Council of State` corrupt legacy-font PDFs (`924` pages outside `RD/`) | **`~152`** | **`924`** | Deterministic font-cmap decoding + dual-OCR cross-check (highest accuracy/lowest cost; eliminates all `1,075` legacy-font pages). |
| **Wave 3 (`P2` Sectoral Law)** | `P2_SECTORAL_PRIMARY_LAW` image scans (`Primary Law/Acts`, `Royal Decrees`, `Council of State`, `Parliament`) | **`~3,015`** | **`28,055`** | Restores historical enacted Acts & Royal Decrees; unlocks quarantined external Act (`189`) & older Royal Decree (`129`) references upon legal review. |
| **Wave 4 (`P3` Excise/Customs & Archival Gazette)** | `P3_HISTORICAL_GAZETTE_GENERAL` (`421` Excise, `69` Customs, archival Gazette schedules) | **`1,928`** | **`11,377`** | Completes `100%` (`7,299 / 7,299` in-scope `B02` files) so `B02` can graduate from `LIMITED_SCOPE_CANDIDATE` to `FULL_BATCH_CANDIDATE`. |
