/**
 * REG24 — Structured Case Fact Ledger (Requirement 1.1: Preserve Case Facts)
 *
 * Preserves the user's exact original facts alongside normalized legal categories without
 * substituting template nouns (e.g., a condo stays "ห้องชุด" while classified as immovable
 * property; an explicit nephew stays "หลานชาย" and never becomes "หลานสาว").
 *
 * Tracks:
 * - Turn-by-turn fact attribution (`source_turn`) from user turns only (never assistant prose)
 * - Explicit follow-up overrides (`overrides`) when a later turn changes a party, asset, place, or date
 * - Clean slate on a new question (empty `conversation_history` -> zero carried dates or facts)
 * - Three-way date distinction: transaction/event dates vs. legal as-of date vs. controlling tax point
 */

import type { ConversationTurnInput } from "./contracts";
import { thaiDigitsToArabic } from "./identity";
import { stripNegatedFactualClauses } from "./legal-issue-fact-analyzer";
import { parseFlexibleThaiOrEnglishDateToIso } from "./temporal-versioning";

export type TemporalEventKind =
  | "REGISTRATION"
  | "TRANSFER"
  | "INVOICE"
  | "PAYMENT"
  | "SERVICE_USE"
  | "ACCOUNTING_PERIOD_START"
  | "QUESTION_DATE"
  | "STATED_TRANSACTION_DATE";

export interface PreservedMaterialFact {
  fact_key: string;
  label_th: string;
  original_text_th: string;
  normalized_category: string;
  source_turn: number;
  overridden_from?: {
    previous_text_th: string;
    previous_category: string;
    previous_turn: number;
  } | null;
}

export interface PreservedTemporalEvent {
  event_type: TemporalEventKind;
  raw_text: string;
  iso_date: string;
  source_turn: number;
}

export interface StructuredCaseFactLedger {
  turn_count: number;
  is_new_conversation: boolean;
  user_turns: Array<{
    turn_number: number;
    raw_text: string;
    cleaned_active_text: string;
    explicit_applicable_date: string | null;
  }>;
  material_facts: PreservedMaterialFact[];
  overrides: Array<{
    fact_key: string;
    from_text_th: string;
    from_turn: number;
    to_text_th: string;
    to_turn: number;
  }>;
  temporal_facts: {
    transaction_or_event_dates: PreservedTemporalEvent[];
    legal_as_of_date: string | null;
    controlling_tax_point: {
      iso_date: string | null;
      controlling_event: string | null;
      statutory_rule_hint: string | null;
      is_ambiguous: boolean;
      ambiguity_reason_th: string | null;
    };
  };
  explicitly_unknown_facts_th: string[];
  questions_asked_th: string[];
  fact_preservation_guards: {
    asset_original_noun_th: string | null;
    forbid_land_substitution: boolean;
    recipient_original_noun_th: string | null;
    forbid_niece_substitution: boolean;
    recipient_kinship_category: string | null;
    is_ambiguous_lan_sao: boolean;
  };
}

const THAI_MONTH_REGEX_SRC =
  "(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)";

function extractDatesWithEventKinds(
  cleanedText: string,
  turnNumber: number
): PreservedTemporalEvent[] {
  const norm = thaiDigitsToArabic(cleanedText);
  const events: PreservedTemporalEvent[] = [];
  const seen = new Set<string>();

  const datePattern = new RegExp(
    `(\\d{1,2}\\s*${THAI_MONTH_REGEX_SRC}\\s*\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?\\s+\\d{4})`,
    "gi"
  );

  for (const m of norm.matchAll(datePattern)) {
    const rawDate = m[1].trim();
    const iso = parseFlexibleThaiOrEnglishDateToIso(rawDate);
    if (!iso) continue;
    const idx = m.index ?? 0;
    const leftCtx = norm.slice(Math.max(0, idx - 65), idx);
    const rightCtx = norm.slice(idx + rawDate.length, idx + rawDate.length + 35);
    const ctx = `${leftCtx} ${rightCtx}`;

    const matchedKinds: TemporalEventKind[] = [];
    if (/จดทะเบียน|โอนกรรมสิทธิ์/.test(leftCtx)) matchedKinds.push("REGISTRATION");
    if (/(?:ได้รับชำระ|รับชำระ|รับเงิน|ชำระเงิน|ชำระค่าบริการ|จ่ายเงิน)/.test(leftCtx)) {
      matchedKinds.push("PAYMENT");
    }
    if (/(?:ออกใบกำกับภาษี|ออกใบกำกับ|ใบกำกับภาษี|ออกใบแจ้งหนี้|ใบแจ้งหนี้)/.test(leftCtx)) {
      matchedKinds.push("INVOICE");
    }
    if (/(?:ใช้บริการ|เริ่มใช้บริการ|ส่งมอบบริการ|ให้บริการ|ให้บริการเสร็จ)/.test(leftCtx)) {
      matchedKinds.push("SERVICE_USE");
    }
    if (/รอบระยะเวลาบัญชี|รอบบัญชี/.test(ctx)) {
      matchedKinds.push("ACCOUNTING_PERIOD_START");
    }
    if (/(?:ถามเมื่อ|วันที่ถาม|สอบถามเมื่อ|ณ\s*วันที่ถาม)/.test(leftCtx)) {
      matchedKinds.push("QUESTION_DATE");
    }
    if (matchedKinds.length === 0) {
      if (/(?:โอน|ยก|ให้|ขาย|ซื้อ)/.test(leftCtx)) {
        matchedKinds.push("TRANSFER");
      } else {
        matchedKinds.push("STATED_TRANSACTION_DATE");
      }
    }

    for (const kind of matchedKinds) {
      const dedupKey = `${turnNumber}:${kind}:${iso}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      events.push({
        event_type: kind,
        raw_text: rawDate,
        iso_date: iso,
        source_turn: turnNumber,
      });
    }
  }

  return events;
}

function upsertFact(
  factsMap: Map<string, PreservedMaterialFact>,
  overrides: StructuredCaseFactLedger["overrides"],
  next: Omit<PreservedMaterialFact, "overridden_from">
): void {
  const existing = factsMap.get(next.fact_key);
  if (
    existing &&
    (existing.normalized_category !== next.normalized_category ||
      existing.original_text_th !== next.original_text_th)
  ) {
    if (existing.source_turn !== next.source_turn) {
      overrides.push({
        fact_key: next.fact_key,
        from_text_th: existing.original_text_th,
        from_turn: existing.source_turn,
        to_text_th: next.original_text_th,
        to_turn: next.source_turn,
      });
    }
    factsMap.set(next.fact_key, {
      ...next,
      overridden_from: {
        previous_text_th: existing.original_text_th,
        previous_category: existing.normalized_category,
        previous_turn: existing.source_turn,
      },
    });
    return;
  }
  factsMap.set(next.fact_key, { ...next, overridden_from: existing?.overridden_from ?? null });
}

function extractAmountsForTurn(
  cleanedText: string,
  turnNumber: number,
  factsMap: Map<string, PreservedMaterialFact>,
  overrides: StructuredCaseFactLedger["overrides"]
): void {
  const norm = thaiDigitsToArabic(cleanedText);
  const re =
    /([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท)/g;

  for (const m of norm.matchAll(re)) {
    const rawSpan = m[0].trim();
    const numVal = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(numVal)) continue;
    const thb = m[2] === "ล้านบาท" ? numVal * 1_000_000 : numVal;
    const idx = m.index ?? 0;
    const leftCtx = norm.slice(Math.max(0, idx - 80), idx);

    if (/ราคาประเมินทุนทรัพย์|ราคาประเมิน(?:ของทางราชการ)?/.test(leftCtx)) {
      upsertFact(factsMap, overrides, {
        fact_key: "appraised_value_thb",
        label_th: "ราคาประเมินทุนทรัพย์ของทางราชการ",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `OFFICIAL_APPRAISED_VALUE_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    } else if (/หนังสือสัญญา|ระบุมูลค่า|ราคาซื้อขาย|ราคาตลาด|ตกลงกันว่า/.test(leftCtx)) {
      upsertFact(factsMap, overrides, {
        fact_key: "stated_deed_or_agreed_value_thb",
        label_th: "มูลค่าตามสัญญาหรือราคาที่ตกลงกัน (มิใช่ราคาประเมินทางราชการ)",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `STATED_OR_AGREED_VALUE_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    } else if (/ค่าบริการ|ค่าจ้าง|ค่าตอบแทน|ราคาสินค้า/.test(leftCtx)) {
      upsertFact(factsMap, overrides, {
        fact_key: "service_or_sale_consideration_thb",
        label_th: "มูลค่าค่าบริการหรือราคาขาย",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `CONSIDERATION_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    } else {
      upsertFact(factsMap, overrides, {
        fact_key: "stated_asset_value_thb",
        label_th: "มูลค่าทรัพย์สินที่ระบุในข้อเท็จจริง",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `STATED_VALUE_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    }
  }
}

export function buildStructuredCaseFactLedger(input: {
  question: string;
  applicableDate?: string | null;
  conversationHistory?: ConversationTurnInput[];
}): StructuredCaseFactLedger {
  // Strictly read ONLY user turns from conversation_history — never assistant prose or assistant rulings!
  const priorUserTurns = (input.conversationHistory || [])
    .filter((t) => t && t.role === "user" && typeof t.content === "string" && t.content.trim().length > 0)
    .map((t) => ({
      raw_text: t.content.trim(),
      explicit_applicable_date: t.applicable_date ?? null,
    }));

  const allUserTurns = [
    ...priorUserTurns,
    {
      raw_text: input.question.trim(),
      explicit_applicable_date: input.applicableDate ?? null,
    },
  ];

  const isNewConversation = priorUserTurns.length === 0;
  const factsMap = new Map<string, PreservedMaterialFact>();
  const overrides: StructuredCaseFactLedger["overrides"] = [];
  const allTemporalEvents: PreservedTemporalEvent[] = [];
  const unknownFacts = new Set<string>();
  const questionsAsked: string[] = [];

  let assetOriginalNounTh: string | null = null;
  let forbidLandSubstitution = false;
  let recipientOriginalNounTh: string | null = null;
  let forbidNieceSubstitution = false;
  let recipientKinshipCategory: string | null = null;
  let isAmbiguousLanSao = false;

  const userTurnsOut: StructuredCaseFactLedger["user_turns"] = [];

  for (let i = 0; i < allUserTurns.length; i++) {
    const turnNumber = i + 1;
    const raw = allUserTurns[i].raw_text;
    const cleaned = stripNegatedFactualClauses(raw);
    const norm = thaiDigitsToArabic(cleaned);
    userTurnsOut.push({
      turn_number: turnNumber,
      raw_text: raw,
      cleaned_active_text: cleaned,
      explicit_applicable_date: allUserTurns[i].explicit_applicable_date,
    });

    // 1. Asset extraction (preserving exact noun alongside legal category — stop cleanly at phrase boundaries!)
    if (/ห้องชุด|คอนโดมิเนียม|คอนโด/.test(norm)) {
      const m = norm.match(/(ห้องชุด(?:ใน[^\s,.;]+)?|คอนโดมิเนียม(?:ใน[^\s,.;]+)?|คอนโด(?:ใน[^\s,.;]+)?)/);
      const rawAsset = m ? m[1].replace(/(?:หนึ่งห้อง)?ให้แก่.*$/, "หนึ่งห้อง").trim() : "ห้องชุด";
      assetOriginalNounTh = rawAsset || "ห้องชุด";
      forbidLandSubstitution = !/ที่ดิน/.test(norm);
      upsertFact(factsMap, overrides, {
        fact_key: "asset",
        label_th: "ทรัพย์สินที่โอน",
        original_text_th: assetOriginalNounTh,
        normalized_category: "IMMOVABLE_PROPERTY_CONDOMINIUM_UNIT",
        source_turn: turnNumber,
      });
    } else if (/อาคารพาณิชย์พร้อมที่ดิน|อาคารพาณิชย์|บ้านพร้อมที่ดิน|ทาวน์เฮาส์/.test(norm)) {
      const m = norm.match(/(อาคารพาณิชย์พร้อมที่ดิน|อาคารพาณิชย์|บ้านพร้อมที่ดิน|ทาวน์เฮาส์)/);
      assetOriginalNounTh = m ? m[1] : "อาคารพร้อมที่ดิน";
      forbidLandSubstitution = false;
      upsertFact(factsMap, overrides, {
        fact_key: "asset",
        label_th: "ทรัพย์สินที่โอน",
        original_text_th: assetOriginalNounTh,
        normalized_category: "IMMOVABLE_PROPERTY_BUILDING_AND_LAND",
        source_turn: turnNumber,
      });
    } else if (/ที่ดิน|อสังหาริมทรัพย์/.test(norm)) {
      const m = norm.match(/(ที่ดินแปลง[^\s,.;]{0,20}|ที่ดินสองแปลง|ที่ดิน|อสังหาริมทรัพย์)/);
      assetOriginalNounTh = m ? m[1] : "ที่ดิน";
      forbidLandSubstitution = false;
      upsertFact(factsMap, overrides, {
        fact_key: "asset",
        label_th: "ทรัพย์สินที่โอน",
        original_text_th: assetOriginalNounTh,
        normalized_category: "IMMOVABLE_PROPERTY_LAND",
        source_turn: turnNumber,
      });
    } else if (/เงินสด|โอนเงิน|เงินโอน|สังหาริมทรัพย์|หุ้น/.test(norm)) {
      const m = norm.match(/(เงินสด|เงินโอน|สังหาริมทรัพย์|หุ้น[^\s,.;]{0,15})/);
      assetOriginalNounTh = m ? m[1] : "เงินสด/สังหาริมทรัพย์";
      forbidLandSubstitution = true;
      upsertFact(factsMap, overrides, {
        fact_key: "asset",
        label_th: "ทรัพย์สินที่โอน",
        original_text_th: assetOriginalNounTh,
        normalized_category: "MOVABLE_PROPERTY_CASH_OR_OTHER",
        source_turn: turnNumber,
      });
    }

    // 2. Marital co-ownership (สินสมรส)
    if (/สินสมรส|ซื้อ[^\n]{0,30}ร่วมกันระหว่างสมรส|สามีภริยาที่จดทะเบียนสมรส/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "ownership_regime",
        label_th: "กรรมสิทธิ์ในทรัพย์สิน",
        original_text_th: "สินสมรสของสามีภริยาที่จดทะเบียนสมรส (ถือกรรมสิทธิ์ร่วมกัน)",
        normalized_category: "MARITAL_COMMUNITY_PROPERTY_CO_OWNED_SIN_SOMROT",
        source_turn: turnNumber,
      });
    }

    // 3. Recipient & Kinship extraction (preserving exact noun & gender, never guessing ambiguous หลานสาว)
    if (/(?:บุตรชายของน้องสาว|บุตรชายของน้องชาย|บุตรชายของพี่สาว|บุตรชายของพี่ชาย|ลูกชายของน้อง|ลูกชายของพี่)/.test(norm)) {
      const m = norm.match(/((?:นาย|ด\.ช\.)[ก-๙]+\s*ซึ่งเป็นหลานชาย\s*\([^)]+\)|หลานชาย\s*\([^)]+\)|บุตรชายของ(?:น้อง|พี่)(?:สาว|ชาย)[^\s,.;)]*)/);
      recipientOriginalNounTh = m ? m[1].trim() : "หลานชาย (บุตรของพี่น้อง)";
      forbidNieceSubstitution = true;
      recipientKinshipCategory = "COLLATERAL_NEPHEW_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/(?:บุตรสาวของน้องชาย|บุตรสาวของน้องสาว|บุตรสาวของพี่ชาย|บุตรสาวของพี่สาว|ลูกสาวของน้อง|ลูกสาวของพี่)/.test(norm)) {
      const m = norm.match(/((?:นางสาว|นาง|ด\.ญ\.)?[ก-๙]+\s*ซึ่งเป็นหลานสาว\s*\([^)]+\)|หลานสาว\s*\([^)]+\)|บุตรสาวของ(?:น้อง|พี่)(?:ชาย|สาว)[^\s,.;)]*)/);
      recipientOriginalNounTh = m ? m[1].trim() : "หลานสาว (บุตรของพี่น้อง)";
      forbidNieceSubstitution = false;
      recipientKinshipCategory = "COLLATERAL_NIECE_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/(?:บุตรสาวของบุตรชาย|บุตรสาวของบุตรสาว|บุตรชายของบุตรชาย|บุตรชายของบุตรสาว|หลานสายตรง|ปู่กับย่า|ตากับยาย)/.test(norm)) {
      const isMale = /หลานชาย|บุตรชายของบุตร/.test(norm);
      const m = norm.match(/((?:นางสาว|นาย)?[ก-๙]+\s*ซึ่งเป็นหลาน(?:สาว|ชาย)\s*\([^)]+\)|หลาน(?:สาว|ชาย)\s*\([^)]+\))/);
      recipientOriginalNounTh = m ? m[1].trim() : isMale ? "หลานชาย (ผู้สืบสันดาน)" : "หลานสาว (ผู้สืบสันดาน)";
      forbidNieceSubstitution = isMale;
      recipientKinshipCategory = isMale
        ? "LINEAL_GRANDSON_DESCENDANT_NOT_LEGITIMATE_CHILD"
        : "LINEAL_GRANDDAUGHTER_DESCENDANT_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/หลานชาย/.test(norm)) {
      recipientOriginalNounTh = "หลานชาย (ยังไม่ระบุว่าเป็นผู้สืบสันดานหรือบุตรของพี่น้อง)";
      forbidNieceSubstitution = true;
      recipientKinshipCategory = "AMBIGUOUS_GRANDSON_OR_NEPHEW_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/หลานสาว/.test(norm)) {
      recipientOriginalNounTh = "หลานสาว (ยังไม่ระบุว่าเป็นบุตรของบุตร [ผู้สืบสันดาน] หรือบุตรของพี่น้อง [ญาติสายข้าง])";
      forbidNieceSubstitution = false;
      recipientKinshipCategory = "AMBIGUOUS_GRANDDAUGHTER_OR_NIECE_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = true;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/บุตรชอบด้วยกฎหมาย/.test(norm)) {
      recipientOriginalNounTh = "บุตรชอบด้วยกฎหมาย (มิใช่บุตรบุญธรรม)";
      forbidNieceSubstitution = true;
      recipientKinshipCategory = "LEGITIMATE_CHILD_NON_ADOPTED";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    }

    // 4. Transfer consideration & occasion
    if (/โดยไม่มีค่าตอบแทน|โดยเสน่หาไม่มีค่าตอบแทน|ยก[^\n]{0,25}ให้/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "consideration_type",
        label_th: "ลักษณะการโอน",
        original_text_th: /โดยเสน่หา/.test(norm) ? "การให้โดยเสน่หาไม่มีค่าตอบแทน" : "การโอนโดยไม่มีค่าตอบแทน",
        normalized_category: "GRATUITOUS_TRANSFER_NO_CONSIDERATION",
        source_turn: turnNumber,
      });
    }
    if (/ไม่ได้เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณี|มิใช่[^\n]{0,20}ประเพณี/.test(raw)) {
      upsertFact(factsMap, overrides, {
        fact_key: "customary_occasion",
        label_th: "พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี",
        original_text_th: "ไม่ได้เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณีใด",
        normalized_category: "NOT_CUSTOMARY_OCCASION",
        source_turn: turnNumber,
      });
    } else if (/งานสมรสตามประเพณี|พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี|อุปการะ/.test(norm)) {
      const m = norm.match(/(งานสมรสตามประเพณี|พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี|อุปการะ[^\s,.;]{0,20})/);
      upsertFact(factsMap, overrides, {
        fact_key: "customary_occasion",
        label_th: "พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี",
        original_text_th: m ? m[1] : "พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี",
        normalized_category: "CUSTOMARY_OR_MORAL_OCCASION",
        source_turn: turnNumber,
      });
    }

    // 5. VAT Transaction Nature & Place of Use
    if (/ส่งออกสินค้า|ส่งสินค้าออกนอกราชอาณาจักร|ส่งออกรองเท้า/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "vat_transaction_type",
        label_th: "ประเภทธุรกรรมภาษีมูลค่าเพิ่ม",
        original_text_th: "การส่งออกสินค้าออกนอกราชอาณาจักร",
        normalized_category: "VAT_EXPORT_OF_GOODS",
        source_turn: turnNumber,
      });
    } else if (/ให้บริการ|ค่าบริการ|บำรุงรักษาซอฟต์แวร์|ที่ปรึกษา|ออกแบบระบบ/.test(norm)) {
      const m = norm.match(/(ให้บริการ[^\n,.?]{0,80}?(?=\s+แก่|\s+ซึ่ง|\s+โดย|$)|บำรุงรักษาซอฟต์แวร์[^\n,.?]{0,40}?(?=\s+แก่|\s+จาก|$))/);
      upsertFact(factsMap, overrides, {
        fact_key: "vat_transaction_type",
        label_th: "ประเภทธุรกรรมภาษีมูลค่าเพิ่ม",
        original_text_th: m ? m[1].trim() : "การให้บริการในราชอาณาจักร",
        normalized_category: "VAT_PROVISION_OF_SERVICE",
        source_turn: turnNumber,
      });
    }

    if (/(?:ใช้บริการ(?:นั้น)?(?:ทั้งหมด)?ในประเทศไทย|ใช้ที่สาขากรุงเทพฯ|ใช้ในประเทศไทย|ใช้บริการทั้งหมดในราชอาณาจักร|ลูกค้าในกรุงเทพมหานคร|ลูกค้าในประเทศไทย)/.test(norm)) {
      const m = norm.match(/(ใช้ที่สาขากรุงเทพฯ[^\n,.?]{0,30}|ใช้บริการ(?:นั้น)?(?:ทั้งหมด)?ใน(?:ประเทศไทย|ราชอาณาจักร)|ลูกค้าใน(?:กรุงเทพมหานคร|ประเทศไทย))/);
      upsertFact(factsMap, overrides, {
        fact_key: "vat_place_of_use",
        label_th: "สถานที่ที่มีการใช้บริการ",
        original_text_th: m ? m[1].trim() : "ใช้บริการในประเทศไทย",
        normalized_category: "SERVICE_USED_IN_THAILAND_DOMESTIC",
        source_turn: turnNumber,
      });
    } else if (/(?:ใช้บริการ(?:นั้น)?(?:ทั้งหมด)?(?:ที่สำนักงาน)?ใน(?:ต่างประเทศ|สิงคโปร์|ญี่ปุ่น|ฮ่องกง|สหรัฐอเมริกา|ยุโรป|ออสเตรเลีย|มาเลเซีย|เวียดนาม|อังกฤษ|เยอรมนี)|ใช้ในต่างประเทศทั้งหมด)/.test(norm)) {
      const m = norm.match(/(ใช้บริการ(?:นั้น)?(?:ทั้งหมด)?(?:ที่สำนักงาน)?ใน[^\n,.?]{0,30}|ใช้ในต่างประเทศทั้งหมด)/);
      upsertFact(factsMap, overrides, {
        fact_key: "vat_place_of_use",
        label_th: "สถานที่ที่มีการใช้บริการ",
        original_text_th: m ? m[1].trim() : "ใช้บริการทั้งหมดในต่างประเทศ",
        normalized_category: "SERVICE_USED_ENTIRELY_ABROAD_EXPORT",
        source_turn: turnNumber,
      });
    }

    if (/ผู้ประกอบการจดทะเบียน\s*(?:VAT|ภาษีมูลค่าเพิ่ม)/i.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "vat_registrant_status",
        label_th: "สถานะผู้ประกอบการจดทะเบียน VAT",
        original_text_th: "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย",
        normalized_category: "THAI_VAT_REGISTERED_OPERATOR",
        source_turn: turnNumber,
      });
    }

    // 6. Amounts
    extractAmountsForTurn(cleaned, turnNumber, factsMap, overrides);

    // 7. Temporal events
    const turnDates = extractDatesWithEventKinds(cleaned, turnNumber);
    allTemporalEvents.push(...turnDates);

    // 8. Explicitly stated unknown facts
    const unknownMatches =
      thaiDigitsToArabic(raw).match(
        /(?:ยังไม่ทราบ(?:ว่า)?|ไม่ทราบ(?:ว่า)?|โดยไม่ระบุ(?:ว่า)?|ไม่ระบุ(?:ว่า)?|ยังไม่ชัดเจน(?:ว่า)?|ไม่มีข้อมูล(?:เรื่อง|ว่า)?)([^?。\n]+)/g
      ) || [];
    for (const um of unknownMatches) {
      unknownFacts.add(um.trim());
    }
  }

  // Extract questions asked on the final (active) turn
  const activeTurnRaw = allUserTurns[allUserTurns.length - 1].raw_text;
  const qParts = activeTurnRaw
    .split(/(?<=[?？])|\s+(?=และ(?:ต้อง|หลาน|ส่วน|ผู้|ภาระ))/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && /(?:อย่างไร|เท่าใด|เท่าไหร่|หรือไม่|หรือ|ใช่หรือไม่|ร้อยละ|ต้องเสีย|ต้องหัก|ผลจะเป็น)/.test(s));
  if (qParts.length > 0) {
    questionsAsked.push(...qParts);
  } else {
    questionsAsked.push(activeTurnRaw);
  }

  // Three-way temporal resolution:
  // 1) transaction_or_event_dates (all dated events across turns, keeping latest turn override if same event_type)
  // 2) legal_as_of_date (explicit req.applicableDate only — never silently fabricated!)
  // 3) controlling_tax_point (derived strictly from statutory event rules without guessing when ambiguous!)
  const legalAsOfDate = input.applicableDate ?? null;

  const isVatCase = factsMap.has("vat_transaction_type") || /ภาษีมูลค่าเพิ่ม|VAT/i.test(allUserTurns.map((t) => t.raw_text).join(" "));
  const nonQuestionDates = allTemporalEvents.filter((e) => e.event_type !== "QUESTION_DATE");
  const latestTurnNumber = allUserTurns.length;
  const latestTurnNonQuestionDates = nonQuestionDates.filter((e) => e.source_turn === latestTurnNumber);

  let controllingIso: string | null = null;
  let controllingEvent: string | null = null;
  let statutoryRuleHint: string | null = null;
  let isAmbiguous = false;
  let ambiguityReasonTh: string | null = null;

  if (isVatCase && factsMap.get("vat_transaction_type")?.normalized_category === "VAT_PROVISION_OF_SERVICE") {
    // Under Revenue Code §78/1(1), service VAT tax point is the EARLIEST of:
    // payment received, tax invoice issued, or use of service.
    const activeServiceEvents =
      latestTurnNonQuestionDates.length > 0 ? latestTurnNonQuestionDates : nonQuestionDates;
    const taxPointCandidates = activeServiceEvents.filter(
      (e) =>
        e.event_type === "PAYMENT" ||
        e.event_type === "INVOICE" ||
        e.event_type === "SERVICE_USE" ||
        e.event_type === "STATED_TRANSACTION_DATE"
    );
    if (taxPointCandidates.length > 0) {
      const sorted = [...taxPointCandidates].sort((a, b) => a.iso_date.localeCompare(b.iso_date));
      const earliest = sorted[0];
      controllingIso = earliest.iso_date;
      controllingEvent = `${earliest.event_type} (${earliest.raw_text}, Turn ${earliest.source_turn})`;
      statutoryRuleHint =
        "ประมวลรัษฎากร มาตรา 78/1 (1): ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับการให้บริการเกิดขึ้นเมื่อได้รับชำระราคาค่าบริการ เว้นแต่ได้ออกใบกำกับภาษีหรือได้ใช้บริการก่อนได้รับชำระราคา (ถือเหตุการณ์ที่เกิดขึ้นก่อน)";
    } else if (legalAsOfDate) {
      isAmbiguous = true;
      ambiguityReasonTh =
        "มีเพียงวันที่อ้างอิงกฎหมาย (legal as-of date) แต่ไม่ปรากฏวันที่เกิดความรับผิดทางภาษี (วันรับชำระราคา/ออกใบกำกับภาษี/ใช้บริการ) ตามมาตรา 78/1 (1) จึงไม่สมมติวันที่เกิดความรับผิดทางภาษีโดยพลการ";
    } else {
      isAmbiguous = true;
      ambiguityReasonTh =
        "ไม่ปรากฏวันที่เกิดความรับผิดทางภาษี (วันรับชำระราคา วันออกใบกำกับภาษี หรือวันใช้บริการ) ตามมาตรา 78/1 (1) ในข้อเท็จจริง";
    }
  } else if (nonQuestionDates.length > 0) {
    // Prefer latest turn's registration/transfer/stated date; if multiple distinct dates on same turn, flag distinction
    const pool = latestTurnNonQuestionDates.length > 0 ? latestTurnNonQuestionDates : nonQuestionDates;
    const regOrTransfer = pool.filter((e) => e.event_type === "REGISTRATION" || e.event_type === "TRANSFER");
    const chosen = regOrTransfer[regOrTransfer.length - 1] || pool[pool.length - 1];
    controllingIso = chosen.iso_date;
    controllingEvent = `${chosen.event_type} (${chosen.raw_text}, Turn ${chosen.source_turn})`;
    if (factsMap.get("asset")?.normalized_category.startsWith("IMMOVABLE_PROPERTY")) {
      statutoryRuleHint = "การโอนกรรมสิทธิ์อสังหาริมทรัพย์พิจารณาตามวันจดทะเบียนสิทธิและนิติกรรม";
    }
  } else if (legalAsOfDate) {
    // Do NOT silently equate legal_as_of_date with transaction date if transaction date is absent!
    controllingIso = null;
    controllingEvent = null;
    isAmbiguous = true;
    ambiguityReasonTh = `มีเฉพาะวันที่อ้างอิงกฎหมาย (legal_as_of_date = ${legalAsOfDate}) แต่ไม่ปรากฏวันที่เกิดธุรกรรมหรือวันเกิดความรับผิดทางภาษีในคำถาม`;
  }

  return {
    turn_count: allUserTurns.length,
    is_new_conversation: isNewConversation,
    user_turns: userTurnsOut,
    material_facts: Array.from(factsMap.values()),
    overrides,
    temporal_facts: {
      transaction_or_event_dates: allTemporalEvents,
      legal_as_of_date: legalAsOfDate,
      controlling_tax_point: {
        iso_date: controllingIso,
        controlling_event: controllingEvent,
        statutory_rule_hint: statutoryRuleHint,
        is_ambiguous: isAmbiguous,
        ambiguity_reason_th: ambiguityReasonTh,
      },
    },
    explicitly_unknown_facts_th: Array.from(unknownFacts),
    questions_asked_th: questionsAsked,
    fact_preservation_guards: {
      asset_original_noun_th: assetOriginalNounTh,
      forbid_land_substitution: forbidLandSubstitution,
      recipient_original_noun_th: recipientOriginalNounTh,
      forbid_niece_substitution: forbidNieceSubstitution,
      recipient_kinship_category: recipientKinshipCategory,
      is_ambiguous_lan_sao: isAmbiguousLanSao,
    },
  };
}
