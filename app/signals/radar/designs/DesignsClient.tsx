"use client";
// app/signals/radar/designs/DesignsClient.tsx
// Five radar-chart design variants rendered from the same BTC/all dataset.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { formatUsd } from "@/lib/utils";
import type { RadarResponse, RadarBucket, TimeseriesResponse } from "@/lib/radar-utils";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return "--";
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (n >= 1)    return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

const S = {
  page:     { padding: `${space.contentPaddingTop} ${space.pagePaddingX} ${space.contentPaddingBot}` },
  grid:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
  fullSpan: { gridColumn: "1 / -1" },
  card:     { ...C.base, display: "flex", flexDirection: "column" as const },
  hdr:      { ...C.header, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  hdrTitle: { ...T.cardTitle },
  hdrHint:  { fontSize: 11, color: color.textMuted },
  body:     { padding: "14px 18px 18px", flex: 1 },
};

interface Props {
  initialData: RadarResponse | null;
  initialTimeseries?: TimeseriesResponse | null;
}

export function DesignsClient({ initialData, initialTimeseries }: Props) {
  const { data } = useQuery<RadarResponse>({
    queryKey: ["market-radar", "BTC", "all"],
    queryFn:  () => fetch("/api/market-radar?asset=BTC&tier=all").then((r) => r.json()),
    initialData: initialData ?? undefined,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  const { data: tsData } = useQuery<TimeseriesResponse>({
    queryKey: ["market-radar-ts", "BTC", "all", 72, 30],
    queryFn:  () => fetch("/api/market-radar/timeseries?asset=BTC&tier=all&hours=72&bin=30").then((r) => r.json()),
    initialData: initialTimeseries ?? undefined,
    refetchInterval: 180_000,
    staleTime: 170_000,
  });

  if (!data) {
    return (
      <div>
        <PageHeader title="Radar Designs" subtitle="Loading" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Radar Designs" subtitle="Five variants of the Market Radar, same BTC cohort data" />
      <div style={S.page}>
        <div style={S.grid}>
          <Panel title="1 · Mirrored Bars (auto-zoom)" hint="Trims empty price range to focus on the dense band">
            <Design1 data={data} />
          </Panel>

          <Panel title="2 · Volume Profile (TPO blocks)" hint="Each square = one wallet at that price level">
            <Design2 data={data} />
          </Panel>

          <Panel title="3 · Depth Ladder" hint="Orderbook-style dense row list, every bucket labeled">
            <Design3 data={data} />
          </Panel>

          <Panel title="4 · Heatmap Column (net bias)" hint="Single strip, color = net bias, intensity = notional">
            <Design4 data={data} />
          </Panel>

          <Panel title="5 · Radial Radar" hint="Polar coordinates, on-brand with the page name">
            <Design5 data={data} />
          </Panel>

          <div style={S.fullSpan}>
            <Panel title="6 · Liquidation Heatmap (price x time)" hint="Coinglass-style: 72h of real wallet liq levels, 30-min bins">
              {tsData ? <Design6 data={tsData} /> : <HeatmapEmpty />}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={S.card}>
      <div style={S.hdr}>
        <span style={S.hdrTitle}>{title}</span>
        <span style={S.hdrHint}>{hint}</span>
      </div>
      <div style={S.body}>{children}</div>
    </div>
  );
}

// Shared helpers --------------------------------------------------------------

function useMaxNotional(buckets: RadarBucket[]): number {
  return useMemo(() => {
    let m = 0;
    for (const b of buckets) {
      if (b.long_notional  > m) m = b.long_notional;
      if (b.short_notional > m) m = b.short_notional;
    }
    return m;
  }, [buckets]);
}

// Trim empty head/tail buckets so the chart shows only the active range.
function trimBuckets(buckets: RadarBucket[]): { slice: RadarBucket[]; from: number; to: number } {
  let from = 0;
  let to = buckets.length - 1;
  while (from < buckets.length && isEmptyBucket(buckets[from])) from++;
  while (to   >= 0            && isEmptyBucket(buckets[to]))   to--;
  if (from > to) return { slice: buckets, from: 0, to: buckets.length - 1 };
  return { slice: buckets.slice(from, to + 1), from, to };
}

function isEmptyBucket(b: RadarBucket): boolean {
  return b.long_count === 0 && b.short_count === 0 && b.liq_long_count === 0 && b.liq_short_count === 0;
}

// Design 1: Mirrored bars, auto-zoom ------------------------------------------

function Design1({ data }: { data: RadarResponse }) {
  const { slice } = trimBuckets(data.buckets);
  const maxN = useMaxNotional(slice);
  const VBW = 1000, VBH = 460;
  const CX = VBW / 2, LEFT_PAD = 70, RIGHT_PAD = 70;
  const usableHalf = CX - LEFT_PAD;
  const rowH = VBH / slice.length;

  const priceMin = slice[0]?.price_low ?? data.price_range.min;
  const priceMax = slice[slice.length - 1]?.price_high ?? data.price_range.max;
  const currentY = VBH - ((data.current_price - priceMin) / (priceMax - priceMin)) * VBH;

  const labelIdxs = [0, Math.floor(slice.length / 4), Math.floor(slice.length / 2), Math.floor(slice.length * 3 / 4), slice.length - 1];

  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} style={{ width: "100%", height: 440, display: "block" }}>
      {labelIdxs.map((i) => {
        const y = VBH - (i + 1) * rowH;
        return (
          <g key={i}>
            <line x1={LEFT_PAD} x2={VBW - RIGHT_PAD} y1={y + rowH} y2={y + rowH}
                  stroke={color.borderFaint} strokeWidth={0.6} />
            <text x={LEFT_PAD - 8} y={y + rowH + 3} textAnchor="end"
                  fontSize={11} fill="rgba(255,255,255,0.38)">
              {formatPrice(slice[i].price_low)}
            </text>
          </g>
        );
      })}
      <line x1={CX} x2={CX} y1={0} y2={VBH} stroke={color.border} strokeWidth={0.8} />
      {slice.map((b, i) => {
        const y = VBH - (i + 1) * rowH;
        const longW  = maxN > 0 ? (b.long_notional  / maxN) * usableHalf : 0;
        const shortW = maxN > 0 ? (b.short_notional / maxN) * usableHalf : 0;
        const barH = Math.max(2, rowH - 1);
        return (
          <g key={i}>
            {longW  > 0 && <rect x={CX - longW} y={y + 0.5} width={longW}  height={barH} fill={color.green} fillOpacity={0.82} rx={1} />}
            {shortW > 0 && <rect x={CX}         y={y + 0.5} width={shortW} height={barH} fill={color.red}   fillOpacity={0.82} rx={1} />}
            {b.liq_long_count  > 0 && (
              <line x1={CX - usableHalf} x2={CX} y1={y + barH / 2} y2={y + barH / 2}
                    stroke={color.green} strokeOpacity={0.45} strokeWidth={1.2} strokeDasharray="3 3" />
            )}
            {b.liq_short_count > 0 && (
              <line x1={CX} x2={CX + usableHalf} y1={y + barH / 2} y2={y + barH / 2}
                    stroke={color.red} strokeOpacity={0.45} strokeWidth={1.2} strokeDasharray="3 3" />
            )}
          </g>
        );
      })}
      <line x1={LEFT_PAD} x2={VBW - RIGHT_PAD} y1={currentY} y2={currentY}
            stroke={color.accent} strokeWidth={1.5} />
      <rect x={VBW - RIGHT_PAD + 2} y={currentY - 10} width={RIGHT_PAD - 4} height={20}
            fill={color.accent} fillOpacity={0.12} stroke={color.accent} strokeWidth={0.8} rx={3} />
      <text x={VBW - RIGHT_PAD + 6} y={currentY + 4} fontSize={11} fontWeight={700} fill={color.accent}>
        {formatPrice(data.current_price)}
      </text>
    </svg>
  );
}

// Design 2: Volume profile (TPO blocks) ----------------------------------------

function Design2({ data }: { data: RadarResponse }) {
  const { slice } = trimBuckets(data.buckets);
  const VBW = 1000, VBH = 460;
  const CX = VBW / 2, LEFT_PAD = 70, RIGHT_PAD = 70;
  const usableHalf = CX - LEFT_PAD;
  const rowH = VBH / slice.length;
  const blockSz = Math.max(6, Math.min(rowH - 2, 16));

  const maxCount = useMemo(
    () => Math.max(1, ...slice.map((b) => Math.max(b.long_count, b.short_count))),
    [slice],
  );
  const blocksFit = Math.floor(usableHalf / (blockSz + 2));

  const priceMin = slice[0]?.price_low ?? data.price_range.min;
  const priceMax = slice[slice.length - 1]?.price_high ?? data.price_range.max;
  const currentY = VBH - ((data.current_price - priceMin) / (priceMax - priceMin)) * VBH;

  const labelIdxs = [0, Math.floor(slice.length / 2), slice.length - 1];

  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} style={{ width: "100%", height: 440, display: "block" }}>
      {labelIdxs.map((i) => {
        const y = VBH - (i + 1) * rowH;
        return (
          <text key={i} x={LEFT_PAD - 8} y={y + rowH + 3} textAnchor="end"
                fontSize={11} fill="rgba(255,255,255,0.38)">
            {formatPrice(slice[i].price_low)}
          </text>
        );
      })}
      <line x1={CX} x2={CX} y1={0} y2={VBH} stroke={color.border} strokeWidth={0.8} />
      {slice.map((b, i) => {
        const y = VBH - (i + 1) * rowH;
        const longBlocks  = Math.min(blocksFit, Math.round((b.long_count  / maxCount) * blocksFit));
        const shortBlocks = Math.min(blocksFit, Math.round((b.short_count / maxCount) * blocksFit));
        const elems: React.ReactElement[] = [];
        for (let k = 0; k < longBlocks; k++) {
          elems.push(
            <rect key={`l${k}`}
              x={CX - (k + 1) * (blockSz + 2)} y={y + (rowH - blockSz) / 2}
              width={blockSz} height={blockSz}
              fill={color.green} fillOpacity={0.75} rx={1} />,
          );
        }
        for (let k = 0; k < shortBlocks; k++) {
          elems.push(
            <rect key={`s${k}`}
              x={CX + k * (blockSz + 2) + 2} y={y + (rowH - blockSz) / 2}
              width={blockSz} height={blockSz}
              fill={color.red} fillOpacity={0.75} rx={1} />,
          );
        }
        return <g key={i}>{elems}</g>;
      })}
      <line x1={LEFT_PAD} x2={VBW - RIGHT_PAD} y1={currentY} y2={currentY}
            stroke={color.accent} strokeWidth={1.5} />
      <text x={VBW - RIGHT_PAD + 6} y={currentY + 4} fontSize={11} fontWeight={700} fill={color.accent}>
        {formatPrice(data.current_price)}
      </text>
    </svg>
  );
}

// Design 3: Depth Ladder -------------------------------------------------------

function Design3({ data }: { data: RadarResponse }) {
  const { slice } = trimBuckets(data.buckets);
  const maxN = useMaxNotional(slice);
  const curPx = data.current_price;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 440, overflow: "hidden", border: `1px solid ${color.borderFaint}`, borderRadius: 6 }}>
      {slice.slice().reverse().map((b, ridx) => {
        const actualIdx = slice.length - 1 - ridx;
        void actualIdx;
        const isCurrent = curPx >= b.price_low && curPx < b.price_high;
        const longPct  = maxN > 0 ? (b.long_notional  / maxN) * 100 : 0;
        const shortPct = maxN > 0 ? (b.short_notional / maxN) * 100 : 0;
        return (
          <div key={ridx} style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "90px 1fr 1fr 70px",
            alignItems: "center",
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            borderBottom: `1px solid ${color.borderFaint}`,
            background: isCurrent ? "rgba(80,210,193,0.06)" : "transparent",
            height: `${100 / slice.length}%`,
          }}>
            <div style={{ padding: "0 10px", color: isCurrent ? color.accent : "rgba(255,255,255,0.42)", fontWeight: isCurrent ? 700 : 400 }}>
              {formatPrice(b.price_low)}
            </div>
            <div style={{ position: "relative", height: "70%", marginRight: 1 }}>
              <div style={{
                position: "absolute", right: 0, top: 0, bottom: 0,
                width: `${longPct}%`,
                background: color.green, opacity: 0.78, borderRadius: "1px 0 0 1px",
              }} />
              {b.liq_long_count > 0 && (
                <div style={{
                  position: "absolute", right: 0, top: "50%",
                  width: "100%", height: 0,
                  borderTop: `1px dashed ${color.green}`, opacity: 0.4,
                }} />
              )}
            </div>
            <div style={{ position: "relative", height: "70%", marginLeft: 1 }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${shortPct}%`,
                background: color.red, opacity: 0.78, borderRadius: "0 1px 1px 0",
              }} />
              {b.liq_short_count > 0 && (
                <div style={{
                  position: "absolute", left: 0, top: "50%",
                  width: "100%", height: 0,
                  borderTop: `1px dashed ${color.red}`, opacity: 0.4,
                }} />
              )}
            </div>
            <div style={{ padding: "0 10px", textAlign: "right", color: "rgba(255,255,255,0.42)" }}>
              {b.long_count + b.short_count > 0 ? `${b.long_count + b.short_count}w` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Design 4: Heatmap column (net bias) -----------------------------------------

function Design4({ data }: { data: RadarResponse }) {
  const { slice } = trimBuckets(data.buckets);
  const maxN = useMaxNotional(slice);

  const priceMin = slice[0]?.price_low ?? data.price_range.min;
  const priceMax = slice[slice.length - 1]?.price_high ?? data.price_range.max;
  const curY = 100 - ((data.current_price - priceMin) / (priceMax - priceMin)) * 100;

  return (
    <div style={{ display: "flex", gap: 16, height: 440 }}>
      <div style={{ width: 60, position: "relative", fontSize: 11, color: color.textMuted, fontVariantNumeric: "tabular-nums" }}>
        <div style={{ position: "absolute", top: 0, right: 0 }}>{formatPrice(priceMax)}</div>
        <div style={{ position: "absolute", top: "50%", right: 0, transform: "translateY(-50%)" }}>{formatPrice((priceMin + priceMax) / 2)}</div>
        <div style={{ position: "absolute", bottom: 0, right: 0 }}>{formatPrice(priceMin)}</div>
      </div>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column-reverse", border: `1px solid ${color.borderFaint}`, borderRadius: 6, overflow: "hidden" }}>
        {slice.map((b, i) => {
          const totalN = b.long_notional + b.short_notional;
          const intensity = maxN > 0 ? totalN / maxN : 0;
          const netBias = totalN > 0 ? (b.long_notional - b.short_notional) / totalN : 0;
          const base = netBias >= 0 ? color.green : color.red;
          const op = 0.12 + intensity * 0.7;
          return (
            <div key={i} style={{
              flex: 1, position: "relative",
              background: totalN > 0 ? base : "transparent",
              opacity: totalN > 0 ? op : 1,
            }}>
              {b.liq_long_count > 0 && (
                <div style={{ position: "absolute", left: 0, top: "50%", height: 2, width: 14, background: color.green, opacity: 0.9 }} />
              )}
              {b.liq_short_count > 0 && (
                <div style={{ position: "absolute", right: 0, top: "50%", height: 2, width: 14, background: color.red, opacity: 0.9 }} />
              )}
            </div>
          );
        })}
        <div style={{
          position: "absolute", left: 0, right: 0,
          top: `${curY}%`,
          borderTop: `1.5px solid ${color.accent}`,
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", right: -66,
          top: `${curY}%`, transform: "translateY(-50%)",
          fontSize: 11, fontWeight: 700, color: color.accent,
          background: "rgba(80,210,193,0.12)",
          border: `1px solid ${color.accent}`,
          padding: "2px 6px", borderRadius: 3,
        }}>
          {formatPrice(data.current_price)}
        </div>
      </div>
      <div style={{ width: 60 }} />
    </div>
  );
}

// Design 5: Radial radar -------------------------------------------------------

function Design5({ data }: { data: RadarResponse }) {
  const { slice } = trimBuckets(data.buckets);
  const maxN = useMaxNotional(slice);
  const size = 440;
  const cx = size / 2, cy = size / 2;
  const innerR = 60;
  const outerR = size / 2 - 20;

  const priceMin = slice[0]?.price_low ?? data.price_range.min;
  const priceMax = slice[slice.length - 1]?.price_high ?? data.price_range.max;
  const currentR = innerR + ((data.current_price - priceMin) / (priceMax - priceMin)) * (outerR - innerR);

  // Long sweep: left half 180° -> 360°. Short sweep: right half 0° -> 180°.
  // Each bucket is a wedge.
  const wedgePath = (
    r0: number, r1: number,
    a0: number, a1: number,
  ): string => {
    const x0 = cx + r0 * Math.cos(a0);
    const y0 = cy + r0 * Math.sin(a0);
    const x1 = cx + r1 * Math.cos(a0);
    const y1 = cy + r1 * Math.sin(a0);
    const x2 = cx + r1 * Math.cos(a1);
    const y2 = cy + r1 * Math.sin(a1);
    const x3 = cx + r0 * Math.cos(a1);
    const y3 = cy + r0 * Math.sin(a1);
    const largeArc = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} L ${x1} ${y1} A ${r1} ${r1} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${r0} ${r0} 0 ${largeArc} 0 ${x0} ${y0} Z`;
  };

  const n = slice.length;
  const step = Math.PI / n;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: 440, display: "block" }}>
      <circle cx={cx} cy={cy} r={innerR} fill="none" stroke={color.borderFaint} strokeWidth={0.6} />
      <circle cx={cx} cy={cy} r={outerR} fill="none" stroke={color.borderFaint} strokeWidth={0.6} />
      <circle cx={cx} cy={cy} r={currentR} fill="none" stroke={color.accent} strokeWidth={1.2} strokeDasharray="2 3" />
      <line x1={cx - outerR} x2={cx + outerR} y1={cy} y2={cy} stroke={color.border} strokeWidth={0.8} />

      {slice.map((b, i) => {
        const priceFrac = i / (n - 1);
        const r0 = innerR + priceFrac * (outerR - innerR);
        const r1 = innerR + ((i + 1) / (n - 1)) * (outerR - innerR);
        const longSweep  = maxN > 0 ? (b.long_notional  / maxN) : 0;
        const shortSweep = maxN > 0 ? (b.short_notional / maxN) : 0;
        // Longs fill left half: angle from Math.PI (left) downward
        const aLong0 = Math.PI + (1 - longSweep) * step;
        const aLong1 = Math.PI + step;
        const aShort0 = 0;
        const aShort1 = shortSweep * step;
        return (
          <g key={i}>
            {longSweep > 0 && (
              <path d={wedgePath(r0, r1, aLong0, aLong1)}
                    fill={color.green} fillOpacity={0.6} />
            )}
            {shortSweep > 0 && (
              <path d={wedgePath(r0, r1, aShort0, aShort1)}
                    fill={color.red} fillOpacity={0.6} />
            )}
            {b.liq_long_count > 0 && (
              <path d={wedgePath(r0, r1, Math.PI, Math.PI + step)}
                    fill="none" stroke={color.green} strokeOpacity={0.5}
                    strokeWidth={0.8} strokeDasharray="2 2" />
            )}
            {b.liq_short_count > 0 && (
              <path d={wedgePath(r0, r1, 0, step)}
                    fill="none" stroke={color.red} strokeOpacity={0.5}
                    strokeWidth={0.8} strokeDasharray="2 2" />
            )}
          </g>
        );
      })}

      <circle cx={cx} cy={cy} r={innerR} fill={color.bg} stroke={color.border} strokeWidth={0.8} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11}
            fontWeight={700} letterSpacing="0.1em"
            fill="rgba(255,255,255,0.4)">BTC</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={11}
            fontWeight={700} fill={color.accent}>
        {formatPrice(data.current_price)}
      </text>

      <text x={cx - outerR + 6} y={cy - 6} fontSize={10} fill={color.green} fillOpacity={0.7}>LONG</text>
      <text x={cx + outerR - 36} y={cy - 6} fontSize={10} fill={color.red}   fillOpacity={0.7}>SHORT</text>

      <text x={cx} y={cy - outerR - 4} textAnchor="middle" fontSize={10} fill={color.textMuted}>
        {formatPrice(priceMax)}
      </text>
      <text x={cx} y={cy + outerR + 14} textAnchor="middle" fontSize={10} fill={color.textMuted}>
        {formatPrice(priceMin)}
      </text>
    </svg>
  );
}

function HeatmapEmpty() {
  return (
    <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", color: color.textMuted, fontSize: 12 }}>
      Loading timeseries
    </div>
  );
}

// Coinglass-style intensity gradient: deep purple -> teal -> bright green-yellow
// Single scale (no long/short split) so magnitude is the only encoding.
const HEAT_STOPS: [number, [number, number, number]][] = [
  [0.00, [12,  8,  28]],   // near-black purple
  [0.15, [45, 20,  95]],   // deep purple
  [0.40, [70, 35, 140]],   // violet
  [0.60, [40, 170, 180]],  // teal (near color.accent)
  [0.80, [80, 220, 160]],  // mint
  [1.00, [220, 240, 120]], // bright yellow-green
];

function heatColor(intensity: number): string {
  const t = Math.pow(Math.max(0, Math.min(1, intensity)), 0.55);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i - 1];
    const [p2, c2] = HEAT_STOPS[i];
    if (t <= p2) {
      const f = (t - p1) / (p2 - p1);
      const r = Math.round(c1[0] + f * (c2[0] - c1[0]));
      const g = Math.round(c1[1] + f * (c2[1] - c1[1]));
      const b = Math.round(c1[2] + f * (c2[2] - c1[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1][1];
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

function formatNotional(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "--";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  const day = d.getDate();
  const mo  = d.toLocaleString(undefined, { month: "short" });
  const hh  = String(d.getHours()).padStart(2, "0");
  const mm  = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mo}, ${hh}:${mm}`;
}

function Design6({ data }: { data: TimeseriesResponse }) {
  const { bins, candles = [], current_price, price_range, bin_minutes } = data;
  const W = 1260, H = 520;
  const PAD_L = 86, PAD_R = 86, PAD_T = 14, PAD_B = 42;
  const LEGEND_W = 16, LEGEND_GAP = 10;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const nCols = bins.length;
  const nRows = bins[0]?.liq_long_notional.length ?? 40;
  const colW  = plotW / Math.max(1, nCols);
  const rowH  = plotH / Math.max(1, nRows);

  const priceMin  = price_range.min;
  const priceMax  = price_range.max;
  const priceSpan = priceMax - priceMin;

  const yForPrice = (p: number) => priceSpan > 0
    ? PAD_T + (1 - (p - priceMin) / priceSpan) * plotH
    : PAD_T + plotH / 2;

  const priceForRow = (r: number) => priceMin + ((r + 0.5) / nRows) * priceSpan;

  // Build a 2D grid and max-cell for normalization
  const totals: number[][] = bins.map((b) => {
    const arr = new Array<number>(nRows);
    for (let i = 0; i < nRows; i++) arr[i] = b.liq_long_notional[i] + b.liq_short_notional[i];
    return arr;
  });
  let maxCell = 0;
  for (const col of totals) for (const v of col) if (v > maxCell) maxCell = v;

  const yCurrent = yForPrice(current_price);
  const nowMs    = bins[bins.length - 1]?.t_end ?? Date.now();
  const startMs  = bins[0]?.t_start ?? (nowMs - 72 * 3600000);
  const timeSpan = nowMs - startMs;

  // Map candle time -> (x, y) using 1h interval
  const candleLine = candles
    .filter((c) => c.t >= startMs && c.t <= nowMs)
    .map((c) => {
      const x = PAD_L + ((c.t + 3600000 / 2 - startMs) / timeSpan) * plotW;
      return { x, yO: yForPrice(c.o), yH: yForPrice(c.h), yL: yForPrice(c.l), yC: yForPrice(c.c),
               o: c.o, h: c.h, l: c.l, c: c.c, t: c.t };
    });

  const yTickCount = 6;
  const xTickCount = 7;

  // Hover state: track mouse in data-space (bin idx, row idx) + pixel-space for tooltip
  const [hover, setHover] = useState<{ px: number; py: number; bi: number; ri: number } | null>(null);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const sy = (e.clientY - rect.top)  * (H / rect.height);
    if (sx < PAD_L || sx > PAD_L + plotW || sy < PAD_T || sy > PAD_T + plotH) {
      setHover(null);
      return;
    }
    const bi = Math.max(0, Math.min(nCols - 1, Math.floor((sx - PAD_L) / colW)));
    const rowFromTop = Math.floor((sy - PAD_T) / rowH);
    const ri = Math.max(0, Math.min(nRows - 1, nRows - 1 - rowFromTop));
    setHover({ px: e.clientX - rect.left, py: e.clientY - rect.top, bi, ri });
  }

  // Legend gradient: sample HEAT_STOPS
  const legendSteps = 32;
  const legendX = PAD_L - LEGEND_GAP - LEGEND_W;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", width: "100%", height: "auto", background: "#050510", borderRadius: 6 }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="d6-clip">
            <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Plot background (deep purple-black, like Coinglass) */}
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="#0b0818" />

        {/* Subtle horizontal gridlines */}
        {Array.from({ length: yTickCount }, (_, i) => {
          const price = priceMin + (i / (yTickCount - 1)) * priceSpan;
          const y = yForPrice(price);
          return <line key={i} x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y}
                       stroke="rgba(255,255,255,0.035)" strokeWidth={0.5} />;
        })}

        {/* Heatmap (single intensity gradient) */}
        <g clipPath="url(#d6-clip)">
          {bins.map((_, ci) => (
            <g key={ci}>
              {Array.from({ length: nRows }, (_, ri) => {
                const v = totals[ci][ri];
                if (v <= 0) return null;
                const intensity = maxCell > 0 ? v / maxCell : 0;
                const fill = heatColor(intensity);
                const y = PAD_T + (nRows - 1 - ri) * rowH;
                return (
                  <rect
                    key={ri}
                    x={PAD_L + ci * colW}
                    y={y}
                    width={colW + 0.8}
                    height={rowH + 0.8}
                    fill={fill}
                  />
                );
              })}
            </g>
          ))}

          {/* Candlestick wicks */}
          {candleLine.map((c, i) => {
            const col = c.c >= c.o ? color.green : color.red;
            return (
              <line key={`w${i}`} x1={c.x} y1={c.yH} x2={c.x} y2={c.yL}
                    stroke={col} strokeWidth={0.9} opacity={0.9} />
            );
          })}

          {/* Candlestick bodies */}
          {candleLine.map((c, i) => {
            const bodyW = Math.max(1.5, plotW / Math.max(candleLine.length, 1) * 0.55);
            const up   = c.c >= c.o;
            const col  = up ? color.green : color.red;
            const yTop = Math.min(c.yO, c.yC);
            const h    = Math.max(1, Math.abs(c.yC - c.yO));
            return (
              <rect key={`b${i}`} x={c.x - bodyW / 2} y={yTop}
                    width={bodyW} height={h} fill={col} opacity={0.95} />
            );
          })}
        </g>

        {/* Current price line */}
        <line x1={PAD_L} y1={yCurrent} x2={PAD_L + plotW} y2={yCurrent}
              stroke={color.accent} strokeWidth={1} strokeDasharray="5 3" opacity={0.9} />
        <rect x={PAD_L + plotW + 3} y={yCurrent - 9} width={72} height={18} rx={3}
              fill="#050510" stroke={color.accent} strokeWidth={0.8} />
        <text x={PAD_L + plotW + 39} y={yCurrent + 4} textAnchor="middle"
              fontSize={10} fontWeight={700} fill={color.accent}>
          {formatPrice(current_price)}
        </text>

        {/* Color scale legend (vertical bar on the left) */}
        <g>
          {Array.from({ length: legendSteps }, (_, i) => {
            const t = i / (legendSteps - 1);
            const segH = plotH / legendSteps;
            return (
              <rect
                key={i}
                x={legendX}
                y={PAD_T + plotH - (i + 1) * segH}
                width={LEGEND_W}
                height={segH + 0.5}
                fill={heatColor(t)}
              />
            );
          })}
          <rect x={legendX} y={PAD_T} width={LEGEND_W} height={plotH}
                fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
          <text x={legendX + LEGEND_W / 2} y={PAD_T - 4} textAnchor="middle"
                fontSize={9} fill="rgba(255,255,255,0.55)"
                style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatNotional(maxCell)}
          </text>
          <text x={legendX + LEGEND_W / 2} y={PAD_T + plotH + 12} textAnchor="middle"
                fontSize={9} fill="rgba(255,255,255,0.35)">0</text>
        </g>

        {/* Y axis price labels (right side) */}
        {Array.from({ length: yTickCount }, (_, i) => {
          const price = priceMin + (i / (yTickCount - 1)) * priceSpan;
          const y = yForPrice(price);
          return (
            <g key={i}>
              <text x={PAD_L + plotW + 4} y={y + 3.5} textAnchor="start" fontSize={10}
                    style={{ fontVariantNumeric: "tabular-nums" }} fill="rgba(255,255,255,0.45)">
                {formatPrice(price)}
              </text>
            </g>
          );
        })}

        {/* X axis time labels (real timestamps) */}
        {Array.from({ length: xTickCount }, (_, i) => {
          const frac = i / (xTickCount - 1);
          const x = PAD_L + frac * plotW;
          const t = startMs + frac * timeSpan;
          return (
            <g key={i}>
              <line x1={x} y1={PAD_T + plotH} x2={x} y2={PAD_T + plotH + 3}
                    stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} />
              <text x={x} y={PAD_T + plotH + 18} textAnchor="middle" fontSize={10}
                    style={{ fontVariantNumeric: "tabular-nums" }} fill="rgba(255,255,255,0.4)">
                {formatLocalTime(t)}
              </text>
            </g>
          );
        })}

        {/* Plot border */}
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH}
              fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={0.5} />

        {/* Crosshair on hover */}
        {hover && (
          <g pointerEvents="none">
            <line x1={PAD_L + hover.bi * colW + colW / 2} y1={PAD_T}
                  x2={PAD_L + hover.bi * colW + colW / 2} y2={PAD_T + plotH}
                  stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} strokeDasharray="2 2" />
            <line x1={PAD_L} y1={PAD_T + (nRows - 1 - hover.ri) * rowH + rowH / 2}
                  x2={PAD_L + plotW} y2={PAD_T + (nRows - 1 - hover.ri) * rowH + rowH / 2}
                  stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} strokeDasharray="2 2" />
          </g>
        )}

        {/* Footer legend */}
        <text x={PAD_L} y={H - 6} fontSize={9.5} fill="rgba(255,255,255,0.3)">
          {bin_minutes}-min bins · single-scale intensity = liq notional · candles = BTC 1h OHLC
        </text>
      </svg>

      {hover && (() => {
        const b = bins[hover.bi];
        const total = b.liq_long_notional[hover.ri] + b.liq_short_notional[hover.ri];
        const price = priceForRow(hover.ri);
        const binMidMs = (b.t_start + b.t_end) / 2;
        // Nearest candle for price-at-time
        const nearest = candles.reduce<null | { diff: number; c: number }>((best, c) => {
          const diff = Math.abs(c.t - binMidMs);
          if (!best || diff < best.diff) return { diff, c: c.c };
          return best;
        }, null);
        const ttLeft = Math.min(hover.px + 14, 1200);
        const ttTop  = Math.max(hover.py - 70, 6);
        return (
          <div
            style={{
              position: "absolute",
              left: ttLeft, top: ttTop,
              background: "rgba(8,8,20,0.96)",
              border: `1px solid ${color.border}`,
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 11,
              pointerEvents: "none",
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              minWidth: 180,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 11.5, marginBottom: 6, color: "rgba(255,255,255,0.9)" }}>
              {formatLocalTime(binMidMs)}
            </div>
            <Row label="Price (BTC)" value={nearest ? formatPrice(nearest.c) : "--"} dot="rgba(255,255,255,0.6)" />
            <Row label="Liq notional"  value={formatNotional(total)} dot={heatColor(maxCell > 0 ? total / maxCell : 0)} />
            <Row label="At price"   value={formatPrice(price)}      dot={color.accent} />
          </div>
        );
      })()}
    </div>
  );
}

function Row({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "2px 0" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.55)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, display: "inline-block" }} />
        {label}
      </span>
      <span style={{ color: "rgba(255,255,255,0.95)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
