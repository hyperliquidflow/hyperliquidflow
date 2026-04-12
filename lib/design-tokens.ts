/**
 * lib/design-tokens.ts
 *
 * Single source of truth for all visual design tokens.
 * Extracted 1:1 from public/layouts/layout-3-siderail.html.
 *
 * Usage:
 *   import { color, type, space, radius, shadow, effect, layout, anim } from "@/lib/design-tokens";
 *
 *   style={{ background: color.card, borderRadius: radius.card, ...shadow.card }}
 */

// ─────────────────────────────────────────────────────────────────────────────
// COLOR
// ─────────────────────────────────────────────────────────────────────────────

export const color = {
  // Base
  bg:          "#060606",
  text:        "#f0f0f0",
  textMuted:   "rgba(255,255,255,0.38)",
  textDim:     "rgba(255,255,255,0.28)",
  textFaint:   "rgba(255,255,255,0.22)",

  // Semantic
  green:       "#6aaa7a",
  red:         "#b06868",
  amber:       "#f59e0b",
  blue:        "#60a5fa",
  purple:      "#c084fc",
  mint:        "rgba(151,253,229,0.85)",

  // Surface
  card:        "rgba(12,12,12,0.7)",
  cardHover:   "rgba(18,18,18,0.7)",
  nav:         "rgba(8,8,8,0.8)",
  navActivebg: "rgba(151,253,229,0.05)",
  strip:       "rgba(255,255,255,0.03)",   // market ticker strip bg

  // Border
  border:      "rgba(255,255,255,0.07)",
  borderFaint: "rgba(255,255,255,0.05)",
  borderHover: "rgba(255,255,255,0.12)",
  navActive:   "rgba(151,253,229,0.7)",    // active nav left-border

  // Signal direction pills
  longBg:      "rgba(106,170,122,0.1)",
  longBorder:  "rgba(106,170,122,0.2)",
  shortBg:     "rgba(176,104,104,0.1)",
  shortBorder: "rgba(176,104,104,0.2)",

  // Regime chip (bullish)
  regimeBg:    "rgba(106,170,122,0.08)",
  regimeBorder:"rgba(106,170,122,0.2)",

  // Heatmap bars
  hmLong:      "rgba(106,170,122,0.5)",
  hmShort:     "rgba(176,104,104,0.5)",
  hmQuiet:     "rgba(255,255,255,0.09)",

  // Misc fills
  tagBg:       "rgba(255,255,255,0.06)",   // coin tag chip
  tagText:     "rgba(255,255,255,0.7)",
  barBg:       "rgba(255,255,255,0.06)",   // wallet/coin progress bar track
  divider:     "rgba(255,255,255,0.04)",   // row separator
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TYPOGRAPHY
// ─────────────────────────────────────────────────────────────────────────────

export const type = {
  // Font families
  sans: "'Inter', system-ui, sans-serif",
  mono: "'Geist Mono', monospace",

  // Page header
  pageTitle:    { fontSize: "26px", fontWeight: 700, color: color.text },
  pageSubtitle: { fontSize: "14px", color: color.textMuted, marginTop: "4px" },

  // Card header label
  cardTitle: {
    fontSize: "13px", fontWeight: 600,
    letterSpacing: "0.06em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.5)",
  },
  cardLink: {
    marginLeft: "auto", fontSize: "13px",
    color: color.textDim, textDecoration: "none",
  },

  // Stat card
  statLabel: {
    fontSize: "12px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.38)",
  },
  statValue: {
    fontSize: "31px", fontWeight: 700,
    lineHeight: 1, fontVariantNumeric: "tabular-nums",
    marginTop: "10px",
  },
  statSub: { fontSize: "13px", color: "rgba(255,255,255,0.32)", marginTop: "6px" },

  // Signal row
  sigNum:  { fontSize: "12px", color: "rgba(255,255,255,0.2)", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" },
  sigName: { fontSize: "16px", fontWeight: 600, color: color.text },
  sigSub:  { fontSize: "13px", color: "rgba(255,255,255,0.36)", marginTop: "2px" },
  sigCoinTag: {
    fontSize: "13px", fontWeight: 700,
    padding: "2px 8px", borderRadius: "5px",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.7)",
  },
  sigDir: { fontSize: "12px", fontWeight: 700, padding: "3px 9px", borderRadius: "4px", letterSpacing: "0.04em" },
  sigEv:  { fontSize: "13px", color: "rgba(255,255,255,0.35)", textAlign: "right" as const, width: "46px" },

  // Wallet row
  walletRank:     { fontSize: "12px", color: "rgba(255,255,255,0.22)" },
  walletScore:    { fontSize: "17px", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  walletAddr:     { fontFamily: "'Geist Mono', monospace", fontSize: "13px", color: "rgba(156,163,175,0.8)", marginTop: "4px" },

  // Nav
  navSectionLabel: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.22)", padding: "20px 20px 6px",
  },
  navItem:   { fontSize: "14px", fontWeight: 500, color: "rgba(255,255,255,0.42)" },
  navActive: { color: color.text },

  // Market ticker strip
  coinName:   { fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.38)", textTransform: "uppercase" as const },
  coinPrice:  { fontSize: "15px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color.text, marginTop: "3px", whiteSpace: "nowrap" as const },
  coinChange: { fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" as const },

  // Live footer
  liveText: { fontSize: "13px", color: "rgba(255,255,255,0.5)" },
  liveTime: { fontSize: "12px", color: "rgba(255,255,255,0.28)", marginTop: "4px" },

  // Heatmap labels
  heatmapLabel: {
    fontSize: "10px", fontWeight: 500,
    color: "rgba(255,255,255,0.22)", letterSpacing: "0.04em",
  },

  // Regime timeline
  regimeDayLabel: {
    fontSize: "9px", fontWeight: 700,
    letterSpacing: "0.06em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.25)",
  },
  regimeDayType: {
    fontSize: "9px", fontWeight: 700,
    letterSpacing: "0.04em", textTransform: "uppercase" as const,
    marginTop: "3px",
  },

  // Coin exposure
  coinRowName: { fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" },
  coinPct:     { fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.38)", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" },

  // Regime chip
  regimeChipLabel: { fontSize: "16px", fontWeight: 700, color: color.green },
  regimeChipMeta:  { fontSize: "12px", color: "rgba(255,255,255,0.36)", marginTop: "1px" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SPACING  (all from prototype; px values, use directly)
// ─────────────────────────────────────────────────────────────────────────────

export const space = {
  // Page
  pagePaddingTop:    "28px",  // main-header top
  pagePaddingX:      "32px",
  contentPaddingTop: "20px",
  contentPaddingBot: "32px",

  // Card internals
  cardHeaderPadding: "14px 20px",
  cardBodyPadding:   "20px",

  // Row gaps
  statGap:  "12px",
  cardGap:  "16px",    // gap between cards in a section
  rowGap:   "16px",    // margin-bottom between sections

  // Signal / wallet rows
  sigRowPadding:    "12px 20px",
  walletItemPadding:"14px 20px",

  // Market ticker
  stripMarginTop: "20px",
  coinPadding:    "14px 18px",
  coinGap:        "14px",

  // Nav
  navPaddingTop:   "24px",
  navItemPadding:  "10px 20px",
  navLogoPadding:  "0 20px 24px",
  navFooterPadding:"18px 0",

  // Heatmap
  heatmapWrapPadding: "14px 20px 12px",
  heatmapBarGap:      "3px",
  heatmapBarHeight:   "56px",
  heatmapLabelTop:    "7px",

  // Regime track
  regimeTrackPadding: "18px 20px 20px",
  regimeDotBottom:    "7px",

  // Coin exposure
  exposurePadding: "12px 20px 18px",
  exposureGap:     "11px",

  // Misc
  statValueTop: "10px",
  statSubTop:   "6px",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BORDER RADIUS
// ─────────────────────────────────────────────────────────────────────────────

export const radius = {
  card:     "12px",
  regimeChip: "10px",
  strip:    "12px",    // market ticker strip
  tag:      "5px",     // coin tag chip
  dirPill:  "4px",     // LONG/SHORT direction pill
  bar:      "2px",     // heatmap bars, progress bars
  barFill:  "2px",
  dot:      "50%",
  navItem:  "0",       // nav items use border-left, not border-radius
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW
// ─────────────────────────────────────────────────────────────────────────────

export const shadow = {
  card:     { boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  regimeChip: {},   // no box-shadow; uses border + bg only
  liveDot:  { boxShadow: `0 0 6px ${color.green}` },
  hmCurrent:{ boxShadow: "0 0 10px rgba(106,170,122,0.4)" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// EFFECTS (backdrop-filter, blur, gradients)
// ─────────────────────────────────────────────────────────────────────────────

export const effect = {
  // Frosted glass — used on cards, strip, nav
  glass: {
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
  } as React.CSSProperties,
  glassNav: {
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  } as React.CSSProperties,

  // Background — fixed full-viewport aura + grain
  bgAura: `
    radial-gradient(ellipse at 100% 100% in oklch,
      oklch(32%  0.06  170)  0%,
      oklch(25%  0.045 170) 18%,
      oklch(20%  0.032 170) 32%,
      oklch(15%  0.022 170) 45%,
      oklch(12%  0.014 170) 57%,
      oklch(8%   0.008 170) 68%,
      oklch(6%   0.004 170) 78%,
      oklch(3.5% 0     0)  100%),
    radial-gradient(ellipse at 100% 100% in oklab,
      oklch(16%  0.04  170)  0%,
      oklch(3.5% 0     0)  100%)
  `,
  bgGrainOpacity: 0.22,  // opacity on the grain overlay div
  bgGrainSvg: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'%3E%3Cfilter id='n' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.90' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.15'/%3E%3C/svg%3E")`,

  // Shimmer on hover (cursor-responsive, needs GlowInit)
  shimmer: `radial-gradient(
    circle at var(--gx, 50%) var(--gy, 50%),
    rgba(235,235,235,0.13) 0%, rgba(200,200,200,0.06) 35%, transparent 65%
  )`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT
// ─────────────────────────────────────────────────────────────────────────────

export const layout = {
  // Side nav
  navWidth:    "200px",

  // Grid templates
  statCols:     "repeat(4, 1fr)",   // 4 stat cards
  twoCols:      "3fr 2fr",          // signals (3fr) + wallets (2fr)
  bottomCols:   "1fr 1fr",          // regime history + coin exposure
  marketCols:   "repeat(4, 1fr)",   // 4 market ticker coins
  sigRowCols:   "28px 1fr auto auto auto",  // # | name+sub | tag | dir | ev
  coinRowCols:  "38px 1fr 40px",    // name | bar | pct%
  walletBarHeight: "2px",
  heatmapBarHeight:"56px",
  coinBarHeight: "4px",

  // Breakpoint at which sidenav collapses
  mobileBreak: "768px",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION
// ─────────────────────────────────────────────────────────────────────────────

export const anim = {
  glowPulse: "glow-pulse 2s ease-in-out infinite",
  barPulse:  "bar-pulse 2s ease-in-out infinite",

  // Transition shorthands
  card:   "border-color 0.2s, background 0.2s",
  nav:    "color 0.15s, border-color 0.15s",
  row:    "background 0.12s",
  walletBar: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
  coinBar:   "width 0.65s cubic-bezier(0.22, 1, 0.36, 1)",
  shimmer: "opacity 0.9s ease-out",
  shimmerIn: "opacity 0.12s ease-in",

  // Logo stagger per-char delay increment
  logoStaggerMs: 18,
  logoSpring: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.25s",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE HELPERS
// Commonly combined token sets — use spread to apply.
// ─────────────────────────────────────────────────────────────────────────────

export const card = {
  base: {
    background:  color.card,
    border:      `1px solid ${color.border}`,
    borderRadius: radius.card,
    overflow:    "hidden" as const,
    ...effect.glass,
    ...shadow.card,
  },
  header: {
    padding:      space.cardHeaderPadding,
    borderBottom: `1px solid ${color.borderFaint}`,
    display:      "flex",
    alignItems:   "center",
  },
  hover: {
    borderColor: color.borderHover,
    background:  color.cardHover,
  },
} as const;

export const row = {
  sig: {
    display:             "grid",
    gridTemplateColumns: layout.sigRowCols,
    alignItems:          "center",
    gap:                 "12px",
    padding:             space.sigRowPadding,
    borderBottom:        `1px solid ${color.divider}`,
    transition:          anim.row,
    cursor:              "default",
  },
  wallet: {
    padding:      space.walletItemPadding,
    borderBottom: `1px solid ${color.divider}`,
    transition:   anim.row,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// React import needed for React.CSSProperties in effect.glass
// ─────────────────────────────────────────────────────────────────────────────
import type React from "react";
