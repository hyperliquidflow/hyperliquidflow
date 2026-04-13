"use client";
// app/signals/feed/FeedClient.tsx

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { timeAgo, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
};

const bone = (w: string | number, h = 9): React.CSSProperties => ({
  height: h, width: w, borderRadius: 3, background: "rgba(255,255,255,0.07)", flexShrink: 0,
});
const ghost = (delay = 0): React.CSSProperties => ({
  animation: `slide-up-ghost 2.4s ease-in-out ${delay}s infinite`,
});

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  ENTRY:    color.green,
  EXIT:     color.red,
  SCALE_IN: color.neutral,
  SCALE_OUT: color.neutral,
  FLIP:     color.neutral,
  ALERT:    color.amber,
};

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  SCALE_IN:  "SCALE IN",
  SCALE_OUT: "SCALE OUT",
};

export function FeedClient({ initialData }: { initialData: CohortCachePayload | null }) {
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const [filterRecipe, setFilterRecipe] = useState<string>("all");
  const [filterDir,    setFilterDir]    = useState<string>("all");
  const [filterCoin,   setFilterCoin]   = useState<string>("");

  const signals = data
    ? data.recent_signals.filter((s) => {
        if (filterRecipe !== "all" && s.recipe_id !== filterRecipe) return false;
        if (filterDir    !== "all" && s.direction  !== filterDir)   return false;
        if (filterCoin   && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
        return true;
      })
    : null;

  const uniqueRecipes = data ? [...new Set(data.recent_signals.map((s) => s.recipe_id))] : [];

  return (
    <div className="page-enter">
      <PageHeader title="Feed" subtitle="Smart Money activity and divergence scanner" regime={data?.regime} />
      <div style={{ ...S.page, paddingTop: "20px" }}>

        {/* Filter controls - always rendered */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" as const, alignItems: "center" }}>
          <select value={filterRecipe} onChange={(e) => setFilterRecipe(e.target.value)}
            style={{ background: color.inputBg, border: `1px solid ${color.inputBorder}`, borderRadius: "5px", color: color.text, padding: "6px 10px", fontSize: "13px", outline: "none" }}>
            <option value="all">All Recipes</option>
            {uniqueRecipes.map((r) => <option key={r} value={r}>{RECIPE_META[r]?.label ?? r}</option>)}
          </select>
          <select value={filterDir} onChange={(e) => setFilterDir(e.target.value)}
            style={{ background: color.inputBg, border: `1px solid ${color.inputBorder}`, borderRadius: "5px", color: color.text, padding: "6px 10px", fontSize: "13px", outline: "none" }}>
            <option value="all">All Directions</option>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
            <option value="FLAT">Flat</option>
          </select>
          <input value={filterCoin} onChange={(e) => setFilterCoin(e.target.value)}
            placeholder="Filter coin..."
            style={{ background: color.inputBg, border: `1px solid ${color.inputBorder}`, borderRadius: "5px", color: color.text, padding: "6px 10px", fontSize: "13px", outline: "none", width: "120px" }} />
          <span style={S.muted}>
            {signals ? `${signals.length} results` : <span style={bone(60)} />}
          </span>
        </div>

        {/* Recipe cards - always rendered from static RECIPE_META */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "20px" }}>
          {Object.entries(RECIPE_META).map(([id, { label, desc }]) => (
            <button key={id} onClick={() => setFilterRecipe(filterRecipe === id ? "all" : id)}
              className="card-hover glow-btn"
              style={{ ...S.card, padding: "16px 18px", textAlign: "left" as const, cursor: "pointer",
                border: filterRecipe === id ? "1px solid rgba(255,255,255,0.26)" : "1px solid rgba(255,255,255,0.07)",
                background: filterRecipe === id ? "rgba(96,96,96,0.10)" : "#0f0f0f" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: color.text, marginBottom: "6px" }}>{label}</div>
              <div style={{ ...S.muted, lineHeight: 1.5 }}>{desc}</div>
            </button>
          ))}
        </div>

        {/* Signal list */}
        <div style={S.card}>
          {!signals ? (
            /* Inline skeleton rows */
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ ...ghost(i * 0.1), padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: 16 }}>
                <div style={{ height: 18, width: 52, borderRadius: 4, background: "rgba(255,255,255,0.06)", flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={bone("38%", 10)} />
                    <div style={bone("12%", 10)} />
                  </div>
                  <div style={bone("60%", 8)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <div style={bone(28, 14)} />
                  <div style={bone(18, 7)} />
                </div>
              </div>
            ))
          ) : signals.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No signals match your filters</div>
          ) : (
            signals.map((sig, i) => {
              const meta = RECIPE_META[sig.recipe_id];
              const typeColor = SIGNAL_TYPE_COLORS[sig.signal_type] ?? color.neutral;
              const typeLabel = SIGNAL_TYPE_LABEL[sig.signal_type] ?? sig.signal_type;
              const dirColor  = sig.direction === "LONG" ? color.green : sig.direction === "SHORT" ? color.red : color.neutral;
              return (
                <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", padding: "3px 7px", borderRadius: "4px", flexShrink: 0, marginTop: "2px", background: `${typeColor}14`, color: typeColor, border: `1px solid ${typeColor}30` }}>
                    {typeLabel}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" as const }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: color.text }}>{meta?.label ?? sig.recipe_id}</span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: color.text }}>·</span>
                      <span style={{ ...T.sigCoinTag }}>{sig.coin}</span>
                      {sig.direction && (
                        <span style={{ ...T.sigDir,
                          background: sig.direction === "LONG" ? color.longBg : sig.direction === "SHORT" ? color.shortBg : color.neutralBg,
                          color: dirColor,
                          border: `1px solid ${sig.direction === "LONG" ? color.longBorder : sig.direction === "SHORT" ? color.shortBorder : color.neutralBorder}`,
                        }}>{sig.direction}</span>
                      )}
                    </div>
                    <div style={{ ...S.muted, marginTop: "3px" }}>
                      {meta?.desc} · wallet <a href={`/wallets/discovery?address=${sig.wallet_id ?? ""}`} style={{ color: "inherit", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: "3px" }}>{truncateAddress(sig.wallet_id ?? "")}</a> · {timeAgo(sig.detected_at)}
                    </div>
                    {typeof sig.metadata?.description === "string" && (
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.58)", marginTop: "4px" }}>{sig.metadata.description}</div>
                    )}
                  </div>
                  {sig.ev_score != null ? (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: sig.ev_score > 0.6 ? color.green : sig.ev_score > 0.3 ? color.amber : color.neutral }}>{(sig.ev_score * 100).toFixed(0)}</div>
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
    </div>
  );
}
