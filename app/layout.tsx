// app/layout.tsx
import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { GlowInit } from "@/components/glow-init";
import { QueryProvider } from "@/components/query-provider";

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
        {/* Corner aura — oklch interpolation: perceptual color space eliminates sRGB banding */}
        <div aria-hidden="true" style={{
          position: "fixed",
          inset: 0,
          background: `
            radial-gradient(ellipse at 100% 100% in oklch,
              oklch(32%  0.06  170)  0%,
              oklch(25%  0.045 170) 18%,
              oklch(20%  0.032 170) 32%,
              oklch(15%  0.022 170) 45%,
              oklch(12%  0.014 170) 57%,
              oklch(8%   0.008 170) 68%,
              oklch(6%   0.004 170) 78%,
              oklch(3.5% 0     0)  100%),
            radial-gradient(ellipse at 100% 100% in oklab,
              oklch(16%  0.04  170)  0%,
              oklch(3.5% 0     0)  100%)
          `,
          pointerEvents: "none",
          zIndex: 0,
        }} />
        {/* Grain overlay — dithers residual banding */}
        <div aria-hidden="true" style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'%3E%3Cfilter id='n' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.90' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.15'/%3E%3C/svg%3E")`,
          opacity: 0.22,
          pointerEvents: "none",
          zIndex: 0,
        }} />
        <GlowInit />
        <QueryProvider>
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <Nav />
            <main
              style={{
                flex: 1,
                minWidth: 0,
                position: "relative",
                zIndex: 1,
                marginLeft: "200px",
              }}
              className="sidenav-main"
            >
              {children}
            </main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
