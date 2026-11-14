/**
 * REG24 — Verified Physical Drive Manifest Loader (`5,150` Files in `RD - Revenue Department`)
 *
 * Reconciles 100% of physical files in `1sJHpmTR1uEiEcFo3B0bVSfkX1P5HPsi6` with zero deferred gaps:
 * - `4,578` B01 ruling files (`4,574` PDFs + `4` official HTMLs across `6,804` physical pages)
 * - `572` B02-owned RD non-ruling regulations & root index files (`REJECTED_OUT_OF_SCOPE` for B01)
 */

import rawDriveManifest from "./rd-5150-drive-manifest.json";

export interface RdDriveRulingFileEntry {
  rel_path: string;
  sha256: string;
  size: number;
  ext: string;
  page_count: number;
  scanned_pages: number;
  authenticity_status: "official_html" | "html_rendered_pdf" | "verified_pdf";
  corpus_id: string;
  ruling_no: string;
  date: string;
  iso_date: string;
  source_url: string;
}

export interface RdDriveNonRulingFileEntry {
  kind: string;
  rel_path: string;
  folder: string;
  ext: string;
  size: number;
  sha256: string;
}

export interface RdDriveManifestData {
  source_root: string;
  drive_folder_id: string;
  extracted_at: string;
  total_physical_files: number;
  b01_ruling_files_count: number;
  b02_and_index_files_count: number;
  total_ruling_pages: number;
  scanned_ruling_pages: number;
  added_new_corpus_rulings: number;
  merged_corpus_total: number;
  ruling_files: RdDriveRulingFileEntry[];
  non_ruling_files: RdDriveNonRulingFileEntry[];
}

export const RD_DRIVE_MANIFEST: RdDriveManifestData =
  rawDriveManifest as unknown as RdDriveManifestData;

export const RD_DRIVE_RULING_BY_PATH = new Map<string, RdDriveRulingFileEntry>(
  RD_DRIVE_MANIFEST.ruling_files.map((entry) => [entry.rel_path, entry])
);
