# Pre-UAT Gate Evidence Package & Dodo Independent Review Handover (Instruction 3)

> [!IMPORTANT]
> **Gate Posture — Formal Owner UAT NOT Opened; Existing `20/20` (`100%`) Gate Restored & Enforced**
> 1. **No Formal Owner UAT Opened / No Promotion Authorised**: `rel.B01.rc2` (`FULL_BATCH_CANDIDATE`), `rel.B02.rc1` (**`LIMITED_SCOPE_CANDIDATE`**), and separate proposal `rel.B02.rc2` remain strictly in isolated staging (`state = READY_FOR_UAT`, `user_decision = null`, `active_release_id = null`). Production `main` (`7df41c4ca1f63059b8d187e4014f2cb16886972d`) and [`canonical-state.json.gz`](file:///d:/Code/REG24/data/knowledge-store/canonical-state.json.gz) (`08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9`) are untouched.
> 2. **UAT Threshold Discrepancy Resolved (`20 / 20 = 100%` Mandatory Pass Enforced)**: Our prior draft's `19/20` (`95%`) proposal has been **withdrawn**. Per [`02_OWNER_UAT_CHECKLIST.md`](file:///d:/Code/REG24/docs/knowledge/02_OWNER_UAT_CHECKLIST.md#L51-L53) (*"Pass: all mandatory cases pass ... Fail: one or more mandatory cases fail"*), **all `20 / 20` (`100%`) mandatory cases in each batch must pass**, enforced in code via `MANDATORY_UAT_CASE_FAILURE_422` and `INCOMPLETE_MANDATORY_UAT_PASS_422` ([`releases.ts`](file:///d:/Code/REG24/src/core/knowledge/releases.ts), [`evaluation.ts`](file:///d:/Code/REG24/src/core/knowledge/evaluation.ts)).
> 3. **Automated Tests Do NOT Replace Human Reviews**: Passing automated tests (`29/29` suites, `157/157` tests) does **not** substitute for independent technical review (Dodo) or independent human legal review by a qualified Thai tax/legal reviewer.

---

## 1. Review Gate Status Matrix (`Instruction 3`)

| Gate / Review Requirement | Current Status | Evidence / Blocker Before Opening Formal Owner UAT |
| :--- | :--- | :--- |
| **Mandatory UAT Threshold Policy** | **ALIGNED (`20/20 = 100%`)** | Enforces [`02_OWNER_UAT_CHECKLIST.md`](file:///d:/Code/REG24/docs/knowledge/02_OWNER_UAT_CHECKLIST.md#L51-L53) with `0` lowered gates; `19/20` pass attempts rejected with `422` in [`neo4j-readonly-verifier.test.ts`](file:///d:/Code/REG24/tests/knowledge/neo4j-readonly-verifier.test.ts). |
| **Open `P0` / `P1` Engineering Defects (Automated Staging)** | **`0` Open in Staging** *(Pending External Confirmation)* | `DEF-B01-01`..`07` remediated on `3c3034763128f22865c10c88274f468c5752bc09` (`29/29` test suites, `157/157` tests green); subject to Dodo & Owner confirmation. |
| **Automated Mandatory UAT Precheck (`20` B01 + `20` B02)** | **`20 / 20` (`100%`) B01 & `20 / 20` (`100%`) B02** | Automated precheck only (`owner_result: null` on all 40 cases in [`proposed_uat_cases_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/proposed_uat_cases_rc2_b02.json)). |
| **Independent Technical Review (Dodo)** | **`IN_PROGRESS / PENDING` (`false`)** | Dodo reviewing `origin/review/b01-rc2-b02-rc1-staging`; formal sign-off required before opening Owner UAT. |
| **Independent Human Legal Review** | **`PENDING` (`false`)** | Qualified human Thai tax/legal attestation required on role separation (`794 + 5` rulings), citation quarantine (`1,421` items), statutory versions, and RD 736/773 Gazette proposal (`rel.B02.rc2`). **Automated tests do NOT satisfy this gate.** |
| **Formal Owner UAT** | **`NOT_OPENED` (`false`)** | Awaits completion of Dodo technical review, human legal review, and explicit Owner instruction to open UAT. |

---

## 2. Exact Immutable Commit & Manifest Identifiers (`Instruction 3`)

| Layer / Candidate | Scope Classification | Identifier | Cryptographic Hash (`SHA-256`) / Commit |
| :--- | :--- | :--- | :--- |
| **Production Baseline (`main`)** | Untouched Live Baseline | `main` | `7df41c4ca1f63059b8d187e4014f2cb16886972d` |
| **Remediation Code Commit** | `src/ scripts/ tests/ prisma/` (`dirty: false`) | `review/b01-rc2-b02-rc1-staging` | **`3c3034763128f22865c10c88274f468c5752bc09`** |
| **Preserved `rel.B01.rc1` Baseline** | Audit Baseline (`wal.jsonl` `seq 1..14`) | `mfst.b01.mwgj0yb3` (`inv.b01.mwgj0yb3`) | `2059e51ee9bf2ba3fe26fc8f0b6abb4e5ed942be0a2e3cace8df116a41c2e444` |
| **Candidate `rel.B01.rc2`** | `FULL_BATCH_CANDIDATE` (`4,578` rulings; `0` deferred) | **`mfst.b01.mwhjetdw`** (`inv.b01.mwhjetdw`) | **Inventory**: `73bae3ac43010507f888d5d22f58143749d5ca1692ad14824f33b6d7a200e60d`<br>**Manifest**: **`c3dfcafdf156404a578b9cbd7aee0534a7d4eb9f276382b34e5dd86ba994ead3`** |
| **Candidate `rel.B02.rc1`** *(RD 736/773 suppressed)* | **`LIMITED_SCOPE_CANDIDATE`** (`2,024 / 7,335` admitted; `5,275` deferred scans) | **`mfst.b02.mwhjhg12`** (`inv.b02.mwhjhg12`) | **Inventory**: `069b9d7f562ccf3ff074e132ab86159bb115b2fc446c842f1382fa3a7677d8ce`<br>**Manifest**: **`c0b6b5d9754e3a45d15035d2ffe116da73abbf2e252d8f017abfb51ab52aa0c8`** |
| **Separate Proposal `rel.B02.rc2`** *(Isolated RD 736/773 section links)* | **`LIMITED_SCOPE_CANDIDATE`** (Isolated store `staging_proposed_b02_rc2_rd736_773`) | **`mfst.b02.rc2_rd736_773`** (`inv.b02.rc2_rd736_773`) | **Inventory**: `e90924efd8aed175fe49bc48845c09e9d2e499cdc1dbf035a6b0fbd0e7b2c3fa`<br>**Manifest**: **`a2f7ffa3d9b99a980ea642c02df493d7523c3ae4880053dd19827818e8d88ad6`** |
| **Neo4j `374f4f7e` Read-Only Receipt** | Fixed Target & Failure Verifier | [`neo4j_374f4f7e_readonly_verification.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/neo4j_374f4f7e_readonly_verification.json) | `8fda57b2a6f263d57342172d6dbeee5b31621f16c9c9cd39301ecfdca4b59e7f` |

---

## 3. Automated Test & Verification Evidence (`29 / 29` Suites, `157 / 157` Tests Passing)

- **Source-to-Answer Blind Accuracy ([`blind_validation_results_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/blind_validation_results_rc2_b02.json))**:
  - `rel.B01.rc2`: **`20 / 20` (`100%`)** across conclusion, condition, exception, date/version, citation-instrument precision, and verbatim source support (`0` synthetic placeholders, `0` quarantined items used as evidence, `0` mislinked instruments).
  - `rel.B02.rc1` (`LIMITED-SCOPE CANDIDATE`): **`26 / 26` (`100%`)** across all 6 dimensions (`0` RD 736/773 links surfaced in `BLIND-12`; `0` quarantined items used as evidence).
- **Wrong-Instrument & Mixed-Role Regressions ([`b01-defects-regression.test.ts`](file:///d:/Code/REG24/tests/knowledge/b01-defects-regression.test.ts))**:
  - Ruling `0811/13980` (`22874.html`): `0` links to RC s. `3` or s. `491`; `1,548` mislinked `prov.th.rc.*` edges reduced to `0`; all `794` `facts === ruling` + `5` embedded-conclusion records separated (`0` remaining).
- **Source Fidelity & Statutory Versions**:
  - `4,710 / 4,710` (`rc2`) and `6,746 / 6,746` (`b02`) distinct artifacts carry 64-char SHA-256 digests; `10,665 / 10,665` (`rc2`) and `23,516 / 23,516` (`b02` chain) passages resolve to real `origin_uri` + `artifact_id` locators.
  - `326` verbatim Revenue Code sections + `155` verified subordinate/amendment works; bitemporal `prov.th.rc.65_ตรี` (`v1_pre2019` `1939-04-01..2019-03-19` vs `v2_current` `2019-03-20..open`) verified in `B01-U05A/B`, `B02-U03A/B`, and `BLIND-15/16`.
- **Concurrency, Relational Durable Storage & Crash Recovery**:
  - [`option-a-durable-storage-integration.test.ts`](file:///d:/Code/REG24/tests/knowledge/option-a-durable-storage-integration.test.ts): Executes [`0002_knowledge_releases_cas_and_outbox.sql`](file:///d:/Code/REG24/prisma/migrations/0002_knowledge_releases_cas_and_outbox.sql) on disk-backed ACID SQL (`WAL` + `FULL` sync) — verifies mid-tx crash rollback atomicity, 2-connection CAS `REVISION_CONFLICT_409`, `CHECK (usable_as_legal_evidence = 0)` DB constraint, hash-chained `audit_log_chain`, Neo4j outbox checksum verification, and cold-restart persistence.
  - [`concurrency-and-recovery.test.ts`](file:///d:/Code/REG24/tests/knowledge/concurrency-and-recovery.test.ts): `5/5` multi-process OS barrier race, unique WAL sequencing (`seq 1..34`), and interrupted `.staged-commits/` journal recovery tests passing.
- **Idempotent Duplicate Re-Import & Non-Destructive Rollback**:
  - Re-importing `rel.B01.rc2` (`4,578` docs) and `rel.B02.rc1` (`2,024` docs) produced `delta_works = 0`, `delta_passages = 0`, `delta_assertions = 0`, `delta_vectors = 0`.
  - Disposable rollback probe confirmed rolling back `rel.B02.rc1 -> ROLLED_BACK` preserves shared `prov.th.rc.65_ตรี` for `rel.B01.rc2`, and rolling back `rel.B01.rc2 -> ROLLED_BACK` leaves preserved `rel.B01.rc1` (`9,744` passages, `2059e51ee...`) 100% intact.

---

## 4. Mandatory Owner UAT Suite (`20` `rel.B01.rc2` + `20` `rel.B02.rc1` — `20/20` Pass Gate)

Full UAT sheets (`owner_result: null` on all 40 mandatory cases): [`proposed_uat_cases_rc2_b02.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/proposed_uat_cases_rc2_b02.json).
- **`rel.B01.rc2` (`20` Mandatory Cases — Automated Precheck `20 / 20 PASS`)**: Covers Arabic/Thai-digit ruling lookup (`B01-U01A/B`), VAT `0%` fact patterns (`U02A/B`), multi-ruling comparison (`U03A/B`), facts-vs-ruling role separation (`U04A/B`), bitemporal `มาตรา 65 ตรี` (`U05A/B`), provision navigation incl. suppressed RD 736 (`U06A/B`), duplicate representation provenance (`U07A/B`), verbatim negation & exact figures (`U08A/B`), missing-fact clarification (`U09A/B`), and non-existent ruling abstention (`U10A/B`).
- **`rel.B02.rc1` (`LIMITED-SCOPE CANDIDATE`, `20` Mandatory Cases — Automated Precheck `20 / 20 PASS`)**: Covers verbatim Revenue Code & Pali-ordinal lookup (`B02-U01A/B`, `U02A/B`), cross-batch bitemporal `65 ตรี` (`U03A/B`), Amendment Act No. 48 & Royal Decree No. 10 (`U04A/B`), Ministerial Reg No. 126 & RD 342 (`U05A/B`), `DRAFT_BILL` isolation & `65 ทวิ` (`U06A/B`), `ท.ป. 1/2528` & DG VAT Notification 28 (`U07A/B`), verbatim `77/1` & `81` (`U08A/B`), `มาตรา 70` clarification & `91/2` SBT (`U09A/B`), and non-existent identifier abstention (`U10A/B`).

---

## 5. Known Limitations, Exclusions & `LIMITED-SCOPE CANDIDATE` Disclosure (`Instruction 3`)

1. **`rel.B02.rc1` is a `LIMITED-SCOPE CANDIDATE` (`2,024 / 7,335` admitted [`27.59%`]; `5,275` deferred scans [`71.92%`]; `36` out-of-scope [`0.49%`])**: `5,275` image-only historical Gazette scans and unmapped legacy-font PDFs (`41,247` pages) are held in `DEFERRED_WITH_REASON` with `0` fabricated text; concrete domain impact and the 4-wave verified OCR recovery plan (`Wave 1` `180` RD tax files -> `Wave 4` archival Gazette) are detailed in [`Candidate_Manifests_and_Quarantine_Ledger_rc2_B02.md`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/Candidate_Manifests_and_Quarantine_Ledger_rc2_B02.md#L85-L120).
2. **`1,421` Quarantined Unresolved Citations (`usable_as_legal_evidence: false`)**: Excluded from trusted graph/retrieval (including both suppressed RD 736 & RD 773 links in `rel.B01.rc2` / `rel.B02.rc1`, with verified section links proposed separately in `rel.B02.rc2` at [`Royal_Decrees_736_773_Independent_Verification_and_Candidate_Proposal.md`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/Royal_Decrees_736_773_Independent_Verification_and_Candidate_Proposal.md)).
3. **RD 736 Page 2 (`หน้า 160`) Excerpt Clip (`~220` chars in `มาตรา 4 (3)` & `มาตรา 5`)**: Pre-extracted manifest cap clipped non-cited `มาตรา 4 (3)`/`5` in `17186446_Royal_Decree.pdf`; zero text fabricated, and only verbatim-complete `มาตรา 3 (1)` & `4 (1)` are proposed in `rel.B02.rc2`.
4. **`1` Genuine Inquiry-Only Source in `B01` (`ruling.th.rd.30677` / `กค 0706/6557`)**: Isolated strictly in `requester_facts` (`0` fabricated conclusion).
5. **Production Storage & Neo4j `374f4f7e` Cutover Pending**: Detailed in [`Neo4j_and_Storage_Verification_Report.md`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/Neo4j_and_Storage_Verification_Report.md).

---

## 6. Dodo Independent Review Access & Reproduction Commands

- **Remote Staging Branch**: https://github.com/classichot/REG24/tree/review/b01-rc2-b02-rc1-staging (code commit `3c3034763128f22865c10c88274f468c5752bc09`; `main` untouched at `7df41c4ca1f63059b8d187e4014f2cb16886972d`)
- **In-Repo Audit Bundle**: [`docs/audit/dodo-review-rc2-b02/`](file:///d:/Code/REG24/docs/audit/dodo-review-rc2-b02)
- **Standalone Git Patch & Offline Bundle**: [`reg24-rc2-b02-dodo-review.patch`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/reg24-rc2-b02-dodo-review.patch) & [`reg24-rc2-b02-dodo-review.bundle`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/reg24-rc2-b02-dodo-review.bundle)
- **Reproduction Commands**:
  ```bash
  git fetch origin review/b01-rc2-b02-rc1-staging && git checkout review/b01-rc2-b02-rc1-staging
  npx tsc --noEmit && npx vitest run
  npx tsx scripts/verify-neo4j-374f4f7e-readonly.ts --out /tmp/neo4j_verify.json
  npx tsx scripts/stage-b01-b02-isolated.ts --staging-dir /tmp/reg24_staging --metrics-out /tmp/pkg.json --quarantine-out /tmp/quarantine.json
  npx tsx scripts/stage-rd736-773-proposed-candidate.ts --source-staging-dir /tmp/reg24_staging --proposal-dir /tmp/reg24_prop_rc2 --receipt-out /tmp/prop_receipt.json
  ```
