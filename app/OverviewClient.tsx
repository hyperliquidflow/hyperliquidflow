"use client";
// app/OverviewClient.tsx — client wrapper; receives server-prefetched initialData so no skeleton on first load.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatUsd, formatPct, timeAgo, truncateAddress } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import type { MarketTickerEntry } from "@/app/api/market-ticker/route";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import { OverviewLoadingState } from "@/components/loading-state";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  title: { ...T.cardTitle },
  link:  { ...T.cardLink, marginLeft: "auto" } as const,
  muted: { fontSize: "13px", color: color.textMuted },
};

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
      ? color.hmQuiet
      : b.longN >= b.shortN ? color.hmLong : color.hmShort,
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

function RealSparkline({ data, positive, index }: { data: number[]; positive: boolean; index: number }) {
  const clr    = positive ? color.green : color.red;
  const gradId = `sg-real-${index}`;
  const n      = data.length;
  const pts    = data.map((v, i) => {
    const x = (i / (n - 1)) * 50;
    const y = 2 + (1 - v) * 16;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = pts.split(" ")[0].split(",");
  const last  = pts.split(" ")[n - 1].split(",");
  const fill  = `M0,19 L${first[0]},${first[1]} ${pts.split(" ").slice(1).join(" ")} L${last[0]},19 Z`;
  return (
    <svg viewBox="0 0 50 20" width="62" height="20" preserveAspectRatio="none" style={{ flexShrink: 0, opacity: 0.85 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={clr} stopOpacity="0.3" />
          <stop offset="100%" stopColor={clr} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={clr} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function DirectionSparkline({ positive, index }: { positive: boolean; index: number }) {
  const clr    = positive ? color.green : color.red;
  const gradId = `sg-dir-${index}`;
  const pts    = positive ? "0,14 10,11 20,7 30,5 40,2 50,0" : "0,2 10,6 20,9 30,12 40,14 50,16";
  const fill   = positive
    ? "M0,19 L0,14 L10,11 L20,7 L30,5 L40,2 L50,0 L50,19 Z"
    : "M0,19 L0,2 L10,6 L20,9 L30,12 L40,14 L50,16 L50,19 Z";
  return (
    <svg viewBox="0 0 50 20" width="62" height="20" preserveAspectRatio="none" style={{ flexShrink: 0, opacity: 0.8 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={clr} stopOpacity="0.28" />
          <stop offset="100%" stopColor={clr} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={clr} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function DirBadge({ direction }: { direction: string | null }) {
  if (!direction) return <span style={{ width: "46px" }} />;
  const long = direction === "LONG";
  return (
    <span style={{
      fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "4px",
      letterSpacing: "0.04em",
      background: long ? color.longBg : color.shortBg,
      color: long ? color.green : color.red,
      border: `1px solid ${long ? color.longBorder : color.shortBorder}`,
    }}>
      {direction}
    </span>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ padding: "32px" }}>
      <div style={{ background: color.card, border: `1px solid ${color.border}`, borderRadius: "12px", padding: "32px", textAlign: "center", color: color.red }}>
        Failed to load data: {message}
      </div>
    </div>
  );
}

interface Props {
  initialData: CohortCachePayload | null;
  initialTicker: MarketTickerEntry[] | null;
}

export function OverviewClient({ initialData, initialTicker }: Props) {
  const pollMs = parseInt(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "60000");

  const { data, error } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn:  () => fetch("/api/cohort-state").then(r => r.json()),
    initialData:      initialData ?? undefined,
    placeholderData:  keepPreviousData,
    refetchInterval:  pollMs,
    staleTime:        55_000,
  });

  const { data: ticker } = useQuery<MarketTickerEntry[]>({
    queryKey: ["market-ticker"],
    queryFn:  () => fetch("/api/market-ticker").then(r => r.json()),
    initialData:      initialTicker ?? undefined,
    placeholderData:  keepPreviousData,
    refetchInterval:  60_000,
    staleTime:        55_000,
  });

  if (!data && error) return <ErrorState message={String(error)} />;
  if (!data)          return <OverviewLoadingState />;

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
      <PageHeader title="Overview" regime={regime} btcReturn={data.btc_return_24h} />

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
        margin: "20px 32px 0",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "12px", overflow: "hidden",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 2px 20px rgba(0,0,0,0.4)", minHeight: "57px",
      }}>
        {ticker && ticker.length > 0 ? ticker.map((t, i) => {
          const pos = t.change24h >= 0;
          return (
            <div key={t.coin} style={{
              display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px",
              borderRight: i < ticker.length - 1 ? "1px solid rgba(255,255,255,0.05)" : undefined,
            }}>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.38)", textTransform: "uppercase" }}>{t.coin}</div>
                <div style={{ fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color.text, marginTop: "3px", whiteSpace: "nowrap" }}>
                  ${t.price >= 1000
                    ? t.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
                    : t.price.toFixed(2)}
                </div>
              </div>
              {t.sparkline && t.sparkline.length >= 2
                ? <RealSparkline data={t.sparkline} positive={pos} index={i} />
                : <DirectionSparkline positive={pos} index={i} />}
              <div style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: pos ? color.green : color.red }}>
                {pos ? "+" : ""}{formatPct(t.change24h)}
              </div>
            </div>
          );
        }) : Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px",
            borderRight: i < 5 ? "1px solid rgba(255,255,255,0.05)" : undefined,
          }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "transparent", background: "rgba(255,255,255,0.07)", borderRadius: "3px", userSelect: "none" }}>BTC</div>
              <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "3px", color: "transparent", background: "rgba(255,255,255,0.05)", borderRadius: "3px", userSelect: "none" }}>$00,000</div>
            </div>
            <div style={{ width: "62px", height: "20px", borderRadius: "3px", background: "rgba(255,255,255,0.04)", flexShrink: 0 }} />
            <div style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 700, color: "transparent", background: "rgba(255,255,255,0.06)", borderRadius: "3px", userSelect: "none" }}>+0.00%</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
          {[
            { label: "Smart Money",    value: `${data.wallet_count}`, sub: "wallets tracked" },
            { label: "Book Value",     value: formatUsd(totalAv),      sub: "across Smart Money" },
            { label: "Unrealised PnL", value: formatUsd(totalPnl), clr: totalPnl >= 0 ? color.green : color.red, sub: "open positions" },
            { label: "Avg Score",      value: avgScore.toFixed(2),     sub: "out of 1.00" },
          ].map(({ label, value, sub, clr }) => (
            <div key={label} style={{ ...S.card, padding: "20px", transition: "border-color 0.2s, background 0.2s" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)" }}>{label}</div>
              <div style={{ fontSize: "32px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: clr ?? color.text, marginTop: "10px", lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.32)", marginTop: "6px" }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ ...S.card, marginBottom: "16px" }}>
          <div style={S.hdr}>
            <span style={S.title}>Signal Activity · 24h</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: color.green, display: "inline-block" }} />
              Long bias
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: color.red, display: "inline-block", marginLeft: "10px" }} />
              Short bias
            </span>
          </div>
          <div style={{ padding: "14px 20px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "56px" }}>
              {heatmap.map((bar, i) => (
                <div key={i} style={{
                  flex: 1, borderRadius: "2px 2px 0 0",
                  height: `${bar.pct}%`, minHeight: "3px",
                  background: bar.isCurrent && bar.count > 0 ? color.green : bar.color,
                  boxShadow: bar.isCurrent && bar.count > 0 ? "0 0 10px rgba(106,170,122,0.4)" : undefined,
                  animation: bar.isCurrent && bar.count > 0 ? "bar-pulse 2s ease-in-out infinite" : undefined,
                }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "7px", fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.22)", letterSpacing: "0.04em" }}>
              <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "16px", marginBottom: "16px" }}>
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.title}>Recent Signals</span>
              <a href="/signals" style={S.link}>View all</a>
            </div>
            <div>
              {data.recent_signals.slice(0, 6).map((sig, i, arr) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "28px 1fr auto auto auto",
                  alignItems: "center", gap: "12px", padding: "12px 20px",
                  borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                  transition: "background 0.12s",
                }}>
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 600, color: color.text }}>{RECIPE_META[sig.recipe_id]?.label ?? sig.recipe_id}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.36)", marginTop: "2px" }}>{timeAgo(sig.detected_at)}</div>
                  </div>
                  <span style={{ ...T.sigCoinTag }}>{sig.coin}</span>
                  <DirBadge direction={sig.direction} />
                  <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", textAlign: "right", width: "46px" }}>
                    {sig.ev_score != null ? `EV ${(sig.ev_score * 100).toFixed(0)}` : ""}
                  </span>
                </div>
              ))}
              {data.recent_signals.length === 0 && (
                <div style={{ padding: "32px 20px", textAlign: "center", ...S.muted }}>No signals yet, waiting for next refresh cycle</div>
              )}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.title}>Top Wallets</span>
              <a href="/wallets" style={S.link}>Full report</a>
            </div>
            <div>
              {data.top_wallets.slice(0, 5).map((w, i, arr) => (
                <div key={w.wallet_id} style={{ padding: "14px 20px", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined, transition: "background 0.12s" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.22)" }}>#{i + 1}</span>
                    <span style={{ fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: w.overall_score >= 0.7 ? color.green : color.text }}>
                      {w.overall_score.toFixed(2)}
                    </span>
                  </div>
                  <a href={`/wallets?address=${w.address}`} style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "13px", color: "rgba(156,163,175,0.8)", marginTop: "4px", textDecoration: "none" }}>
                    {truncateAddress(w.address)}
                  </a>
                  <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", borderRadius: "1px", marginTop: "8px" }}>
                    <div style={{ width: `${w.overall_score * 100}%`, height: "100%", background: w.overall_score >= 0.7 ? color.green : color.neutral, borderRadius: "1px", transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.title}>Market Vibes</span>
              <span style={{ ...S.link, cursor: "default" }}>7 days</span>
            </div>
            <div style={{ padding: "18px 20px 20px", display: "flex", alignItems: "flex-start", position: "relative" }}>
              <div style={{ position: "absolute", top: "27px", left: "34px", right: "34px", height: "1px", background: "rgba(255,255,255,0.07)" }} />
              {regimeHist.map(({ label, regime: r, isToday }) => {
                const dotColor  = r === "BULL" ? color.green : r === "BEAR" ? color.red : "rgba(255,255,255,0.2)";
                const dotShadow = r === "BULL" ? "0 0 6px rgba(106,170,122,0.5)" : r === "BEAR" ? "0 0 6px rgba(201,36,53,0.5)" : undefined;
                const typeColor = r === "BULL" ? color.green : r === "BEAR" ? color.red : "rgba(255,255,255,0.3)";
                const typeLabel = r === "BULL" ? "Bull" : r === "BEAR" ? "Bear" : "Range";
                const size      = isToday ? 12 : 10;
                return (
                  <div key={label} style={{ flex: 1, textAlign: "center", position: "relative", zIndex: 1, cursor: "default" }}>
                    <div style={{ width: size, height: size, borderRadius: "50%", margin: isToday ? "-1px auto 7px" : "0 auto 7px", background: dotColor, boxShadow: dotShadow, border: "2px solid rgba(0,0,0,0.7)" }} />
                    <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: isToday ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)" }}>{label}</div>
                    <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", marginTop: "3px", textTransform: "uppercase", color: typeColor }}>{typeLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.title}>Smart Money Exposure</span>
              <span style={{ ...S.link, cursor: "default" }}>by position size</span>
            </div>
            <div style={{ padding: "12px 20px 18px", display: "flex", flexDirection: "column", gap: "11px" }}>
              {coinExposure.length > 0 ? coinExposure.map(({ coin, pct }) => (
                <div key={coin} style={{ display: "grid", gridTemplateColumns: "38px 1fr 40px", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>{coin}</span>
                  <div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color.green, borderRadius: "2px", transition: "width 0.65s cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.38)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
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
