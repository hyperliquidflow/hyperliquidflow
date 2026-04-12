"use client";
// app/stalker/page.tsx — Wallet Stalker: drop any address, get full history + verdict.

import { useState, useCallback } from "react";
import { formatUsd, formatPct, timeAgo, truncateAddress, isValidAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

const S = {
  page:  { padding: "32px", maxWidth: "1100px", margin: "0 auto" },
  card:  { background: "rgba(12,12,12,0.7)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" as const, boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  hdr:   { borderBottom: "1px solid rgba(180,180,180,0.06)", padding: "16px 20px" },
  label: { fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)" },
  muted: { color: "rgba(255,255,255,0.44)", fontSize: "13px" },
  mono:  { fontFamily: "var(--font-mono)", fontSize: "13px" },
  td:    { padding: "10px 14px", borderBottom: "1px solid rgba(180,180,180,0.06)", fontSize: "13px" },
};

interface WalletProfile {
  address: string;
  state: {
    accountValue: string;
    totalNtlPos: string;
    totalMarginUsed: string;
    withdrawable: string;
  };
  positions: Array<{
    coin: string; szi: string; positionValue: string;
    unrealizedPnl: string; entryPx: string;
    leverage: { type: string; value: number };
    liquidationPx: string | null;
  }>;
  fills30d: Array<{
    coin: string; side: string; px: string; sz: string;
    closedPnl: string; time: number; dir: string;
  }>;
  stats: {
    win_rate: number; trade_count: number; total_pnl: number;
    avg_win: number; avg_loss: number; profit_factor: number;
    current_streak: number; is_win_streak: boolean;
  };
  verdict: string;
  verdict_color: string;
}

async function fetchWalletProfile(address: string): Promise<WalletProfile> {
  const res = await fetch(`/api/wallet-profile?address=${address}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function StalkerInner() {
  const [address, setAddress]   = useState("");
  const [profile, setProfile]   = useState<WalletProfile | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error,   setError]     = useState<string | null>(null);

  // Pre-fill from URL param
  if (typeof window !== "undefined") {
    const urlAddress = new URLSearchParams(window.location.search).get("address");
    if (urlAddress && !address && isValidAddress(urlAddress)) {
      setAddress(urlAddress);
    }
  }

  const lookup = useCallback(async (addr: string) => {
    if (!isValidAddress(addr)) { setError("Invalid address format (must be 0x + 40 hex chars)"); return; }
    setLoading(true); setError(null); setProfile(null);
    try {
      const p = await fetchWalletProfile(addr);
      setProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <>
      <PageHeader
        title="Wallet Stalker"
        subtitle="Drop any address, get full history + verdict"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Input */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup(address)}
          placeholder="0x… wallet address"
          style={{
            flex: 1, background: "#141414", border: "1px solid rgba(180,180,180,0.12)",
            borderRadius: "6px", color: "#f0f0f0", fontFamily: "var(--font-mono)",
            fontSize: "13px", padding: "10px 14px", outline: "none",
          }}
        />
        <button onClick={() => lookup(address)} disabled={loading}
          className="glow-btn"
          style={{
            padding: "0 20px", borderRadius: "7px", cursor: loading ? "not-allowed" : "pointer",
            background: "linear-gradient(135deg, #1e1e1e 0%, #2e2e2e 100%)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#f0f0f0", fontSize: "13px", fontWeight: 700,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
            opacity: loading ? 0.5 : 1,
          }}>
          {loading ? "Loading…" : "Lookup"}
        </button>
      </div>

      {error && <div style={{ color: "#b06868", fontSize: "12px", marginBottom: "16px" }}>{error}</div>}

      {profile && <WalletProfileCard profile={profile} />}
    </div>
    </>
  );
}

function WalletProfileCard({ profile }: { profile: WalletProfile }) {
  const [tab, setTab] = useState<"overview" | "positions" | "trades">("overview");
  const pnlColor = profile.stats.total_pnl >= 0 ? "#6aaa7a" : "#b06868";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Verdict banner */}
      <div style={{
        ...S.card,
        background: `${profile.verdict_color}08`,
        border: `1px solid ${profile.verdict_color}25`,
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: "16px",
      }}>
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: profile.verdict_color, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: profile.verdict_color }}>{profile.verdict}</div>
          <div style={S.muted}>{truncateAddress(profile.address, 8, 6)}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "grid", gridTemplateColumns: "repeat(4,auto)", gap: "24px" }}>
          {[
            { label: "AUM",       value: formatUsd(parseFloat(profile.state.accountValue)) },
            { label: "30d PnL",   value: formatUsd(profile.stats.total_pnl), color: pnlColor },
            { label: "Win Rate",  value: formatPct(profile.stats.win_rate) },
            { label: "Trades",    value: `${profile.stats.trade_count}` },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ textAlign: "right" }}>
              <div style={{ ...S.muted, marginBottom: "2px" }}>{label}</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: color ?? "#f0f0f0", fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
        {[
          { label: "Avg Win",      value: formatUsd(profile.stats.avg_win),     color: "#6aaa7a" },
          { label: "Avg Loss",     value: formatUsd(profile.stats.avg_loss),    color: "#b06868" },
          { label: "Profit Factor",value: profile.stats.profit_factor.toFixed(2) },
          { label: `${profile.stats.is_win_streak ? "Win" : "Loss"} Streak`, value: `${profile.stats.current_streak}` },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...S.card, padding: "16px" }}>
            <div style={S.label}>{label}</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: color ?? "#f0f0f0", marginTop: "6px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={S.card}>
        <div style={{ display: "flex", borderBottom: "1px solid rgba(180,180,180,0.06)" }}>
          {(["overview", "positions", "trades"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`tab-hover${tab === t ? " tab-active" : ""}`}
              style={{
                padding: "12px 20px", fontSize: "13px", fontWeight: 500,
                color: tab === t ? "#f0f0f0" : "rgba(255,255,255,0.44)",
                background: "none", border: "none", cursor: "pointer",
                borderBottom: tab === t ? "2px solid #606060" : "2px solid transparent",
                marginBottom: "-1px", textTransform: "capitalize" as const,
              }}>{t}</button>
          ))}
        </div>

        {tab === "overview" && (
          <div style={{ padding: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div>
                <div style={{ ...S.label, marginBottom: "10px" }}>Margin Summary</div>
                {[
                  ["Account Value",   formatUsd(parseFloat(profile.state.accountValue))],
                  ["Total Notional",  formatUsd(parseFloat(profile.state.totalNtlPos))],
                  ["Margin Used",     formatUsd(parseFloat(profile.state.totalMarginUsed))],
                  ["Withdrawable",    formatUsd(parseFloat(profile.state.withdrawable))],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(180,180,180,0.06)" }}>
                    <span style={S.muted}>{k}</span>
                    <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ ...S.label, marginBottom: "10px" }}>Performance</div>
                {[
                  ["Win Rate",       formatPct(profile.stats.win_rate)],
                  ["Trade Count",    `${profile.stats.trade_count}`],
                  ["Profit Factor",  profile.stats.profit_factor.toFixed(2)],
                  ["Current Streak", `${profile.stats.current_streak} ${profile.stats.is_win_streak ? "W" : "L"}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(180,180,180,0.06)" }}>
                    <span style={S.muted}>{k}</span>
                    <span style={{ fontSize: "12px" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "positions" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["Coin","Side","Size","Value","uPnL","Entry Px","Lev","Liq Px"].map(h => (
                <th key={h} style={{ padding: "10px 14px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)", textAlign: "left" as const }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {profile.positions.map((p, i) => {
                const isLong = parseFloat(p.szi) > 0;
                return (
                  <tr key={i}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{p.coin}</td>
                    <td style={{ ...S.td, color: isLong ? "#6aaa7a" : "#b06868" }}>{isLong ? "LONG" : "SHORT"}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{Math.abs(parseFloat(p.szi)).toFixed(4)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{formatUsd(parseFloat(p.positionValue))}</td>
                    <td style={{ ...S.td, color: parseFloat(p.unrealizedPnl) >= 0 ? "#6aaa7a" : "#b06868", fontVariantNumeric: "tabular-nums" }}>{formatUsd(parseFloat(p.unrealizedPnl))}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{parseFloat(p.entryPx).toFixed(2)}</td>
                    <td style={S.td}>{p.leverage.value}x {p.leverage.type}</td>
                    <td style={{ ...S.td, color: p.liquidationPx ? "#b06868" : "rgba(255,255,255,0.44)" }}>{p.liquidationPx ? parseFloat(p.liquidationPx).toFixed(2) : "—"}</td>
                  </tr>
                );
              })}
              {profile.positions.length === 0 && <tr><td colSpan={8} style={{ padding: "32px", textAlign: "center" as const, ...S.muted }}>No open positions</td></tr>}
            </tbody>
          </table>
        )}

        {tab === "trades" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["Time","Coin","Side","Price","Size","Realized PnL"].map(h => (
                <th key={h} style={{ padding: "10px 14px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)", textAlign: "left" as const }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {profile.fills30d.slice(0, 50).map((f, i) => {
                const pnl = parseFloat(f.closedPnl);
                return (
                  <tr key={i}>
                    <td style={{ ...S.td, ...S.muted }}>{timeAgo(f.time)}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{f.coin}</td>
                    <td style={{ ...S.td, color: f.side === "B" ? "#6aaa7a" : "#b06868" }}>{f.side === "B" ? "Buy" : "Sell"}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{parseFloat(f.px).toFixed(2)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{parseFloat(f.sz).toFixed(4)}</td>
                    <td style={{ ...S.td, color: pnl > 0 ? "#6aaa7a" : pnl < 0 ? "#b06868" : "rgba(255,255,255,0.44)", fontVariantNumeric: "tabular-nums" }}>
                      {pnl !== 0 ? formatUsd(pnl) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function StalkerPage() {
  return <StalkerInner />;
}
