"use client";
// app/signals/feed/FeedClient.tsx

import { useState, useRef, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { timeAgo, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

type Signal = CohortCachePayload["recent_signals"][number];

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

// These recipes are always cohort-level; never attribute to a single wallet address
const COHORT_RECIPES = new Set([
  "divergence_squeeze",
  "liq_rebound",
  "concentration_risk",
  "funding_divergence",
  "funding_trend",
]);

function SignalRow({ sig }: { sig: Signal }) {
  const meta       = RECIPE_META[sig.recipe_id];
  const typeColor  = SIGNAL_TYPE_COLORS[sig.signal_type] ?? color.neutral;
  const typeLabel  = SIGNAL_TYPE_LABEL[sig.signal_type] ?? sig.signal_type;
  const dirColor   = sig.direction === "LONG" ? color.green : sig.direction === "SHORT" ? color.red : color.neutral;

  return (
    <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: "16px" }}>
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
          {meta?.desc} · {
            COHORT_RECIPES.has(sig.recipe_id)
              ? Number(sig.metadata?.wallet_count) > 1
                ? <span>{sig.metadata.wallet_count as number} smart money wallets</span>
                : <span>smart money signal</span>
              : sig.wallet_id
                ? <a href={`/wallets/discovery?address=${sig.wallet_id}`} style={{ color: "inherit", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: "3px" }}>{truncateAddress(sig.wallet_id)}</a>
                : <span>smart money signal</span>
          } · {timeAgo(sig.detected_at)}
        </div>
        {typeof sig.metadata?.description === "string" && (
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.58)", marginTop: "4px" }}>{sig.metadata.description}</div>
        )}
      </div>
      {sig.ev_score != null ? (
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: sig.ev_score > 0.6 ? color.green : sig.ev_score > 0.3 ? color.amber : color.neutral, fontVariantNumeric: "tabular-nums" }}>{(sig.ev_score * 100).toFixed(0)}</div>
          <div style={S.muted}>EV</div>
        </div>
      ) : (
        <div style={{ ...S.muted, flexShrink: 0 }}>n/a</div>
      )}
    </div>
  );
}

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

  // Infinite scroll state
  const [extra,      setExtra]      = useState<Signal[]>([]);
  const [hasMore,    setHasMore]    = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const sentinelRef  = useRef<HTMLDivElement>(null);
  const fetchingRef  = useRef(false); // ref copy to avoid stale closure in observer

  const fetchMore = async (cursor: string) => {
    if (fetchingRef.current || !hasMore) return;
    fetchingRef.current = true;
    setIsFetching(true);
    try {
      const res = await fetch(`/api/signals-feed?before=${encodeURIComponent(cursor)}&limit=50`);
      if (!res.ok) return;
      const { signals: newSigs, hasMore: more } = await res.json() as { signals: Signal[]; hasMore: boolean };
      setExtra((prev) => [...prev, ...newSigs]);
      setHasMore(more);
    } finally {
      fetchingRef.current = false;
      setIsFetching(false);
    }
  };

  // Reset extra when filters change so we don't show filtered-out historical rows
  // (historical fetch is unfiltered; re-fetch on demand is a future improvement)
  const prevFilters = useRef({ filterRecipe, filterDir, filterCoin });
  useEffect(() => {
    const prev = prevFilters.current;
    if (prev.filterRecipe !== filterRecipe || prev.filterDir !== filterDir || prev.filterCoin !== filterCoin) {
      prevFilters.current = { filterRecipe, filterDir, filterCoin };
      setExtra([]);
      setHasMore(true);
    }
  }, [filterRecipe, filterDir, filterCoin]);

  // IntersectionObserver to trigger fetchMore when sentinel comes into view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || fetchingRef.current) return;
        const kvSigs  = data?.recent_signals ?? [];
        const allSigs = [...kvSigs, ...extra];
        if (allSigs.length === 0) return;
        const oldest = allSigs.reduce(
          (min, s) => s.detected_at < min ? s.detected_at : min,
          allSigs[0].detected_at,
        );
        fetchMore(oldest);
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, extra, hasMore]);

  // Combined list: live KV signals + historical pagination
  const kvSignals = data?.recent_signals ?? [];
  const allSignals: Signal[] = [...kvSignals, ...extra];

  const filtered = data
    ? allSignals.filter((s) => {
        if (filterRecipe !== "all" && s.recipe_id !== filterRecipe) return false;
        if (filterDir    !== "all" && s.direction  !== filterDir)   return false;
        if (filterCoin   && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
        return true;
      })
    : null;

  const uniqueRecipes = data ? [...new Set(allSignals.map((s) => s.recipe_id))] : [];

  return (
    <div className="page-enter">
      <PageHeader title="Feed" subtitle="Smart Money activity and divergence scanner" regime={data?.regime} />
      <div style={{ ...S.page, paddingTop: "20px" }}>

        {/* Filter controls */}
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
            {filtered ? `${filtered.length} signals` : <span style={bone(60)} />}
          </span>
        </div>

        {/* Recipe cards */}
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
          {!filtered ? (
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
          ) : filtered.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No signals match your filters</div>
          ) : (
            filtered.map((sig, i) => <SignalRow key={`${sig.detected_at}-${sig.recipe_id}-${sig.coin}-${i}`} sig={sig} />)
          )}

          {/* Infinite scroll sentinel + status */}
          {filtered && filtered.length > 0 && (
            <div ref={sentinelRef} style={{ padding: "16px 20px", textAlign: "center" }}>
              {isFetching ? (
                <span style={{ ...S.muted, fontSize: "11px" }}>loading more...</span>
              ) : hasMore ? (
                <span style={{ ...S.muted, fontSize: "11px" }}> </span>
              ) : (
                <span style={{ ...S.muted, fontSize: "11px" }}>all signals loaded</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
