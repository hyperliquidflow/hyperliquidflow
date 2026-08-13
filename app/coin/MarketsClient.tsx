"use client";
// app/coin/MarketsClient.tsx
// Where the tracked book actually sits, one row per coin. Every row opens the
// coin page, which is where the exchange-wide facts live.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import { formatUsd } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, space } from "@/lib/design-tokens";

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

  const coins = (data?.coin_exposure ?? []).filter((e) => e.notional > 0);

  return (
    <div className="page-enter">
      <PageHeader
        title="Markets"
        subtitle="Coins the tracked cohort holds, by size of book"
        updatedAt={data?.updated_at}
      />

      <div style={{ ...S.page, paddingTop: space.contentPaddingTop }}>
        <div style={S.card}>
          {coins.length === 0 ? (
            <div style={{ padding: space.cardBodyPadding, ...S.muted }}>No open cohort positions right now.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Coin", "Book", "Share", "Net side", "Long", "Short"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coins.map((e) => {
                  const sided = e.long_notional != null && e.short_notional != null;
                  const net   = e.net_pct ?? 0;
                  const netClr = !sided ? color.textMuted : net >= 20 ? color.green : net <= -20 ? color.red : color.textMuted;
                  return (
                    <tr key={e.coin}>
                      <td style={S.td}>
                        <Link href={`/coin/${encodeURIComponent(e.coin)}`} draggable={false}
                          style={{ fontWeight: 700, color: color.text, textDecoration: "none", letterSpacing: "0.04em" }}>
                          {e.coin}
                        </Link>
                      </td>
                      <td style={S.td}>{formatUsd(e.notional)}</td>
                      <td style={{ ...S.td, color: color.textMuted }}>{e.pct}%</td>
                      <td style={{ ...S.td, color: netClr, fontWeight: 700 }}>
                        {sided ? `${net > 0 ? "+" : ""}${net}%` : "n/a"}
                      </td>
                      <td style={{ ...S.td, color: color.green }}>{sided ? formatUsd(e.long_notional ?? 0) : "n/a"}</td>
                      <td style={{ ...S.td, color: color.red }}>{sided ? formatUsd(e.short_notional ?? 0) : "n/a"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ ...S.muted, marginTop: "10px", paddingBottom: space.contentPaddingBot }}>
          Net side runs from +100%, every dollar long, to -100%, every dollar short. This describes
          positions held, not a recommendation.
        </div>
      </div>
    </div>
  );
}
