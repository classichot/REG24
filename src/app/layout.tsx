import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REG24 — Modular Regulatory Infrastructure for AI | P0 Thailand Console",
  description:
    "Machine-readable regulatory intelligence infrastructure: One REG24 Core, Six Substantive Thai Legal Modules (Corporate, Contract, Civil & Commercial Code, Tax, Labor, BOI), Canonical Legal Store, Law-as-Code Rule Engine, and Unified MCP (2026-07-28) & REST Gateway.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-[#0050EF] selection:text-white">
        {children}
      </body>
    </html>
  );
}
