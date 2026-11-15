# Pre-UAT Gate Evidence Package & Dodo Independent Review Handover (Instruction 4)

> [!IMPORTANT]
> **Gate Posture — Evidence Submitted Prior to Opening Formal Owner UAT**
> Per Owner Instruction 4 (`2026-11-15`), **neither formal Owner UAT nor production promotion has been opened or authorised**. All candidates remain in isolated staging (`state = READY_FOR_UAT`, `user_decision = null`, `active_release_id = null`), `main` remains untouched at `7df41c4ca1f63059b8d187e4014f2cb16886972d`, and [`canonical-state.json.gz`](file:///d:/Code/REG24/data/knowledge-store/canonical-state.json.gz) remains untouched (`SHA-256 = 08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9`).

---

## 1. Full Immutable Identifiers (`Instruction 4.1`)

| Artifact / Layer | Identifier | Cryptographic Hash (`SHA-256`) / Commit |
| :--- | :--- | :--- |
| **Production Baseline (`main`)** | `main` (untouched) | `7df41c4ca1f63059b8d187e4014f2cb16886972d` |
| **Remediation Code Commit (`src/ scripts/ tests/ prisma/`)** | `review/b01-rc2-b02-rc1-staging` | **`e9c2ffc3b7c0a4f9c5a0bd2d66767d1dbe8966b5`** |
| **Preserved `rel.B01.rc1` Manifest** | `mfst.b01.mwgj0yb3` (`inv.b01.mwgj0yb3`) | `2059e51ee9bf2ba3fe26fc8f0b6abb4e5ed942be0a2e3cace8df116a41c2e444` |
| **Candidate `rel.B01.rc2` Manifest** *(supersedes `rel.B01.rc1` transparently upon UAT)* | **`mfst.b01.mwhh9ec3`** (`inv.b01.mwhh9ec3`) | **Inventory**: `73bae3ac43010507f888d5d22f58143749d5ca1692ad14824f33b6d7a200e60d`<br>**Manifest**: **`0dd66c57f27aa93844083267cba1a5372e4b61b9c3d598f7d508796abf160e4c`** |
| **Candidate `rel.B02.rc1` Manifest** | **`mfst.b02.mwhhbx89`** (`inv.b02.mwhhbx89`) | **Inventory**: `069b9d7f562ccf3ff074e132ab86159bb115b2fc446c842f1382fa3a7677d8ce`<br>**Manifest**: **`54bd47c5a67cee4684f61795c46289c5c2d296180475f731fd5f75cc608cf3b7`** |
| **Neo4j `374f4f7e` Read-Only Receipt** | [`neo4j_374f4f7e_readonly_verification.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/neo4j_374f4f7e_readonly_verification.json) | `667dd671fc558e83f6f7db4b7f43eadee29fd388402375165a10ef9d806077ab` |

---

## 2. Recovery Plan, Defect Register & Quarantine Ledger (`Instruction 4.2`)

- **Recovery Plan & Complete 7-Item Defect Register (`DEF-B01-01`..`07`)**: [`B01_Defect_Register_and_Recovery_Plan.md`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/B01_Defect_Register_and_Recovery_Plan.md)
- **Candidate Manifests, Coverage Impact & `5,275`-Item OCR Queue**: [`Candidate_Manifests_and_Quarantine_Ledger_rc2_B02.md`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/Candidate_Manifests_and_Quarantine_Ledger_rc2_B02.md)
- **Neo4j `374f4f7e` Status, 30-Day Pause Window & Option A Design**: [`Neo4j_and_Storage_Verification_Report.md`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/Neo4j_and_Storage_Verification_Report.md)
- **Full Itemised Quarantine Ledger (`1,421` entries)**: [`quarantine_ledger_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/quarantine_ledger_rc2_b02.json)

---

## 3. Independent Regression & Blind Source-to-Answer Test Results (`Instruction 4.3`)

Full raw blind-audit ledger: [`blind_validation_results_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/blind_validation_results_rc2_b02.json).

1. **Wrong-Instrument Regression (`DEF-B01-02` — [`b01-defects-regression.test.ts`](file:///d:/Code/REG24/tests/knowledge/b01-defects-regression.test.ts#L86-L218) + `BLIND-01`)**:
   - **Ruling `กค 0811/13980` (`https://www.rd.go.th/22874.html`)**: Verified **`0`** graph links to `prov.th.rc.3` (Revenue Code s. 3) and **`0`** links to `prov.th.rc.491` (Revenue Code s. 491). Section `3(5)` of Royal Decree No. 244 (`subreg.th.rc.royal_decree.244`) and Section `491` of the Civil and Commercial Code (`ป.พ.พ.`) are cleanly isolated and quarantined (`usable_as_legal_evidence: false`), while genuine Revenue Code citations (`มาตรา 91/2 (6)`) remain linked.
   - Tested across Royal Decree No. 10, CCC Sections `587`, `1236`, `1238`, standalone Acts (`พ.ร.บ. ส่งเสริมการลงทุน`), and all 17 Pali ordinals (`ทวิ`..`อัฏฐารส`, including `มาตรา 3 เตรส` in `BLIND-21`): **`1,548` mislinked `prov.th.rc.*` edges reduced to `0`**.
2. **Mixed Facts / Ruling Regression (`DEF-B01-01` — [`b01-defects-regression.test.ts`](file:///d:/Code/REG24/tests/knowledge/b01-defects-regression.test.ts#L35-L84) + `BLIND-01..04, 11`)**:
   - Audited all `4,650` raw records: all **`794`** identical `facts === ruling` records plus **`5`** embedded-conclusion records (`24875` / `กค 0706/พ./10877`, `25101`, `25222`, `25224`, `32880`) are cleanly split into separate `requester_facts` and `official_conclusion` passages (`0` identical `facts === ruling` remaining); `1` genuine inquiry-only file (`30677`) is isolated in `requester_facts` with `0` fabricated conclusion.
3. **Independent 6-Dimension Blind Source-to-Answer Suite ([`blind-audit.ts`](file:///d:/Code/REG24/src/core/knowledge/blind-audit.ts))**:
   - **`rel.B01.rc2`**: **`20 / 20` (`100%`)** passed across `conclusion_accuracy` (`1.0`), `condition_fidelity` (`1.0`), `exception_fidelity` (`1.0`), `date_and_version_accuracy` (`1.0`), `citation_instrument_precision` (`1.0`), and `source_open_and_verbatim_support` (`1.0`).
   - **`rel.B02.rc1`**: **`26 / 26` (`100%`)** passed across all 6 dimensions, with `0` synthetic placeholder citations, `0` quarantined items used as legal evidence, and `0` mislinked instruments.

---

## 4. Source Fidelity, Statutory Versions, Concurrency, Persistence, Re-Import & Rollback (`Instruction 4.4`)

| Verification Pillar | Verification Method & Script / Test | Verified Evidence |
| :--- | :--- | :--- |
| **Source Fidelity & Checksums** | [`stage-b01-b02-isolated.ts`](file:///d:/Code/REG24/scripts/stage-b01-b02-isolated.ts#L565-L625) + `BLIND-01..26` | `4,710 / 4,710` distinct artifacts in `rel.B01.rc2` and `6,746 / 6,746` in `rel.B02.rc1` carry verified 64-char SHA-256 digests; `10,665 / 10,665` (`rc2`) and `23,435 / 23,435` (`b02`) passages resolve to real `origin_uri` + `artifact_id` locators with verbatim substring support. |
| **Statutory Versions & Bitemporality** | [`verified-statutory-loader.ts`](file:///d:/Code/REG24/src/core/data/verified-statutory-loader.ts) + `B01-U05A/B`, `B02-U03A/B`, `BLIND-15/16` | `326` verbatim Revenue Code sections + `155` verified subordinate/amendment works; `prov.th.rc.65_ตรี` preserves both `ver.th.rc.65_ตรี.v1_pre2019` (`1939-04-01` .. `2019-03-19`) and `ver.th.rc.65_ตรี.v2_current` (`2019-03-20` .. open, post-Amendment Act No. 48 B.E. 2562). |
| **Multi-Process Concurrency & WAL** | [`concurrency-and-recovery.test.ts`](file:///d:/Code/REG24/tests/knowledge/concurrency-and-recovery.test.ts) (`5/5` OS child-process tests) | `0` lost updates across `5/5` 2-process barrier races; deterministic `409 Conflict` on stale revisions & conflicting UAT approvals; `20/20` unique monotonic hash-chained WAL `seq` under 4-process contention; `34/34` monotonic WAL `seq` (`1..34`) in combined staging store. |
| **Cold-Restart Persistence & Crash Recovery** | [`concurrency-and-recovery.test.ts`](file:///d:/Code/REG24/tests/knowledge/concurrency-and-recovery.test.ts#L280-L372) + [`B02.test.ts`](file:///d:/Code/REG24/tests/knowledge/B02.test.ts) | Fresh `DurableKnowledgeStore` instantiation from disk preserves identical works, passages, assertions, lexical/vector/graph projections, and rolls forward interrupted `.staged-commits/` journals cleanly; `/tmp` serverless promotion blocked with `422`. |
| **Duplicate / Idempotent Re-Import** | [`stage-b01-b02-isolated.ts`](file:///d:/Code/REG24/scripts/stage-b01-b02-isolated.ts#L198-L237) (`[8/8]`) | Full replay of `rel.B01.rc2` (`4,578` docs) and `rel.B02.rc1` (`2,024` docs) returned `idempotent_replay: true` with `delta_works = 0`, `delta_passages = 0`, `delta_assertions = 0`, `delta_vectors_rc2 = 0`, `delta_vectors_b02 = 0`. |
| **Non-Destructive Rollback** | [`stage-b01-b02-isolated.ts`](file:///d:/Code/REG24/scripts/stage-b01-b02-isolated.ts#L238-L269) (`[8/8]` disposable clone) | Rolling back `rel.B02.rc1 -> ROLLED_BACK` kept shared `prov.th.rc.65_ตรี` intact for `rel.B01.rc2`; rolling back `rel.B01.rc2 -> ROLLED_BACK` kept preserved `rel.B01.rc1` (`9,744` passages, `manifest_hash = 2059e51ee...`) 100% intact. |

---

## 5. Proposed Owner UAT Case Suite (`20` `rel.B01.rc2` + `20` `rel.B02.rc1` = `40` Cases — `Instruction 4.6`)

Full machine-readable UAT sheets (`owner_result: null` on all 40 cases): [`proposed_uat_cases_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/proposed_uat_cases_rc2_b02.json).

### 5.1 Proposed `rel.B01.rc2` UAT Cases (`20` Cases — Automated Precheck `20 / 20 PASS`)
| Case ID | Category | Prompt / Scenario Summary | Expected Status & Key Verifications |
| :--- | :--- | :--- | :--- |
| `B01-U01A` / `U01B` | `legal_lookup` | Exact lookup of `กค 0702/636` (Arabic digits vs. Thai digits with spaces `กค ๐๗๐๒ / ๖๓๖`) | `ANSWERED`; cites `กค 0702/636`, `5 กุมภาพันธ์ 2569`, `มาตรา 80/1 (4)`, `ร้อยละ 0` |
| `B01-U02A` / `U02B` | `fact_pattern` | Foreign grant VAT `0%` (`กค 0702/636`) & joint-venture film IP export via internet (`กค 0702/1230`) | `ANSWERED`/`CONDITIONAL`; exact ruling + VAT provision match |
| `B01-U03A` / `U03B` | `comparison` | Compare `กค 0702/1903` vs. `กค 0702/634` (animal feed VAT exemption vs. 96.5% gold jewelry) & `กค 0702/1903` vs. `กค 0702/1603` (DLD registration vs. import permit) | `ANSWERED`; contrasts opposite legal outcomes & regulatory conditions accurately |
| `B01-U04A` / `U04B` | `role_separation` | Distinguish `ข้อเท็จจริงและประเด็นของผู้ขอหารือ` vs. `แนววินิจฉัยของกรมสรรพากร` in `กค 0702/1494` (`47 ทวิ`) and `กค 0702/1491` (`79`) | `ANSWERED`; zero role mixing (`DEF-B01-01` verification) |
| `B01-U05A` / `U05B` | `temporal_applicability` | `มาตรา 65 ตรี` as of `2018-06-30` (`v1_pre2019`) vs. `2025-01-15` (`v2_current`, Act No. 48 B.E. 2562) | `ANSWERED`; selects exact effective statutory version |
| `B01-U06A` / `U06B` | `provision_navigation` | Supporting provisions in `กค 0702/1248` (`มาตรา 65`, `ท.ป. 1/2528`, `ท.ป. 299/2561`) & `กค 0702/1493` (`พรฎ. 736`) | `ANSWERED`; accurate instrument identification without false RC links |
| `B01-U07A` / `U07B` | `duplicate_provenance` | Deduplicated companion representations (`กค 0706/2901`) & original source authenticity (`กค 0702/1230`) | `ANSWERED`; single canonical work with preserved provenance |
| `B01-U08A` / `U08B` | `source_fidelity` | Verbatim negation in `กค 0702/634` (`ไม่เข้าลักษณะ...`) & exact 3-installment figures in `กค 0702/1248` (`1,470,993,502.74`, `20M`/`80M`/`50M`) | `ANSWERED`; exact verbatim text & numbers preserved |
| `B01-U09A` / `U09B` | `missing_facts` | Ambiguous foreign grant (`กค 0702/636`) & unconfirmed DLD registration (`กค 0702/1903`) | `NEEDS_CLARIFICATION`/`CONDITIONAL`; refuses premature `ANSWERED` |
| `B01-U10A` / `U10B` | `nonexistent_lookup` | Non-existent rulings `กค 0702/999999` & `กค ๐๗๐๒/๘๘๘๘๘๘` | `INSUFFICIENT_EVIDENCE`; zero hallucinated ruling |

### 5.2 Proposed `rel.B02.rc1` UAT Cases (`20` Cases — Automated Precheck `20 / 20 PASS`)
| Case ID | Category | Prompt / Scenario Summary | Expected Status & Key Verifications |
| :--- | :--- | :--- | :--- |
| `B02-U01A` / `U01B` | `legal_lookup` | Revenue Code `มาตรา 80/1` (`0%` VAT) & Pali-ordinal `มาตรา 3 เตรส` (WHT) | `ANSWERED`; verbatim statutory text & Pali ordinal resolution |
| `B02-U02A` / `U02B` | `legal_lookup` | Revenue Code `มาตรา 47 ทวิ` (dividend tax credit) & `มาตรา 50 ทวิ` (WHT certificate) | `ANSWERED`; verbatim statutory text & origin URI |
| `B02-U03A` / `U03B` | `temporal_applicability` | Bitemporal `มาตรา 65 ตรี` (`2018-06-30` -> `v1_pre2019` vs. `2025-01-15` -> `v2_current`) | `ANSWERED`; no cross-batch temporal regression |
| `B02-U04A` / `U04B` | `provision_navigation` | Revenue Code Amendment Act No. 48 B.E. 2562 (`statute.th.rc_amendment_48_2562`) & Royal Decree No. 10 (`subreg.th.rc.royal_decree.10`) | `ANSWERED`; Gazette publication/effective date & authority |
| `B02-U05A` / `U05B` | `provision_navigation` | Ministerial Regulation No. 126 (`subreg.th.rc.min_reg.126`) & Royal Decree No. 342 (`subreg.th.rc.royal_decree.342`) | `ANSWERED`; subordinate tax legislation distinct from RC |
| `B02-U06A` / `U06B` | `role_separation` / `lookup` | Parliament draft Wealth Tax bill (`DRAFT_BILL`, not enacted law) & `มาตรา 65 ทวิ` depreciation rules | `ANSWERED`; enforces draft vs. enacted statute distinction |
| `B02-U07A` / `U07B` | `provision_navigation` | Departmental Order `ท.ป. 1/2528` (accrual basis) & DG VAT Notification No. 28 (`0%` VAT criteria) | `ANSWERED`; verified RD subordinate regulations |
| `B02-U08A` / `U08B` | `source_fidelity` | Verbatim VAT definitions (`มาตรา 77/1`) & VAT exemptions (`มาตรา 81`) | `ANSWERED`; exact statutory text & sub-clauses |
| `B02-U09A` / `U09B` | `missing_facts` / `lookup` | Cross-border payment under `มาตรา 70` without income category (`40(2)-(6)`) & SBT scope (`มาตรา 91/2`) | `NEEDS_CLARIFICATION` (`U09A`) / `ANSWERED` (`U09B`) |
| `B02-U10A` / `U10B` | `nonexistent_lookup` | Non-existent identifiers `กค 0702/999991` & `กค ๐๗๐๒/๘๘๘๘๘๑` | `INSUFFICIENT_EVIDENCE`; zero hallucination |

---

## 6. Known Limitations & Explicit Acceptance Criteria (`Instruction 4.6`)

### 6.1 Known Limitations (Transparently Disclosed)
1. **`5,275` Image-Only / Legacy-Font PDFs Deferred in `B02` (`41,247` pages)**: Historical Gazette scans (`5,088`, incl. `1` Customs RAR scan) and unmapped legacy-font PDFs (`187`) are held in `DEFERRED_WITH_REASON` ([`ocr_recovery_queue_b02_5275.json.gz`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/ocr_recovery_queue_b02_5275.json.gz)) until processed through the 6-stage verified OCR pipeline. Queries requiring a deferred historical statute return `INSUFFICIENT_EVIDENCE` or cite only verified admitted sources rather than guessing.
2. **`1,421` Unverified External Citations Quarantined (`usable_as_legal_evidence: false`)**: External provisions not yet ingested as verified text (e.g., Civil and Commercial Code `ป.พ.พ.` [`241`], Royal Decree 244 [`70`], repealed historical RC sections [`41`], external Acts [`189`], unverified departmental orders/notifications) are suppressed from graph traversal and legal evidence. Notably, `2` Royal Decrees quarantined during `B01` (`736` and `773`) now have verified Gazette PDFs in `B02` and can be formally linked once the Owner approves cross-batch reconciliation.
3. **Production Transactional & Graph Storage Cutover Pending (`Instruction 3`)**: Live Vercel still runs on untouched `main` (`7df41c4`) without managed PostgreSQL or an active AuraDB Professional target, and existing AuraDB Free instance `374f4f7e` remains offline (`DNS ENOTFOUND`, estimated 30-day Free-tier deletion window `~23–27 Nov 2026`). No production promotion is permitted on ephemeral serverless `/tmp`.
4. **`1` Genuine Inquiry-Only Record in `B01` (`ruling.th.rd.30677` / `กค 0706/6557`)**: Contains only requester facts/questions in the official source without a published RD conclusion; isolated strictly in `requester_facts` so it cannot be cited as an official ruling conclusion.

### 6.2 Clear Acceptance Criteria for Formal Owner UAT & Subsequent Promotion
1. **Pre-UAT Gate (To Open Formal Owner UAT)**:
   - Dodo completes independent review of the reachable branch/patch and audit ledgers with `0` unresolved `P0`/`P1` findings.
   - Product Owner confirms satisfaction with the defect register, `1,421`-item quarantine ledger, `5,275`-item OCR queue, and 40 proposed UAT cases, and explicitly authorises opening Owner UAT.
2. **Formal Owner UAT Sign-Off Criteria (`rel.B01.rc2` & `rel.B02.rc1`)**:
   - `100%` pass on all `P0` UAT cases (`18/20` in `B01`, `20/20` in `B02`) and `>= 95%` overall (`>= 19/20` per batch), with **zero** fabricated citations, **zero** wrong-instrument links, **zero** mixed facts/ruling passages, and **zero** quarantined items surfaced as legal evidence.
   - Explicit Owner UAT decision recorded against immutable `(release_id, manifest_hash, store_revision)` (`mfst.b01.mwhh9ec3` / `0dd66c57...` and `mfst.b02.mwhhbx89` / `54bd47c5...`), preserving `rel.B01.rc1` (`mfst.b01.mwgj0yb3`) in the supersession lineage.
3. **Production Promotion Gate (Separate Authorisation After UAT)**:
   - Existing AuraDB instance `374f4f7e` inspected/archived per Owner decision, Option A storage (`Managed PostgreSQL + Neo4j AuraDB Professional`) approved and provisioned, and Neo4j node/edge counts verified against manifest checksums (`Gate V06` / `AT12`).

---

## 7. Dodo Independent Review Access (`Instruction 4`)

All recovery reports, machine-readable ledgers, SQL DDL, and verification scripts are committed on isolated branch **`review/b01-rc2-b02-rc1-staging`** (leaving `main` untouched at `7df41c4`) and exported as a standalone Git patch:
- **In-Repo Review Bundle**: `docs/audit/dodo-review-rc2-b02/` (README + 3 recovery reports + JSON/GZ ledgers)
- **Standalone Patch**: [`reg24-rc2-b02-dodo-review.patch`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/reg24-rc2-b02-dodo-review.patch)
- **Reproduction Commands for Dodo**:
  ```bash
  git fetch origin review/b01-rc2-b02-rc1-staging && git checkout review/b01-rc2-b02-rc1-staging
  npx tsc --noEmit
  npx vitest run
  npx tsx scripts/verify-neo4j-374f4f7e-readonly.ts --out /tmp/neo4j_verify.json
  npx tsx scripts/stage-b01-b02-isolated.ts --staging-dir /tmp/reg24_dodo_staging --metrics-out /tmp/metrics.json --quarantine-out /tmp/quarantine.json
  ```
