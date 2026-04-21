/**
 * lib/design-tokens.ts
 *
 * Single source of truth for all visual design tokens.
 *
 * v2 changes (2026-04-13):
 *   color.red    updated to #c92435
 *   color.amber  updated to #c4925a
 *   color.mint   renamed to color.accent = #50d2c1
 *   color.blue   removed
 *   color.purple removed
 *   type.sans    Inter replaced with DM Sans
 *   Type scale   consolidated from 10 sizes to 5 sizes: 11 / 13 / 16 / 26 / 32px
 *
 * Usage:
 *   import { color, type, space, radius, shadow, effect, layout, anim, card, row } from "@/lib/design-tokens";
 *
 *   style={{ background: color.card, borderRadius: radius.card, ...shadow.card }}
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BRAND IDENTITY RULES
 * These rules live here because this file is read before any visual output.
 * They are inviolable. Violating them has caused multiple regressions.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. WORDMARK IS ALWAYS MONOCHROME
 *    HYPERLIQUIDFLOW renders in color.text (#f0f0f0) on dark backgrounds only.
 *    Never split-color. Never apply color.accent, color.green, color.red, or
 *    any semantic token to any letter, syllable, or portion of the wordmark.
 *    "FLOW" is not a live-state indicator. It is part of the wordmark. No color.
 *    No <span> wrappers. No gradient text. One color. Always #f0f0f0.
 *
 * 2. NO DECORATIVE LINES OR RULES
 *    No gradient rules, teal dividers, glow strokes, or underlines adjacent to
 *    the wordmark or section headers. These patterns come from training data,
 *    not this brand. They do not exist here. If a separator is needed anywhere
 *    in the layout, use `1px solid color.border` or `1px solid color.borderFaint`.
 *    That is all that is permitted.
 *
 * 3. color.accent SCOPE — strictly limited to:
 *    Active nav left-border + background tint | Pulsing live indicator dot |
 *    KV/online status badges | Cron-status chips | Code highlight borders in
 *    print documents.
 *    color.accent is NOT a brand highlight for headings, logos, or decorative
 *    geometry. Before using color.accent for anything outside the list above,
 *    stop and ask the user.
 *
 * 4. PDF / PRINT BACKGROUND RENDERING
 *    Use puppeteer with printBackground: true (scripts/generate-whitepaper-pdf.mjs).
 *    The Chrome --print-to-pdf CLI flag does not reliably respect
 *    print-color-adjust: exact and strips dark backgrounds, producing broken
 *    cover pages. Never use the CLI flag for final PDF output.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// COLOR

export const color = {
  // Base
  bg:          "#060606",
  text:        "#f0f0f0",
  textMuted:   "rgba(255,255,255,0.38)",
  textDim:     "rgba(255,255,255,0.28)",
  textFaint:   "rgba(255,255,255,0.22)",

  // Semantic
  green:       "#6aaa7a",
  red:         "#c92435",
  amber:       "#c4925a",
  accent:      "#50d2c1",   // teal accent, active states, nav, live indicators

  // Surface
  card:        "rgba(12,12,12,0.7)",
  cardHover:   "rgba(18,18,18,0.7)",
  nav:         "rgba(8,8,8,0.8)",
  navActivebg: "rgba(80,210,193,0.05)",
  strip:       "rgba(255,255,255,0.03)",   // market ticker strip bg

  // Border
  border:      "rgba(255,255,255,0.07)",
  borderFaint: "rgba(255,255,255,0.05)",
  borderHover: "rgba(255,255,255,0.12)",
  navActive:   "rgba(80,210,193,0.7)",     // active nav left-border

  // Signal direction pills
  longBg:      "rgba(106,170,122,0.1)",
  longBorder:  "rgba(106,170,122,0.2)",
  shortBg:     "rgba(201,36,53,0.1)",
  shortBorder: "rgba(201,36,53,0.2)",

  // Regime chip (bullish)
  regimeBg:    "rgba(106,170,122,0.08)",
  regimeBorder:"rgba(106,170,122,0.2)",

  // Heatmap bars
  hmLong:      "rgba(106,170,122,0.5)",
  hmShort:     "rgba(201,36,53,0.5)",
  hmQuiet:     "rgba(255,255,255,0.09)",

  // SVG chart canvases (Coinglass-style deep navy/purple)
  svgCanvas:   "#050510",
  svgPlotBg:   "#0b0818",

  // Neutral / gray — FLAT direction, SCALE IN/OUT/FLIP pills, loading states
  neutral:       "#9ca3af",
  neutralBg:     "rgba(156,163,175,0.08)",
  neutralBorder: "rgba(156,163,175,0.19)",

  // Row hover — very faint lift on table rows
  rowHover:    "rgba(180,180,180,0.03)",

  // Misc fills
  tagBg:       "rgba(255,255,255,0.06)",   // coin tag chip
  tagText:     "rgba(255,255,255,0.7)",
  barBg:       "rgba(255,255,255,0.06)",   // wallet/coin progress bar track
  divider:     "rgba(255,255,255,0.04)",   // row separator

  // Form inputs
  inputBg:     "rgba(255,255,255,0.06)",   // text input / select / textarea background
  inputBorder: "rgba(255,255,255,0.1)",    // input border (more prominent than card border)
} as const;

// TYPOGRAPHY
// 5-size scale: 11px micro / 13px small / 16px body / 26px title / 32px display

export const type = {
  // Font families
  sans: "'DM Sans', system-ui, sans-serif",
  mono: "'Geist Mono', monospace",

  // Page header
  pageTitle:    { fontSize: "26px", fontWeight: 700, color: color.text },
  pageSubtitle: { fontSize: "13px", color: color.textMuted, marginTop: "4px" },

  // Card header label
  cardTitle: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.4)",
  },
  cardLink: {
    marginLeft: "auto", fontSize: "13px",
    color: color.textDim, textDecoration: "none",
  },

  // Stat card
  statLabel: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.38)",
  },
  statValue: {
    fontSize: "32px", fontWeight: 700,
    lineHeight: 1, fontVariantNumeric: "tabular-nums",
    marginTop: "10px",
  },
  statSub: { fontSize: "13px", color: "rgba(255,255,255,0.32)", marginTop: "6px" },

  // Signal row
  sigNum:  { fontSize: "11px", color: "rgba(255,255,255,0.2)", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" },
  sigName: { fontSize: "16px", fontWeight: 600, color: color.text },
  sigSub:  { fontSize: "13px", color: "rgba(255,255,255,0.36)", marginTop: "2px" },
  sigCoinTag: {
    fontSize: "13px", fontWeight: 700,
    padding: "2px 8px", borderRadius: "5px",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.7)",
  },
  sigDir: { fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "4px", letterSpacing: "0.04em" },
  sigEv:  { fontSize: "13px", color: "rgba(255,255,255,0.35)", textAlign: "right" as const, width: "46px" },

  // Wallet row
  walletRank:  { fontSize: "11px", color: "rgba(255,255,255,0.22)" },
  walletScore: { fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  // walletAddr: userSelect text is intentional — addresses must be copyable
  walletAddr:  { fontFamily: "'Geist Mono', monospace", fontSize: "13px", color: "rgba(156,163,175,0.8)", marginTop: "4px", userSelect: "text" as const, cursor: "text" as const },

  // Nav
  navSectionLabel: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.22)", padding: "20px 20px 6px",
  },
  navItem:   { fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.42)" },
  navActive: { color: color.text },

  // Market ticker strip
  coinName:   { fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.38)", textTransform: "uppercase" as const },
  coinPrice:  { fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color.text, marginTop: "3px", whiteSpace: "nowrap" as const },
  coinChange: { fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" as const },

  // Live footer
  liveText: { fontSize: "13px", color: "rgba(255,255,255,0.5)" },
  liveTime: { fontSize: "11px", color: "rgba(255,255,255,0.28)", marginTop: "4px" },

  // Heatmap labels
  heatmapLabel: {
    fontSize: "11px", fontWeight: 500,
    color: "rgba(255,255,255,0.22)", letterSpacing: "0.04em",
  },

  // Regime timeline
  regimeDayLabel: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.06em", textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.25)",
  },
  regimeDayType: {
    fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.04em", textTransform: "uppercase" as const,
    marginTop: "3px",
  },

  // Coin exposure
  coinRowName: { fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" },
  coinPct:     { fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.38)", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" },

  // Regime chip
  regimeChipLabel: { fontSize: "16px", fontWeight: 700, color: color.green },
  regimeChipMeta:  { fontSize: "13px", color: "rgba(255,255,255,0.36)", marginTop: "1px" },
} as const;

// SPACING  (px values, use directly)

export const space = {
  // Page
  pagePaddingTop:    "28px",
  pagePaddingX:      "32px",
  contentPaddingTop: "20px",
  contentPaddingBot: "32px",

  // Card internals
  cardHeaderPadding: "14px 20px",
  cardBodyPadding:   "20px",

  // Row gaps
  statGap:  "12px",
  cardGap:  "16px",
  rowGap:   "16px",

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

// BORDER RADIUS

export const radius = {
  card:       "12px",
  regimeChip: "10px",
  strip:      "12px",
  tag:        "5px",
  dirPill:    "4px",
  input:      "6px",
  skeleton:   "3px",
  bar:        "2px",
  barFill:    "2px",
  dot:        "50%",
  navItem:    "0",
} as const;

// SHADOW

export const shadow = {
  card:       { boxShadow: "0 2px 20px rgba(0,0,0,0.4)" },
  regimeChip: {},
  liveDot:    { boxShadow: `0 0 6px ${color.green}` },
  hmCurrent:  { boxShadow: "0 0 10px rgba(106,170,122,0.4)" },
} as const;

// EFFECTS

export const effect = {
  // Frosted glass, used on cards, strip, nav
  glass: {
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
  } as React.CSSProperties,
  glassNav: {
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  } as React.CSSProperties,

  // Background: fixed full-viewport aura + grain
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
  bgGrainOpacity: 0.22,
  bgGrainSvg: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'%3E%3Cfilter id='n' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.90' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.15'/%3E%3C/svg%3E")`,

  // Shimmer on hover (cursor-responsive, needs GlowInit + className="glow-btn")
  shimmer: `radial-gradient(
    circle at var(--gx, 50%) var(--gy, 50%),
    rgba(235,235,235,0.13) 0%, rgba(200,200,200,0.06) 35%, transparent 65%
  )`,
} as const;

// LAYOUT

export const layout = {
  navWidth:    "200px",

  // Z-index stack — always use these, never invent a z-index
  zIndex: {
    bg:          0,    // background aura / grain
    content:     1,    // main page content
    navBackdrop: 99,   // mobile nav overlay backdrop
    navRail:     100,  // mobile nav slide-in rail
    hamburger:   200,  // mobile hamburger button (must clear nav rail)
    popup:       1000, // portal popups / tooltips rendered at document.body
  },

  statCols:     "repeat(4, 1fr)",
  twoCols:      "3fr 2fr",
  bottomCols:   "1fr 1fr",
  marketCols:   "repeat(4, 1fr)",
  sigRowCols:   "28px 1fr auto auto auto",
  coinRowCols:  "38px 1fr 40px",
  walletBarHeight: "2px",
  heatmapBarHeight:"56px",
  coinBarHeight: "4px",

  mobileBreak: "768px",
} as const;

// ANIMATION

export const anim = {
  glowPulse: "glow-pulse 2s ease-in-out infinite",
  barPulse:  "bar-pulse 2s ease-in-out infinite",

  card:   "border-color 0.2s, background 0.2s",
  nav:    "color 0.15s, border-color 0.15s",
  row:    "background 0.12s",
  walletBar: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
  coinBar:   "width 0.65s cubic-bezier(0.22, 1, 0.36, 1)",
  shimmer: "opacity 0.9s ease-out",
  shimmerIn: "opacity 0.12s ease-in",

  logoStaggerMs: 18,
  logoSpring: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.25s",
} as const;

// COMPOSITE HELPERS
// Commonly combined token sets, use spread to apply.

// Page header — consistent top spacing across all pages.
// Every page must use this composite for its header container.
// The overview and other fixed-height layouts rely on this value being stable.
export const pageHeader = {
  container: {
    padding: `${space.pagePaddingTop} ${space.pagePaddingX} 0`,
  },
  title: {
    ...type.pageTitle,
    margin: 0,
  },
  subtitle: {
    ...type.pageSubtitle,
  },
} as const;

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

// SKELETON / LOADING STATES
// Standard ghost bone used across all loading skeletons.
// Apply width/height per use; everything else is fixed.

export const skeleton = {
  bone: {
    background:   "rgba(255,255,255,0.07)",
    borderRadius: radius.skeleton,
    flexShrink:   0 as const,
  },
  // Animated variant — pair with globals.css slide-up-ghost keyframe
  animated: {
    background:   "rgba(255,255,255,0.07)",
    borderRadius: radius.skeleton,
    flexShrink:   0 as const,
    animation:    "slide-up-ghost 2.4s ease-in-out infinite",
  },
} as const;

// SIGNAL TYPE COLORS
// Used exclusively for the signal type pill in the feed.
// Gray = directionally neutral (SCALE IN, SCALE OUT, FLIP).
// Labels: underscores are stripped at render time via SIGNAL_TYPE_LABEL map.

export const signal = {
  entry:    "#6aaa7a",   // color.green
  exit:     "#c92435",   // color.red
  scaleIn:  "#9ca3af",   // neutral gray
  scaleOut: "#9ca3af",   // neutral gray
  flip:     "#9ca3af",   // neutral gray
  alert:    "#c4925a",   // color.amber
  neutral:  "#9ca3af",   // fallback
} as const;

// SELECTION CONTROL
// Everything is non-selectable by default (set in globals.css).
// Apply selectable.on to wallet addresses and financial values that must be copyable.
// The globals.css also catches [style*="Geist Mono"] and [style*="tabular-nums"] automatically,
// so walletAddr and statValue already qualify. Use selectable.on for anything else.

export const selectable = {
  on:  { userSelect: "text" as const, cursor: "text" as const },
  off: { userSelect: "none" as const, cursor: "default" as const },
} as const;

// CHECKBOX
// Custom styled checkbox. Render a visually-hidden native <input type="checkbox">
// alongside a <div style={checked ? checkbox.boxChecked : checkbox.box}> for the
// visual indicator, wrapped in a <label style={checkbox.wrap}>.

export const checkbox = {
  wrap: {
    display:    "flex",
    alignItems: "center",
    gap:        "8px",
    cursor:     "pointer",
    userSelect: "none",
  } as React.CSSProperties,
  box: {
    width:          "14px",
    height:         "14px",
    borderRadius:   radius.tag,
    border:         `1px solid ${color.inputBorder}`,
    background:     color.inputBg,
    flexShrink:     0 as const,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    transition:     "border-color 0.15s, background 0.15s",
  } as React.CSSProperties,
  boxChecked: {
    width:          "14px",
    height:         "14px",
    borderRadius:   radius.tag,
    border:         `1px solid ${color.borderHover}`,
    background:     "rgba(255,255,255,0.10)",
    flexShrink:     0 as const,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    transition:     "border-color 0.15s, background 0.15s",
  } as React.CSSProperties,
  label: {
    fontSize: "13px",
    color:    "rgba(255,255,255,0.7)",
  } as React.CSSProperties,
} as const;

// React import needed for React.CSSProperties in effect.glass
import type React from "react";
