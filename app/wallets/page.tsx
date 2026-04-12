"use client";
// app/wallets/page.tsx — Leaderboard + wallet lookup + discovery (all merged)

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUsd, formatPct, truncateAddress, timeAgo, isValidAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header, gap: "8px" },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  mono:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
  th:    { fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.5)", padding: "12px 16px", textAlign: "left" as const },
  td:    { fontSize: "13px", padding: "12px 16px", borderBottom: `1px solid ${color.divider}` },
};

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey  = "overall_score" | "account_value" | "unrealized_pnl" | "win_rate";
type MainTab  = "top50" | "active" | "all" | "lookup" | "discovery";

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

// ── Wallet profile fetch ──────────────────────────────────────────────────────

async function fetchWalletProfile(address: string): Promise<WalletProfile> {
  const res = await fetch(`/api/wallet-profile?address=${address}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Main component ────────────────────────────────────────────────────────────

function WalletsInner() {
  const { data, isLoading } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const { data: scannerData } = useQuery<ScannerStats>({
    queryKey: ["scanner-stats"],
    queryFn:  () => fetch("/api/scanner-stats").then((r) => r.json()),
    refetchInterval: 5 * 60_000,
  });

  const [sort,        setSort]        = useState<SortKey>("overall_score");
  const [tab,         setTab]         = useState<MainTab>("top50");
  const [lookupAddr,  setLookupAddr]  = useState("");
  const [profile,     setProfile]     = useState<WalletProfile | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError,   setLookupError]   = useState<string | null>(null);

  // Handle ?address= param (supports redirects from old /stalker links)
  useEffect(() => {
    const addr = new URLSearchParams(window.location.search).get("address");
    if (addr && isValidAddress(addr)) {
      setLookupAddr(addr);
      setTab("lookup");
      doLookup(addr);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLookup = useCallback(async (addr: string) => {
    if (!isValidAddress(addr)) {
      setLookupError("Invalid address (must be 0x + 40 hex chars)");
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    setProfile(null);
    try {
      setProfile(await fetchWalletProfile(addr));
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }, []);

  // Clicking an address in the leaderboard switches to Lookup and loads it
  const openLookup = useCallback((addr: string) => {
    setLookupAddr(addr);
    setTab("lookup");
    doLookup(addr);
  }, [doLookup]);

  if (isLoading || !data) return <div style={{ ...S.page, ...S.muted }}>Loading...</div>;

  const wallets = [...data.top_wallets].sort((a, b) => {
    if (sort === "win_rate") return (b.win_rate ?? 0) - (a.win_rate ?? 0);
    return (b[sort] as number) - (a[sort] as number);
  });

  const displayed =
    tab === "top50"  ? wallets.slice(0, 50) :
    tab === "active" ? wallets.filter(w => w.position_count > 0) :
    wallets;

  const tabs: { key: MainTab; label: string }[] = [
    { key: "top50",     label: "Top 50"      },
    { key: "active",    label: "In Position" },
    { key: "all",       label: "All Wallets" },
    { key: "lookup",    label: "Lookup"      },
    { key: "discovery", label: "Discovery"   },
  ];

  return (
    <>
      <PageHeader
        title="Wallets"
        subtitle={`Smart Money Chads ranked by composite score, ${data.wallet_count} active`}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.04)", marginBottom: "20px" }}>
          {tabs.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`tab-hover${tab === key ? " tab-active" : ""}`}
              style={{
                padding: "12px 20px", fontSize: "13px", fontWeight: 500,
                color: tab === key ? "#f0f0f0" : "rgba(255,255,255,0.44)",
                background: "none", border: "none", cursor: "pointer",
                borderBottom: tab === key ? "2px solid #606060" : "2px solid transparent",
                marginBottom: "-1px",
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Leaderboard ── */}
        {(tab === "top50" || tab === "active" || tab === "all") && (
          <>
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
                        <button
                          onClick={() => openLookup(w.address)}
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
                      <td style={{ ...S.td, color: w.unrealized_pnl >= 0 ? "#6aaa7a" : "#b06868", fontVariantNumeric: "tabular-nums" }}>
                        {formatUsd(w.unrealized_pnl)}
                      </td>
                      <td style={S.td}>{w.win_rate != null ? formatPct(w.win_rate) : "n/a"}</td>
                      <td style={S.td}>{w.position_count}</td>
                      <td style={{ ...S.td, color: (w.liq_buffer_pct ?? 1) < 0.15 ? "#b06868" : "rgba(255,255,255,0.69)" }}>
                        {w.liq_buffer_pct != null ? formatPct(w.liq_buffer_pct) : "n/a"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Lookup ── */}
        {tab === "lookup" && (
          <div>
            <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
              <input
                value={lookupAddr}
                onChange={(e) => setLookupAddr(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doLookup(lookupAddr)}
                placeholder="0x... wallet address"
                style={{
                  flex: 1, background: "#141414", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "6px", color: "#f0f0f0", fontFamily: "var(--font-mono)",
                  fontSize: "13px", padding: "10px 14px", outline: "none",
                }}
              />
              <button onClick={() => doLookup(lookupAddr)} disabled={lookupLoading}
                className="glow-btn"
                style={{
                  padding: "0 20px", borderRadius: "7px", cursor: lookupLoading ? "not-allowed" : "pointer",
                  background: "linear-gradient(135deg, #1e1e1e 0%, #2e2e2e 100%)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#f0f0f0", fontSize: "13px", fontWeight: 700,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
                  opacity: lookupLoading ? 0.5 : 1,
                }}>
                {lookupLoading ? "Loading..." : "Lookup"}
              </button>
            </div>

            {lookupError && (
              <div style={{ color: "#b06868", fontSize: "12px", marginBottom: "16px" }}>{lookupError}</div>
            )}

            {profile && <WalletProfileCard profile={profile} />}

            {!profile && !lookupLoading && !lookupError && (
              <div style={{ ...S.card, padding: "48px", textAlign: "center", ...S.muted }}>
                Enter any Hyperliquid address to see full trading history and stats
              </div>
            )}
          </div>
        )}

        {/* ── Discovery ── */}
        {tab === "discovery" && (
          <>
            {!scannerData ? (
              <div style={S.muted}>Loading discovery stats...</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
                  {[
                    { label: "Discovered",        value: `${scannerData.total_discovered}` },
                    { label: "Active Smart Money", value: `${scannerData.total_active}`,   color: "#6aaa7a" },
                    { label: "Filtered Out",       value: `${scannerData.total_inactive}`, color: "#b06868" },
                    { label: "Avg Win Rate",       value: formatPct(scannerData.avg_win_rate) },
                  ].map(({ label, value, color: c }) => (
                    <div key={label} style={{ ...S.card, padding: "18px" }}>
                      <div style={S.label}>{label}</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: c ?? "#f0f0f0", marginTop: "6px" }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
                  <div style={S.card}>
                    <div style={S.hdr}><span style={S.label}>Scan Pipeline</span></div>
                    <div style={{ padding: "4px 0" }}>
                      {scannerData.scan_pipeline.map((step, i) => {
                        const c = step.status === "ok" ? "#6aaa7a" : step.status === "warn" ? "#f59e0b" : "#b06868";
                        return (
                          <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: "10px" }}>
                            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: c, marginTop: "4px", flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f0f0f0" }}>{step.step}</div>
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
                          { label: "Schedule",    value: "02:00 UTC daily (GitHub Actions)" },
                          { label: "Filter",      value: "win_rate 52%+ and 30+ trades in 30 days" },
                          { label: "Max Wallets", value: "2,000 discovered, top 500 active" },
                        ].map(({ label, value }) => (
                          <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={S.muted}>{label}</span>
                            <span style={{ fontSize: "12px", color: "#f0f0f0" }}>{value}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: "20px", padding: "12px 14px", background: "rgba(96,96,96,0.05)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ ...S.label, marginBottom: "6px" }}>Setup required</div>
                        <p style={{ ...S.muted, lineHeight: 1.6 }}>
                          Add <code style={S.mono}>SUPABASE_URL</code>, <code style={S.mono}>SUPABASE_SERVICE_ROLE_KEY</code>, and <code style={S.mono}>HYPERLIQUID_API_URL</code> to GitHub Secrets. Repo must be <strong style={{ color: "#f0f0f0" }}>public</strong> for 2,000 free minutes/month.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={S.card}>
                  <div style={S.hdr}><span style={S.label}>Top Discovered by Win Rate</span></div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["#", "Address", "Win Rate", "Trades (30d)", "Realized PnL (30d)"].map((h) => (
                          <th key={h} style={{ padding: "10px 14px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)", textAlign: "left" as const }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scannerData.top_win_rates.map((w, i) => (
                        <tr key={w.address}>
                          <td style={{ ...S.td, color: "rgba(255,255,255,0.32)" }}>{i + 1}</td>
                          <td style={S.td}>
                            <button
                              onClick={() => openLookup(w.address)}
                              style={{ ...S.mono, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              {w.address.slice(0, 10)}...{w.address.slice(-6)}
                            </button>
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
                      {scannerData.top_win_rates.length === 0 && (
                        <tr><td colSpan={5} style={{ padding: "32px", textAlign: "center" as const, ...S.muted }}>Run the daily scan to populate wallet data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ── Wallet profile card ───────────────────────────────────────────────────────

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
            { label: "AUM",      value: formatUsd(parseFloat(profile.state.accountValue)) },
            { label: "30d PnL",  value: formatUsd(profile.stats.total_pnl), color: pnlColor },
            { label: "Win Rate", value: formatPct(profile.stats.win_rate) },
            { label: "Trades",   value: `${profile.stats.trade_count}` },
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
          { label: "Avg Win",       value: formatUsd(profile.stats.avg_win),  color: "#6aaa7a" },
          { label: "Avg Loss",      value: formatUsd(profile.stats.avg_loss), color: "#b06868" },
          { label: "Profit Factor", value: profile.stats.profit_factor.toFixed(2) },
          { label: `${profile.stats.is_win_streak ? "Win" : "Loss"} Streak`, value: `${profile.stats.current_streak}` },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...S.card, padding: "16px" }}>
            <div style={S.label}>{label}</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: color ?? "#f0f0f0", marginTop: "6px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Detail tabs */}
      <div style={S.card}>
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
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
                  ["Account Value",  formatUsd(parseFloat(profile.state.accountValue))],
                  ["Total Notional", formatUsd(parseFloat(profile.state.totalNtlPos))],
                  ["Margin Used",    formatUsd(parseFloat(profile.state.totalMarginUsed))],
                  ["Withdrawable",   formatUsd(parseFloat(profile.state.withdrawable))],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
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
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
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
              {["Coin", "Side", "Size", "Value", "uPnL", "Entry Px", "Lev", "Liq Px"].map(h => (
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
                    <td style={{ ...S.td, color: p.liquidationPx ? "#b06868" : "rgba(255,255,255,0.44)" }}>{p.liquidationPx ? parseFloat(p.liquidationPx).toFixed(2) : "n/a"}</td>
                  </tr>
                );
              })}
              {profile.positions.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "32px", textAlign: "center" as const, ...S.muted }}>No open positions</td></tr>
              )}
            </tbody>
          </table>
        )}

        {tab === "trades" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["Time", "Coin", "Side", "Price", "Size", "Realized PnL"].map(h => (
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
                      {pnl !== 0 ? formatUsd(pnl) : "n/a"}
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

// ── Export ────────────────────────────────────────────────────────────────────

export default function WalletsPage() {
  return <WalletsInner />;
}
