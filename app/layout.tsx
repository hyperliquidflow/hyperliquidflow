// app/layout.tsx
import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HyperliquidFLOW — Smart Money Sentinel",
  description:
    "Free autonomous dashboard tracking the top 500 Hyperliquid wallets. For educational purposes only. Not financial advice.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="bg-[#090909] text-[#f0f0f0] font-[family-name:var(--font-inter)] antialiased min-h-screen">
        {/* Corner aura — blur dissolves all edges, no ring artifact */}
        <div aria-hidden="true" style={{
          position: "fixed",
          bottom: "-8vh",
          right: "-8vw",
          width: "75vw",
          height: "75vh",
          background: "radial-gradient(ellipse at 100% 100%, rgba(151,253,229,0.22) 0%, rgba(7,39,35,0.18) 35%, transparent 68%)",
          filter: "blur(72px)",
          pointerEvents: "none",
          zIndex: 0,
        }} />
        <Nav />
        <main className="min-h-[calc(100vh-52px)]" style={{ position: "relative", zIndex: 1 }}>{children}</main>
      </body>
    </html>
  );
}
