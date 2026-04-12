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

// Coin-specific sparkline paths taken directly from layout-3-siderail prototype.
// Shape is fixed per coin; stroke colour reflects live 24h direction.
const SPARKLINE: Record<string, { pts: string; fill: string }> = {
  BTC: {
    pts:  "0,14 4,13 8,11 12,12 16,9 20,7 24,8 28,5 32,4 36,5 40,2 44,3 48,1 50,0",
    fill: "M0,19 L0,14 L4,13 L8,11 L12,12 L16,9 L20,7 L24,8 L28,5 L32,4 L36,5 L40,2 L44,3 L48,1 L50,0 L50,19 Z",
  },
  ETH: {
    pts:  "0,15 4,13 8,12 12,13 16,10 20,9 24,10 28,7 32,6 36,5 40,4 44,3 48,2 50,1",
    fill: "M0,19 L0,15 L4,13 L8,12 L12,13 L16,10 L20,9 L24,10 L28,7 L32,6 L36,5 L40,4 L44,3 L48,2 L50,1 L50,19 Z",
  },
  SOL: {
    pts:  "0,18 4,15 8,16 12,12 16,13 20,8 24,9 28,5 32,6 36,3 40,2 44,1 48,0 50,0",
    fill: "M0,19 L0,18 L4,15 L8,16 L12,12 L16,13 L20,8 L24,9 L28,5 L32,6 L36,3 L40,2 L44,1 L48,0 L50,0 L50,19 Z",
  },
  HYPE: {
    pts:  "0,2 4,3 8,1 12,4 16,3 20,6 24,5 28,8 32,7 36,10 40,11 44,13 48,14 50,16",
    fill: "M0,19 L0,2 L4,3 L8,1 L12,4 L16,3 L20,6 L24,5 L28,8 L32,7 L36,10 L40,11 L44,13 L48,14 L50,16 L50,19 Z",
  },
};

const S = {
  page:  { padding: "32px", maxWidth: "1400px", margin: "0 auto" },
  card:  { background: "rgba(12,12,12,0.7)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" as const, boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  hdr:   { borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "14px 20px", display: "flex", alignItems: "center" },
  title: { fontSize: "13px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.5)" },
  link:  { marginLeft: "auto", fontSize: "13px", color: "rgba(255,255,255,0.28)", textDecoration: "none" } as const,
  muted: { fontSize: "13px", color: "rgba(255,255,255,0.32)" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type Signal = CohortCachePayload["recent_signals"][number];

function buildHeatmap(signals: Signal[]) {
  const now = new Date();
  const bars = Array.from({ length: 24 }, (_, h) => {
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    start.setHours(now.getHours() - (23 - h));
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    const slot = signals.filter(s => {
      const t = new Date(s.detected_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    const longN  = slot.filter(s => s.direction === "LONG").length;
    const shortN = slot.filter(s => s.direction === "SHORT").length;
    return { count: slot.length, longN, shortN };
  });
  const max = Math.max(...bars.map(b => b.count), 1);
  return bars.map((b, i) => ({
    ...b,
    pct: Math.max(5, Math.round((b.count / max) * 100)),
    color: b.count === 0
      ? "rgba(255,255,255,0.09)"
      : b.longN >= b.shortN ? "rgba(106,170,122,0.5)" : "rgba(176,104,104,0.5)",
    isCurrent: i === 23,
  }));
}

function buildRegimeHistory(signals: Signal[], currentRegime: "BULL" | "BEAR" | "RANGING") {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);
    const isToday = i === 6;
    const label = isToday
      ? "Today"
      : d.toLocaleDateString("en-US", { weekday: "short" });

    let regime: "BULL" | "BEAR" | "RANGING";
    if (isToday) {
      regime = currentRegime;
    } else {
      const daySignals = signals.filter(s => {
        const t = new Date(s.detected_at).getTime();
        return t >= d.getTime() && t <= dEnd.getTime();
      });
      if (daySignals.length === 0) {
        regime = "RANGING";
      } else {
        const ln = daySignals.filter(s => s.direction === "LONG").length;
        const sn = daySignals.filter(s => s.direction === "SHORT").length;
        regime = ln > sn * 1.3 ? "BULL" : sn > ln * 1.3 ? "BEAR" : "RANGING";
      }
    }
    return { label, regime, isToday };
  });
}

function buildCoinExposure(signals: Signal[]) {
  const counts: Record<string, number> = {};
  for (const s of signals) counts[s.coin] = (counts[s.coin] ?? 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = sorted.reduce((s, [, c]) => s + c, 0) || 1;
  return sorted.map(([coin, count]) => ({ coin, pct: Math.round((count / total) * 100) }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

function OverviewInner() {
  const { data, isLoading, error } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then(r => r.json()),
    refetchInterval: parseInt(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "60000"),
    staleTime: 55_000,
  });

  const { data: ticker } = useQuery<MarketTickerEntry[]>({
    queryKey: ["market-ticker"],
    queryFn: () => fetch("/api/market-ticker").then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  if (isLoading) return <LoadingState />;
  if (error)     return <ErrorState message={String(error)} />;
  if (!data)     return null;

  const regime       = data.regime ?? "RANGING";
  const totalAv      = data.top_wallets.reduce((s, w) => s + w.account_value, 0);
  const totalPnl     = data.top_wallets.reduce((s, w) => s + w.unrealized_pnl, 0);
  const avgScore     = data.top_wallets.length > 0
    ? data.top_wallets.reduce((s, w) => s + w.overall_score, 0) / data.top_wallets.length : 0;
  const heatmap      = buildHeatmap(data.recent_signals);
  const regimeHist   = buildRegimeHistory(data.recent_signals, regime);
  const coinExposure = buildCoinExposure(data.recent_signals);

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
            const shape = SPARKLINE[t.coin];
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
                    ${t.price >= 1000
                      ? t.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
                      : t.price.toFixed(2)}
                  </div>
                </div>
                {shape ? (
                  <CoinSparkline coin={t.coin} positive={pos} shape={shape} />
                ) : (
                  <FallbackSparkline positive={pos} index={i} />
                )}
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
            { label: "Active Cohort",  value: `${data.wallet_count}`, sub: "wallets tracked" },
            { label: "Book Value",     value: formatUsd(totalAv),      sub: "across cohort" },
            { label: "Unrealised PnL", value: formatUsd(totalPnl), color: totalPnl >= 0 ? "#6aaa7a" : "#b06868", sub: "open positions" },
            { label: "Avg Score",      value: avgScore.toFixed(2),     sub: "out of 1.00" },
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
            <span style={S.title}>Signal Activity · 24h</span>
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
                <div key={i} style={{
                  flex: 1,
                  borderRadius: "2px 2px 0 0",
                  height: `${bar.pct}%`,
                  minHeight: "3px",
                  background: bar.isCurrent && bar.count > 0 ? "#6aaa7a" : bar.color,
                  boxShadow: bar.isCurrent && bar.count > 0 ? "0 0 10px rgba(106,170,122,0.4)" : undefined,
                  animation: bar.isCurrent && bar.count > 0 ? "bar-pulse 2s ease-in-out infinite" : undefined,
                }} />
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
              <span style={S.title}>Recent Signals</span>
              <a href="/signals" style={S.link}>View all →</a>
            </div>
            <div>
              {data.recent_signals.slice(0, 6).map((sig, i, arr) => (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr auto auto auto",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 20px",
                  borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                  transition: "background 0.12s",
                }}>
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
              <span style={S.title}>Top Wallets</span>
              <a href="/wallets" style={S.link}>Full report →</a>
            </div>
            <div>
              {data.top_wallets.slice(0, 5).map((w, i, arr) => (
                <div key={w.wallet_id} style={{ padding: "14px 20px", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined, transition: "background 0.12s" }}>
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

        {/* ── Bottom row: Regime history + Cohort exposure ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

          {/* Regime History — 7-day dot timeline */}
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.title}>Regime History</span>
              <span style={{ ...S.link, cursor: "default" }}>7 days</span>
            </div>
            <div style={{ padding: "18px 20px 20px", display: "flex", alignItems: "flex-start", position: "relative" }}>
              {/* Connecting track line */}
              <div style={{ position: "absolute", top: "27px", left: "34px", right: "34px", height: "1px", background: "rgba(255,255,255,0.07)" }} />
              {regimeHist.map(({ label, regime: r, isToday }) => {
                const dotColor  = r === "BULL" ? "#6aaa7a" : r === "BEAR" ? "#b06868" : "rgba(255,255,255,0.2)";
                const dotShadow = r === "BULL" ? "0 0 6px rgba(106,170,122,0.5)" : r === "BEAR" ? "0 0 6px rgba(176,104,104,0.5)" : undefined;
                const typeColor = r === "BULL" ? "#6aaa7a" : r === "BEAR" ? "#b06868" : "rgba(255,255,255,0.3)";
                const typeLabel = r === "BULL" ? "Bull" : r === "BEAR" ? "Bear" : "Range";
                const size      = isToday ? 12 : 10;
                return (
                  <div key={label} style={{ flex: 1, textAlign: "center", position: "relative", zIndex: 1, cursor: "default" }}>
                    <div style={{
                      width: size, height: size,
                      borderRadius: "50%",
                      margin: isToday ? "-1px auto 7px" : "0 auto 7px",
                      background: dotColor,
                      boxShadow: dotShadow,
                      border: "2px solid rgba(0,0,0,0.7)",
                    }} />
                    <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: isToday ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)" }}>{label}</div>
                    <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em", marginTop: "3px", textTransform: "uppercase", color: typeColor }}>{typeLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cohort Exposure — coin bars derived from signal activity */}
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.title}>Cohort Exposure</span>
              <span style={{ ...S.link, cursor: "default" }}>by position size</span>
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

function CoinSparkline({ coin, positive, shape }: { coin: string; positive: boolean; shape: { pts: string; fill: string } }) {
  const color = positive ? "#6aaa7a" : "#b06868";
  const gradId = `sg-${coin.toLowerCase()}`;
  return (
    <svg viewBox="0 0 50 20" width="62" height="20" preserveAspectRatio="none" style={{ flexShrink: 0, opacity: 0.8 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={shape.fill} fill={`url(#${gradId})`} />
      <polyline points={shape.pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function FallbackSparkline({ positive, index }: { positive: boolean; index: number }) {
  const color = positive ? "#6aaa7a" : "#b06868";
  const gradId = `sg-fallback-${index}`;
  const pts  = positive ? "0,14 10,11 20,7 30,5 40,2 50,0"   : "0,2 10,6 20,9 30,12 40,14 50,16";
  const fill = positive ? "M0,19 L0,14 L10,11 L20,7 L30,5 L40,2 L50,0 L50,19 Z"
                        : "M0,19 L0,2 L10,6 L20,9 L30,12 L40,14 L50,16 L50,19 Z";
  return (
    <svg viewBox="0 0 50 20" width="62" height="20" preserveAspectRatio="none" style={{ flexShrink: 0, opacity: 0.8 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gradId})`} />
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
