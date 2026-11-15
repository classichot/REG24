import type { NextConfig } from "next";

const includePreviewStore =
  process.env.VERCEL_ENV === "preview" ||
  process.env.REG24_USE_B01_RC2_PREVIEW_STORE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: includePreviewStore
    ? {
        "/api/v1/knowledge/**/*": ["./data/knowledge-store-b01-rc2-staging/**/*"],
      }
    : undefined,
};

export default nextConfig;
