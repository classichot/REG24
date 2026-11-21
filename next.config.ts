import type { NextConfig } from "next";

const includePreviewStore =
  process.env.VERCEL_ENV === "preview" ||
  process.env.REG24_USE_B01_RC2_PREVIEW_STORE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: includePreviewStore
    ? {
        "/api/v1/knowledge/**/*": [
          "./data/knowledge-store-b01-rc2-staging/canonical-state.json.gz",
          "./data/knowledge-store-b01-rc2-staging/wal.jsonl",
          "./data/knowledge-store-b01-rc2-staging/artifacts/**/*",
          "./data/knowledge-store-b01-rc2-staging/projections/rel.B01.rc8_*",
          "./data/knowledge-store-b01-rc2-staging/reports/B01_*",
        ],
      }
    : undefined,
  outputFileTracingExcludes: includePreviewStore
    ? {
        "/**/*": [
          // Exclude legacy/prior-RC snapshots, non-runtime docs/scripts, and raw JSON sources
          // already compiled into Next.js server chunks from Preview serverless bundles.
          // All excluded files remain intact in Git for rollback and RC comparison.
          "./data/knowledge-store/**/*",
          "./data/foundation-vat-pilot/**/*",
          "./data/knowledge-store-b01-rc2-staging/projections/rel.B01.rc5_*",
          "./data/knowledge-store-b01-rc2-staging/projections/rel.B01.rc6_*",
          "./data/knowledge-store-b01-rc2-staging/projections/rel.B01.rc7_*",
          "./data/knowledge-store-b01-rc2-staging/reports/rel_B01_rc5_*",
          "./src/core/data/thai-tax-rulings-corpus.json",
          "./src/core/data/legal-resource-master-corpus.json",
          "./public/ocr-pilot-review-pdfs/**/*",
          "./docs/**/*",
          "./scripts/**/*",
          "./tests/**/*",
          "./.venv-nlp/**/*",
        ],
      }
    : undefined,
};

export default nextConfig;
