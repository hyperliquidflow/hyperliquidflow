"use client";
// app/edge/page.tsx — Edge: signal recipe performance analytics.

import { useQuery } from "@tanstack/react-query";
import { formatPct, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
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

  if (isLoading || !stats) return <div style={{ padding: "28px", ...S.muted }}>Loading performance data…</div>;

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
          const barColor = winRate != null ? (winRate >= 0.6 ? "#909090" : winRate >= 0.5 ? "#747474" : "#585858") : "#505050";

          return (
            <div key={id} className="card-hover glow-btn" style={{ ...S.card, borderLeft: "3px solid rgba(255,255,255,0.1)" }}>
              <div style={{ padding: "16px 16px 12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#f0f0f0", marginBottom: "4px" }}>{label}</div>
                <div style={{ ...S.muted, fontSize: "10px", marginBottom: "14px" }}>{desc}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    { label: "Win Rate", value: winRate != null ? formatPct(winRate) : "n/a", c: barColor },
                    { label: "Signals",  value: `${signals}`,                                  c: "#f0f0f0" },
                    { label: "Avg EV",   value: ev != null ? (ev * 100).toFixed(0) : "n/a",    c: "#f0f0f0" },
                  ].map(({ label: l, value, c }) => (
                    <div key={l}>
                      <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.32)", marginBottom: "3px" }}>{l}</div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: c }}>{value}</div>
                    </div>
                  ))}
                </div>

                {winRate != null && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ width: "100%", height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                      <div style={{ width: `${winRate * 100}%`, height: "100%", background: barColor, borderRadius: "2px", transition: "width 0.4s" }} />
                    </div>
                  </div>
                )}

                {signals === 0 && (
                  <div style={{ marginTop: "8px", fontSize: "10px", color: "rgba(255,255,255,0.32)" }}>
                    No signals recorded yet, waiting for market conditions
                  </div>
                )}

                {perf && (
                  <div style={{ ...S.muted, marginTop: "8px" }}>
                    Last updated {timeAgo(perf.measured_at)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* How recipes are scored */}
      <div style={S.card}>
        <div style={S.hdr}><span style={S.label}>How Performance Is Measured</span></div>
        <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div>
            <p style={{ ...S.muted, lineHeight: 1.7 }}>
              Each signal is logged to <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>signals_history</code> at detection time.
              Win/loss is measured by checking if the price moved in the signal direction within the next 4 hours.
              A win is defined as a 0.5%+ favourable move. Performance is recalculated daily by the GitHub Actions scan.
            </p>
          </div>
          <div>
            <p style={{ ...S.muted, lineHeight: 1.7 }}>
              EV scores are computed per-signal using each wallet's historical win rate, average win/loss size,
              and estimated slippage from the L2 order book at signal time.
              Recipes with fewer than 10 historical signals show no EV score: insufficient data for a reliable estimate.
            </p>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

export default function EdgePage() {
  return <EdgeInner />;
}
