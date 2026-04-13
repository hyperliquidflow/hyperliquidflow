"use client";
// app/signals/divergence/page.tsx — Smart money vs retail divergence scanner

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { color, card as C, type as T, space } from "@/lib/design-tokens";
import { DivergenceLoadingState } from "@/components/loading-state";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
};

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

export default function DivergencePage() {
  const { data, isLoading } = useQuery<ImbalanceData>({
    queryKey: ["contrarian"],
    queryFn:  () => fetch("/api/contrarian").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading || !data) return <DivergenceLoadingState />;

  const selectedIdea = data.ideas.find((i) => i.coin === selected);

  return (
    <>
      <PageHeader title="Divergence" subtitle="Smart money vs retail positioning gaps" />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: "16px" }}>

          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Divergence Scanner</span>
              <span style={{ ...S.muted, marginLeft: "auto" }}>{data.ideas.length} divergences detected</span>
            </div>
            {data.ideas.length === 0 ? (
              <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No significant divergences at current threshold</div>
            ) : (
              data.ideas.map((idea) => {
                const isSelected = selected === idea.coin;
                const confColor = idea.confidence > 0.6 ? "#6aaa7a" : idea.confidence > 0.35 ? "#f59e0b" : "#9ca3af";
                return (
                  <button key={idea.coin}
                    onClick={() => setSelected(isSelected ? null : idea.coin)}
                    style={{ width: "100%", textAlign: "left", padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: isSelected ? "rgba(96,96,96,0.06)" : "transparent", border: "none", cursor: "pointer", display: "block" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "15px", fontWeight: 700, color: "#f0f0f0", minWidth: "60px" }}>{idea.coin}</span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px", background: idea.smart_direction === "LONG" ? "rgba(106,170,122,0.1)" : "rgba(176,104,104,0.1)", color: idea.smart_direction === "LONG" ? "#6aaa7a" : "#b06868", border: `1px solid ${idea.smart_direction === "LONG" ? "#6aaa7a30" : "#b0686830"}` }}>
                          SMART {idea.smart_direction}
                        </span>
                        <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.44)" }}>vs</span>
                        <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px", background: "rgba(156,163,175,0.1)", color: "#9ca3af", border: "1px solid rgba(156,163,175,0.2)" }}>
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
                      Following smart money <strong style={{ color: selectedIdea.smart_direction === "LONG" ? "#6aaa7a" : "#b06868" }}>{selectedIdea.smart_direction}</strong> on {selectedIdea.coin}.<br />
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
                <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 0 }}>
                  {["Entry Zone", "Stop Loss", "Take Profit", "Risk / Reward", "Kelly Size", "Funding Rate"].map((label, i) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", animation: `slide-up-ghost 2.4s ease-in-out ${i * 0.14}s infinite` }}>
                      <div style={{ height: 9, width: 80, borderRadius: 3, background: "rgba(255,255,255,0.05)" }} />
                      <div style={{ height: 9, width: 60, borderRadius: 3, background: "rgba(255,255,255,0.08)" }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
