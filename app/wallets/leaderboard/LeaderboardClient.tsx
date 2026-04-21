"use client";
// app/wallets/leaderboard/LeaderboardClient.tsx — follow button enabled

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { formatUsd, formatPct, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";
import { FollowButton } from "@/components/follow-button";

function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  return (
    <span className="ios-pill" style={{
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase" as const,
      marginLeft: "6px",
      cursor: "default",
      padding: "2px 8px",
    }}>
      {tier}
    </span>
  );
}

const STYLE_COLORS: Record<string, string> = {
  SCALPER: color.amber,
  SWING:   "rgba(255,255,255,0.44)",
  TREND:   color.accent,
};

function StyleBadge({ style }: { style: string | null | undefined }) {
  if (!style) return null;
  return (
    <span style={{
      fontSize: "10px",
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const,
      marginLeft: "5px",
      padding: "2px 6px",
      borderRadius: "3px",
      border: `1px solid ${STYLE_COLORS[style] ?? "rgba(255,255,255,0.15)"}40`,
      color: STYLE_COLORS[style] ?? "rgba(255,255,255,0.44)",
      cursor: "default",
    }}>
      {style}
    </span>
  );
}

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  mono:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
  td:    { fontSize: "13px", padding: "12px 16px", borderBottom: `1px solid ${color.divider}` },
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
  { key: "overall_score",  label: "Quality"        },
  { key: "account_value",  label: "AUM"            },
  { key: "unrealized_pnl", label: "Open PnL"       },
  { key: "win_rate",       label: "Win Rate"       },
  { key: "position_count", label: "Positions"      },
  { key: "liq_buffer_pct", label: "Safety Margin"  },
];

export function LeaderboardClient({ initialData }: { initialData: CohortCachePayload | null }) {
  const router = useRouter();
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const [sort, setSort] = useState<SortKey>("overall_score");
  const [asc,  setAsc]  = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tierFilter, setTierFilter] = useState<string>("All");

  function handleSort(key: SortKey) {
    if (key === sort) setAsc((a) => !a);
    else { setSort(key); setAsc(false); }
  }

  const TIERS = ["All", "Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"];

  const sorted = data
    ? [...data.top_wallets]
        .filter((w) => tierFilter === "All" || w.equity_tier === tierFilter)
        .sort((a, b) => {
        let av: number | string, bv: number | string;
        if (sort === "address")             { av = a.address ?? "";        bv = b.address ?? ""; }
        else if (sort === "win_rate")       { av = a.win_rate ?? 0;        bv = b.win_rate ?? 0; }
        else if (sort === "liq_buffer_pct") { av = a.liq_buffer_pct ?? 0; bv = b.liq_buffer_pct ?? 0; }
        else { av = (a as never)[sort] as number ?? 0; bv = (b as never)[sort] as number ?? 0; }
        if (typeof av === "string") return asc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
        return asc ? (av - (bv as number)) : ((bv as number) - av);
      })
    : [];

  const displayed = showAll ? sorted : sorted.slice(0, 50);

  return (
    <div className="page-enter">
      <PageHeader
        title="Leaderboard"
        subtitle={data ? `Smart Money ranked by composite score · ${data.total_active_wallets ?? data.wallet_count} active` : "Smart Money ranked by composite score"}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" as const }}>
          {TIERS.map((t) => (
            <button key={t} onClick={() => setTierFilter(t)}
              style={{
                fontSize: "11px", fontWeight: 600,
                padding: "4px 12px", borderRadius: "5px",
                border: "1px solid",
                cursor: "pointer",
                background: tierFilter === t ? "rgba(255,255,255,0.10)" : "transparent",
                borderColor: tierFilter === t ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                color: tierFilter === t ? color.text : "rgba(255,255,255,0.45)",
                transition: "all 0.15s",
              }}>
              {t}
            </button>
          ))}
        </div>
        <div style={S.card}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: color.bg }}>
                <th style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", padding: "12px 16px", textAlign: "left", userSelect: "none", width: "40px" }}>#</th>
                {COLS.map(({ key, label }) => (
                  <th key={key} onClick={() => data && handleSort(key)}
                    style={{
                      fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
                      textTransform: "uppercase" as const,
                      color: sort === key ? color.text : "rgba(255,255,255,0.5)",
                      padding: "12px 16px", textAlign: "left" as const,
                      cursor: data ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" as const,
                    }}>
                    {label}
                    {data && (
                      <span style={{ marginLeft: "5px", opacity: sort === key ? 0.7 : 0, transition: "opacity 0.15s" }}>
                        {asc ? "↑" : "↓"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} style={ghost(i * 0.08)}>
                    <td style={S.td}><div style={bone(16)} /></td>
                    <td style={S.td}><div style={bone(110)} /></td>
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 48, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }} />
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
                displayed.map((w, i) => (
                  <tr key={w.wallet_id} style={{ transition: "background 0.1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = color.rowHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...S.td, color: "rgba(255,255,255,0.32)" }}>{i + 1}</td>
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button onClick={() => router.push(`/wallets/discovery?address=${w.address}`)}
                          style={{ ...S.mono, color: color.neutral, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" as const }}>
                          {truncateAddress(w.address)}
                        </button>
                        <TierBadge tier={w.equity_tier} />
                        <StyleBadge style={w.trading_style} />
                        <FollowButton address={w.address} />
                      </div>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "48px", height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                          <div style={{ width: `${w.overall_score * 100}%`, height: "100%", background: color.neutral, borderRadius: "2px" }} />
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: color.text }}>{w.overall_score.toFixed(2)}</span>
                      </div>
                    </td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{formatUsd(w.account_value)}</td>
                    <td style={{ ...S.td, color: w.unrealized_pnl >= 0 ? color.green : color.red, fontVariantNumeric: "tabular-nums" }}>{formatUsd(w.unrealized_pnl)}</td>
                    <td style={S.td}>{w.win_rate != null ? formatPct(w.win_rate) : "n/a"}</td>
                    <td style={S.td}>{w.position_count}</td>
                    <td style={{ ...S.td, color: (w.liq_buffer_pct ?? 1) < 0.15 ? color.red : "rgba(255,255,255,0.69)" }}>
                      {w.liq_buffer_pct != null ? formatPct(w.liq_buffer_pct) : "n/a"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {data && !showAll && sorted.length > 50 && (
            <button onClick={() => setShowAll(true)}
              style={{ width: "100%", padding: "14px", fontSize: "13px", color: "rgba(255,255,255,0.38)", background: "transparent", border: "none", borderTop: `1px solid ${color.divider}`, cursor: "pointer", transition: "color 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.72)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.38)")}>
              Show all {sorted.length} wallets
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
