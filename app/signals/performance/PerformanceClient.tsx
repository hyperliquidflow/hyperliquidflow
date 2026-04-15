"use client";
// app/performance/PerformanceClient.tsx — client shell: polls recipe performance, renders cards.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import { color, card as C, type as T, space } from "@/lib/design-tokens";
import type { RecipeStats } from "@/lib/server/kv-fetchers";

const S = {
  page:  { padding: space.pagePaddingX },
  muted: { color: color.textMuted, fontSize: "13px" },
  stCard:      { ...C.base, overflow: "hidden" as const },
  stHeader:    { ...C.header, justifyContent: "space-between" as const },
  stRecipeName:{ ...T.cardTitle },
  stWinRate:   { ...T.statValue, marginTop: "16px" },
  stWinLabel:  { ...T.statLabel, marginTop: "6px" },
  stDesc:      { ...T.statSub, marginTop: "12px", lineHeight: 1.5 },
  stMetaLabel: { ...T.statLabel },
  stMetaValue: { ...T.statSub, color: color.text, marginTop: "3px" },
};

// Interpolate white → color.green (#6aaa7a) based on win rate 0→1
function winRateColor(rate: number): string {
  const r = Math.round(255 + (106 - 255) * rate);
  const g = Math.round(255 + (170 - 255) * rate);
  const b = Math.round(255 + (122 - 255) * rate);
  return `rgb(${r},${g},${b})`;
}

export function PerformanceClient({ initialData }: { initialData: RecipeStats[] | null }) {
  const { data: stats } = useQuery<RecipeStats[]>({
    queryKey:        ["recipe-performance"],
    queryFn:         () => fetch("/api/recipe-performance").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       60_000,
    refetchInterval: 60_000,
  });

  const allRecipes = Object.keys(RECIPE_META).map((id) => {
    const perf = stats?.find((s) => s.recipe_id === id);
    return { id, ...RECIPE_META[id], perf };
  });

  return (
    <div className="page-enter">
      <PageHeader title="Performance" subtitle="Signal quality by recipe. % reflects signals with positive expected value, not realized profit." />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
          {allRecipes.map(({ id, label, desc, perf }) => {
            const winRate = perf?.win_rate ?? null;
            const signals = perf?.signal_count ?? 0;
            const ev      = perf?.avg_ev_score ?? null;
            const winColor = winRate == null ? color.textFaint : winRateColor(winRate);
            const barColor = winRate == null ? "rgba(255,255,255,0.08)" : winRateColor(winRate);

            return (
              <div key={id} className="card-hover glow-btn" style={S.stCard}>
                <div style={S.stHeader}>
                  <span style={S.stRecipeName}>{label}</span>
                  {signals > 0 && (
                    <span style={{
                      fontSize: "11px", fontWeight: 700,
                      padding: "2px 8px", borderRadius: "4px",
                      background: "rgba(255,255,255,0.05)",
                      color: color.textMuted,
                      border: `1px solid ${color.borderFaint}`,
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {signals}
                    </span>
                  )}
                </div>
                <div style={{ padding: "16px 20px 18px" }}>
                  <div style={{ ...S.stWinRate, color: winColor }}>
                    {winRate != null ? formatPct(winRate) : "n/a"}
                  </div>
                  <div style={S.stWinLabel}>Signal Quality</div>
                  <div style={S.stDesc}>{desc}</div>
                  <div style={{
                    width: "100%", height: "3px",
                    background: "rgba(255,255,255,0.08)",
                    borderRadius: "2px", overflow: "hidden",
                    marginTop: "14px",
                  }}>
                    <div style={{
                      width: winRate != null ? `${winRate * 100}%` : "0%",
                      height: "100%", background: barColor,
                      borderRadius: "2px", transition: "width 0.4s",
                    }} />
                  </div>
                  {signals === 0 ? (
                    <div style={{ ...S.stDesc, marginTop: "10px", fontStyle: "italic" }}>
                      No signals yet, waiting for market conditions
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
                      <div>
                        <div style={S.stMetaLabel}>Signals</div>
                        <div style={S.stMetaValue}>{signals}</div>
                      </div>
                      <div style={{ textAlign: "right" as const }}>
                        <div style={S.stMetaLabel}>Avg EV</div>
                        <div style={S.stMetaValue}>{ev != null ? (ev * 100).toFixed(0) : "n/a"}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
