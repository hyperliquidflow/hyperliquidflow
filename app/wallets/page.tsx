"use client";
// app/wallets/page.tsx — Full Whale Report
// Top profitable wallets ranked by PnL and win rate.

import { useQuery } from "@tanstack/react-query";
import { formatUsd, formatPct, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const S = {
  page:  { padding: "32px", maxWidth: "1400px", margin: "0 auto" },
  card:  { background: "rgba(12,12,12,0.7)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" as const, boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  hdr:   { borderBottom: "1px solid rgba(180,180,180,0.06)", padding: "16px 20px", display: "flex", alignItems: "center", gap: "8px" },
  label: { fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)" },
  muted: { color: "rgba(255,255,255,0.44)", fontSize: "13px" },
  mono:  { fontFamily: "var(--font-mono)", fontSize: "13px" },
  th:    { fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)", padding: "12px 16px", textAlign: "left" as const },
  td:    { fontSize: "13px", padding: "12px 16px", borderBottom: "1px solid rgba(180,180,180,0.06)" },
};

type SortKey = "overall_score" | "account_value" | "unrealized_pnl" | "win_rate";

function WhaleReportInner() {
  const { data, isLoading } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const [sort, setSort] = useState<SortKey>("overall_score");
  const [tab, setTab] = useState<"all" | "top50" | "active">("top50");

  if (isLoading || !data) return <div style={{ ...S.page, ...S.muted }}>Loading…</div>;

  const wallets = [...data.top_wallets].sort((a, b) => {
    if (sort === "win_rate") return (b.win_rate ?? 0) - (a.win_rate ?? 0);
    return (b[sort] as number) - (a[sort] as number);
  });

  const displayed = tab === "top50" ? wallets.slice(0, 50) : tab === "active" ? wallets.filter(w => w.position_count > 0) : wallets;

  return (
    <>
      <PageHeader
        title="Whale Report"
        subtitle={`Top wallets by composite score · ${data.wallet_count} active`}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(180,180,180,0.06)", marginBottom: "20px", gap: "0" }}>
        {(["top50", "active", "all"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`tab-hover${tab === t ? " tab-active" : ""}`}
            style={{
              padding: "12px 20px", fontSize: "13px", fontWeight: 500,
              color: tab === t ? "#f0f0f0" : "rgba(255,255,255,0.44)",
              background: "none", border: "none", cursor: "pointer",
              borderBottom: tab === t ? "2px solid #606060" : "2px solid transparent",
              marginBottom: "-1px",
            }}>
            {t === "top50" ? "Top 50" : t === "active" ? "In Position" : "All Wallets"}
          </button>
        ))}
      </div>

      {/* Sort controls */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {(["overall_score", "account_value", "unrealized_pnl", "win_rate"] as SortKey[]).map((k) => (
          <button key={k} onClick={() => setSort(k)}
            className="glow-btn"
            style={{
              padding: "5px 12px", fontSize: "11px", fontWeight: 600, borderRadius: "7px", cursor: "pointer",
              background: "rgba(14,14,14,0.65)",
              backdropFilter: "blur(12px) saturate(160%)",
              WebkitBackdropFilter: "blur(12px) saturate(160%)",
              color: sort === k ? "#f0f0f0" : "rgba(255,255,255,0.48)",
              border: sort === k ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.09)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
              transition: "color 0.15s, border-color 0.15s",
            }}>
            {k === "overall_score" ? "Score" : k === "account_value" ? "AUM" : k === "unrealized_pnl" ? "uPnL" : "Win Rate"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={S.card}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f0f0f" }}>
              {["#", "Wallet", "Score", "AUM", "uPnL", "Win Rate", "Positions", "Liq Buffer"].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((w, i) => (
              <tr key={w.wallet_id} style={{ transition: "background 0.1s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(180,180,180,0.03)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <td style={{ ...S.td, color: "rgba(255,255,255,0.32)", width: "40px" }}>{i + 1}</td>
                <td style={S.td}>
                  <a href={`/stalker?address=${w.address}`} style={{ ...S.mono, color: "#9ca3af", textDecoration: "none" }}>
                    {truncateAddress(w.address)}
                  </a>
                </td>
                <td style={S.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "48px", height: "3px", background: "rgba(180,180,180,0.1)", borderRadius: "2px" }}>
                      <div style={{ width: `${w.overall_score * 100}%`, height: "100%", background: w.overall_score >= 0.7 ? "#6aaa7a" : w.overall_score >= 0.5 ? "#606060" : "#b06868", borderRadius: "2px" }} />
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#f0f0f0" }}>{w.overall_score.toFixed(2)}</span>
                  </div>
                </td>
                <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{formatUsd(w.account_value)}</td>
                <td style={{ ...S.td, color: w.unrealized_pnl >= 0 ? "#6aaa7a" : "#b06868", fontVariantNumeric: "tabular-nums" }}>
                  {formatUsd(w.unrealized_pnl)}
                </td>
                <td style={S.td}>{w.win_rate != null ? formatPct(w.win_rate) : "—"}</td>
                <td style={S.td}>{w.position_count}</td>
                <td style={{ ...S.td, color: (w.liq_buffer_pct ?? 1) < 0.15 ? "#b06868" : "rgba(255,255,255,0.69)" }}>
                  {w.liq_buffer_pct != null ? formatPct(w.liq_buffer_pct) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

// useState needs to be imported — adding it here
import { useState } from "react";

export default function WhaleReportPage() {
  return <WhaleReportInner />;
}
