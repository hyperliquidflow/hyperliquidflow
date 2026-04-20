"use client";
// app/performance/ranking/RankingClient.tsx
// Rank IC dashboard: rolling Spearman IC over time with MDIC threshold line.
// Shows honest empty state until wallet_score_history accumulates 30+ days.

import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { PageHeader } from "@/components/page-header";
import { color, type as T, space, card as C, radius, skeleton } from "@/lib/design-tokens";
import type { RankIcPayload, RankIcRow } from "@/app/api/rank-ic/route";

const S = {
  page:    { padding: `0 ${space.pagePaddingX} ${space.contentPaddingBot}` },
  card:    { ...C.base },
  hdr:     { ...C.header },
  title:   { ...T.cardTitle },
  grid:    {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: space.cardGap,
    marginBottom: space.cardGap,
  },
  stat: {
    padding: "14px 16px",
  },
  empty: {
    display: "flex", flexDirection: "column" as const,
    alignItems: "center", justifyContent: "center",
    padding: "48px 32px", gap: "12px", textAlign: "center" as const,
  },
} as const;

function StatCard({ label, value, sub, clr }: { label: string; value: string; sub: string; clr?: string }) {
  return (
    <div style={{ ...S.card, ...S.stat }}>
      <div style={{ ...T.statLabel }}>{label}</div>
      <div style={{ ...T.statValue, color: clr ?? color.text, lineHeight: 1, marginTop: "10px" }}>{value}</div>
      <div style={{ ...T.statSub }}>{sub}</div>
    </div>
  );
}

function IcColor(ic: number | null): string {
  if (ic === null) return color.textMuted;
  if (ic > 0.08)  return color.green;
  if (ic > 0)     return color.amber;
  return color.red;
}

function formatIc(ic: number | null): string {
  if (ic === null) return "--";
  return ic.toFixed(4);
}

function formatPct(v: number | null): string {
  if (v === null) return "--";
  return `${(v * 100).toFixed(1)}%`;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: RankIcRow }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div style={{
      background: "rgba(12,12,12,0.95)", border: `1px solid ${color.border}`,
      borderRadius: radius.card, padding: "10px 14px", fontSize: "13px",
    }}>
      <div style={{ color: color.textMuted, marginBottom: "6px" }}>{label}</div>
      <div style={{ color: IcColor(row.rank_ic), fontVariantNumeric: "tabular-nums" }}>
        Score: {formatIc(row.rank_ic)}
      </div>
      {row.p_value != null && (
        <div style={{ color: color.textDim, marginTop: "2px", fontVariantNumeric: "tabular-nums" }}>
          p = {row.p_value.toFixed(4)}
        </div>
      )}
      <div style={{ color: color.textDim, marginTop: "2px", fontVariantNumeric: "tabular-nums" }}>
        n = {row.cohort_size}
      </div>
    </div>
  );
}

export function RankingClient() {
  const { data, isLoading } = useQuery<RankIcPayload>({
    queryKey:       ["rank-ic"],
    queryFn:        () => fetch("/api/rank-ic").then((r) => r.json()),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  });

  const n = data?.total_measurements ?? 0;
  const hasData = n > 0;

  const chartData = (data?.history ?? []).map((r) => ({
    ...r,
    date: r.measurement_date.slice(5), // MM-DD for brevity
  }));

  return (
    <div className="page-enter">
      <PageHeader
        title="Accuracy"
        subtitle="How often our top-ranked wallets outperform. Measured against 30-day forward returns."
      />

      <div style={S.page}>
        <div style={S.grid}>
          <StatCard
            label="Current Accuracy"
            value={formatIc(data?.latest_ic ?? null)}
            sub={data?.latest_p_value != null ? `p = ${data.latest_p_value.toFixed(4)}` : "no data yet"}
            clr={IcColor(data?.latest_ic ?? null)}
          />
          <StatCard
            label="Measurements"
            value={n > 0 ? String(n) : "--"}
            sub={n < 30 ? `need ${30 - n} more to validate` : "enough to validate"}
          />
          <StatCard
            label="Reliable Readings"
            value={formatPct(data?.pct_above_mdic ?? null)}
            sub="above reliability floor"
            clr={(data?.pct_above_mdic ?? 0) >= 0.5 ? color.green : color.amber}
          />
          <StatCard
            label="System Validated?"
            value={n >= 30 ? ((data?.pct_above_mdic ?? 0) >= 0.5 ? "PASS" : "FAIL") : "PENDING"}
            sub={n >= 30
              ? ((data?.pct_above_mdic ?? 0) >= 0.5 ? "Scoring accuracy confirmed" : "Below reliability threshold")
              : `${n} of 30 needed`}
            clr={n >= 30
              ? ((data?.pct_above_mdic ?? 0) >= 0.5 ? color.green : color.red)
              : color.textMuted}
          />
        </div>

        <div style={S.card}>
          <div style={S.hdr}>
            <span style={S.title}>Scoring accuracy over time (30-day window)</span>
            <span style={{ marginLeft: "auto", fontSize: "11px", color: color.textFaint }}>
              floor = {data?.mdic?.toFixed(2) ?? "0.08"}
            </span>
          </div>

          {isLoading && (
            <div style={{ padding: "32px 20px", display: "flex", gap: "8px", flexDirection: "column" }}>
              {[80, 60, 90].map((w, i) => (
                <div key={i} style={{ ...skeleton.animated, width: `${w}%`, height: "16px" }} />
              ))}
            </div>
          )}

          {!isLoading && !hasData && (
            <div style={S.empty}>
              <div style={{ fontSize: "32px", fontWeight: 700, color: color.textFaint, fontVariantNumeric: "tabular-nums" }}>--</div>
              <div style={{ fontSize: "13px", color: color.textMuted, maxWidth: "380px" }}>
                No data yet. Accuracy is measured after wallets have had 30 days to prove their scores right or wrong.
              </div>
              <div style={{
                fontSize: "11px", color: color.textFaint,
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${color.borderFaint}`,
                borderRadius: radius.tag,
                padding: "6px 12px", marginTop: "8px",
              }}>
                First measurement available ~{new Date(Date.now() + 31 * 86400_000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </div>
          )}

          {!isLoading && hasData && (
            <div style={{ padding: "20px" }}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={color.borderFaint} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: color.textFaint, fontFamily: "'DM Sans', system-ui, sans-serif" }}
                    axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                  />
                  <YAxis
                    domain={[-0.3, 0.3]}
                    tick={{ fontSize: 11, fill: color.textFaint, fontFamily: "'DM Sans', system-ui, sans-serif" }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => v.toFixed(2)}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {/* Zero line */}
                  <ReferenceLine y={0} stroke={color.border} strokeDasharray="4 4" />
                  {/* MDIC threshold */}
                  <ReferenceLine
                    y={data?.mdic ?? 0.08}
                    stroke={color.amber}
                    strokeDasharray="6 3"
                    label={{ value: "floor", fill: color.amber, fontSize: 11, position: "insideTopRight" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rank_ic"
                    stroke={color.neutral}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 4, fill: color.neutral, stroke: color.bg, strokeWidth: 2 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>

              {/* Decile stats table */}
              {chartData.length > 0 && (
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr",
                  gap: space.cardGap, marginTop: "16px",
                  borderTop: `1px solid ${color.borderFaint}`, paddingTop: "16px",
                }}>
                  <div>
                    <div style={{ ...T.cardTitle, marginBottom: "8px" }}>Top wallets called correctly</div>
                    <div style={{ fontSize: "13px", color: color.textMuted }}>
                      Share of our highest-ranked wallets that beat the median over 30 days.
                    </div>
                    <div style={{ fontSize: "26px", fontWeight: 700, marginTop: "8px", fontVariantNumeric: "tabular-nums", color: color.text }}>
                      {chartData[chartData.length - 1]?.top_decile_hit_rate != null
                        ? formatPct(chartData[chartData.length - 1].top_decile_hit_rate)
                        : "--"}
                    </div>
                  </div>
                  <div>
                    <div style={{ ...T.cardTitle, marginBottom: "8px" }}>Bottom wallets avoided correctly</div>
                    <div style={{ fontSize: "13px", color: color.textMuted }}>
                      Share of our lowest-ranked wallets that underperformed the median over 30 days.
                    </div>
                    <div style={{ fontSize: "26px", fontWeight: 700, marginTop: "8px", fontVariantNumeric: "tabular-nums", color: color.text }}>
                      {chartData[chartData.length - 1]?.bottom_decile_avoidance != null
                        ? formatPct(chartData[chartData.length - 1].bottom_decile_avoidance)
                        : "--"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
