"""
REG24 — Real Local Tokenizer Challenger (OpenThai 2.0 LATTE WordSeg Lite) &
Dense Vector Challenger (BAAI/bge-m3 ONNX Exact Cosine) Evaluator

Runs locally on the Batch 1 evaluation slice exported from `rel.B01.rc7`:
  1. Tokenizes slice passages + queries with `openthai_latte_wordseg_lite` (changing ONLY tokenizer vs PyThaiNLP newmm).
  2. Embeds each slice passage with its `title + section heading + exact_text` and each query using
     `BAAI/bge-m3` ONNX (`sentence_embedding`, 1024-dim, L2-normalized) via BGE-M3's own SentencePiece tokenizer,
     then computes exact cosine similarity (zero ANN approximation error).
"""

import argparse
import json
import os
import re
import time
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer
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
    (re.compile(r"คอนโดมิเนียม|คอนโด"), " ห้องชุด คอนโดมิเนียม "),
]
SEC_RE = re.compile(
    r"(มาตรา|ข้อ)\s*([0-9]+(?:/[0-9]+)?)(?:\s*(อัฏฐารส|สัตตรส|เอกาทศ|ทวาทศ|จตุทศ|ปัณรส|จัตวา|เบญจ|เตรส|โสฬส|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ))?((?:\s*\([0-9ก-ฮ]+\))*)"
)
SLASH_SEC_MASK_RE = re.compile(r"(?:มาตรา|ข้อ)\s*[0-9]+/[0-9]+(?:\s*\([0-9ก-ฮ]+\))*")
RD_RE = re.compile(r"(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^\n]{0,90}?(?:ฉบับที่\s*|เลขที่\s*|\(\s*ฉบับที่\s*|\s+)([0-9]{1,4})(?![0-9/])")
RULING_RE = re.compile(r"(?:กค\s*[0-9]{2,5}(?:\s*\([^)]+\))?\s*[/-]\s*(?:[ก-ฮA-Za-z.]+\s*[/-]?\s*)?[0-9]+[ก-ฮA-Za-z]*)")


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
    for m in RULING_RE.finditer(arabic):
        norm = re.sub(r"\s*/\s*", "/", re.sub(r"\s+", " ", m.group(0)).strip())
        norm = re.sub(r"^กค\s*", "กค_", norm)
        tok = f"ruling:{norm}"
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


def normalize_text(raw_text: str) -> str:
    txt = (raw_text or "").translate(THAI_DIGIT_TABLE)
    for rx, repl in ABBREV_RULES:
        txt = rx.sub(repl, txt)
    return re.sub(r"\s+", " ", txt).strip()


def latte_tokenize(latte: LatteSegmenter, raw_text: str) -> list[str]:
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


def embed_texts_bge_m3(
    sess: ort.InferenceSession,
    tokenizer: Tokenizer,
    texts: list[str],
    batch_size: int = 8,
    max_len: int = 384,
) -> np.ndarray:
    tokenizer.enable_truncation(max_length=max_len)
    tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
    all_vecs = []
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
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms = np.maximum(norms, 1e-12)
        vecs = vecs / norms
        all_vecs.append(vecs)
    return np.vstack(all_vecs) if all_vecs else np.zeros((0, 1024), dtype=np.float32)


def main():
    os.environ.setdefault("HF_HOME", r"D:\Code\REG24\.hf-cache")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    passages = data["passages"]
    queries = data["queries"]
    print(f"Loaded slice: {len(passages)} passages, {len(queries)} queries")

    # 1. OpenThai 2.0 LATTE WordSeg Lite tokenization
    t0 = time.perf_counter()
    latte = LatteSegmenter()
    latte_passages = {}
    for p in passages:
        latte_passages[p["passage_id"]] = {
            "title_tokens": latte_tokenize(latte, p["title_text"]),
            "body_tokens": latte_tokenize(latte, p["body_text"]),
        }
    latte_queries = {}
    latte_q_times = []
    for q in queries:
        qt0 = time.perf_counter()
        latte_queries[q["case_id"]] = latte_tokenize(latte, q["question"])
        latte_q_times.append((time.perf_counter() - qt0) * 1000.0)
    latte_total_ms = (time.perf_counter() - t0) * 1000.0
    print(f"LATTE WordSeg Lite finished in {latte_total_ms:.1f} ms (query p95={np.percentile(latte_q_times, 95):.2f} ms)")

    # 2. BGE-M3 ONNX exact cosine embeddings (passage = title + section heading + exact_text)
    t1 = time.perf_counter()
    model_path = hf_hub_download("BAAI/bge-m3", "onnx/model.onnx")
    tok_path = hf_hub_download("BAAI/bge-m3", "tokenizer.json")
    sess_opts = ort.SessionOptions()
    sess_opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
    sess = ort.InferenceSession(model_path, sess_options=sess_opts, providers=["CPUExecutionProvider"])
    bge_tok = Tokenizer.from_file(tok_path)

    passage_texts = [f"{p['title_text']}\n{p['body_text'][:1200]}" for p in passages]
    print(f"Embedding {len(passage_texts)} slice passages with BAAI/bge-m3 ONNX (exact cosine, 1024d)...")
    p_vecs = embed_texts_bge_m3(sess, bge_tok, passage_texts, batch_size=8, max_len=384)
    bge_passages_ms = (time.perf_counter() - t1) * 1000.0
    print(f"BGE-M3 passage embedding finished in {bge_passages_ms / 1000.0:.1f} s")

    query_texts = [q["question"] for q in queries]
    q_vecs = []
    bge_q_times = []
    for qt in query_texts:
        qt0 = time.perf_counter()
        qv = embed_texts_bge_m3(sess, bge_tok, [qt], batch_size=1, max_len=256)[0]
        bge_q_times.append((time.perf_counter() - qt0) * 1000.0)
        q_vecs.append(qv)
    q_mat = np.vstack(q_vecs)

    # Exact cosine similarity matrix [num_queries, num_passages]
    sim_mat = q_mat @ p_vecs.T
    bge_top_by_case = {}
    for qi, q in enumerate(queries):
        scores = sim_mat[qi]
        top_idx = np.argsort(-scores)[:50]
        bge_top_by_case[q["case_id"]] = [
            {
                "passage_id": passages[int(pi)]["passage_id"],
                "work_id": passages[int(pi)]["work_id"],
                "version_id": passages[int(pi)]["version_id"],
                "cosine": round(float(scores[int(pi)]), 5),
            }
            for pi in top_idx
        ]

    out_payload = {
        "latte_meta": {
            "model": "iapp/OpenThai2.0-LATTE-WordSeg-Lite",
            "version": "0.1.2",
            "total_ms": round(latte_total_ms, 2),
            "query_p95_ms": round(float(np.percentile(latte_q_times, 95)), 2),
        },
        "bge_m3_meta": {
            "model": "BAAI/bge-m3",
            "runtime": "onnxruntime-cpu-exact-cosine",
            "dimensions": 1024,
            "slice_passage_count": len(passages),
            "passage_embed_total_ms": round(bge_passages_ms, 2),
            "query_embed_p95_ms": round(float(np.percentile(bge_q_times, 95)), 2),
        },
        "latte_passages": latte_passages,
        "latte_queries": latte_queries,
        "bge_top_by_case": bge_top_by_case,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out_payload, f, ensure_ascii=False)
    print(f"Saved LATTE + BGE-M3 results to {args.output} (BGE-M3 query p95={out_payload['bge_m3_meta']['query_embed_p95_ms']} ms)")


if __name__ == "__main__":
    main()
