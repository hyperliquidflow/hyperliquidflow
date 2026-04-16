"use client";
// app/signals/feed/FeedClient.tsx

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { RECIPE_META } from "@/lib/recipe-meta";
import { truncateAddress, formatSignalTime } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import {
  color, type as T, space, radius,
  layout, anim, card, signal, selectable,
} from "@/lib/design-tokens";

type Signal = CohortCachePayload["recent_signals"][number];

const S = {
  page:   { padding: `0 ${space.pagePaddingX} ${space.contentPaddingBot}` },
  body:   { display: "flex", gap: space.cardGap, alignItems: "flex-start" },

  // Sidebar
  sidebar: {
    width: "196px", flexShrink: 0,
    ...card.base,
    maxHeight: "calc(100vh - 140px)", overflow: "hidden",
    display: "flex", flexDirection: "column" as const,
  },
  sidebarScroll: { overflowY: "auto" as const, flex: 1 },
  sidebarHeader: {
    ...card.header,
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.4)",
  },
  groupLabel: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: color.textFaint,
    padding: "12px 16px 4px",
  },
  recipeItem: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "7px 16px", cursor: "pointer",
    fontSize: "13px", color: color.textMuted,
    transition: anim.row,
    userSelect: "none" as const,
  },

  // Feed panel
  feedPanel:  { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: space.cardGap },
  feedHeader: { ...card.header, flexWrap: "wrap" as const, gap: "8px", padding: "10px 20px" },
  feedScroll: { overflowY: "auto" as const, maxHeight: "calc(100vh - 200px)" },

  // Signal row -- 4-column grid
  sigRow: {
    display: "grid",
    gridTemplateColumns: "76px 1fr 90px 56px",
    alignItems: "center",
    gap: "14px",
    padding: "14px 20px",
    borderBottom: `1px solid ${color.divider}`,
    transition: anim.row,
    cursor: "default",
  },

  // Pill
  pill: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.06em",
    padding: "3px 6px", borderRadius: radius.dirPill,
    width: "76px", textAlign: "center" as const,
    display: "block", boxSizing: "border-box" as const,
    whiteSpace: "nowrap" as const,
  },

  // Body cells
  sigTopRow: {
    display: "flex", alignItems: "center", gap: "8px",
    flexWrap: "nowrap" as const, overflow: "hidden",
  },
  sigName: {
    ...T.sigName,
    whiteSpace: "nowrap" as const,
    overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1,
  },
  sigReason: { ...T.sigSub, marginTop: "5px", lineHeight: 1.45 },
  sigFooter: { marginTop: "4px" },
  sigAddr: {
    fontFamily: T.mono, fontSize: "11px",
    color: `${color.neutral}59`,
    textDecoration: "underline",
    textDecorationColor: `${color.neutral}33`,
    textUnderlineOffset: "3px",
    ...selectable.on,
  },

  // Coin tag
  coinTag: { ...T.sigCoinTag },

  // Direction pill
  dirPill: { ...T.sigDir },

  // Time column
  sigTime: {
    fontSize: "13px", color: color.textDim,
    textAlign: "right" as const, whiteSpace: "nowrap" as const,
    paddingRight: "20px", fontVariantNumeric: "tabular-nums",
  },

  // EV column
  sigEv: {
    borderLeft: `1px solid ${color.border}`,
    alignSelf: "stretch" as const,
    display: "flex", flexDirection: "column" as const,
    alignItems: "center", justifyContent: "center",
    paddingLeft: "20px", paddingRight: "8px",
    textAlign: "center" as const, cursor: "default",
  },
  evValue: { fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  evLabel: { fontSize: "11px", color: color.textDim, marginTop: "3px" },

  // Coin chips
  chipRow: { display: "flex", alignItems: "center", gap: "6px", flex: 1, flexWrap: "wrap" as const },
  chip: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em",
    padding: "4px 10px", borderRadius: radius.tag,
    background: color.tagBg, border: `1px solid ${color.border}`,
    color: color.textMuted, cursor: "pointer",
  },
  chipActive: {
    background: color.inputBg,
    border: `1px solid ${color.borderHover}`,
    color: color.text,
  },

  // Segmented control
  segCtrl: {
    display: "flex", gap: "2px",
    background: color.inputBg,
    border: `1px solid ${color.inputBorder}`,
    borderRadius: radius.input, padding: "3px",
  },
  segBtn: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em",
    padding: "3px 10px", borderRadius: radius.dirPill,
    background: "none", border: "none",
    color: color.textMuted, cursor: "pointer",
  },
  segBtnActive: {
    background: color.borderHover,
    color: color.text,
  },

  // Search wrap
  searchWrap: {
    position: "relative" as const, flexShrink: 0,
    borderRadius: radius.input,
    width: "28px", height: "28px",
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${color.border}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
    transition: `width 0.2s cubic-bezier(0.4,0,0.2,1), border-color 0.15s`,
    overflow: "hidden",
  },
  searchWrapOpen: {
    width: "72px",
    borderColor: color.borderHover,
    cursor: "text",
  },

  // Muted / footer
  muted: { color: color.textMuted, fontSize: "13px" },
  scrollFooter: { padding: "16px 20px", textAlign: "center" as const, fontSize: "11px", color: color.textFaint },
} as const;

// ─── Constants ────────────────────────────────────────────────────────────────

const COHORT_RECIPES = new Set([
  "divergence_squeeze", "liq_rebound", "concentration_risk",
  "funding_divergence", "funding_trend",
]);

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  SCALE_IN:  "SCALE IN",
  SCALE_OUT: "SCALE OUT",
};

const PILL_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  ENTRY:     { bg: `${signal.entry}14`,    color: signal.entry,    border: `${signal.entry}38` },
  EXIT:      { bg: `${signal.exit}14`,     color: signal.exit,     border: `${signal.exit}38` },
  ALERT:     { bg: `${signal.alert}14`,    color: signal.alert,    border: `${signal.alert}38` },
  SCALE_IN:  { bg: `${signal.scaleIn}14`,  color: signal.scaleIn,  border: `${signal.scaleIn}38` },
  SCALE_OUT: { bg: `${signal.scaleOut}14`, color: signal.scaleOut, border: `${signal.scaleOut}38` },
  FLIP:      { bg: `${signal.flip}14`,     color: signal.flip,     border: `${signal.flip}38` },
};

const DIR_COLORS = {
  LONG:  { background: color.longBg,    color: color.green,   border: `1px solid ${color.longBorder}` },
  SHORT: { background: color.shortBg,   color: color.red,     border: `1px solid ${color.shortBorder}` },
  FLAT:  { background: color.neutralBg, color: color.neutral, border: `1px solid ${color.neutralBorder}` },
} as const;

const EV_COLOR = (score: number) =>
  score > 0.6 ? color.green : score > 0.3 ? color.amber : color.neutral;

const STATIC_COINS = ["BTC", "ETH", "SOL", "HYPE", "XMR"];

const RECIPE_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Momentum",       ids: ["momentum_stack", "accumulation_reentry", "streak_continuation", "whale_validated"] },
  { label: "Smart Money",    ids: ["divergence_squeeze", "anti_whale_trap", "wallet_churn", "bridge_inflow", "twap_accumulation"] },
  { label: "Risk",           ids: ["liq_rebound", "position_aging", "concentration_risk"] },
  { label: "Carry & Funding",ids: ["rotation_carry", "funding_divergence", "funding_trend"] },
];

// ─── Portal popup components ───────────────────────────────────────────────────

function RecipePopup({ label, desc, rect }: { label: string; desc: string; rect: DOMRect }) {
  const POPUP_W = 256;
  const bottom  = window.innerHeight - rect.top + 8;
  let   left    = rect.left + 12;
  if (left + POPUP_W > window.innerWidth - 12) left = window.innerWidth - POPUP_W - 12;

  return (
    <div style={{
      position: "fixed", bottom, left, width: POPUP_W,
      background: "rgba(14,14,14,0.97)",
      border: `1px solid ${color.borderHover}`,
      borderRadius: radius.card,
      padding: "14px 16px",
      zIndex: layout.zIndex.popup,
      boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
      pointerEvents: "none",
      fontFamily: T.sans,
    }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: color.text, marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "16px", color: color.textMuted, lineHeight: 1.45 }}>{desc}</div>
    </div>
  );
}

function EvPopup({ rect }: { rect: DOMRect }) {
  const EV_W   = 220;
  const bottom = window.innerHeight - rect.top + 8;
  const left   = Math.max(12, rect.right - EV_W);

  return (
    <div style={{
      position: "fixed", bottom, left, width: EV_W,
      background: "rgba(14,14,14,0.97)",
      border: `1px solid ${color.borderHover}`,
      borderRadius: radius.card,
      padding: "14px 16px",
      zIndex: layout.zIndex.popup,
      boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
      pointerEvents: "none",
      fontFamily: T.sans,
    }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: color.text, marginBottom: "6px" }}>Expected Value</div>
      <div style={{ fontSize: "13px", color: color.textMuted, lineHeight: 1.45 }}>
        Modeled signal edge based on historical accuracy and market context. Higher scores indicate stronger conviction.
      </div>
    </div>
  );
}

// ─── SignalRow ─────────────────────────────────────────────────────────────────

function SignalRow({ sig }: { sig: Signal }) {
  const meta      = RECIPE_META[sig.recipe_id];
  const pillStyle = PILL_COLORS[sig.signal_type] ?? PILL_COLORS.FLIP;
  const dirStyle  = sig.direction ? DIR_COLORS[sig.direction as keyof typeof DIR_COLORS] : null;
  const typeLabel = SIGNAL_TYPE_LABEL[sig.signal_type] ?? sig.signal_type;
  const address   = (sig as Signal & { wallet_address?: string | null }).wallet_address ?? null;

  // EV popup state is local to each row to avoid lifting state to FeedClient
  const [evRect, setEvRect] = useState<DOMRect | null>(null);

  return (
    <div
      style={{ ...S.sigRow }}
      onMouseEnter={(e) => (e.currentTarget.style.background = color.rowHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      {/* Col 1: pill */}
      <span style={{ ...S.pill, background: pillStyle.bg, color: pillStyle.color, border: `1px solid ${pillStyle.border}` }}>
        {typeLabel}
      </span>

      {/* Col 2: body */}
      <div style={{ minWidth: 0 }}>
        <div style={S.sigTopRow}>
          <span style={S.sigName}>{meta?.label ?? sig.recipe_id}</span>
          <span style={S.coinTag}>{sig.coin}</span>
          {dirStyle && sig.direction && (
            <span style={{ ...S.dirPill, ...dirStyle }}>{sig.direction}</span>
          )}
        </div>
        {typeof sig.metadata?.description === "string" && (
          <div style={S.sigReason}>{sig.metadata.description}</div>
        )}
        {address && !COHORT_RECIPES.has(sig.recipe_id) && (
          <div style={S.sigFooter}>
            <a
              href={`/wallets/discovery?address=${address}`}
              style={S.sigAddr}
              draggable={false}
            >
              {truncateAddress(address)}
            </a>
          </div>
        )}
      </div>

      {/* Col 3: time */}
      <div style={S.sigTime}>{formatSignalTime(sig.detected_at)}</div>

      {/* Col 4: EV */}
      {sig.ev_score != null ? (
        <div
          style={S.sigEv}
          onMouseEnter={(e) => setEvRect((e.currentTarget as HTMLElement).getBoundingClientRect())}
          onMouseLeave={() => setEvRect(null)}
        >
          <div style={{ ...S.evValue, color: EV_COLOR(sig.ev_score) }}>
            {(sig.ev_score * 100).toFixed(0)}
          </div>
          <div style={S.evLabel}>EV</div>
          {evRect && typeof document !== "undefined" && createPortal(
            <EvPopup rect={evRect} />,
            document.body,
          )}
        </div>
      ) : (
        <div style={{ ...S.sigEv, borderLeft: "none" }} />
      )}
    </div>
  );
}

// ─── RecipeSidebar ─────────────────────────────────────────────────────────────

function RecipeSidebar({
  selected,
  onToggle,
  firedToday,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  firedToday: Set<string>;
}) {
  const [popup, setPopup] = useState<{
    id: string; label: string; desc: string; rect: DOMRect;
  } | null>(null);

  const handleMouseEnter = useCallback((id: string, label: string, desc: string, e: React.MouseEvent) => {
    setPopup({ id, label, desc, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  }, []);

  const handleMouseLeave = useCallback(() => setPopup(null), []);

  return (
    <div style={S.sidebar}>
      <div style={S.sidebarHeader}>Recipes</div>
      <div style={S.sidebarScroll}>
        {RECIPE_GROUPS.map((group) => (
          <div key={group.label}>
            <div style={S.groupLabel}>{group.label}</div>
            {group.ids.map((id) => {
              const meta = RECIPE_META[id];
              if (!meta) return null;
              const isSelected = selected.has(id);
              return (
                <div
                  key={id}
                  className="glow-btn"
                  style={{
                    ...S.recipeItem,
                    background: isSelected ? color.navActivebg : "transparent",
                    border: isSelected ? `1px solid ${color.borderHover}` : "1px solid transparent",
                    borderRadius: radius.tag,
                    margin: "0 8px 2px",
                    padding: "7px 8px",
                  }}
                  onClick={() => onToggle(id)}
                  onMouseEnter={(e) => handleMouseEnter(id, meta.label, meta.desc, e)}
                  onMouseLeave={handleMouseLeave}
                >
                  <span style={{ fontSize: "11px", color: firedToday.has(id) && !selected.has(id) ? color.amber : color.borderHover }}>●</span>
                  <span style={{ fontSize: "13px", color: isSelected ? color.text : color.textMuted }}>
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {popup && typeof document !== "undefined" && createPortal(
        <RecipePopup label={popup.label} desc={popup.desc} rect={popup.rect} />,
        document.body,
      )}
    </div>
  );
}

// ─── FeedClient ────────────────────────────────────────────────────────────────

export function FeedClient({ initialData }: { initialData: CohortCachePayload | null }) {
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then((r) => r.json()),
    initialData:     initialData ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const { data: topMarkets } = useQuery<string[]>({
    queryKey:  ["top-markets"],
    queryFn:   () => fetch("/api/top-markets?n=10").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Static coins + top 2 by 24h volume not already in the static list
  const coins = [
    ...STATIC_COINS,
    ...(topMarkets ?? []).filter((c) => !STATIC_COINS.includes(c)).slice(0, 2),
  ];

  // Filters
  const [selectedRecipes, setSelectedRecipes] = useState<Set<string>>(new Set());
  const [filterDir,  setFilterDir]  = useState<string>("all");
  const [filterCoin, setFilterCoin] = useState<string>("");
  const [activeCoin, setActiveCoin] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef  = useRef<HTMLDivElement>(null);

  // Infinite scroll
  const [extra,      setExtra]      = useState<Signal[]>([]);
  const [hasMore,    setHasMore]    = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const fetchingRef  = useRef(false);
  const sentinelRef  = useRef<HTMLDivElement>(null);

  const toggleRecipe = useCallback((id: string) => {
    setSelectedRecipes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Reset pagination when filters change
  const prevFilters = useRef({ selectedRecipes, filterDir, activeCoin, filterCoin });
  useEffect(() => {
    const prev = prevFilters.current;
    const recipesChanged =
      prev.selectedRecipes.size !== selectedRecipes.size ||
      [...selectedRecipes].some((id) => !prev.selectedRecipes.has(id));

    if (
      prev.filterDir  !== filterDir  ||
      prev.activeCoin !== activeCoin ||
      prev.filterCoin !== filterCoin ||
      recipesChanged
    ) {
      prevFilters.current = { selectedRecipes, filterDir, activeCoin, filterCoin };
      setExtra([]);
      setHasMore(true);
    }
  }, [selectedRecipes, filterDir, activeCoin, filterCoin]);

  const fetchMore = useCallback(async (cursor: string) => {
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
  }, [hasMore]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || fetchingRef.current) return;
      const allSigs = [...(data?.recent_signals ?? []), ...extra];
      if (allSigs.length === 0) return;
      const oldest = allSigs.reduce((min, s) => s.detected_at < min ? s.detected_at : min, allSigs[0].detected_at);
      fetchMore(oldest);
    }, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data, extra, hasMore, fetchMore]);

  // Search expand/collapse
  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    const onClickOutside = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) {
        setSearchOpen(false);
        setFilterCoin("");
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSearchOpen(false); setFilterCoin(""); }
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [searchOpen]);

  const allSignals: Signal[] = [...(data?.recent_signals ?? []), ...extra];

  const firedToday = new Set(
    (data?.recent_signals ?? [])
      .filter((s) => Date.now() - new Date(s.detected_at).getTime() < 24 * 60 * 60 * 1000)
      .map((s) => s.recipe_id)
  );

  const filtered = allSignals.filter((s) => {
    if (selectedRecipes.size > 0 && !selectedRecipes.has(s.recipe_id)) return false;
    if (filterDir !== "all" && s.direction !== filterDir) return false;
    if (activeCoin && s.coin !== activeCoin) return false;
    if (filterCoin && !s.coin.toLowerCase().includes(filterCoin.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page-enter">
      <PageHeader title="Feed" subtitle="Live signals from tracked smart money wallets" />
      <div style={S.page}>
        <div style={S.body}>

          {/* Sidebar */}
          <RecipeSidebar selected={selectedRecipes} onToggle={toggleRecipe} firedToday={firedToday} />

          {/* Feed panel */}
          <div style={S.feedPanel}>
            <div style={{ ...card.base }}>

              {/* Header: coin chips + search + seg control */}
              <div style={S.feedHeader}>
                <div style={S.chipRow}>
                  {coins.map((coin) => (
                    <button
                      key={coin}
                      className="glow-btn"
                      style={{
                        ...S.chip,
                        border: "none",
                        ...(activeCoin === coin ? S.chipActive : {}),
                        fontFamily: T.sans,
                      }}
                      onClick={() => setActiveCoin((prev) => prev === coin ? "" : coin)}
                    >
                      {coin}
                    </button>
                  ))}

                  {/* Expandable search */}
                  <div
                    ref={searchWrapRef}
                    className="glow-btn"
                    style={{ ...S.searchWrap, ...(searchOpen ? S.searchWrapOpen : {}) }}
                    onClick={() => !searchOpen && setSearchOpen(true)}
                  >
                    <svg
                      style={{
                        width: 13, height: 13,
                        color: "rgba(255,255,255,0.35)",
                        flexShrink: 0,
                        opacity: searchOpen ? 0 : 1,
                        transition: "opacity 0.15s",
                      }}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}
                    >
                      <circle cx="6.5" cy="6.5" r="4" />
                      <path d="M10 10l3 3" strokeLinecap="round" />
                    </svg>
                    <input
                      ref={searchInputRef}
                      value={filterCoin}
                      onChange={(e) => setFilterCoin(e.target.value)}
                      placeholder=""
                      style={{
                        position: "absolute", left: "10px", top: 0, bottom: 0,
                        width: "calc(100% - 16px)",
                        background: "none", border: "none", outline: "none",
                        fontFamily: T.sans, fontSize: "13px", color: color.text,
                        opacity: searchOpen ? 1 : 0,
                        pointerEvents: searchOpen ? "all" : "none",
                        transition: "opacity 0.15s",
                      }}
                    />
                  </div>
                </div>

                {/* Segmented control */}
                <div style={{ flexShrink: 0 }}>
                  <div style={S.segCtrl}>
                    {(["all", "LONG", "SHORT", "FLAT"] as const).map((dir) => (
                      <button
                        key={dir}
                        className="glow-btn"
                        style={{
                          ...S.segBtn,
                          ...(filterDir === dir ? S.segBtnActive : {}),
                          fontFamily: T.sans,
                        }}
                        onClick={() => setFilterDir(dir)}
                      >
                        {dir === "all" ? "ALL" : dir}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Signal list */}
              <div style={S.feedScroll}>
                {!data ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} style={{ ...S.sigRow, animation: "slide-up-ghost 2.4s ease-in-out infinite" }}>
                      <div style={{ height: 18, width: 76, borderRadius: radius.dirPill, background: "rgba(255,255,255,0.06)" }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <div style={{ height: 10, width: "50%", borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)" }} />
                        <div style={{ height: 8,  width: "70%", borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)" }} />
                      </div>
                      <div style={{ height: 10, width: 48, borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
                      <div style={{ height: 20, width: 28, borderRadius: radius.skeleton, background: "rgba(255,255,255,0.06)" }} />
                    </div>
                  ))
                ) : filtered.length === 0 ? (
                  <div style={{ padding: "48px", textAlign: "center", ...S.muted }}>No signals match your filters</div>
                ) : (
                  filtered.map((sig, i) => (
                    <SignalRow key={`${sig.detected_at}-${sig.recipe_id}-${sig.coin}-${i}`} sig={sig} />
                  ))
                )}

                {/* Infinite scroll sentinel */}
                {data && filtered.length > 0 && (
                  <div ref={sentinelRef} style={S.scrollFooter}>
                    {isFetching ? "scroll for more" : hasMore ? " " : "all signals loaded"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
