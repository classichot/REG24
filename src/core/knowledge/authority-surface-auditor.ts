/**
 * REG24 — Multi-Surface Verified Authority Auditor & Sanitizer (Candidate 6 P0)
 *
 * Enforces a strict citation-publication invariant across EVERY surface of a published answer
 * (headings, issue summaries, conclusions, explanations, authority distinction notes / comparisons,
 * assumptions, missing facts, evidence gaps, UI Markdown, `/query` JSON, SSE `complete`,
 * Neon Save, and `?require_db=1` Reopen):
 *
 * - Every named legal authority must point to an exact verified passage AND verified legal version
 *   bound to the claim/answer that supports its stated use.
 * - Unsupported incidental references (and any clause/sentence/bullet that depends on them) are
 *   removed cleanly while keeping independently supported conclusions intact.
 * - Unsupported essential references in an operative conclusion withhold ONLY the affected issue.
 * - Zero ruling-number blacklists and zero silent authority substitution.
 */

import { normalizeOfficialRulingIdentifier, thaiDigitsToArabic } from "./identity";

export type NamedAuthorityKind =
  | "ruling"
  | "rd_url"
  | "royal_decree"
  | "ministerial_reg"
  | "dg_notification"
  | "rd_order_tp"
  | "rd_order_p"
  | "dika_judgment"
  | "amending_act"
  | "section";

export interface ExtractedNamedAuthority {
  kind: NamedAuthorityKind;
  canonicalId: string;
  rawMatch: string;
}

export interface VerifiedAuthorityPassageBinding {
  passage_id: string;
  work_id: string;
  version_id: string;
  work_type?: string | null;
  authority_tier?: string | null;
  official_identifier?: string | null;
  title_th?: string | null;
  pinpoint?: string | null;
  verbatim_text: string;
  official_url?: string | null;
  temporal_applicability_hint?: string | null;
}

export interface AuthorityAuditOptions {
  excludedContextInstruments?: string[];
  isEvidenceGapNotice?: boolean;
}

function normalizeCompactForSectionLookup(raw: string): string {
  return thaiDigitsToArabic(raw || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractNamedAuthoritiesFromText(rawText: string): ExtractedNamedAuthority[] {
  if (!rawText || !rawText.trim()) return [];
  const arabic = thaiDigitsToArabic(rawText);
  const lowerNorm = arabic.toLowerCase().replace(/\s+/g, " ");
  const out: ExtractedNamedAuthority[] = [];
  const seen = new Set<string>();
  const pushAuth = (kind: NamedAuthorityKind, canonicalId: string, rawMatch: string) => {
    const key = `${kind}:${canonicalId}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind, canonicalId, rawMatch });
    }
  };

  // 1. Revenue Department tax rulings (`กค XXXX/XXXX`, `กค. 0702/พ./7403`, etc.)
  for (const m of arabic.matchAll(
    /(?:กค\.?|gor\s*kor\.?|gk)\s*[0-9]{2,5}(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮa-zA-Z.]+\s*\/?\s*)?[0-9ก-๙a-zA-Z]+/gi
  )) {
    const norm = normalizeOfficialRulingIdentifier(
      m[0].replace(/^(?:gor\s*kor\.?|gk|กค\.)\s*/i, "กค ")
    ).toLowerCase();
    if (norm) pushAuth("ruling", norm, m[0]);
  }

  // 2. Direct Revenue Department ruling page URLs (`rd.go.th/31587.html`)
  for (const m of arabic.matchAll(/(?:https?:\/\/)?(?:www\.)?rd\.go\.th\/([0-9]+)\.html/gi)) {
    pushAuth("rd_url", `rd_url.${m[1]}`, m[0]);
  }

  // 3. Royal Decrees (`พระราชกฤษฎีกา ... ฉบับที่ N` or `พ.ร.ฎ. N`)
  //    Do not span across an intervening distinct instrument keyword (`พระราชกฤษฎีกา`, `พระราชบัญญัติ`, `กฎกระทรวง`, `ประกาศอธิบดี`, `คำสั่งกรมสรรพากร`).
  for (const m of lowerNorm.matchAll(
    /(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)(?:(?!พระราชกฤษฎีกา|พ\.ร\.ฎ\.|พระราชบัญญัติ|พ\.ร\.บ\.|กฎกระทรวง|ประกาศอธิบดี|คำสั่งกรมสรรพากร)[^0-9\n]){0,115}ฉบับที่\s*([0-9]+)/g
  )) {
    pushAuth("royal_decree", `พรฎ.${m[1]}`, m[0]);
  }
  for (const m of lowerNorm.matchAll(/พ\.ร\.ฎ\.\s*\(?\s*([0-9]{2,4})\s*\)?(?![0-9/])/g)) {
    pushAuth("royal_decree", `พรฎ.${m[1]}`, m[0]);
  }

  // 4. Ministerial Regulations (`กฎกระทรวง ... ฉบับที่ N`)
  for (const m of lowerNorm.matchAll(/กฎกระทรวง[^0-9\n]{0,75}ฉบับที่\s*([0-9]+)/g)) {
    pushAuth("ministerial_reg", `กฎกระทรวง.${m[1]}`, m[0]);
  }

  // 5. Director-General Notifications (`ประกาศอธิบดี... ฉบับที่ N`)
  for (const m of lowerNorm.matchAll(/ประกาศอธิบดี[^0-9\n]{0,95}ฉบับที่\s*([0-9]+)/g)) {
    pushAuth("dg_notification", `ปอ.${m[1]}`, m[0]);
  }

  // 6. Departmental Orders (`ท.ป. X/Y` and `คำสั่งกรมสรรพากร ที่ ป. X/Y` / `ที่ ป. X/Y`)
  for (const m of lowerNorm.matchAll(/ท\.ป\.\s*([0-9]+\/[0-9]+)/g)) {
    pushAuth("rd_order_tp", `ทป.${m[1]}`, m[0]);
  }
  for (const m of lowerNorm.matchAll(/(?:คำสั่งกรมสรรพากร\s*)?ที่\s*ป\.\s*([0-9]+\/[0-9]+)/g)) {
    pushAuth("rd_order_p", `ป.${m[1]}`, m[0]);
  }

  // 7. Supreme Court Judgments (`ฎีกาที่ X/Y`)
  for (const m of lowerNorm.matchAll(/ฎีกาที่\s*([0-9]+\/[0-9]+)/g)) {
    pushAuth("dika_judgment", `ฎีกา.${m[1]}`, m[0]);
  }

  // 8. Revenue Code Amending Acts / Emergency Decrees (`พระราชบัญญัติแก้ไขเพิ่มเติม... (ฉบับที่ N)`)
  for (const m of lowerNorm.matchAll(
    /(?:พระราชบัญญัติ|พ\.ร\.บ\.|พระราชกำหนด|พ\.ร\.ก\.)\s*แก้ไขเพิ่มเติม(?:ประมวลรัษฎากร)?\s*\(?\s*ฉบับที่\s*([0-9]+)\s*\)?/g
  )) {
    pushAuth("amending_act", `พรบแก้ไข.${m[1]}`, m[0]);
  }

  // 9. Statutory sections (`มาตรา N`, `มาตรา 41 ทวิ`, `มาตรา 48 (4/1)`, `มาตรา 42 (26)`)
  for (const m of lowerNorm.matchAll(
    /มาตรา\s*([0-9]+(?:\/[0-9]+)?)(?:\s*(อัฏฐารส|อัฐารส|สัตตรส|เอกาทศ|ทวาทศ|ปัณรส|จตุทศ|เตรส|โสฬส|จัตวา|เบญจ|สัตต|อัฏฐ|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ(?!บับ|พาะ|ุกเฉิน)))?(?:\s*\(([0-9]{1,2}(?:\/[0-9]+)?)\))?/g
  )) {
    const num = m[1];
    const ord = m[2] ? ` ${m[2]}` : "";
    pushAuth("section", `มาตรา ${num}${ord}`, m[0]);
    if (m[3]) {
      pushAuth("section", `มาตรา ${num}${ord} (${m[3]})`, m[0]);
    }
  }

  return out;
}

/**
 * Strips website compiler cross-reference notes such as `( ดูพระราชกฤษฎีกาฯ (ฉบับที่ 479) พ.ศ.2551 )`
 * or `( ดูคำสั่งกรมสรรพากร ที่ ป.119/2545 )` so editorial margin links inside Revenue Code HTML pages
 * can never masquerade as operative statutory/subordinate authority bindings.
 */
export function stripCompilerSeeAlsoNotes(rawText: string): string {
  return (rawText || "").replace(
    /\(\s*ดู\s*(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.|คำสั่งกรมสรรพากร|ประกาศอธิบดี|กฎกระทรวง|คำวินิจฉัย)[^)]*\)/g,
    " "
  );
}

export interface InPlaceAmendedBaseDecreeBinding {
  amendingDecreeNum: string;
  amendedBaseDecreeNum: string;
  amendedSectionNum: string;
}

/**
 * Resolves general statutory amendment lineage when a verified, non-OUT_OF_WINDOW amending Royal Decree
 * passage (`work_id = "subreg.th.rc.royal_decree.<amendNum>"`) replaces or amends an article of a base
 * Royal Decree in place (`มาตรา <sec> แห่งพระราชกฤษฎีกา... (ฉบับที่ <baseNum>)`).
 *
 * - Strictly distinguishes the amended base decree (`มาตรา <sec> แห่ง... ฉบับที่ <baseNum>`) from any
 *   repealed intermediate amending decree (`ซึ่งแก้ไขเพิ่มเติมโดย... ฉบับที่ <prev>`), compiler footnotes,
 *   or historical guidance examples.
 * - Zero hardcoded decree numbers / zero allowlists.
 */
export function resolveInPlaceAmendedBaseDecreeBindings(
  nonOutOfWindowPassages: Array<{
    work_id?: string | null;
    pinpoint?: string | null;
    verbatim_text: string;
  }>
): InPlaceAmendedBaseDecreeBinding[] {
  const results: InPlaceAmendedBaseDecreeBinding[] = [];
  const seen = new Set<string>();

  for (const p of nonOutOfWindowPassages) {
    const amendMatch = /^subreg\.th\.rc\.royal_decree\.([0-9]+)$/.exec(p.work_id || "");
    if (!amendMatch) continue;
    const amendingDecreeNum = amendMatch[1];
    const sourceText = thaiDigitsToArabic(
      stripCompilerSeeAlsoNotes(`${p.pinpoint || ""}\n${p.verbatim_text || ""}`)
    ).replace(/\s+/g, " ");

    // Pattern 1: `มาตรา <sec> แห่งพระราชกฤษฎีกา... (ฉบับที่ <baseNum>)`
    // (`[^0-9\n]` cannot cross `<baseNum>` or its year into `ซึ่งแก้ไขเพิ่มเติมโดย... (ฉบับที่ <prev>)`!)
    for (const m of sourceText.matchAll(
      /มาตรา\s*([0-9]+)\s*แห่ง\s*(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^0-9\n]{0,95}ฉบับที่\s*([0-9]+)/g
    )) {
      const secNum = m[1];
      const baseNum = m[2];
      if (baseNum === amendingDecreeNum) continue;
      const key = `${amendingDecreeNum}->${baseNum}:${secNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          amendingDecreeNum,
          amendedBaseDecreeNum: baseNum,
          amendedSectionNum: secNum,
        });
      }
    }

    // Pattern 2: `บทบัญญัติแก้ไขเพิ่มเติม พ.ร.ฎ. (ฉบับที่ <baseNum>) มาตรา <sec>`
    for (const m of sourceText.matchAll(
      /แก้ไขเพิ่มเติม\s*(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^0-9\n]{0,65}ฉบับที่\s*([0-9]+)[^0-9\n]{0,25}มาตรา\s*([0-9]+)/g
    )) {
      const baseNum = m[1];
      const secNum = m[2];
      if (baseNum === amendingDecreeNum) continue;
      const key = `${amendingDecreeNum}->${baseNum}:${secNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          amendingDecreeNum,
          amendedBaseDecreeNum: baseNum,
          amendedSectionNum: secNum,
        });
      }
    }
  }

  return results;
}

export function isNamedAuthoritySupportedByPassages(
  auth: ExtractedNamedAuthority,
  verifiedPassages: VerifiedAuthorityPassageBinding[],
  contextText: string,
  opts?: AuthorityAuditOptions
): boolean {
  // Every valid authority binding MUST point to a passage with both a `passage_id` and a verified `version_id`!
  const activeVerified = verifiedPassages.filter(
    (p) => Boolean(p.passage_id && p.passage_id.trim()) && Boolean(p.version_id && p.version_id.trim())
  );
  if (activeVerified.length === 0) return false;

  const nonOutOfWindow = activeVerified.filter(
    (p) => p.temporal_applicability_hint !== "OUT_OF_WINDOW"
  );
  const normCtx = thaiDigitsToArabic(contextText || "").toLowerCase();

  switch (auth.kind) {
    case "ruling": {
      // A `กค` tax ruling MUST be backed by an explicit verified TaxRuling passage + version in the bound set!
      return nonOutOfWindow.some((p) => {
        const isRulingWork =
          p.work_type === "TaxRuling" ||
          p.authority_tier === "CASE_SPECIFIC_TAX_RULING" ||
          p.work_id.startsWith("work.th.rd.");
        if (!isRulingWork) return false;
        const candidateRulingBlob = `${p.official_identifier || ""} ${p.title_th || ""} ${p.verbatim_text}`;
        const extracted = extractNamedAuthoritiesFromText(candidateRulingBlob)
          .filter((x) => x.kind === "ruling")
          .map((x) => x.canonicalId);
        const bareTarget = auth.canonicalId.replace(/^กค\s*/, "");
        return (
          extracted.includes(auth.canonicalId) ||
          normalizeCompactForSectionLookup(candidateRulingBlob).includes(bareTarget)
        );
      });
    }

    case "rd_url": {
      const pageNum = auth.canonicalId.slice("rd_url.".length);
      return nonOutOfWindow.some((p) =>
        Boolean(p.official_url && new RegExp(`/${pageNum}\\.html(?:$|[?#])`, "i").test(p.official_url))
      );
    }

    case "royal_decree": {
      const num = auth.canonicalId.slice("พรฎ.".length);
      const hasDirectDecreeWork = nonOutOfWindow.some(
        (p) => p.work_id === `subreg.th.rc.royal_decree.${num}`
      );
      if (hasDirectDecreeWork) return true;

      const excludedSet = new Set(opts?.excludedContextInstruments || []);
      if (
        excludedSet.has(auth.canonicalId) &&
        /(?:สิ้นสุด|ไม่อยู่ในช่วง|ไม่ใช้บังคับ|ยังไม่ใช้บังคับ|ไม่ได้ใช้บังคับ|ยังไม่เริ่มใช้บังคับ|ยังไม่มีผลใช้บังคับ|ไม่มีผลใช้บังคับ|นอกช่วง|พ้นช่วง|ก่อนวันที่|หลังวันที่|ก่อน(?:ที่)?(?:พ\.ร\.ฎ\.|พระราชกฤษฎีกา)|ไม่อาจนำ|ไม่นำ|ไม่ได้อยู่ภายใต้|มิได้อยู่ภายใต้|ไม่อยู่ภายใต้|เปลี่ยน[^.;\n]{0,45}จาก|เปลี่ยนมาเป็น|เปลี่ยนมาใช้|เปลี่ยนมาอยู่ภายใต้|ย้ายจาก|เลื่อน(?:มา|จาก)|แทน(?:ที่)?(?:เดิม|จะใช้|พ\.ร\.ฎ\.|พระราชกฤษฎีกา)?|เดิม(?:เคย)?(?:อยู่ภายใต้|ตกอยู่ภายใต้|ใช้(?:บังคับ)?(?:ตาม)?)|ต่างจาก|เปรียบเทียบ(?:กับ)?|เทียบกับ|moved\s+from|instead\s+of|rather\s+than|not\s+applicable|does\s+not\s+apply|superseded|replaced\s+by|expired|outside\s+the\s+effective|compared\s+(?:to|with)|previously\s+under)/i.test(
          normCtx
        )
      ) {
        return true;
      }

      // General in-place amended base decree lineage:
      // Supported ONLY when a bound, verified, in-window amending Royal Decree passage explicitly amends
      // `มาตรา <sec> แห่ง พ.ร.ฎ. (ฉบับที่ <num>)` in place AND `contextText` explicitly pairs `<num>` with
      // that governing amending decree (`พรฎ.<amendNum>`) in an amendment/base-article relationship.
      const amendedBaseLinks = resolveInPlaceAmendedBaseDecreeBindings(nonOutOfWindow).filter(
        (lnk) => lnk.amendedBaseDecreeNum === num
      );
      if (amendedBaseLinks.length > 0) {
        const extractedInCtx = extractNamedAuthoritiesFromText(contextText);
        const pairedWithCitedAmendingDecree = amendedBaseLinks.some((lnk) => {
          const citesGoverningAmendingDecree = extractedInCtx.some(
            (a) => a.kind === "royal_decree" && a.canonicalId === `พรฎ.${lnk.amendingDecreeNum}`
          );
          if (!citesGoverningAmendingDecree) return false;
          return (
            /(?:แก้ไข|แทนที่|ยกเลิกความใน)/.test(normCtx) ||
            new RegExp(
              `มาตรา\\s*${lnk.amendedSectionNum}\\s*แห่ง\\s*(?:พระราชกฤษฎีกา|พ\\.ร\\.ฎ\\.)`
            ).test(normCtx)
          );
        });
        if (pairedWithCitedAmendingDecree) {
          return true;
        }
      }

      // Statutory cross-reference inside verified Revenue Code §50(5)(ข) / §48(4)(ข) (`พระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529`)
      // permitted ONLY when that exact statutory passage is bound AND no RD 165 section number is fabricated!
      if (num === "165") {
        const hasStatutory165CrossRef = nonOutOfWindow.some(
          (p) =>
            (p.work_id === "prov.th.rc.50" || p.work_id === "prov.th.rc.48") &&
            /ฉบับที่\s*165(?![0-9])/.test(thaiDigitsToArabic(p.verbatim_text))
        );
        // A section number is attributed to RD 165 ONLY when written as `มาตรา N แห่ง พ.ร.ฎ. ... 165` or when
        // `มาตรา N` immediately follows the RD 165 citation (optionally its `พ.ศ.` year) with no connector.
        // A Revenue Code section introduced by a connector (`ตามมาตรา 50 (5) (ข)`, `ประกอบมาตรา 48 (4)`,
        // `และมาตรา ...`) or appearing later in the sentence is NOT an RD 165 section (Candidate 8, trc.c33cad106d7d9d).
        const fabricatesRd165Section =
          /มาตรา\s*[0-9]+[^\n]{0,12}แห่ง\s*(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^\n]{0,60}165(?![0-9])/.test(normCtx) ||
          /(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^\n]{0,45}165\s*\)?\s*(?:พ\.ศ\.\s*[0-9]{4}\s*)?,?\s*มาตรา\s*[0-9]/.test(
            normCtx
          );
        if (hasStatutory165CrossRef && !fabricatesRd165Section) {
          return true;
        }
      }

      if (opts?.isEvidenceGapNotice) {
        return nonOutOfWindow.some((p) =>
          new RegExp(`ฉบับที่\\s*${num}(?![0-9])`).test(
            thaiDigitsToArabic(stripCompilerSeeAlsoNotes(p.verbatim_text))
          )
        );
      }
      return false;
    }

    case "ministerial_reg": {
      const num = auth.canonicalId.slice("กฎกระทรวง.".length);
      if (nonOutOfWindow.some((p) => p.work_id === `subreg.th.rc.min_reg.${num}`)) return true;
      if (opts?.isEvidenceGapNotice) {
        return nonOutOfWindow.some((p) =>
          new RegExp(`กฎกระทรวง[^0-9\\n]{0,60}ฉบับที่\\s*${num}(?![0-9])`).test(
            thaiDigitsToArabic(p.verbatim_text)
          )
        );
      }
      return false;
    }

    case "dg_notification": {
      const num = auth.canonicalId.slice("ปอ.".length);
      if (
        nonOutOfWindow.some(
          (p) =>
            p.work_id.startsWith("subreg.th.rd.dg_") &&
            new RegExp(`(?:\\.|ฉบับที่\\s*)${num}(?![0-9])`).test(
              thaiDigitsToArabic(`${p.work_id} ${p.title_th || ""}`)
            )
        )
      ) {
        return true;
      }
      if (opts?.isEvidenceGapNotice) {
        return nonOutOfWindow.some((p) =>
          new RegExp(`ประกาศอธิบดี[^0-9\\n]{0,80}ฉบับที่\\s*${num}(?![0-9])`).test(
            thaiDigitsToArabic(p.verbatim_text)
          )
        );
      }
      return false;
    }

    case "rd_order_tp": {
      const xyRaw = auth.canonicalId.slice("ทป.".length);
      const xy = xyRaw.replace("/", "_");
      return nonOutOfWindow.some(
        (p) =>
          p.work_id === `subreg.th.rd.order_tp.${xy}` ||
          (!p.work_id.startsWith("prov.th.rc.") &&
            new RegExp(`ท\\.ป\\.\\s*${xyRaw.replace("/", "\\/")}(?![0-9])`).test(
              thaiDigitsToArabic(p.verbatim_text)
            ))
      );
    }

    case "rd_order_p": {
      // Never allow compiler `( ดูคำสั่งกรมสรรพากร ที่ ป.119/2545 )` header notes inside Revenue Code sections
      // to masquerade as verified Departmental Order passages!
      const xyRaw = auth.canonicalId.slice("ป.".length);
      const xy = xyRaw.replace("/", "_");
      return nonOutOfWindow.some(
        (p) =>
          p.work_id === `subreg.th.rd.order_p.${xy}` ||
          (!p.work_id.startsWith("prov.th.rc.") &&
            new RegExp(`ที่\\s*ป\\.\\s*${xyRaw.replace("/", "\\/")}(?![0-9])`).test(
              thaiDigitsToArabic(p.verbatim_text)
            ))
      );
    }

    case "dika_judgment": {
      const xy = auth.canonicalId.slice("ฎีกา.".length);
      return nonOutOfWindow.some(
        (p) =>
          (p.work_type === "SupremeCourtJudgment" || p.work_id.includes("dika")) &&
          thaiDigitsToArabic(`${p.official_identifier || ""} ${p.title_th || ""} ${p.verbatim_text}`).includes(xy)
      );
    }

    case "amending_act": {
      const num = auth.canonicalId.slice("พรบแก้ไข.".length);
      return nonOutOfWindow.some(
        (p) =>
          p.work_id.startsWith(`statute.th.rc_amendment_${num}_`) ||
          new RegExp(
            `(?:พระราชบัญญัติ|พ\\.ร\\.บ\\.|พระราชกำหนด|พ\\.ร\\.ก\\.)\\s*แก้ไขเพิ่มเติม[^)\\n]{0,65}ฉบับที่\\s*${num}(?![0-9])`
          ).test(thaiDigitsToArabic(`${p.title_th || ""} ${p.verbatim_text}`))
      );
    }

    case "section": {
      const combinedNorm = normalizeCompactForSectionLookup(
        nonOutOfWindow
          .map(
            (p) =>
              `${p.official_identifier || ""} ${p.title_th || ""} ${p.pinpoint || ""} ${p.verbatim_text}`
          )
          .join(" \n ")
      );
      const sec = auth.canonicalId;
      const subClauseMatch = /^มาตรา\s*([0-9/]+(?:\s*[ก-๙]+)?)\s*\(([0-9]{1,2}(?:\/[0-9]+)?)\)$/.exec(sec);
      if (subClauseMatch) {
        const baseNum = subClauseMatch[1].replace(/\//g, "\\/").replace(/\s+/g, "\\s*");
        const subNum = subClauseMatch[2].replace(/\//g, "\\/");
        return (
          new RegExp(`(?:มาตรา|ข้อ)\\s*${baseNum}\\s*\\(${subNum}\\)`).test(combinedNorm) ||
          (new RegExp(`(?:มาตรา|ข้อ)\\s*${baseNum}(?![0-9/])`).test(combinedNorm) &&
            combinedNorm.includes(`(${subClauseMatch[2]})`))
        );
      }
      const bareSecNum = sec.replace(/^มาตรา\s*/, "").replace(/\//g, "\\/").replace(/\s+/g, "\\s*");
      return (
        combinedNorm.includes(sec) ||
        new RegExp(`(?:มาตรา|ข้อ)\\s*${bareSecNum}(?![0-9/])`).test(combinedNorm)
      );
    }
  }
}

export function findUnsupportedAuthoritiesInText(
  rawText: string,
  verifiedPassages: VerifiedAuthorityPassageBinding[],
  opts?: AuthorityAuditOptions
): ExtractedNamedAuthority[] {
  const all = extractNamedAuthoritiesFromText(rawText);
  return all.filter(
    (auth) => !isNamedAuthoritySupportedByPassages(auth, verifiedPassages, rawText, opts)
  );
}

/**
 * Cleans incidental surfaces (`authority_distinction_note_th`, `issue_title_th` parentheticals,
 * `overall_summary_th`, `assumptions_th`, `missing_facts_or_uncertainties_th`, `evidence_gaps_th`,
 * `case_facts_used`) by removing any parenthetical, comparison clause, or sentence that names an
 * unverified authority, while preserving clean independently supported surrounding text.
 */
export function sanitizeIncidentalSurfaceText(
  rawText: string,
  verifiedPassages: VerifiedAuthorityPassageBinding[],
  opts?: AuthorityAuditOptions
): { cleanedText: string; removedAuthorities: string[] } {
  if (!rawText || !rawText.trim()) {
    return { cleanedText: "", removedAuthorities: [] };
  }
  const initialUnsupported = findUnsupportedAuthoritiesInText(rawText, verifiedPassages, opts);
  if (initialUnsupported.length === 0) {
    return { cleanedText: rawText.trim(), removedAuthorities: [] };
  }

  const removed = new Set<string>(initialUnsupported.map((u) => u.canonicalId));
  let working = rawText;

  // Step 1: Strip Markdown links `[label](url)` whose label or URL references an unsupported authority
  working = working.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, label: string, url: string) => {
    const unsup = findUnsupportedAuthoritiesInText(`${label} ${url}`, verifiedPassages, opts);
    if (unsup.length === 0) return full;
    // Leave empty if label itself is an unsupported authority; otherwise keep plain text for clause-level check
    const labelUnsup = findUnsupportedAuthoritiesInText(label, verifiedPassages, opts);
    return labelUnsup.length > 0 ? "" : label;
  });

  // Step 2: Strip parenthetical remarks `(...)` that contain any unsupported authority
  let prev = "";
  while (prev !== working) {
    prev = working;
    working = working.replace(/\s*\(([^()]{1,280})\)/g, (full, inner: string) => {
      const unsup = findUnsupportedAuthoritiesInText(inner, verifiedPassages, opts);
      return unsup.length > 0 ? "" : full;
    });
  }

  // Step 3: Split into discourse clauses/sentences (`ทั้งนี้`, `อนึ่ง`, `ส่วนกรณีตาม`, `อย่างไรก็ตาม`, `;`, `\n`)
  // and drop any clause that still depends on an unsupported authority!
  if (findUnsupportedAuthoritiesInText(working, verifiedPassages, opts).length > 0) {
    const lines = working.split(/\n+/);
    const keptLines: string[] = [];
    for (const line of lines) {
      const segments = line
        .split(
          /(?=\s*(?:ทั้งนี้|อนึ่ง|นอกจากนี้|อีกทั้ง|ส่วนกรณีตาม|สำหรับ(?:รายละเอียด|หลักเกณฑ์เพิ่มเติม)ตาม|อย่างไรก็ตาม|อย่างไรก็ดี|หมายเหตุ:?|เปรียบเทียบกับ|ต่างจากแนว)\s+)|(?<=;\s*)/u
        )
        .map((s) => s.trim())
        .filter(Boolean);
      const cleanSegs = segments.filter(
        (seg) => findUnsupportedAuthoritiesInText(seg, verifiedPassages, opts).length === 0
      );
      if (cleanSegs.length > 0) {
        keptLines.push(
          cleanSegs
            .join(" ")
            .replace(/;\s*$/g, "")
            .replace(/\s{2,}/g, " ")
            .trim()
        );
      }
    }
    working = keptLines.join("\n").trim();
  }

  // Step 4: Final hard guarantee — if any unsupported authority STILL remains, return empty string.
  if (findUnsupportedAuthoritiesInText(working, verifiedPassages, opts).length > 0) {
    return { cleanedText: "", removedAuthorities: Array.from(removed) };
  }

  const cleaned = working
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:[,;]|และ|หรือ)\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { cleanedText: cleaned, removedAuthorities: Array.from(removed) };
}

/**
 * Audits essential issue surfaces (`conclusion_th` & `application_explanation_th`):
 * - If all named authorities are verified -> `{ ok: true, cleanedText }`.
 * - If an unverified authority appears ONLY in an incidental parenthetical (`(ต่างจาก...)`) or
 *   trailing comparison note (`ทั้งนี้ หนังสือตอบข้อหารือ...`), and the core proposition remains
 *   independently supported by >= 1 verified authority (when authorities were cited), strips the
 *   incidental clause and keeps the issue.
 * - If the operative proposition itself relies on an unverified authority (e.g. `ตามพระราชกฤษฎีกา (ฉบับที่ 555) มาตรา 4`),
 *   returns `{ ok: false }` so ONLY that issue is withheld!
 */
export function auditEssentialIssueSurfaceText(
  rawText: string,
  verifiedPassages: VerifiedAuthorityPassageBinding[],
  opts?: AuthorityAuditOptions
): {
  ok: boolean;
  cleanedText: string;
  unsupportedAuthorities: string[];
} {
  const initialUnsup = findUnsupportedAuthoritiesInText(rawText, verifiedPassages, opts);
  if (initialUnsup.length === 0) {
    return { ok: true, cleanedText: rawText, unsupportedAuthorities: [] };
  }

  // Attempt stripping strictly incidental parentheticals `(เปรียบเทียบ... / ต่างจาก... / เดิมตาม...)`
  // and trailing `ทั้งนี้ ... / อนึ่ง ...` comparison notes — NEVER strip operative `ตาม <authority>` clauses!
  let candidate = rawText.replace(
    /\s*\((?:เปรียบเทียบ|ต่างจาก|เดิมตาม|ไม่เหมือน|สอดคล้องกับแนวเดิม|หมายเหตุ)[^()]{0,240}\)/gu,
    ""
  );
  const trailingParts = candidate.split(/(?=\s*(?:ทั้งนี้|อนึ่ง)\s+)/u);
  if (trailingParts.length > 1) {
    const keptParts = [trailingParts[0]];
    for (let i = 1; i < trailingParts.length; i++) {
      if (findUnsupportedAuthoritiesInText(trailingParts[i], verifiedPassages, opts).length === 0) {
        keptParts.push(trailingParts[i]);
      }
    }
    candidate = keptParts.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  const remainingUnsup = findUnsupportedAuthoritiesInText(candidate, verifiedPassages, opts);
  if (remainingUnsup.length > 0 || candidate.trim().length < 16) {
    return {
      ok: false,
      cleanedText: rawText,
      unsupportedAuthorities: initialUnsup.map((u) => u.canonicalId),
    };
  }

  return {
    ok: true,
    cleanedText: candidate.trim(),
    unsupportedAuthorities: initialUnsup.map((u) => u.canonicalId),
  };
}

/**
 * Redacts unverified authority numbers/URLs from public rejection/coverage diagnostic strings so
 * a rejected ruling or decree number is NEVER echoed back onto public API/UI surfaces!
 */
export function redactAuthorityIdentifiersFromPublicDiagnosticTh(rawReason: string): string {
  return (rawReason || "")
    .replace(
      /(?:กค\.?|gor\s*kor\.?|gk)\s*[0-9๐-๙]{2,5}(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮa-zA-Z.]+\s*\/?\s*)?[0-9๐-๙ก-๙a-zA-Z]+/gi,
      "[เลขที่หนังสือหารือถูกระงับ]"
    )
    .replace(/(?:https?:\/\/)?(?:www\.)?rd\.go\.th\/[0-9]+\.html/gi, "[ลิงก์ที่ไม่มีหลักฐานรับรองถูกระงับ]")
    .replace(
      /\(\s*(?:พรฎ|กฎกระทรวง|ปอ|ทป|ป|ฎีกา|พรบแก้ไข)\.[0-9/]+\s*\)/gi,
      "([แหล่งอ้างอิงที่ไม่มีหลักฐานรับรองถูกระงับ])"
    )
    .replace(/ฉบับที่\s*[0-9๐-๙]+/g, "ฉบับที่ [ระงับ]")
    .replace(/(?:ท\.ป\.|ที่\s*ป\.|ฎีกาที่)\s*[0-9๐-๙]+\/[0-9๐-๙]+/g, "[เลขที่เอกสารอ้างอิงถูกระงับ]")
    .replace(/"มาตรา\s*[^"]+"/g, '"[เลขมาตราที่ไม่มีหลักฐานรองรับถูกระงับ]"');
}
