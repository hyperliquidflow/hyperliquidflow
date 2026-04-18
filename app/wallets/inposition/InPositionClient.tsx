"use client";
// app/wallets/inposition/InPositionClient.tsx

import { useState } from "react";
import type React from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { formatUsd, formatPct, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload, SpotlightWallet } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space, radius } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  muted: { color: color.textMuted, fontSize: "13px" },
  mono:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
  td:    { fontSize: "13px", padding: "12px 16px", borderBottom: `1px solid ${color.divider}` },

  // Spotlight grid
  spotGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
    gap: space.cardGap, marginBottom: space.cardGap,
  } as React.CSSProperties,

  // Spotlight card: standard border, no color tint
  spotCard: {
    ...C.base,
    padding: space.walletItemPadding,
    cursor: "pointer",
    transition: "border-color 0.2s, background 0.2s",
  } as React.CSSProperties,

  // Address: full string, CSS handles overflow (type.walletAddr)
  spotAddr: {
    ...T.walletAddr,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
    marginTop: 0,
  } as React.CSSProperties,

  // Body row: PnL left, AUM + positions right
  spotBody: {
    display: "flex", justifyContent: "space-between",
    alignItems: "flex-end", gap: "12px", marginTop: "10px",
  } as React.CSSProperties,

  // PnL at type.statValue size (32px)
  spotPnl: {
    fontSize: "32px", fontWeight: 700,
    lineHeight: 1, fontVariantNumeric: "tabular-nums",
  } as React.CSSProperties,

  // AUM | positions inline right at 16px color.text
  spotCtx: {
    display: "flex", alignItems: "center",
    flexShrink: 0, paddingBottom: "2px",
    fontSize: "16px", color: color.text,
    fontVariantNumeric: "tabular-nums",
  } as React.CSSProperties,

  spotCtxDivider: {
    width: "1px", height: "14px",
    background: color.border,
    margin: "0 12px", flexShrink: 0,
  } as React.CSSProperties,

  // Score row: tertiary indicator below divider
  spotScoreRow: {
    display: "flex", alignItems: "center", gap: "8px",
    marginTop: "12px", paddingTop: "10px",
    borderTop: `1px solid ${color.divider}`,
  } as React.CSSProperties,

  spotBarTrack: {
    flex: 1, height: "3px", borderRadius: radius.bar,
    background: color.barBg, overflow: "hidden" as const,
  } as React.CSSProperties,

  spotBarFill: {
    height: "100%", borderRadius: radius.bar,
    background: color.neutral,
  } as React.CSSProperties,

  spotScoreNum: {
    fontSize: "11px", fontWeight: 600,
    color: color.textMuted, fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  } as React.CSSProperties,
};

const bone = (w: string | number, h = 9): React.CSSProperties => ({
  height: h, width: w, borderRadius: 3, background: "rgba(255,255,255,0.07)", flexShrink: 0,
});
const ghost = (delay = 0): React.CSSProperties => ({
  animation: `slide-up-ghost 2.4s ease-in-out ${delay}s infinite`,
});

type SortKey = "address" | "overall_score" | "account_value" | "unrealized_pnl" | "win_rate" | "position_count" | "liq_buffer_pct";

const COLS: { key: SortKey; label: string }[] = [
  { key: "address",        label: "Wallet"     },
  { key: "overall_score",  label: "Score"      },
  { key: "account_value",  label: "AUM"        },
  { key: "unrealized_pnl", label: "uPnL"       },
  { key: "win_rate",       label: "Win Rate"   },
  { key: "position_count", label: "Positions"  },
  { key: "liq_buffer_pct", label: "Liq Buffer" },
];

export function InPositionClient({ initialData }: { initialData: CohortCachePayload | null }) {
  const router = useRouter();
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const [sort, setSort] = useState<SortKey>("unrealized_pnl");
  const [asc,  setAsc]  = useState(false);

  function handleSort(key: SortKey) {
    if (key === sort) setAsc((a) => !a);
    else { setSort(key); setAsc(false); }
  }

  const spotlightBase: SpotlightWallet[] | null = data?.spotlight_positions
    ? [...data.spotlight_positions].sort((a, b) => b.unrealized_pnl - a.unrealized_pnl)
    : null;
  const topProfit = spotlightBase?.slice(0, 3) ?? null;
  const topLoss   = spotlightBase ? [...spotlightBase].slice(-3).reverse() : null;

  const inPosition = data
    ? [...data.top_wallets]
        .filter((w) => w.position_count > 0)
        .sort((a, b) => {
          let av: number | string, bv: number | string;
          if (sort === "address")             { av = a.address ?? "";        bv = b.address ?? ""; }
          else if (sort === "win_rate")       { av = a.win_rate ?? 0;        bv = b.win_rate ?? 0; }
          else if (sort === "liq_buffer_pct") { av = a.liq_buffer_pct ?? 0; bv = b.liq_buffer_pct ?? 0; }
          else { av = (a as never)[sort] as number ?? 0; bv = (b as never)[sort] as number ?? 0; }
          if (typeof av === "string") return asc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
          return asc ? (av - (bv as number)) : ((bv as number) - av);
        })
    : null;

  return (
    <div className="page-enter">
      <PageHeader
        title="In Position"
        subtitle={inPosition ? `${inPosition.length} wallets with open positions right now` : "Wallets with open positions right now"}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>

        {/* Spotlight: top 3 profitable, top 3 underwater */}
        {(["profit", "loss"] as const).map((variant) => {
          const wallets  = variant === "profit" ? topProfit : topLoss;
          const pnlColor = variant === "profit" ? color.green : color.red;
          return (
            <div key={variant} style={S.spotGrid}>
              {wallets
                ? wallets.map((w) => (
                    <div key={w.wallet_id}
                      style={S.spotCard}
                      className="glow-btn"
                      onClick={() => router.push(`/wallets/discovery?address=${w.address}`)}>
                      <div style={S.spotAddr}>{w.address}</div>
                      <div style={S.spotBody}>
                        <div style={{ ...S.spotPnl, color: pnlColor }}>
                          {variant === "profit" && w.unrealized_pnl > 0 ? "+" : ""}{formatUsd(w.unrealized_pnl)}
                        </div>
                        <div style={S.spotCtx}>
                          <span>{formatUsd(w.account_value)} AUM</span>
                          <div style={S.spotCtxDivider} />
                          <span>{w.position_count} positions</span>
                        </div>
                      </div>
                      <div style={S.spotScoreRow}>
                        <div style={S.spotBarTrack}>
                          <div style={{ ...S.spotBarFill, width: `${w.overall_score * 100}%` }} />
                        </div>
                        <span style={S.spotScoreNum}>{w.overall_score.toFixed(2)}</span>
                      </div>
                    </div>
                  ))
                : Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} style={S.spotCard}>
                      <div style={{ ...bone("80%", 11), ...ghost(i * 0.08) }} />
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "10px" }}>
                        <div style={{ ...bone(100, 26), ...ghost(i * 0.08) }} />
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
                          <div style={{ ...bone(80, 13), ...ghost(i * 0.08) }} />
                          <div style={{ ...bone(60, 13), ...ghost(i * 0.08) }} />
                        </div>
                      </div>
                      <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: `1px solid ${color.divider}` }}>
                        <div style={{ ...bone("100%", 3), ...ghost(i * 0.08) }} />
                      </div>
                    </div>
                  ))}
            </div>
          );
        })}

        <div style={S.card}>
          {inPosition?.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No wallets with open positions right now</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: color.bg }}>
                  <th style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: color.textMuted, padding: "12px 16px", textAlign: "left", userSelect: "none", width: "40px" }}>#</th>
                  {COLS.map(({ key, label }) => (
                    <th key={key} onClick={() => inPosition && handleSort(key)}
                      style={{
                        fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase" as const,
                        color: sort === key ? color.text : color.textMuted,
                        padding: "12px 16px", textAlign: "left" as const,
                        cursor: inPosition ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" as const,
                      }}>
                      {label}
                      {inPosition && (
                        <span style={{ marginLeft: "5px", opacity: sort === key ? 0.7 : 0, transition: "opacity 0.15s" }}>
                          {asc ? "↑" : "↓"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!inPosition ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} style={ghost(i * 0.08)}>
                      <td style={S.td}><div style={bone(16)} /></td>
                      <td style={S.td}><div style={bone(110)} /></td>
                      <td style={S.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 48, height: 3, borderRadius: 2, background: color.barBg }} />
                          <div style={bone(28)} />
                        </div>
                      </td>
                      <td style={S.td}><div style={bone(70)} /></td>
                      <td style={S.td}><div style={bone(70)} /></td>
                      <td style={S.td}><div style={bone(48)} /></td>
                      <td style={S.td}><div style={bone(24)} /></td>
                      <td style={S.td}><div style={bone(48)} /></td>
                    </tr>
                  ))
                ) : (
                  inPosition.map((w, i) => (
                    <tr key={w.wallet_id} style={{ transition: "background 0.1s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = color.rowHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ ...S.td, color: color.textDim }}>{i + 1}</td>
                      <td style={S.td}>
                        <button onClick={() => router.push(`/wallets/discovery?address=${w.address}`)}
                          style={{ ...S.mono, color: color.neutral, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" as const }}>
                          {truncateAddress(w.address)}
                        </button>
                      </td>
                      <td style={S.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ width: "48px", height: "3px", background: color.barBg, borderRadius: radius.bar }}>
                            <div style={{ width: `${w.overall_score * 100}%`, height: "100%", background: color.neutral, borderRadius: radius.bar }} />
                          </div>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: color.text }}>{w.overall_score.toFixed(2)}</span>
                        </div>
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{formatUsd(w.account_value)}</td>
                      <td style={{ ...S.td, color: w.unrealized_pnl >= 0 ? color.green : color.red, fontVariantNumeric: "tabular-nums" }}>{formatUsd(w.unrealized_pnl)}</td>
                      <td style={S.td}>{w.win_rate != null ? formatPct(w.win_rate) : "n/a"}</td>
                      <td style={S.td}>{w.position_count}</td>
                      <td style={{ ...S.td, color: (w.liq_buffer_pct ?? 1) < 0.15 ? color.red : color.text }}>
                        {w.liq_buffer_pct != null ? formatPct(w.liq_buffer_pct) : "n/a"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
