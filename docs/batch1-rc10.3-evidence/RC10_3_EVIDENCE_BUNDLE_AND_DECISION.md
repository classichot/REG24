# REG24 Batch 1 | RC10.3 Remediation & Verification Evidence Bundle

> **Scope & Honesty Notice**: This bundle covers the isolated staging candidate branch `feat/b01-thai-legal-index-retrieval-rc10.3` on corpus `rel.B01.rc8` (`mfst.b01.rc8_thai_legal_index`), keeping RC10.2 (`316cdadd1b784692a6b992139e9b3ef354a1e2bd`, `rel.B01.rc7`, tag `archive/b01-rc10.2-316cdad`), RC10.1 (`e363120`), RC10 (`6e4fde1`), and `rel.B01.rc6` 100% untouched as comparison baselines.
>
> **No Overclaiming**: Pre-LLM retrieval/packet verification proves indexing, graph semantics, temporal/version eligibility, and exact model evidence packets (`final_answer_qa_status: NOT_RUN_PRE_LLM_CAPTURE`). Live Neon app-level retry proves real Next.js route handlers against live staging Neon PostgreSQL. Hosted Vercel Linux preview parity, named-tester access, normal Legal Review UI smoke on the pinned RC10.3 preview, and independent Legal grading of live cited answers remain **BLOCKED** pending Vercel preview deployment & named tester access by Platform Engineering and unseen Legal pack execution.

---

## 1. Pinned Release, Manifest & Index Hashes (RC10.3 vs Preserved RC10.2 Baseline)

| Field | RC10.3 Candidate (`rel.B01.rc8`) | Preserved RC10.2 Baseline (`rel.B01.rc7`) |
| --- | --- | --- |
| **Branch / Baseline Tag** | `feat/b01-thai-legal-index-retrieval-rc10.3` | `archive/b01-rc10.2-316cdad` (`316cdadd1b784692a6b992139e9b3ef354a1e2bd`) |
| **Corpus Release / Manifest** | `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` | `rel.B01.rc7` / `mfst.b01.rc7_thai_legal_index` |
| **Manifest SHA-256** | `1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3` | `e01101062bd07c4dee79f44f39940024ad2f16c2bf9557d609aae23837119781` |
| **Single-Engine Tokenizer** | `ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0` | `ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0` |
| **Tokenizer Contract SHA-256** | `6d5783be8b8a39a34b55b383e7735b916d9912a01e831165b45a50abb4a2b5a1` | `6d5783be8b8a39a34b55b383e7735b916d9912a01e831165b45a50abb4a2b5a1` |
| **Legal Dictionary SHA-256** | `4af2531db0861dbe64abbbef502b71d9292282f661094a38afec5f80768540f8` | `4af2531db0861dbe64abbbef502b71d9292282f661094a38afec5f80768540f8` |
| **Lexical Index SHA-256** | `e4dd4ddbf12b44fd9d7d3e18a3adbe0d80661e2ad147fcdd3bea245391455605` | `9cd653449bc3e9e73a1d0bacfcdd200fa2d0ee66441e33f5e842fbb7ca9d1880` |
| **Lexical Disk Snapshot SHA-256** | `b72c8a5aee209ef707a6279c0ac6f9369989c1c71cddb172318b158a3dcdb1a7` | _(preserved untouched)_ |
| **Passages / Accepted Assertions** | `11791` / `43166` | `11786` / `43164` |
| **Default Search & Model Policy** | TS BM25+Graph default; `gemini-4-neon @ low` default in code (no request override needed); BGE-M3 & legacy vectors `deliberately_disabled` | Same baseline stack (code default was `high` unless env var set) |

---

## 2. Requirement-by-Requirement Decisions (`PASS / STOP / BLOCKED`)

| Requirement | Decision | Evidence Summary | Owner & Next Action |
| --- | --- | --- | --- |
| **1. P0 \| Governing evidence matches transaction date** | **PASS** _(Engineering + pre-LLM; Legal source sign-off & live UI citation check pending)_ | Reproduces RC10.2 baseline (`rel.B01.rc7` old `amends.prev` & open RD 646 `valid_to: null`) and proves RC10.3 (`rel.B01.rc8`): (a) separates `AMENDS -> subreg.th.rc.royal_decree.646` from `SUPERSEDES -> predecessor (780/790/799)` (`zero_legacy_amends_prev_edges_in_rc8: true`), (b) labels `sec_3_amending_clause` separately from `sec_3_quoted_rd646_sec_4` for RD 780/790/799/807 with official Gazette PDFs & separate dates, (c) enforces date/version/predecessor eligibility on EVERY passage entering `actual_model_packet` including graph-expanded passages beyond Top-5, and (d) passes **38/38** real-app cases including day-before/day-of all boundaries (`2018-06-15`, `2024-09-30`, `2024-10-01`, `2025-09-30`, `2025-10-01`, `2026-09-30`, `2026-10-01`, `2027-09-30`, `2027-10-01`) with `0` superseded RD 646 leaks. | **Legal + QA**: Review & sign [verified_royal_decrees_rc8_source_and_graph_map.json](verified_royal_decrees_rc8_source_and_graph_map.json) and verify live packet roles & displayed citations on the pinned RC10.3 preview. |
| **2. P0 \| Publish only after commit; retry same save without creating a new revision** | **PASS** _(Real staging app routes + Live Neon PostgreSQL, ZERO mocks)_ | Applied additive migration `prisma/migrations/0007_save_operation_idempotency_key.sql` (`save_operation_key`, `save_payload_sha256`, unique index `idx_citation_published_answer_save_op_unique` scoped to `(owner_actor_id, owner_tenant_id, answer_id, save_operation_key)`) on live staging Neon. Enforced strict commit-before-expose ordering in `saveOrReviseAnswerServerVerified` + fixed multi-version citation `DISTINCT ON (l.link_id)` in `loadSavedAnswerFromPostgres`. Live app-path proof ([rc10_3_app_level_retry_live_neon_receipt.json](rc10_3_app_level_retry_live_neon_receipt.json)) passes ALL 5 scenarios: failed tx (`0/0/0/0` Neon + `in_memory_cache_leak_found: false` + `404` API) -> clean retry (`r1`), lost-response replay (`r1`, `idempotent_replay: true`), same-key conflicting content (`HTTP 409`), 3x concurrent retries (`[200,200,200]`, `[false,true,true]`, 1 single `r1` in Neon), deliberate edit with new key (`r2`, `supersedes: r1`), `?require_db=1` DB reopen (`persistence_source: neon_postgres`, exact claims/citations/provenance/audit), and **`0` model calls** on all save-only retries. | **QA**: Repeat one UI save + `?require_db=1` reopen on the pinned RC10.3 Vercel preview once P0-3 access clears. |
| **3. P0 \| Normal Legal Review workflow uses Gemini 4 Neon @ low** | **BLOCKED** _(Code & staging default: PASS; Hosted preview & named tester access: BLOCKED)_ | Code default for `gemini-4-neon` in `resolveThinkingLevelForModel` is now explicitly `"low"` (no request override required; verified in `rc10-3-p0-remediation-gates.test.ts` Test 4 where `/api/v1/knowledge/environment?probe_tokenizer=1` reports `rel.B01.rc8`, `thinking_level: "low"`, `silent_fallback_disabled: true`, `vector: deliberately_disabled`, `contract_parity_ok: true`, `all_probes_ok: true`). Smoke runner [run-hosted-rc10-smoke.ts](../../scripts/run-hosted-rc10-smoke.ts) updated to omit `thinking_level` by default (`request_forced_thinking_level: false`). **Blocked** because local Vercel CLI is logged out (`npx vercel whoami` -> `Logged out.`) and Platform Engineering must grant named-tester access on the pinned RC10.3 Vercel preview deployment and run the normal UI smoke + Linux preflight. | **Platform Engineering + QA**: (1) Confirm the Ready Vercel preview deployment for the pushed RC10.3 commit, (2) grant named QA tester access via their own Vercel account (or report exact blocker for Owner approval before any anyone-with-link fallback), (3) run `GET /api/v1/knowledge/environment?probe_tokenizer=1` on Linux, and (4) submit one fictional tax question via normal `/legal-review` UI without request override and reopen via `?require_db=1`. |

---

## 3. P0-1 Official Source, Split §3 / Quoted RD 646 §4 & Graph Mapping

Receipt: `docs/batch1-rc10.3-evidence/verified_royal_decrees_rc8_source_and_graph_map.json`

| Work ID | RC8 Version ID | Pub / Commence Date | Active Governing Window | Official PDF SHA-256 | Separately Labeled Passages |
| --- | --- | --- | --- | --- | --- |
| `subreg.th.rc.royal_decree.646` | `ver.th.rc.royal_decree.646.v2` | `2017-10-01` / `2017-10-01` | `2017-10-01 .. 2018-09-30` | `a7591ae8a8fb...` | `psg.rc8.rd646.sec_1_3`, `psg.rc8.rd646.sec_4_compiled` |
| `subreg.th.rc.royal_decree.780` | `ver.th.rc.royal_decree.780.v2` | `2023-09-16` / `2023-10-01` | `2023-10-01 .. 2024-09-30` | `26f4a13406be...` | `sec_1_2` (หน้า ๑), `sec_3_amending_clause` (หน้า ๑–๒), `sec_3_quoted_rd646_sec_4` (หน้า ๒), `note` (หน้า ๓) |
| `subreg.th.rc.royal_decree.790` | `ver.th.rc.royal_decree.790.v2` | `2024-09-20` / `2024-10-01` | `2024-10-01 .. 2025-09-30` | `8cee8f1d3715...` | `sec_1_2` (หน้า ๑), `sec_3_amending_clause` (หน้า ๒), `sec_3_quoted_rd646_sec_4` (หน้า ๒), `note` (หน้า ๓) |
| `subreg.th.rc.royal_decree.799` | `ver.th.rc.royal_decree.799.v3` | `2025-09-14` / `2025-10-01` | `2025-10-01 .. 2026-09-30` | `796b9aff5270...` | `sec_1_2` (หน้า ๑), `sec_3_amending_clause` (หน้า ๒), `sec_3_quoted_rd646_sec_4` (หน้า ๒), `note` (หน้า ๓) |
| `subreg.th.rc.royal_decree.807` | `ver.th.rc.royal_decree.807.v3` | `2026-08-23` / `2026-10-01` | `2026-10-01 .. 2027-09-30` | `a4e0c55a2324...` | `sec_1_2` (หน้า ๒๐), `sec_3_amending_clause` (หน้า ๒๑), `sec_3_quoted_rd646_sec_4` (หน้า ๒๑), `note` (หน้า ๒๒) |

- **Direct Amendment Edges (`AMENDS`)**: `rd780`, `rd790`, `rd799`, `rd807` -> `subreg.th.rc.royal_decree.646` (anchored on `sec_3_amending_clause` + `sec_3_quoted_rd646_sec_4`).
- **Predecessor History Edges (`SUPERSEDES`)**: `rd790 -> rd780`, `rd799 -> rd790`, `rd807 -> rd799` (anchored on `sec_3_amending_clause`; traceable in graph/card lineage, NEVER promoted to governing authority by graph expansion).
- **Legacy `asrt.rc7.rd*.amends.prev` in `rel.B01.rc8`**: `0` (`zero_legacy_amends_prev_edges_in_rc8: true`).

---

## 4. P0-2 Live Staging Application-Path Retry Proof (Real Neon PostgreSQL, Zero Mocks)

Receipt: `docs/batch1-rc10.3-evidence/rc10_3_app_level_retry_live_neon_receipt.json`  
Supporting DB-layer baseline receipt (preserved from RC10.2): `docs/batch1-rc10.2-evidence/neon_live_transactional_save_and_retry_receipt.json`  
Unique Constraint: `idx_citation_published_answer_save_op_unique` | Model calls during all save/retry ops: `0`

| Scenario | Route & Outcome | Live Neon Row Counts (`ans / clm / lnk / aud`) |
| --- | --- | --- |
| **1a. Failed Mid-TX Save** | HTTP `400`, in-memory leak `false`, API reopen HTTP `404` | `0 / 0 / 0 / 0` |
| **1b. Clean Retry (Key K1)** | HTTP `200`, `ans.rc10_3_app_retry_mwpt1aba.r1`, `idempotent_replay: false` | `1 / 1 / 1 / 1` |
| **2. Lost Response Replay (Key K1)** | HTTP `200`, exact same `ans.rc10_3_app_retry_mwpt1aba.r1`, `idempotent_replay: true` | `1 / 1 / 1 / 1` |
| **3. Same Key K1 + Different Content** | HTTP `409` (`IDEMPOTENCY_KEY_PAYLOAD_CONFLICT_409`) | `1 / 1 / 1 / 1` |
| **4. 3x Concurrent Retries (Key K2)** | HTTP `[200,200,200]`, replays `[false,true,true]`, 1 revision `ans.rc10_3_app_conc_mwpt1aba.r1` | `1 / 1 / 1 / 1` |
| **5. Deliberate Edit (New Key K3) + `?require_db=1` Reopen** | `ans.rc10_3_app_retry_mwpt1aba.r2` (`supersedes: ans.rc10_3_app_retry_mwpt1aba.r1`); both `r1` & `r2` reopen with `persistence_source: neon_postgres`, `claims: 1`, `citations: 1`, `provenance_preserved: true`, `audit_events: 2` | `2 / 2 / 2 / 2` |

---

## 5. Typecheck & Vitest Regression / Gate Suites (`47/47`)

- **Typecheck** (`docs/batch1-rc10.3-evidence/typecheck_attestation.txt`):
```text
Command: npx tsc --noEmit
ExitCode: 0
ExecutedAt: 2026-11-21T09:53:31.8349401+07:00
Output:
```
- **Vitest Raw Log**: `docs/batch1-rc10.3-evidence/vitest_9suites_raw_runner.log` (exit `0`, `18/18` files, `47/47` tests).

| Test File | Passed / Total | Failed | Status |
| --- | --- | --- | --- |
| `tests/knowledge/dodo-query-persist-revision-chain.test.ts` | 3/3 | 0 | passed |
| `tests/knowledge/gate1-generalized-remediation.test.ts` | 5/5 | 0 | passed |
| `tests/knowledge/gemini4-neon-and-claim-calc-isolation.test.ts` | 4/4 | 0 | passed |
| `tests/knowledge/grounded-llm-architecture.test.ts` | 4/4 | 0 | passed |
| `tests/knowledge/hosted-smoke-runner-contract.test.ts` | 4/4 | 0 | passed |
| `tests/knowledge/official-citations-and-claim-traceability-t01-t13.test.ts` | 14/14 | 0 | passed |
| `tests/knowledge/rc10-3-p0-remediation-gates.test.ts` | 4/4 | 0 | passed |
| `tests/knowledge/rc7-thai-legal-index-and-retrieval-gates.test.ts` | 4/4 | 0 | passed |
| `tests/knowledge/retrieval-benchmark-grader-negative-controls.test.ts` | 5/5 | 0 | passed |

---

## 6. Hardened Real-App-Path 38-Case Summary & Trace on `rel.B01.rc8`

Receipt: `docs/batch1-rc10.3-evidence/rc10_3_hardened_real_app_and_boundary_receipt.json`

| Bucket | Cases | Ranking Top-5 | Actual Packet | Recovered Misses | Wrong Ver / Expired Leak | p95 Latency | Final Answer QA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Sealed Positive** | 18 | `18/18` | `18/18` | `0` | `0 / 0` | `173.62 ms` | `NOT_RUN_PRE_LLM_CAPTURE` |
| **Sealed Negative** | 4 | `4/4` | `4/4` | `0` | `0 / 0` | `127.15 ms` | `NOT_RUN_PRE_LLM_CAPTURE` |
| **RC10.1 Regressions** | 5 | `5/5` | `5/5` | `0` | `0 / 0` | `120.64 ms` | `NOT_RUN_PRE_LLM_CAPTURE` |
| **RC10.2 Regressions** | 8 | `8/8` | `8/8` | `0` | `0 / 0` | `149.54 ms` | `NOT_RUN_PRE_LLM_CAPTURE` |
| **RC10.3 Boundary & History** | 3 | `3/3` | `3/3` | `0` | `0 / 0` | `132.79 ms` | `NOT_RUN_PRE_LLM_CAPTURE` |

| Case ID | Bucket | Date | Expected Authority@Version | Top-3 Ranked | Actual Model Packet (+ Roles) | Pre-LLM Status | Rank | Packet | Final Answer QA | First Fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `G-VAT-790-START` | `SEALED_GATE` | `2024-10-01` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.790@ver.th.rc.royal_decree.790.v2`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.790`, 2:`subreg.th.rc.royal_decree.790`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.790` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-790-END` | `SEALED_GATE` | `2025-09-30` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.790@ver.th.rc.royal_decree.790.v2`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.790`, 2:`prov.th.rc.80`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `prov.th.rc.77/2` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-799-START` | `SEALED_GATE` | `2025-10-01` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.799@ver.th.rc.royal_decree.799.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.799`, 2:`subreg.th.rc.royal_decree.799`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.799` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-799-END` | `SEALED_GATE` | `2026-09-30` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.799@ver.th.rc.royal_decree.799.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.799`, 2:`subreg.th.rc.royal_decree.799`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.799` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-807-START` | `SEALED_GATE` | `2026-10-01` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.807@ver.th.rc.royal_decree.807.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.807`, 2:`subreg.th.rc.royal_decree.807`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.807` (governing) (+19 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-807-END` | `SEALED_GATE` | `2027-09-30` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.807@ver.th.rc.royal_decree.807.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.807`, 2:`prov.th.rc.80`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.807` (governing) (+15 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-ZERO-EXPORT` | `SEALED_GATE` | `2026-06-15` | `prov.th.rc.80/1@ver.th.rc.80/1.v1`, `subreg.th.rd.dg_vat.105@ver.th.rd.dg_vat.105.v1` | 1:`prov.th.rc.80/1`, 2:`subreg.th.rd.dg_vat.105`, 3:`subreg.th.rd.dg_vat.105` | `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `subreg.th.rd.dg_vat.105` (governing) (+14 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-EXEMPT-81` | `SEALED_GATE` | `2026-06-15` | `prov.th.rc.81@ver.th.rc.81.v1` | 1:`prov.th.rc.81`, 2:`work.th.rd.gk_0811_2815_2000_de429446`, 3:`work.th.rd.gk_0706_พ_5611_2007_05604217` | `prov.th.rc.81` (governing), `prov.th.rc.81` (governing), `prov.th.rc.81` (governing), `prov.th.rc.81` (governing) (+12 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-MIXED-82-6` | `SEALED_GATE` | `2026-06-15` | `prov.th.rc.82/6@ver.th.rc.82/6.v1` | 1:`prov.th.rc.82/6`, 2:`prov.th.rc.82/3`, 3:`statute.th.rc_amendment_48_2562` | `prov.th.rc.82/6` (governing), `prov.th.rc.82/3` (governing), `prov.th.rc.81` (governing), `prov.th.rc.81` (governing) (+14 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-VAT-CROSSBORDER-PP36` | `SEALED_GATE` | `2026-06-15` | `prov.th.rc.77/2@ver.th.rc.77/2.v1`, `prov.th.rc.83/6@ver.th.rc.83/6.v1` | 1:`prov.th.rc.77/2`, 2:`prov.th.rc.83/6`, 3:`work.th.rd.gk_0706_พ_10129_2006_9a3112ea` | `prov.th.rc.77/2` (governing), `prov.th.rc.77/2` (governing), `prov.th.rc.83/6` (governing), `prov.th.rc.83/6` (governing) (+13 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-EXACT-SEC-80-1-2` | `SEALED_GATE` | `null` | `prov.th.rc.80/1@ver.th.rc.80/1.v1` | 1:`prov.th.rc.80/1`, 2:`work.th.rd.gk_0811_พ_12649_1999_0eef1fd7`, 3:`work.th.rd.gk_0702_พ_10961_2015_6b3bd23d` | `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `subreg.th.rd.dg_vat.105` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-EXACT-RULING-5958` | `SEALED_GATE` | `null` | `work.th.rd.0702_5958_2015_04f2b49f@ver.th.rd.0702_5958_2015_04f2b49f.v1` | 1:`work.th.rd.0702_5958_2015_04f2b49f`, 2:`work.th.rd.0702_5958_2015_04f2b49f`, 3:`work.th.rd.0702_3071_2018_c7300229` | `work.th.rd.0702_5958_2015_04f2b49f` (governing), `work.th.rd.0702_3071_2018_c7300229` (contextual_ruling_or_guidance), `work.th.rd.gk_0702_584_2018_02cb6c88` (contextual_ruling_or_guidance), `work.th.rd.gk_0706_2531_2005_1dd2ede4` (contextual_ruling_or_guidance) (+7 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-GIFT-T09-CONDO-NEPHEW` | `SEALED_GATE` | `2026-06-15` | `prov.th.rc.42@ver.th.rc.42.v1`, `prov.th.rc.48@ver.th.rc.48.v1`, `prov.th.rc.50@ver.th.rc.50.v1`, `prov.th.rc.54@ver.th.rc.54.v1` | 1:`prov.th.rc.42`, 2:`prov.th.rc.48`, 3:`prov.th.rc.50` | `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-GIFT-B1-09-CASH-NIECE` | `SEALED_GATE` | `2026-02-10` | `prov.th.rc.42@ver.th.rc.42.v1`, `prov.th.rc.48@ver.th.rc.48.v1` | 1:`prov.th.rc.42`, 2:`prov.th.rc.48`, 3:`statute.th.rc_amendment_40_2558` | `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing) (+17 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-GIFT-CONDO-BROTHER` | `SEALED_GATE` | `2026-06-15` | `prov.th.rc.42@ver.th.rc.42.v1`, `prov.th.rc.50@ver.th.rc.50.v1`, `prov.th.rc.54@ver.th.rc.54.v1` | 1:`prov.th.rc.42`, 2:`prov.th.rc.48`, 3:`prov.th.rc.50` | `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.48` (governing) (+17 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-PARAPHRASE-EN-VAT` | `SEALED_GATE` | `2026-09-30` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.799@ver.th.rc.royal_decree.799.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rd.vat_local_tax_guide`, 2:`subreg.th.rc.royal_decree.799`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.799` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-PARAPHRASE-EN-GIFT` | `SEALED_GATE` | `2026-06-15` | `prov.th.rc.42@ver.th.rc.42.v1`, `prov.th.rc.48@ver.th.rc.48.v1`, `prov.th.rc.50@ver.th.rc.50.v1`, `prov.th.rc.54@ver.th.rc.54.v1` | 1:`prov.th.rc.42`, 2:`prov.th.rc.48`, 3:`prov.th.rc.50` | `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-ANALOGOUS-RULING-EXPORT` | `SEALED_GATE` | `null` | `prov.th.rc.80/1@ver.th.rc.80/1.v1` | 1:`prov.th.rc.80/1`, 2:`work.th.rd.gk_0702_พ_10961_2015_6b3bd23d`, 3:`work.th.rd.gk_0811_พ_9850_2001_10bfe760` | `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `subreg.th.rd.dg_vat.105` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-NEG-POST-807` | `SEALED_GATE` | `2027-10-01` | `prov.th.rc.80@ver.th.rc.80.v1` | 1:`prov.th.rc.80`, 2:`subreg.th.rd.vat_local_tax_guide`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `prov.th.rc.78` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-NEG-MISSING-DATE-VAT` | `SEALED_GATE` | `null` | `prov.th.rc.80@ver.th.rc.80.v1`, `prov.th.rc.78/1@ver.th.rc.78/1.v1`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`prov.th.rc.80`, 2:`subreg.th.rd.vat_local_tax_guide`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `prov.th.rc.77/2` (governing) (+15 more) | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-NEG-FAKE-RULING-99999` | `SEALED_GATE` | `null` | _(abstention / clarify)_ | 1:`prov.th.rc.3_โสฬส`, 2:`prov.th.rc.3_โสฬส`, 3:`prov.th.rc.3_โสฬส` | _(empty)_ | `INSUFFICIENT_EVIDENCE` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `G-NEG-MISSING-2019-DECREE` | `SEALED_GATE` | `2019-06-15` | _(abstention / clarify)_ | 1:`prov.th.rc.80`, 2:`subreg.th.rd.vat_local_tax_guide`, 3:`subreg.th.rd.vat_local_tax_guide` | _(empty)_ | `INSUFFICIENT_EVIDENCE` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `H-01-VAT-790-MID` | `RC10_1_REGRESSION` | `2025-03-15` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.790@ver.th.rc.royal_decree.790.v2`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.790`, 2:`prov.th.rc.80`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.790` (governing) (+15 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `H-02-VAT-807-MID` | `RC10_1_REGRESSION` | `2027-04-20` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.807@ver.th.rc.royal_decree.807.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.807`, 2:`subreg.th.rc.royal_decree.807`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `prov.th.rc.77/2` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `H-03-GIFT-LAND-CHILD` | `RC10_1_REGRESSION` | `2026-05-01` | `prov.th.rc.42@ver.th.rc.42.v1`, `prov.th.rc.48@ver.th.rc.48.v1`, `prov.th.rc.50@ver.th.rc.50.v1`, `prov.th.rc.54@ver.th.rc.54.v1` | 1:`prov.th.rc.42`, 2:`prov.th.rc.48`, 3:`prov.th.rc.50` | `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.48` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `H-04-SEC-80-1-1-EXPORT-GOODS` | `RC10_1_REGRESSION` | `null` | `prov.th.rc.80/1@ver.th.rc.80/1.v1` | 1:`prov.th.rc.80/1`, 2:`work.th.rd.gk_0811_พ_4119_2002_e71f255b`, 3:`work.th.rd.0811_กม_09_073_2000_71031501` | `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `subreg.th.rd.dg_vat.105` (governing) (+13 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `H-05-NEG-FAKE-RULING-88888` | `RC10_1_REGRESSION` | `null` | _(abstention / clarify)_ | 1:`work.th.rd.gk_0706_5055_2006_b342f86f`, 2:`work.th.rd.gk_0702_1984_2014_81385203`, 3:`work.th.rd.gk_0811_3014_2000_cddeef5a` | _(empty)_ | `INSUFFICIENT_EVIDENCE` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-01-VAT-REQ-DATE-ONLY` | `RC10_2_REGRESSION` | `2025-05-10` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.790@ver.th.rc.royal_decree.790.v2`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`prov.th.rc.80`, 2:`subreg.th.rd.vat_local_tax_guide`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.790` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-02-VAT-DATE-CONFLICT` | `RC10_2_REGRESSION` | `2026-09-15` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.799`, 2:`prov.th.rc.80`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `prov.th.rc.77/2` (governing) (+20 more) | `CLARIFICATION_OR_CONDITIONAL_NEEDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-03-EXPORT-SERVICE-FRESH` | `RC10_2_REGRESSION` | `null` | `prov.th.rc.80/1@ver.th.rc.80/1.v1`, `subreg.th.rd.dg_vat.105@ver.th.rd.dg_vat.105.v1` | 1:`prov.th.rc.80/1`, 2:`subreg.th.rd.dg_vat.105`, 3:`subreg.th.rd.dg_vat.105` | `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `prov.th.rc.80/1` (governing), `subreg.th.rd.dg_vat.105` (governing) (+13 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-04-CROSSBORDER-INBOUND-FRESH` | `RC10_2_REGRESSION` | `null` | `prov.th.rc.77/2@ver.th.rc.77/2.v1`, `prov.th.rc.83/6@ver.th.rc.83/6.v1` | 1:`prov.th.rc.77/2`, 2:`prov.th.rc.83/6`, 3:`work.th.rd.gk_0706_พ_10129_2006_9a3112ea` | `prov.th.rc.77/2` (governing), `prov.th.rc.77/2` (governing), `prov.th.rc.83/6` (governing), `prov.th.rc.83/6` (governing) (+5 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-05-WHT-INCIDENTAL-VAT-GOVT` | `RC10_2_REGRESSION` | `2026-06-15` | `prov.th.rc.69_ทวิ@ver.th.rc.69_ทวิ.v1`, `prov.th.rc.50@ver.th.rc.50.v1` | 1:`prov.th.rc.69_ทวิ`, 2:`prov.th.rc.50`, 3:`work.th.rd.gk_0706_กม_05_1022_2004_8795856c` | `prov.th.rc.69_ทวิ` (governing), `prov.th.rc.69_ทวิ` (governing), `prov.th.rc.50` (governing), `prov.th.rc.50` (governing) (+14 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-06-WHT-INCIDENTAL-VAT-PRIVATE` | `RC10_2_REGRESSION` | `2026-06-15` | `prov.th.rc.3_เตรส@ver.th.rc.3_เตรส.v1`, `subreg.th.rd.order_tp.4_2528@ver.th.rd.order_tp.4_2528.v1` | 1:`prov.th.rc.3_เตรส`, 2:`subreg.th.rd.order_tp.4_2528`, 3:`subreg.th.rd.order_tp.4_2528` | `prov.th.rc.3_เตรส` (governing), `prov.th.rc.3_เตรส` (governing), `prov.th.rc.3_เตรส` (governing), `subreg.th.rd.order_tp.4_2528` (governing) (+15 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-07-PROP-FATHER-CHILD-UNDER-20M` | `RC10_2_REGRESSION` | `2026-06-15` | `prov.th.rc.42@ver.th.rc.42.v1` | 1:`prov.th.rc.42`, 2:`prov.th.rc.48`, 3:`prov.th.rc.50` | `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.42` (governing), `prov.th.rc.48` (governing) (+16 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `F-08-MULTITURN-FACT-CHANGE` | `RC10_2_REGRESSION` | `2026-10-15` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.807@ver.th.rc.royal_decree.807.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.807`, 2:`prov.th.rc.80`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `prov.th.rc.77/2` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `B-01-HIST-RD646-2018` | `RC10_3_BOUNDARY_AND_HISTORY` | `2018-06-15` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.646@ver.th.rc.royal_decree.646.v2`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`prov.th.rc.80`, 2:`subreg.th.rd.vat_local_tax_guide`, 3:`subreg.th.rd.vat_local_tax_guide` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.646` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `B-02-HIST-RD780-DAY-BEFORE-790` | `RC10_3_BOUNDARY_AND_HISTORY` | `2024-09-30` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.780@ver.th.rc.royal_decree.780.v2`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.780`, 2:`subreg.th.rc.royal_decree.780`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.780` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |
| `B-03-RC10_2-RD646-LEAK-CHECK-ON-807` | `RC10_3_BOUNDARY_AND_HISTORY` | `2026-10-01` | `prov.th.rc.80@ver.th.rc.80.v1`, `subreg.th.rc.royal_decree.807@ver.th.rc.royal_decree.807.v3`, `subreg.th.rd.vat_local_tax_guide@ver.th.rd.vat_local_tax_guide.v1` | 1:`subreg.th.rc.royal_decree.807`, 2:`subreg.th.rc.royal_decree.807`, 3:`prov.th.rc.80` | `prov.th.rc.80` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rd.vat_local_tax_guide` (governing), `subreg.th.rc.royal_decree.807` (governing) (+20 more) | `READY_FOR_LLM_GROUNDED` | **PASS** | **PASS** | `NOT_RUN_PRE_LLM_CAPTURE` | `NONE` |

---

## 7. Post-`f325766` Staging Unblock: Vercel Hobby 12-Function Packaging Fix & Distinct-Edit Concurrency Proof

- **Remediation Baseline Preserved**: `f325766d06a2ad2037282112826a7ed69a4557cc` (tag `archive/b01-rc10.3-f325766`)
- **Comparison Baseline Preserved**: `316cdadd1b784692a6b992139e9b3ef354a1e2bd` (`rel.B01.rc7`, tag `archive/b01-rc10.2-316cdad`)
- **Corpus & Manifest Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (Manifest SHA-256 `1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`, Lexical Disk Snapshot SHA-256 `b72c8a5aee209ef707a6279c0ac6f9369989c1c71cddb172318b158a3dcdb1a7`, `lexical_disk_unchanged: true`)
- **Production Behavior / Model / Search / Auth / Audit**: **ZERO changes**

### 7.1 Track-by-Track Decisions (`PASS / STOP / BLOCKED`)

| Track | Decision | Summary & Receipt |
| --- | --- | --- |
| **A. P0-1 Build & Packaging (≤ 12 Hobby Functions)** | **PASS** _(Clean local Preview build & exact `@vercel/next` grouping simulation; Vercel Linux Ready confirmation pending post-push deploy)_ | Emitted Vercel Serverless Functions dropped from **11 local / 14 Vercel Linux (`FAIL > 12`) -> `2` Serverless Functions (`PASS <= 12`, 10 functions headroom)**; routes > 225 MiB solo dropped from `8` (plus `4` borderline at `224.74 MiB`) to **`0`**; max function size dropped from `274.81 MiB` to **`105.14 MiB`**; total Lambda storage dropped **`-92.5%`** (`2,747.5 MiB -> 205.57 MiB`); Turbopack warnings dropped `2 -> 0`. Receipts: [rc10_3_vercel_packaging_before_after_inventory.json](rc10_3_vercel_packaging_before_after_inventory.json), [rc10_3_preview_next_build.log](rc10_3_preview_next_build.log), [rc10_3_packaging_typecheck.log](rc10_3_packaging_typecheck.log) (`exit 0`), [rc10_3_packaging_vitest.log](rc10_3_packaging_vitest.log) (`9/9` suites, `48/48` tests, `exit 0`). |
| **B. P0-2 Distinct-Edit Concurrency (Same Predecessor)** | **PASS** _(Real staging route handlers + live Neon PostgreSQL, ZERO mocks)_ | Removed unsafe `ON CONFLICT (answer_revision_id) DO NOTHING` on parent `citation_published_answer` insert and mapped unmatched PostgreSQL `23505` PK collision to HTTP `409` (`CONCURRENT_EDIT_PREDECESSOR_CONFLICT_409`). Live Neon proof passes BOTH concurrent distinct edits with distinct `save_operation_key`s (`r1 -> editA vs editB`: `[200, 409]`, live Neon `2/2/2/2`) AND without keys (`r2 -> editC vs editD`: `[200, 409]`, live Neon `3/3/3/3`), ZERO orphaned child rows, byte-for-byte `?require_db=1` Neon readback match (`persistence_source: neon_postgres`), and `0` model calls. Receipt: [rc10_3_distinct_edit_concurrency_live_neon_receipt.json](rc10_3_distinct_edit_concurrency_live_neon_receipt.json). |
| **C. P0-2 Named Tester Access** | **BLOCKED** _(Platform Engineering)_ | Local Vercel CLI is logged out (`Logged out.`); Platform Engineering must confirm the new Ready protected Preview deployment for the pushed RC10.3 commit and grant preview access to one named QA tester via their own Vercel account (keeping Deployment Protection ON; no anyone-with-link fallback without Owner approval). |
| **D. P0-2 Hosted Linux Parity (`environment?probe_tokenizer=1`)** | **BLOCKED** _(Pending Preview deploy + named tester session)_ | Cannot execute against the hosted Linux Preview until Platform confirms the Ready deployment and named tester access. |
| **E. P0-2 Normal `/legal-review` UI Smoke + Neon Reopen (`gemini-4-neon @ low`)** | **BLOCKED** _(Pending Preview deploy + named tester session)_ | Cannot run normal UI submit (without request override) + save + `?require_db=1` reopen in the named tester's session until Preview access is unblocked. |
| **F. Legal Review (Parallel Track)** | **PENDING_LEGAL_SIGN_OFF** | RD 790/799/807 official Gazette verification, split §3 vs quoted RD 646 §4, and `AMENDS` vs `SUPERSEDES` graph mapping are packaged in [verified_royal_decrees_rc8_source_and_graph_map.json](verified_royal_decrees_rc8_source_and_graph_map.json) for parallel Legal review. |

### 7.2 Root Cause & Before/After Function Inventory (`f325766` vs Packaging Fix)

Zero new routes were added between RC10.2 (`316cdad`, deployed cleanly on Hobby) and RC10.3 (`f325766`, failed Hobby 12-function limit). Exact `@vercel/next` bundler inspection (`DEFAULT_MAX_UNCOMPRESSED_LAMBDA_SIZE = 250 MiB`, `LAMBDA_RESERVED_UNCOMPRESSED_SIZE = 25 MiB`, `normalBudget = 225 MiB`, `next-server` base layer `= 13.90 MiB`) exposed two compounding tracing leaks:

1. **Turbopack Whole-Project Dynamic-FS Trace (`src/core/knowledge/tax-foundation-layer.ts:342,344`)**: Unguarded `fs.existsSync(targetPath)` / `fs.readFileSync(targetPath)` forced Turbopack to trace the entire workspace (`28.72 MiB` raw VAT OCR PDF, `40.49 MiB` raw `thai-tax-rulings-corpus.json`, `7.24 MiB` raw `legal-resource-master-corpus.json`, `34 MiB` legacy `rc1` store) into all `8` routes importing `query.ts` -> each grew to `272.33–274.81 MiB` (`>= 225 MiB` -> `isLargeFunction = true` -> `8` forced solo Lambdas, all exceeding AWS's `250 MiB` cap).
2. **Broad Preview `outputFileTracingIncludes` (`next.config.ts`) + `store.ts` Legacy Store Trace**: Copying `./data/knowledge-store-b01-rc2-staging/**/*` (`60.1 MiB`, including dead `rc5 = 19.3 MiB`, old `rc6 = 7.7 MiB`, old `rc7 = 7.7 MiB`) plus legacy `rc1` (`34 MiB`) into all 20 `/api/v1/knowledge/*` routes meant adding `rel.B01.rc8` (`+8.26 MiB`) pushed 4 routes (`batches/[id]/runs`, `releases/[id]/promote`, `rollback`, `uat-decisions`) to `224.74 MiB` locally (crossing `225.00 MiB` on Vercel Linux -> splitting into 4 additional solo Lambdas -> **14–15 Serverless Functions > 12 Hobby limit**).

| Metric | Before (`f325766`) | After (Minimal Reversible Packaging Fix) |
| --- | ---: | ---: |
| **Emitted Vercel Serverless Functions** | `11` local / `14` Vercel Linux (**FAIL > 12**) | **`2`** (`Fn #1`: 122 default routes `105.14 MiB`; `Fn #2`: `/api/v1/knowledge/query` `maxDuration=300` `100.43 MiB`) (**PASS <= 12**) |
| **Routes >= 225 MiB solo (forced split)** | `8` (`272.33–274.81 MiB`) + `4` borderline (`224.74 MiB`) | **`0`** |
| **Routes > 250 MiB AWS Lambda limit** | `8` | **`0`** |
| **Unique serverless union size** | `277.08 MiB` (`2,091` files) | **`105.16 MiB`** (`1,519` files, `-62.0%`) |
| **Total emitted Lambda storage sum** | `2,747.5 MiB` | **`205.57 MiB`** (`-92.5%`) |
| **Turbopack dynamic-FS warnings** | `2` | **`0`** |
| **Batch 1 required routes retained** | `11/11` (`/legal-review` static + `10` API routes) | **`11/11` retained intact (all `10` API routes verified to trace exact `rel.B01.rc8` runtime files and ZERO `rc1`/`rc5`/`rc6`/`rc7`/VAT PDF files)** |

Full 129-entry route-to-function inventory marked `required_for_batch1: true/false` is recorded in [rc10_3_vercel_packaging_before_after_inventory.json](rc10_3_vercel_packaging_before_after_inventory.json).

---

## 8. Hosted Verification Readiness, P0-1 RC8-Only Guard Fix, P0-3 Historical VAT Audit & Parallel Security Track

- **Prior Ready Deployment Baseline Preserved**: `0b7cad44c0f6900d04b5e14117338fbdda4f19d5` (`https://vercel.com/7-l-advisory/reg24/Fso9WmCZ7UeReM4quFMronGhH3RV`, tag `archive/b01-rc10.3-0b7cad4`)
- **Corpus & Manifest Still Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (Manifest SHA-256 `1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`, `0` changes under `data/`)

### 8.1 P0-1 Finding on `0b7cad4` & Surgical Remediation (New Pin Required Per P0-1)

Code audit of `0b7cad4` confirmed that the scored path **could** accept a request `release_id` override (e.g., `rel.B01.rc7`, `rel.B01.rc6`, `rel.B01.rc5`) via `POST /api/v1/knowledge/query`, and because those older projection files are excluded from this RC8-only Preview, `retrieveAuthorizedKnowledge` (`src/core/knowledge/retrieval.ts`) **silently fell back** to a brute-force substring scan (`retrieval.ts:818`) and live canonical assertions (`retrieval.ts:953`).

Per P0-1 (*"If it can, reject the override on the protected QA path and retest on a new pin if a code change is required"*), the smallest targeted fix was applied:
- `src/app/api/v1/knowledge/query/route.ts` & `src/app/api/v1/knowledge/attachments/route.ts`: Reject any `release_id` override differing from the pinned active release (`rel.B01.rc8`) on Preview (`VERCEL_ENV === "preview"` or `REG24_STRICT_PINNED_RELEASE_ONLY=1`) with HTTP `400` (`RELEASE_OVERRIDE_REJECTED_400`), and reject any unbundled release override missing packaged lexical/graph projections (`UNBUNDLED_RELEASE_OVERRIDE_REJECTED_400`).
- `src/core/knowledge/projections.ts` & `src/core/knowledge/retrieval.ts`: Added `assertReleaseProjectionArtifactsReady`; on Preview (`require_pinned_projections`), missing or incompatible lexical (v2 fielded BM25) or graph projection artifacts fail hard with HTTP `503` (`PROJECTION_ARTIFACT_MISSING_OR_INCOMPATIBLE_503`) — ZERO silent fallback.
- `src/app/api/v1/knowledge/environment/route.ts`: Added `deployment_id`, `runtime_platform`, `runtime_arch`, `node_version`, `strict_single_release_preview`, `release_override_rejected_on_preview`, and `silent_retrieval_fallback_disabled` so `GET /api/v1/knowledge/environment?probe_tokenizer=1` returns all P0-1 preflight fields in one response.
- Regression proof: `tests/knowledge/rc10-3-p0-remediation-gates.test.ts` Test #6 (all 9 suites `49/49` PASS, raw log [rc10_3_rc8_guard_vitest.log](rc10_3_rc8_guard_vitest.log)).

### 8.2 P0-2 Read-Only Neon Audit Helper for QA's Locked Two-Session Run

- Engineering live Neon distinct-edit receipt (separate from same-key retry): [rc10_3_distinct_edit_concurrency_live_neon_receipt.json](rc10_3_distinct_edit_concurrency_live_neon_receipt.json).
- Read-only Neon audit script (`SELECT`-only, zero writes) ready to produce the run-tied receipt when QA executes its locked two-session case: `scripts/audit-rc10-3-qa-two-session-readonly.ts` (smoke-verified read-only against live staging Neon).

### 8.3 P0-3 Historical VAT Cutoff Audit (For Dated Legal Scope Decision Before Scoring)

Receipt: [rc10_3_p03_historical_vat_cutoff_audit.json](rc10_3_p03_historical_vat_cutoff_audit.json)

- **2018-10-01 .. 2023-09-30** (including the missing RD 724 window and day-before-cutoff `2023-09-30`): `rel.B01.rc8` returns `INSUFFICIENT_EVIDENCE` (abstains cleanly rather than guessing a rate).
- **2017-10-01 .. 2018-09-30** (e.g. `2018-06-15`): `rel.B01.rc8` **currently still returns** `subreg.th.rc.royal_decree.646@ver.th.rc.royal_decree.646.v2` (backed by the current consolidated RD 646 PDF) as `governing`. **Corpus left untouched pending Legal's dated P0-3 decision** (if Legal adopts the recommended `1 October 2566 (2023-10-01)` cutoff so pre-cutoff dates must never cite today's consolidated RD 646 as historical proof, a targeted corpus/guard update for pre-`2023-10-01` RD 646 dates will be needed before scoring pre-cutoff cases).
- **2023-10-01 .. 2027-09-30** & post-807 (`2027-10-01`): Exact official Gazette originals for RD 780 (`2023-10-01..2024-09-30`), RD 790 (`2024-10-01..2025-09-30`), RD 799 (`2025-10-01..2026-09-30`), RD 807 (`2026-10-01..2027-09-30`), and post-807 historical-only behavior (`2027-10-01`).

### 8.4 Parallel Security Track — Next.js `16.4.2` Advisories & Isolated `16.4.5` Worktree Patch

Receipt: [rc10_3_nextjs_security_advisory_assessment.json](rc10_3_nextjs_security_advisory_assessment.json)

- **7 Advisories Affecting `next@16.4.2` (All Patched in `next@16.4.5`)**:
  - `GHSA-mfr8-8qww-v76h`, `GHSA-vc7v-qv4w-wrv8`, `GHSA-rhh4-g77r-r9qj`, `GHSA-vvgp-ww4w-46vf` (`'use cache'`, `unstable_cache()`, `rootParams`, `cacheComponents`) → **NOT_APPLICABLE** (`0` usages in REG24).
  - `GHSA-f3mh-rxg3-f5g2` (`CVE-2026-119346`, Edge runtime routes setting cookies) → **NOT_APPLICABLE** (`0` Edge runtime routes, `0` middleware/proxy files).
  - `GHSA-pc58-hwjq-p385` (`CVE-2026-119348`, self-hosted HTTP/1.1 proxy fetch response forwarding) → **NOT_APPLICABLE** (hosted on Vercel; `0` raw fetch-forwarding routes).
  - `GHSA-7qx7-33qx-rqx2` (`CVE-2026-119347`, self-hosted `/_next/image` SVG bypass) → **NOT_APPLICABLE** (hosted on Vercel managed hosting behind Deployment Protection; `0` `next/image` imports; no `images.remotePatterns`).
- **Verdict**: Protected Preview is **not affected** (`stop_tester_access_required: false`). QA pin kept on `next@16.4.2` untouched in place.
- **Smallest Supported Patch Prepared in Separate Worktree**: Branch `chore/security-next-16.4.5-patch` (commit `ea43d2f1bdc91caeebac3eb65697b002a80968c5`, branched from `0b7cad4`, NOT pushed/deployed): `next` `16.4.2 -> 16.4.5`, verified with `0` Next.js `npm audit` vulnerabilities, `tsc --noEmit` exit `0`, clean Preview `next build` exit `0`, and `2` simulated Vercel Serverless Functions (`105.14 MiB` max).

### 8.5 Go/No-Go Status Matrix (`PASS / STOP / BLOCKED`)

| Gate / Item | Owner | Status | Reason / Next Action |
| --- | --- | --- | --- |
| **P0-1a \| RC8-only override rejection & no silent retrieval fallback** | Engineering | **PASS** *(code + 49/49 Vitest + clean Preview build; re-confirm on new hosted pin)* | Fixed override hole found on `0b7cad4`: `release_id` overrides now reject HTTP `400` on Preview and missing/incompatible artifacts fail hard HTTP `503` (zero silent fallback). |
| **P0-1b \| Named QA tester access & live Linux `/environment?probe_tokenizer=1`** | Platform + QA | **BLOCKED** | Local Vercel CLI is logged out (`Logged out.`). Platform must grant one named QA tester access via their own Vercel account on the commit-specific protected Preview URL and run `GET /api/v1/knowledge/environment?probe_tokenizer=1`. |
| **P0-2a \| Normal `/legal-review` UI smoke, citation open & `?require_db=1` Neon reopen** | Platform + QA | **BLOCKED** | Pending named QA tester access on the protected Preview URL. |
| **P0-2b \| Live Neon distinct-edit proof & read-only QA two-session audit script** | Engineering | **PASS** *(engineering evidence ready; QA two-session audit script ready)* | Attached live Neon distinct-edit receipt (`[200,409]`, zero orphans, exact readback) + verified read-only audit script `scripts/audit-rc10-3-qa-two-session-readonly.ts`. |
| **P0-3 \| Dated Legal scope decision on historical VAT (`1 Oct 2566` cutoff vs full pre-cutoff reconstruction)** | Legal + Data Eng + QA | **BLOCKED** *(awaiting dated Legal addendum)* | Audit confirms `rel.B01.rc8` abstains on `2018-10-01..2023-09-30` (missing RD 724) and currently cites consolidated RD 646 on `2017-10-01..2018-09-30`. Record dated Legal decision before any scored run. |
| **Parallel Security Track \| Next.js `16.4.2` advisory assessment & isolated `16.4.5` patch** | Platform + Security | **PASS** *(Preview unaffected; isolated patch ready)* | All 7 GHSAs confirmed `NOT_APPLICABLE` to Vercel Preview; `next@16.4.5` verified in separate local worktree branch `chore/security-next-16.4.5-patch` (`ea43d2f`) without altering QA pin. |

---

## 9. Track 2 Final Build Fix: Pre-Cutoff VAT Coverage Gate (`>= 1 Oct 2566`), Split-Payment Diagnostic & Newly-Uploaded PDF Guard

- **Access/Diagnostics Baseline Preserved**: `2a1dbc05c37a1d006737c6827f139392673eca7a` (`https://reg24-obvvaen0q-7-l-advisory.vercel.app/legal-review`, tag `archive/b01-rc10.3-2a1dbc0`)
- **Corpus, Manifest & Model Stack Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (`1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`), TS BM25+Graph, `gemini-4-neon @ low`, `0` changes under `data/`.

### 9.1 Engineering Changes Applied Before Selection, Generation & Calculation

1. **Universal Pre-Cutoff Domestic VAT-Rate Gate (`VAT_RATE_VERIFIED_COVERAGE_START_ISO = "2023-10-01"`)** in `src/core/knowledge/query.ts`, `src/core/knowledge/legal-issue-fact-analyzer.ts`, `src/core/knowledge/grounded-llm-drafter.ts`, and `src/core/knowledge/tax-calculation-verifier.ts`:
   - Enforced **before governing-source selection, LLM generation, and tax calculation** on both grounded-LLM and deterministic paths.
   - Any domestic VAT-rate tax point `< 2023-10-01` (including `2018-06-15`, `2022-05-15`, `2023-09-30`) short-circuits with `status: "INSUFFICIENT_EVIDENCE"`, a clear Thai limitation notice referencing the `1 ตุลาคม 2566` cutoff and incomplete pre-cutoff amendment chain (including original Gazette RD 646 and RD 724), **zero rate**, **zero calculation**, and **zero consolidated RD 646 citation**.
   - Consolidated-derived `subreg.th.rc.royal_decree.646` (`CONSOLIDATED_DERIVED`) is permanently blocked from entering `actual_model_packet` as `governing` on any date until original Gazette RD 646 is verified.
   - Missing or ambiguous dates (including partial year-only dates like `"ในปี 2568"`) return `status: "NEEDS_CLARIFICATION"` with zero guessed rate or calculation.
2. **Split-Payment Multi-Tax-Point Handling** in `src/core/knowledge/case-fact-ledger.ts`, `src/core/knowledge/query.ts`, and `src/core/knowledge/grounded-llm-drafter.ts`:
   - Detects split-payment / deposit / installment VAT transactions and **never collapses the whole transaction to the earlier date**.
   - Supported handover split (`25 กันยายน 2568` + `5 ตุลาคม 2568`): preserves separate portion dates and attaches both `subreg.th.rc.royal_decree.790` and `subreg.th.rc.royal_decree.799` as governing.
   - Cutoff-straddling split (`25 กันยายน 2566` + `5 ตุลาคม 2566`): emits a per-portion limitation naming both dates without applying either date to the whole transaction, with zero rate, calculation, or consolidated RD 646 citation.
3. **Newly Uploaded Official PDF Guard** in `src/app/api/v1/knowledge/attachments/route.ts`:
   - On protected Preview, requires both separate `publication_date` and `effective_from` fields (`422` if either missing) and confirmed Neon persistence (`503` if not persisted) before entering governing evidence.

### 9.2 Acceptance Verification Receipts (Thai Free Text, Zero Date Overrides)

- **VAT Cutoff & Split-Payment Acceptance Sweep (`11/11` PASS, `applicable_date: null`)**: [rc10_3_vat_cutoff_and_split_payment_acceptance.json](rc10_3_vat_cutoff_and_split_payment_acceptance.json)
- **Full 9-Suite Vitest Regression (`50/50` PASS, exit `0`, including Test #7)**: [rc10_3_final_vat_cutoff_vitest.log](rc10_3_final_vat_cutoff_vitest.log)
- **TypeScript (`tsc --noEmit`)**: exit `0`
- **Preview Build Packaging**: `2` simulated Vercel Serverless Functions (`<= 12` Hobby limit), `0` Turbopack warnings.

---

## 10. Per-Tax-Point Authority & Validity Fix (RD 807 Expiry Split, Handover Split, Prior-Invoice Fixation & Uploaded-PDF Neon Readback)

- **Frozen Diagnosis Baseline Preserved**: `b6f726ee9531aa79e72bf9d7fd7205c637a9297d` (Vercel deployment `96ULi9iw5c5RmUaNkfnD8GvZhqcx`, tag `archive/b01-rc10.3-b6f726e`)
- **Corpus, Manifest & Model Stack Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (`1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`), TS BM25+Graph, `gemini-4-neon @ low`, `0` changes under `data/`.

### 10.1 BEFORE Reproduction on Frozen `b6f726e` (No Date Override)

Receipt: [rc10_3_rd807_split_expiry_before_diagnostic.json](rc10_3_rd807_split_expiry_before_diagnostic.json)

- Fictional domestic service split: **฿40,000 paid on 30 September 2570 (`2027-09-30`)** + **฿60,000 paid on 1 October 2570 (`2027-10-01`)**, no earlier invoice or use (`applicable_date: null`).
- **Defect 1 (Packet-level global demotion)**: All 3 `subreg.th.rc.royal_decree.807` passages were wrongly marked `evidence_role: "historical_or_excluded_context"` (despite `temporal_applicability_hint: "IN_WINDOW"` for Portion 1) because Portion 2 (`2027-10-01`) globally added `RD 807` to `historicalContextWorkIds`.
- **Defect 2 (Final-answer suppression of Portion 2)**: In the live `gemini-4-neon @ low` output (`trc.b483d70342e9e7`), **Portion 2 (`2027-10-01`, ฿60,000) was completely suppressed before publication** (`ระบบระงับข้อความร่าง 1 ประเด็น`).

### 10.2 Generalized Per-Tax-Point Engineering Fix

1. **Per-Tax-Point Metadata & §78/1(1) Prior-Invoice Fixation** (`src/core/knowledge/case-fact-ledger.ts`):
   - Assigned `portion_index`, `governing_decree_work_id`, and `expired_or_non_governing_work_ids` per tax point on split-payment transactions.
   - Added §78/1(1) prior full-invoice fixation: when a single full `INVOICE` strictly precedes the earliest `PAYMENT` (without per-installment invoicing wording), `controlling_tax_point.iso_date` resolves to the invoice date rather than splitting by payment dates.
2. **Per-Tax-Point Evidence Role & Validity Packing** (`src/core/knowledge/query.ts`, `src/core/knowledge/grounded-llm-drafter.ts`):
   - Prevented `historicalContextWorkIds` from demoting any instrument that actively governs an earlier tax point.
   - Computed `applicable_tax_point_dates` and `excluded_tax_point_dates` per passage in `buildGroundedPassagePack` and exposed them in `PASSAGE_PACK` and `RealAppEvidenceAssemblyCapture`.
3. **Per-Tax-Point Verifier & Explicit-Exclusion Context Grounding** (`src/core/knowledge/grounded-llm-verifier.ts`, `src/core/knowledge/answer-verification.ts`):
   - Resolved target portion date per issue (preferring issue title/scope before explanation text so referencing an expiry date does not blur target portion identity).
   - Blocked any issue attempting to inherit an excluded decree as governing (`OUT_OF_EFFECTIVE_DATE_WINDOW`) or cite an uncited/hallucinated decree without explicit exclusion (`UNGROUNDED_OR_CONTRADICTED_CLAIM`), while allowing a post-expiry claim citing `มาตรา 80` to explicitly name a supplied-but-excluded decree (`RD 807`) strictly in an exclusion context without false suppression.
4. **Uploaded Official PDF Durable Neon Readback Check** (`src/app/api/v1/knowledge/attachments/route.ts`):
   - On protected Preview, verifies `SELECT COUNT(*) FROM citation_evidence_passage WHERE version_id = $1` matches inserted passages after `persistCitationSourceBundleToPostgres` (`503` if readback fails).

### 10.3 AFTER Live `gemini-4-neon @ low` & Regression Verification Receipts

- **Live 4-Scenario `gemini-4-neon @ low` Final-Answer Receipt (`applicable_date: null`, `0` rejected claims, `0` fallbacks)**: [rc10_3_per_tax_point_live_after_verification.json](rc10_3_per_tax_point_live_after_verification.json)
  - `LIVE-SPLIT-RD807-EXPIRY` (`trc.36a66c1010dbad`): `CONDITIONAL`, `3/3` claims `VERIFIED`, `rejected=0` — `RD 807` packed as `governing` with `applicable_tax_point_dates: ["2027-09-30"]`, `excluded_tax_point_dates: ["2027-10-01"]`; Portion 1 (`2027-09-30`, ฿40,000) cites `RD 807` (`7.0% = ฿2,800`); Portion 2 (`2027-10-01`, ฿60,000) cites ONLY `มาตรา 80` + `มาตรา 78/1`, explicitly excludes expired `RD 807`, assumes no future reduction decree, and states the statutory `10.0%` (`฿6,000`) ceiling unless a new Royal Decree is enacted.
  - `LIVE-SPLIT-HANDOVER-790-799` (`trc.16e035c05a2c59`): `ANSWERED`, `2/2` claims `VERIFIED`, `rejected=0` — Portion 1 (`2025-09-25`, ฿40,000) cites `RD 790` (`7.0% = ฿2,800`), Portion 2 (`2025-10-05`, ฿60,000) cites `RD 799` (`7.0% = ฿4,200`).
  - `LIVE-SPLIT-CUTOFF-STRADDLE-2566` (`trc.23204b2e5589b6`): `INSUFFICIENT_EVIDENCE`, per-portion limitation naming `2023-09-25` and `2023-10-05`, zero rate/calc/consolidated RD 646.
  - `LIVE-PRIOR-INVOICE-FIXED-790` (`trc.da091c7a979eec`): `ANSWERED`, `2/2` claims `VERIFIED`, `rejected=0` — §78/1(1) prior invoice (`2025-09-25`) fixes whole transaction under `RD 790` (`7.0% = ฿7,000`), excluding `RD 799`.
- **Full 9-Suite Vitest Regression (`51/51` PASS, exit `0`, including Test #8 + 3 negative controls)**: [rc10_3_per_tax_point_vitest.log](rc10_3_per_tax_point_vitest.log)
- **TypeScript (`tsc --noEmit`)**: exit `0`
- **Preview Build Packaging**: `2` simulated Vercel Serverless Functions (`<= 12` Hobby limit), `0` Turbopack warnings.

---

## 11. Partial-Invoice Coverage Rule (§78/1(1)) — Diagnostic on `d4b3e40`, Generalized Fix & Controls

- **Frozen First-Check Baseline Preserved**: `d4b3e40c8c125d464fc31fff660810df0e8c5635` (protected Preview `https://reg24-aczqyjdjn-7-l-advisory.vercel.app`, pushed tag `archive/b01-rc10.3-d4b3e40`).
- **Corpus, Manifest & Model Stack Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (`1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`), TS BM25+Graph, `gemini-4-neon @ low`, `0` changes under `data/`.
- **Next.js `16.4.2` Advisory Invariance**: `0` diffs in `package.json`, `package-lock.json`, or `next.config.ts` since `2a1dbc0`, and `0` uses of `next/image`, `'use cache'`, `unstable_cache`, or `runtime = 'edge'`; the prior `NOT_APPLICABLE` Vercel Preview assessment ([rc10_3_nextjs_security_advisory_assessment.json](rc10_3_nextjs_security_advisory_assessment.json)) applies identically to `d4b3e40` and this replacement commit.

### 11.1 BEFORE Material Defect Reproduced on Frozen `d4b3e40` (No Date Override)

Receipt: [rc10_3_partial_invoice_before_diagnostic_d4b3e40.json](rc10_3_partial_invoice_before_diagnostic_d4b3e40.json) (`bug_reproduced_on_d4b3e40: true`)

- Fictional **฿100,000** domestic consulting service: **only ฿40,000 invoiced on 25 Sep 2568 (`2025-09-25`, before handover)** → **฿40,000 paid on 30 Sep 2568 (`2025-09-30`)** → **remaining ฿60,000 paid on 5 Oct 2568 (`2025-10-05`, after handover)**.
- On `d4b3e40` (`DIAG-PARTIAL-INVOICE-COLLAPSE-BUG`, `trc.da8b54890eabcc`), `case-fact-ledger.ts` checked only invoice count and date (not coverage), so `priorInvoiceFixesWholeTaxPoint` misfired (`controlling_date_iso: "2025-09-25"`), assembling **only `RD 790`** and **completely omitting `RD 799`** from the model packet — causing the live final answer to claim no reduction decree existed for 5 Oct 2568 and fall back to §80's 10% ceiling instead of `RD 799` (7% = ฿4,200).

### 11.2 Generalized Shared Rule Fix (`src/core/knowledge/case-fact-ledger.ts`, `src/core/knowledge/grounded-llm-drafter.ts`)

1. **Clause-Scoped Event & Amount Extraction**: Extracts per-event `amount_thb` strictly after the event's verb (preventing preceding contract totals from masquerading as invoice amounts), supports both Thai and English invoice/payment/service-use verbs, prevents settlement references (`ตามใบกำกับภาษีดังกล่าว` / `of that invoiced amount`) from creating phantom invoices, and preserves Revenue Code §78/1(1) precedence when earlier `SERVICE_USE` precedes an invoice.
2. **Invoice Coverage Check (`invoiceCoversFullTransaction`)**: Fixes the whole transaction at the invoice date **only** when the prior invoice covers the full transaction (`hasExplicitFullInvoiceWording` or `priorInvoiceAmt >= referenceTotalThb`, with zero partial wording). Any partial invoice (`priorInvoiceAmt < referenceTotalThb` or partial wording) or unstated-coverage invoice before multi-date split payments routes to `PARTIAL_INVOICE_MULTI_TAX_POINT` instead of collapsing.
3. **Anti-Double-Taxation Settlement Exclusion**: Excludes the settlement payment for an already-invoiced portion (`2025-09-30` or post-handover `2025-10-02`) from `split_payment_tax_points` so `PASSAGE_PACK` carries clean non-overlapping per-portion validity (`RD 790` on `2025-09-25` for invoiced ฿40,000; `RD 799` on `2025-10-05` for uninvoiced ฿60,000) without taxing the invoiced ฿40,000 twice or shifting its decree.

### 11.3 AFTER Live `gemini-4-neon @ low` & Regression Verification Receipts

- **Live 5-Scenario `gemini-4-neon @ low` Final-Answer Receipt (`applicable_date: null`, `0` rejected claims, `0` fallbacks)**: [rc10_3_partial_invoice_after_verification.json](rc10_3_partial_invoice_after_verification.json)
  - `DIAG-PARTIAL-INVOICE-COLLAPSE-BUG` (`trc.9a826a57861f09`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — Portion 1 (฿40k invoiced `2025-09-25`, paid `2025-09-30`) → `RD 790` (`7.0% = ฿2,800`, explicitly no double taxation on `2025-09-30`); Portion 2 (฿60k paid `2025-10-05`) → `RD 799` (`7.0% = ฿4,200`).
  - `DIAG-PARTIAL-INVOICE-HANDOVER` (`trc.fa9218ab8cc5b2`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — `RD 790` (`฿2,800`) + `RD 799` (`฿4,200`).
  - `DIAG-PARTIAL-INVOICE-CROSS-PAY` (`trc.908dd5f0e89c4f`, invoiced ฿40k settled AFTER handover on `2025-10-02`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — invoiced ฿40k stays at `2025-09-25` under `RD 790` (`฿2,800`, not double-taxed or shifted to `RD 799`); uninvoiced ฿60k on `2025-10-05` uses `RD 799` (`฿4,200`).
  - `CTRL-FULL-INVOICE-790` (`trc.2d7b6faa580259`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — full ฿100k invoice on `2025-09-25` fixes whole transaction under `RD 790` (`฿7,000`), excluding `RD 799`.
  - `CTRL-SPLIT-PAYMENT-790-799` (`trc.ff839ae2b42553`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — pure split payment assigns `RD 790` (`฿2,800`) + `RD 799` (`฿4,200`).
- **Full 9-Suite Vitest Regression (`52/52` PASS, exit `0`, including Test #9)**: [rc10_3_partial_invoice_vitest.log](rc10_3_partial_invoice_vitest.log)
- **TypeScript (`tsc --noEmit`)**: exit `0`
- **Preview Build Packaging**: `2` simulated Vercel Serverless Functions (`<= 12` Hobby limit), `0` Turbopack warnings.

---

## 12. Remaining Fact-Handling Risks (Unstated Invoice Coverage & Same-Amount Unstated Allocation) + Request-Linked Read-Only Neon Concurrency Audit

> **Evidence Classification**: All Vitest suites, live `gemini-4-neon @ low` scenario runs, and Neon concurrency audits in this section are **Engineering evidence** only and do **not** constitute Independent QA scoring or Batch 1 acceptance sign-off.

- **Frozen Preflight Baseline Preserved**: `cd941d24a62817406b7ef24015c3b457387f92a6` (protected Preview `https://reg24-56jpn4vgr-7-l-advisory.vercel.app`, pushed tag `archive/b01-rc10.3-cd941d2`; prior `d4b3e40` also preserved at `archive/b01-rc10.3-d4b3e40`).
- **Corpus, Manifest & Model Stack Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (`1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`), TypeScript BM25+Graph, `gemini-4-neon @ low`, `0` changes under `data/`.
- **Next.js `16.4.2` Advisory Invariance**: `0` diffs in `package.json`, `package-lock.json`, or `next.config.ts` since `2a1dbc0`; the prior Vercel Preview assessment ([rc10_3_nextjs_security_advisory_assessment.json](rc10_3_nextjs_security_advisory_assessment.json)) remains unchanged pending separate Platform review.

### 12.1 BEFORE Reproduction on Frozen `cd941d2` (Engineering Evidence, No Date Override)

Receipt: [rc10_3_two_fact_risks_before_cd941d2.json](rc10_3_two_fact_risks_before_cd941d2.json) (`applicable_date: null`, live `gemini-4-neon @ low`)

1. **Risk 1A FAILED (`trc.9efa86bac8010c`) — Unstated invoice coverage (`25 Sep 2568`) + ONE later payment (`฿100,000` on `5 Oct 2568`)**:
   - `case-fact-ledger.ts` inferred full coverage from `distinctPaymentDateCount <= 1` (`PRIOR_INVOICE_FIXED_TAX_POINT`), omitting `RD 799` from `PASSAGE_PACK` and causing the live draft to claim no reduction decree existed for `5 Oct 2568` while also suppressing 1 claim (`rejected_claims_count: 1`).
2. **Risk 2 FAILED (`trc.c7f9aaa5e78398`) — Partial `฿50,000` invoice (`25 Sep 2568`) + two equal `฿50,000` payments (`30 Sep 2568`, `5 Oct 2568`) with NO stated allocation**:
   - `case-fact-ledger.ts` inferred `30 Sep 2568` settled the `25 Sep` invoice purely from equal amounts (`50000 === 50000`), dropping `30 Sep` from `split_payment_tax_points` and returning an unconditional `ANSWERED` (`RD 790 + RD 799`) that hid Branch 2 (where `5 Oct` settles the invoice and ONLY `RD 790` governs).
3. **English Extraction Gap**: English Risk 2 phrasing (`"issues a partial tax invoice ... receives two equal payments of THB 50,000 ... and THB 50,000"`) failed event extraction.

### 12.2 Generalized Shared-Logic Fix

1. **Explicit Coverage & Allocation State Machine (`src/core/knowledge/case-fact-ledger.ts`)**:
   - **Risk 1**: Removed invoice-count / single-payment full-coverage inference; classifies `priorInvoiceCoverageStatus: "FULL" | "PARTIAL" | "UNSTATED"`. When `UNSTATED` and all dates fall inside the same verified decree window (e.g., `20 Sep` & `25 Sep 2568`, both `RD 790`), routes to `PRIOR_INVOICE_SAME_WINDOW_SUFFICIENT` and answers without declining. When `UNSTATED` and dates cross a decree handover/cutoff/expiry (e.g., `25 Sep` vs `5 Oct 2568`), routes to `UNSTATED_INVOICE_COVERAGE_CONDITIONAL`, supplies all relevant decrees (`RD 790 + RD 799`), names the missing invoice-coverage fact, and lays out both conditional branches.
   - **Risk 2**: Removed equal-amount-alone settlement inference; excludes a settlement payment only when allocation is not unstated and either explicitly marked as settling the prior invoice or uniquely matched against distinct remaining-balance markers. Otherwise routes to `PARTIAL_INVOICE_UNSTATED_ALLOCATION_CONDITIONAL`, retaining all dates (`2025-09-25`, `2025-09-30`, `2025-10-05`), naming the missing allocation fact, and laying out both conditional branches on the full ฿100,000 tax base without double-taxing or dropping any portion.
   - Added Thai and English event extraction for partial/full/initial invoices and equal/continuation payments (`and THB X on DATE`).
2. **Conditional-Branch Grounding, Verifier & Timeout Hardening (`src/core/knowledge/grounded-llm-drafter.ts`, `src/core/knowledge/grounded-llm-verifier.ts`, `src/core/knowledge/answer-verification.ts`, `src/core/knowledge/claim-traceability-engine.ts`)**:
   - Updated system instruction for `CONDITIONAL` unstated-coverage / unstated-allocation branches and raised Gemini 4 synchronous client timeout from `120s` to `180s` (within route `maxDuration = 300s`, preserving strict no-silent-fallback).
   - Fixed multi-date conditional-branch target resolution and explicit-exclusion context detection (`ไม่ต้องนำ`, `ไม่นำ`, `ไม่มีความรับผิดเกิดขึ้นภายใต้`, multi-date `excluded_tax_point_dates`), deterministically grounded exact VAT-exclusive (`7% / 6.3% / 0.7%`) and VAT-inclusive (`7/107, 100/107`) figures derived strictly from user-stated monetary bases when an in-window VAT reduction decree is validly cited (`calcCheck.accepted`), guarded Thai compound date nouns (`วันเกิดความรับผิด`) and referential counts (`ทั้งสองวัน`) from being misparsed as statutory day deadlines, and stopped Revenue Code §80's `เว้นแต่กรณีที่กำหนดไว้ในมาตรา 80/2` exception capture before enumerated main-rule items `(1) การขายสินค้า (2) การให้บริการ`.
3. **Hardened Request-Linked Read-Only Neon Concurrency Audit (`scripts/audit-rc10-3-qa-two-session-readonly.ts`, schema `v2`)**:
   - Upgraded the `SELECT`-only Neon audit script to require positive identification of the starting revision row, winning revision row, same owner, zero orphans, and zero revision/claim/citation-link/successful-write-audit rows attributable to the rejected edit (`non_empty_match_guard_passed`, exiting non-zero `2` on empty or failed matches; verified via negative control `--answer-id ans.nonexistent.negative_control`).

### 12.3 AFTER Live `gemini-4-neon @ low`, Regression & Concurrency Receipts (Engineering Evidence)

- **Live 6-Scenario `gemini-4-neon @ low` Verification Receipt (`applicable_date: null`, `6/6` PASS, `0` rejected claims, `0` fallbacks)**: [rc10_3_two_fact_risks_after_verification.json](rc10_3_two_fact_risks_after_verification.json)
  - `RISK1-UNSTATED-COVERAGE-ONE-PAYMENT-CROSS-HANDOVER` (`trc.88c4d826e57f7f`): `CONDITIONAL`, `3/3 VERIFIED`, `rejected=0` — names missing invoice coverage in `clarification_questions`, cites `RD 790 + RD 799`, presents Branch 1 (full invoice `25 Sep` → `RD 790`, `฿7,000`, `RD 799` excluded) and Branch 2 (partial invoice `25 Sep` → `RD 790`, remaining balance `5 Oct` → `RD 799`).
  - `RISK1B-UNSTATED-COVERAGE-SAME-WINDOW-SUFFICIENT` (`trc.bf4146421f3bf5`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — answers `7.0% = ฿7,000` under `RD 790` without unnecessarily declining.
  - `RISK2-EQUAL-AMOUNT-PAYMENTS-NO-ALLOCATION` (`trc.277da4a8fd10df`): `CONDITIONAL`, `2/2 VERIFIED`, `rejected=0` — names missing payment allocation between the two equal `฿50,000` payments (`30 Sep` vs `5 Oct`) in `clarification_questions`, fixes invoiced `฿50,000` on `25 Sep` (`RD 790`, `฿3,500`, no double tax), and presents both conditional branches (`30 Sep` settles → remaining `฿50,000` on `5 Oct` under `RD 799`; `5 Oct` settles → remaining `฿50,000` on `30 Sep` under `RD 790`, `RD 799` excluded; total base `฿100,000` / `฿7,000` VAT in both).
  - `CTRL-FULL-INVOICE-790` (`trc.f3237aca58da72`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — full `฿100,000` invoice fixed under `RD 790` (`฿7,000`).
  - `CTRL-PARTIAL-INVOICE-STATED-ALLOCATION` (`trc.96731e07978c3b`, retried transparently after transient upstream timeout `trc.2c0fffd089aac6`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — `RD 790` (`฿2,800`) + `RD 799` (`฿4,200`).
  - `CTRL-SPLIT-PAYMENT-790-799` (`trc.254103d1a7357a`): `ANSWERED`, `2/2 VERIFIED`, `rejected=0` — `RD 790` (`฿2,800`) + `RD 799` (`฿4,200`).
- **Request-Linked Read-Only Neon Two-Session Concurrency Receipt (`all_assertions_passed: true`)**: [rc10_3_two_session_readonly_neon_request_linked_receipt.json](rc10_3_two_session_readonly_neon_request_linked_receipt.json) — positively identifies starting row `r1` (`op.init.1795233207190`), winning revision `r2` (`op.editB.1795233207190`, `audit_id: caud.pg.cfc018d05709de`, `link_id: cel.e1aa04ccecd975ce`) for `ans.rc103.live_distinct_race.1795233207190` under same owner `qa.reviewer@reg24.th` / tenant `PUBLIC`, and `0` answer/claim/citation-link/write-audit rows for rejected edit `op.editA.1795233207190`.
- **Full 9-Suite Vitest Regression (`53/53` PASS, exit `0`, including Thai + English Test #10)**: [rc10_3_two_fact_risks_vitest.log](rc10_3_two_fact_risks_vitest.log)
- **TypeScript (`tsc --noEmit`)**: exit `0`
- **Preview Build Packaging**: `2` simulated Vercel Serverless Functions (`<= 12` Hobby limit), `0` Turbopack warnings.

---

## 13. Hosted Preflight Material Save-Downgrade Defect on `4457d9b` (`trc.a1af76c79ef931`) & Shared Persistence Fix

> **Evidence Classification**: Hosted preflight reproduction (`trc.a1af76c79ef931`) and the 54/54 Vitest regression suite below are **Engineering / Preflight evidence** only. Fresh hosted preflight on the new immutable pin is required before Formal Test 1 dispatch.

- **Preserved Preflight-Failed Baseline**: `4457d9b968f288f50ade48d578a7b6cabeb98fd6` (Vercel deployment `dpl_6WdikFydSPnRoSz3C8AJ5iYau4xf`, URL `https://reg24-clv1vo0iz-7-l-advisory.vercel.app/legal-review`, pushed tag `archive/b01-rc10.3-4457d9b`).
- **Corpus, Manifest & Model Stack Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (`1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`), TypeScript BM25+Graph, `gemini-4-neon @ low`, `0` changes under `data/`, `package.json`, `package-lock.json`, or `next.config.ts`.

### 13.1 Material Failure Reproduced During Live Hosted Preflight on `4457d9b`

- **Live Environment & Tokenizer Check (`PASS`)**: `GET /api/v1/knowledge/environment?probe_tokenizer=1` returned HTTP `200`, `git_commit_sha: "4457d9b968f288f50ade48d578a7b6cabeb98fd6"`, `release_id: "rel.B01.rc8"`, `manifest_id: "mfst.b01.rc8_thai_legal_index"`, `manifest_hash: "1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3"`, `all_probes_ok: true`, `contract_parity_ok: true`, `icu_version: "78.3"`, `node_version: "v24.22.3"`, `shared_neon_postgres_connected: true`.
- **Blank-Date Fictional Thai VAT UI Query (`PASS`)**: `trace_id: trc.a1af76c79ef931` (`google-gemini:gemini-4-neon @ low`, `silent_fallback_disabled: true`, `failure_classification: "NONE"`, `32.5s` provider latency / `~58s` total) produced `r1` (`ans.trc.a1af76c79ef931.r1`, `status: "complete"`, `2` claims, `0` rejected, `7` citations including `RD 799` `7.0% = ฿7,000`, `GET .../r1?require_db=1` → HTTP `200`, `persistence_source: "neon_postgres"`).
- **Official Citation Inspection (`PASS`)**: `GET /api/v1/knowledge/evidence/psg.rc8.rd799.sec_3_quoted_rd646_sec_4` → HTTP `200`, `ver.th.rc.royal_decree.799.v3`, `PDF หน้า 2 · หน้าพิมพ์ หน้า ๒`, `https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf#page=2`.
- **UI Save & `?require_db=1` Reopen Match (`FAIL — MATERIAL PERSISTENCE DEFECT`)**:
  - Clicking **"บันทึกคำตอบตามรุ่น" (Save)** called `POST /api/v1/knowledge/answers` without `save_operation_key`, without reviewer actor headers, and without `query_persistence_context`, allocating a redundant `ans.trc.a1af76c79ef931.r2`.
  - Server re-verification in `saveOrReviseAnswerServerVerified` dropped `r1`'s server-verified `bound_calculation` and derived `0.7%` local-tax rate (`1/9` of `6.3%`), falsely withholding Claim 2 (`withheld_claim_ids: ["clm.ans.trc.a1af76c79ef931.r2.2"]`, `"ตัวเลขอัตราภาษี กำหนดเวลา หรือจำนวน (0.7 %) ในข้อสรุปไม่ตรงกับหลักฐานที่แนบ"`) and downgrading the saved answer from `complete` (`2` claims, `7` citations) to `partial` (`1` claim, `2` citations).

### 13.2 Generalized Shared Behavior Fix

1. **Server Save Path (`src/core/knowledge/claim-traceability-engine.ts`)**:
   - Loads the authoritative server-committed predecessor revision (`Neon` or local durable store) in `saveOrReviseAnswerServerVerified`.
   - **Idempotent Unmodified Re-Save**: When re-saving an unmodified already-committed revision (`sub.answer_revision === authoritativeSupersedes`, identical `canonicalSavePayloadSha256`, no explicit edit `revision_reason`), returns the exact committed revision (`__idempotent_replay = true`) instead of bumping `r1 → r2`.
   - **Strict Per-Claim Predecessor Calculation Inheritance & Canonical VAT Local-Tax Grounding**: On intentional `r2+` revisions without `query_persistence_context`, inherits a predecessor claim's server-verified `bound_calculation` **only** when both exact claim text and cited `evidence_id` set match (never trusting client-supplied numbers or pooling across sibling claims), and deterministically permits `6.3% / 0.7% / 7% / 7.0%` + exact VAT-exclusive/VAT-inclusive arithmetic derived strictly from `question_text` **only** when the claim validly cites both a canonical VAT reduction Royal Decree (`RD 780/790/799/807`) and `subreg.th.rd.vat_local_tax_guide`. Tampered/ungrounded amounts remain strictly blocked.
2. **UI Save & Reopen Consistency (`src/components/OfficialCitationTraceabilityPanel.tsx`, `src/app/legal-review/page.tsx`)**:
   - Forwards reviewer `requestHeaders` (`buildHeaders()`) on Save and Reopen so Save runs under the same REG24 actor identity as Query.
   - Sends deterministic `save_operation_key: op.ui_save.<answer_id>.<answer_revision>` on UI Save and appends `?require_db=1` on Reopen whenever Neon PostgreSQL is connected.

### 13.3 Regression Verification Receipts (Engineering Evidence)

- **Full 9-Suite Vitest Regression (`54/54` PASS, exit `0`, including Test #11 reproducing `trc.a1af76c79ef931` + tampered-number negative control)**: [rc10_3_preflight_save_fix_vitest.log](rc10_3_preflight_save_fix_vitest.log)
- **TypeScript (`tsc --noEmit`)**: exit `0`
- **Preview Build Packaging**: `2` simulated Vercel Serverless Functions (`<= 12` Hobby limit), `0` Turbopack warnings.

---

## 14. Focused Controls Remediation (`bd35a46` Trace `trc.20bde13a5b05ab`) — VAT-Inclusive Gross Total & Per-Claim Base Scoping

> **Evidence Classification**: All Vitest, build, and local control verifications below are **Engineering evidence** only. Fresh affected hosted preflight on the new immutable pin is required before marking Ready for Independent QA.

- **Preserved Prior Baseline**: `bd35a46a196c639507bf9b3041a7df49e427eab0` (Vercel deployment `dpl_BT726Sm9HLRvJPjNzvsave7wxZYN`, URL `https://reg24-b2b0x1hqo-7-l-advisory.vercel.app/legal-review`, pushed tag `archive/b01-rc10.3-bd35a46`; baseline 4/4 preflight receipt `trc.9a58694e0348ca` preserved).
- **Corpus, Manifest & Model Stack Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (`1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`), TypeScript BM25+Graph, `gemini-4-neon @ low`, `0` changes under `data/`, `package.json`, `package-lock.json`, or `next.config.ts`.

### 14.1 Material Control Failures Reproduced on Frozen `bd35a46`

1. **Control A — Correct Total (`107,000 บาท` VAT-inclusive total) FAILED LIVE (`trc.20bde13a5b05ab`)**:
   - On `https://reg24-b2b0x1hqo-7-l-advisory.vercel.app/legal-review`, asking for rate (`7.0%`), VAT amount (`7,000`), and VAT-inclusive total (`107,000`) on a `100,000` baht domestic service suppressed the calculation claim (`UNGROUNDED_NUMERIC_ASSERTION: 107000 บาท`) before publication, leaving only Claim 1 (`7.0%`) with neither `7,000` nor `107,000`.
2. **Control B — Wrong Base (`4,200` from wrong `60,000` installment applied to `40,000` installment) FAILED**:
   - Gate 5 in `grounded-llm-verifier.ts` and `saveOrReviseAnswerServerVerified` in `claim-traceability-engine.ts` pooled derived VAT tokens across all monetary amounts in the prompt (`40,000`, `60,000`, `100,000`) instead of scoping strictly to each claim's own valid taxable base, allowing `4,200 บาท` to pass on the `40,000 บาท` installment.

### 14.2 Generalized Shared Logic Fix

1. **Per-Claim Base Scoping, Installment/Superseded-Base Guards & Gross-Total Grounding (`src/core/knowledge/grounded-llm-verifier.ts`)**:
   - Added `grossTotalThb = tax_base_thb + computed_tax_thb` (`107,000`) to `verifyProposedCalculation` verified tokens and `1.07` to Gate 5 VAT-inclusive total grounding.
   - Added single-portion installment base validation (`tax_base_thb === sp.amount_thb`) and cross-turn superseded monetary base detection (`detectSupersededMonetaryBase`, requiring `source_turn > previous_turn` or explicit multi-turn edit cue) so stale Turn 1 bases (e.g., `100,000` after editing to `200,000`) and wrong-installment calculations are deterministically rejected without dropping supported sibling claims.
   - Replaced blanket whole-prompt monetary pooling in Gate 5 with strict per-claim base scoping (`verifiedCalc.tax_base_thb`, single-portion `sp.amount_thb`, or intersection of claim-mentioned bases with active non-superseded user bases).
2. **Per-Claim Scoped Re-Verification on Save (`src/core/knowledge/claim-traceability-engine.ts`)**:
   - Scoped `saveOrReviseAnswerServerVerified` VAT-decree + local-tax derived tokens strictly to monetary bases present in **both** the specific claim text and `question_text` (including `1.07` VAT-inclusive total) while preserving zero numeric inheritance from `r1` on genuinely edited `r2` claims.

### 14.3 Regression Verification Receipts (Engineering Evidence)

- **Full 9-Suite Vitest Regression (`55/55` PASS, exit `0`, including Test #12 covering Controls A, B1, B2, and C)**: [rc10_3_focused_controls_vitest.log](rc10_3_focused_controls_vitest.log)
- **TypeScript (`tsc --noEmit`)**: exit `0`
- **Preview Build Packaging**: `2` simulated Vercel Serverless Functions (`<= 12` Hobby limit), `0` Turbopack warnings.

---

## 15. Formal Test 1 Readiness Remediation (`fe9d9fa` Hosted Findings) — Server-Verified Reviewer Isolation, UI Double-Submit Guard & Changed-Fact Calculation Consistency

> **Evidence Classification**: All Vitest, build, and preflight verifications below are **Engineering evidence** only and remain strictly separate from Independent QA's blank scorecard.

- **Preserved Prior Baseline**: `fe9d9fa597642617dc89e63c3d858304d136498b` (Vercel deployment `dpl_8EmJkR6soAZAttDLQnVTck9H93qY`, URL `https://reg24-8xn40eog6-7-l-advisory.vercel.app/legal-review`, archived tag `archive/b01-rc10.3-fe9d9fa`).
- **Corpus, Manifest & Model Stack Unchanged**: `rel.B01.rc8` / `mfst.b01.rc8_thai_legal_index` (`1366d1dcd562b431a6a00e2a9d8ea30670bfc66e0e4331b25c6424687acf42e3`), TypeScript BM25+Graph, `gemini-4-neon @ low`, `0` changes under `data/`, `package.json`, `package-lock.json`, or `next.config.ts`.

### 15.1 Blockers Surfaced During `fe9d9fa` Hosted Verification

1. **Staging Reviewer Identity & Cross-Tester Read/Write Isolation**:
   - On `fe9d9fa`, `REG24_TRIAL_INVITE_ONLY` was disabled on Vercel Preview (`invite_only_trial_gate_enabled: false`), causing Generate/Save/Reopen to persist under an anonymous default identity (`trial.anonymous@reg24.th` / `PUBLIC`).
   - Additionally, `resolveRequestActor` previously assigned `tenant_id: "PUBLIC"` even for server-verified `trial.user.*` actors, and `loadSavedAnswerFromPostgres` allowed reading any `owner_tenant_id = "PUBLIC"` answer, which would have allowed Tester B to read or list Tester A's saved answers even with `REG24_TRIAL_INVITE_ONLY=1` enabled.
   - `OfficialCitationTraceabilityPanel` did not forward `requestHeaders` (`x-reg24-trial-invite`) on evidence drawer inspection or export calls, and `/legal-review` did not retain the reviewer credential in tab-scoped `sessionStorage` across `?rev=` reloads.
2. **Hosted Changed-Fact Follow-Up (Control C) & Duplicate Single-Submit `409`**:
   - On `fe9d9fa`, Control A passed live (`trc.d88900bd2a5c7d` / `ans.trc.d88900bd2a5c7d.r1`: `7.0%`, `7,000`, `107,000` survived Generate, Save `idempotent_replay: true`, and `?require_db=1` Neon Reopen).
   - However, the hosted changed-fact follow-up (`100,000 -> 200,000`) dropped the recalculated claim on `r2` when the model mixed prior-turn figures/multipliers into the recalculated claim, and a duplicate follow-up POST fired on single submit returning a misleading HTTP `409` (`STALE_PRIOR_CONVERSATION_REVISION_409`).

### 15.2 Generalized Shared Fixes

1. **Server-Verified Reviewer Actor/Tenant Isolation (`src/core/knowledge/http-auth.ts`, `src/core/knowledge/citation-postgres-store.ts`, `src/core/knowledge/claim-traceability-engine.ts`, `src/app/api/v1/knowledge/answers/route.ts`, `src/app/api/v1/knowledge/answers/[id]/route.ts`)**:
   - Derives both `actor_id: "trial.user.<sha256_14>@reg24.th"` and per-reviewer `tenant_id: "tenant.trial.<sha256_14>"` strictly on the server from the verified invite credential (`x-reg24-trial-invite` / `Authorization: Bearer`), ignoring any client-supplied `x-reg24-actor-id` whenever `REG24_TRIAL_INVITE_ONLY=1`.
   - Enforces strict owner-scoped read (`404`), list (`0` leaked rows), and write (`403 ANSWER_OWNERSHIP_FORBIDDEN_403` before validation in both Neon PostgreSQL and local modes) across `trial.user.*` reviewers, and returns non-secret `resolved_actor_id` / `resolved_tenant_id` on Save and Reopen responses.
2. **UI Single-Submit Mutex & Authenticated Evidence/Reload Continuity (`src/app/legal-review/page.tsx`, `src/components/OfficialCitationTraceabilityPanel.tsx`)**:
   - Added a synchronous `queryInFlightRef` guard in `runQuery` to prevent duplicate concurrent POSTs from a single UI submit without weakening server-side concurrent-edit `409` protection.
   - Forwarded `requestHeaders` (`x-reg24-trial-invite`) to Evidence Drawer (`inspectPinnedPassage`) and Export (`handleExport`), and stored the staging reviewer credential in tab-scoped `sessionStorage` (`reg24_staging_reviewer_invite`) so reloading `/legal-review?rev=...` preserves server-verified identity.
3. **Multi-Turn Base-Update Prompt Discipline (`src/core/knowledge/grounded-llm-drafter.ts`)**:
   - Added a concise system instruction rule directing the drafter to state only recalculated tax and VAT-inclusive totals from the updated taxable base on multi-turn amount revisions without mixing superseded prior-turn figures or multiplier phrasing into the recalculated claim.

### 15.3 Regression Verification Receipts (Engineering Evidence)

- **Full 9-Suite Vitest Regression (`56/56` PASS, exit `0`, including Test #13 verifying server-verified reviewer identity, spoofed header rejection, and cross-tester read/list/write isolation)**: [rc10_3_auth_isolation_and_ctrlC_vitest.log](rc10_3_auth_isolation_and_ctrlC_vitest.log)
- **TypeScript (`tsc --noEmit`)**: exit `0`
- **Preview Build Packaging**: `2` simulated Vercel Serverless Functions (`<= 12` Hobby limit), `0` Turbopack warnings.





