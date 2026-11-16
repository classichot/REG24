"""
REG24 — B01 Source Text Completeness Upgrader (DEF-B01-05)

Fixes the merge omission in `extract_all_5150_rd_drive.py` where `matched_existing` records in
`src/core/data/thai-tax-rulings-corpus.json` retained legacy markdown-index snippets
(`180/260` chars on 2540–2564 cards; `750/950` chars on 2565–2569 cards including LSC-01 & LSC-04)
instead of receiving the full verbatim text from the verified physical PDFs/HTMLs in
`G:\\My Drive\\Legal Database Resource Master\\RD - Revenue Department\\Rulings`.

Also strips Chromium HTML-to-PDF page-margin tone-mark clip fragments (`รั้ที่`, `นั้ที่`) and heals
mid-word Thai line wraps while preserving every existing canonical ID and `rd-5150-drive-manifest.json`.
"""

import concurrent.futures
import html
import json
import os
import re
import sys
import time
import pymupdf

sys.stdout.reconfigure(encoding="utf-8")

RD_ROOT = r"G:\My Drive\Legal Database Resource Master\RD - Revenue Department"
CORPUS_JSON_PATH = r"d:\Code\REG24\src\core\data\thai-tax-rulings-corpus.json"
DRIVE_MANIFEST_PATH = r"d:\Code\REG24\src\core\data\rd-5150-drive-manifest.json"
AUDIT_OUT_PATH = r"d:\Code\REG24\docs\audit\dodo-review-rc2-b02\b01_source_completeness_upgrade_receipt.json"


def clean_html_to_text(raw_bytes: bytes) -> str:
    txt = ""
    for enc in ("utf-8", "cp874", "tis-620", "latin1"):
        try:
            decoded = raw_bytes.decode(enc)
            if "ข้อหารือ" in decoded or "เลขที่" in decoded or "<html" in decoded.lower():
                txt = decoded
                break
        except Exception:
            continue
    if not txt:
        txt = raw_bytes.decode("utf-8", errors="replace")
    txt = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", txt)
    txt = re.sub(r"(?i)<br\s*/?>", "\n", txt)
    txt = re.sub(r"(?i)</(p|div|tr|td|th|li|h[1-6])>", "\n", txt)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = html.unescape(txt)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in txt.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def extract_clean_pdf_text(raw_bytes: bytes) -> str:
    doc = pymupdf.open(stream=raw_bytes, filetype="pdf")
    pages_out = []
    protected_labels = {"-", "แนว", "วินิจฉัย", "เรื่อง", "วันที่", "ข้อหารือ", "ข้อกฎหมาย", "เลขตู้"}
    for p in doc:
        page_h = p.rect.height
        blocks = p.get_text("blocks")
        kept_lines = []
        for b in blocks:
            if len(b) >= 7 and b[6] != 0:
                continue
            btxt = b[4] or ""
            stripped = btxt.strip()
            if not stripped:
                continue
            compact = re.sub(r"\s+", "", stripped)
            if (b[1] > page_h - 32 or b[3] < 24) and len(compact) <= 10 and stripped not in protected_labels:
                continue
            kept_lines.append(btxt.rstrip("\n"))
        pages_out.append("\n".join(kept_lines))
    doc.close()
    return "\n".join(pages_out)


def heal_preserving_trailing_space(raw_s: str) -> str:
    if not raw_s:
        return ""
    raw_lines = raw_s.splitlines()
    pieces = []
    for rln in raw_lines:
        had_trailing_space = bool(re.search(r"[ \t]+$", rln))
        clean = re.sub(r"[ \t]+", " ", rln).strip()
        if not clean:
            continue
        pieces.append((clean, had_trailing_space))
    if not pieces:
        return ""
    res = [pieces[0][0]]
    prev_had_space = pieces[0][1]
    for clean, had_space in pieces[1:]:
        prev = res[-1]
        if prev_had_space:
            res.append(" " + clean)
        elif re.match(r"^(?:\d+\.\s|\(\d+\)\s)", clean):
            res.append(" " + clean)
        elif re.search(r"[\u0E00-\u0E7F]$", prev) and re.match(r"^[\u0E00-\u0E7F]", clean):
            res.append(clean)
        else:
            res.append(" " + clean)
        prev_had_space = had_space
    return re.sub(r"[ \t]+", " ", "".join(res)).strip()


def parse_drive_ruling_sections(txt: str) -> dict:
    norm = re.sub(r"(?m)^\s*เลขที่\s*\n\s*หนังสือ\s*$", "เลขที่หนังสือ", txt)
    norm = re.sub(r"(?m)^\s*ข้อ\s*\n\s*กฎหมาย\s*", "ข้อกฎหมาย\n", norm)
    norm = re.sub(r"(?m)^\s*ข้อ\s*\n\s*หารือ\s*$", "ข้อหารือ", norm)
    norm = re.sub(r"(?m)^\s*แนว\s*\n\s*วินิจฉัย\s*$", "แนววินิจฉัย", norm)

    def extract_sec(header_re: str, stop_res: list[str]) -> str:
        stops = "|".join(stop_res)
        pat = rf"(?:^|\n)\s*(?:{header_re})\s*:?\s*(.*?)(?=(?:\n\s*(?:{stops})(?:\s*:|\s*\n|\s*$))|\Z)"
        m = re.search(pat, norm, flags=re.S)
        return m.group(1) if m else ""

    legal_raw = extract_sec(r"ข้อ\s*กฎหมาย", [r"ข้อ\s*หารือ", r"แนว\s*วินิจฉัย"])
    facts_raw = extract_sec(r"ข้อ\s*หารือ", [r"แนว\s*วินิจฉัย", r"เลขตู้"])
    ruling_matches = list(
        re.finditer(
            r"(?:^|\n)\s*แนว\s*วินิจฉัย\s*:?\s*(.*?)(?=(?:\n\s*(?:เลขตู้|เลขรับ|Source:|Page\s+\d+)(?:\s*:|\s*\n|\s*$))|\Z)",
            norm,
            flags=re.S,
        )
    )
    ruling_raw = ruling_matches[0].group(1) if ruling_matches else ""

    facts = heal_preserving_trailing_space(facts_raw)
    ruling = heal_preserving_trailing_space(ruling_raw)
    legal_prov = heal_preserving_trailing_space(legal_raw)

    ruling = re.sub(r"\s*เลขตู้\s*:?\s*[0-9๐-๙/\-\s]*$", "", ruling).strip()
    if ruling == "-":
        ruling = ""

    if not ruling and facts:
        inline_m = re.search(
            r"(?<!มี)(?<!วาง)(?<!ตาม)(?<!เป็น)(?:แนว\s*วินิจฉั(?:ย|\s*:)|\.{2}DRFT|(?:[0-9]+\.\s*)?กระผมได้พิจารณาแล้วขอเรียนว่า|กรมสรรพากรขอเรียนว่า)",
            facts,
        )
        if inline_m and inline_m.start() > 25:
            hdr_text = inline_m.group(0)
            left = facts[: inline_m.start()].strip()
            if re.match(r"^(?:แนว|\.{2}DRFT)", hdr_text):
                right = facts[inline_m.end() :].lstrip(" :").strip()
            else:
                right = facts[inline_m.start() :].strip()
            if left and right:
                facts = left
                ruling = right

    if not facts and not ruling:
        clean_body = re.sub(r"^.*?ข้อหารือภาษีอากร[^\n]*\n", "", norm, flags=re.S).strip()
        facts = heal_preserving_trailing_space(clean_body)

    return {
        "legal_provisions": legal_prov,
        "facts": facts,
        "ruling": ruling,
    }


def worker(rf: dict) -> dict:
    full_path = os.path.join(RD_ROOT, rf["rel_path"].replace("/", os.sep))
    with open(full_path, "rb") as bf:
        raw = bf.read()
    if rf["ext"].lower() == ".pdf":
        txt = extract_clean_pdf_text(raw)
    else:
        txt = clean_html_to_text(raw)
    sec = parse_drive_ruling_sections(txt)
    return {
        "corpus_id": rf["corpus_id"],
        "rel_path": rf["rel_path"],
        "sha256": rf["sha256"],
        "facts": sec["facts"],
        "ruling": sec["ruling"],
        "legal_provisions": sec["legal_provisions"],
    }


def main():
    t0 = time.time()
    with open(CORPUS_JSON_PATH, encoding="utf-8") as f:
        corpus = json.load(f)
    with open(DRIVE_MANIFEST_PATH, encoding="utf-8") as f:
        manifest = json.load(f)

    pre_stats = {
        "total_corpus_records": len(corpus),
        "facts_exact_750": sum(1 for r in corpus if len(r.get("facts") or "") == 750),
        "ruling_exact_950": sum(1 for r in corpus if len(r.get("ruling") or "") == 950),
        "facts_exact_180": sum(1 for r in corpus if len(r.get("facts") or "") == 180),
        "ruling_exact_260": sum(1 for r in corpus if len(r.get("ruling") or "") == 260),
    }

    rfs = manifest["ruling_files"]
    with concurrent.futures.ProcessPoolExecutor(max_workers=8) as pool:
        extracted = list(pool.map(worker, rfs, chunksize=64))

    # Map corpus_id -> best extracted Drive record (preferring longest facts+ruling if duplicate PDFs exist)
    best_by_cid = {}
    for ex in extracted:
        cid = ex["corpus_id"]
        prev = best_by_cid.get(cid)
        if not prev or (len(ex["facts"]) + len(ex["ruling"]) > len(prev["facts"]) + len(prev["ruling"])):
            best_by_cid[cid] = ex

    upgraded_count = 0
    upgraded_750_950_count = 0
    upgraded_180_260_count = 0
    cleaned_existing_full_count = 0

    for rec in corpus:
        cid = str(rec.get("id") or "")
        ex = best_by_cid.get(cid)
        if not ex:
            continue
        old_f = rec.get("facts") or ""
        old_r = rec.get("ruling") or ""
        was_750_950 = len(old_f) == 750 or len(old_r) == 950
        was_180_260 = len(old_f) == 180 or len(old_r) == 260

        new_f = ex["facts"]
        new_r = ex["ruling"]
        if len(new_f) + len(new_r) >= max(80, len(old_f) + len(old_r) - 30):
            if new_f != old_f or new_r != old_r:
                rec["facts"] = new_f
                rec["ruling"] = new_r
                if ex["legal_provisions"] and len(ex["legal_provisions"]) > len(rec.get("legal_provisions") or ""):
                    rec["legal_provisions"] = ex["legal_provisions"]
                upgraded_count += 1
                if was_750_950:
                    upgraded_750_950_count += 1
                elif was_180_260:
                    upgraded_180_260_count += 1
                else:
                    cleaned_existing_full_count += 1

    with open(CORPUS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(corpus, f, ensure_ascii=False, separators=(",", ":"))

    in_b01_cids = set(best_by_cid.keys())
    b01_records = [r for r in corpus if str(r.get("id") or "") in in_b01_cids]

    post_stats = {
        "total_corpus_records": len(corpus),
        "b01_drive_backed_records": len(b01_records),
        "b01_facts_exact_750": sum(1 for r in b01_records if len(r.get("facts") or "") == 750),
        "b01_ruling_exact_950": sum(1 for r in b01_records if len(r.get("ruling") or "") == 950),
        "b01_facts_exact_180": sum(1 for r in b01_records if len(r.get("facts") or "") == 180),
        "b01_ruling_exact_260": sum(1 for r in b01_records if len(r.get("ruling") or "") == 260),
        "b01_cut_vowel_end": sum(
            1 for r in b01_records if (r.get("ruling") or "") and re.search(r"[\u0E40-\u0E44\u0E31]$", r["ruling"])
        ),
    }

    os.makedirs(os.path.dirname(AUDIT_OUT_PATH), exist_ok=True)
    receipt = {
        "executed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duration_seconds": round(time.time() - t0, 2),
        "upgraded_total_records": upgraded_count,
        "upgraded_750_950_records": upgraded_750_950_count,
        "upgraded_180_260_records": upgraded_180_260_count,
        "cleaned_existing_full_records": cleaned_existing_full_count,
        "pre_stats": pre_stats,
        "post_stats": post_stats,
        "verified_samples": {
            cid: {
                "ruling_no": next((r["ruling_no"] for r in corpus if r["id"] == cid), ""),
                "facts_length": len(next((r["facts"] for r in corpus if r["id"] == cid), "")),
                "ruling_length": len(next((r["ruling"] for r in corpus if r["id"] == cid), "")),
                "ruling_tail_160": next((r["ruling"] for r in corpus if r["id"] == cid), "")[-160:],
            }
            for cid in ("ruling.th.rd.68536", "ruling.th.rd.65296", "ruling.th.rd.25374", "ruling.th.rd.25071")
        },
    }
    with open(AUDIT_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(receipt, f, ensure_ascii=False, indent=2)

    print(json.dumps(receipt, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
