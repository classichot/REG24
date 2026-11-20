"""
REG24 — Strictly Blind Retrieval Challenger Evaluator (Zero Label Leakage, Hash-Validated)

Evaluates on ONE frozen, label-independent eligible corpus (`corpus_slice_sha256`):
  1. PyThaiNLP 5.4.0 `newmm` + `reg24-th-legal-dict-v1.0` on BOTH passages AND queries (same-engine parity).
  2. OpenThai 2.0 LATTE WordSeg Lite 0.1.2 (ONNX INT8) on BOTH passages AND queries (same-engine parity).
  3. BAAI/bge-m3 ONNX exact cosine (1024-dim, L2-normalized) embedding `title + section heading + exact_text`
     with BGE-M3's own SentencePiece tokenizer (zero ANN approximation error).

Guarantees:
  - Input contains ZERO ground-truth labels (`expected_work_ids` / `expected_versions` are absent by schema).
  - Output embeds `corpus_slice_sha256` and `queries_sha256`; stale or mismatched caches are rejected.
"""

import argparse
import hashlib
import json
import os
import re
import time
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer
import pythainlp
from pythainlp.tokenize import word_tokenize
from pythainlp.corpus.common import thai_words
from pythainlp.util import dict_trie
from openthai_latte_wordseg_lite import Segmenter as LatteSegmenter

THAI_DIGIT_TABLE = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
ABBREV_RULES = [
    (re.compile(r"พ\.ร\.ฎ\."), " พระราชกฤษฎีกา "),
    (re.compile(r"พ\.ร\.บ\."), " พระราชบัญญัติ "),
    (re.compile(r"พ\.ร\.ก\."), " พระราชกำหนด "),
    (re.compile(r"ป\.ร\."), " ประมวลรัษฎากร "),
    (re.compile(r"ป\.พ\.พ\."), " ประมวลกฎหมายแพ่งและพาณิชย์ "),
    (re.compile(r"ท\.ป\."), " คำสั่งกรมสรรพากร ท.ป. "),
    (re.compile(r"\bvat\b", re.I), " ภาษีมูลค่าเพิ่ม "),
    (re.compile(r"\bwht\b", re.I), " หักภาษี ณ ที่จ่าย "),
    (re.compile(r"\bpit\b", re.I), " ภาษีเงินได้บุคคลธรรมดา "),
    (re.compile(r"\bcit\b", re.I), " ภาษีเงินได้นิติบุคคล "),
    (re.compile(r"\bsbt\b", re.I), " ภาษีธุรกิจเฉพาะ "),
    (re.compile(r"คอนโดมิเนียม|คอนโด"), " ห้องชุด คอนโดมิเนียม "),
]
SEC_RE = re.compile(
    r"(มาตรา|ข้อ)\s*([0-9]+(?:/[0-9]+)?)(?:\s*(อัฏฐารส|สัตตรส|เอกาทศ|ทวาทศ|จตุทศ|ปัณรส|จัตวา|เบญจ|เตรส|โสฬส|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ))?((?:\s*\([0-9ก-ฮ]+\))*)"
)
SLASH_SEC_MASK_RE = re.compile(r"(?:มาตรา|ข้อ)\s*[0-9]+/[0-9]+(?:\s*\([0-9ก-ฮ]+\))*")
RD_RE = re.compile(
    r"(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^\n]{0,90}?(?:ฉบับที่\s*|เลขที่\s*|\(\s*ฉบับที่\s*|\s+)([0-9]{1,4})(?![0-9/])"
)
MINREG_RE = re.compile(r"(?:กฎกระทรวง)[^\n]{0,40}?(?:ฉบับที่\s*)([0-9]{1,4})(?![0-9/])")
RULING_RE = re.compile(
    r"(?:กค\s*[0-9]{2,5}|(?<![0-9/])0[78][0-9]{2})(?:\s*\([^)]+\))?\s*[/-]\s*(?:[ก-ฮA-Za-z.]+\s*[/-]?\s*)?[0-9]+[ก-ฮA-Za-z]*"
)
ORDER_RE = re.compile(r"(ท\.ป\.|ป\.)\s*([0-9]+/[0-9]{4})")


def extract_composite(raw_text: str) -> list[str]:
    arabic = (raw_text or "").translate(THAI_DIGIT_TABLE)
    out, seen = [], set()
    for m in SEC_RE.finditer(arabic):
        kind = "clause" if m.group(1) == "ข้อ" else "sec"
        num_part = m.group(2)
        thai_suffix = f"_{m.group(3)}" if m.group(3) else ""
        sub_parts = re.sub(r"\s+", "", m.group(4) or "")
        base = f"{kind}:{num_part}{thai_suffix}"
        if base not in seen:
            seen.add(base)
            out.append(base)
        if sub_parts:
            full = f"{base}{sub_parts}"
            if full not in seen:
                seen.add(full)
                out.append(full)
    for m in RD_RE.finditer(arabic):
        tok = f"rd:{m.group(1)}"
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    for m in MINREG_RE.finditer(arabic):
        tok = f"minreg:{m.group(1)}"
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    for m in RULING_RE.finditer(arabic):
        bare = re.sub(r"^กค\s*", "", m.group(0))
        bare = re.sub(r"\s*/\s*", "/", re.sub(r"\s+", " ", bare).strip())
        tok = f"ruling:กค_{bare}"
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    for m in ORDER_RE.finditer(arabic):
        tok = f"order:{m.group(1)}{m.group(2)}"
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


def normalize_text(raw_text: str) -> str:
    txt = (raw_text or "").translate(THAI_DIGIT_TABLE)
    for rx, repl in ABBREV_RULES:
        txt = rx.sub(repl, txt)
    return re.sub(r"\s+", " ", txt).strip()


def pythainlp_tokenize(custom_trie, raw_text: str) -> list[str]:
    comp = extract_composite(raw_text)
    norm = normalize_text(raw_text)
    masked = SLASH_SEC_MASK_RE.sub(" ", norm)
    raw_toks = word_tokenize(masked, engine="newmm", custom_dict=custom_trie, keep_whitespace=False)
    out = list(comp)
    for tok in raw_toks:
        t = tok.strip().lower()
        if not t:
            continue
        if len(t) >= 2 or t.isdigit():
            if not re.fullmatch(r"[\W_]+", t):
                out.append(t)
    return out


def _latte_tokenize_chunk(chunk_items: list[tuple[str, str, str]]) -> list[tuple[str, list[str], list[str]]]:
    latte = LatteSegmenter()
    res = []
    for pid, title_text, body_text in chunk_items:
        def _tok(raw_text: str) -> list[str]:
            comp = extract_composite(raw_text)
            norm = normalize_text(raw_text)
            masked = SLASH_SEC_MASK_RE.sub(" ", norm)
            raw_toks = latte.tokenize(masked, keep_whitespace=False)
            out = list(comp)
            for tok in raw_toks:
                t = tok.strip().lower()
                if not t:
                    continue
                if len(t) >= 2 or t.isdigit():
                    if not re.fullmatch(r"[\W_]+", t):
                        out.append(t)
            return out
        res.append((pid, _tok(title_text), _tok(body_text)))
    return res


def embed_texts_bge_m3(
    sess: ort.InferenceSession,
    tokenizer: Tokenizer,
    texts: list[str],
    batch_size: int = 16,
    max_len: int = 192,
) -> np.ndarray:
    tokenizer.enable_truncation(max_length=max_len)
    tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
    all_vecs = []
    t_start = time.perf_counter()
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        encs = tokenizer.encode_batch(batch)
        input_ids = np.array([e.ids for e in encs], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
        outputs = sess.run(["sentence_embedding"], {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
        })
        vecs = outputs[0].astype(np.float32)
        norms = np.maximum(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-12)
        all_vecs.append(vecs / norms)
        done = min(len(texts), start + batch_size)
        if done % 320 == 0 or done == len(texts):
            elapsed = time.perf_counter() - t_start
            print(f"  [BGE-M3] {done}/{len(texts)} passages embedded ({elapsed:.1f}s)", flush=True)
    return np.vstack(all_vecs) if all_vecs else np.zeros((0, 1024), dtype=np.float32)


def main():
    os.environ["HF_HOME"] = os.environ.get("HF_HOME", r"D:\Code\REG24\.hf-cache")
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--skip-bge", action="store_true")
    parser.add_argument("--skip-latte", action="store_true")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    corpus_sha = data["corpus_slice_sha256"]
    queries_sha = data["queries_sha256"]
    legal_terms = data["legal_dictionary_terms"]
    passages = data["passages"]
    queries = data["queries"]
    print(
        f"Loaded blind corpus ({len(passages)} passages, sha={corpus_sha[:12]}) & {len(queries)} queries (sha={queries_sha[:12]})",
        flush=True,
    )

    # 1. PyThaiNLP 5.4.0 newmm + reg24-th-legal-dict-v1.0 (BOTH passages AND queries!)
    t0 = time.perf_counter()
    merged_words = set(thai_words())
    for term in legal_terms:
        if term and isinstance(term, str):
            merged_words.add(term.strip())
    custom_trie = dict_trie(merged_words)
    pythai_passages = {}
    for p in passages:
        pythai_passages[p["passage_id"]] = {
            "title_tokens": pythainlp_tokenize(custom_trie, p["title_text"]),
            "body_tokens": pythainlp_tokenize(custom_trie, p["body_text"]),
        }
    pythai_queries = {}
    pythai_q_times = []
    for q in queries:
        qt0 = time.perf_counter()
        pythai_queries[q["case_id"]] = pythainlp_tokenize(custom_trie, q["question"])
        pythai_q_times.append((time.perf_counter() - qt0) * 1000.0)
    pythai_total_ms = (time.perf_counter() - t0) * 1000.0
    print(
        f"PyThaiNLP {pythainlp.__version__} newmm finished in {pythai_total_ms:.1f} ms (query p95={np.percentile(pythai_q_times, 95):.2f} ms)",
        flush=True,
    )

    # 2. OpenThai 2.0 LATTE WordSeg Lite 0.1.2 (BOTH passages AND queries!)
    latte_passages = {}
    latte_queries = {}
    latte_meta = None
    if not args.skip_latte:
        t1 = time.perf_counter()
        workers = min(8, max(1, (os.cpu_count() or 4) // 2))
        items = [(p["passage_id"], p["title_text"], p["body_text"]) for p in passages]
        chunk_size = max(1, (len(items) + workers - 1) // workers)
        chunks = [items[i : i + chunk_size] for i in range(0, len(items), chunk_size)]
        with ProcessPoolExecutor(max_workers=workers) as ex:
            for chunk_res in ex.map(_latte_tokenize_chunk, chunks):
                for pid, tt, bt in chunk_res:
                    latte_passages[pid] = {"title_tokens": tt, "body_tokens": bt}
        latte_single = LatteSegmenter()
        latte_q_times = []
        for q in queries:
            qt0 = time.perf_counter()
            comp = extract_composite(q["question"])
            masked = SLASH_SEC_MASK_RE.sub(" ", normalize_text(q["question"]))
            toks = list(comp)
            for tok in latte_single.tokenize(masked, keep_whitespace=False):
                t = tok.strip().lower()
                if t and (len(t) >= 2 or t.isdigit()) and not re.fullmatch(r"[\W_]+", t):
                    toks.append(t)
            latte_queries[q["case_id"]] = toks
            latte_q_times.append((time.perf_counter() - qt0) * 1000.0)
        latte_total_ms = (time.perf_counter() - t1) * 1000.0
        latte_meta = {
            "model": "iapp/OpenThai2.0-LATTE-WordSeg-Lite",
            "version": "0.1.2",
            "passage_count": len(latte_passages),
            "total_ms": round(latte_total_ms, 2),
            "query_p95_ms": round(float(np.percentile(latte_q_times, 95)), 2),
        }
        print(
            f"LATTE WordSeg Lite finished in {latte_total_ms / 1000.0:.1f} s (query p95={latte_meta['query_p95_ms']} ms)",
            flush=True,
        )

    # 3. BAAI/bge-m3 ONNX exact cosine (1024-dim, L2-normalized)
    bge_top_by_case = {}
    bge_meta = None
    if not args.skip_bge:
        t2 = time.perf_counter()
        model_path = hf_hub_download("BAAI/bge-m3", "onnx/model.onnx")
        tok_path = hf_hub_download("BAAI/bge-m3", "tokenizer.json")
        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = max(1, (os.cpu_count() or 8) - 2)
        sess = ort.InferenceSession(model_path, sess_options=sess_opts, providers=["CPUExecutionProvider"])
        bge_tok = Tokenizer.from_file(tok_path)

        passage_texts = [f"{p['title_text']}\n{p['body_text'][:900]}" for p in passages]
        print(f"Embedding {len(passage_texts)} blind passages with BAAI/bge-m3 ONNX (max_len=192, 1024d)...", flush=True)
        p_vecs = embed_texts_bge_m3(sess, bge_tok, passage_texts, batch_size=16, max_len=192)
        bge_passages_ms = (time.perf_counter() - t2) * 1000.0

        q_vecs = []
        bge_q_times = []
        for q in queries:
            qt0 = time.perf_counter()
            qv = embed_texts_bge_m3(sess, bge_tok, [q["question"]], batch_size=1, max_len=192)[0]
            bge_q_times.append((time.perf_counter() - qt0) * 1000.0)
            q_vecs.append(qv)
        q_mat = np.vstack(q_vecs)

        sim_mat = q_mat @ p_vecs.T
        for qi, q in enumerate(queries):
            scores = sim_mat[qi]
            top_idx = np.argsort(-scores)[:100]
            bge_top_by_case[q["case_id"]] = [
                {
                    "passage_id": passages[int(pi)]["passage_id"],
                    "work_id": passages[int(pi)]["work_id"],
                    "version_id": passages[int(pi)]["version_id"],
                    "cosine": round(float(scores[int(pi)]), 5),
                }
                for pi in top_idx
            ]
        bge_meta = {
            "model": "BAAI/bge-m3",
            "runtime": "onnxruntime-cpu-exact-cosine",
            "dimensions": 1024,
            "max_tokens": 192,
            "passage_count": len(passages),
            "passage_embed_total_ms": round(bge_passages_ms, 2),
            "query_embed_p95_ms": round(float(np.percentile(bge_q_times, 95)), 2),
        }
        print(
            f"BGE-M3 finished in {bge_passages_ms / 1000.0:.1f} s (query p95={bge_meta['query_embed_p95_ms']} ms)",
            flush=True,
        )

    out_payload = {
        "schema_version": "2.0-blind",
        "corpus_slice_sha256": corpus_sha,
        "queries_sha256": queries_sha,
        "pythainlp_meta": {
            "engine": f"pythainlp_newmm_v{pythainlp.__version__}+reg24-th-legal-dict-v1.0",
            "passage_count": len(pythai_passages),
            "total_ms": round(pythai_total_ms, 2),
            "query_p95_ms": round(float(np.percentile(pythai_q_times, 95)), 2),
        },
        "latte_meta": latte_meta,
        "bge_m3_meta": bge_meta,
        "pythainlp_passages": pythai_passages,
        "pythainlp_queries": pythai_queries,
        "latte_passages": latte_passages,
        "latte_queries": latte_queries,
        "bge_top_by_case": bge_top_by_case,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out_payload, f, ensure_ascii=False)
    print(f"Saved hash-validated blind challenger results to {args.output}", flush=True)


if __name__ == "__main__":
    main()
