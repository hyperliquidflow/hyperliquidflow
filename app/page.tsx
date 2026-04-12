"use client";
// app/page.tsx — Overview page

import { useQuery } from "@tanstack/react-query";
import { formatUsd, formatPct, timeAgo, truncateAddress } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import type { MarketTickerEntry } from "@/app/api/market-ticker/route";
import { PageHeader } from "@/components/page-header";

const RECIPE_LABELS: Record<string, string> = {
  momentum_stack:       "Momentum Stack",
  divergence_squeeze:   "Divergence Squeeze",
  accumulation_reentry: "Accumulation Re-Entry",
  rotation_carry:       "Rotation Carry",
  liq_rebound:          "Liq Rebound",
  streak_continuation:  "Streak Continuation",
  funding_divergence:   "Funding Divergence",
  whale_validated:      "Whale Validated",
  anti_whale_trap:      "Anti-Whale Trap",
};

const S = {
  page:  { padding: "32px", maxWidth: "1400px", margin: "0 auto" },
  card:  { background: "rgba(12,12,12,0.7)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" as const, boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  hdr:   { borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "14px 20px", display: "flex", alignItems: "center" },
  label: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.5)" },
  link:  { marginLeft: "auto", fontSize: "13px", color: "rgba(255,255,255,0.28)", textDecoration: "none" } as const,
  muted: { fontSize: "13px", color: "rgba(255,255,255,0.32)" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type Signal = CohortCachePayload["recent_signals"][number];

function buildHeatmap(signals: Signal[]) {
  const now = new Date();
  const bars = Array.from({ length: 24 }, (_, h) => {
    const slotStart = new Date(now);
    slotStart.setMinutes(0, 0, 0);
    slotStart.setHours(now.getHours() - (23 - h));
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(slotStart.getHours() + 1);
    const inSlot = signals.filter(s => {
      const t = new Date(s.detected_at).getTime();
      return t >= slotStart.getTime() && t < slotEnd.getTime();
    });
    const longN  = inSlot.filter(s => s.direction === "LONG").length;
    const shortN = inSlot.filter(s => s.direction === "SHORT").length;
    return { count: inSlot.length, longN, shortN };
  });
  const max = Math.max(...bars.map(b => b.count), 1);
  return bars.map((b, i) => ({
    ...b,
    pct: Math.max(5, Math.round((b.count / max) * 100)),
    color: b.count === 0
      ? "rgba(255,255,255,0.09)"
      : b.longN >= b.shortN
        ? "rgba(106,170,122,0.5)"
        : "rgba(176,104,104,0.5)",
    isCurrent: i === 23,
  }));
}

function buildCoinExposure(signals: Signal[]) {
  const counts: Record<string, number> = {};
  for (const s of signals) counts[s.coin] = (counts[s.coin] ?? 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = sorted.reduce((s, [, c]) => s + c, 0) || 1;
  return sorted.map(([coin, count]) => ({ coin, pct: Math.round((count / total) * 100) }));
}

// ── Main component ─────────────────────────────────────────────────────────────

function OverviewInner() {
  const { data, isLoading, error } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: parseInt(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "60000"),
    staleTime: 55_000,
  });

  const { data: ticker } = useQuery<MarketTickerEntry[]>({
    queryKey: ["market-ticker"],
    queryFn: () => fetch("/api/market-ticker").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  if (isLoading) return <LoadingState />;
  if (error)     return <ErrorState message={String(error)} />;
  if (!data)     return null;

  const regime    = data.regime ?? "RANGING";
  const totalAv   = data.top_wallets.reduce((s, w) => s + w.account_value, 0);
  const totalPnl  = data.top_wallets.reduce((s, w) => s + w.unrealized_pnl, 0);
  const avgScore  = data.top_wallets.length > 0
    ? data.top_wallets.reduce((s, w) => s + w.overall_score, 0) / data.top_wallets.length
    : 0;
  const heatmap      = buildHeatmap(data.recent_signals);
  const coinExposure = buildCoinExposure(data.recent_signals);

  const REGIME_COLOR = regime === "BULL" ? "#6aaa7a" : regime === "BEAR" ? "#b06868" : "#9ca3af";
  const REGIME_LABEL = regime === "BULL" ? "BULLISH" : regime === "BEAR" ? "BEARISH" : "RANGING";

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`${data.wallet_count} wallets · BTC 24h: ${data.btc_return_24h >= 0 ? "+" : ""}${formatPct(data.btc_return_24h)}`}
        regime={regime}
      />
      {/* ── Market ticker strip ── */}
      {ticker && ticker.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${ticker.length}, 1fr)`,
          margin: "20px 32px 0",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "12px",
          overflow: "hidden",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "0 2px 20px rgba(0,0,0,0.4)",
        }}>
          {ticker.map((t, i) => {
            const pos = t.change24h >= 0;
            return (
              <div key={t.coin} style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                padding: "14px 18px",
                borderRight: i < ticker.length - 1 ? "1px solid rgba(255,255,255,0.05)" : undefined,
              }}>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.38)", textTransform: "uppercase" }}>{t.coin}</div>
                  <div style={{ fontSize: "15px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#f0f0f0", marginTop: "3px", whiteSpace: "nowrap" }}>
                    ${t.price >= 1000 ? t.price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : t.price.toFixed(2)}
                  </div>
                </div>
                <Sparkline positive={pos} />
                <div style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: pos ? "#6aaa7a" : "#b06868" }}>
                  {pos ? "+" : ""}{formatPct(t.change24h)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ ...S.page, paddingTop: "20px" }}>

        {/* ── Stat row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
          {[
            { label: "Active Cohort",    value: `${data.wallet_count}`,  sub: "wallets tracked" },
            { label: "Book Value",       value: formatUsd(totalAv),       sub: "across cohort" },
            { label: "Unrealised PnL",   value: formatUsd(totalPnl), color: totalPnl >= 0 ? "#6aaa7a" : "#b06868", sub: "open positions" },
            { label: "Avg Score",        value: avgScore.toFixed(2),      sub: "out of 1.00" },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ ...S.card, padding: "20px", transition: "border-color 0.2s, background 0.2s" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)" }}>{label}</div>
              <div style={{ fontSize: "31px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color ?? "#f0f0f0", marginTop: "10px", lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.32)", marginTop: "6px" }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Signal activity heatmap ── */}
        <div style={{ ...S.card, marginBottom: "16px" }}>
          <div style={S.hdr}>
            <span style={S.label}>Signal Activity · 24h</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#6aaa7a", display: "inline-block" }} />
              Long bias
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#b06868", display: "inline-block", marginLeft: "10px" }} />
              Short bias
            </span>
          </div>
          <div style={{ padding: "14px 20px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "56px" }}>
              {heatmap.map((bar, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    borderRadius: "2px 2px 0 0",
                    height: `${bar.pct}%`,
                    minHeight: "3px",
                    background: bar.isCurrent && bar.count > 0 ? "#6aaa7a" : bar.color,
                    boxShadow: bar.isCurrent && bar.count > 0 ? "0 0 10px rgba(106,170,122,0.4)" : undefined,
                    animation: bar.isCurrent && bar.count > 0 ? "bar-pulse 2s ease-in-out infinite" : undefined,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "7px", fontSize: "10px", fontWeight: 500, color: "rgba(255,255,255,0.22)", letterSpacing: "0.04em" }}>
              <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
            </div>
          </div>
        </div>

        {/* ── Two column: signals 3fr + wallets 2fr ── */}
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "16px", marginBottom: "16px" }}>

          {/* Recent Signals */}
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Recent Signals</span>
              <a href="/signals" style={S.link}>View all →</a>
            </div>
            <div>
              {data.recent_signals.slice(0, 6).map((sig, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr auto auto auto",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.2)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 600, color: "#f0f0f0" }}>{RECIPE_LABELS[sig.recipe_id] ?? sig.recipe_id}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.36)", marginTop: "2px" }}>{timeAgo(sig.detected_at)}</div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}>{sig.coin}</span>
                  <DirBadge direction={sig.direction} />
                  <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", textAlign: "right", width: "46px" }}>
                    {sig.ev_score != null ? `EV ${(sig.ev_score * 100).toFixed(0)}` : ""}
                  </span>
                </div>
              ))}
              {data.recent_signals.length === 0 && (
                <div style={{ padding: "32px 20px", textAlign: "center", ...S.muted }}>No signals yet — waiting for next refresh cycle</div>
              )}
            </div>
          </div>

          {/* Top Wallets */}
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Top Wallets</span>
              <a href="/wallets" style={S.link}>Full report →</a>
            </div>
            <div>
              {data.top_wallets.slice(0, 5).map((w, i) => (
                <div key={w.wallet_id} style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.22)" }}>#{i + 1}</span>
                    <span style={{ fontSize: "17px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: w.overall_score >= 0.7 ? "#6aaa7a" : "#f0f0f0" }}>
                      {w.overall_score.toFixed(2)}
                    </span>
                  </div>
                  <a href={`/stalker?address=${w.address}`} style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "13px", color: "rgba(156,163,175,0.8)", marginTop: "4px", textDecoration: "none" }}>
                    {truncateAddress(w.address)}
                  </a>
                  <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", borderRadius: "1px", marginTop: "8px" }}>
                    <div style={{ width: `${w.overall_score * 100}%`, height: "100%", background: w.overall_score >= 0.7 ? "#6aaa7a" : "#606060", borderRadius: "1px", transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bottom row: Regime status + Coin exposure ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

          {/* Regime Status */}
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Regime Status</span>
              <span style={S.link}>live</span>
            </div>
            <div style={{ padding: "18px 20px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: REGIME_COLOR, boxShadow: `0 0 8px ${REGIME_COLOR}`, display: "inline-block", flexShrink: 0, animation: "glow-pulse 2s ease-in-out infinite" }} />
                <span style={{ fontSize: "22px", fontWeight: 700, color: REGIME_COLOR }}>{REGIME_LABEL}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                {[
                  { label: "BTC 24h",         value: `${data.btc_return_24h >= 0 ? "+" : ""}${formatPct(data.btc_return_24h)}`, color: data.btc_return_24h >= 0 ? "#6aaa7a" : "#b06868" },
                  { label: "Active Wallets",   value: `${data.top_wallets.filter(w => w.position_count > 0).length}`, color: "#f0f0f0" },
                  { label: "Signals 24h",      value: `${data.recent_signals.length}`, color: "#f0f0f0" },
                  { label: "Avg Regime Fit",   value: (data.top_wallets.reduce((s, w) => s + w.regime_fit, 0) / Math.max(data.top_wallets.length, 1)).toFixed(2), color: "#f0f0f0" },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)" }}>{label}</div>
                    <div style={{ fontSize: "18px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color, marginTop: "4px" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Coin Exposure from signals */}
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Signal Exposure</span>
              <span style={{ ...S.link, cursor: "default" }}>by signal count</span>
            </div>
            <div style={{ padding: "12px 20px 18px", display: "flex", flexDirection: "column", gap: "11px" }}>
              {coinExposure.length > 0 ? coinExposure.map(({ coin, pct }) => (
                <div key={coin} style={{ display: "grid", gridTemplateColumns: "38px 1fr 40px", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>{coin}</span>
                  <div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "#6aaa7a", borderRadius: "2px", transition: "width 0.65s cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.38)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                </div>
              )) : (
                <div style={{ ...S.muted, paddingTop: "8px" }}>No signal data yet</div>
              )}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Sparkline({ positive }: { positive: boolean }) {
  const color = positive ? "#6aaa7a" : "#b06868";
  const id = positive ? "sg-pos" : "sg-neg";
  const pts = positive
    ? "0,14 4,13 8,11 12,12 16,9 20,7 24,8 28,5 32,4 36,5 40,2 44,3 48,1 50,0"
    : "0,2 4,3 8,1 12,4 16,3 20,6 24,5 28,8 32,7 36,10 40,11 44,13 48,14 50,16";
  const fill = positive
    ? "M0,19 L0,14 L4,13 L8,11 L12,12 L16,9 L20,7 L24,8 L28,5 L32,4 L36,5 L40,2 L44,3 L48,1 L50,0 L50,19 Z"
    : "M0,19 L0,2 L4,3 L8,1 L12,4 L16,3 L20,6 L24,5 L28,8 L32,7 L36,10 L40,11 L44,13 L48,14 L50,16 L50,19 Z";
  return (
    <svg viewBox="0 0 50 20" width="62" height="20" preserveAspectRatio="none" style={{ flexShrink: 0, opacity: 0.8 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function DirBadge({ direction }: { direction: string | null }) {
  if (!direction) return <span style={{ width: "46px" }} />;
  const long = direction === "LONG";
  return (
    <span style={{
      fontSize: "12px", fontWeight: 700, padding: "3px 9px", borderRadius: "4px",
      letterSpacing: "0.04em",
      background: long ? "rgba(106,170,122,0.1)" : "rgba(176,104,104,0.1)",
      color: long ? "#6aaa7a" : "#b06868",
      border: `1px solid ${long ? "rgba(106,170,122,0.2)" : "rgba(176,104,104,0.2)"}`,
    }}>
      {direction}
    </span>
  );
}

function LoadingState() {
  return (
    <div style={{ padding: "32px", maxWidth: "1400px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ background: "rgba(12,12,12,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", height: "80px", opacity: 0.4 }} />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ padding: "32px", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ background: "rgba(12,12,12,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "32px", textAlign: "center", color: "#b06868" }}>
        Failed to load data: {message}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return <OverviewInner />;
}
