"use client";
// app/scanner/page.tsx — Wallet Discovery status and scan history.

import { useQuery } from "@tanstack/react-query";
import { timeAgo, formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

const S = {
  page:  { padding: "32px", maxWidth: "1000px", margin: "0 auto" },
  card:  { background: "rgba(12,12,12,0.7)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" as const, boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  hdr:   { borderBottom: "1px solid rgba(180,180,180,0.06)", padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px" },
  label: { fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)" },
  muted: { color: "rgba(255,255,255,0.44)", fontSize: "13px" },
  mono:  { fontFamily: "var(--font-mono)", fontSize: "13px" },
  td:    { padding: "10px 14px", borderBottom: "1px solid rgba(180,180,180,0.06)", fontSize: "13px" },
};

interface ScannerStats {
  total_discovered: number;
  total_active: number;
  total_inactive: number;
  avg_win_rate: number;
  last_scan_at: string | null;
  discovery_source: string | null;
  top_win_rates: Array<{ address: string; win_rate: number; trade_count_30d: number; realized_pnl_30d: number }>;
  scan_pipeline: Array<{ step: string; status: "ok" | "warn" | "error"; detail: string }>;
}

function ScannerInner() {
  const { data, isLoading } = useQuery<ScannerStats>({
    queryKey: ["scanner-stats"],
    queryFn:  () => fetch("/api/scanner-stats").then((r) => r.json()),
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !data) return <div style={{ padding: "28px", ...S.muted }}>Loading scanner stats…</div>;

  return (
    <>
      <PageHeader
        title="Scanner"
        subtitle="Daily discovery at 02:00 UTC · GitHub Actions"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
        {[
          { label: "Discovered",       value: `${data.total_discovered}` },
          { label: "Active in Cohort", value: `${data.total_active}`,   color: "#6aaa7a" },
          { label: "Filtered Out",     value: `${data.total_inactive}`,  color: "#b06868" },
          { label: "Avg Win Rate",     value: formatPct(data.avg_win_rate) },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...S.card, padding: "18px" }}>
            <div style={S.label}>{label}</div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: color ?? "#f0f0f0", marginTop: "6px" }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        {/* Pipeline status */}
        <div style={S.card}>
          <div style={S.hdr}><span style={S.label}>Scan Pipeline</span></div>
          <div style={{ padding: "4px 0" }}>
            {data.scan_pipeline.map((step, i) => {
              const color = step.status === "ok" ? "#6aaa7a" : step.status === "warn" ? "#f59e0b" : "#b06868";
              return (
                <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid rgba(180,180,180,0.06)", display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: color, marginTop: "4px", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#f0f0f0" }}>{step.step}</div>
                    <div style={{ ...S.muted, marginTop: "2px" }}>{step.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Last scan info */}
        <div style={S.card}>
          <div style={S.hdr}><span style={S.label}>Last Scan</span></div>
          <div style={{ padding: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                { label: "Last Run",    value: data.last_scan_at ? timeAgo(data.last_scan_at) : "Never" },
                { label: "Source",      value: data.discovery_source ?? "—" },
                { label: "Schedule",    value: "02:00 UTC daily (GitHub Actions)" },
                { label: "Filter",      value: "win_rate ≥ 52% AND ≥ 30 trades/30d" },
                { label: "Max Wallets", value: "2,000 discovered → top 500 active" },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={S.muted}>{label}</span>
                  <span style={{ fontSize: "12px", color: "#f0f0f0" }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: "20px", padding: "12px 14px", background: "rgba(96,96,96,0.05)", borderRadius: "6px", border: "1px solid rgba(180,180,180,0.08)" }}>
              <div style={{ ...S.label, marginBottom: "6px" }}>Setup required</div>
              <p style={{ ...S.muted, lineHeight: 1.6 }}>
                Add <code style={S.mono}>SUPABASE_URL</code>, <code style={S.mono}>SUPABASE_SERVICE_ROLE_KEY</code>, and <code style={S.mono}>HYPERLIQUID_API_URL</code> to GitHub Secrets (Settings → Secrets → Actions). Repo must be <strong style={{ color: "#f0f0f0" }}>public</strong> for 2,000 free minutes/month.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Top wallets by win rate */}
      <div style={S.card}>
        <div style={S.hdr}><span style={S.label}>Top Discovered Wallets by Win Rate</span></div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["#","Address","Win Rate","Trades (30d)","Realized PnL (30d)"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)", textAlign: "left" as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.top_win_rates.map((w, i) => (
              <tr key={w.address}>
                <td style={{ ...S.td, color: "rgba(255,255,255,0.32)" }}>{i + 1}</td>
                <td style={S.td}>
                  <a href={`/stalker?address=${w.address}`} style={{ ...S.mono, color: "#9ca3af", textDecoration: "none" }}>{w.address.slice(0, 10)}…{w.address.slice(-6)}</a>
                </td>
                <td style={{ ...S.td, color: w.win_rate >= 0.65 ? "#6aaa7a" : w.win_rate >= 0.55 ? "#f59e0b" : "#f0f0f0", fontWeight: 600 }}>
                  {formatPct(w.win_rate)}
                </td>
                <td style={S.td}>{w.trade_count_30d}</td>
                <td style={{ ...S.td, color: w.realized_pnl_30d >= 0 ? "#6aaa7a" : "#b06868", fontVariantNumeric: "tabular-nums" }}>
                  {w.realized_pnl_30d >= 0 ? "+" : ""}${(w.realized_pnl_30d / 1000).toFixed(1)}K
                </td>
              </tr>
            ))}
            {data.top_win_rates.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "32px", textAlign: "center" as const, ...S.muted }}>Run the daily scan to populate wallet data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

export default function ScannerPage() {
  return <ScannerInner />;
}
