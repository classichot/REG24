#!/usr/bin/env npx tsx
/**
 * REG24 — Candidate 12 Workstream D1: Hosted Replay & Paraphrase Harness
 *
 * Replays a YAML suite of non-sealed cases against a protected Vercel Preview deployment using
 * the sanctioned Vercel OIDC header (`VERCEL_OIDC_TOKEN` -> `x-vercel-trusted-oidc-idp-token`)
 * and Staging Trial Invite (`REG24_TRIAL_INVITE` -> `x-reg24-trial-invite`).
 *
 * For every turn:
 *   Generate (SSE, tax-date BLANK, gemini-4-neon @ low, fallback off) -> Save -> GET ?require_db=1
 *   -> Compare Live SSE vs Saved vs Reopened (claims, bound calcs, evidence, allocation record, B1 invariant).
 *
 * Provider 402 / 429 / 502 / 503 / 504 / TIMEOUT / PROVIDER_UNAVAILABLE are ALWAYS recorded as
 * `BLOCKED`, never as `PASS` or `FAIL`.
 *
 * Secrets (`VERCEL_OIDC_TOKEN`, `REG24_TRIAL_INVITE`) are NEVER printed or written to receipts.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type ReplayTurnMode = "fresh" | "same" | "fresh_tab_reopen";

export interface ExpectedLotCheck {
  label: string;
  date_iso: string;
  decree_num: string;
  base_thb: number;
  vat_thb: number;
}

export interface AttachmentFixtureSpec {
  source_native_id: string;
  original_title_th: string;
  official_origin_url: string;
  issuer_id: string;
  publication_date: string;
  effective_from: string;
  section_label: string;
  physical_page_one_based: number;
  verbatim_text: string;
}

export interface ReplayTurnExpected {
  status_in: string[];
  min_claims?: number;
  max_claims?: number;
  exact_claims?: number;
  expected_lots?: ExpectedLotCheck[];
  expected_tax_amounts_thb?: number[];
  expected_exempt_amounts_thb?: number[];
  must_contain_regex?: string[];
  must_not_contain_regex?: string[];
  require_fact_delta_change?: boolean;
  require_fact_delta_noop?: boolean;
  require_context_links?: boolean;
  require_rc1_diagnostic?: boolean;
  require_no_allocation_record?: boolean;
}

export interface ReplayTurnSpec {
  turn_id: string;
  turn_mode: ReplayTurnMode;
  prompt: string;
  qa_synthetic_fixture?: string | null;
  attachment?: AttachmentFixtureSpec | null;
  reopen_prior_turn_index?: number | null;
  expected: ReplayTurnExpected;
}

export interface ReplayCaseSpec {
  id: string;
  category: string;
  source: string;
  description?: string;
  turns: ReplayTurnSpec[];
}

export interface ReplaySuiteFile {
  suite_id: string;
  suite_version: string;
  non_sealed_attestation: string;
  cases: ReplayCaseSpec[];
}

export type CaseOutcome = "PASS" | "FAIL" | "BLOCKED";

export interface TurnReceipt {
  turn_id: string;
  turn_mode: ReplayTurnMode;
  outcome: CaseOutcome;
  blocked_reason?: string | null;
  http_status: number | null;
  trace_id: string | null;
  saved_revision: string | null;
  reopen_http_status: number | null;
  live_status: string | null;
  saved_status: string | null;
  reopened_status: string | null;
  reopened_grounded_status: string | null;
  live_claim_count: number;
  saved_claim_count: number;
  reopened_claim_count: number;
  bound_calculations_reopened: Array<{
    claim_id: string;
    tax_base_thb: number | null;
    exempt_amount_thb: number | null;
    rate_pct: number | null;
    computed_tax_thb: number | null;
  }>;
  context_link_count: number;
  governing_link_count: number;
  fact_delta_present: boolean;
  ledger_before_hash: string | null;
  ledger_after_hash: string | null;
  delta_disagreement: boolean;
  model_id: string | null;
  thinking_level: string | null;
  latency_ms: number;
  parity_checks_passed: boolean;
  invariant_passed: boolean;
  failures: string[];
  prior_reopen_check_passed?: boolean | null;
}

export interface CaseReceipt {
  case_id: string;
  category: string;
  source: string;
  outcome: CaseOutcome;
  blocked_reason: string | null;
  started_at_utc: string;
  finished_at_utc: string;
  turns: TurnReceipt[];
  failures: string[];
}

// ============================================================================
// ZERO-DEPENDENCY YAML PARSER (supports standard YAML mappings/sequences/scalars)
// ============================================================================

function parseYamlScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "[]") return [];
  if (s === "{}") return {};
  if (s.startsWith('"') && s.endsWith('"')) {
    return JSON.parse(s);
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      return JSON.parse(s);
    } catch {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(",").map((part) => parseYamlScalar(part));
    }
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    return JSON.parse(s);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) {
    return Number(s);
  }
  return s;
}

interface YamlLine {
  indent: number;
  text: string;
  lineNo: number;
}

export function parseReplayYaml(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  const rawLines = content.split(/\r?\n/);
  const lines: YamlLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: raw.trim(), lineNo: i + 1 });
  }

  let idx = 0;

  const parseBlock = (minIndent: number): unknown => {
    if (idx >= lines.length || lines[idx].indent < minIndent) return null;
    const isSeq = lines[idx].text.startsWith("- ") || lines[idx].text === "-";
    if (isSeq) {
      const seqIndent = lines[idx].indent;
      const arr: unknown[] = [];
      while (idx < lines.length && lines[idx].indent === seqIndent && (lines[idx].text.startsWith("- ") || lines[idx].text === "-")) {
        const line = lines[idx];
        const rest = line.text === "-" ? "" : line.text.slice(2).trim();
        idx++;
        if (!rest) {
          arr.push(parseBlock(seqIndent + 1));
          continue;
        }
        const colonPos = findUnquotedColon(rest);
        if (colonPos > 0) {
          const obj: Record<string, unknown> = {};
          const k = rest.slice(0, colonPos).trim();
          const vRaw = rest.slice(colonPos + 1).trim();
          if (vRaw === "") {
            obj[k] = parseBlock(seqIndent + 2);
          } else {
            obj[k] = parseYamlScalar(vRaw);
          }
          while (idx < lines.length && lines[idx].indent > seqIndent) {
            const subIndent = lines[idx].indent;
            const subLine = lines[idx].text;
            const subColon = findUnquotedColon(subLine);
            if (subColon < 0) {
              throw new Error(`YAML parse error at line ${lines[idx].lineNo}: expected key: value`);
            }
            const sk = subLine.slice(0, subColon).trim();
            const sv = subLine.slice(subColon + 1).trim();
            idx++;
            if (sv === "") {
              obj[sk] = parseBlock(subIndent + 1);
            } else {
              obj[sk] = parseYamlScalar(sv);
            }
          }
          arr.push(obj);
        } else {
          arr.push(parseYamlScalar(rest));
        }
      }
      return arr;
    }

    const mapIndent = lines[idx].indent;
    const obj: Record<string, unknown> = {};
    while (idx < lines.length && lines[idx].indent === mapIndent) {
      const line = lines[idx];
      if (line.text.startsWith("- ") || line.text === "-") break;
      const colonPos = findUnquotedColon(line.text);
      if (colonPos < 0) {
        throw new Error(`YAML parse error at line ${line.lineNo}: missing ':' in "${line.text}"`);
      }
      const k = line.text.slice(0, colonPos).trim();
      const vRaw = line.text.slice(colonPos + 1).trim();
      idx++;
      if (vRaw === "") {
        obj[k] = parseBlock(mapIndent + 1);
      } else {
        obj[k] = parseYamlScalar(vRaw);
      }
    }
    return obj;
  };

  return parseBlock(0);
}

function findUnquotedColon(s: string): number {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && inDouble) {
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === ":" && !inDouble && !inSingle) {
      if (i + 1 === s.length || s[i + 1] === " ") return i;
    }
  }
  return -1;
}

// ============================================================================
// HTTP + SSE + VERIFICATION HELPERS
// ============================================================================

const THAI_MONTH_MAP: Record<string, string[]> = {
  "01": ["มกราคม", "ม.ค."],
  "02": ["กุมภาพันธ์", "ก.พ."],
  "03": ["มีนาคม", "มี.ค."],
  "04": ["เมษายน", "เม.ย."],
  "05": ["พฤษภาคม", "พ.ค."],
  "06": ["มิถุนายน", "มิ.ย."],
  "07": ["กรกฎาคม", "ก.ค."],
  "08": ["สิงหาคม", "ส.ค."],
  "09": ["กันยายน", "ก.ย."],
  "10": ["ตุลาคม", "ต.ค."],
  "11": ["พฤศจิกายน", "พ.ย."],
  "12": ["ธันวาคม", "ธ.ค."],
};

function toArabicDigits(s: string): string {
  return (s || "").replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50));
}

function textMentionsDateIso(raw: string, iso: string): boolean {
  const norm = toArabicDigits(raw);
  if (norm.includes(iso)) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const beYear = Number(m[1]) + 543;
  const shortBe = String(beYear).slice(-2);
  const day = Number(m[3]);
  const months = THAI_MONTH_MAP[m[2]] || [];
  const engMonths: Record<string, string> = {
    "01": "jan(?:uary)?",
    "02": "feb(?:ruary)?",
    "03": "mar(?:ch)?",
    "04": "apr(?:il)?",
    "05": "may",
    "06": "jun(?:e)?",
    "07": "jul(?:y)?",
    "08": "aug(?:ust)?",
    "09": "sep(?:t(?:ember)?)?",
    "10": "oct(?:ober)?",
    "11": "nov(?:ember)?",
    "12": "dec(?:ember)?",
  };
  for (const thM of months) {
    const esc = thM.replace(/\./g, "\\.");
    if (
      new RegExp(`(?<!\\d)${day}\\s*${esc}\\s*(?:พ\\.ศ\\.\\s*)?(?:${beYear}|${shortBe})(?!\\d)`).test(
        norm
      )
    ) {
      return true;
    }
  }
  const em = engMonths[m[2]];
  if (em) {
    if (new RegExp(`(?<!\\d)${day}\\s+${em}\\s*(?:${m[1]}|${beYear})?\\b`, "i").test(norm)) {
      return true;
    }
  }
  return false;
}

function buildAuthHeaders(actorId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-reg24-actor-id": actorId,
  };
  const oidc = (process.env.VERCEL_OIDC_TOKEN || "").trim();
  if (oidc) {
    headers["x-vercel-trusted-oidc-idp-token"] = oidc;
  }
  const invite = (process.env.REG24_TRIAL_INVITE || "").trim();
  if (invite) {
    headers["x-reg24-trial-invite"] = invite;
  }
  return headers;
}

function isProviderBlockedStatus(httpStatus: number, payload: Record<string, unknown> | null): string | null {
  if (httpStatus === 402) return "HTTP_402_PROVIDER_BILLING_OR_QUOTA";
  if (httpStatus === 429) return "HTTP_429_RATE_LIMIT";
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
    return `HTTP_${httpStatus}_UPSTREAM_GATEWAY_OR_TIMEOUT`;
  }
  const ans = (payload?.answer as Record<string, unknown> | undefined) ?? null;
  const prov = (ans?.execution_provenance as Record<string, unknown> | undefined) ?? null;
  const inv = (prov?.provider_invocation as Record<string, unknown> | undefined) ?? null;
  const fc = typeof inv?.failure_classification === "string" ? inv.failure_classification : "";
  if (
    fc === "RATE_LIMIT_429_FREE_TIER" ||
    fc === "TIMEOUT" ||
    fc === "PROVIDER_UNAVAILABLE" ||
    fc === "BILLING_402"
  ) {
    return `PROVIDER_BLOCKED_${fc}`;
  }
  const errStr = String(payload?.error || inv?.error_summary || "");
  if (/\b402\b|insufficient.?credit|quota.?exceeded|rate.?limit|timed?\s*out/i.test(errStr)) {
    return `PROVIDER_BLOCKED: ${errStr.slice(0, 120)}`;
  }
  return null;
}

async function parseSseOrJsonResponse(res: Response): Promise<{
  httpStatus: number;
  payload: Record<string, unknown> | null;
  rawErrorText: string | null;
}> {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    let donePayload: Record<string, unknown> | null = null;
    let errPayload: Record<string, unknown> | null = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const eventMatch = /^event:\s*(\S+)/m.exec(block);
      const dataLines = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const dataRaw = dataLines.join("\n");
      try {
        const parsed = JSON.parse(dataRaw) as Record<string, unknown>;
        const evName = eventMatch ? eventMatch[1] : "";
        if (evName === "done" || parsed.answer || parsed.ok === true) {
          donePayload = parsed;
        } else if (evName === "error" || parsed.ok === false) {
          errPayload = parsed;
        }
      } catch {
        // ignore keepalive comments
      }
    }
    return {
      httpStatus: res.status,
      payload: donePayload || errPayload,
      rawErrorText: donePayload ? null : text.slice(0, 400),
    };
  }
  const text = await res.text();
  try {
    return {
      httpStatus: res.status,
      payload: JSON.parse(text) as Record<string, unknown>,
      rawErrorText: null,
    };
  } catch {
    return {
      httpStatus: res.status,
      payload: null,
      rawErrorText: text.slice(0, 400),
    };
  }
}

async function fetchEnvironmentSnapshot(baseUrl: string, actorId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/knowledge/environment`, {
    method: "GET",
    headers: buildAuthHeaders(actorId),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !json.ok) {
    throw new Error(`Environment preflight failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

async function uploadOfficialAttachment(
  baseUrl: string,
  actorId: string,
  spec: AttachmentFixtureSpec
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/knowledge/attachments`, {
    method: "POST",
    headers: buildAuthHeaders(actorId),
    body: JSON.stringify({
      source_native_id: spec.source_native_id,
      original_title_th: spec.original_title_th,
      official_origin_url: spec.official_origin_url,
      issuer_id: spec.issuer_id,
      publication_date: spec.publication_date,
      effective_from: spec.effective_from,
      section_label: spec.section_label,
      physical_page_one_based: spec.physical_page_one_based,
      verbatim_text: spec.verbatim_text,
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !json.ok || typeof json.doc_id !== "string") {
    throw new Error(`Official attachment upload failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.doc_id;
}

async function reopenAnswerStrict(
  baseUrl: string,
  actorId: string,
  revisionId: string
): Promise<{ httpStatus: number; json: Record<string, unknown> | null }> {
  const res = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/v1/knowledge/answers/${encodeURIComponent(revisionId)}?require_db=1`,
    {
      method: "GET",
      headers: buildAuthHeaders(actorId),
    }
  );
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { httpStatus: res.status, json };
}

function checkAllocationRecordConsistencyInRenderedAnswer(
  renderedAnswer: string,
  reopenedClaims: Array<Record<string, unknown>>,
  expectedLots: ExpectedLotCheck[] | undefined
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const normAns = toArabicDigits(renderedAnswer || "");
  const allocLineMatch = normAns.match(/Verified VAT Allocation Record\)\*\*:\s*([^\n]+)/);
  if (!allocLineMatch) {
    return { ok: true, errors };
  }
  const allocLine = allocLineMatch[1];

  // Check every expected lot matches BOTH the Verified VAT Allocation Record line AND published claims
  if (expectedLots && expectedLots.length > 0) {
    // Group expected lots by date_iso to check bucket totals in the allocation record line
    const byDate = new Map<string, { decree: string; base: number; vat: number }>();
    for (const lot of expectedLots) {
      const cur = byDate.get(lot.date_iso) || { decree: lot.decree_num, base: 0, vat: 0 };
      cur.base = Math.round((cur.base + lot.base_thb) * 100) / 100;
      cur.vat = Math.round((cur.vat + lot.vat_thb) * 100) / 100;
      byDate.set(lot.date_iso, cur);
    }
    for (const [iso, agg] of byDate.entries()) {
      if (!allocLine.includes(iso)) {
        errors.push(`Allocation record missing expected bucket date ${iso}: "${allocLine}"`);
      }
      if (!allocLine.includes(`RD_${agg.decree}`)) {
        errors.push(`Allocation record missing expected decree RD_${agg.decree} for ${iso}`);
      }
      const fmtBase = agg.base.toLocaleString("en-US");
      const fmtVat = agg.vat.toLocaleString("en-US");
      if (!allocLine.includes(fmtBase) && !allocLine.includes(String(agg.base))) {
        errors.push(`Allocation record missing expected base ${fmtBase} for ${iso}`);
      }
      if (!allocLine.includes(fmtVat) && !allocLine.includes(String(agg.vat))) {
        errors.push(`Allocation record missing expected VAT ${fmtVat} for ${iso}`);
      }
    }
  }

  // Also ensure allocation record is NOT rendered alongside zero supported claims
  const supportedClaims = reopenedClaims.filter((c) => c.verification_decision === "supported");
  if (supportedClaims.length === 0) {
    errors.push("Verified VAT Allocation Record rendered with 0 supported claims");
  }

  // Verify total published bound_calculation base sum matches total expected base (no stale/contradictory split!)
  if (expectedLots && expectedLots.length > 0 && supportedClaims.length > 0) {
    const expectedTotalBase = expectedLots.reduce((s, l) => s + l.base_thb, 0);
    const expectedTotalVat = expectedLots.reduce((s, l) => s + l.vat_thb, 0);
    const calcBaseSum = supportedClaims.reduce((s, c) => {
      const bc = c.bound_calculation as { inputs?: { tax_base_thb?: number } } | null;
      return s + (typeof bc?.inputs?.tax_base_thb === "number" ? bc.inputs.tax_base_thb : 0);
    }, 0);
    const calcVatSum = supportedClaims.reduce((s, c) => {
      const bc = c.bound_calculation as { outputs?: { computed_tax_thb?: number } } | null;
      return s + (typeof bc?.outputs?.computed_tax_thb === "number" ? bc.outputs.computed_tax_thb : 0);
    }, 0);
    if (Math.abs(calcBaseSum - expectedTotalBase) > 1.5) {
      errors.push(
        `Invariant base conservation failed: published claim base sum ${calcBaseSum} != expected ${expectedTotalBase}`
      );
    }
    if (Math.abs(calcVatSum - expectedTotalVat) > 2.0) {
      errors.push(
        `Invariant VAT conservation failed: published claim VAT sum ${calcVatSum} != expected ${expectedTotalVat}`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function verifyExpectedLotsAgainstClaims(
  expectedLots: ExpectedLotCheck[],
  reopenedClaims: Array<Record<string, unknown>>
): string[] {
  const errors: string[] = [];
  const supported = reopenedClaims.filter((c) => c.verification_decision === "supported");

  // Group expected lots by (date_iso, decree_num) as well as same-decree combinations
  // because live Gemini may either emit 1 claim per lot OR 1 claim per date bucket OR 1 claim per same-decree group!
  for (const lot of expectedLots) {
    const labelRe = new RegExp(lot.label, "i");
    const decreeWorkId = `subreg.th.rc.royal_decree.${lot.decree_num}`;

    const matchingClaim = supported.find((c) => {
      const txt = toArabicDigits(String(c.text || ""));
      const refs = Array.isArray(c.evidence_references)
        ? (c.evidence_references as Array<Record<string, unknown>>)
        : [];
      const governingRefs = refs.filter((r) => r.support_role !== "context");
      const citesRightDecree = governingRefs.some((r) => r.doc_id === decreeWorkId);
      const citesWrongDecree = governingRefs.some(
        (r) =>
          typeof r.doc_id === "string" &&
          /^subreg\.th\.rc\.royal_decree\.(780|790|799|807)$/.test(r.doc_id) &&
          r.doc_id !== decreeWorkId
      );
      if (!citesRightDecree || citesWrongDecree) return false;
      if (!textMentionsDateIso(txt, lot.date_iso)) return false;
      if (!labelRe.test(txt)) return false;

      // Bound calculation must match either this single lot OR a valid same-decree bucket containing this lot!
      const bc = c.bound_calculation as {
        inputs?: { tax_base_thb?: number };
        outputs?: { computed_tax_thb?: number };
      } | null;
      if (!bc || typeof bc.inputs?.tax_base_thb !== "number" || typeof bc.outputs?.computed_tax_thb !== "number") {
        return false;
      }
      const sameDecreeLots = expectedLots.filter((l) => l.decree_num === lot.decree_num);
      const sameDateLots = sameDecreeLots.filter((l) => l.date_iso === lot.date_iso);
      const allowedBaseVatPairs: Array<[number, number]> = [
        [lot.base_thb, lot.vat_thb],
        [
          sameDateLots.reduce((s, l) => s + l.base_thb, 0),
          sameDateLots.reduce((s, l) => s + l.vat_thb, 0),
        ],
        [
          sameDecreeLots.reduce((s, l) => s + l.base_thb, 0),
          sameDecreeLots.reduce((s, l) => s + l.vat_thb, 0),
        ],
      ];
      return allowedBaseVatPairs.some(
        ([b, v]) =>
          Math.abs((bc.inputs?.tax_base_thb ?? -1) - b) <= 1.5 &&
          Math.abs((bc.outputs?.computed_tax_thb ?? -1) - v) <= 2.0
      );
    });

    if (!matchingClaim) {
      errors.push(
        `Expected lot (${lot.label}: ${lot.date_iso} / RD ${lot.decree_num} / base ${lot.base_thb} / VAT ${lot.vat_thb}) not matched by any supported reopened claim with bound_calculation and governing RD ${lot.decree_num}`
      );
    }
  }

  return errors;
}

async function runSingleCase(
  baseUrl: string,
  actorId: string,
  spec: ReplayCaseSpec
): Promise<CaseReceipt> {
  const startedAt = new Date().toISOString();
  const turnReceipts: TurnReceipt[] = [];
  const caseFailures: string[] = [];
  let caseOutcome: CaseOutcome = "PASS";
  let caseBlockedReason: string | null = null;

  let conversationId = `conv.c12replay.${spec.id.toLowerCase().replace(/[^a-z0-9]/g, "")}.${Date.now().toString(36)}`;
  let conversationHistory: Array<Record<string, unknown>> = [];
  let attachedDocIds: string[] = [];
  const savedRevisionsByTurnIdx: Array<{ rev: string; snapshot: Record<string, unknown> }> = [];

  for (let tIdx = 0; tIdx < spec.turns.length; tIdx++) {
    const turn = spec.turns[tIdx];
    const tFailures: string[] = [];
    const t0 = Date.now();

    try {
      let priorSavedRevision: string | null = null;
      let reopenedFromRevision: string | null = null;

      if (turn.turn_mode === "fresh") {
        conversationId = `conv.c12replay.${spec.id.toLowerCase().replace(/[^a-z0-9]/g, "")}.t${tIdx + 1}.${Date.now().toString(36)}`;
        conversationHistory = [];
        attachedDocIds = [];
      } else if (turn.turn_mode === "fresh_tab_reopen") {
        const prev = savedRevisionsByTurnIdx[tIdx - 1];
        if (!prev) {
          throw new Error(`fresh_tab_reopen requested on turn ${turn.turn_id} without prior saved revision`);
        }
        // Simulate opening a brand-new verified browser tab to ?rev=<prev.rev>&require_db=1
        const reopenTab = await reopenAnswerStrict(baseUrl, actorId, prev.rev);
        if (reopenTab.httpStatus !== 200 || !reopenTab.json?.ok || !reopenTab.json.answer) {
          throw new Error(
            `fresh_tab_reopen GET ?require_db=1 failed for ${prev.rev} (HTTP ${reopenTab.httpStatus})`
          );
        }
        const env = reopenTab.json.answer as Record<string, unknown>;
        conversationId =
          (typeof reopenTab.json.conversation_id === "string" && reopenTab.json.conversation_id) ||
          (typeof env.conversation_id === "string" && env.conversation_id) ||
          `conv.reopened.${String(env.answer_id)}`;
        conversationHistory = Array.isArray(reopenTab.json.conversation_turns)
          ? (reopenTab.json.conversation_turns as Array<Record<string, unknown>>)
          : [];
        priorSavedRevision = prev.rev;
        reopenedFromRevision = prev.rev;
      } else {
        // turn_mode === "same"
        const prev = savedRevisionsByTurnIdx[tIdx - 1];
        priorSavedRevision = prev?.rev || null;
      }

      if (turn.attachment) {
        const docId = await uploadOfficialAttachment(baseUrl, actorId, turn.attachment);
        attachedDocIds = [docId];
      }

      const saveOpKey = `op.c12replay.${spec.id}.${turn.turn_id}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`;
      const queryRes = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/knowledge/query`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(actorId),
          Accept: "text/event-stream, application/json",
        },
        body: JSON.stringify({
          question: turn.prompt,
          applicable_date: null, // ALWAYS blank per Workstream D1!
          mode: "standard",
          channel: "chat",
          persist_answer: true,
          save_operation_key: saveOpKey,
          stream: true,
          conversation_id: conversationId,
          prior_saved_answer_revision: priorSavedRevision,
          reopened_from_revision: reopenedFromRevision,
          conversation_history: conversationHistory,
          attachment_doc_ids: attachedDocIds,
          qa_synthetic_fixture: turn.qa_synthetic_fixture ?? null,
          answer_generation_mode: "llm_grounded",
        }),
      });

      const parsed = await parseSseOrJsonResponse(queryRes);
      const latencyMs = Date.now() - t0;

      const blockedReason = isProviderBlockedStatus(parsed.httpStatus, parsed.payload);
      if (blockedReason) {
        turnReceipts.push({
          turn_id: turn.turn_id,
          turn_mode: turn.turn_mode,
          outcome: "BLOCKED",
          blocked_reason: blockedReason,
          http_status: parsed.httpStatus,
          trace_id: null,
          saved_revision: null,
          reopen_http_status: null,
          live_status: null,
          saved_status: null,
          reopened_status: null,
          reopened_grounded_status: null,
          live_claim_count: 0,
          saved_claim_count: 0,
          reopened_claim_count: 0,
          bound_calculations_reopened: [],
          context_link_count: 0,
          governing_link_count: 0,
          fact_delta_present: false,
          ledger_before_hash: null,
          ledger_after_hash: null,
          delta_disagreement: false,
          model_id: null,
          thinking_level: null,
          latency_ms: latencyMs,
          parity_checks_passed: false,
          invariant_passed: false,
          failures: [],
        });
        caseOutcome = "BLOCKED";
        caseBlockedReason = blockedReason;
        break;
      }

      if (parsed.httpStatus !== 200 || !parsed.payload?.ok || !parsed.payload.answer) {
        throw new Error(
          `Query failed (HTTP ${parsed.httpStatus}): ${JSON.stringify(parsed.payload || parsed.rawErrorText).slice(0, 300)}`
        );
      }

      const liveAns = parsed.payload.answer as Record<string, unknown>;
      const savedEnv = (parsed.payload.traceable_answer || liveAns.traceable_answer || null) as
        | Record<string, unknown>
        | null;
      const savedRev = typeof savedEnv?.answer_revision === "string" ? savedEnv.answer_revision : null;
      const traceId = typeof liveAns.trace_id === "string" ? liveAns.trace_id : null;
      const liveStatus = typeof liveAns.status === "string" ? liveAns.status : null;
      const savedStatus = typeof savedEnv?.status === "string" ? savedEnv.status : null;
      const liveClaims = Array.isArray(liveAns.claims) ? (liveAns.claims as Array<Record<string, unknown>>) : [];
      const savedClaims = Array.isArray(savedEnv?.claims) ? (savedEnv.claims as Array<Record<string, unknown>>) : [];

      const prov = (liveAns.execution_provenance || savedEnv?.execution_provenance || {}) as Record<
        string,
        unknown
      >;
      const invObj = (prov.provider_invocation || {}) as Record<string, unknown>;
      const pinned = (invObj.pinned_settings || {}) as Record<string, unknown>;
      const modelId = typeof prov.model_id === "string" ? prov.model_id : null;
      const thinkingLevel = typeof pinned.thinking_level === "string" ? pinned.thinking_level : null;
      const factDeltaPresent = Boolean(prov.fact_delta);
      const ledgerBeforeHash = typeof prov.ledger_before_hash === "string" ? prov.ledger_before_hash : null;
      const ledgerAfterHash = typeof prov.ledger_after_hash === "string" ? prov.ledger_after_hash : null;
      const deltaDisagreement = Boolean(prov.delta_disagreement);

      // Reopen via GET ?require_db=1
      let reopenHttpStatus: number | null = null;
      let reopenedEnv: Record<string, unknown> | null = null;
      let reopenedGrounded: Record<string, unknown> | null = null;
      if (!savedRev) {
        tFailures.push("Missing saved answer_revision in SSE response");
      } else {
        const ro = await reopenAnswerStrict(baseUrl, actorId, savedRev);
        reopenHttpStatus = ro.httpStatus;
        if (ro.httpStatus !== 200 || !ro.json?.ok || !ro.json.answer) {
          tFailures.push(`GET ?require_db=1 failed for ${savedRev} (HTTP ${ro.httpStatus})`);
        } else {
          reopenedEnv = ro.json.answer as Record<string, unknown>;
          reopenedGrounded = (ro.json.grounded_answer as Record<string, unknown> | null) ?? null;
        }
      }

      const reopenedStatus = typeof reopenedEnv?.status === "string" ? reopenedEnv.status : null;
      const reopenedGroundedStatus =
        typeof reopenedEnv?.grounded_answer_status === "string"
          ? reopenedEnv.grounded_answer_status
          : typeof reopenedGrounded?.status === "string"
            ? reopenedGrounded.status
            : null;
      const reopenedClaims = Array.isArray(reopenedEnv?.claims)
        ? (reopenedEnv.claims as Array<Record<string, unknown>>)
        : [];
      const reopenedSupportedClaims = reopenedClaims.filter(
        (c) => c.verification_decision === "supported"
      );

      // Parity check: Live SSE vs Saved vs Reopened
      let parityOk = true;
      if (reopenedEnv && savedEnv) {
        if (reopenedEnv.answer_revision !== savedEnv.answer_revision) {
          parityOk = false;
          tFailures.push(`Parity mismatch: reopened rev ${reopenedEnv.answer_revision} != saved ${savedEnv.answer_revision}`);
        }
        if (reopenedStatus !== savedStatus) {
          parityOk = false;
          tFailures.push(`Parity mismatch: reopened status ${reopenedStatus} != saved ${savedStatus}`);
        }
        if (reopenedGroundedStatus && liveStatus && reopenedGroundedStatus !== liveStatus) {
          parityOk = false;
          tFailures.push(
            `Parity mismatch: reopened grounded_status ${reopenedGroundedStatus} != live ${liveStatus}`
          );
        }
        if (reopenedClaims.length !== savedClaims.length) {
          parityOk = false;
          tFailures.push(
            `Parity mismatch: reopened claims (${reopenedClaims.length}) != saved claims (${savedClaims.length})`
          );
        }
        for (let ci = 0; ci < Math.min(reopenedClaims.length, savedClaims.length); ci++) {
          const rc = reopenedClaims[ci];
          const sc = savedClaims[ci];
          if (String(rc.text || "").trim() !== String(sc.text || "").trim()) {
            parityOk = false;
            tFailures.push(`Parity mismatch on claim #${ci + 1} text between saved and reopened`);
          }
          const rBc = rc.bound_calculation as { outputs?: { computed_tax_thb?: number } } | null;
          const sBc = sc.bound_calculation as { outputs?: { computed_tax_thb?: number } } | null;
          if ((rBc?.outputs?.computed_tax_thb ?? null) !== (sBc?.outputs?.computed_tax_thb ?? null)) {
            parityOk = false;
            tFailures.push(`Parity mismatch on claim #${ci + 1} bound_calculation tax between saved and reopened`);
          }
        }
      } else {
        parityOk = false;
      }

      // Check C0 non-leak: public HTTP payload must NEVER contain `rejection_detail_internal`
      const serializedLive = JSON.stringify(parsed.payload);
      if (serializedLive.includes("rejection_detail_internal")) {
        tFailures.push("SECURITY LEAK: rejection_detail_internal appeared in public HTTP/SSE payload");
      }

      // Check model pin (skip strict model check only for deterministic abstentions where model wasn't invoked)
      const execMode = typeof prov.execution_mode === "string" ? prov.execution_mode : "";
      if (execMode === "llm_invoked") {
        if (modelId && !modelId.includes("gemini-4-neon")) {
          tFailures.push(`Model pin drift: expected gemini-4-neon, got ${modelId}`);
        }
        if (thinkingLevel && thinkingLevel !== "low") {
          tFailures.push(`Thinking level drift: expected low, got ${thinkingLevel}`);
        }
      }

      // Check expected status
      if (turn.expected.status_in && turn.expected.status_in.length > 0) {
        if (!liveStatus || !turn.expected.status_in.includes(liveStatus)) {
          tFailures.push(
            `Expected status in [${turn.expected.status_in.join(", ")}], got live=${liveStatus}`
          );
        }
      }

      // Check claim counts
      if (typeof turn.expected.exact_claims === "number" && reopenedSupportedClaims.length !== turn.expected.exact_claims) {
        tFailures.push(
          `Expected exact_claims=${turn.expected.exact_claims}, got ${reopenedSupportedClaims.length}`
        );
      }
      if (typeof turn.expected.min_claims === "number" && reopenedSupportedClaims.length < turn.expected.min_claims) {
        tFailures.push(
          `Expected min_claims>=${turn.expected.min_claims}, got ${reopenedSupportedClaims.length}`
        );
      }
      if (typeof turn.expected.max_claims === "number" && reopenedSupportedClaims.length > turn.expected.max_claims) {
        tFailures.push(
          `Expected max_claims<=${turn.expected.max_claims}, got ${reopenedSupportedClaims.length}`
        );
      }

      // Check per-lot expectations & B1 allocation consistency invariant
      const renderedForCheck = String(
        reopenedGrounded?.answer || liveAns.answer || reopenedEnv?.rendered_answer_th || ""
      );
      const invCheck = checkAllocationRecordConsistencyInRenderedAnswer(
        renderedForCheck,
        reopenedClaims,
        turn.expected.expected_lots
      );
      if (!invCheck.ok) {
        tFailures.push(...invCheck.errors);
      }
      if (turn.expected.expected_lots && turn.expected.expected_lots.length > 0) {
        const lotErrors = verifyExpectedLotsAgainstClaims(turn.expected.expected_lots, reopenedClaims);
        tFailures.push(...lotErrors);
      }
      if (turn.expected.require_no_allocation_record && renderedForCheck.includes("Verified VAT Allocation Record")) {
        tFailures.push("Unexpected Verified VAT Allocation Record rendered on clarification/abstention turn");
      }

      // Check expected tax/exempt amounts
      const reopenedCalcs = reopenedSupportedClaims.map((c) => {
        const bc = (c.bound_calculation || null) as {
          inputs?: { tax_base_thb?: number | null; exempt_amount_thb?: number | null; rate_pct?: number | null };
          outputs?: { computed_tax_thb?: number | null };
        } | null;
        return {
          claim_id: String(c.claim_id || ""),
          tax_base_thb: bc?.inputs?.tax_base_thb ?? null,
          exempt_amount_thb: bc?.inputs?.exempt_amount_thb ?? null,
          rate_pct: bc?.inputs?.rate_pct ?? null,
          computed_tax_thb: bc?.outputs?.computed_tax_thb ?? null,
        };
      });
      if (turn.expected.expected_tax_amounts_thb) {
        for (const expAmt of turn.expected.expected_tax_amounts_thb) {
          const foundCalc = reopenedCalcs.some(
            (c) => typeof c.computed_tax_thb === "number" && Math.abs(c.computed_tax_thb - expAmt) <= 2
          );
          const foundText =
            toArabicDigits(renderedForCheck).includes(expAmt.toLocaleString("en-US")) ||
            toArabicDigits(renderedForCheck).includes(String(expAmt));
          if (!foundCalc && !foundText) {
            tFailures.push(`Expected tax amount ${expAmt} THB not found in bound_calculations or answer`);
          }
        }
      }
      if (turn.expected.expected_exempt_amounts_thb) {
        for (const expEx of turn.expected.expected_exempt_amounts_thb) {
          const foundEx =
            reopenedCalcs.some(
              (c) => typeof c.exempt_amount_thb === "number" && Math.abs(c.exempt_amount_thb - expEx) <= 2
            ) || toArabicDigits(renderedForCheck).includes(expEx.toLocaleString("en-US"));
          if (!foundEx) {
            tFailures.push(`Expected exempt/allowance amount ${expEx} THB not found`);
          }
        }
      }

      // Check regex expectations
      const fullClaimAndAnswerText = toArabicDigits(
        `${renderedForCheck}\n${reopenedClaims.map((c) => String(c.text || "")).join("\n")}`
      );
      for (const pat of turn.expected.must_contain_regex || []) {
        if (!new RegExp(pat, "i").test(fullClaimAndAnswerText)) {
          tFailures.push(`must_contain_regex failed: /${pat}/i`);
        }
      }
      for (const pat of turn.expected.must_not_contain_regex || []) {
        if (new RegExp(pat, "i").test(fullClaimAndAnswerText)) {
          tFailures.push(`must_not_contain_regex violated: /${pat}/i`);
        }
      }

      // Check FactDelta change / no-op expectations
      if (turn.expected.require_fact_delta_change) {
        if (!factDeltaPresent || !ledgerBeforeHash || !ledgerAfterHash || ledgerBeforeHash === ledgerAfterHash) {
          tFailures.push(
            `Expected FactDelta ledger change, got fact_delta=${factDeltaPresent}, before=${ledgerBeforeHash}, after=${ledgerAfterHash}`
          );
        }
      }
      if (turn.expected.require_fact_delta_noop) {
        if (ledgerBeforeHash && ledgerAfterHash && ledgerBeforeHash !== ledgerAfterHash) {
          tFailures.push(
            `Expected FactDelta no-op, but ledger hash changed (${ledgerBeforeHash} -> ${ledgerAfterHash})`
          );
        }
      }

      // Count C3 context vs governing links
      let contextLinkCount = 0;
      let governingLinkCount = 0;
      for (const c of reopenedSupportedClaims) {
        const refs = Array.isArray(c.evidence_references)
          ? (c.evidence_references as Array<Record<string, unknown>>)
          : [];
        for (const r of refs) {
          if (r.support_role === "context") contextLinkCount++;
          else governingLinkCount++;
        }
      }
      if (turn.expected.require_context_links && contextLinkCount === 0) {
        tFailures.push("Expected C3 sibling-decree support_role='context' links, found 0");
      }

      // Check RC1 diagnostic panel (K3)
      if (turn.expected.require_rc1_diagnostic) {
        const rejDiag = Array.isArray(reopenedEnv?.rejected_calculations_diagnostic)
          ? (reopenedEnv.rejected_calculations_diagnostic as Array<Record<string, unknown>>)
          : [];
        const hasRc1 = rejDiag.some((d) => d.fixture_id === "RC1_REJECTED_CALC");
        if (!hasRc1) {
          tFailures.push("Expected RC1_REJECTED_CALC diagnostic entry on reopened envelope");
        }
      }

      // Optional prior-revision isolation check (reopen earlier revision and confirm untouched!)
      let priorReopenOk: boolean | null = null;
      if (typeof turn.reopen_prior_turn_index === "number") {
        const targetPrior = savedRevisionsByTurnIdx[turn.reopen_prior_turn_index];
        if (targetPrior) {
          const roPrior = await reopenAnswerStrict(baseUrl, actorId, targetPrior.rev);
          const priorAns = roPrior.json?.answer as Record<string, unknown> | undefined;
          const origClaims = JSON.stringify((targetPrior.snapshot.claims as unknown[]) || []);
          const nowClaims = JSON.stringify((priorAns?.claims as unknown[]) || []);
          priorReopenOk = roPrior.httpStatus === 200 && origClaims === nowClaims;
          if (!priorReopenOk) {
            tFailures.push(`Prior revision ${targetPrior.rev} mutated or failed Reopen (HTTP ${roPrior.httpStatus})`);
          }
        }
      }

      if (savedRev && reopenedEnv) {
        savedRevisionsByTurnIdx[tIdx] = { rev: savedRev, snapshot: reopenedEnv };
      }

      // Update in-memory conversationHistory for subsequent `same` turns
      conversationHistory = [
        ...conversationHistory,
        {
          role: "user",
          content: turn.prompt,
          applicable_date: null,
          conversation_id: conversationId,
        },
        {
          role: "assistant",
          content: renderedForCheck,
          saved_answer_id: typeof savedEnv?.answer_id === "string" ? savedEnv.answer_id : null,
          saved_answer_revision: savedRev,
          conversation_id: conversationId,
        },
      ];

      const tOutcome: CaseOutcome = tFailures.length === 0 ? "PASS" : "FAIL";
      if (tOutcome === "FAIL") {
        caseOutcome = "FAIL";
        caseFailures.push(...tFailures.map((f) => `[${turn.turn_id}] ${f}`));
      }

      turnReceipts.push({
        turn_id: turn.turn_id,
        turn_mode: turn.turn_mode,
        outcome: tOutcome,
        http_status: parsed.httpStatus,
        trace_id: traceId,
        saved_revision: savedRev,
        reopen_http_status: reopenHttpStatus,
        live_status: liveStatus,
        saved_status: savedStatus,
        reopened_status: reopenedStatus,
        reopened_grounded_status: reopenedGroundedStatus,
        live_claim_count: liveClaims.length,
        saved_claim_count: savedClaims.length,
        reopened_claim_count: reopenedClaims.length,
        bound_calculations_reopened: reopenedCalcs,
        context_link_count: contextLinkCount,
        governing_link_count: governingLinkCount,
        fact_delta_present: factDeltaPresent,
        ledger_before_hash: ledgerBeforeHash,
        ledger_after_hash: ledgerAfterHash,
        delta_disagreement: deltaDisagreement,
        model_id: modelId,
        thinking_level: thinkingLevel,
        latency_ms: latencyMs,
        parity_checks_passed: parityOk,
        invariant_passed: invCheck.ok,
        failures: tFailures,
        prior_reopen_check_passed: priorReopenOk,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = /abort|timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
      const tOutcome: CaseOutcome = isTimeout ? "BLOCKED" : "FAIL";
      turnReceipts.push({
        turn_id: turn.turn_id,
        turn_mode: turn.turn_mode,
        outcome: tOutcome,
        blocked_reason: isTimeout ? `NETWORK_OR_TIMEOUT: ${msg}` : null,
        http_status: null,
        trace_id: null,
        saved_revision: null,
        reopen_http_status: null,
        live_status: null,
        saved_status: null,
        reopened_status: null,
        reopened_grounded_status: null,
        live_claim_count: 0,
        saved_claim_count: 0,
        reopened_claim_count: 0,
        bound_calculations_reopened: [],
        context_link_count: 0,
        governing_link_count: 0,
        fact_delta_present: false,
        ledger_before_hash: null,
        ledger_after_hash: null,
        delta_disagreement: false,
        model_id: null,
        thinking_level: null,
        latency_ms: Date.now() - t0,
        parity_checks_passed: false,
        invariant_passed: false,
        failures: isTimeout ? [] : [msg],
      });
      if (isTimeout) {
        caseOutcome = "BLOCKED";
        caseBlockedReason = `NETWORK_OR_TIMEOUT: ${msg}`;
      } else {
        caseOutcome = "FAIL";
        caseFailures.push(`[${turn.turn_id}] ${msg}`);
      }
      break;
    }
  }

  return {
    case_id: spec.id,
    category: spec.category,
    source: spec.source,
    outcome: caseOutcome,
    blocked_reason: caseBlockedReason,
    started_at_utc: startedAt,
    finished_at_utc: new Date().toISOString(),
    turns: turnReceipts,
    failures: caseFailures,
  };
}

function parseCliArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const suitePath = args.suite;
  const baseUrl = args["base-url"];
  const outDir = args["out-dir"] || path.resolve(process.cwd(), "tmp-hosted-replay");
  const summaryOut = args["summary-out"] || path.join(outDir, "09_HOSTED_REGRESSION_SUMMARY.json");
  const onlyIds = args.only
    ? new Set(
        args.only
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;
  const concurrency = Math.max(1, Math.min(4, Number(args.concurrency || "2") || 2));
  const actorId = args["actor-id"] || "eng.c12.replay@7ladvisory.review";

  if (!suitePath || !baseUrl) {
    console.error(
      "Usage: npx tsx scripts/qa/hosted-replay.ts --suite <yaml> --base-url <url> [--out-dir <dir>] [--summary-out <json>] [--only id1,id2] [--concurrency 2]"
    );
    process.exit(2);
  }

  const rawSuiteText = fs.readFileSync(suitePath, "utf8");
  const suiteSha256 = crypto.createHash("sha256").update(rawSuiteText, "utf8").digest("hex");
  const suite = parseReplayYaml(rawSuiteText) as ReplaySuiteFile;
  if (!suite || !Array.isArray(suite.cases)) {
    throw new Error(`Invalid replay suite YAML at ${suitePath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(summaryOut), { recursive: true });

  console.log(`[hosted-replay] Suite: ${suite.suite_id} (${suite.cases.length} cases, sha256=${suiteSha256.slice(0, 12)})`);
  const envBefore = await fetchEnvironmentSnapshot(baseUrl, actorId);
  const beforeData = (envBefore.data_version || {}) as Record<string, unknown>;
  const beforeEnv = (envBefore.environment || {}) as Record<string, unknown>;
  console.log(
    `[hosted-replay] ENV-BEFORE: commit=${String(beforeEnv.git_commit_sha || "").slice(0, 7)} deploy=${beforeEnv.deployment_id} docs=${beforeData.eligible_official_documents} passages=${beforeData.eligible_evidence_passages} fp=${String(beforeData.eligible_corpus_fingerprint_sha256 || "").slice(0, 12)} verified=${beforeData.corpus_fingerprint_verified}`
  );

  const selectedCases = onlyIds
    ? suite.cases.filter((c) => onlyIds.has(c.id))
    : suite.cases;

  const receipts: CaseReceipt[] = new Array(selectedCases.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= selectedCases.length) return;
      const c = selectedCases[idx];
      console.log(`[hosted-replay] (${idx + 1}/${selectedCases.length}) Running ${c.id} (${c.turns.length} turn(s))...`);
      const receipt = await runSingleCase(baseUrl, actorId, c);
      receipts[idx] = receipt;
      fs.writeFileSync(
        path.join(outDir, `${c.id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`),
        JSON.stringify(receipt, null, 2),
        "utf8"
      );
      const revList = receipt.turns.map((t) => t.saved_revision || "none").join(" -> ");
      console.log(
        `[hosted-replay] (${idx + 1}/${selectedCases.length}) ${c.id}: ${receipt.outcome} [${revList}]${
          receipt.failures.length > 0 ? ` — ${receipt.failures[0]}` : ""
        }${receipt.blocked_reason ? ` — ${receipt.blocked_reason}` : ""}`
      );
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, selectedCases.length) }, () => worker()));

  const envAfter = await fetchEnvironmentSnapshot(baseUrl, actorId);
  const afterData = (envAfter.data_version || {}) as Record<string, unknown>;
  const zeroCorpusDrift =
    beforeData.eligible_official_documents === afterData.eligible_official_documents &&
    beforeData.eligible_evidence_passages === afterData.eligible_evidence_passages &&
    beforeData.eligible_corpus_fingerprint_sha256 === afterData.eligible_corpus_fingerprint_sha256 &&
    Boolean(afterData.corpus_fingerprint_verified);

  const passed = receipts.filter((r) => r.outcome === "PASS").length;
  const failed = receipts.filter((r) => r.outcome === "FAIL").length;
  const blocked = receipts.filter((r) => r.outcome === "BLOCKED").length;
  const scoredTotal = passed + failed;
  const passRatePct = scoredTotal > 0 ? Math.round((passed / scoredTotal) * 10000) / 100 : 0;

  const summary = {
    schema_version: "reg24.hosted_regression_summary.v1",
    generated_at_utc: new Date().toISOString(),
    suite_id: suite.suite_id,
    suite_version: suite.suite_version,
    suite_path: path.relative(process.cwd(), path.resolve(suitePath)).replace(/\\/g, "/"),
    suite_sha256: suiteSha256,
    non_sealed_attestation: suite.non_sealed_attestation,
    target_base_url: baseUrl,
    environment_before: {
      git_commit_sha: beforeEnv.git_commit_sha ?? null,
      deployment_id: beforeEnv.deployment_id ?? null,
      release_id: beforeData.release_id ?? null,
      eligible_official_documents: beforeData.eligible_official_documents ?? null,
      eligible_evidence_passages: beforeData.eligible_evidence_passages ?? null,
      eligible_corpus_fingerprint_sha256: beforeData.eligible_corpus_fingerprint_sha256 ?? null,
      corpus_fingerprint_verified: Boolean(beforeData.corpus_fingerprint_verified),
    },
    environment_after: {
      eligible_official_documents: afterData.eligible_official_documents ?? null,
      eligible_evidence_passages: afterData.eligible_evidence_passages ?? null,
      eligible_corpus_fingerprint_sha256: afterData.eligible_corpus_fingerprint_sha256 ?? null,
      corpus_fingerprint_verified: Boolean(afterData.corpus_fingerprint_verified),
    },
    zero_corpus_drift: zeroCorpusDrift,
    totals: {
      total_cases: receipts.length,
      passed,
      failed,
      blocked,
      scored_total: scoredTotal,
      pass_rate_pct: passRatePct,
    },
    cases: receipts.map((r) => ({
      case_id: r.case_id,
      category: r.category,
      source: r.source,
      outcome: r.outcome,
      blocked_reason: r.blocked_reason,
      saved_revisions: r.turns.map((t) => t.saved_revision),
      trace_ids: r.turns.map((t) => t.trace_id),
      all_parity_passed: r.turns.every((t) => t.parity_checks_passed),
      all_invariants_passed: r.turns.every((t) => t.invariant_passed),
      total_latency_ms: r.turns.reduce((s, t) => s + t.latency_ms, 0),
      failures: r.failures,
    })),
  };

  fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2), "utf8");
  console.log(
    `[hosted-replay] DONE: PASS=${passed} FAIL=${failed} BLOCKED=${blocked} (${passRatePct}%) | zero_corpus_drift=${zeroCorpusDrift} | summary=${summaryOut}`
  );
  if (failed > 0 || !zeroCorpusDrift) {
    process.exit(1);
  }
}

const isDirectEntry =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]).toLowerCase().endsWith("hosted-replay.ts");
if (isDirectEntry) {
  main().catch((err) => {
    console.error("[hosted-replay] FATAL:", err);
    process.exit(1);
  });
}
