import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export interface VerifiedRevenueCodeSection {
  work_id: string;
  title_th: string;
  section_label: string;
  origin_uri: string;
  page_uri: string;
  anchor: string | null;
  artifact_sha256: string;
  artifact_size: number;
  effective_date_iso: string;
  effective_date_raw: string;
  date_status: "verified" | "unknown_restricted";
  verbatim_text: string;
}

export interface VerifiedSubregOrAmendmentWork {
  work_id: string;
  title_th: string;
  instrument_kind: string;
  origin_uri: string;
  artifact_sha256: string;
  artifact_size: number;
  effective_date_iso: string | null;
  effective_date_raw: string | null;
  date_status: "verified" | "unknown_restricted";
  verbatim_text: string;
}

export interface VerifiedStatutoryCorpus {
  schema_version: string;
  retrieved_from: string;
  revenue_code_sections: Record<string, VerifiedRevenueCodeSection>;
  subordinate_and_amendment_works: Record<string, VerifiedSubregOrAmendmentWork>;
}

export interface RecoveredRulingTextRecord {
  legacy_id: string;
  drive_rel_path: string;
  sha256: string;
  size_bytes: number;
  full_text: string;
}

let cachedStatutoryCorpus: VerifiedStatutoryCorpus | null = null;
let cachedRecoveredRulings: Record<string, RecoveredRulingTextRecord> | null = null;

export function getVerifiedStatutoryCorpus(): VerifiedStatutoryCorpus {
  if (cachedStatutoryCorpus) return cachedStatutoryCorpus;
  const gzPath = path.join(process.cwd(), "src", "core", "data", "verified-rd-statutory-corpus.json.gz");
  if (!fs.existsSync(gzPath)) {
    cachedStatutoryCorpus = {
      schema_version: "reg24.verified_statutory_corpus.v1.0",
      retrieved_from: "empty",
      revenue_code_sections: {},
      subordinate_and_amendment_works: {},
    };
    return cachedStatutoryCorpus;
  }
  const raw = zlib.gunzipSync(fs.readFileSync(gzPath)).toString("utf8");
  const parsed = JSON.parse(raw) as VerifiedStatutoryCorpus;
  const extraGazettePath = path.join(
    process.cwd(),
    "src",
    "core",
    "data",
    "verified-gazette-amendments.json"
  );
  if (fs.existsSync(extraGazettePath)) {
    const extra = JSON.parse(fs.readFileSync(extraGazettePath, "utf8")) as Record<
      string,
      VerifiedSubregOrAmendmentWork
    >;
    for (const [k, v] of Object.entries(extra)) {
      if (!parsed.subordinate_and_amendment_works[k]) {
        parsed.subordinate_and_amendment_works[k] = v;
      }
    }
  }
  cachedStatutoryCorpus = parsed;
  return cachedStatutoryCorpus;
}

export function getRecoveredB01RulingTexts(): Record<string, RecoveredRulingTextRecord> {
  if (cachedRecoveredRulings) return cachedRecoveredRulings;
  const jsonPath = path.join(process.cwd(), "src", "core", "data", "b01-recovered-ruling-texts.json");
  if (!fs.existsSync(jsonPath)) {
    cachedRecoveredRulings = {};
    return cachedRecoveredRulings;
  }
  cachedRecoveredRulings = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<
    string,
    RecoveredRulingTextRecord
  >;
  return cachedRecoveredRulings;
}
