"""
REG24 — PyThaiNLP `newmm` + Versioned Thai Legal Dictionary Corpus Tokenizer

Tokenizes exported passage title & body fields using real `pythainlp` `newmm`
augmented with `reg24-th-legal-dict-v1.0` while preserving:
  - Atomic composite legal identifiers (`มาตรา ๘๐/๑ (๒)` -> `sec:80/1(2)` + `sec:80/1`, NEVER `sec:80`)
  - Thai legal negations and exceptions (`มิให้`, `เว้นแต่`, `ไม่มีค่าตอบแทน`, `โดยเสน่หา`, etc.)
  - Separate normalized search fields (Thai -> Arabic digits, known abbreviations) without mutating originals.
"""

import argparse
import hashlib
import json
import re
import sys
import pythainlp
from pythainlp.corpus.common import thai_words
from pythainlp.tokenize import word_tokenize
from pythainlp.util import dict_trie

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
RD_RE = re.compile(r"(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^\n]{0,90}?(?:ฉบับที่\s*|เลขที่\s*|\(\s*ฉบับที่\s*|\s+)([0-9]{1,4})(?![0-9/])")
MINREG_RE = re.compile(r"(?:กฎกระทรวง)[^\n]{0,40}?(?:ฉบับที่\s*)([0-9]{1,4})(?![0-9/])")
AMEND_RE = re.compile(r"(?:พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร)[^\n]{0,40}?(?:ฉบับที่\s*)([0-9]{1,3})(?![0-9/])")
RULING_RE = re.compile(r"(?:กค\s*[0-9]{2,5}(?:\s*\([^)]+\))?\s*[/-]\s*(?:[ก-ฮA-Za-z.]+\s*[/-]?\s*)?[0-9]+[ก-ฮA-Za-z]*)")
ORDER_RE = re.compile(r"(ท\.ป\.|ป\.)\s*([0-9]+/[0-9]{4})")


def extract_composite_legal_tokens(raw_text: str) -> list[str]:
    arabic = (raw_text or "").translate(THAI_DIGIT_TABLE)
    out = []
    seen = set()
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
    for m in AMEND_RE.finditer(arabic):
        tok = f"rc_amend:{m.group(1)}"
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
    for m in ORDER_RE.finditer(arabic):
        tok = f"order:{m.group(1)}{m.group(2)}"
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


def normalize_search_text(raw_text: str) -> str:
    txt = (raw_text or "").translate(THAI_DIGIT_TABLE)
    for rx, repl in ABBREV_RULES:
        txt = rx.sub(repl, txt)
    return re.sub(r"\s+", " ", txt).strip()


def tokenize_with_newmm(raw_text: str, custom_trie) -> list[str]:
    composite = extract_composite_legal_tokens(raw_text)
    norm = normalize_search_text(raw_text)
    masked = SLASH_SEC_MASK_RE.sub(" ", norm)
    raw_toks = word_tokenize(masked, custom_dict=custom_trie, engine="newmm", keep_whitespace=False)
    out = list(composite)
    for tok in raw_toks:
        t = tok.strip().lower()
        if not t:
            continue
        if len(t) >= 2 or t.isdigit():
            if not re.fullmatch(r"[\W_]+", t):
                out.append(t)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        payload = json.load(f)

    dict_version = payload["legal_dictionary_version"]
    dict_terms = payload["legal_dictionary_terms"]
    dict_sha256 = payload["legal_dictionary_sha256"]

    combined_words = set(thai_words()) | set(dict_terms)
    custom_trie = dict_trie(combined_words)

    passages_out = {}
    for item in payload["passages"]:
        pid = item["passage_id"]
        passages_out[pid] = {
            "title_tokens": tokenize_with_newmm(item.get("title_text", ""), custom_trie),
            "body_tokens": tokenize_with_newmm(item.get("body_text", ""), custom_trie),
        }

    result = {
        "tokenizer_engine": f"pythainlp_newmm_v{pythainlp.__version__}+{dict_version}",
        "legal_dictionary_version": dict_version,
        "legal_dictionary_sha256": dict_sha256,
        "passage_count": len(passages_out),
        "passages": passages_out,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"Tokenized {len(passages_out)} passages with {result['tokenizer_engine']}")


if __name__ == "__main__":
    main()
