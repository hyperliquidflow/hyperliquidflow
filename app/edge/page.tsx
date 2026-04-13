"use client";
// app/edge/page.tsx — Edge: signal recipe performance analytics.

import { useQuery } from "@tanstack/react-query";
import { formatPct, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import { color, card as C, type as T, space } from "@/lib/design-tokens";
import { EdgeLoadingState } from "@/components/loading-state";

const S = {
  page:  { padding: space.pagePaddingX },
  muted: { color: color.textMuted, fontSize: "13px" },
  // Statement card
  stCard: {
    ...C.base,
    overflow: "hidden" as const,
  },
  stHeader: {
    ...C.header,
    justifyContent: "space-between" as const,
  },
  stRecipeName: { ...T.cardTitle },
  stWinRate: {
    ...T.statValue,         // 31px, 700, tabular-nums, lh 1
    marginTop: "16px",
  },
  stWinLabel: { ...T.statLabel, marginTop: "6px" },
  stDesc: { ...T.statSub, marginTop: "12px", lineHeight: 1.5 },
  stMetaLabel: { ...T.statLabel },
  stMetaValue: { ...T.statSub, color: color.text, marginTop: "3px" },
};

interface RecipeStats {
  recipe_id: string;
  signal_count: number;
  true_positive: number;
  false_positive: number;
  avg_ev_score: number | null;
  win_rate: number | null;
  measured_at: string;
}

function EdgeInner() {
  const { data: stats, isLoading } = useQuery<RecipeStats[]>({
    queryKey: ["recipe-performance"],
    queryFn:  () => fetch("/api/recipe-performance").then((r) => r.json()),
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !stats) return <EdgeLoadingState />;

  const allRecipes = Object.keys(RECIPE_META).map((id) => {
    const perf = stats.find((s) => s.recipe_id === id);
    return { id, ...RECIPE_META[id], perf };
  });

  return (
    <>
      <PageHeader
        title="Edge"
        subtitle="Signal recipe performance"
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Performance grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {allRecipes.map(({ id, label, desc, perf }) => {
          const winRate = perf?.win_rate ?? null;
          const signals = perf?.signal_count ?? 0;
          const ev      = perf?.avg_ev_score ?? null;
          const winColor = winRate == null ? color.textFaint
            : winRate >= 0.6 ? color.green
            : winRate >= 0.5 ? color.text
            : color.red;
          const barColor = winRate == null ? "rgba(255,255,255,0.08)"
            : winRate >= 0.6 ? color.green
            : winRate >= 0.5 ? "rgba(255,255,255,0.3)"
            : color.red;

          return (
            <div key={id} className="card-hover glow-btn" style={S.stCard}>
              {/* header */}
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

              {/* body */}
              <div style={{ padding: "16px 20px 18px" }}>
                {/* hero win rate */}
                <div style={{ ...S.stWinRate, color: winColor }}>
                  {winRate != null ? formatPct(winRate) : "n/a"}
                </div>
                <div style={S.stWinLabel}>Win Rate</div>

                {/* description */}
                <div style={S.stDesc}>{desc}</div>

                {/* bar */}
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

                {/* footer row */}
                {signals === 0 ? (
                  <div style={{ ...S.stDesc, marginTop: "10px", fontStyle: "italic" }}>
                    No signals yet, waiting for market conditions
                  </div>
                ) : (
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    marginTop: "12px",
                  }}>
                    <div>
                      <div style={S.stMetaLabel}>Signals</div>
                      <div style={S.stMetaValue}>{signals}</div>
                    </div>
                    <div style={{ textAlign: "right" as const }}>
                      <div style={S.stMetaLabel}>Avg EV</div>
                      <div style={S.stMetaValue}>
                        {ev != null ? (ev * 100).toFixed(0) : "n/a"}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
    </>
  );
}

export default function EdgePage() {
  return <EdgeInner />;
}
