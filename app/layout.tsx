// app/layout.tsx
// Scrim-gradient: eased opacity coordinates that eliminate browser banding
// (same technique as PostCSS scrim-gradient plugin, applied to radial)
const SCRIM = [
  [0,    1.000], [19,   0.738], [34,   0.541], [47,   0.382],
  [56.5, 0.278], [65,   0.194], [73,   0.126], [80.2, 0.075],
  [86.1, 0.042], [91,   0.021], [95.2, 0.008], [98.2, 0.002],
  [100,  0.000],
] as const;

function scrimRadial(r: number, g: number, b: number, maxA: number): string {
  const stops = SCRIM.map(([pct, f]) => `rgba(${r},${g},${b},${+(maxA * f).toFixed(4)}) ${pct}%`);
  return `radial-gradient(ellipse at 100% 100%, ${stops.join(", ")})`;
}

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
      <body className="bg-[#060606] text-[#f0f0f0] font-[family-name:var(--font-inter)] antialiased min-h-screen">
        {/* Corner aura — scrim-gradient technique, eased stops kill browser banding */}
        <div aria-hidden="true" style={{
          position: "fixed",
          bottom: 0,
          right: 0,
          width: "100vw",
          height: "100vh",
          backgroundImage: [
            scrimRadial(151, 253, 229, 0.20),
            scrimRadial(7, 39, 35, 0.30),
          ].join(", "),
          pointerEvents: "none",
          zIndex: 0,
        }} />
        {/* Grain overlay — dithers residual banding */}
        <div aria-hidden="true" style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          opacity: 0.22,
          pointerEvents: "none",
          zIndex: 0,
        }} />
        <Nav />
        <main className="min-h-[calc(100vh-52px)]" style={{ position: "relative", zIndex: 1 }}>{children}</main>
      </body>
    </html>
  );
}
