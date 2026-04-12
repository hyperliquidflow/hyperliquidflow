"use client";
// app/deep-dive/page.tsx — Single Token Deep Dive
// Candle chart, funding history, OI, cohort exposure for any coin.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUsd, formatPct } from "@/lib/utils";
import { QueryProvider } from "@/components/query-provider";

const S = {
  page:  { padding: "28px", maxWidth: "1200px", margin: "0 auto" },
  card:  { background: "rgba(14,14,14,0.65)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", overflow: "hidden" as const, boxShadow: "0 4px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)" },
  hdr:   { borderBottom: "1px solid rgba(180,180,180,0.06)", padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px" },
  label: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)" },
  muted: { color: "rgba(255,255,255,0.44)", fontSize: "11px" },
};

const FALLBACK_COINS = ["BTC","ETH","SOL","ARB","DOGE","AVAX","SUI","WIF","PEPE","HYPE"];
const INTERVALS = ["5m","15m","1h","4h","1d"];

interface DeepDiveData {
  coin: string;
  candles: Array<{ t: number; o: string; h: string; l: string; c: string; v: string }>;
  ctx: { funding: string; openInterest: string; markPx: string; dayNtlVlm: string; prevDayPx: string } | null;
  fundingHistory: Array<{ time: number; fundingRate: string }>;
  cohortExposure: { net_notional: number; wallet_count: number; direction: string } | null;
}

function DeepDiveInner() {
  const [coin,     setCoin]     = useState("BTC");
  const [interval, setInterval] = useState("1h");
  const [input,    setInput]    = useState("BTC");

  const { data: topCoins } = useQuery<string[]>({
    queryKey: ["top-markets"],
    queryFn:  () => fetch("/api/top-markets?n=12").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  const quickCoins = Array.isArray(topCoins) ? topCoins : FALLBACK_COINS;

  const { data, isLoading, error } = useQuery<DeepDiveData>({
    queryKey: ["deep-dive", coin, interval],
    queryFn:  () => fetch(`/api/deep-dive?coin=${coin}&interval=${interval}`).then((r) => r.json()),
    refetchInterval: 60_000,
    enabled: !!coin,
  });

  const handleSearch = () => { if (input.trim()) setCoin(input.trim().toUpperCase()); };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#f0f0f0" }}>Single Token Deep Dive</h1>
        <p style={S.muted}>Funding rates, open interest, candles, and cohort exposure for any coin</p>
      </div>

      {/* Search + quick coins */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" as const, alignItems: "center" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Enter coin (e.g. BTC)"
            style={{ background: "#141414", border: "1px solid rgba(180,180,180,0.12)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 12px", fontSize: "13px", outline: "none", width: "140px", fontFamily: "var(--font-mono)" }} />
          <button onClick={handleSearch} style={{ padding: "6px 14px", background: "#1c1c1c", border: "1px solid rgba(180,180,180,0.12)", borderRadius: "5px", color: "#f0f0f0", fontSize: "12px", cursor: "pointer" }}>
            Dive
          </button>
        </div>

        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" as const }}>
          {quickCoins.map((c) => (
            <button key={c} onClick={() => { setCoin(c); setInput(c); }}
              className={`ios-pill${coin === c ? " ios-active" : ""}`}
              style={{ padding: "5px 12px", fontSize: "11px" }}>
              {c}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
          {INTERVALS.map((iv) => (
            <button key={iv} onClick={() => setInterval(iv)}
              className={`ios-pill${interval === iv ? " ios-active" : ""}`}
              style={{ padding: "5px 12px", fontSize: "11px" }}>
              {iv}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div style={S.muted}>Loading {coin}…</div>}
      {error    && <div style={{ color: "#b06868", fontSize: "12px" }}>Error loading data</div>}

      {data && !isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Key metrics */}
          {data.ctx && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
              {[
                { label: "Mark Price",  value: `$${parseFloat(data.ctx.markPx).toLocaleString()}` },
                { label: "24h Change",  value: formatPct((parseFloat(data.ctx.markPx) - parseFloat(data.ctx.prevDayPx)) / parseFloat(data.ctx.prevDayPx)), color: parseFloat(data.ctx.markPx) >= parseFloat(data.ctx.prevDayPx) ? "#6aaa7a" : "#b06868" },
                { label: "Open Interest", value: formatUsd(parseFloat(data.ctx.openInterest)) },
                { label: "24h Volume",  value: formatUsd(parseFloat(data.ctx.dayNtlVlm)) },
                { label: "Funding /hr", value: `${(parseFloat(data.ctx.funding) * 100).toFixed(4)}%`, color: parseFloat(data.ctx.funding) > 0 ? "#6aaa7a" : "#b06868" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ ...S.card, padding: "14px 16px" }}>
                  <div style={S.label}>{label}</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: color ?? "#f0f0f0", marginTop: "6px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Cohort exposure */}
          {data.cohortExposure && (
            <div style={{ ...S.card, padding: "16px 20px", display: "flex", alignItems: "center", gap: "20px",
              background: data.cohortExposure.direction === "LONG" ? "rgba(106,170,122,0.05)" : "rgba(176,104,104,0.05)",
              border: `1px solid ${data.cohortExposure.direction === "LONG" ? "rgba(106,170,122,0.2)" : "rgba(176,104,104,0.2)"}` }}>
              <div>
                <div style={S.label}>Smart Money Cohort Exposure</div>
                <div style={{ fontSize: "18px", fontWeight: 700, color: data.cohortExposure.direction === "LONG" ? "#6aaa7a" : "#b06868", marginTop: "4px" }}>
                  NET {data.cohortExposure.direction} · {formatUsd(Math.abs(data.cohortExposure.net_notional))}
                </div>
              </div>
              <div style={{ marginLeft: "auto", ...S.muted }}>
                {data.cohortExposure.wallet_count} wallets positioned
              </div>
            </div>
          )}

          {/* Candle chart (lightweight-charts placeholder — rendered client-side) */}
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>{coin} / USD · {interval}</span>
              <span style={{ ...S.muted, marginLeft: "auto" }}>{data.candles.length} candles</span>
            </div>
            <CandleChart candles={data.candles} />
          </div>

          {/* Funding history chart */}
          {data.fundingHistory.length > 0 && (
            <div style={S.card}>
              <div style={S.hdr}><span style={S.label}>Funding Rate History</span></div>
              <FundingChart history={data.fundingHistory} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Candle chart using lightweight-charts ─────────────────────────────────────
import { useEffect, useRef } from "react";

function CandleChart({ candles }: { candles: Array<{ t: number; o: string; h: string; l: string; c: string }> }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    let chart: ReturnType<typeof import("lightweight-charts").createChart> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (!containerRef.current) return;

      chart = createChart(containerRef.current, {
        width:  containerRef.current.clientWidth,
        height: 320,
        layout: { background: { type: ColorType.Solid, color: "#0f0f0f" }, textColor: "rgba(255,255,255,0.69)" },
        grid:   { vertLines: { color: "rgba(180,180,180,0.06)" }, horzLines: { color: "rgba(180,180,180,0.06)" } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: "rgba(180,180,180,0.12)" },
        timeScale: { borderColor: "rgba(180,180,180,0.12)", timeVisible: true },
      });

      const series = chart.addCandlestickSeries({
        upColor:   "#6aaa7a", downColor: "#b06868",
        borderUpColor: "#6aaa7a", borderDownColor: "#b06868",
        wickUpColor:   "#6aaa7a", wickDownColor:   "#b06868",
      });

      series.setData(
        candles.map((c) => ({
          time:  Math.floor(c.t / 1000) as unknown as import("lightweight-charts").Time,
          open:  parseFloat(c.o),
          high:  parseFloat(c.h),
          low:   parseFloat(c.l),
          close: parseFloat(c.c),
        }))
      );

      chart.timeScale().fitContent();
    });

    return () => { chart?.remove(); };
  }, [candles]);

  return <div ref={containerRef} style={{ width: "100%", height: "320px" }} />;
}

function FundingChart({ history }: { history: Array<{ time: number; fundingRate: string }> }) {
  const max = Math.max(...history.map((h) => Math.abs(parseFloat(h.fundingRate))));
  return (
    <div style={{ padding: "16px 20px", display: "flex", alignItems: "flex-end", gap: "2px", height: "80px" }}>
      {history.slice(-48).map((h, i) => {
        const rate  = parseFloat(h.fundingRate);
        const pct   = max > 0 ? Math.abs(rate) / max : 0;
        const color = rate > 0 ? "#6aaa7a" : "#b06868";
        return (
          <div key={i} title={`${(rate * 100).toFixed(4)}%`}
            style={{ flex: 1, height: `${Math.max(pct * 100, 4)}%`, background: color, opacity: 0.7, borderRadius: "1px" }} />
        );
      })}
    </div>
  );
}

export default function DeepDivePage() {
  return <QueryProvider><DeepDiveInner /></QueryProvider>;
}
