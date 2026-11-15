import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export interface B02DriveManifestEntry {
  folder: string;
  rel_path: string;
  file_name: string;
  ext: string;
  size: number;
  sha256: string;
  page_count: number;
  file_route: string;
  routes: {
    native: number;
    repaired: number;
    ocr: number;
    corrupt: number;
    noncontent: number;
  };
  disposition:
    | "PUBLISHED_NEW"
    | "REUSED_EXISTING"
    | "ATTACHED_REPRESENTATION"
    | "REJECTED_OUT_OF_SCOPE"
    | "DEFERRED_WITH_REASON";
  reason: string | null;
  companion_of: string | null;
  title_hint?: string;
  pages_sample?: Array<{ p: number; t: string }>;
  text_excerpt: string;
}

export interface B02RarExpandedMember {
  parent_rar: string;
  rel_path: string;
  file_name: string;
  size: number;
  sha256: string;
  page_count: number;
  file_route: string;
  routes: {
    native: number;
    repaired: number;
    ocr: number;
    corrupt: number;
    noncontent: number;
  };
  title_hint?: string;
  pages_sample?: Array<{ p: number; t: string }>;
  text_excerpt: string;
}

export interface B02DriveManifest {
  schema_version: string;
  total_physical_files: number;
  disposition_counts: Record<string, number>;
  files: B02DriveManifestEntry[];
  rar_expanded_members: B02RarExpandedMember[];
}

let cachedB02Manifest: B02DriveManifest | null = null;

export function getB02DriveManifest(): B02DriveManifest {
  if (cachedB02Manifest) return cachedB02Manifest;
  const gzPath = path.join(process.cwd(), "src", "core", "data", "b02-drive-manifest.json.gz");
  if (!fs.existsSync(gzPath)) {
    return {
      schema_version: "reg24.b02_drive_manifest.v1.0",
      total_physical_files: 0,
      disposition_counts: {},
      files: [],
      rar_expanded_members: [],
    };
  }
  const raw = zlib.gunzipSync(fs.readFileSync(gzPath)).toString("utf8");
  cachedB02Manifest = JSON.parse(raw) as B02DriveManifest;
  return cachedB02Manifest;
}
