"use client";
// app/signals/page.tsx — Signals: live feed + divergence scanner.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { timeAgo, truncateAddress, formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  mono:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
};

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  ENTRY:    "#6aaa7a",
  EXIT:     "#b06868",
  SCALE_IN: "#60a5fa",
  SCALE_OUT:"#f59e0b",
  FLIP:     "#c084fc",
  ALERT:    "#9ca3af",
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface ImbalanceData {
  ideas: Array<{
    coin: string;
    smart_direction: "LONG" | "SHORT";
    contrarian_direction: "LONG" | "SHORT";
    confidence: number;
    reason: string;
    trade_plan?: {
      entry_zone: string; stop_loss: string; take_profit: string;
      risk_reward: string; kelly_size: string; funding_rate: string;
    };
  }>;
  updated_at: string;
}

// ── Tab: Signal Feed ───────────────────────────────────────────────────────────

function SignalFeed({ data }: { data: CohortCachePayload }) {
  const [filterRecipe, setFilterRecipe] = useState<string>("all");
  const [filterDir,    setFilterDir]    = useState<string>("all");
  const [filterCoin,   setFilterCoin]   = useState<string>("");

  const signals = data.recent_signals.filter((s) => {
    if (filterRecipe !== "all" && s.recipe_id !== filterRecipe) return false;
    if (filterDir    !== "all" && s.direction  !== filterDir)   return false;
    if (filterCoin   && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
    return true;
  });

  const uniqueRecipes = [...new Set(data.recent_signals.map((s) => s.recipe_id))];

  return (
    <div style={{ ...S.page, paddingTop: "20px" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" as const, alignItems: "center" }}>
        <select value={filterRecipe} onChange={(e) => setFilterRecipe(e.target.value)}
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none" }}>
          <option value="all">All Recipes</option>
          {uniqueRecipes.map((r) => <option key={r} value={r}>{RECIPE_META[r]?.label ?? r}</option>)}
        </select>

        <select value={filterDir} onChange={(e) => setFilterDir(e.target.value)}
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none" }}>
          <option value="all">All Directions</option>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
          <option value="FLAT">Flat</option>
        </select>

        <input value={filterCoin} onChange={(e) => setFilterCoin(e.target.value)}
          placeholder="Filter coin…"
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "5px", color: "#f0f0f0", padding: "6px 10px", fontSize: "12px", outline: "none", width: "120px" }} />

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
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
              }}>
                <div style={{
                  fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                  padding: "3px 7px", borderRadius: "4px", flexShrink: 0, marginTop: "2px",
                  background: `${typeColor}14`, color: typeColor, border: `1px solid ${typeColor}30`,
                }}>
                  {sig.signal_type}
                </div>

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

                {sig.ev_score != null ? (
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: sig.ev_score > 0.6 ? "#6aaa7a" : sig.ev_score > 0.3 ? "#f59e0b" : "#9ca3af" }}>
                      {(sig.ev_score * 100).toFixed(0)}
                    </div>
                    <div style={S.muted}>EV</div>
                  </div>
                ) : (
                  <div style={{ ...S.muted, flexShrink: 0 }}>n/a</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Tab: Divergence ────────────────────────────────────────────────────────────

function DivergenceTab() {
  const { data, isLoading } = useQuery<ImbalanceData>({
    queryKey: ["contrarian"],
    queryFn:  () => fetch("/api/contrarian").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading || !data) return <div style={{ padding: "28px", ...S.muted }}>Computing divergences…</div>;

  const selectedIdea = data.ideas.find((i) => i.coin === selected);

  return (
    <div style={{ ...S.page, paddingTop: "20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: "16px" }}>

        {/* Divergence list */}
        <div style={S.card}>
          <div style={S.hdr}>
            <span style={S.label}>Divergence Scanner</span>
            <span style={{ ...S.muted, marginLeft: "auto" }}>{data.ideas.length} divergences detected</span>
          </div>
          {data.ideas.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>
              No significant divergences at current threshold
            </div>
          ) : (
            data.ideas.map((idea) => {
              const isSelected = selected === idea.coin;
              const confColor = idea.confidence > 0.6 ? "#6aaa7a" : idea.confidence > 0.35 ? "#f59e0b" : "#9ca3af";
              return (
                <button key={idea.coin}
                  onClick={() => setSelected(isSelected ? null : idea.coin)}
                  style={{
                    width: "100%", textAlign: "left", padding: "16px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: isSelected ? "rgba(96,96,96,0.06)" : "transparent",
                    border: "none", cursor: "pointer", display: "block",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "#f0f0f0", minWidth: "60px" }}>{idea.coin}</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px",
                        background: idea.smart_direction === "LONG" ? "rgba(106,170,122,0.1)" : "rgba(176,104,104,0.1)",
                        color: idea.smart_direction === "LONG" ? "#6aaa7a" : "#b06868",
                        border: `1px solid ${idea.smart_direction === "LONG" ? "#6aaa7a30" : "#b0686830"}`,
                      }}>
                        SMART {idea.smart_direction}
                      </span>
                      <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.44)" }}>vs</span>
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px",
                        background: "rgba(156,163,175,0.1)", color: "#9ca3af", border: "1px solid rgba(156,163,175,0.2)",
                      }}>
                        RETAIL {idea.smart_direction === "LONG" ? "SHORT" : "LONG"}
                      </span>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "40px", height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px" }}>
                        <div style={{ width: `${idea.confidence * 100}%`, height: "100%", background: confColor, borderRadius: "2px" }} />
                      </div>
                      <span style={{ fontSize: "11px", color: confColor, fontWeight: 600 }}>{formatPct(idea.confidence)}</span>
                    </div>
                  </div>
                  <div style={{ ...S.muted, marginTop: "6px" }}>{idea.reason}</div>
                </button>
              );
            })
          )}
        </div>

        {/* Trade Plan panel */}
        {selectedIdea && (
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Smart Trade Plan: {selectedIdea.coin}</span>
              <span style={{ ...S.muted, marginLeft: "auto", fontSize: "9px" }}>Rule-based, not financial advice</span>
            </div>
            {selectedIdea.trade_plan ? (
              <div style={{ padding: "20px" }}>
                <div style={{ marginBottom: "20px", padding: "12px 16px", background: "rgba(96,96,96,0.06)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.69)", lineHeight: 1.7 }}>
                    Following smart money <strong style={{ color: selectedIdea.smart_direction === "LONG" ? "#6aaa7a" : "#b06868" }}>{selectedIdea.smart_direction}</strong> on {selectedIdea.coin}.<br/>
                    {selectedIdea.reason}
                  </div>
                </div>

                {[
                  { label: "Entry Zone",    value: selectedIdea.trade_plan.entry_zone,   clr: "#f0f0f0" },
                  { label: "Stop Loss",     value: selectedIdea.trade_plan.stop_loss,    clr: "#b06868" },
                  { label: "Take Profit",   value: selectedIdea.trade_plan.take_profit,  clr: "#6aaa7a" },
                  { label: "Risk / Reward", value: selectedIdea.trade_plan.risk_reward,  clr: "#f0f0f0" },
                  { label: "Kelly Size",    value: selectedIdea.trade_plan.kelly_size,   clr: "#9ca3af" },
                  { label: "Funding Rate",  value: selectedIdea.trade_plan.funding_rate, clr: "#f59e0b" },
                ].map(({ label, value, clr }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={S.muted}>{label}</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: clr }}>{value}</span>
                  </div>
                ))}

                <div style={{ marginTop: "16px", padding: "10px 12px", background: "rgba(176,104,104,0.06)", borderRadius: "5px", border: "1px solid rgba(176,104,104,0.15)" }}>
                  <p style={{ fontSize: "10px", color: "rgba(176,104,104,0.8)", lineHeight: 1.6 }}>
                    This plan is generated by a rule-based algorithm using ATR-derived levels, not by a human advisor or AI. Past performance does not predict future results. Always size positions according to your own risk tolerance.
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>
                Trade plan loading…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page shell ─────────────────────────────────────────────────────────────────

function SignalsInner() {
  const [tab, setTab] = useState<"feed" | "divergence">("feed");

  const { data, isLoading } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const tabStyle = (active: boolean) => ({
    padding: "8px 18px",
    fontSize: "13px",
    fontWeight: 600,
    color: active ? "#f0f0f0" : "rgba(255,255,255,0.38)",
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "color 0.15s, background 0.15s",
  });

  return (
    <>
      <PageHeader
        title="Signals"
        subtitle="Smart Money activity and divergence scanner"
        regime={data?.regime}
      />
      {/* Tab bar */}
      <div style={{ padding: "16px 32px 0", display: "flex", gap: "4px" }}>
        <button style={tabStyle(tab === "feed")}       onClick={() => setTab("feed")}>Signal Feed</button>
        <button style={tabStyle(tab === "divergence")} onClick={() => setTab("divergence")}>Divergence</button>
      </div>

      {tab === "feed" ? (
        isLoading || !data
          ? <div style={{ padding: "28px", ...S.muted }}>Loading signals…</div>
          : <SignalFeed data={data} />
      ) : (
        <DivergenceTab />
      )}
    </>
  );
}

export default function SignalsPage() {
  return <SignalsInner />;
}
