"use client";
// app/signals/divergence/DivergenceClient.tsx

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
};

const bone = (w: string | number, h = 9): React.CSSProperties => ({
  height: h, width: w, borderRadius: 3, background: "rgba(255,255,255,0.07)", flexShrink: 0,
});
const ghost = (delay = 0): React.CSSProperties => ({
  animation: `slide-up-ghost 2.4s ease-in-out ${delay}s infinite`,
});

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

export function DivergenceClient({ initialData }: { initialData: unknown }) {
  const { data } = useQuery<ImbalanceData>({
    queryKey:        ["contrarian"],
    queryFn:         () => fetch("/api/contrarian").then((r) => r.json()),
    initialData:     initialData as ImbalanceData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  const selectedIdea = data?.ideas.find((i) => i.coin === selected);

  return (
    <div className="page-enter">
      <PageHeader title="Divergence" subtitle="Smart money vs retail positioning gaps" />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: "16px" }}>

          <div style={S.card}>
            <div style={S.hdr}>
              <span style={S.label}>Divergence Scanner</span>
              <span style={{ ...S.muted, marginLeft: "auto" }}>
                {data ? `${data.ideas.length} divergences detected` : <span style={bone(110)} />}
              </span>
            </div>

            {!data ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ ...ghost(i * 0.15), padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={bone(52, 14)} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ height: 20, width: 80, borderRadius: 5, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                      <div style={bone(14, 8)} />
                      <div style={{ height: 20, width: 80, borderRadius: 5, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 40, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }} />
                      <div style={bone(32)} />
                    </div>
                  </div>
                  <div style={bone("72%", 8)} />
                </div>
              ))
            ) : data.ideas.length === 0 ? (
              <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No significant divergences at current threshold</div>
            ) : (
              data.ideas.map((idea) => {
                const isSelected = selected === idea.coin;
                const confColor = idea.confidence > 0.6 ? color.green : idea.confidence > 0.35 ? color.amber : color.neutral;
                return (
                  <button key={idea.coin}
                    onClick={() => setSelected(isSelected ? null : idea.coin)}
                    style={{ width: "100%", textAlign: "left", padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: isSelected ? "rgba(96,96,96,0.06)" : "transparent", border: "none", cursor: "pointer", display: "block" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: color.text, minWidth: "60px" }}>{idea.coin}</span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px", background: idea.smart_direction === "LONG" ? color.longBg : color.shortBg, color: idea.smart_direction === "LONG" ? color.green : color.red, border: `1px solid ${idea.smart_direction === "LONG" ? color.longBorder : color.shortBorder}` }}>
                          SMART {idea.smart_direction}
                        </span>
                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.44)" }}>vs</span>
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 7px", borderRadius: "4px", background: color.neutralBg, color: color.neutral, border: `1px solid ${color.neutralBorder}` }}>
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
                <span style={{ ...S.muted, marginLeft: "auto", fontSize: "11px" }}>Rule-based, not financial advice</span>
              </div>
              {selectedIdea.trade_plan ? (
                <div style={{ padding: "20px" }}>
                  <div style={{ marginBottom: "20px", padding: "12px 16px", background: "rgba(96,96,96,0.06)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.69)", lineHeight: 1.7 }}>
                      Following smart money <strong style={{ color: selectedIdea.smart_direction === "LONG" ? color.green : color.red }}>{selectedIdea.smart_direction}</strong> on {selectedIdea.coin}.<br />
                      {selectedIdea.reason}
                    </div>
                  </div>
                  {[
                    { label: "Entry Zone",    value: selectedIdea.trade_plan.entry_zone,   clr: color.text },
                    { label: "Stop Loss",     value: selectedIdea.trade_plan.stop_loss,    clr: color.red },
                    { label: "Take Profit",   value: selectedIdea.trade_plan.take_profit,  clr: color.green },
                    { label: "Risk / Reward", value: selectedIdea.trade_plan.risk_reward,  clr: color.text },
                    { label: "Kelly Size",    value: selectedIdea.trade_plan.kelly_size,   clr: color.neutral },
                    { label: "Funding Rate",  value: selectedIdea.trade_plan.funding_rate, clr: color.amber },
                  ].map(({ label, value, clr }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={S.muted}>{label}</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: clr }}>{value}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: "16px", padding: "10px 12px", background: color.shortBg, borderRadius: "5px", border: `1px solid ${color.shortBorder}` }}>
                    <p style={{ fontSize: "11px", color: color.red, lineHeight: 1.6 }}>
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
    </div>
  );
}
