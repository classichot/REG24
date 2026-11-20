# REG24 Batch 1 — RC10 Evidence Bundle & Separate Gate Decisions (`rc10.1` Remediation Candidate)

> **Governance Status**:
> - **First handoff remains `PROVISIONAL`.**
> - **Original RC10 preserved untouched**: commit `6e4fde13253ca66c3e46f9ca56005776dc9011f1` (pinned via tag `archive/b01-rc10-6e4fde1`), release `rel.B01.rc7`, and its unchanged logs/JSON outputs archived in [`01-original-6e4fde1-evidence/`](./01-original-6e4fde1-evidence/).
> - **Separately pinned remediation candidate**: branch `feat/b01-thai-legal-index-retrieval-rc10.1` (`rel.B01.rc7` rebuilt with single-engine TS tokenizer parity, hardened grader v2 + negative-control unit tests, real `queryKnowledge()` app evidence assembly capture, and unseen independent holdouts).
> - **Search sign-off, final tokenizer/embedding selection, and external trial remain HELD.**

---

## 1. Five Separate Gate Decisions (`PASS` / `STOP` / `BLOCKED`)

| Gate | Decision | Evidence Summary | Owner & Next Action (if non-PASS) |
|---|---|---|---|
| **1. Original `6e4fde1` Test Evidence & Preservation** | **`PASS`** | Unchanged original `34/34` raw Vitest log (`task-16442.log`), unchanged `21/21` `rc7_retrieval_ablation_and_replay.json` (`SHA-256: 22db2038...`), `tsc` exit-0 log, exact hashes, cache disclosure (`REUSE_PY_OUT=1`), and honest mocks-vs-real-services table archived in [`01-original-6e4fde1-evidence/`](./01-original-6e4fde1-evidence/ORIGINAL_6E4FDE1_TEST_AND_REPLAY_RECEIPT.md). Commit `6e4fde1` preserved via tag `archive/b01-rc10-6e4fde1`. | — |
| **2. Legal Provenance (`790` / `799` / `807` Originals & Dates)** | **`PASS`** *(Engineering Provenance Ready for Independent Legal Review)* | Portable repo receipts at [`../batch1-rc7/LEGAL_PROVENANCE_RD_790_799_807.md`](../batch1-rc7/LEGAL_PROVENANCE_RD_790_799_807.md) and [`../batch1-rc7/verified_royal_decrees.json`](../batch1-rc7/verified_royal_decrees.json); official `www.rd.go.th` PDF binaries archived in-repo with verified SHA-256 checksums, separate enactment/publication/commencement/covered-transaction dates, real `pdf_page` locators, and both endpoints tested (`valid_to: "2027-09-30"` fixed on RD 807). | **Owner: Legal** — Independent sign-off against the archived Gazette PDFs in parallel. |
| **3. Tokenizer Parity (`index == live query`)** | **`BLOCKED`** *(Local `PASS`; Clean Linux Build & Exact Preview Pending)* | Eliminated `6e4fde1` mixed-engine PyThaiNLP/TS mismatch. Rebuilt `rel.B01.rc6` & `rel.B01.rc7` with **one pinned TypeScript contract** (`ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0`, contract SHA-256 `6d5783be8b8a...`, dict SHA-256 `4af2531db086...`, lexical index SHA-256 `9cd653449bc3...`). Enforced load-time rejection of mismatched engines (`TOKENIZER_ENGINE_MISMATCH`) and zero silent per-passage fallback. Local `4/4` probe (`unspaced_thai`, `legal_citations`, `negation`, `compound_terms`) passed (`../batch1-rc7/tokenizer_parity_probe_local.json`). **Blocked only on running `GET /api/v1/knowledge/environment?probe_tokenizer=1` on a clean Linux build + exact Vercel Preview.** | **Owner: Platform Engineering + Search Engineering** — Mint preview URL for `feat/b01-thai-legal-index-retrieval-rc10.1` and execute `scripts/run-hosted-rc10-smoke.ts` to capture live Linux (`runtime_platform: "linux"`) index/query tokens & posting hits. |
| **4. Blind Retrieval & Real App Evidence Assembly (Hardened Grader v2)** | **`STOP`** | Hardened grader v2 (`src/core/knowledge/retrieval-benchmark-grader.ts`) passed all `4/4` mandatory negative-control unit tests (`tests/knowledge/retrieval-benchmark-grader-negative-controls.test.ts`). On the **real `queryKnowledge()` app evidence assembly path**: Sealed Positive Covered = **`18/18 (100.0%)`** (`0` wrong-version, `0` false-sub), Sealed Negative/Abstention = **`4/4 (100.0%)`** (`0` expired-governing leaks, `0` silent latest-version on missing date, `0` false-sub), Negative Holdout = **`1/1 (100.0%)`**. **HOWEVER, Unseen Positive Holdouts scored `1/4 (25.0%)` Top-5 / `3/4 (75.0%)` Actual Packet** (and `NitiBench-Tax` 6-case miss audit confirmed heuristic misfires on `NITI-TAX-03/04/05`). **Not tuned to the holdout!** | **Owner: Search Engineering** — Replace brittle surface-phrase triggers in `legal-issue-fact-analyzer.ts` (`"ขายสินค้า"`, `"อัตราร้อยละเท่าใด"`, `"ในประเทศ"`, `"หลาน"/"พี่น้อง"`) and prevent VAT-rate heuristics from misfiring on zero-rate/cross-border/WHT narratives; then re-evaluate on a **brand-new** Legal-authored holdout set. |
| **5. Hosted Query / Transactional Neon Save / Fresh-Instance DB Reopen** | **`BLOCKED`** | Local environment has no Vercel CLI session and no immutable `?_vercel_share=...` URL yet for `feat/b01-thai-legal-index-retrieval-rc10.1`. Note: unit Test #4 (`rc7-thai-legal-index-and-retrieval-gates.test.ts`) uses an **in-memory mock transport** and is NOT proof of live Neon PostgreSQL atomicity. Live Neon save + fresh-instance DB reopen must be proven on the protected preview. | **Owner: Platform Engineering + QA** — Share the immutable `?_vercel_share=...` URL for `rc10.1` (with `REG24_PINNED_RELEASE_ID=rel.B01.rc7`) so `scripts/run-hosted-rc10-smoke.ts` can verify live Gemini 4 Neon `@ low`, atomic Neon save, and fresh-instance DB reopen. |

---

## 2. Hardened Grader v2 Summary (Real `queryKnowledge()` App Evidence Assembly Path)

Machine-readable receipt: [`02-hardened-blind-and-real-app-rerun/hardened_real_app_path_and_holdout_receipt.json`](./02-hardened-blind-and-real-app-rerun/hardened_real_app_path_and_holdout_receipt.json) · Case-Set SHA-256: embedded in JSON · Strictly blind 6-arm comparison receipt (zero label leakage, `FROZEN_BLIND_CORPUS_V1`, `1,924` passages, SHA `9caaa192765b...`): [`../batch1-rc7/blind_retrieval_ablation_receipt.json`](../batch1-rc7/blind_retrieval_ablation_receipt.json).

| Bucket (Positive vs. Negative Scored Separately) | Passed | All-Required in Eligible Top-5 | All-Required in Actual Model Packet | Wrong-Version Substitutions | False Substitutions | Expired Governing Leaks | Silent Latest on Missing Date | p95 Retrieval Latency |
|---|---|---|---|---|---|---|---|---|
| **Sealed Positive Covered (`18` cases)** | **`18/18 (100.0%)`** | `18/18` | `18/18` | `0` | `0` | `0` | `0` | `198.46 ms` |
| **Sealed Negative / Clarification / Abstention (`4` cases)** | **`4/4 (100.0%)`** | `4/4` | `4/4` | `0` | `0` | `0` | `0` | `117.58 ms` |
| **Unseen Independent Holdouts — Positive (`4` cases, NOT tuned)** | **`1/4 (25.0%)`** *(STOP)* | `1/4` | `3/4` | `0` | `0` | `0` | `0` | `144.60 ms` |
| **Unseen Independent Holdouts — Negative (`1` case, NOT tuned)** | **`1/1 (100.0%)`** | `1/1` | `1/1` | `0` | `0` | `0` | `0` | `101.76 ms` |

### Why Unseen Positive Holdouts Triggered `STOP` (Reported Openly, Zero Tuning to Holdout)
1. **`H-01-VAT-790-MID` (`2025-03-15`)**: Fresh wording (`"ขายอุปกรณ์สำนักงาน"`, `"กี่เปอร์เซ็นต์"`) missed surface-phrase triggers in `legal-issue-fact-analyzer.ts`, so `prov.th.rc.80`, `rd.790`, and `vat_local_tax_guide` missed Top-5 retrieval (`first_seen_rank=null`), even though `query.ts` later assembled them into the actual model packet.
2. **`H-02-VAT-807-MID` (`2027-04-20`)**: Fresh wording (`"อัตราใด"`, `"ในไทย"`) missed `prov.th.rc.80` and `vat_local_tax_guide` in Top-5 retrieval (rescued into packet by `query.ts`).
3. **`H-03-GIFT-LAND-CHILD` (`2026-05-01`)**: Fresh wording (`"บิดาโอนกรรมสิทธิ์ที่ดิน ... ให้บุตรชอบด้วยกฎหมาย"`) missed `prov.th.rc.54` in **BOTH** Top-5 retrieval AND the actual model packet because the analyzer only added `§54` on nephew/sibling/condo phrasings rather than general immovable-property transfer WHT shortfall rules.
4. **Additional Real-App Path Finding**: On `G-VAT-ZERO-EXPORT`, `G-VAT-CROSSBORDER-PP36`, `G-EXACT-SEC-80-1-2`, and `H-04-SEC-80-1-1-EXPORT-GOODS`, `query.ts` appended `conditional_branch_authority` domestic VAT decrees when no date appeared in the prompt text (even when `applicable_date` was supplied or the query was strictly zero-rating `§80/1`), causing `pre_llm_response_status` to flag `CLARIFICATION_OR_CONDITIONAL_NEEDED` unnecessarily. Fixing this alongside the generalized analyzer cleanly resolves both issues.

---

## 3. Complete Per-Case Trace (`27` Cases — Real `queryKnowledge()` App Evidence Assembly)

*Legend: `hist_excl` = `historical_or_excluded_context` (never governing), `cond_branch` = `conditional_branch_authority`, `ctx_ruling` = `contextual_ruling_or_guidance`.*

| Case ID | Kind | Date | Expected Instrument@Ver [Required Passages] | Ranked Retrieval Hit | Actual Model Packet (Ordered Pos:Work@Ver(Role)) | Response Status | First Failing Step |
|---|---|---|---|---|---|---|---|
| `G-VAT-790-START` | `POSITIVE_COVERED` | `2024-10-01` | `80@v1 [psg.1b1abb8e7e22df]`; `rd.790@v1 [psg.rc7.rd790.sec_1_2,sec_3_4]`; `vat_local@v1` | `rd790:1, 80:2, vat_local:3` | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:rd790@v1(governing), 6:78@v1(governing) (+9)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-790-END` | `POSITIVE_COVERED` | `2025-09-30` | `80@v1`; `rd.790@v1 [sec_1_2,sec_3_4]`; `vat_local@v1` | `rd790:1, 80:2, vat_local:3` | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:77/2@v1(governing), 6:rd790@v1(governing) (+13)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-799-START` | `POSITIVE_COVERED` | `2025-10-01` | `80@v1`; `rd.799@v2 [sec_1_2,sec_3_4]`; `vat_local@v1` | `rd799:1, 80:2, vat_local:3` | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:rd799@v2(governing), 6:78@v1(governing) (+9)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-799-END` | `POSITIVE_COVERED` | `2026-09-30` | `80@v1`; `rd.799@v2 [sec_1_2,sec_3_4]`; `vat_local@v1` | `rd799:1, 80:2, vat_local:3` | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:rd799@v2(governing), 6:78@v1(governing) (+13)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-807-START` | `POSITIVE_COVERED` | `2026-10-01` | `80@v1`; `rd.807@v2 [sec_1_2,sec_3_4]`; `vat_local@v1` | `rd807:1, 80:2, vat_local:3` | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:rd807@v2(governing), 6:78@v1(governing) (+16)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-807-END` | `POSITIVE_COVERED` | `2027-09-30` | `80@v1`; `rd.807@v2 [sec_1_2,sec_3_4]`; `vat_local@v1` | `rd807:1, 80:2, vat_local:3` | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:rd807@v2(governing), 6:78@v1(governing) (+11)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-ZERO-EXPORT` | `POSITIVE_COVERED` | `2026-06-15` | `80/1@v1`; `dg_vat.105@v1` | `80/1:1, dg_vat.105:2` | `1-3:80/1@v1(governing), 4-6:dg_vat.105@v1(governing) (+18)` | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | `NONE` |
| `G-VAT-EXEMPT-81` | `POSITIVE_COVERED` | `2026-06-15` | `81@v1` | `81:1` | `1-4:81@v1(governing), 5-6:tax_rulings(ctx_ruling) (+10)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-MIXED-82-6` | `POSITIVE_COVERED` | `2026-06-15` | `82/6@v1 [psg.01d08a05e857f6]` | `82/6:1` | `1:82/6@v1(governing), 2:82/3@v1(governing), 3-6:81@v1(governing) (+12)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-VAT-CROSSBORDER-PP36` | `POSITIVE_COVERED` | `2026-06-15` | `77/2@v1`; `83/6@v1` | `77/2:1, 83/6:2` | `1-2:77/2@v1(governing), 3-4:83/6@v1(governing), 5:80@v1(governing) (+18)` | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | `NONE` |
| `G-EXACT-SEC-80-1-2` | `POSITIVE_COVERED` | `null` | `80/1@v1` *(Top-1 required; != `80`)* | `80/1:1` | `1:80@v1(governing), ..., 80/1@v1(governing)` *(23 total)* | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | `NONE` |
| `G-EXACT-RULING-5958` | `POSITIVE_COVERED` | `null` | `0702_5958_2015_04f2b49f@v1 [psg.f52de9a716c669]` | `0702/5958:1` | `1:0702/5958@v1(governing), 2-6:related_rulings(ctx_ruling) (+5)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-GIFT-T09-CONDO-NEPHEW` | `POSITIVE_COVERED` | `2026-06-15` | `42@v1`, `48@v1`, `50@v1`, `54@v1` | `42:1, 48:2, 50:3, 54:4` | `1-4:42@v1(governing), 5-6:48@v1(governing), ..., 50@v1, 54@v1(governing)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-GIFT-B1-09-CASH-NIECE` | `POSITIVE_COVERED` | `2026-02-10` | `42@v1`, `48@v1` | `42:1, 48:2` | `1-4:42@v1(governing), 5-6:48@v1(governing) (+15)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-GIFT-CONDO-BROTHER` | `POSITIVE_COVERED` | `2026-06-15` | `42@v1`, `50@v1`, `54@v1` | `42:1, 50:3, 54:4` | `1-3:42@v1(governing), ..., 50@v1, 54@v1(governing)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-PARAPHRASE-EN-VAT` | `POSITIVE_COVERED` | `2026-09-30` | `80@v1`, `rd.799@v2`, `vat_local@v1` | `vat_local:1, rd799:2, 80:3` | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:rd799@v2(governing) (+15)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-PARAPHRASE-EN-GIFT` | `POSITIVE_COVERED` | `2026-06-15` | `42@v1`, `48@v1`, `50@v1`, `54@v1` | `42:1, 48:2, 50:3, 54:4` | `1-4:42@v1(governing), 5-6:48@v1(governing), ..., 50@v1, 54@v1(governing)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-ANALOGOUS-RULING-EXPORT` | `POSITIVE_COVERED` | `null` | `80/1@v1` | `80/1:1` | `1-3:80/1@v1(governing), 4-6:dg_vat.105@v1(governing) (+18)` | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | `NONE` |
| `G-NEG-POST-807` | `NEGATIVE_POST_EXPIRY` | `2027-10-01` | `80@v1` *(RD 807 forbidden as governing; hist_excl only)* | `80:1` *(RD 807 absent from eligible hits)* | `1:80@v1(governing), 2-3:vat_local@v1(governing), 4-5:rd807@v2(hist_excl), 6:78@v1(governing)` | `READY_FOR_LLM_GROUNDED` | `NONE` |
| `G-NEG-MISSING-DATE-VAT` | `NEGATIVE_MISSING_DATE` | `null` | `80@v1`, `78/1@v1`, `vat_local@v1` *(+ date clarification)* | `80:1, vat_local:2, 78/1:5` | `1:80@v1(governing), 2-3:vat_local@v1(governing), ..., rd790/799/807(cond_branch)` | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | `NONE` |
| `G-NEG-FAKE-RULING-99999` | `NEGATIVE_FAKE_RULING` | `null` | Abstention + zero substitute rulings | `unresolved=กค 0702/99999` | `(empty)` | `INSUFFICIENT_EVIDENCE` | `NONE` |
| `G-NEG-MISSING-2019-DECREE` | `NEGATIVE_MISSING_AUTHORITY` | `2019-06-15` | Abstention + zero substitute decrees | `abstain (coverage gap)` | `(empty)` | `INSUFFICIENT_EVIDENCE` | `NONE` |
| `H-01-VAT-790-MID` | `POSITIVE_COVERED` | `2025-03-15` | `80@v1`, `rd.790@v1`, `vat_local@v1` | `80:miss, rd790:miss, vat_local:miss` | `1:80@v1(governing), ..., rd790@v1(governing)` *(rescued in packet)* | `READY_FOR_LLM_GROUNDED` | **`RANKING_TOP5_MISS`** |
| `H-02-VAT-807-MID` | `POSITIVE_COVERED` | `2027-04-20` | `80@v1`, `rd.807@v2`, `vat_local@v1` | `80:miss, rd807:4, vat_local:miss` | `1:80@v1(governing), ..., rd807@v2(governing)` *(rescued in packet)* | `READY_FOR_LLM_GROUNDED` | **`RANKING_TOP5_MISS`** |
| `H-03-GIFT-LAND-CHILD` | `POSITIVE_COVERED` | `2026-05-01` | `42@v1`, `48@v1`, `50@v1`, `54@v1` | `42:2, 48:3, 50:4, 54:miss` | `1-3:42@v1(governing), 4-6:48@v1(governing), ..., 50@v1` *(54 missing!)* | `READY_FOR_LLM_GROUNDED` | **`RANKING_TOP5_MISS`** |
| `H-04-SEC-80-1-1-EXPORT-GOODS` | `POSITIVE_COVERED` | `null` | `80/1@v1` *(Top-1 required; != `80`)* | `80/1:1` | `1-3:80/1@v1(governing), 4-6:dg_vat.105@v1(governing) (+18)` | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | `NONE` |
| `H-05-NEG-FAKE-RULING-88888` | `NEGATIVE_FAKE_RULING` | `null` | Abstention + zero substitute rulings | `unresolved=กค 0706/88888` | `(empty)` | `INSUFFICIENT_EVIDENCE` | `NONE` |

---

## 4. Index of All Accessible Receipts in This Repository

- **Original `6e4fde1` Evidence (Unchanged)**:
  - [`01-original-6e4fde1-evidence/ORIGINAL_6E4FDE1_TEST_AND_REPLAY_RECEIPT.md`](./01-original-6e4fde1-evidence/ORIGINAL_6E4FDE1_TEST_AND_REPLAY_RECEIPT.md)
  - [`01-original-6e4fde1-evidence/original_6e4fde1_vitest_34of34_raw.log`](./01-original-6e4fde1-evidence/original_6e4fde1_vitest_34of34_raw.log)
  - [`01-original-6e4fde1-evidence/original_6e4fde1_replay_and_tsc_raw.log`](./01-original-6e4fde1-evidence/original_6e4fde1_replay_and_tsc_raw.log)
  - [`01-original-6e4fde1-evidence/rc7_retrieval_ablation_and_replay.json`](./01-original-6e4fde1-evidence/rc7_retrieval_ablation_and_replay.json)
  - [`01-original-6e4fde1-evidence/original_6e4fde1_case_definitions.json`](./01-original-6e4fde1-evidence/original_6e4fde1_case_definitions.json)
- **Legal Provenance (`790` / `799` / `807`)**:
  - [`../batch1-rc7/LEGAL_PROVENANCE_RD_790_799_807.md`](../batch1-rc7/LEGAL_PROVENANCE_RD_790_799_807.md)
  - [`../batch1-rc7/verified_royal_decrees.json`](../batch1-rc7/verified_royal_decrees.json)
- **Single-Engine Tokenizer Parity & Blind 6-Arm Ablation (`1,924p` + `11,786p`) + NitiBench Miss Diagnosis**:
  - [`../batch1-rc7/BLIND_RETRIEVAL_AND_TOKENIZER_PARITY_REPORT.md`](../batch1-rc7/BLIND_RETRIEVAL_AND_TOKENIZER_PARITY_REPORT.md)
  - [`../batch1-rc7/tokenizer_parity_probe_local.json`](../batch1-rc7/tokenizer_parity_probe_local.json)
  - [`../batch1-rc7/blind_retrieval_ablation_receipt.json`](../batch1-rc7/blind_retrieval_ablation_receipt.json)
- **Hardened Grader v2 + Real App Evidence Assembly + Unseen Holdouts**:
  - [`02-hardened-blind-and-real-app-rerun/hardened_real_app_path_and_holdout_receipt.json`](./02-hardened-blind-and-real-app-rerun/hardened_real_app_path_and_holdout_receipt.json)
  - [`../../src/core/knowledge/retrieval-benchmark-grader.ts`](../../src/core/knowledge/retrieval-benchmark-grader.ts)
  - [`../../tests/knowledge/retrieval-benchmark-grader-negative-controls.test.ts`](../../tests/knowledge/retrieval-benchmark-grader-negative-controls.test.ts)
