# Competitor Research: HyperTracker

**Source:** https://hypertracker.io / https://app.coinmarketman.com/hypertracker  
**Researched:** 2026-04-13  
**Product:** HyperTracker by CoinMarketMan

---

## What It Is

HyperTracker is a Hyperliquid-native analytics platform built on top of CoinMarketMan
(a broader crypto trade journaling tool). It tracks 1.6M+ Hyperliquid wallets in
real time and surfaces market intelligence through cohort segmentation, position
heatmaps, whale tracking, and a developer API.

The app lives at `app.coinmarketman.com/hypertracker` and is marketed via the SEO
landing page `hypertracker.io`.

---

## Full Feature Inventory

### 1. Home - Wallet Cohorts Dashboard

The entry screen shows all tracked wallets grouped into named, emoji-branded "cohort
segments" — two tracks: by Perp Equity (account size) and by All-Time Perp PnL
(performance). Each card shows wallet count, directional bias (Very Bullish / Bearish /
etc.), bias score, and a small sparkline chart.

**Size cohorts (by perp equity):**
- Shrimp, Fish, Dolphin, Apex Predator, Small Whale, Whale, Tidal Whale, Leviathan

**Performance cohorts (by all-time PnL):**
- Giga-Rekt, Full Rekt, Semi-Rekt, Exit Liquidity, Humble Earner, Grinder, Smart Money,
  Money Printer

**Inspiration:** The emoji + named persona system makes cohorts feel like characters
rather than data labels. It is immediately memorable and shareable. Each segment has
personality. Users understand "Leviathan" means something before they even read the
definition.

---

### 2. Perps - Market-Level Analytics

The Perps page shows aggregate Hyperliquid perp market data:

- **Bias Trend chart** - multi-line chart showing long/short bias over time per cohort
- **Open Interest** - live OI with 24h delta
- **Liquidation Heatmap** - shows clustered liquidation zones on the price axis
- **Position Breakdown by Size** - table bucketed by equity range
  (e.g. $0-$50k, $50k-$100k, ...) showing count, OI, leverage, avg PnL
- **Position Breakdown by Cohort** - same table filtered by cohort type
- **Most Bullish Cohort** indicator in the top right

**Inspiration:** The Bias Trend chart (multi-cohort lines over time) is a powerful
signal visualization we do not have. Seeing how Smart Money vs Fish vs Exit Liquidity
have shifted their directional bias over days/weeks is high-signal.

---

### 3. Market Radar

A price-level position visualization showing where wallets are clustered along the
price axis for a selected asset. Tabs for: Liquidations, Stop Loss, Take Profit,
Limit Orders, Low Liquidity Gaps.

- Horizontal bar chart overlaid on price axis
- Asset selector dropdown
- Stats: total positions, open interest, avg position age, dominance
- Timeline slider at the bottom

**Inspiration:** This is a cleaner version of what TradingView's "position levels"
overlay attempts. Showing WHERE on the price axis positions are clustered - especially
stop losses and liquidation zones - is actionable intelligence we do not surface at all.

---

### 4. Global Position Heatmap

A grid table: assets as rows (BTC, ETH, SP500, CL, XYZ100, BRENTOIL, HYPE, SOL,
SILVER, WTI...) crossed with cohort columns (all segments as emoji icons). Each cell is
color-coded green (long bias) or red (short bias), with OI shown in the rightmost
column per asset.

- Position Age filter (e.g. last 24h)
- Partial view for logged-out users, full heatmap behind login
- Shows 248,254 positions from 242,776 active traders

**Inspiration:** This is the most original visualization in the product. At a glance you
can see that Leviathans are short ETH while Fish are long ETH. Cross-cohort, cross-asset
positioning in one view. We have nothing like this. Very high-signal layout.

---

### 5. Real-Time Stats

Four time-series charts on one page:
- Open Interest (Perps) - with 24h change
- Daily Volume
- Active Perp Traders (currently 242,776)
- Total Open Positions

Toggle between Perpetual and Spot data. Each chart shows the full historical trend.

**Inspiration:** Simple but useful macro dashboard. We have some of this in Overview
but not as dedicated time-series charts with historical depth.

---

### 6. Leaderboards

Live ranked table across 1,875,940 wallets (filter: 266,408 qualified for PnL).

Columns: Rank, Wallet, Age, Perp Equity, Open Value, Leverage, Current Bias, 24h PNL,
7d PNL, 30d PNL.

- Filter by PNL type (Perp Only vs All)
- Bias is shown as a color tag (Very Bullish / Bullish / etc.) inline with rank
- Top wallets: $40M equity, 3x leverage, $100M+ 30d PNL

**Inspiration:** Showing Current Bias alongside PnL rank is clever - it surfaces not
just who is winning but whether they are leaning long or short right now. Our leaderboard
shows scoring but not live bias direction inline.

---

### 7. Segment Detail Page (e.g. Smart Money)

Clicking into a cohort shows:
- Cohort header: wallet count, bias score, sparkline
- Top 10 Open Perps (treemap by open value with asset names)
- Liquidation Risk by Asset (bar chart)
- Largest Positions (table of top wallet positions)
- Cohort Exposure (chart over time)
- Bottom: wallet table with address, Perp Equity, Open Value, 30d PnL, leverage, bias
  tag, and cohort tags

**Inspiration:** The treemap of cohort open positions is very visual and not something
we show. Also showing Liquidation Risk as a bar chart per asset within a cohort is
useful for understanding systemic risk.

---

### 8. Wallet Profile Page

Individual wallet deep-dive at `/hypertracker/wallet/0x...`:

- **Claim Profile** - wallet owner can claim and add a display name
- Cohort tags (e.g. "Leviathan", "Money Printer") shown as badges
- Follower count + Alert button (social layer)
- **Share button** for the profile
- **Combined Equity** - total across all positions
- **Perp Bias gauge** - visual dial showing Very Bullish / Bearish
- **Leverage** - current avg leverage
- PnL with time window selector (24h, 7d, 30d, All)
- Volume over period
- **Equity chart** - historical equity curve going back years
- Tabs: Perps, Holdings, Fills, Open Orders, Transfers, Referrals
- Position table with: Token, Amount, Value, Avg Entry, Live PNL/ROE, Funding, Dist. to
  Liq, Age

**Inspiration:**
- The "Claim Profile" / social follower layer is a retention and virality mechanism we
  have no equivalent of.
- The perp bias gauge (visual dial) is more intuitive than a raw score number.
- Showing distance to liquidation as a column in the position table is a direct risk
  signal we should include.
- The equity curve going back to account creation gives a proper track record view.

---

### 9. Liquidations (Coming Soon)

"Liquidation data and high-risk positions, live." - Teaser page with Telegram/X CTAs.
Floating tag animations showing "REKT LONG", "REKT SHORT", "LIQUIDATED SHORTS",
"LIQUIDATED LONGS" in the background.

**Inspiration:** Good proof that live liquidation streaming is high demand. The teaser
page itself uses motion to convey the urgency and energy of the product.

---

### 10. API / Builders

Full developer API at `/hypertracker/api-dashboard`:
- Pre-processed, labeled, real-time on-chain data as JSON endpoints
- Endpoints: order flow, open interest, funding rates, long/short skew, wallet
  positions, liquidation events, smart money cohort outputs
- Webhooks for threshold events (whale moves, OI spikes, funding rate changes)
- Positioned explicitly for "vibe coding" - AI assistant + API key = ship fast

**Inspiration:** Explicit "vibe coding" positioning is modern and resonates with the
current developer zeitgeist. The webhook model (fire on condition) is more useful than
polling.

---

### 11. Alerts

Configurable wallet-level alerts. When a followed address opens, adds to, or closes a
position, alerts fire in real time. Accessible from any wallet profile.

**Inspiration:** We have no alert system. Per-wallet alerts are a sticky engagement
hook.

---

### 12. Favorites

Saved wallet list - persistent across sessions. Quick access to your tracked wallets.

**Inspiration:** Simple but necessary for power users managing multiple wallets.

---

## Navigation Structure

Left sidebar icon nav (12 items, no labels, icon-only):
- Home (cohorts overview)
- Favorites (saved wallets)
- Alerts
- API / Code
- (separator: MA)
- Perps (market analytics)
- Radar (position levels)
- Connections / Social
- People / Leaderboards
- (separator: OV)
- Signals / Market Radar
- Trophy / Leaderboards
- Stats

Top bar (persistent): Live OI, 24h Vol, Last Updated timestamp, Next Update countdown.
Bottom footer: API, About, X, Discord, Telegram.

---

## Visual Design Notes

| Element | HyperTracker |
|---|---|
| Background | Near-black (~#0a0a0a) |
| Accent / Bullish | Teal-green (~#00E5A0) |
| Bearish | Coral-red/orange |
| Font | Monospace for numbers, sans-serif for labels |
| Nav | Icon-only left sidebar, very compact |
| Layout density | Very high - lots of data in small space |
| Cohort branding | Emoji icons are core to UX identity |
| Heatmap cells | Pill/rounded rectangle, color intensity = strength |

---

## Positioning and Messaging

Landing page (hypertracker.io) SEO-optimized around:
- "Hyperliquid wallet tracker"
- "smart money feed"
- "on-chain alpha alerts"
- "Hyperliquid whale tracker"
- "copy trading" research layer
- "1.6m+ wallets tracked"
- "billions in daily volume monitored"
- "100% on-chain data, zero third-party intermediaries"

The builder angle is prominent: "Vibe Code Your Own Hyperliquid Tools" - explicitly
positioning their API as the AI-era data layer for Hyperliquid.

---

## Gaps / Weaknesses We Can Exploit

1. **No scoring model** - They show PnL rankings but no multi-factor wallet quality score
   (Sharpe proxy, drawdown, regime fit). Our cohort engine is more sophisticated.

2. **1.6M wallets = noise** - Tracking everyone dilutes signal. Our curated top ~1200
   high-quality wallets is a differentiator if we frame it right: "Signal, not noise."

3. **No signal recipes / edge analytics** - They surface data but do not run automated
   signal detection across the cohort. Our signal-lab patterns (momentum, divergence,
   etc.) have no equivalent in their product.

4. **No daily brief** - No synthesized narrative or daily market summary. Just raw data.

5. **No regime detection** - No concept of BULL/BEAR/RANGING market context built into
   the scoring or signals.

6. **App is part of CoinMarketMan** - Feels like a feature bolted onto a broader trade
   journaling product. We are purpose-built for Hyperliquid intelligence.

7. **Heavy visual weight** - Dense but not particularly beautiful. Opportunity to be
   more polished.

---

## Features Worth Adopting / Getting Inspired By

| Feature | Priority | Notes |
|---|---|---|
| Cohort naming with emoji personas | High | Our current scoring buckets are unnamed. Named cohorts with personality = shareable, memorable. |
| Global Position Heatmap (asset x cohort) | High | Asset x cohort cross-view is a unique insight we have the data to build. |
| Bias Trend chart per cohort over time | High | Multi-line cohort bias history - we can do this with our signal data. |
| Market Radar (price-level position clusters) | Medium | Liquidation zones and stop-loss clusters on price axis. |
| Perp Bias gauge (visual dial) | Medium | More intuitive than a raw numeric score. |
| Current Bias inline on leaderboard | Medium | Show live directional lean next to PnL rank. |
| Distance to Liquidation column in positions | Medium | Direct risk column in wallet position tables. |
| Per-wallet Alerts | Medium | Sticky engagement hook, currently absent from our product. |
| Wallet claiming / profile ownership | Low | Virality and retention mechanism for wallet owners. |
| Equity curve (full history) | Low | We show 30d PnL, not the full account lifetime equity curve. |
| "Vibe code" API positioning | Low | Marketing angle for our API/data layer. |
