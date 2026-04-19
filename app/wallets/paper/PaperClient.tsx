"use client";
import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { usePaperPositions } from "@/lib/hooks/use-paper-positions";
import { PageHeader } from "@/components/page-header";
import { formatUsd, truncateAddress } from "@/lib/utils";
import type { MarketTickerEntry } from "@/app/api/market-ticker/route";
import { color, card as C, type as T, space, radius } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base, marginBottom: space.cardGap },
  hdr:   { ...C.header },
  title: { ...T.cardTitle },
  empty: { padding: "32px 20px", textAlign: "center" as const, color: color.textMuted, fontSize: "13px" },
  row: {
    padding:      "12px 20px",
    borderBottom: `1px solid ${color.divider}`,
    display:      "flex",
    alignItems:   "center",
    gap:          "10px",
    transition:   "background 0.12s",
  },
  asset: { fontFamily: "'Geist Mono', monospace", fontSize: "13px", fontWeight: 600, color: color.text, minWidth: "48px" },
  pill:  (side: string): React.CSSProperties => ({
    fontSize:   "10px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    padding:    "2px 6px",
    borderRadius: radius.dirPill,
    background: side === "long" ? color.longBg   : color.shortBg,
    border:     `1px solid ${side === "long" ? color.longBorder : color.shortBorder}`,
    color:      side === "long" ? color.green    : color.red,
  }),
  muted: { fontSize: "11px", color: color.textMuted, flexShrink: 0 as const, fontVariantNumeric: "tabular-nums" },
  pnl:   (v: number): React.CSSProperties => ({
    fontSize: "13px", fontVariantNumeric: "tabular-nums", flexShrink: 0,
    color: v >= 0 ? color.green : color.red,
  }),
  statGrid: { display: "flex", gap: space.cardGap, marginBottom: space.cardGap },
  statCard: { ...C.base, padding: "16px 20px", flex: 1 },
};

export function PaperClient() {
  const { positions, settings, updateSettings } = usePaperPositions();

  const { data: ticker } = useQuery<MarketTickerEntry[]>({
    queryKey:        ["market-ticker"],
    queryFn:         () => fetch("/api/market-ticker").then(r => r.json()),
    staleTime:       30_000,
    refetchInterval: 60_000,
  });

  const priceMap = new Map((ticker ?? []).map(t => [t.coin, t.price]));
  const open     = positions.filter(p => p.status === "open");
  const closed   = positions.filter(p => p.status === "closed");

  const unrealized = open.reduce((acc, p) => {
    const cur = priceMap.get(p.asset);
    return cur != null
      ? acc + (cur - p.entry_price) / p.entry_price * p.size_usd * (p.side === "long" ? 1 : -1)
      : acc;
  }, 0);

  const realized = closed.reduce((acc, p) => acc + (p.realized_pnl ?? 0), 0);

  const subtitle = `${open.length} open position${open.length === 1 ? "" : "s"}, ${closed.length} closed`;

  return (
    <div className="page-enter">
      <PageHeader title="Paper Trading" subtitle={subtitle} />
      <div style={{ ...S.page, paddingTop: "20px" }}>

        <div style={S.statGrid}>
          <div style={S.statCard}>
            <div style={T.statLabel}>Unrealized PnL</div>
            <div style={{ ...T.statValue, color: unrealized >= 0 ? color.green : color.red }}>
              {formatUsd(unrealized)}
            </div>
          </div>
          <div style={S.statCard}>
            <div style={T.statLabel}>Realized PnL</div>
            <div style={{ ...T.statValue, color: realized >= 0 ? color.green : color.red }}>
              {formatUsd(realized)}
            </div>
          </div>
          <div style={S.statCard}>
            <div style={T.statLabel}>Trade Size</div>
            <div style={{ ...T.statValue, fontSize: "26px", fontVariantNumeric: "tabular-nums" }}>
              ${settings.default_size_usd}
            </div>
            <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
              {[50, 100, 250, 500].map(v => (
                <button key={v} onClick={() => updateSettings({ default_size_usd: v })} draggable={false}
                  style={{
                    fontSize:   "11px",
                    fontWeight: 600,
                    padding:    "3px 8px",
                    borderRadius: "4px",
                    cursor:     "pointer",
                    border:     `1px solid ${settings.default_size_usd === v ? "rgba(255,255,255,0.25)" : color.border}`,
                    background: settings.default_size_usd === v ? "rgba(255,255,255,0.08)" : "transparent",
                    color:      settings.default_size_usd === v ? color.text : color.textMuted,
                  }}>
                  ${v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.hdr}><span style={S.title}>Open Positions</span></div>
          {open.length === 0 ? (
            <div style={S.empty}>No open positions. Follow a wallet with paper copy enabled.</div>
          ) : open.map(p => {
            const cur = priceMap.get(p.asset);
            const pnl = cur != null
              ? (cur - p.entry_price) / p.entry_price * p.size_usd * (p.side === "long" ? 1 : -1)
              : null;
            return (
              <div key={p.id} style={S.row}
                onMouseEnter={e => (e.currentTarget.style.background = color.rowHover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={S.asset}>{p.asset}</span>
                <span style={S.pill(p.side)}>{p.side.toUpperCase()}</span>
                <span style={{ ...S.muted, flex: 1 }}>
                  Entry ${p.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {cur != null && `, now $${cur.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </span>
                <span style={S.muted}>{truncateAddress(p.source_wallet)}</span>
                {pnl != null && (
                  <span style={S.pnl(pnl)}>{pnl >= 0 ? "+" : ""}{formatUsd(pnl)}</span>
                )}
              </div>
            );
          })}
        </div>

        {closed.length > 0 && (
          <div style={S.card}>
            <div style={S.hdr}><span style={S.title}>Closed Positions</span></div>
            {closed.map(p => (
              <div key={p.id} style={S.row}
                onMouseEnter={e => (e.currentTarget.style.background = color.rowHover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={S.asset}>{p.asset}</span>
                <span style={S.pill(p.side)}>{p.side.toUpperCase()}</span>
                <span style={{ ...S.muted, flex: 1 }}>
                  Entry ${p.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {p.exit_price != null && `, exit $${p.exit_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </span>
                <span style={S.muted}>{truncateAddress(p.source_wallet)}</span>
                {p.realized_pnl != null && (
                  <span style={S.pnl(p.realized_pnl)}>
                    {p.realized_pnl >= 0 ? "+" : ""}{formatUsd(p.realized_pnl)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
