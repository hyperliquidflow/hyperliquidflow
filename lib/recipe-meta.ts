// lib/recipe-meta.ts
// Single source of truth for signal recipe labels and descriptions.
// Rule: descriptions must exactly match agent_config thresholds. Update atomically.
// Used by: app/page.tsx, app/signals/feed/FeedClient.tsx, app/OverviewClient.tsx,
//          app/signals/performance/PerformanceClient.tsx

export const RECIPE_META: Record<string, { label: string; desc: string }> = {
  momentum_stack: {
    label: "Whale Convergence",
    desc:  "3+ wallets add $500K+ (BTC/ETH) | $250K+ (SOL/HYPE) | $100K+ (alts) same direction inside the current detection window",
  },
  divergence_squeeze: {
    label: "Silent Loading",
    desc:  "3+ smart money wallets loading same coin while price flat <0.5% and margin thin",
  },
  accumulation_reentry: {
    label: "Dip Conviction",
    desc:  "High-score wallet re-enters after coin drops past its volatility-scaled drawdown threshold from the 4h high",
  },
  rotation_carry: {
    label: "Funding Carry",
    desc:  "New position in positive-funding perp with >0.03%/hr funding. Net win-rate filter activates after 10 graded signals.",
  },
  funding_divergence: {
    label: "Smart Money vs. Retail",
    desc:  "Smart Money bias opposite to funding-implied retail bias, funding >0.05%/hr",
  },
  whale_validated: {
    label: "Multi Wallet Confirmation",
    desc:  "Signal confirmed by 3+ high-score wallets (score 0.75+) with fresh position activity",
  },
};
