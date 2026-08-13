# Product plan: from signal service to market data product

Written 2026-08-13, after the 200-day run closed both trading leads. This is the
plan to work through without further direction. Each phase ships on its own and
leaves the app in a working state, so stopping between phases is always safe.

## Status, 2026-08-13

| Phase | State | Landed in |
|---|---|---|
| 1, coin pages | **done** | `ebf28d4` |
| 2, clickable coins | **done** | `ebf28d4` |
| 3, nav by question | **done** | `f0b1e8b` |
| 4, liquidation view | **done, retired not repaired** | `ebf28d4` |
| 5, dead-premise surfaces | **done, moved to Research** | `f0b1e8b` |
| 6, honest record | **done**, `/research` | `f0b1e8b` |

Phase 4 resolved by deletion. The overlay bucketed counts rather than notional,
and the coverage that would make a liquidation map usable cannot be obtained from
Hyperliquid's public API, which exposes `clearinghouseState` per address only.
`bucketTimeseries` and the `market-radar/timeseries` route went with it; both
existed only to serve a liquidation heatmap over time and had no consumer.

**All six phases and the three follow-ups are done** (`63cfbc8`). Position change
ships on the coin page, the markets index carries funding and open interest, and
the Signal Record has an honest empty state.

**What is left, in rough order of value:**

1. **Nothing on the coin page is charted.** Candles are fetched, capped at 200,
   and never drawn. `lightweight-charts` is already a dependency. Price with
   funding underneath would make the page readable at a glance rather than as a
   table of numbers.
2. **Exposure change has no history.** It compares two snapshots. A short series
   of daily net exposure per coin would show accumulation rather than a single
   delta, and `wallet_score_history` shows the pattern for how to store it.
   Respect the no-thin-data rule: do not chart it until the series is long enough
   to mean something.
3. **The markets index lists only coins the cohort holds.** A reader looking up a
   coin with no cohort position gets nothing. `/api/markets` already returns the
   full universe, so the index could show every market and mark which ones the
   cohort is in.
4. **Nothing links to the coin page from the wallet page.** A wallet's position
   rows name coins that are still inert text there.
5. `wallet-profile` has an unused `closing` variable and `FeedClient:475` has an
   expression-statement lint warning. Both predate this work.

## Where this starts

The backtested premise is dead: copying the cohort's trades does not pay, at any
hold, on entries or exits. What survives is that the cohort is real money, its
positioning is observable, and the wallet ranking predicts a wallet's own returns
(rank IC 0.0939).

So the product is not a signal service. It is a window onto where a set of large,
identifiable traders is positioned, next to exchange-wide facts anyone can check.

**The one-line pitch to build toward:** see where real money is positioned on
Hyperliquid, and what it costs to sit there.

Not "trade like the whales". That claim is retracted and must not come back in
copy, labels, or page titles.

## The test every phase is measured against

A newcomer arrives knowing nothing about this project and holding one question:
*what is happening in the coin I care about?* They should reach an answer in
under ten seconds without learning our vocabulary.

Today they cannot. The nav is Wallets / Signals / Portfolio, which is our
pipeline (discover, score, signal, measure), and there is no coin page at all.

## Phase 1: coin pages, the spine of the product

**Build `/coin/[symbol]`.** There are currently zero dynamic routes in `app/`.

Most of the backend exists and nothing consumes it. `app/api/deep-dive/route.ts`
already accepts a `coin` param and returns candles, 7 days of funding history,
open interest, current funding, and cohort exposure for that coin computed from
Supabase snapshots. It has no callers.

Page contents, in this order:

1. Price, 24h change, open interest, current funding rate and the 7-day funding
   average. All exchange-wide facts, verifiable against the exchange.
2. Cohort position in this coin: net long or short, notional each side, number of
   wallets, and the change since the previous snapshot. The change is the part
   that carries information and it is not currently shown anywhere.
3. Which ranked wallets hold it, linking to the wallet page, sorted by score.
4. Recent cohort fills in this coin.

**Acceptance:** from the leaderboard or any coin tag anywhere in the app, one
click reaches a page that answers the question above. Server component fetches
first paint via `lib/server/kv-fetchers.ts` in the existing pattern.

**Files:** new `app/coin/[symbol]/page.tsx` and `CoinClient.tsx`; extend
`app/api/deep-dive/route.ts` if a field is missing; add coin links in
`OverviewClient`, `FeedClient`, `LeaderboardClient`, `RadarClient`.

## Phase 2: make coin tags clickable everywhere

Every coin string rendered anywhere becomes a link to its coin page. Today coin
tags are inert text in the feed, the overview exposure list and the radar.

This is what turns Phase 1 from a page into a product: the coin page becomes the
destination that every other surface feeds.

**Acceptance:** no rendered coin symbol anywhere in the app is dead text.

## Phase 3: reorganize the nav around questions, not pipeline stages

Current: Overview / Wallets (Discovery, Leaderboard, In Position, Scoring) /
Signals (Feed, Divergence, Radar, Signal Scores) / Portfolio (Following, Paper
Trading, Paper Journal).

Target shape, subject to revision once Phase 1 exists:

- **Markets**: coin pages, positioning, funding and open interest
- **Traders**: leaderboard, in position, wallet pages
- **Activity**: feed, divergence
- **Research**: ranking quality, factor journal, honest performance records

Discovery becomes a section of a status page rather than a nav item. It
describes the scanner, and no market participant needs it.

**Acceptance:** every top-level nav item names something a trader wants, not a
stage of our pipeline.

## Phase 4: fix or retire the liquidation view

The Radar liquidation map is not usable today and the reason is structural.

- It buckets `liq_long_count` and `liq_short_count`, which are **counts**. A $5M
  position and a $500 position increment the same bar, so the map cannot show
  where size actually sits. `bucketTimeseries` already uses notional; the main
  view does not.
- The range is ±30% over 40 buckets, so each bar spans 1.5% and the first few
  percent, where anything actionable lives, is a handful of bars.
- It covers about 500 wallets, not the exchange. It resembles a market-wide
  liquidation heatmap while having none of the coverage.

**A true market-wide liquidation map cannot be built from this data.**
Hyperliquid's public info API exposes `clearinghouseState` per address only. There
is no global positions endpoint, so whole-exchange coverage is not obtainable.
This kills the "lead with the liquidation map" idea recorded earlier in this
session. Do not revive it without a data source that does not exist today.

What to do instead, in order of preference:

1. Switch the buckets from counts to notional, narrow the range to about ±10%,
   and relabel the view honestly as **cohort** liquidation levels rather than a
   market liquidation map. Then reduce it to one plain sentence per coin on the
   coin page, for example "$4.2M of tracked positions liquidate below $38,400".
   A sentence is more usable than the chart and is defensible.
2. If that sentence does not survive contact with real numbers, retire the view.

**Acceptance:** either the view reports dollars over a useful range under an
honest label, or it is gone. It does not stay as it is.

## Phase 5: retire the dead-premise surfaces

Paper Trading and Paper Journal implement entry copying, measured to lose money
at every hold. Signal Scores mostly renders "withheld, below sample", and where
it reports, the numbers are negative. Feed streams recipes with no measured edge.

A newcomer who clicks these learns the product does not work, which costs exactly
the credibility the rest of the plan is trying to build.

Order: move Signal Scores and the Paper pages behind a Research section, keep the
Feed as a record of cohort activity rather than a list of trade ideas, and drop
any label that implies a recommendation.

**Acceptance:** no surface presents an unvalidated recipe output as a trade idea.

## Phase 6: the honest performance record

Keep one page that shows what the project has and has not established, including
the failures. The forward factor record at `/portfolio/journal` already does part
of this.

This is a differentiator rather than an embarrassment. Almost nothing in this
space publishes its own negative results, and the register in `docs/research/` is
a genuine asset if it is surfaced rather than buried.

## Rules that hold across every phase

1. **No claim without a measurement behind it.** Copy says what happened, never
   what will happen. The words edge and alpha do not appear in user-facing text.
2. **Read `lib/design-tokens.ts` before writing any style value**, per the
   `ui-design-enforcer` skill. No new token invented without asking.
3. **Typecheck, lint and the full test suite pass before each commit.** CI runs
   them on every push regardless.
4. **Descriptive beats predictive.** When a choice exists between showing a fact
   and showing an inference, show the fact.
5. **New aggregation gets a unit test** in `lib/__tests__/`, matching the pattern
   of roughly one test file per `lib/` module.

## Sequence

Phase 1 and 2 together are the product. Phase 3 makes it findable. Phases 4 and 5
remove what actively misleads. Phase 6 is the positioning.

Start at Phase 1. Nothing in Phases 2 through 6 blocks it.
