"use client";
// app/wallets/inposition/page.tsx — Wallets currently holding open positions

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { formatUsd, formatPct, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";
import { InPositionLoadingState } from "@/components/loading-state";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  mono:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
  td:    { fontSize: "13px", padding: "12px 16px", borderBottom: `1px solid ${color.divider}` },
};

type SortKey = "address" | "overall_score" | "account_value" | "unrealized_pnl" | "win_rate" | "position_count" | "liq_buffer_pct";

const COLS: { key: SortKey; label: string }[] = [
  { key: "address",        label: "Wallet"    },
  { key: "overall_score",  label: "Score"     },
  { key: "account_value",  label: "AUM"       },
  { key: "unrealized_pnl", label: "uPnL"      },
  { key: "win_rate",       label: "Win Rate"  },
  { key: "position_count", label: "Positions" },
  { key: "liq_buffer_pct", label: "Liq Buffer"},
];

export default function InPositionPage() {
  const router = useRouter();
  const { data, isLoading } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn:  () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const [sort, setSort] = useState<SortKey>("unrealized_pnl");
  const [asc,  setAsc]  = useState(false);

  function handleSort(key: SortKey) {
    if (key === sort) setAsc((a) => !a);
    else { setSort(key); setAsc(false); }
  }

  if (isLoading || !data) return <InPositionLoadingState />;

  const inPosition = [...data.top_wallets]
    .filter((w) => w.position_count > 0)
    .sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sort === "address")           { av = a.address ?? "";            bv = b.address ?? ""; }
      else if (sort === "win_rate")     { av = a.win_rate ?? 0;            bv = b.win_rate ?? 0; }
      else if (sort === "liq_buffer_pct") { av = a.liq_buffer_pct ?? 0;   bv = b.liq_buffer_pct ?? 0; }
      else { av = (a as never)[sort] as number ?? 0; bv = (b as never)[sort] as number ?? 0; }

      if (typeof av === "string") return asc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return asc ? (av - (bv as number)) : ((bv as number) - av);
    });

  return (
    <>
      <PageHeader title="In Position" subtitle={`${inPosition.length} wallets with open positions right now`} />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={S.card}>
          {inPosition.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No wallets with open positions right now</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0f0f0f" }}>
                  <th style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", padding: "12px 16px", textAlign: "left", userSelect: "none", width: "40px" }}>#</th>
                  {COLS.map(({ key, label }) => (
                    <th key={key} onClick={() => handleSort(key)}
                      style={{
                        fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase" as const,
                        color: sort === key ? "#f0f0f0" : "rgba(255,255,255,0.5)",
                        padding: "12px 16px", textAlign: "left" as const,
                        cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" as const,
                      }}>
                      {label}
                      <span style={{ marginLeft: "5px", opacity: sort === key ? 0.7 : 0, transition: "opacity 0.15s" }}>
                        {sort === key ? (asc ? "↑" : "↓") : "↓"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inPosition.map((w, i) => (
                  <tr key={w.wallet_id} style={{ transition: "background 0.1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(180,180,180,0.03)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ ...S.td, color: "rgba(255,255,255,0.32)" }}>{i + 1}</td>
                    <td style={S.td}>
                      <button onClick={() => router.push(`/wallets/discovery?address=${w.address}`)}
                        style={{ ...S.mono, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" as const }}>
                        {truncateAddress(w.address)}
                      </button>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "48px", height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                          <div style={{ width: `${w.overall_score * 100}%`, height: "100%", background: w.overall_score >= 0.7 ? "#6aaa7a" : w.overall_score >= 0.5 ? "#606060" : "#b06868", borderRadius: "2px" }} />
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "#f0f0f0" }}>{w.overall_score.toFixed(2)}</span>
                      </div>
                    </td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{formatUsd(w.account_value)}</td>
                    <td style={{ ...S.td, color: w.unrealized_pnl >= 0 ? "#6aaa7a" : "#b06868", fontVariantNumeric: "tabular-nums" }}>{formatUsd(w.unrealized_pnl)}</td>
                    <td style={S.td}>{w.win_rate != null ? formatPct(w.win_rate) : "n/a"}</td>
                    <td style={S.td}>{w.position_count}</td>
                    <td style={{ ...S.td, color: (w.liq_buffer_pct ?? 1) < 0.15 ? "#b06868" : "rgba(255,255,255,0.69)" }}>
                      {w.liq_buffer_pct != null ? formatPct(w.liq_buffer_pct) : "n/a"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
