"use client";
// app/wallets/discovery/DiscoveryClient.tsx

import { useState, useCallback, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatUsd, formatPct, truncateAddress, timeAgo, isValidAddress } from "@/lib/utils";
import { color, card as C, type as T, space, radius, anim } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header, gap: "8px" },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  mono:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
  th:    { fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)", padding: "10px 14px", textAlign: "left" as const },
  td:    { fontSize: "13px", padding: "12px 16px", borderBottom: `1px solid ${color.divider}` },
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
  tier_breakdown: Array<{ tier: string; count: number }>;
}

interface StoredProfile {
  trading_style:     string | null;
  pnl_consistency:   number | null;
  bull_daily_pnl:    number | null;
  bear_daily_pnl:    number | null;
  ranging_daily_pnl: number | null;
  regime_edge:       number | null;
  current_coins:     string[];
  regime_day_counts: { BULL: number; BEAR: number; RANGING: number } | null;
  computed_at:       string | null;
}

interface WalletProfile {
  address: string;
  state: { accountValue: string; totalNtlPos: string; totalMarginUsed: string; withdrawable: string };
  positions: Array<{ coin: string; szi: string; positionValue: string; unrealizedPnl: string; entryPx: string; leverage: { type: string; value: number }; liquidationPx: string | null }>;
  fills30d: Array<{ coin: string; side: string; px: string; sz: string; closedPnl: string; time: number; dir: string }>;
  stats: { win_rate: number; trade_count: number; total_pnl: number; avg_win: number; avg_loss: number; profit_factor: number; current_streak: number; is_win_streak: boolean };
  verdict: string;
  verdict_color: string;
  stored_profile: StoredProfile | null;
}

async function fetchWalletProfile(address: string): Promise<WalletProfile> {
  const res = await fetch(`/api/wallet-profile?address=${address}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const STYLE_LABEL: Record<string, string> = {
  SCALPER: "Scalper",
  SWING:   "Swing",
  TREND:   "Trend",
};

const REGIME_EDGE_LABEL = (edge: number | null): string => {
  if (edge === null) return "n/a";
  if (edge > 0.6) return "Specialist";
  if (edge > 0.3) return "Regime-sensitive";
  return "Generalist";
};

function BehaviorProfileSection({ profile: p }: { profile: StoredProfile }) {
  const regimePnls: Array<{ label: string; value: number | null }> = [
    { label: "Bull avg/day",    value: p.bull_daily_pnl    },
    { label: "Bear avg/day",    value: p.bear_daily_pnl    },
    { label: "Ranging avg/day", value: p.ranging_daily_pnl },
  ];
  return (
    <div style={{ ...S.card, padding: "20px" }}>
      <div style={{ ...S.label, marginBottom: "16px" }}>Behavior Profile</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div>
          <div style={{ ...S.muted, marginBottom: "10px", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Trading behavior</div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
            <span style={S.muted}>Style</span>
            <span style={{ fontSize: "13px", fontWeight: 600 }}>{p.trading_style ? STYLE_LABEL[p.trading_style] ?? p.trading_style : "n/a"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
            <span style={S.muted}>Consistency</span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "60px", height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                <div style={{ width: `${(p.pnl_consistency ?? 0) * 100}%`, height: "100%", background: color.accent, borderRadius: "2px" }} />
              </div>
              <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>{p.pnl_consistency != null ? p.pnl_consistency.toFixed(2) : "n/a"}</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span style={S.muted}>Regime edge</span>
            <span style={{ fontSize: "13px" }}>{p.regime_edge != null ? p.regime_edge.toFixed(2) : "n/a"} <span style={{ ...S.muted, fontSize: "11px" }}>({REGIME_EDGE_LABEL(p.regime_edge)})</span></span>
          </div>
        </div>
        <div>
          <div style={{ ...S.muted, marginBottom: "10px", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Regime performance</div>
          {regimePnls.map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
              <span style={S.muted}>{label}</span>
              <span style={{ fontSize: "13px", fontVariantNumeric: "tabular-nums", color: value == null ? "rgba(255,255,255,0.25)" : value >= 0 ? color.green : color.red }}>
                {value != null ? formatUsd(value) : "n/a"}
              </span>
            </div>
          ))}
        </div>
      </div>
      {p.current_coins && p.current_coins.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ ...S.muted, fontSize: "11px", marginBottom: "8px" }}>Open coins at last scan</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" as const }}>
            {p.current_coins.map((coin) => (
              <span key={coin} style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "3px", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.69)" }}>
                {coin}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WalletProfileCard({ profile }: { profile: WalletProfile }) {
  const [tab, setTab] = useState<"overview" | "positions" | "trades">("overview");
  const pnlColor = profile.stats.total_pnl >= 0 ? color.green : color.red;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ ...S.card, background: `${profile.verdict_color}08`, border: `1px solid ${profile.verdict_color}25`, padding: "16px 20px", display: "flex", alignItems: "center", gap: "16px" }}>
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: profile.verdict_color, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: profile.verdict_color }}>{profile.verdict}</div>
          <div style={S.muted}>{truncateAddress(profile.address, 8, 6)}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "grid", gridTemplateColumns: "repeat(4,auto)", gap: "24px" }}>
          {[
            { label: "AUM",     value: formatUsd(parseFloat(profile.state.accountValue)) },
            { label: "30d PnL", value: formatUsd(profile.stats.total_pnl), clr: pnlColor },
            { label: "Win Rate",value: formatPct(profile.stats.win_rate) },
            { label: "Trades",  value: `${profile.stats.trade_count}` },
          ].map(({ label, value, clr }) => (
            <div key={label} style={{ textAlign: "right" }}>
              <div style={{ ...S.muted, marginBottom: "2px" }}>{label}</div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: clr ?? color.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
        {[
          { label: "Avg Win",       value: formatUsd(profile.stats.avg_win),  clr: color.green },
          { label: "Avg Loss",      value: formatUsd(profile.stats.avg_loss), clr: color.red },
          { label: "Profit Factor", value: profile.stats.profit_factor.toFixed(2) },
          { label: `${profile.stats.is_win_streak ? "Win" : "Loss"} Streak`, value: `${profile.stats.current_streak}* ${profile.stats.is_win_streak ? "W" : "L"}` },
        ].map(({ label, value, clr }) => (
          <div key={label} style={{ ...S.card, padding: "16px" }}>
            <div style={S.label}>{label}</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: clr ?? color.text, marginTop: "6px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ ...S.muted, fontSize: "11px", textAlign: "right" as const, marginTop: "4px" }}>* as of last daily scan</div>
      {profile.stored_profile && <BehaviorProfileSection profile={profile.stored_profile} />}
      <div style={S.card}>
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          {(["overview", "positions", "trades"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`tab-hover${tab === t ? " tab-active" : ""}`}
              style={{ padding: "12px 20px", fontSize: "13px", fontWeight: 500, color: tab === t ? color.text : "rgba(255,255,255,0.44)", background: "none", border: "none", cursor: "pointer", borderBottom: tab === t ? `2px solid ${color.neutral}` : "2px solid transparent", marginBottom: "-1px", textTransform: "capitalize" as const }}>
              {t}
            </button>
          ))}
        </div>
        {tab === "overview" && (
          <div style={{ padding: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div>
                <div style={{ ...S.label, marginBottom: "10px" }}>Margin Summary</div>
                {[["Account Value", formatUsd(parseFloat(profile.state.accountValue))], ["Total Notional", formatUsd(parseFloat(profile.state.totalNtlPos))], ["Margin Used", formatUsd(parseFloat(profile.state.totalMarginUsed))], ["Withdrawable", formatUsd(parseFloat(profile.state.withdrawable))]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={S.muted}>{k}</span>
                    <span style={{ fontSize: "13px", fontVariantNumeric: "tabular-nums" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ ...S.label, marginBottom: "10px" }}>Performance</div>
                {[["Win Rate", formatPct(profile.stats.win_rate)], ["Trade Count", `${profile.stats.trade_count}`], ["Profit Factor", profile.stats.profit_factor.toFixed(2)], ["Current Streak", `${profile.stats.current_streak}* ${profile.stats.is_win_streak ? "W" : "L"}`]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={S.muted}>{k}</span>
                    <span style={{ fontSize: "13px" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === "positions" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Coin","Side","Size","Value","uPnL","Entry Px","Lev","Liq Px"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {profile.positions.map((p, i) => {
                const isLong = parseFloat(p.szi) > 0;
                return (
                  <tr key={i}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{p.coin}</td>
                    <td style={{ ...S.td, color: isLong ? color.green : color.red }}>{isLong ? "LONG" : "SHORT"}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{Math.abs(parseFloat(p.szi)).toFixed(4)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{formatUsd(parseFloat(p.positionValue))}</td>
                    <td style={{ ...S.td, color: parseFloat(p.unrealizedPnl) >= 0 ? color.green : color.red, fontVariantNumeric: "tabular-nums" }}>{formatUsd(parseFloat(p.unrealizedPnl))}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{parseFloat(p.entryPx).toFixed(2)}</td>
                    <td style={S.td}>{p.leverage.value}x {p.leverage.type}</td>
                    <td style={{ ...S.td, color: p.liquidationPx ? color.red : "rgba(255,255,255,0.44)" }}>{p.liquidationPx ? parseFloat(p.liquidationPx).toFixed(2) : "n/a"}</td>
                  </tr>
                );
              })}
              {profile.positions.length === 0 && <tr><td colSpan={8} style={{ padding: "32px", textAlign: "center" as const, ...S.muted }}>No open positions</td></tr>}
            </tbody>
          </table>
        )}
        {tab === "trades" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Time","Coin","Side","Price","Size","Realized PnL"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {profile.fills30d.slice(0, 50).map((f, i) => {
                const pnl = parseFloat(f.closedPnl);
                return (
                  <tr key={i}>
                    <td style={{ ...S.td, ...S.muted }}>{timeAgo(f.time)}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{f.coin}</td>
                    <td style={{ ...S.td, color: f.side === "B" ? color.green : color.red }}>{f.side === "B" ? "Buy" : "Sell"}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{parseFloat(f.px).toFixed(2)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{parseFloat(f.sz).toFixed(4)}</td>
                    <td style={{ ...S.td, color: pnl > 0 ? color.green : pnl < 0 ? color.red : "rgba(255,255,255,0.44)", fontVariantNumeric: "tabular-nums" }}>{pnl !== 0 ? formatUsd(pnl) : "n/a"}</td>
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

export function DiscoveryClient({ initialScannerData }: { initialScannerData: ScannerStats | null }) {
  const { data: scannerData } = useQuery<ScannerStats>({
    queryKey:        ["scanner-stats"],
    queryFn:         () => fetch("/api/scanner-stats").then((r) => r.json()),
    initialData:     initialScannerData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const [lookupAddr,    setLookupAddr]    = useState("");
  const [profile,      setProfile]       = useState<WalletProfile | null>(null);
  const [lookupLoading,setLookupLoading] = useState(false);
  const [lookupError,  setLookupError]   = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const doLookup = useCallback(async (addr: string) => {
    if (!isValidAddress(addr)) { setLookupError("Invalid address (must be 0x + 40 hex chars)"); return; }
    setLookupLoading(true); setLookupError(null); setProfile(null);
    try { setProfile(await fetchWalletProfile(addr)); }
    catch (e) { setLookupError(e instanceof Error ? e.message : "Lookup failed"); }
    finally { setLookupLoading(false); }
  }, []);

  useEffect(() => {
    const addr = new URLSearchParams(window.location.search).get("address");
    if (addr && isValidAddress(addr)) { setLookupAddr(addr); doLookup(addr); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openLookup = useCallback((addr: string) => {
    setLookupAddr(addr); doLookup(addr);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [doLookup]);

  return (
    <div className="page-enter">
      <div style={{ padding: "28px 32px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "26px", fontWeight: 700, color: color.text, margin: 0 }}>Discovery</h1>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", background: color.card, border: `1px solid ${searchFocused ? color.borderHover : color.border}`, borderRadius: radius.input, overflow: "hidden", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", transition: "border-color 0.2s" }}>
            <input
              value={lookupAddr}
              onChange={(e) => setLookupAddr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLookup(lookupAddr)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="0x... wallet address"
              style={{ background: "transparent", border: "none", outline: "none", color: color.text, fontFamily: "'Geist Mono', monospace", fontSize: "13px", padding: "10px 14px", width: "360px" }}
            />
            <div style={{ width: "1px", height: "20px", background: color.border, flexShrink: 0 }} />
            <button
              onClick={() => doLookup(lookupAddr)}
              disabled={lookupLoading}
              className="glow-btn"
              style={{ padding: "0 16px", minHeight: "40px", cursor: lookupLoading ? "not-allowed" : "pointer", background: "transparent", border: "none", color: lookupLoading ? color.textFaint : color.textMuted, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", transition: "color 0.15s" }}
            >
              {lookupLoading ? "Loading..." : "Search"}
            </button>
          </div>
          {lookupError && <div style={{ color: color.red, fontSize: "13px" }}>{lookupError}</div>}
        </div>
      </div>
      <div style={{ ...S.page, paddingTop: "20px" }}>

        {profile && <div style={{ marginBottom: "24px" }}><WalletProfileCard profile={profile} /></div>}

        {scannerData && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
              {[
                { label: "Discovered",        value: `${scannerData.total_discovered}` },
                { label: "Active Smart Money", value: `${scannerData.total_active}`,   clr: color.green },
                { label: "Filtered Out",       value: `${scannerData.total_inactive}`, clr: color.red },
                { label: "Avg Win Rate",       value: formatPct(scannerData.avg_win_rate) },
              ].map(({ label, value, clr }) => (
                <div key={label} style={{ ...S.card, padding: "18px" }}>
                  <div style={S.label}>{label}</div>
                  <div style={{ fontSize: "26px", fontWeight: 700, color: clr ?? color.text, marginTop: "6px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
              <div style={S.card}>
                <div style={S.hdr}><span style={S.label}>Scan Pipeline</span></div>
                <div style={{ padding: "4px 0" }}>
                  {scannerData.scan_pipeline.map((step, i) => {
                    const c = step.status === "ok" ? color.green : step.status === "warn" ? color.amber : color.red;
                    return (
                      <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: "10px" }}>
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: c, marginTop: "4px", flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: color.text }}>{step.step}</div>
                          <div style={{ ...S.muted, marginTop: "2px" }}>{step.detail}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={S.card}>
                <div style={S.hdr}><span style={S.label}>Last Scan</span></div>
                <div style={{ padding: "20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {[
                      { label: "Last Run",    value: scannerData.last_scan_at ? timeAgo(scannerData.last_scan_at) : "Never" },
                      { label: "Source",      value: scannerData.discovery_source ?? "n/a" },
                      { label: "Schedule",    value: "00:00 UTC daily (GitHub Actions)" },
                      { label: "Filter",      value: "win_rate 52%+ and 30+ trades in 30 days" },
                      { label: "Max Wallets", value: "2,000 discovered, top 500 active" },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={S.muted}>{label}</span>
                        <span style={{ fontSize: "13px", color: color.text }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={S.card}>
              <div style={S.hdr}><span style={S.label}>Top Discovered by Win Rate</span></div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["#", "Address", "Win Rate", "Trades (30d)", "Realized PnL (30d)"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {scannerData.top_win_rates.map((w, i) => (
                    <tr key={w.address}>
                      <td style={{ ...S.td, color: "rgba(255,255,255,0.32)" }}>{i + 1}</td>
                      <td style={S.td}>
                        <button onClick={() => openLookup(w.address)}
                          style={{ ...S.mono, color: color.neutral, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          {w.address.slice(0, 10)}...{w.address.slice(-6)}
                        </button>
                      </td>
                      <td style={{ ...S.td, color: w.win_rate >= 0.65 ? color.green : w.win_rate >= 0.55 ? color.amber : color.text, fontWeight: 600 }}>{formatPct(w.win_rate)}</td>
                      <td style={S.td}>{w.trade_count_30d}</td>
                      <td style={{ ...S.td, color: w.realized_pnl_30d >= 0 ? color.green : color.red, fontVariantNumeric: "tabular-nums" }}>
                        {w.realized_pnl_30d >= 0 ? "+" : ""}${(w.realized_pnl_30d / 1000).toFixed(1)}K
                      </td>
                    </tr>
                  ))}
                  {scannerData.top_win_rates.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: "32px", textAlign: "center" as const, ...S.muted }}>Run the daily scan to populate wallet data</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {scannerData.tier_breakdown && scannerData.tier_breakdown.length > 0 && (
              <div style={{ ...S.card, marginTop: space.cardGap }}>
                <div style={S.hdr}>
                  <span style={S.label}>Wallet Tiers</span>
                  <span style={S.muted}>by current account equity</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px", padding: space.cardBodyPadding }}>
                  {scannerData.tier_breakdown.map(({ tier, count }) => (
                    <div key={tier} style={{ textAlign: "center" as const, padding: "12px 8px", background: color.strip, borderRadius: radius.tag, border: `1px solid ${color.tagBg}` }}>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: color.text, fontVariantNumeric: "tabular-nums" }}>{count}</div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: color.textMuted, marginTop: "4px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{tier}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
