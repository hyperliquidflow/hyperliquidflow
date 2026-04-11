"use client";
// app/contrarian/page.tsx
// Smart Money vs. Rekt Money divergence scanner + rule-based Smart Trade Plan.
// Everything here is rule-based (no LLM). Free to run.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUsd, formatPct } from "@/lib/utils";
import { QueryProvider } from "@/components/query-provider";

const S = {
  page:  { padding: "28px", maxWidth: "1100px", margin: "0 auto" },
  card:  { background: "#0f0f0f", border: "1px solid rgba(180,180,180,0.12)", borderRadius: "10px", overflow: "hidden" as const },
  hdr:   { borderBottom: "1px solid rgba(180,180,180,0.06)", padding: "16px 20px" },
  label: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(227,227,227,0.38)" },
  muted: { color: "rgba(227,227,227,0.38)", fontSize: "11px" },
};

interface ContrarianData {
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

function ContrarianInner() {
  const { data, isLoading } = useQuery<ContrarianData>({
    queryKey: ["contrarian"],
    queryFn:  () => fetch("/api/contrarian").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading || !data) return <div style={{ padding: "28px", ...S.muted }}>Computing divergences…</div>;

  const selectedIdea = data.ideas.find((i) => i.coin === selected);

  return (
    <div style={S.page}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#e3e3e3" }}>Smart Money vs. Rekt Money</h1>
        <p style={S.muted}>Coins where smart-money cohort and non-cohort OI diverge · rule-based Smart Trade Plan · not financial advice</p>
      </div>

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
              const confColor = idea.confidence > 0.6 ? "#4ade80" : idea.confidence > 0.35 ? "#f59e0b" : "#9ca3af";
              return (
                <button key={idea.coin}
                  onClick={() => setSelected(isSelected ? null : idea.coin)}
                  style={{
                    width: "100%", textAlign: "left", padding: "16px 20px",
                    borderBottom: "1px solid rgba(180,180,180,0.06)",
                    background: isSelected ? "rgba(96,96,96,0.06)" : "transparent",
                    border: "none", cursor: "pointer", display: "block",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "#e3e3e3", minWidth: "60px" }}>{idea.coin}</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px",
                        background: idea.smart_direction === "LONG" ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                        color: idea.smart_direction === "LONG" ? "#4ade80" : "#f87171",
                        border: `1px solid ${idea.smart_direction === "LONG" ? "#4ade8030" : "#f8717130"}`,
                      }}>
                        SMART {idea.smart_direction}
                      </span>
                      <span style={{ fontSize: "10px", color: "rgba(227,227,227,0.38)" }}>vs</span>
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px",
                        background: "rgba(156,163,175,0.1)", color: "#9ca3af", border: "1px solid rgba(156,163,175,0.2)",
                      }}>
                        REKT {idea.smart_direction === "LONG" ? "SHORT" : "LONG"}
                      </span>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "40px", height: "3px", background: "rgba(180,180,180,0.1)", borderRadius: "2px" }}>
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

        {/* Trade Plan */}
        {selectedIdea && (
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Smart Trade Plan — {selectedIdea.coin}</span>
              <span style={{ ...S.muted, marginLeft: "auto", fontSize: "9px" }}>Rule-based · Not financial advice</span>
            </div>
            {selectedIdea.trade_plan ? (
              <div style={{ padding: "20px" }}>
                <div style={{ marginBottom: "20px", padding: "12px 16px", background: "rgba(96,96,96,0.06)", borderRadius: "6px", border: "1px solid rgba(180,180,180,0.08)" }}>
                  <div style={{ fontSize: "12px", color: "rgba(227,227,227,0.6)", lineHeight: 1.7 }}>
                    Following smart money <strong style={{ color: selectedIdea.smart_direction === "LONG" ? "#4ade80" : "#f87171" }}>{selectedIdea.smart_direction}</strong> on {selectedIdea.coin}.<br/>
                    {selectedIdea.reason}
                  </div>
                </div>

                {[
                  { label: "Entry Zone",    value: selectedIdea.trade_plan.entry_zone,  color: "#e3e3e3" },
                  { label: "Stop Loss",     value: selectedIdea.trade_plan.stop_loss,   color: "#f87171" },
                  { label: "Take Profit",   value: selectedIdea.trade_plan.take_profit, color: "#4ade80" },
                  { label: "Risk / Reward", value: selectedIdea.trade_plan.risk_reward, color: "#e3e3e3" },
                  { label: "Kelly Size",    value: selectedIdea.trade_plan.kelly_size,  color: "#9ca3af" },
                  { label: "Funding Rate",  value: selectedIdea.trade_plan.funding_rate, color: "#f59e0b" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(180,180,180,0.06)" }}>
                    <span style={S.muted}>{label}</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color }}>{value}</span>
                  </div>
                ))}

                <div style={{ marginTop: "16px", padding: "10px 12px", background: "rgba(248,113,113,0.06)", borderRadius: "5px", border: "1px solid rgba(248,113,113,0.15)" }}>
                  <p style={{ fontSize: "10px", color: "rgba(248,113,113,0.8)", lineHeight: 1.6 }}>
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

export default function ContrarianPage() {
  return <QueryProvider><ContrarianInner /></QueryProvider>;
}
