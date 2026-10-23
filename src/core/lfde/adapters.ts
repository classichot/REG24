/**
 * REG24 LFDE v2.0 — Gateways, Expression Evaluator, Decimal/Date Normalizer & Security Adapters
 */

import { createHash, createHmac } from "crypto";
import {
  AuthoritySnapshot,
  ExpressionNode,
  ExpressionOperand,
  FieldDatatype,
  LfdeException,
  LicensedOperation,
  LicenseGrant,
  PermissionValue,
  TenantContext,
  TriBool,
} from "./types";

export function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function computeCanonicalHash(obj: unknown): string {
  const canonicalJson = JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
  return sha256Hex(canonicalJson);
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 5.1 & APPENDIX A1: THREE-VALUED EXPRESSION INTERPRETER
   Supports eq, neq, gt, gte, lt, lte, and, or, not, exists ONLY.
   Missing dependency produces "unknown" rather than "false" (AT14).
   ══════════════════════════════════════════════════════════════════════════ */

const ALLOWED_OPERATORS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "and",
  "or",
  "not",
  "exists",
]);

export function validateExpressionSchema(expr: unknown, depth = 0): void {
  if (depth > 12) {
    throw new LfdeException({
      code: "UNSUPPORTED_TEMPLATE_FEATURE",
      safe_message: "Expression nesting depth exceeds maximum safety limit (possible cycle).",
      correlation_id: "expr_validate",
      retryable: false,
      http_status: 422,
    });
  }
  if (typeof expr === "boolean" || expr === undefined || expr === null) return;
  if (typeof expr !== "object") {
    throw new LfdeException({
      code: "UNSUPPORTED_TEMPLATE_FEATURE",
      safe_message: "Invalid expression node.",
      correlation_id: "expr_validate",
      retryable: false,
      http_status: 422,
    });
  }
  const keys = Object.keys(expr as Record<string, unknown>);
  if (keys.length !== 1 || !ALLOWED_OPERATORS.has(keys[0])) {
    throw new LfdeException({
      code: "UNSUPPORTED_TEMPLATE_FEATURE",
      safe_message: `Unsupported or forbidden template expression operator: ${keys.join(",")}`,
      correlation_id: "expr_validate",
      retryable: false,
      http_status: 422,
    });
  }
  const op = keys[0];
  const val = (expr as Record<string, unknown>)[op];
  if (op === "and" || op === "or") {
    if (!Array.isArray(val)) {
      throw new LfdeException({
        code: "UNSUPPORTED_TEMPLATE_FEATURE",
        safe_message: `Operator ${op} requires an array of expressions.`,
        correlation_id: "expr_validate",
        retryable: false,
        http_status: 422,
      });
    }
    for (const child of val) validateExpressionSchema(child, depth + 1);
  } else if (op === "not") {
    validateExpressionSchema(val, depth + 1);
  }
}

function resolveOperand(
  op: ExpressionOperand,
  facts: Record<string, unknown>
): { present: boolean; value: unknown } {
  if (op !== null && typeof op === "object" && "field" in op) {
    const key = op.field;
    if (!(key in facts) || facts[key] === undefined || facts[key] === null || facts[key] === "") {
      return { present: false, value: undefined };
    }
    return { present: true, value: facts[key] };
  }
  return { present: true, value: op };
}

export function evaluateExpression(
  expr: ExpressionNode | boolean | undefined,
  facts: Record<string, unknown>
): TriBool {
  if (expr === undefined || expr === true) return "true";
  if (expr === false) return "false";

  validateExpressionSchema(expr);

  if ("exists" in expr) {
    const k = expr.exists.field;
    const exists = k in facts && facts[k] !== undefined && facts[k] !== null && facts[k] !== "";
    return exists ? "true" : "false";
  }

  if ("not" in expr) {
    const inner = evaluateExpression(expr.not, facts);
    if (inner === "unknown") return "unknown";
    return inner === "true" ? "false" : "true";
  }

  if ("and" in expr) {
    let sawUnknown = false;
    for (const item of expr.and) {
      const r = evaluateExpression(item, facts);
      if (r === "false") return "false";
      if (r === "unknown") sawUnknown = true;
    }
    return sawUnknown ? "unknown" : "true";
  }

  if ("or" in expr) {
    let sawUnknown = false;
    for (const item of expr.or) {
      const r = evaluateExpression(item, facts);
      if (r === "true") return "true";
      if (r === "unknown") sawUnknown = true;
    }
    return sawUnknown ? "unknown" : "false";
  }

  const pairKey = Object.keys(expr)[0] as "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  const [leftOp, rightOp] = (expr as Record<string, [ExpressionOperand, ExpressionOperand]>)[pairKey];
  const left = resolveOperand(leftOp, facts);
  const right = resolveOperand(rightOp, facts);

  if (!left.present || !right.present) {
    return "unknown";
  }

  const lv = left.value;
  const rv = right.value;

  if (pairKey === "eq") return lv === rv ? "true" : "false";
  if (pairKey === "neq") return lv !== rv ? "true" : "false";

  const ln = Number(lv);
  const rn = Number(rv);
  if (Number.isNaN(ln) || Number.isNaN(rn)) return "unknown";

  if (pairKey === "gt") return ln > rn ? "true" : "false";
  if (pairKey === "gte") return ln >= rn ? "true" : "false";
  if (pairKey === "lt") return ln < rn ? "true" : "false";
  if (pairKey === "lte") return ln <= rn ? "true" : "false";

  return "unknown";
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 5.2: FIELD NORMALIZATION (B.E. DATES, LEADING ZERO IDS, DECIMAL MONEY)
   ══════════════════════════════════════════════════════════════════════════ */

export function normalizeTypedFieldValue(
  datatype: FieldDatatype,
  rawInput: unknown,
  options?: {
    calendar?: "BE" | "CE";
    rounding?: "HALF_UP" | "HALF_EVEN" | "FLOOR";
    currency?: string;
  }
): {
  typed_value: unknown;
  original_representation: string;
  calendar_used?: "BE" | "CE";
} {
  const original_representation = String(rawInput ?? "");

  if (datatype === "identifier") {
    // Preserve leading zeroes strictly as string (AT12)
    const str = String(rawInput ?? "").trim();
    if (!str) {
      throw new LfdeException({
        code: "MALFORMED_REQUEST",
        safe_message: "Identifier value cannot be empty.",
        correlation_id: "norm_id",
        retryable: false,
        http_status: 422,
      });
    }
    return { typed_value: str, original_representation };
  }

  if (datatype === "date") {
    const str = String(rawInput ?? "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!match) {
      throw new LfdeException({
        code: "MALFORMED_REQUEST",
        safe_message: `Date must be YYYY-MM-DD format: received ${str}`,
        correlation_id: "norm_date",
        retryable: false,
        http_status: 422,
      });
    }
    let year = Number(match[1]);
    const month = match[2];
    const day = match[3];
    const cal = options?.calendar ?? (year >= 2400 ? "BE" : "CE");
    if (cal === "BE") {
      year -= 543;
    }
    const isoDate = `${String(year).padStart(4, "0")}-${month}-${day}`;
    return {
      typed_value: isoDate,
      original_representation,
      calendar_used: cal,
    };
  }

  if (datatype === "money" || datatype === "decimal") {
    const formatted = formatDecimalExact(String(rawInput ?? "0"), 2, options?.rounding ?? "HALF_UP");
    if (datatype === "money") {
      return {
        typed_value: {
          amount: formatted,
          currency: options?.currency || "THB",
        },
        original_representation,
      };
    }
    return {
      typed_value: formatted,
      original_representation,
    };
  }

  if (datatype === "boolean") {
    if (typeof rawInput === "boolean") {
      return { typed_value: rawInput, original_representation };
    }
    if (rawInput === "true") return { typed_value: true, original_representation };
    if (rawInput === "false") return { typed_value: false, original_representation };
    throw new LfdeException({
      code: "MALFORMED_REQUEST",
      safe_message: "Boolean field requires true or false without lossy coercion.",
      correlation_id: "norm_bool",
      retryable: false,
      http_status: 422,
    });
  }

  return { typed_value: rawInput, original_representation };
}

/**
 * Exact integer-scaled decimal arithmetic avoiding binary floating point errors (AT13, R002).
 */
export function formatDecimalExact(
  valStr: string,
  scale = 2,
  rounding: "HALF_UP" | "HALF_EVEN" | "FLOOR" = "HALF_UP"
): string {
  const cleaned = valStr.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new LfdeException({
      code: "MALFORMED_REQUEST",
      safe_message: `Invalid decimal string: ${valStr}`,
      correlation_id: "dec_parse",
      retryable: false,
      http_status: 422,
    });
  }
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const paddedFrac = (fracPart + "0".repeat(scale + 2)).slice(0, scale + 1);
  const mainDigits = paddedFrac.slice(0, scale);
  const guardDigit = Number(paddedFrac[scale] || "0");
  const remainderAfterGuard = fracPart.slice(scale + 1);
  const hasTrailingNonZero = /[1-9]/.test(remainderAfterGuard);

  const scaleFactor = BigInt(10 ** scale);
  let scaled = BigInt(intPart) * scaleFactor + BigInt(mainDigits || "0");

  if (rounding === "HALF_UP") {
    if (guardDigit >= 5) scaled += 1n;
  } else if (rounding === "HALF_EVEN") {
    if (guardDigit > 5 || (guardDigit === 5 && hasTrailingNonZero)) {
      scaled += 1n;
    } else if (guardDigit === 5 && !hasTrailingNonZero) {
      if (scaled % 2n === 1n) scaled += 1n;
    }
  } else if (rounding === "FLOOR") {
    if (negative && (guardDigit > 0 || hasTrailingNonZero)) {
      scaled += 1n;
    }
  }

  const outInt = scaled / scaleFactor;
  const outFrac = (scaled % scaleFactor).toString().padStart(scale, "0");
  return `${negative && scaled > 0n ? "-" : ""}${outInt.toString()}.${outFrac}`;
}

export function sumDecimalStrings(
  values: string[],
  scale = 2,
  rounding: "HALF_UP" | "HALF_EVEN" | "FLOOR" = "HALF_UP"
): string {
  const scaleFactor = BigInt(10 ** scale);
  let total = 0n;
  for (const v of values) {
    const norm = formatDecimalExact(v, scale, rounding);
    const neg = norm.startsWith("-");
    const unsigned = neg ? norm.slice(1) : norm;
    const [i, f = "00"] = unsigned.split(".");
    const big = BigInt(i) * scaleFactor + BigInt(f.padEnd(scale, "0").slice(0, scale));
    total += neg ? -big : big;
  }
  const negOut = total < 0n;
  const abs = negOut ? -total : total;
  const outInt = abs / scaleFactor;
  const outFrac = (abs % scaleFactor).toString().padStart(scale, "0");
  return `${negOut ? "-" : ""}${outInt.toString()}.${outFrac}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 3.4: RIGHTS & ENTITLEMENTS GATEWAY (LFDE-LIC-001..003)
   ══════════════════════════════════════════════════════════════════════════ */

export class RightsGateway {
  public static evaluateOperationRights(
    ctx: TenantContext,
    grants: LicenseGrant[],
    operation: LicensedOperation,
    nowIso: string = new Date().toISOString()
  ): {
    allowed: boolean;
    reason: string;
    grant_versions: string[];
  } {
    if (grants.length === 0) {
      return {
        allowed: false,
        reason: "No license grant record exists for source asset (unknown rights -> quarantined).",
        grant_versions: [],
      };
    }

    const grantVersions: string[] = [];

    for (const g of grants) {
      grantVersions.push(`${g.id}@v${g.version}`);
      if (g.status !== "active") {
        return {
          allowed: false,
          reason: `License grant ${g.id} is ${g.status}.`,
          grant_versions: grantVersions,
        };
      }
      if (nowIso < g.valid_from || nowIso > g.valid_to) {
        return {
          allowed: false,
          reason: `License grant ${g.id} expired or outside validity interval (${g.valid_from}..${g.valid_to}).`,
          grant_versions: grantVersions,
        };
      }
      if (
        !g.allowed_tenants.includes("*") &&
        !g.allowed_tenants.includes(ctx.tenant_id)
      ) {
        return {
          allowed: false,
          reason: `License grant ${g.id} does not entitle tenant ${ctx.tenant_id}.`,
          grant_versions: grantVersions,
        };
      }
      if (
        operation === "cross_app_deliver" &&
        !g.allowed_applications.includes("*") &&
        !g.allowed_applications.includes(ctx.application_id)
      ) {
        return {
          allowed: false,
          reason: `License grant ${g.id} does not permit cross-application delivery to ${ctx.application_id}.`,
          grant_versions: grantVersions,
        };
      }

      const perm: PermissionValue = g.operations[operation] ?? "unknown";
      if (perm !== "allowed") {
        return {
          allowed: false,
          reason: `Operation '${operation}' is '${perm}' under license grant ${g.id}.`,
          grant_versions: grantVersions,
        };
      }
    }

    return {
      allowed: true,
      reason: "All source license grants explicitly allow the requested operation.",
      grant_versions: grantVersions,
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 6: AUTHORITY & TEMPORAL VERIFICATION GATEWAY (LFDE-030, LFDE-AUT-001..003)
   ══════════════════════════════════════════════════════════════════════════ */

interface CanonicalProvisionCatalogEntry {
  canonical_id: string;
  versions: Array<{
    version_id: string;
    title_th: string;
    title_en: string;
    effective_from: string;
    effective_to: string | null;
    source_class: "primary_legislation" | "subordinate_regulation" | "supreme_court" | "admin_ruling" | "secondary_commentary";
    pinpoint: string;
    text_th: string;
    supported_topics: string[];
    withdrawn?: boolean;
  }>;
}

const CANONICAL_AUTHORITY_CATALOG: Record<string, CanonicalProvisionCatalogEntry> = {
  "th-ccc-sec-1097": {
    canonical_id: "th-ccc-sec-1097",
    versions: [
      {
        version_id: "th-ccc-sec-1097-v2008",
        title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 (ฉบับเดิม 3 คน)",
        title_en: "Civil and Commercial Code Section 1097 (Historical 3 promoters)",
        effective_from: "2008-07-01",
        effective_to: "2023-02-06",
        source_class: "primary_legislation",
        pinpoint: "มาตรา 1097 วรรคหนึ่ง",
        text_th: "บุคคลใดๆ ตั้งแต่สามคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้",
        supported_topics: ["corporate", "promoters", "incorporation", "resolution"],
      },
      {
        version_id: "th-ccc-sec-1097-v2023",
        title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 (แก้ไขเพิ่มเติม พ.ศ. 2565 — 2 คน)",
        title_en: "Civil and Commercial Code Section 1097 (Amended B.E. 2565 — 2 promoters)",
        effective_from: "2023-02-07",
        effective_to: null,
        source_class: "primary_legislation",
        pinpoint: "มาตรา 1097 วรรคหนึ่ง",
        text_th: "บุคคลใดๆ ตั้งแต่สองคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้",
        supported_topics: ["corporate", "promoters", "incorporation", "resolution"],
      },
    ],
  },
  "th-ccc-sec-354": {
    canonical_id: "th-ccc-sec-354",
    versions: [
      {
        version_id: "th-ccc-sec-354-v1",
        title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 354–368 (การก่อให้เกิดสัญญาและเจตนา)",
        title_en: "Civil and Commercial Code Sections 354–368 (Contract Formation & Covenants)",
        effective_from: "1925-11-11",
        effective_to: null,
        source_class: "primary_legislation",
        pinpoint: "บรรพ 2 ลักษณะ 2 สัญญา",
        text_th: "คำเสนอจะทำสัญญานั้น ถ้าระบุระยะเวลาให้ทำคำสนอง ย่อมไม่อาจถอนได้ภายในระยะเวลานั้น",
        supported_topics: ["nda", "confidentiality", "service", "contract", "lease"],
      },
    ],
  },
  "th-ccc-sec-538": {
    canonical_id: "th-ccc-sec-538",
    versions: [
      {
        version_id: "th-ccc-sec-538-v1",
        title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 538 (เช่าอสังหาริมทรัพย์)",
        title_en: "Civil and Commercial Code Section 538 (Hire of Immovable Property)",
        effective_from: "1929-04-01",
        effective_to: null,
        source_class: "primary_legislation",
        pinpoint: "มาตรา 538",
        text_th: "เช่าอสังหาริมทรัพย์นั้น ถ้ามิได้มีหลักฐานเป็นหนังสืออย่างหนึ่งอย่างใดลงลายมือชื่อฝ่ายที่ต้องรับผิดเป็นสำคัญ ท่านว่าจะฟ้องร้องให้บังคับคดีหาได้ไม่",
        supported_topics: ["lease", "property", "commercial_lease"],
      },
    ],
  },
  "th-rev-sec-70": {
    canonical_id: "th-rev-sec-70",
    versions: [
      {
        version_id: "th-rev-sec-70-v1",
        title_th: "ประมวลรัษฎากร มาตรา 70 และ 3 เตรส (ภาษีหัก ณ ที่จ่าย)",
        title_en: "Revenue Code Section 70 & 3 Tres (Withholding Tax)",
        effective_from: "1938-04-01",
        effective_to: null,
        source_class: "primary_legislation",
        pinpoint: "มาตรา 70",
        text_th: "บริษัทหรือห้างหุ้นส่วนนิติบุคคลที่ตั้งขึ้นตามกฎหมายของต่างประเทศ มิได้ประกอบกิจการในประเทศไทยแต่ได้รับเงินได้พึงประเมินตามมาตรา 40 (2)(3)(4)(5) หรือ (6) ที่จ่ายจากหรือในประเทศไทย ให้ผู้จ่ายหักภาษี ณ ที่จ่าย",
        supported_topics: ["service", "tax", "wht", "commercial"],
      },
    ],
  },
  "th-pdpa-sec-37": {
    canonical_id: "th-pdpa-sec-37",
    versions: [
      {
        version_id: "th-pdpa-sec-37-v2019",
        title_th: "พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 มาตรา 37",
        title_en: "Personal Data Protection Act B.E. 2562 Section 37",
        effective_from: "2022-06-01",
        effective_to: null,
        source_class: "primary_legislation",
        pinpoint: "มาตรา 37 (1)-(4)",
        text_th: "ผู้ควบคุมข้อมูลส่วนบุคคลมีหน้าที่จัดให้มีมาตรการรักษาความมั่นคงปลอดภัยที่เหมาะสม และแจ้งเหตุการละเมิดข้อมูลส่วนบุคคลภายใน 72 ชั่วโมง",
        supported_topics: ["pdpa", "privacy", "nda", "service", "dpa"],
      },
    ],
  },
  "th-fba-sec-8": {
    canonical_id: "th-fba-sec-8",
    versions: [
      {
        version_id: "th-fba-sec-8-v1999",
        title_th: "พ.ร.บ. การประกอบธุรกิจของคนต่างด้าว พ.ศ. 2542 มาตรา 8 บัญชีสาม (21)",
        title_en: "Foreign Business Act B.E. 2542 Section 8 List Three (21)",
        effective_from: "1999-03-04",
        effective_to: null,
        source_class: "primary_legislation",
        pinpoint: "มาตรา 8 บัญชีสาม (21)",
        text_th: "ห้ามมิให้คนต่างด้าวประกอบธุรกิจตามบัญชีสาม เว้นแต่จะได้รับใบอนุญาตจากอธิบดีโดยความเห็นชอบของคณะกรรมการ",
        supported_topics: ["corporate", "foreign_business", "shareholders", "boi"],
      },
    ],
  },
};

export class AuthorityGateway {
  private static withdrawnIds = new Set<string>();
  private static simulateTimeout = false;

  public static setSimulatedTimeout(enabled: boolean): void {
    AuthorityGateway.simulateTimeout = enabled;
  }

  public static markAuthorityWithdrawn(canonicalId: string, withdrawn: boolean): void {
    if (withdrawn) {
      AuthorityGateway.withdrawnIds.add(canonicalId);
    } else {
      AuthorityGateway.withdrawnIds.delete(canonicalId);
    }
  }

  public static resolve(params: {
    tenant_id: string;
    canonical_ids: string[];
    legal_as_of_date: string;
    transaction_date: string;
    drafting_date: string;
    intended_filing_date?: string;
    expected_topic?: string;
  }): AuthoritySnapshot {
    if (AuthorityGateway.simulateTimeout) {
      return {
        id: `auth_snap_timeout_${Date.now()}`,
        tenant_id: params.tenant_id,
        canonical_ids: params.canonical_ids,
        legal_as_of_date: params.legal_as_of_date,
        transaction_date: params.transaction_date,
        drafting_date: params.drafting_date,
        intended_filing_date: params.intended_filing_date,
        retrieved_at: new Date().toISOString(),
        status: "unknown",
        provisions: [],
        findings: [
          "AuthorityGateway timeout: verification state is UNKNOWN. Final approval and export fail closed (AT20).",
        ],
      };
    }

    const provisions: AuthoritySnapshot["provisions"] = [];
    const findings: string[] = [];
    let overallStatus: AuthoritySnapshot["status"] = "verified";

    // Evaluate at the legally relevant date (transaction_date if historical, or legal_as_of_date) (LFDE-AUT-001, AT17)
    const targetEvalDate = params.transaction_date || params.legal_as_of_date;

    for (const cid of params.canonical_ids) {
      if (AuthorityGateway.withdrawnIds.has(cid)) {
        overallStatus = "withdrawn";
        findings.push(`Canonical authority ${cid} has been withdrawn or suspended.`);
        continue;
      }

      const entry = CANONICAL_AUTHORITY_CATALOG[cid];
      if (!entry) {
        overallStatus = "unknown";
        findings.push(`Canonical authority ${cid} not found in REG24 verified authority graph.`);
        continue;
      }

      const matchingVersion = entry.versions.find((v) => {
        const startsBefore = v.effective_from <= targetEvalDate;
        const endsAfter = !v.effective_to || v.effective_to >= targetEvalDate;
        return startsBefore && endsAfter;
      });

      if (!matchingVersion) {
        overallStatus = "unknown";
        findings.push(
          `No effective version of ${cid} covers relevant date ${targetEvalDate} (transaction_date=${params.transaction_date}, legal_as_of_date=${params.legal_as_of_date}).`
        );
        continue;
      }

      const supportsProposition = params.expected_topic
        ? matchingVersion.supported_topics.includes(params.expected_topic)
        : true;

      if (!supportsProposition) {
        findings.push(
          `Authority ${cid} (${matchingVersion.version_id}) exists at ${targetEvalDate} but does not support proposition topic '${params.expected_topic}' (AT18).`
        );
      }

      provisions.push({
        canonical_id: cid,
        version_id: matchingVersion.version_id,
        title_th: matchingVersion.title_th,
        title_en: matchingVersion.title_en,
        effective_from: matchingVersion.effective_from,
        effective_to: matchingVersion.effective_to,
        source_class: matchingVersion.source_class,
        content_hash: sha256Hex(matchingVersion.text_th),
        pinpoint: matchingVersion.pinpoint,
        supports_proposition: supportsProposition,
      });
    }

    return {
      id: `auth_snap_${sha256Hex(
        `${params.tenant_id}:${params.canonical_ids.join(",")}:${targetEvalDate}`
      ).slice(0, 14)}`,
      tenant_id: params.tenant_id,
      canonical_ids: params.canonical_ids,
      legal_as_of_date: params.legal_as_of_date,
      transaction_date: params.transaction_date,
      drafting_date: params.drafting_date,
      intended_filing_date: params.intended_filing_date,
      retrieved_at: new Date().toISOString(),
      status: overallStatus,
      provisions,
      findings,
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 11.6 & 13: WEBHOOK SSRF PROTECTION & HMAC SIGNING (AT37, AT38)
   ══════════════════════════════════════════════════════════════════════════ */

export function validateWebhookDestination(urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new LfdeException({
      code: "SSRF_BLOCKED",
      safe_message: "Invalid webhook destination URL.",
      correlation_id: "webhook_ssrf",
      retryable: false,
      http_status: 422,
    });
  }

  if (parsed.protocol !== "https:") {
    throw new LfdeException({
      code: "SSRF_BLOCKED",
      safe_message: "Webhook callback destination must use HTTPS.",
      correlation_id: "webhook_ssrf",
      retryable: false,
      http_status: 422,
    });
  }

  const host = parsed.hostname.toLowerCase();
  const forbiddenPatterns = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^169\.254\./,
    /^0\.0\.0\.0$/,
    /^\[::1\]$/,
    /\.internal$/,
    /\.local$/,
  ];

  if (forbiddenPatterns.some((re) => re.test(host))) {
    throw new LfdeException({
      code: "SSRF_BLOCKED",
      safe_message: `Webhook callback host '${host}' is blocked by private-network / metadata-service SSRF policy (AT37).`,
      correlation_id: "webhook_ssrf",
      retryable: false,
      http_status: 403,
    });
  }
}

export function signWebhookPayload(params: {
  event_id: string;
  key_id: string;
  secret: string;
  timestamp_sec: number;
  raw_body: string;
}): {
  signature: string;
  headers: Record<string, string>;
} {
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - params.timestamp_sec) > 300) {
    throw new LfdeException({
      code: "FORBIDDEN",
      safe_message: "Webhook timestamp outside 5-minute replay window (AT38).",
      correlation_id: "webhook_hmac",
      retryable: false,
      http_status: 403,
    });
  }
  const macInput = `${params.timestamp_sec}.${params.raw_body}`;
  const sig = createHmac("sha256", params.secret).update(macInput, "utf8").digest("hex");
  return {
    signature: sig,
    headers: {
      "X-REG24-Event-Id": params.event_id,
      "X-REG24-Key-Id": params.key_id,
      "X-REG24-Timestamp": String(params.timestamp_sec),
      "X-REG24-Signature": `v1=${sig}`,
    },
  };
}
