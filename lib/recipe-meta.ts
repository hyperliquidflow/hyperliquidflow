// lib/recipe-meta.ts
// Single source of truth for signal recipe labels and descriptions.
// Used by: app/page.tsx, app/signals/page.tsx, app/edge/page.tsx

export const RECIPE_META: Record<string, { label: string; desc: string }> = {
  momentum_stack:       { label: "Whale Convergence",      desc: "8+ wallets add $500K+ same direction in under 5 min" },
  divergence_squeeze:   { label: "Silent Loading",          desc: "Exposure rising, price flat, liq buffer below 15%" },
  accumulation_reentry: { label: "Dip Conviction",          desc: "High-score wallets re-enter after 8%+ drawdown in 4h" },
  rotation_carry:       { label: "Funded Edge",             desc: "New position in positive-funding perp with 60%+ hist win rate" },
  liq_rebound:          { label: "Liquidation Flush",       desc: "Smart Money exposure drops sharply, possible cascade (approx.)" },
  streak_continuation:  { label: "Hot Streak",              desc: "5+ trade win streak with Sharpe proxy above 0.6" },
  funding_divergence:   { label: "Smart Money vs. Retail",  desc: "Smart Money and non-Smart Money OI diverge with extreme funding" },
  whale_validated:      { label: "Alpha Confirmation",      desc: "Signal confirmed by 3+ high-score wallets" },
  anti_whale_trap:      { label: "Smart Exit Signal",       desc: "High-score wallet rapidly cutting exposure in adverse Market Vibes" },
  position_aging:       { label: "Patience Trap",           desc: "High-score wallet holding losing position for 2+ cycles without reducing" },
  concentration_risk:   { label: "Crowded Coin",            desc: "60%+ of cohort notional in one coin" },
  wallet_churn:         { label: "Coordinated Exit",        desc: "3+ wallets reducing same position, $500K+ combined" },
  funding_trend:        { label: "Funding Surge",           desc: "Funding rate rising 3+ cycles, longs overextended" },
};
