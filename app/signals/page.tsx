"use client";
// app/signals/page.tsx — Full signal feed, all 9 recipes, filterable.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { timeAgo, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const RECIPE_META: Record<string, { label: string; desc: string }> = {
  momentum_stack:       { label: "Momentum Stack",     desc: "≥8 wallets add >$500K same direction in <5 min" },
  divergence_squeeze:   { label: "Divergence Squeeze", desc: "Exposure rising, price flat, liq buffer <15%" },
  accumulation_reentry: { label: "Accumulation Re-Entry", desc: "Winners re-enter after >8% drawdown in 4h" },
  rotation_carry:       { label: "Rotation Carry",     desc: "New position in positive-funding perp, >60% hist win" },
  liq_rebound:          { label: "Liq Rebound ⚠",      desc: "Cohort exposure drops — possible cascade (approx.)" },
  streak_continuation:  { label: "Streak Continuation", desc: "5+ win streak with Sharpe proxy >0.6" },
  funding_divergence:   { label: "Funding Divergence", desc: "Smart money vs retail OI divergence + extreme funding" },
  whale_validated:      { label: "Whale Validated ✓",  desc: "Signal confirmed by ≥3 high-score wallets" },
  anti_whale_trap:      { label: "Anti-Whale Trap",    desc: "Rapid exposure reduction in negative regime" },
};

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  ENTRY:    "#6aaa7a",
  EXIT:     "#b06868",
  SCALE_IN: "#60a5fa",
  SCALE_OUT:"#f59e0b",
  FLIP:     "#c084fc",
  ALERT:    "#9ca3af",
};

const S = {
  page:  { padding: "32px", maxWidth: "1400px", margin: "0 auto" },
  card:  { background: "rgba(12,12,12,0.7)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" as const, boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  label: { fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)" },
  muted: { color: "rgba(255,255,255,0.44)", fontSize: "13px" },
  mono:  { fontFamily: "var(--font-mono)", fontSize: "13px" },
};

function SignalsInner() {
  const { data, isLoading } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const [filterRecipe, setFilterRecipe] = useState<string>("all");
  const [filterDir,    setFilterDir]    = useState<string>("all");
  const [filterCoin,   setFilterCoin]   = useState<string>("");

  if (isLoading || !data) return <div style={{ padding: "28px", ...S.muted }}>Loading signals…</div>;

  const signals = data.recent_signals.filter((s) => {
    if (filterRecipe !== "all" && s.recipe_id !== filterRecipe) return false;
    if (filterDir    !== "all" && s.direction  !== filterDir)   return false;
    if (filterCoin   && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
    return true;
  });

  const uniqueRecipes = [...new Set(data.recent_signals.map((s) => s.recipe_id))];

  return (
    <>
      <PageHeader
        title="Signals"
        subtitle={`All 9 recipes · ${data.recent_signals.length} recent signals`}
        regime={data.regime}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" as const, alignItems: "center" }}>
        <select value={filterRecipe} onChange={(e) => setFilterRecipe(e.target.value)}
          style={{ background: "#141414", border: "1px solid rgba(180,180,180,0.12)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none" }}>
          <option value="all">All Recipes</option>
          {uniqueRecipes.map((r) => <option key={r} value={r}>{RECIPE_META[r]?.label ?? r}</option>)}
        </select>

        <select value={filterDir} onChange={(e) => setFilterDir(e.target.value)}
          style={{ background: "#141414", border: "1px solid rgba(180,180,180,0.12)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none" }}>
          <option value="all">All Directions</option>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
          <option value="FLAT">Flat</option>
        </select>

        <input value={filterCoin} onChange={(e) => setFilterCoin(e.target.value)}
          placeholder="Filter coin…"
          style={{ background: "#141414", border: "1px solid rgba(180,180,180,0.12)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none", width: "120px" }} />

        <span style={S.muted}>{signals.length} results</span>
      </div>

      {/* Recipe legend */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "20px" }}>
        {Object.entries(RECIPE_META).map(([id, { label, desc }]) => (
          <button key={id} onClick={() => setFilterRecipe(filterRecipe === id ? "all" : id)}
            className="card-hover glow-btn"
            style={{ ...S.card, padding: "16px 18px", textAlign: "left" as const, cursor: "pointer",
              border: filterRecipe === id ? "1px solid rgba(255,255,255,0.26)" : "1px solid rgba(255,255,255,0.07)",
              background: filterRecipe === id ? "rgba(96,96,96,0.10)" : "#0f0f0f" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#f0f0f0", marginBottom: "6px" }}>{label}</div>
            <div style={{ ...S.muted, lineHeight: 1.5 }}>{desc}</div>
          </button>
        ))}
      </div>

      {/* Signal list */}
      <div style={S.card}>
        {signals.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>
            No signals match your filters
          </div>
        ) : (
          signals.map((sig, i) => {
            const meta = RECIPE_META[sig.recipe_id];
            const typeColor = SIGNAL_TYPE_COLORS[sig.signal_type] ?? "#9ca3af";
            const dirColor = sig.direction === "LONG" ? "#6aaa7a" : sig.direction === "SHORT" ? "#b06868" : "#9ca3af";

            return (
              <div key={i} style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(180,180,180,0.06)",
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
              }}>
                {/* Type pill */}
                <div style={{
                  fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                  padding: "3px 7px", borderRadius: "4px", flexShrink: 0, marginTop: "2px",
                  background: `${typeColor}14`, color: typeColor, border: `1px solid ${typeColor}30`,
                }}>
                  {sig.signal_type}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" as const }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#f0f0f0" }}>
                      {meta?.label ?? sig.recipe_id}
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#f0f0f0" }}>·</span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: dirColor }}>{sig.coin}</span>
                    {sig.direction && (
                      <span style={{ fontSize: "10px", fontWeight: 700, color: dirColor, letterSpacing: "0.08em" }}>
                        {sig.direction}
                      </span>
                    )}
                  </div>
                  <div style={{ ...S.muted, marginTop: "3px" }}>
                    {meta?.desc} · wallet {truncateAddress(sig.wallet_id ?? "")} · {timeAgo(sig.detected_at)}
                  </div>
                  {typeof sig.metadata?.description === "string" && (
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.58)", marginTop: "4px" }}>
                      {sig.metadata.description}
                    </div>
                  )}
                </div>

                {/* EV score */}
                {sig.ev_score != null ? (
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: sig.ev_score > 0.6 ? "#6aaa7a" : sig.ev_score > 0.3 ? "#f59e0b" : "#9ca3af" }}>
                      {(sig.ev_score * 100).toFixed(0)}
                    </div>
                    <div style={S.muted}>EV</div>
                  </div>
                ) : (
                  <div style={{ ...S.muted, flexShrink: 0 }}>—</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
    </>
  );
}

export default function SignalsPage() {
  return <SignalsInner />;
}
