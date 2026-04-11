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
        {/* Corner aura — brightest at the exact bottom-right corner, no visible edge */}
        <div aria-hidden="true" style={{
          position: "fixed",
          bottom: 0,
          right: 0,
          width: "100vw",
          height: "100vh",
          background: `radial-gradient(ellipse at 100% 100%,
            rgba(151,253,229,0.13)  0%,
            rgba(140,240,210,0.09) 10%,
            rgba(90,180,155,0.06)  22%,
            rgba(40,110,90,0.038)  35%,
            rgba(15,60,50,0.020)   48%,
            rgba(9,45,38,0.010)    60%,
            rgba(7,39,35,0.004)    70%,
            transparent            80%
          )`,
          pointerEvents: "none",
          zIndex: 0,
        }} />
        <Nav />
        <main className="min-h-[calc(100vh-52px)]" style={{ position: "relative", zIndex: 1 }}>{children}</main>
      </body>
    </html>
  );
}
