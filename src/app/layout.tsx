import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REG24 — Corporate & Commercial Legal Intelligence Infrastructure",
  description:
    "Thai corporate, commercial and regulatory intelligence powered by REG24 Core, Temporal Graph RAG, Law-as-Code Rule Engine, and Unified MCP & REST Gateway.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased selection:bg-[#0f2c59] selection:text-[#f5b700]">
        {children}
      </body>
    </html>
  );
}
