"use client";
// app/coin/MarketsClient.tsx
// Where the tracked book actually sits, one row per coin. Every row opens the
// coin page, which is where the exchange-wide facts live.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import { formatUsd } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import type { MarketsPayload } from "@/app/api/markets/route";
import type { PositioningPayload } from "@/app/api/positioning/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  muted: { fontSize: "13px", color: color.textMuted },
  th: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase" as const, color: color.textMuted,
    padding: "10px 16px", textAlign: "left" as const, userSelect: "none" as const,
    whiteSpace: "nowrap" as const,
  },
  td: {
    fontSize: "13px", padding: "11px 16px",
    borderTop: `1px solid ${color.divider}`, whiteSpace: "nowrap" as const,
    fontVariantNumeric: "tabular-nums" as const,
  },
};

export function MarketsClient({ initialData }: { initialData: CohortCachePayload | null }) {
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  // Exchange facts, joined per row so the table can be read for cost of carry.
  const { data: mkts } = useQuery<MarketsPayload>({
    queryKey:        ["markets-ctx"],
    queryFn:         () => fetch("/api/markets").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime:       55_000,
  });
  const ctxByCoin = new Map((mkts?.markets ?? []).map((m) => [m.coin, m]));

  // Who is winning, and how are they positioned? The plainest read on the page.
  const { data: pos } = useQuery<PositioningPayload>({
    queryKey:        ["positioning"],
    queryFn:         () => fetch("/api/positioning").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime:       55_000,
  });

  const coins = (data?.coin_exposure ?? []).filter((e) => e.notional > 0);

  return (
    <div className="page-enter">
      <PageHeader
        title="Markets"
        subtitle="Coins the tracked cohort holds, by size of book"
        updatedAt={data?.updated_at}
      />

      <div style={{ ...S.page, paddingTop: space.contentPaddingTop }}>

        {pos && pos.buckets?.length > 0 && (
          <div style={{ ...S.card, marginBottom: space.cardGap }}>
            <div style={{ ...C.header }}>
              <span style={{ ...T.cardTitle }}>Which side is winning</span>
              <span style={{ ...T.cardLink, marginLeft: "auto", cursor: "default" }}>
                {pos.total_positions} positions, {pos.wallets} wallets
              </span>
            </div>
            <div style={{ padding: space.cardBodyPadding, display: "flex", flexDirection: "column", gap: "14px" }}>
              {pos.buckets.map((b) => {
                const shortPct = b.pct_short_notional ?? 0;
                return (
                  <div key={b.label} style={{ display: "grid", gridTemplateColumns: "190px 1fr 96px", alignItems: "center", gap: "14px" }}>
                    <span style={{ fontSize: "13px", color: color.textMuted }}>{b.label}</span>
                    <div style={{ height: "8px", background: color.barBg, borderRadius: 2, overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${100 - shortPct}%`, background: color.green }} />
                      <div style={{ width: `${shortPct}%`,       background: color.red }} />
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums",
                                   color: shortPct >= 60 ? color.red : shortPct <= 40 ? color.green : color.textMuted }}>
                      {shortPct.toFixed(0)}% short
                    </span>
                  </div>
                );
              })}
              <div style={{ ...S.muted, borderTop: `1px solid ${color.divider}`, paddingTop: "10px" }}>
                Share of notional on the short side. A position showing the largest open profit is
                winning right now, so in a falling market it is usually short. Read the gap between
                the rows, not any row on its own.
              </div>
            </div>
          </div>
        )}

        <div style={S.card}>
          {coins.length === 0 ? (
            <div style={{ padding: space.cardBodyPadding, ...S.muted }}>No open cohort positions right now.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Coin", "24h", "Open Interest", "Funding 1h", "Book", "Net side"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coins.map((e) => {
                  const sided = e.long_notional != null && e.short_notional != null;
                  const net   = e.net_pct ?? 0;
                  const netClr = !sided ? color.textMuted : net >= 20 ? color.green : net <= -20 ? color.red : color.textMuted;
                  const m = ctxByCoin.get(e.coin);
                  return (
                    <tr key={e.coin}>
                      <td style={S.td}>
                        <Link href={`/coin/${encodeURIComponent(e.coin)}`} draggable={false}
                          style={{ fontWeight: 700, color: color.text, textDecoration: "none", letterSpacing: "0.04em" }}>
                          {e.coin}
                        </Link>
                      </td>
                      <td style={{ ...S.td, color: !m ? color.textMuted : m.change24h >= 0 ? color.green : color.red }}>
                        {m ? `${m.change24h >= 0 ? "+" : ""}${(m.change24h * 100).toFixed(2)}%` : "--"}
                      </td>
                      <td style={S.td}>{m ? formatUsd(m.open_interest) : "--"}</td>
                      <td style={{ ...S.td, color: !m ? color.textMuted : m.funding1h >= 0 ? color.green : color.red }}>
                        {m ? `${m.funding1h >= 0 ? "+" : ""}${(m.funding1h * 100).toFixed(4)}%` : "--"}
                      </td>
                      <td style={S.td}>{formatUsd(e.notional)}</td>
                      <td style={{ ...S.td, color: netClr, fontWeight: 700 }}>
                        {sided ? `${net > 0 ? "+" : ""}${net}%` : "n/a"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ ...S.muted, marginTop: "10px", paddingBottom: space.contentPaddingBot }}>
          Open interest, funding and the 24h move are exchange-wide and verifiable against
          Hyperliquid. Book and net side describe the tracked cohort only. Net side runs from
          +100%, every dollar long, to -100%, every dollar short. This describes positions held,
          not a recommendation.
        </div>
      </div>
    </div>
  );
}
