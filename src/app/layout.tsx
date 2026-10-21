import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#0a0e17",
};

export const metadata: Metadata = {
  title: "REG24 — Corporate & Commercial Legal Intelligence Infrastructure",
  description:
    "Thai corporate, commercial and regulatory intelligence powered by REG24 Core, Temporal Graph RAG, Law-as-Code Rule Engine, and Unified MCP & REST Gateway.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "REG24",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#f8fafc] text-[#0f172a] dark:bg-[#0a0e17] dark:text-slate-100 antialiased selection:bg-[#0f2c59] selection:text-[#f5b700]">
        {children}
      </body>
    </html>
  );
}
