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
        {/* Corner aura — ease-out-sine baked into stops (cos curve), hue-matched transparents */}
        <div aria-hidden="true" style={{
          position: "fixed",
          bottom: 0,
          right: 0,
          width: "100vw",
          height: "100vh",
          backgroundImage: [
            // Teal accent: 0.20→0 over 70%, cosine-eased stops
            "radial-gradient(ellipse at 100% 100%, rgba(151,253,229,0.20) 0%, rgba(151,253,229,0.19) 14%, rgba(151,253,229,0.16) 28%, rgba(151,253,229,0.12) 42%, rgba(151,253,229,0.06) 56%, rgba(151,253,229,0) 70%)",
            // Dark teal bloom: 0.30→0 over 60%, cosine-eased stops
            "radial-gradient(ellipse at 100% 100%, rgba(7,39,35,0.30) 0%, rgba(7,39,35,0.28) 12%, rgba(7,39,35,0.24) 24%, rgba(7,39,35,0.18) 36%, rgba(7,39,35,0.09) 48%, rgba(7,39,35,0) 60%)",
          ].join(", "),
          pointerEvents: "none",
          zIndex: 0,
        }} />
        {/* Grain overlay — dithers residual banding */}
        <div aria-hidden="true" style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          opacity: 0.07,
          pointerEvents: "none",
          zIndex: 0,
        }} />
        <Nav />
        <main className="min-h-[calc(100vh-52px)]" style={{ position: "relative", zIndex: 1 }}>{children}</main>
      </body>
    </html>
  );
}
