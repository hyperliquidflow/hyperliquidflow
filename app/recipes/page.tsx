"use client";
// app/recipes/page.tsx — Recipe Lab: performance stats, win rates, EV scores.

import { useQuery } from "@tanstack/react-query";
import { formatPct, timeAgo } from "@/lib/utils";
import { QueryProvider } from "@/components/query-provider";

const RECIPE_META: Record<string, { label: string; color: string; desc: string }> = {
  momentum_stack:       { label: "Momentum Stack",       color: "#60a5fa", desc: "≥8 wallets add >$500K same direction in <5 min" },
  divergence_squeeze:   { label: "Divergence Squeeze",   color: "#f59e0b", desc: "Exposure rising, price flat, liq buffer <15%" },
  accumulation_reentry: { label: "Accumulation Re-Entry",color: "#4ade80", desc: "Winners re-enter after >8% drawdown in 4h" },
  rotation_carry:       { label: "Rotation Carry",       color: "#a78bfa", desc: "New position in positive-funding perp, >60% hist win" },
  liq_rebound:          { label: "Liq Rebound",          color: "#f87171", desc: "Cohort exposure drops — possible cascade (approx.)" },
  streak_continuation:  { label: "Streak Continuation",  color: "#34d399", desc: "5+ win streak with Sharpe proxy >0.6" },
  funding_divergence:   { label: "Funding Divergence",   color: "#fb923c", desc: "Smart money vs retail OI divergence + extreme funding" },
  whale_validated:      { label: "Whale Validated",      color: "#e879f9", desc: "Signal confirmed by ≥3 high-score wallets" },
  anti_whale_trap:      { label: "Anti-Whale Trap",      color: "#94a3b8", desc: "Rapid exposure reduction in negative regime" },
};

const S = {
  page:  { padding: "28px", maxWidth: "1200px", margin: "0 auto" },
  card:  { background: "#0f0f0f", border: "1px solid rgba(180,180,180,0.12)", borderRadius: "10px", overflow: "hidden" as const },
  hdr:   { borderBottom: "1px solid rgba(180,180,180,0.06)", padding: "16px 20px" },
  label: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(227,227,227,0.38)" },
  muted: { color: "rgba(227,227,227,0.38)", fontSize: "11px" },
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

function RecipeLabInner() {
  const { data: stats, isLoading } = useQuery<RecipeStats[]>({
    queryKey: ["recipe-performance"],
    queryFn:  () => fetch("/api/recipe-performance").then((r) => r.json()),
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !stats) return <div style={{ padding: "28px", ...S.muted }}>Loading recipe analytics…</div>;

  // Merge with metadata
  const allRecipes = Object.keys(RECIPE_META).map((id) => {
    const perf = stats.find((s) => s.recipe_id === id);
    return { id, ...RECIPE_META[id], perf };
  });

  return (
    <div style={S.page}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#e3e3e3" }}>Recipe Lab</h1>
        <p style={S.muted}>9 signal recipes · historical performance · auto-tracked from signals_history</p>
      </div>

      {/* Performance grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {allRecipes.map(({ id, label, color, desc, perf }) => {
          const winRate = perf?.win_rate ?? null;
          const signals = perf?.signal_count ?? 0;
          const ev      = perf?.avg_ev_score ?? null;
          const winColor = winRate != null ? (winRate >= 0.6 ? "#4ade80" : winRate >= 0.5 ? "#f59e0b" : "#f87171") : "#6b7280";

          return (
            <div key={id} style={{ ...S.card, borderLeft: `3px solid ${color}` }}>
              <div style={{ padding: "16px 16px 12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#e3e3e3", marginBottom: "4px" }}>{label}</div>
                <div style={{ ...S.muted, fontSize: "10px", marginBottom: "14px" }}>{desc}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    { label: "Win Rate",  value: winRate != null ? formatPct(winRate) : "—", color: winColor },
                    { label: "Signals",   value: `${signals}` },
                    { label: "Avg EV",    value: ev != null ? (ev * 100).toFixed(0) : "—" },
                  ].map(({ label: l, value, color: c }) => (
                    <div key={l}>
                      <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(227,227,227,0.28)", marginBottom: "3px" }}>{l}</div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: c ?? "#e3e3e3" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {winRate != null && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ width: "100%", height: "3px", background: "rgba(180,180,180,0.1)", borderRadius: "2px" }}>
                      <div style={{ width: `${winRate * 100}%`, height: "100%", background: winColor, borderRadius: "2px", transition: "width 0.4s" }} />
                    </div>
                  </div>
                )}

                {signals === 0 && (
                  <div style={{ marginTop: "8px", fontSize: "10px", color: "rgba(227,227,227,0.28)" }}>
                    No signals recorded yet — waiting for market conditions
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
              Win/loss is measured by checking if the price moved in the signal's direction within the next 4 hours.
              A win is defined as ≥0.5% favourable move. Performance is recalculated daily by the GitHub Actions scan.
            </p>
          </div>
          <div>
            <p style={{ ...S.muted, lineHeight: 1.7 }}>
              EV scores are computed per-signal using each wallet's historical win rate, average win/loss size,
              and estimated slippage from the L2 order book at signal time.
              Recipes with &lt;10 historical signals show "—" for EV — insufficient data for reliable estimation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RecipesPage() {
  return <QueryProvider><RecipeLabInner /></QueryProvider>;
}
