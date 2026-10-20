import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "REG24 — Thai Corporate & Regulatory Intelligence",
    short_name: "REG24",
    description:
      "Thai corporate, commercial, tax rulings (3,643 RD rulings) and regulatory intelligence infrastructure powered by Neo4j AuraDB & Google Gemini.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0e17",
    theme_color: "#0f2c59",
    categories: ["business", "productivity", "reference", "education"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
