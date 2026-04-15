# Sprint 8 — Wallet Detail Page

**Date:** 2026-04-15  
**Status:** Ready when Sprint 7 complete  
**Depends on:** Sprint 7 (Allium data layer, new backtest columns)  
**Blocks:** Sprint 5 (Wallet Alerts requires a proper wallet profile page)

---

## Goal

Replace the inline wallet panel in the Discovery page with a dedicated `/wallets/[address]` route. Surface the Allium-enhanced scoring data on this page: 30d vs 90d performance comparison, regime breakdown, liquidation rate, divergence flag, and annotated trade history. Give each wallet a shareable URL.

---

## Current State

**Before writing any code, read:**
- `app/wallets/discovery/DiscoveryClient.tsx` — the inline panel currently lives here. The `fetchWalletProfile` function calls `/api/wallet-profile`. The panel is triggered by `openLookup(address)`.
- `app/api/wallet-profile/route.ts` — understand what data this route currently returns before extending it.
- `lib/design-tokens.ts` — all style values must come from here. Read it before writing any JSX.
- `components/nav.tsx` — to add the new route to the nav if needed.

---

## Route

`/wallets/[address]` — Next.js dynamic route.

File: `app/wallets/[address]/page.tsx` — async server component. Fetches wallet data server-side for first paint (no skeleton needed).

**URL format:** `/wallets/0xabc123...def456`

The Discovery page inline panel is replaced with a link: clicking a wallet address navigates to `/wallets/{address}` instead of opening the panel. The panel component can be removed once the page is live.

---

## API Route Extension: `GET /api/wallet-profile`

**Before modifying this route, read its current implementation in full.**

Extend the response to include the new Allium-backed fields when available. Existing fields must not change shape (backwards-compatible).

New fields added to response (all nullable — wallets without Allium data return null):

```json
{
  "address": "0x...",
  "overall_score": 0.74,
  "equity_tier": "Elite",
  "win_rate": 0.68,
  "trade_count": 47,
  "realized_pnl_30d": 142000,
  "open_positions": [...],
  "fill_history": [...],

  "score_30d": 0.74,
  "score_90d": 0.81,
  "divergence_score": 0.12,
  "divergence_direction": "improving",
  "liquidation_rate": 0.04,
  "regime_performance": {
    "BULL":    { "win_rate": 0.71, "sharpe_proxy": 0.82, "trade_count": 34 },
    "BEAR":    { "win_rate": 0.55, "sharpe_proxy": 0.41, "trade_count": 18 },
    "RANGING": { "win_rate": 0.63, "sharpe_proxy": 0.59, "trade_count": 22 }
  },
  "backtest_source": "allium"
}
```

`divergence_direction`:
- `"improving"` if `score_30d > score_90d` by more than 0.1
- `"deteriorating"` if `score_30d < score_90d` by more than 0.1
- `"stable"` otherwise

---

## Page Layout

**Before writing any JSX, read `lib/design-tokens.ts` in full.** Use inline style objects (`const S = { ... }`), not className strings. All colors from `color.*` tokens. No em dashes in any text.

### Header

- Wallet address (full, monospace, truncated to 10...6 chars)
- Copy-to-clipboard button
- Equity tier badge (use existing tier badge component or pattern — read how it's done in `LeaderboardClient.tsx` first)
- Overall score pill
- "Follow" button — disabled/greyed out with tooltip "Coming in a future update" (stub for Sprint 5)

### Score Comparison Card

Only renders if `score_90d` is non-null.

Two columns side by side:
- Left: "Last 30 Days" — score_30d, win rate (30d)
- Right: "90-Day Track Record" — score_90d, win rate (90d)

Divergence indicator below: colored tag showing direction and magnitude.
- Improving: `color.green` tag — "Recent performance above baseline"
- Deteriorating: `color.red` tag — "Recent performance below baseline"
- Stable: `color.textMuted` — "Consistent with long-term baseline"

### Regime Performance Card

Only renders if `regime_performance` is non-null.

Three-column grid (BULL / BEAR / RANGING). Per regime cell:
- Regime label
- Win rate
- Sharpe proxy
- Trade count

Background tint per regime:
- BULL: faint green (`color.green` at low opacity)
- BEAR: faint red (`color.red` at low opacity)
- RANGING: neutral

Empty regime (trade_count = 0): show "No data" in muted text.

### Liquidation Rate Indicator

Only renders if `liquidation_rate` is non-null.

Single stat: "X% of closing trades were liquidations."

Color coding:
- < 5%: `color.green` — "Low"
- 5–15%: `color.amber` — "Moderate"
- > 15%: `color.red` — "High (penalty applied to score)"

### Open Positions

Existing panel content (currently shown in the Discovery inline panel). Read how it's rendered there and replicate here — do not reinvent.

### Trade History

Existing fill history table. Add one new column: a small "L" badge (`color.red`, rounded) on fills that were liquidations (`fill.liquidation != null`). 

If `backtest_source === 'native'`, show a subtle footer note: "Liquidation data unavailable — powered by native API."

---

## Navigation

The Discovery page "click to open panel" behavior becomes a link: `href={/wallets/${address}}`. Remove the inline panel modal after confirming the page works.

No new nav entry needed — the wallet detail page is accessed via links from Discovery, Leaderboard, and In Position pages.

---

## Acceptance Criteria

- [ ] `/wallets/[address]` route renders server-side for any valid address
- [ ] Invalid / unknown address shows a clean "Wallet not found" state, no crash
- [ ] `/api/wallet-profile` returns new fields (nullable) without breaking existing shape
- [ ] Score comparison card renders correctly when `score_90d` is non-null, hidden when null
- [ ] Regime performance card renders correctly with correct tint colors
- [ ] Liquidation rate indicator shows correct color tier
- [ ] "L" badge appears on liquidated fills only
- [ ] Discovery page wallet links navigate to `/wallets/{address}` correctly
- [ ] Follow button renders as disabled with tooltip (stub for Sprint 5)
- [ ] Copy address button works
- [ ] All colors from design tokens — no hardcoded hex values
- [ ] No em dashes in any rendered text
- [ ] Typecheck passes, full test suite passes
