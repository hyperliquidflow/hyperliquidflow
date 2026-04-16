// lib/recipe-meta.ts
// Single source of truth for signal recipe labels and descriptions.
// Rule: descriptions must exactly match agent_config thresholds. Update atomically.
// Used by: app/page.tsx, app/signals/feed/FeedClient.tsx, app/OverviewClient.tsx,
//          app/signals/performance/PerformanceClient.tsx

export const RECIPE_META: Record<string, { label: string; desc: string }> = {
  momentum_stack: {
    label: "Whale Convergence",
    desc:  "3+ wallets add $500K+ (BTC/ETH) | $250K+ (SOL/HYPE) | $100K+ (alts) same direction in under 5 min",
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
    label: "Funded Edge",
    desc:  "New position in positive-funding perp with >0.03%/hr funding. Win-rate filter activates after 10 signals.",
  },
  liq_rebound: {
    label: "Liquidation Flush",
    desc:  "Smart Money exposure drops sharply with price move, possible cascade (approx.)",
  },
  streak_continuation: {
    label: "Hot Streak",
    desc:  "3+ trade win streak with Sharpe proxy above 0.6",
  },
  funding_divergence: {
    label: "Smart Money vs. Retail",
    desc:  "Smart Money bias opposite to funding-implied retail bias, funding >0.05%/hr",
  },
  whale_validated: {
    label: "Alpha Confirmation",
    desc:  "Signal confirmed by 3+ high-score wallets (score 0.75+) with fresh position activity",
  },
  anti_whale_trap: {
    label: "Smart Exit Signal",
    desc:  "High-score wallet cutting 20%+ exposure with low regime fit",
  },
  position_aging: {
    label: "Patience Trap",
    desc:  "High-score wallet holding losing position 2+ cycles without reducing (re-alerts after 4h)",
  },
  concentration_risk: {
    label: "Crowded Coin",
    desc:  "60%+ of cohort notional concentrated in one coin (70%+ for ETH)",
  },
  wallet_churn: {
    label: "Coordinated Exit",
    desc:  "3+ wallets reducing same position, $500K+ (BTC/ETH) | $250K+ (SOL/HYPE) | $100K+ (alts) combined",
  },
  funding_trend: {
    label: "Funding Surge",
    desc:  "Funding rate rising 3+ consecutive cycles above 0.03%/hr, longs overextended",
  },
  bridge_inflow: {
    label: "Capital Inflow",
    desc:  "Tracked whale bridged $100K+ into Hyperliquid",
  },
  twap_accumulation: {
    label: "Whale TWAP Active",
    desc:  "Tracked whale running an active TWAP order",
  },
};
