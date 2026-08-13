"use client";
// components/coin-tag.tsx
// The one clickable coin symbol. Every rendered coin in the app routes here, so
// the coin page is the destination the rest of the product feeds.

import Link from "next/link";
import { color, type as T, radius } from "@/lib/design-tokens";

export function CoinTag({ coin, plain = false }: { coin: string; plain?: boolean }) {
  if (!coin) return null;

  // plain: inherit the caller's type, for coin names inside dense rows.
  const style = plain
    ? { color: "inherit", textDecoration: "none" }
    : { ...T.sigCoinTag, textDecoration: "none", borderRadius: radius.tag, display: "inline-block" };

  return (
    <Link
      href={`/coin/${encodeURIComponent(coin.toUpperCase())}`}
      draggable={false}
      className="glow-btn"
      style={{ ...style, cursor: "pointer", transition: "color 0.15s" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = color.text)}
      onMouseLeave={(e) => (e.currentTarget.style.color = plain ? "inherit" : (T.sigCoinTag.color as string))}
    >
      {coin}
    </Link>
  );
}
