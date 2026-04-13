"use client";
// app/brief/page.tsx — Daily Brief

import { useQuery } from "@tanstack/react-query";
import { timeAgo, formatUsd, formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

import { color, card as C, type as T, space } from "@/lib/design-tokens";
import { BriefLoadingState } from "@/components/loading-state";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header, gap: "12px" },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  body:  { fontSize: "14px", color: "rgba(255,255,255,0.82)", lineHeight: 1.7 },
};

interface MorningScan {
  generated_at: string;
  regime: string;
  btc_return_24h: number;
  top_movers: Array<{ coin: string; notional: string; direction: string }>;
  top_signals: Array<{ recipe: string; coin: string; direction: string; ev: number | null }>;
  cohort_health: { active_wallets: number; avg_score: number; wallets_in_profit: number };
  top_wallets: Array<{ address: string; score: number; pnl: string }>;
  summary: string;
  watch_list: string[];
}

function BriefInner() {
  const { data, isLoading } = useQuery<MorningScan>({
    queryKey: ["daily-scan"],
    queryFn:  () => fetch("/api/daily-scan").then((r) => r.json()),
    refetchInterval: 5 * 60_000, // refresh every 5 min (it's a daily doc)
  });

  if (isLoading || !data) return <BriefLoadingState />;

  return (
    <>
      <PageHeader
        title="Daily Brief"
        subtitle={`Generated daily at 00:00 UTC · ${timeAgo(data.generated_at)}`}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Summary */}
      <div style={{ ...S.card, padding: "20px 24px", marginBottom: "16px" }}>
        <div style={{ ...S.label, marginBottom: "12px" }}>Daily Briefing</div>
        <p style={S.body}>{data.summary}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        {/* Smart Money health */}
        <div style={S.card}>
          <div style={S.hdr}><span style={S.label}>Smart Money Health</span></div>
          <div style={{ padding: "16px 20px" }}>
            {[
              { label: "Active Wallets",    value: `${data.cohort_health.active_wallets}` },
              { label: "Avg Score",         value: data.cohort_health.avg_score.toFixed(2) },
              { label: "Wallets in Profit", value: `${data.cohort_health.wallets_in_profit}` },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={S.muted}>{label}</span>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Watch list */}
        <div style={S.card}>
          <div style={S.hdr}><span style={S.label}>Today's Watch List</span></div>
          <div style={{ padding: "16px 20px", display: "flex", flexWrap: "wrap" as const, gap: "8px" }}>
            {data.watch_list.map((coin) => (
              <span key={coin}
                className="ios-pill"
                style={{ padding: "5px 12px", fontSize: "12px" }}>
                {coin}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Top signals */}
      <div style={{ ...S.card, marginBottom: "16px" }}>
        <div style={S.hdr}><span style={S.label}>Top Signals Yesterday</span></div>
        {data.top_signals.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", ...S.muted }}>No signals in the last 24h</div>
        ) : (
          data.top_signals.map((sig, i) => {
            const dirColor = sig.direction === "LONG" ? "#6aaa7a" : sig.direction === "SHORT" ? "#b06868" : "#9ca3af";
            return (
              <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: dirColor, flexShrink: 0 }} />
                <span style={{ fontSize: "12px", fontWeight: 600 }}>{sig.recipe}</span>
                <span style={{ fontSize: "12px", color: dirColor, fontWeight: 700 }}>{sig.coin}</span>
                <span style={{ fontSize: "10px", color: dirColor, letterSpacing: "0.08em" }}>{sig.direction}</span>
                {sig.ev != null && (
                  <span style={{ marginLeft: "auto", fontSize: "11px", color: "#606060", fontWeight: 600 }}>EV {(sig.ev * 100).toFixed(0)}</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Top movers */}
      <div style={S.card}>
        <div style={S.hdr}><span style={S.label}>Top Smart Money Movers (24h)</span></div>
        {data.top_movers.map((m, i) => {
          const dirColor = m.direction === "LONG" ? "#6aaa7a" : "#b06868";
          return (
            <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700 }}>{m.coin}</span>
              <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "4px",
                background: `${dirColor}14`, color: dirColor, border: `1px solid ${dirColor}25` }}>
                {m.direction}
              </span>
              <span style={{ marginLeft: "auto", fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>{m.notional}</span>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}

export default function BriefPage() {
  return <BriefInner />;
}
