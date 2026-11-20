# REG24 Batch 1 (`rel.B01.rc7`) — Single-Engine Tokenizer Parity, Strictly Blind Retrieval Comparison & NitiBench Miss Diagnosis

> **Governance Notice**: Earlier commit `6e4fde1` handoff numbers are marked **`PROVISIONAL`** (scoped regression diagnostic only). This report provides corrected, repo-committed, portable receipts with **zero Windows-only paths**, **zero mixed-engine tokenization**, and **zero label leakage into challenger pools**. No Batch 1 sign-off or final tokenizer/embedding model decision is claimed here.

---

## 1. Separate Gate Decisions

| Gate | Decision | Basis & Remaining Requirement |
|---|---|---|
| **1. Legal Provenance (`790` / `799` / `807`)** | **`PASS` *(Ready for Legal Sign-Off)*** | Accessible repo receipts committed at [`LEGAL_PROVENANCE_RD_790_799_807.md`](./LEGAL_PROVENANCE_RD_790_799_807.md) and [`verified_royal_decrees.json`](./verified_royal_decrees.json); original Gazette PDFs archived in-repo with verified SHA-256 checksums, separate enactment/publication/commencement/covered-transaction dates, and strict endpoint tests (`valid_to: "2027-09-30"` fixed on RD 807). |
| **2. Tokenizer Parity (Index == Live Query)** | **`BLOCKED` *(Local `PASS`; Awaiting Linux Preview Probe)*** | Mixed-engine Python/Node build eliminated. `rel.B01.rc6` and `rel.B01.rc7` rebuilt using ONE pinned TypeScript contract (`ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0`) identically on index & query sides, with hard runtime rejection of mismatched engines (`TOKENIZER_ENGINE_MISMATCH`) and zero silent per-passage fallback. Local probe passes `4/4` categories (`win32`, Node `v24.17.0`, ICU `78.3`); **blocked only on running `GET /api/v1/knowledge/environment?probe_tokenizer=1` on the exact Vercel Linux Preview deployment** once pushed. |
| **3. Blind Retrieval Comparison** | **`PASS` *(Evidence Delivered; No Final Model Lock)*** | Re-run strictly blind with **zero `expected_work_ids` and zero queries in corpus selection**, hash-validated caches, same-engine tokenization within every arm, full `11,786`-passage arms + frozen `1,924`-passage 6-arm comparison, per-case answer-packet trace, and 4-stage `NitiBench-Tax` miss diagnosis. Legacy char-hash vectors remain OFF (`deliberately_disabled`) and `BAAI/bge-m3` stays OFF the default path. |
| **4. Hosted Protected Smoke Test** | **`BLOCKED`** | Local environment has no Vercel CLI session and no immutable `?_vercel_share=...` URL yet for this new pinned commit on `feat/b01-thai-legal-index-retrieval-rc10`. Smoke harness [`scripts/run-hosted-rc10-smoke.ts`](../../scripts/run-hosted-rc10-smoke.ts) is ready to run immediately once the preview share URL is provided. |

---

## 2. Single-Engine Tokenizer Parity Evidence (Local Build; Linux Preview Pending)

Both `scripts/build-rc7-candidate-overlay.ts` (index builder) and `src/core/knowledge/retrieval.ts` (live fielded BM25 query) now call the exact same pinned contract in [`src/core/knowledge/thai-legal-dictionary-v1.ts`](../../src/core/knowledge/thai-legal-dictionary-v1.ts). Mixed-engine snapshots are rejected at load time by [`isLexicalSnapshotCompatibleWithRuntime`](../../src/core/knowledge/projections.ts).

### Recorded Hashes (`rel.B01.rc7` / `mfst.b01.rc7_thai_legal_index`)
- **Tokenizer Engine (Index & Live Query)**: `ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0`
- **Tokenizer Contract SHA-256**: `6d5783be8b8a39a34b55b383e7735b916d9912a01e831165b45a50abb4a2b5a1`
- **Legal Dictionary Version / SHA-256**: `reg24-th-legal-dict-v1.0` · `4af2531db0861dbe64abbbef502b71d9292282f661094a38afec5f80768540f8`
- **Manifest Hash (`rel.B01.rc7`)**: `e01101062bd07c4dee79f44f39940024ad2f16c2bf9557d609aae23837119781`
- **Lexical Index Content SHA-256**: `9cd653449bc3e9e73a1d0bacfcdd200fa2d0ee66441e33f5e842fbb7ca9d1880`
- **Lexical Disk Snapshot SHA-256 (`rel.B01.rc7_lexical.json.gz`)**: `db28458fdd615b59a59172cb27bf8f2c9f16e06c103dee7489184b900aa34f65`
- **Local Runtime Verified**: `win32` / `x64` / Node `v24.17.0` / ICU `78.3` (full receipt: [`tokenizer_parity_probe_local.json`](./tokenizer_parity_probe_local.json))

### Live Posting-Hit Verification Across All 4 Probe Categories (`rel.B01.rc7_lexical.json.gz`)

| Category | Input Text | Index == Live Query Tokens | Verified Posting Hits (`exact_ids / title / phrases_roles / body`) |
|---|---|---|---|
| **Unspaced Thai** | `ภาษีมูลค่าเพิ่มกรณีการให้บริการในราชอาณาจักรและส่งออกสินค้า` | `true` (`ภาษีมูลค่าเพิ่ม`, `กรณี`, `การให้บริการ`, `ในราชอาณาจักร`, `และ`, `ส่งออกสินค้า`) | `ภาษีมูลค่าเพิ่ม` (`0/4170/0/4102`), `การให้บริการ` (`0/465/0/1651`), `ในราชอาณาจักร` (`0/64/0/543`), `ส่งออกสินค้า` (`0/18/0/73`) |
| **Legal Citations** | `มาตรา ๘๐/๑ (๒) แห่งประมวลรัษฎากร พ.ร.ฎ. (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗ กค 0702/5958` | `true` (`sec:80/1`, `sec:80/1(2)`, `rd:790`, `ruling:กค_0702/5958`, `ประมวลรัษฎากร`, ...; **`sec:80` & `80` strictly absent**) | `sec:80/1(2)` (`24/24/118/118`), `sec:80/1` (`95/95/336/336`), `rd:790` (`5/3/3/3`), `ruling:กค_0702/5958` (`2/2/0/0` — caught & fixed bare-ruling prefix normalization!), `ประมวลรัษฎากร` (`0/1703/0/7274`) |
| **Negation** | `มิให้ถือว่าเป็นการขายสินค้า เว้นแต่โอนโดยเสน่หาไม่มีค่าตอบแทน` | `true` (`มิให้`, `ถือว่า`, `เป็น`, `การขายสินค้า`, `เว้นแต่`, `โอน`, `โดยเสน่หา`, `ไม่มีค่าตอบแทน`) | `มิให้` (`0/0/242/167`), `เว้นแต่` (`0/4/446/444`), `โดยเสน่หา` (`0/2/70/70`), `ไม่มีค่าตอบแทน` (`0/26/152/145`) |
| **Compound Terms** | `ภาษีเงินได้บุคคลธรรมดา หักภาษี ณ ที่จ่าย โอนกรรมสิทธิ์ ห้องชุด อสังหาริมทรัพย์ ใบกำกับภาษี` | `true` (all 6 compounds intact) | `ภาษีเงินได้บุคคลธรรมดา` (`0/2007/0/1308`), `หักภาษี ณ ที่จ่าย` (`0/216/0/1173`), `โอนกรรมสิทธิ์` (`0/76/0/434`), `ห้องชุด` (`0/28/0/111`), `อสังหาริมทรัพย์` (`0/478/0/962`), `ใบกำกับภาษี` (`0/304/0/1185`) |

> **Linux Preview Check**: Run `GET /api/v1/knowledge/environment?probe_tokenizer=1` on the exact Vercel Preview deployment (automated in `scripts/run-hosted-rc10-smoke.ts`) to confirm identical tokens, posting hits, and `runtime_platform: "linux"` before closing Gate 2.

---

## 3. Strictly Blind Retrieval Comparison (Zero Label Leakage)

Executed via [`scripts/run-blind-retrieval-benchmark.ts`](../../scripts/run-blind-retrieval-benchmark.ts) + [`scripts/eval-blind-challengers.py`](../../scripts/eval-blind-challengers.py). Full machine-readable per-case receipt: [`blind_retrieval_ablation_receipt.json`](./blind_retrieval_ablation_receipt.json).

### Anti-Leakage Controls
- **Frozen, Label-Independent, Query-Independent Corpus (`FROZEN_BLIND_CORPUS_V1`)**: Defined purely by corpus metadata (`work.type IN {Statute, ProvisionVersion, SubordinateLegislation} OR (work.type == TaxRuling AND decision_date >= 2024-01-01)`) = **`1,924` passages** (`corpus_slice_sha256: 9caaa192765b...`, `queries_sha256: d19be8f11725...`). Zero `expected_work_ids` or query strings touch corpus construction; expected IDs exist **only inside `scoreBlindResult()`**.
- **Same-Engine Parity Within Every Arm**: Every arm builds its index AND tokenizes its queries with the same tokenizer.
- **Full-Corpus Verification (`11,786` passages, `05e55ecde507...`)**: Also runs `TS`, `PyThaiNLP`, and `TS + Verified Graph` across 100% of `rel.B01.rc7` with zero subsampling.

### A. Sealed Gate Cases (`20/21` in Frozen `1,924p` Corpus; `G-EXACT-RULING-5958` is a 2015 TaxRuling scored on Full `11,786p`)

#### On Frozen Label-Independent Corpus (`1,924` passages — ALL 6 Arms on Exact Same Eligible Corpus & Filters)
| Arm | All-Required-Hit@5 | Any-Hit@5 | Wrong-Version | False Matches | Measured p95 *(sealed / warm NitiBench)* |
|---|---|---|---|---|---|
| **F1: `TS` Consistent (`ts_legal_dict_intl_v1.0`)** | **`20/20 (100.0%)`** | `20/20 (100.0%)` | `0` | `0` | `2,130 ms` *(warm: `14.1 ms`)* |
| **F2: `PyThaiNLP 5.4.0 newmm` Consistent** | **`20/20 (100.0%)`** | `20/20 (100.0%)` | `0` | `0` | `2,090 ms` *(warm: `20.3 ms`)* |
| **F3: `OpenThai 2.0 LATTE WordSeg Lite` Consistent** | `19/20 (95.0%)` | `20/20 (100.0%)` | `0` | `0` | `1,985 ms` *(warm: `57.9 ms`)* |
| **F4: `TS + BAAI/bge-m3` ONNX Exact Cosine (1024d)** | `17/20 (85.0%)` | `20/20 (100.0%)` | `0` | `0` | `2,298 ms` *(warm: `538.9 ms`; +`524 ms` BGE-M3 embed)* |
| **F5: `TS + Verified Graph Links`** | **`20/20 (100.0%)`** | `20/20 (100.0%)` | `0` | `0` | `1,870 ms` *(warm: `16.0 ms`)* |
| **F6: `TS + BGE-M3 + Verified Graph Links`** | `16/20 (80.0%)` | `20/20 (100.0%)` | `0` | `0` | `2,659 ms` *(warm: `540.7 ms`)* |

*Key blind finding*: Removing label leakage from the BGE-M3 pool exposed that uncalibrated BGE-M3 score fusion drops `All-Required-Hit@5` from `20/20 (100.0%)` to `17/20 (85.0%)` (`16/20` with graph) by pushing `prov.th.rc.54` to Rank 6–7 on the three gift cases (`G-GIFT-T09-CONDO-NEPHEW`, `G-GIFT-CONDO-BROTHER`, `G-PARAPHRASE-EN-GIFT`) while adding `+524 ms` CPU query latency. `LATTE` missed `prov.th.rc.78/1` (Rank 7) on `G-VAT-NO-DATE`. Legacy char-hash vectors remain OFF (`deliberately_disabled`) and `BAAI/bge-m3` stays OFF the default path.

#### On Full `rel.B01.rc7` Corpus (`11,786` passages — Zero Subsampling, All `21/21` Sealed Cases)
| Arm | All-Required-Hit@5 | Any-Hit@5 | Wrong-Version | False Matches | p95 Latency | Final Answer Packet (`buildGroundedPassagePack`) |
|---|---|---|---|---|---|---|
| **FULL `TS` Production Index (`exact_lexical`)** | **`21/21 (100.0%)`** | `21/21 (100.0%)` | `0` | `0` | **`403.9 ms`** *(unloaded run: `181.0 ms`)* | — |
| **FULL `PyThaiNLP 5.4.0` Consistent (in-memory)** | **`21/21 (100.0%)`** | `21/21 (100.0%)` | `0` | `0` | `13,977 ms` *(in-memory unindexed scan)* | — |
| **FULL `TS + Verified Graph` Production Default** | **`21/21 (100.0%)`** | `21/21 (100.0%)` | `0` | `0` | **`323.7 ms`** *(unloaded run: `168.4 ms`)* | **`21/21 (100.0%)` delivered** |

### B. `NitiBench-Tax` Public Supplement (`25/25` Covered in Both Frozen `1,924p` and Full `11,786p`)

| Corpus & Arm | All-Required-Hit@5 | Any-Hit@5 | Wrong-Version | False Matches | p95 Latency |
|---|---|---|---|---|---|
| **Frozen `1,924p` — `F1_TS` / `F2_PYTHAINLP` / `F3_LATTE` / `F4_TS+BGE` / `F6_BOTH`** | `4/25 (16.0%)` | **`15/25 (60.0%)`** | `0` | `0` | `13.6 – 541.8 ms` |
| **Frozen `1,924p` — `F5_TS_PLUS_GRAPH`** | `4/25 (16.0%)` | `14/25 (56.0%)` | `0` | `0` | `16.4 ms` |
| **Full `11,786p` — `FULL_TS_PROD` / `FULL_PYTHAINLP` / `FULL_TS_GRAPH_PROD`** | `4/25 (16.0%)` | **`15/25 (60.0%)`** | `0` | `0` | `168 – 250 ms` *(prod)* |

*(Note: Fixing single-engine tokenizer parity alone lifted `NitiBench-Tax` `Any-Hit@5` from `5/25 (20.0%)` to `15/25 (60.0%)` and `All-Required-Hit@5` from `3/25` to `4/25`.)*

---

## 4. Representative `NitiBench-Tax` Miss Diagnosis (Coverage vs. Eligibility vs. Ranking vs. Packet Assembly)

Across all 6 representative misses traced in [`blind_retrieval_ablation_receipt.json`](./blind_retrieval_ablation_receipt.json), **100% of gold Revenue Code sections (`15/15`) are indexed (`COVERAGE` = OK)**, **100% (`15/15`) pass scope & temporal filters (`ELIGIBILITY` = OK)**, and **every gold section retrieved into Top 5 survived into the final answer packet (`PACKET_ASSEMBLY` = OK)**. **All 6 misses occur at `RANKING`**, caused by two distinct mechanisms (showing why blindly adding a generic statutory slot is NOT the right first fix):

| Case ID | Gold Sections | Coverage / Eligibility / Packet | Full Prod Ranks (`TS+Graph`) | Pure `BGE-M3` Ranks (1,924p) | Actual Full Prod Top 5 | Specific Ranking Failure Mechanism |
|---|---|---|---|---|---|---|
| **`NITI-TAX-01`** | `77/1`, `82/5`, `80/1`, `82/4`, `65`, `82/3` *(6 sections)* | Indexed: 6/6 · Eligible: 6/6 · Retrieved in Packet: `80/1`, `82/3`, `65` | `80/1:3`, `82/3:4`, `65:9`; `77/1, 82/4, 82/5: >24` | `80/1:1`, `82/3:30`, `77/1:43`, `82/4:58` | `80`, `vat_local`, `80/1`, `82/3`, `rd.790` | **Slot arithmetic + VAT rate heuristic**: 6 required sections cannot all fit in `@5`; domestic VAT rate heuristic also placed `80`/`vat_local`/`rd.790` in Top 5. |
| **`NITI-TAX-02`** | `40`, `91/2`, `91/5`, `65` | Indexed: 4/4 · Eligible: 4/4 · Retrieved in Packet: `91/2`, `91/5` | `91/2:1`, `91/5:2`; `40, 65: >24` | `91/2:33`; others `>100` | `91/2`, `91/5`, `91/6`, `sbt_local`, `gk_0706_3393` | **Cross-tax co-issue suppression**: SBT routing nailed `91/2` & `91/5` at Ranks 1–2, while secondary PIT/CIT sections (`40`, `65`) had lower BM25 overlap than SBT provisions and a ruling. |
| **`NITI-TAX-03`** | `69_ทวิ`, `50` | Indexed: 2/2 · Eligible: 2/2 · Packet: 0/2 | `69_ทวิ: >24`, `50: >24` | Both `>100` | `80`, `vat_local`, `77/2`, `rd.790`, `78/1` | **Heuristic misfire (NOT ruling crowding)**: Incidental VAT terms triggered the domestic VAT rate heuristic, filling all 5 slots with VAT statutes (`80`, `77/2`, `78/1`, `rd.790`) ahead of government WHT (`69 ทวิ`, `50`). |
| **`NITI-TAX-04`** | `69_ทวิ` | Indexed: 1/1 · Eligible: 1/1 · Packet: 0/1 | `69_ทวิ: >24` | `69_ทวิ: 50` | `3_เตรส`, `order_tp.4_2528`, 3 WHT rulings | **Narrow WHT heuristic + ruling crowding**: Generic WHT heuristic boosted `§3 เตรส` + `ท.ป. 4/2528` (general private-sector WHT) instead of government-payer WHT (`§69 ทวิ`), and rulings took slots 3–5. |
| **`NITI-TAX-05`** | `77/1` | Indexed: 1/1 · Eligible: 1/1 · Packet: 0/1 | `77/1: >24` | `77/1: 36` | `3_เตรส`, `order_tp.4_2528`, `3_โสฬส`, `amend_48`, 1 ruling | **Heuristic misfire + definitional gap**: One-time brokerage commission narrative triggered WHT heuristics (`3 เตรส`, `ท.ป. 4/2528`) while the VAT definition section (`§77/1`) had low lexical overlap with the narrative. |
| **`NITI-TAX-07`** | `40`, `39`, `50` | Indexed: 3/3 · Eligible: 3/3 · Packet: `50` | `50:3`; `40, 39: >24` | `50:2`, `40:14`, `39:16` | `3_เตรส`, `order_tp.4_2528`, `50`, 2 rulings | **Lexical vocabulary gap on short definitional statutes**: Employee child-education benefit narrative lacks literal terms from concise `§39`/`§40` definitions; notably, pure `BGE-M3` recalled all 3 (`#2`, `#14`, `#16`), showing semantic value specifically for open-ended definitional lookup (candidate for gated reranking later, NOT unconditional fusion). |
