"use client";
// app/signals/radar/RadarClient.tsx
// Market Radar: per-asset price-axis view of cohort long/short density and liquidation zones.

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { formatUsd } from "@/lib/utils";
import type { RadarResponse, RadarBucket } from "@/lib/radar-utils";
import { color, card as C, type as T, space, radius } from "@/lib/design-tokens";

const TIERS = ["all", "Elite", "Major", "Large", "Mid", "Small", "Micro", "Dust"] as const;
type Tier = (typeof TIERS)[number];

interface Props {
  initialData:  RadarResponse | null;
  initialAsset: string;
  initialTier:  Tier;
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return "--";
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (n >= 1)    return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

const S = {
  page: { padding: `${space.contentPaddingTop} ${space.pagePaddingX} ${space.contentPaddingBot}` },
  card: { ...C.base },
  header: {
    ...C.header,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 20px",
    flexWrap: "wrap" as const,
  },
  title: { ...T.cardTitle },
  selectGroup: { display: "flex", alignItems: "center", gap: 8 },
  label: {
    fontSize: 11, fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.32)",
  },
  select: {
    background:    color.inputBg,
    border:        `1px solid ${color.inputBorder}`,
    borderRadius:  radius.input,
    color:         color.text,
    fontSize:      13,
    padding:       "6px 10px",
    fontFamily:    "'DM Sans', system-ui, sans-serif",
    cursor:        "pointer",
    outline:       "none",
  } as React.CSSProperties,
  statsGrid: {
    display:             "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    borderTop:           `1px solid ${color.borderFaint}`,
  },
  statCell: {
    padding: "14px 20px",
    borderRight: `1px solid ${color.borderFaint}`,
  },
  statLabel: {
    fontSize: 11, fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.38)",
  },
  statValue: {
    fontSize: 16, fontWeight: 700,
    fontVariantNumeric: "tabular-nums" as const,
    color: color.text,
    marginTop: 6,
  },
  emptyMsg: {
    padding: "60px 20px",
    textAlign: "center" as const,
    color: color.textMuted,
    fontSize: 13,
  },
  tooltip: {
    position: "fixed" as const,
    pointerEvents: "none" as const,
    background: "rgba(8,8,8,0.96)",
    border: `1px solid ${color.borderHover}`,
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 12,
    color: color.text,
    boxShadow: "0 4px 18px rgba(0,0,0,0.6)",
    zIndex: 1000,
    whiteSpace: "nowrap" as const,
    fontVariantNumeric: "tabular-nums" as const,
  },
};

export function RadarClient({ initialData, initialAsset, initialTier }: Props) {
  const [asset, setAsset] = useState(initialAsset);
  const [tier,  setTier]  = useState<Tier>(initialTier);

  const { data } = useQuery<RadarResponse>({
    queryKey: ["market-radar", asset, tier],
    queryFn:  () => fetch(`/api/market-radar?asset=${encodeURIComponent(asset)}&tier=${encodeURIComponent(tier)}`)
      .then((r) => r.json()),
    initialData:     asset === initialAsset && tier === initialTier ? initialData ?? undefined : undefined,
    refetchInterval: 60_000,
    staleTime:       55_000,
    placeholderData: keepPreviousData,
  });

  const assets: string[] = data?.top_assets?.length ? data.top_assets : [asset];

  return (
    <div>
      <PageHeader
        title="Market Radar"
        subtitle="Where cohort wallets cluster entries and liquidations along the price axis"
      />
      <div style={S.page}>
        <div style={S.card}>
          <div style={S.header}>
            <span style={S.title}>{asset} Position Density</span>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={S.selectGroup}>
                <span style={S.label}>Asset</span>
                <select
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                  style={S.select}
                  aria-label="Select asset"
                >
                  {assets.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div style={S.selectGroup}>
                <span style={S.label}>Tier</span>
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value as Tier)}
                  style={S.select}
                  aria-label="Select tier"
                >
                  {TIERS.map((t) => <option key={t} value={t}>{t === "all" ? "All Tiers" : t}</option>)}
                </select>
              </div>
            </div>
          </div>

          {data ? (
            <RadarChart data={data} />
          ) : (
            <div style={S.emptyMsg}>Loading radar</div>
          )}

          {data && <StatsRow data={data} />}
        </div>
      </div>
    </div>
  );
}

// Chart ------------------------------------------------------------------------

interface ChartProps { data: RadarResponse }

interface Tip { x: number; y: number; text: string }

function RadarChart({ data }: ChartProps) {
  const [tip, setTip] = useState<Tip | null>(null);

  const { buckets, current_price, price_range, stats } = data;

  const maxNotional = useMemo(() => {
    let m = 0;
    for (const b of buckets) {
      if (b.long_notional  > m) m = b.long_notional;
      if (b.short_notional > m) m = b.short_notional;
    }
    return m;
  }, [buckets]);

  const hasData = stats.total_positions > 0;

  const VBW = 1000;
  const VBH = 600;
  const CX  = VBW / 2;
  const LEFT_PAD = 60;
  const RIGHT_PAD = 60;
  const usableHalf = CX - LEFT_PAD;

  const rowH = VBH / buckets.length;

  const barW = (n: number): number => {
    if (maxNotional <= 0) return 0;
    return (n / maxNotional) * usableHalf;
  };

  // bucket[0] is lowest price, so highest index renders at top
  const yFor = (idx: number): number => VBH - (idx + 1) * rowH;

  const priceToY = (px: number): number => {
    const { min, max } = price_range;
    if (max === min) return VBH / 2;
    const t = (px - min) / (max - min);
    return VBH - t * VBH;
  };
  const currentY = priceToY(current_price);

  const axisLabels: Array<{ y: number; label: string }> = [];
  const step = Math.max(1, Math.ceil(buckets.length / 6));
  for (let i = 0; i < buckets.length; i += step) {
    axisLabels.push({ y: yFor(i) + rowH, label: formatPrice(buckets[i].price_low) });
  }
  axisLabels.push({ y: 0, label: formatPrice(price_range.max) });

  const onHover = (e: React.MouseEvent, b: RadarBucket) => {
    const longTxt  = b.long_count  > 0 ? `${b.long_count} long, ${formatUsd(b.long_notional)}`   : "";
    const shortTxt = b.short_count > 0 ? `${b.short_count} short, ${formatUsd(b.short_notional)}` : "";
    const liqTxt   = (b.liq_long_count + b.liq_short_count) > 0
      ? `${b.liq_long_count + b.liq_short_count} liq near ${formatPrice((b.price_low + b.price_high) / 2)}`
      : "";
    const parts = [longTxt, shortTxt, liqTxt].filter(Boolean);
    if (parts.length === 0) return;
    setTip({ x: e.clientX + 14, y: e.clientY + 14, text: parts.join("  ·  ") });
  };

  return (
    <div style={{ position: "relative", padding: "16px 20px 20px" }}>
      {!hasData ? (
        <div style={S.emptyMsg}>No cohort positions in this asset</div>
      ) : (
        <svg
          viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: 480, display: "block" }}
          onMouseLeave={() => setTip(null)}
        >
          {axisLabels.map((a, i) => (
            <g key={i}>
              <line x1={LEFT_PAD} x2={VBW - RIGHT_PAD} y1={a.y} y2={a.y}
                    stroke={color.borderFaint} strokeWidth={0.6} />
              <text x={LEFT_PAD - 8} y={a.y + 3} textAnchor="end"
                    fontSize={11} fill="rgba(255,255,255,0.38)"
                    fontFamily="'DM Sans', system-ui, sans-serif">
                {a.label}
              </text>
            </g>
          ))}

          <line x1={CX} x2={CX} y1={0} y2={VBH}
                stroke={color.border} strokeWidth={0.8} />

          {buckets.map((b, i) => {
            const y = yFor(i);
            const longW  = barW(b.long_notional);
            const shortW = barW(b.short_notional);
            const barH   = Math.max(2, rowH - 1);

            return (
              <g key={i}>
                <rect
                  x={LEFT_PAD} y={y}
                  width={VBW - LEFT_PAD - RIGHT_PAD} height={rowH}
                  fill="transparent"
                  onMouseMove={(e) => onHover(e, b)}
                />
                {longW > 0 && (
                  <rect
                    x={CX - longW} y={y + 0.5}
                    width={longW} height={barH}
                    fill={color.green} fillOpacity={0.82}
                    rx={1}
                  />
                )}
                {shortW > 0 && (
                  <rect
                    x={CX} y={y + 0.5}
                    width={shortW} height={barH}
                    fill={color.red} fillOpacity={0.82}
                    rx={1}
                  />
                )}
                {b.liq_long_count > 0 && (
                  <line
                    x1={CX - usableHalf} x2={CX}
                    y1={y + barH / 2 + 0.5} y2={y + barH / 2 + 0.5}
                    stroke={color.green} strokeOpacity={0.45}
                    strokeWidth={1.2} strokeDasharray="3 3"
                  />
                )}
                {b.liq_short_count > 0 && (
                  <line
                    x1={CX} x2={CX + usableHalf}
                    y1={y + barH / 2 + 0.5} y2={y + barH / 2 + 0.5}
                    stroke={color.red} strokeOpacity={0.45}
                    strokeWidth={1.2} strokeDasharray="3 3"
                  />
                )}
              </g>
            );
          })}

          <line x1={LEFT_PAD} x2={VBW - RIGHT_PAD}
                y1={currentY} y2={currentY}
                stroke={color.accent} strokeWidth={1.5} />
          <rect x={VBW - RIGHT_PAD + 2} y={currentY - 10}
                width={RIGHT_PAD - 4} height={20}
                fill={color.accent} fillOpacity={0.12}
                stroke={color.accent} strokeWidth={0.8}
                rx={3} />
          <text x={VBW - RIGHT_PAD + 6} y={currentY + 4}
                fontSize={11} fontWeight={700}
                fill={color.accent}
                fontFamily="'DM Sans', system-ui, sans-serif">
            {formatPrice(current_price)}
          </text>

          <g transform={`translate(${LEFT_PAD}, ${VBH - 14})`}>
            <rect x={0} y={-8} width={10} height={8} fill={color.green} fillOpacity={0.82} rx={1} />
            <text x={14} y={-1} fontSize={11} fill="rgba(255,255,255,0.5)"
                  fontFamily="'DM Sans', system-ui, sans-serif">Long entry</text>

            <rect x={78} y={-8} width={10} height={8} fill={color.red} fillOpacity={0.82} rx={1} />
            <text x={92} y={-1} fontSize={11} fill="rgba(255,255,255,0.5)"
                  fontFamily="'DM Sans', system-ui, sans-serif">Short entry</text>

            <line x1={166} x2={186} y1={-4} y2={-4}
                  stroke={color.textMuted} strokeOpacity={0.7}
                  strokeDasharray="3 3" strokeWidth={1.2} />
            <text x={190} y={-1} fontSize={11} fill="rgba(255,255,255,0.5)"
                  fontFamily="'DM Sans', system-ui, sans-serif">Liquidation</text>
          </g>
        </svg>
      )}

      {tip && (
        <div style={{ ...S.tooltip, left: tip.x, top: tip.y }}>{tip.text}</div>
      )}
    </div>
  );
}

// Stats row --------------------------------------------------------------------

function StatsRow({ data }: { data: RadarResponse }) {
  const { stats } = data;
  const cells: Array<{ label: string; value: string }> = [
    { label: "Total positions", value: String(stats.total_positions) },
    { label: "Long OI",         value: formatUsd(stats.total_long_notional) },
    { label: "Short OI",        value: formatUsd(stats.total_short_notional) },
    { label: "Avg long entry",  value: stats.avg_long_entry  != null ? formatPrice(stats.avg_long_entry)  : "--" },
    { label: "Avg short entry", value: stats.avg_short_entry != null ? formatPrice(stats.avg_short_entry) : "--" },
  ];
  return (
    <div style={S.statsGrid}>
      {cells.map((c, i) => (
        <div key={c.label} style={{
          ...S.statCell,
          borderRight: i === cells.length - 1 ? "none" : `1px solid ${color.borderFaint}`,
        }}>
          <div style={S.statLabel}>{c.label}</div>
          <div style={S.statValue}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
