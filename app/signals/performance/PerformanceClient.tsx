"use client";
// app/signals/performance/PerformanceClient.tsx

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import {
  color, card as C, type as T, space, radius,
} from "@/lib/design-tokens";
import type { RecipeStats } from "@/lib/server/kv-fetchers";

// Interpolate white to color.green (#6aaa7a) based on accuracy 0 to 1
function accuracyColor(rate: number): string {
  const r = Math.round(255 + (106 - 255) * rate);
  const g = Math.round(255 + (170 - 255) * rate);
  const b = Math.round(255 + (122 - 255) * rate);
  return `rgb(${r},${g},${b})`;
}

function fmt(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "\u2014";
  return `${val >= 0 ? "+" : ""}${val.toFixed(decimals)}%`;
}

function fmtAcc(val: number | null | undefined): string {
  if (val == null) return "\u2014";
  return `${(val * 100).toFixed(1)}%`;
}

type Window = "7d" | "30d";

const S = {
  page:     { padding: space.pagePaddingX },
  grid:     { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: space.statGap, marginBottom: "24px" },
  heroRow:  { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: color.borderFaint, borderBottom: `1px solid ${color.borderFaint}` },
  heroCel:  { padding: "16px 20px", background: color.card, textAlign: "center" as const },
  heroVal:  { ...T.statValue, fontFamily: T.mono },
  heroLbl:  { ...T.statLabel, marginTop: "6px" },
  tdTf:     { ...T.statLabel, padding: "7px 20px", fontSize: "11px", letterSpacing: "0.08em" },
  tdAcc:    { padding: "7px 8px", fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const, fontFamily: T.mono },
  tdMv:     { padding: "7px 20px 7px 0", fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const, fontFamily: T.mono, textAlign: "right" as const },
  tog:      { display: "flex", gap: "2px", background: color.neutralBg, border: `1px solid ${color.neutralBorder}`, borderRadius: radius.tag, padding: "2px" },
  togBtn:   { background: "none", border: "none", cursor: "pointer" as const, fontSize: "11px", fontWeight: 600, fontFamily: T.sans, padding: "2px 8px", borderRadius: radius.dirPill, color: color.textMuted } as React.CSSProperties,
  togBtnOn: { background: color.tagBg, color: color.text },
  coin:     { fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: radius.dirPill, background: color.tagBg, border: `1px solid ${color.border}`, color: color.tagText },
  fallback: { ...T.statValue, marginTop: "16px" },
  fallbackNote: { fontSize: "13px", color: color.textMuted, marginTop: "6px", lineHeight: 1.4 },
  lowSample: { fontSize: "11px", color: color.textMuted, fontWeight: 600, marginLeft: "4px" },
};

export function PerformanceClient({ initialData }: { initialData: RecipeStats[] | null }) {
  const [win, setWin] = useState<Window>("7d");

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
      <PageHeader
        title="Performance"
        subtitle="Directional accuracy by recipe. % of signals where price moved the predicted direction. Not realized profit."
      />
      <div style={{ ...S.page, paddingTop: space.contentPaddingTop }}>
        <div style={S.grid}>
          {allRecipes.map(({ id, label, desc, perf }) => {
            const resolved  = win === "7d" ? (perf?.resolved_7d ?? 0) : (perf?.resolved_30d ?? 0);
            const acc4h     = win === "7d" ? perf?.accuracy_4h_7d   : perf?.accuracy_4h_30d;
            const move4h    = win === "7d" ? perf?.avg_move_4h_7d   : perf?.avg_move_4h_30d;
            const acc1h     = win === "7d" ? perf?.accuracy_1h_7d   : perf?.accuracy_1h_30d;
            const move1h    = win === "7d" ? perf?.avg_move_1h_7d   : perf?.avg_move_1h_30d;
            const acc24h    = win === "7d" ? perf?.accuracy_24h_7d  : perf?.accuracy_24h_30d;
            const move24h   = win === "7d" ? perf?.avg_move_24h_7d  : perf?.avg_move_24h_30d;
            const coins     = win === "7d" ? (perf?.top_coins_7d ?? []) : (perf?.top_coins_30d ?? []);
            const signals   = perf?.signal_count ?? 0;
            const isNew     = resolved === 0;
            const isLow     = resolved > 0 && resolved < 10;

            return (
              <div key={id} className="card-hover glow-btn" style={C.base}>
                {/* Header */}
                <div style={{ ...C.header, justifyContent: "space-between" }}>
                  <span style={T.cardTitle}>{label}</span>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <div style={S.tog}>
                      <button
                        style={{ ...S.togBtn, ...(win === "7d" ? S.togBtnOn : {}) }}
                        onClick={() => setWin("7d")}
                      >7d</button>
                      <button
                        style={{ ...S.togBtn, ...(win === "30d" ? S.togBtnOn : {}) }}
                        onClick={() => setWin("30d")}
                      >30d</button>
                    </div>
                    {signals > 0 && (
                      <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: radius.dirPill, background: color.tagBg, border: `1px solid ${color.borderFaint}`, color: color.textMuted, fontVariantNumeric: "tabular-nums" }}>
                        {signals}
                      </span>
                    )}
                  </div>
                </div>

                {/* Fallback: no outcome data yet */}
                {isNew ? (
                  <div style={{ padding: "16px 20px 18px" }}>
                    <div style={{ ...S.fallback, color: perf?.win_rate != null ? accuracyColor(perf.win_rate) : color.textFaint }}>
                      {perf?.win_rate != null ? formatPct(perf.win_rate) : "n/a"}
                    </div>
                    <div style={T.statLabel}>Signal Quality</div>
                    <div style={S.fallbackNote}>
                      Outcome tracking is live. Accuracy data accumulates over 7 days.
                    </div>
                    <div style={{ ...T.statSub, marginTop: "12px" }}>{desc}</div>
                  </div>
                ) : (
                  <>
                    {/* Hero row */}
                    <div style={S.heroRow}>
                      <div style={S.heroCel}>
                        <div style={{ ...S.heroVal, color: acc4h != null ? accuracyColor(acc4h) : color.textFaint }}>
                          {fmtAcc(acc4h)}
                          {isLow && <span style={S.lowSample}>~</span>}
                        </div>
                        <div style={S.heroLbl}>Accuracy 4h</div>
                      </div>
                      <div style={S.heroCel}>
                        <div style={{ ...S.heroVal, color: move4h == null ? color.textFaint : move4h >= 0 ? color.green : color.red }}>
                          {fmt(move4h)}
                        </div>
                        <div style={S.heroLbl}>Avg Move 4h</div>
                      </div>
                    </div>

                    {/* Breakdown table */}
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        {([
                          ["1h",  acc1h,  move1h],
                          ["4h",  acc4h,  move4h],
                          ["24h", acc24h, move24h],
                        ] as [string, number | null | undefined, number | null | undefined][]).map(([tf, acc, mv]) => (
                          <tr key={tf} style={{ borderBottom: `1px solid ${color.divider}` }}>
                            <td style={S.tdTf}>{tf}</td>
                            <td style={{ ...S.tdAcc, color: acc != null ? accuracyColor(acc) : color.textFaint }}>
                              {fmtAcc(acc)}
                            </td>
                            <td style={{ ...S.tdMv, color: mv == null ? color.textFaint : mv >= 0 ? color.green : color.red }}>
                              {fmt(mv)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Coin tags */}
                    {coins.length > 0 && (
                      <div style={{ display: "flex", gap: "4px", padding: "10px 20px 0", flexWrap: "wrap" }}>
                        {coins.map((c) => <span key={c} style={S.coin}>{c}</span>)}
                      </div>
                    )}

                    {/* Description */}
                    <div style={{ ...T.statSub, padding: "8px 20px 14px", lineHeight: 1.45 }}>{desc}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
