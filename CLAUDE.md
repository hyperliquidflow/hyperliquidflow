# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm run typecheck    # tsc --noEmit
npm run test         # Vitest (single run, node env, no live services needed)
npm run test:watch   # Vitest in watch mode

# Run a single test file
npx vitest run lib/__tests__/cohort-engine.test.ts

# Scripts (require env vars)
npx tsx scripts/daily-wallet-scan.ts          # Full cohort scan: discovery, Streams A/C/D, backtests (GitHub Actions runs this)
npx tsx scripts/validate-scoring-weights.ts   # Correlate wallet scores vs EV scores over 30 days
npx tsx scripts/signal-learning.ts            # Update signal_outcomes stats (GitHub Actions runs this daily)
npx tsx scripts/bootstrap-hypurrscan-index.ts # Seed Hypurrscan address-name index

# Research scripts (read-only, write nothing to Supabase or KV)
# Use --env-file=.env.local locally. Fetch once to a cache, then re-slice.
npx tsx --env-file=.env.local scripts/fill-study.ts --fetch --days=120 --interval=1h --pool=traders --wallets=120
npx tsx scripts/compact-fill-cache.ts          # collapse fills to hourly, run before analysing a large cache
npx tsx --env-file=.env.local scripts/fill-study.ts        # re-slice the cache, no refetch
npx tsx --env-file=.env.local scripts/signal-stack.ts      # features + correlation matrix + combined IC
npx tsx --env-file=.env.local scripts/positioning-factor.ts
npx tsx --env-file=.env.local scripts/cohort-skill-test.ts --min-active=5
npx tsx --env-file=.env.local scripts/activity-gate-tradeoff.ts
```

## Measurement discipline

**Assume any result from this codebase is wrong until its sample is checked
against a previous run.** On 2026-08-12 six defects were found in the research
code and five had already produced a confident, publishable-looking answer:
truncated candles making table rows use different trades, clustered fills
inflating a decile to t=51, unbenchmarked direction reporting market beta as
edge, a stale-price guard tuned for the wrong bar size dropping a third of a
sample, a wallet pool ordered by scan recency drawing dormant wallets, and a
pool banded on trade count admitting market makers.

Before reading any research output:
- Compare row counts against the previous run. A 33x drop with no error is a bug, not a finding.
- Every row of a table must use the same sample. Non-monotonic `n` across horizons means data is missing.
- Collapse correlated observations before computing `t`. Fills cluster within a wallet, and wallets cluster within a coin-day.
- Subtract a benchmark. A long-biased cohort in a drifting market shows beta as alpha.
- Split-half anything promising. Two results died here after looking significant.
- Never rank by a score computed from the window being measured.

## Hyperliquid API limits (measured, not documented)

- `candleSnapshot` caps near 5,000 bars and **truncates silently** to the most recent. Reach per interval: 1m 3.5d, 5m 17.4d, 15m 52d, 1h 208d.
- `userFillsByTime` caps at 2,000 fills, oldest first from `startTime`, with no truncation signal. Paginate by advancing past the newest fill seen.
- `total_trades` counts trades; the fills endpoint returns partial fills. One trade can be many fills, so banding on trade count does not bound fetch size.

## Sprint Workflow

Work is organized in sprints tracked in [docs/sprints/status.md](docs/sprints/status.md). **Read that file at the start of any session** to know the active sprint, what's complete, and what's next. Sprint specs live in [docs/superpowers/specs/](docs/superpowers/specs/), plans in [docs/superpowers/plans/](docs/superpowers/plans/).

## Architecture

**HyperliquidFLOW** is a Next.js 15 App Router app that tracks an activated cohort of high-quality Hyperliquid wallets (~500 active at any time, rebuilt daily from ~4,500 discovered candidates), scores them, and surfaces trading signals. All heavy computation is server-side; the client is a thin React Query poller.

### Data Flow

```
Vercel Cron (00:00 UTC daily)   GitHub Actions (daily 00:00 UTC)
  /api/refresh-cohort             scripts/daily-wallet-scan.ts
  (seed-only, Hobby plan limit)   ├─ discover (leaderboard + fills)
                                  ├─ Stream A activation gates (9 checks)
                                  ├─ Stream C wash / sybil detection
                                  ├─ Stream D behavior profiling
                                  ├─ backtests + full scoring
                                  └─ writes Supabase + artifact

UptimeRobot ping (5 min, 24/7)  GitHub Actions (01:00 UTC daily)
  hits /api/cohort-state, which   scripts/signal-learning.ts
  background-refreshes the        updates signal_outcomes stats
  cohort when stale >5 min

Browser (React)
  useQuery("/api/cohort-state") every 60s
    ├─ read KV snapshot (fast path)
    ├─ fires background refresh if stale >5 min
    └─ fallback to Supabase on KV miss
```

**Cron budget:** `/api/refresh-cohort` must complete within its 30s `maxDuration` (vercel.json) — that's why full cohort scoring lives in the daily GitHub Actions job, not the per-refresh path.

### Core Engines (`lib/`)

| File | Purpose |
|------|---------|
| `cohort-engine.ts` | Four-factor wallet scoring: Sharpe proxy, PnL consistency, drawdown, regime fit |
| `signal-lab.ts` | 6 pluggable signal recipes — each takes `SnapshotPair → SignalEvent[]` |
| `risk-engine.ts` | EV, margin ratio, fee schedule. `liquidationDistance` = mark to nearest `liquidationPx`; `liquidationBuffer` = free margin, a leverage stat |
| `skill-test.ts` | Retrospective rank IC. `normalizedForwardPerformance` puts forward PnL in the wallet's own risk units |
| `hyperliquid-api-client.ts` | Raw Hyperliquid API: clearinghouse states, market data, fill history |
| `cohort-hygiene.ts` | Stream B hygiene gates. The liq gate uses `liquidationDistance`, not `liq_buffer_pct`; see below |
| `wash-sybil.ts` | Stream C, wash-trading and Sybil cluster detection |
| `wallet-profile.ts` | Stream D, per-wallet behavior profiling (style, conviction, regime tendency) |
| `signal-learning-utils.ts` | Outcome tracking helpers for the daily learning loop |
| `recipe-config.ts` | Per-recipe tunable config (thresholds, window sizes) |
| `radar-utils.ts` | Aggregation helpers for the Market Radar view |
| `watchdog.ts` | Pure health-check evaluation and alert state transitions, no I/O |
| `telegram.ts` | Telegram transport plus every bot message string |
| `hypurrscan-api-client.ts` | Hypurrscan name/label index client |
| `alert-engine.ts` | Core types for wallet-following alerts: `AlertEvent`, `FollowedWallet`, `PaperPosition`, `PositionSnapshot` |
| `leverage-risk.ts` | Leverage penalty math for scoring V2 (`LeveragePenaltyParams`, blow-up curve) |
| `signal-validation.ts` | Pure functions for per-wallet and per-signal regime fit scoring |
| `atr.ts` | ATR computation for 4h candles, pure functions, used by `signal-learning.ts` |
| `outcome-helpers.ts` | Helpers for signal outcome resolution (used by `measure-outcomes` route) |
| `env.ts` | Central env var access; never read `process.env` directly elsewhere |
| `recipe-meta.ts` | Single source of truth for signal recipe `label` + `desc` strings (used by Overview, Signals, Edge) |
| `design-tokens.ts` | All visual design tokens: `color`, `type`, `space`, `radius`, `shadow`, `effect`, `layout`, `anim`, `card`, `row` |

Client-side hooks live in `lib/hooks/`: `use-followed-wallets`, `use-alert-events`, `use-alert-detection`, `use-paper-positions`.

### Pages (`app/`)

| Route | Purpose |
|-------|---------|
| `/` | Overview — stat cards, live signal feed, wallet leaderboard snapshot |
| `/wallets/discovery` | Wallet discovery stats + inline address lookup |
| `/wallets/leaderboard` | Full ranked wallet leaderboard |
| `/wallets/inposition` | Wallets with open positions right now |
| `/signals/feed` | Live signal event feed |
| `/signals/divergence` | Contrarian/divergence signals |
| `/signals/radar` | Market Radar, per-token cohort positioning view |
| `/signals/performance` | Signal recipe performance analytics, 24h directional accuracy ranked |
| `/wallets/following` | Followed wallets with alert configuration |
| `/wallets/paper` | Paper trading, auto-copies positions from followed wallets |
| `/performance/ranking` | Rank IC history; requires 30+ days of `wallet_score_history` data |

Old routes (`/scanner`, `/stalker`, `/contrarian`, `/imbalance`, `/recipes`, `/edge`, `/performance`) redirect to their current equivalents.

### API Routes (`app/api/`)

- `refresh-cohort`: Vercel Cron endpoint (and manual trigger target); scores cohort, runs recipes, writes KV. Calls `pruneUnderperformers` in background via `after()`.
- `cohort-state`: Client polls this; reads KV, fires background refresh if stale >5 min
- `contrarian`: Powers the Divergence tab; reads KV, fires background refresh if stale
- `market-ticker`: Live price/change data for the ticker strip
- `wallet-positions`: Real-time open positions for a single wallet (used by alert engine)
- `signal-freshness`: Rolling 1h latency stats from `signal_timing` table (Overview stat card)
- `rank-ic`: Rank IC history from `wallet_score_history` (returns empty state until 30+ days accumulate)
- `telegram/webhook`: inbound Telegram commands (`/status`, `/check`, `/cohort`, `/signals`, `/scan`). Read only, single authorized chat, all others silently ignored.
- `telegram/watchdog`: runs the five health checks, sends a Telegram message only on a state change. Triggered every 15 min by `freshness-check.yml`.
- `wallet-profile`, `scanner-stats`, `recipe-performance`, `top-markets`, `deep-dive`, `signals-feed`, `market-radar`, `measure-outcomes`, `agent-readiness`

### Server-Side Data Fetching

`lib/server/kv-fetchers.ts` contains functions (`fetchCohortState`, `fetchMarketTicker`, etc.) that read from KV and Supabase. Async server components call these directly for first-paint data — no client-side skeleton states needed. API routes then handle subsequent polling via React Query (`@tanstack/react-query`).

The `after()` Next.js API is used for fire-and-forget background work (e.g., triggering a stale refresh after serving a cached response). Do not await these.

### Supabase Migrations (`supabase/migrations/`)

| Migration | Content |
|-----------|---------|
| 001 | Initial schema |
| 002 | Wallet metrics |
| 003 | Equity tiers |
| 004 | Backtest daily PnLs |
| 005 | Entity type column on wallets |
| 006 | Signal intelligence tables |
| 007 | Signal outcomes (drives the daily learning loop) |
| 008 | Recipe calibration |
| 009 | Wallet hygiene columns (deactivation_reason, deactivated_at, low_equity_cycles) |
| 010 | Wash/sybil detection tables |
| 011 | Wallet profiles table |
| 012 | Signal timing table (latency tracking) |
| 013 | Leverage columns on wallets + `cohort_attrition` table |
| 014 | `wallet_score_history` for rank IC measurement |
| 015 | Signal outcome overhaul |
| 016 | Multi-window and out-of-cohort validation (OOCV) |
| 017 | EV decoupling from scoring |
| 018 | Shadow scoring columns (`overall_score_shadow`) for V2 canary rollout |
| 019 | Enable Row Level Security on all tables |
| 020 | Drop signal_events + rate_limit_tokens; outcome retention 30d to 180d |

### Two gates that look wrong but are not

- **`liq_buffer_pct` is free margin, not liquidation risk.** It is
  `(accountValue - totalMarginUsed) / accountValue`, a leverage statistic. A
  wallet deploying its whole balance scores 0 while sitting 25% from
  liquidation. Hygiene used it until 2026-08-12 and removed 30 of 36 solvent
  wallets in 48 hours. The gate now uses `liquidationDistance` from
  `risk-engine.ts`, computed from `liquidationPx` in `cohort_snapshots.positions`,
  so no migration was needed and the fix applies to existing rows. Recipes may
  still read `liq_buffer_pct` deliberately, as a conviction proxy.
- **`scoreWallet` skips the equity gate when the leaderboard has no entry.**
  `liveEquity` comes only from the leaderboard snapshot, so off-leaderboard
  candidates activate unchecked. That left 49 of 76 active wallets holding
  exactly $0. Phase 9b (`verifyLiveEquity`) closes it by querying
  clearinghouseState for the activated set only, which is orders of magnitude
  smaller than the candidate pool that blew the API budget when this was tried
  at gate time. It cut 147 unfunded wallets on its first run.

### Key Data Separation

- **Historical PnL** → `user_pnl_backtest` Supabase table (realized trades, used for scoring)
- **Live positions** → `cohort_snapshots` Supabase table (open positions, used for signals)
- Never conflate realized PnL with unrealized position changes.

### Regime Detection

BTC 24h return → BULL (>1%) / BEAR (<-1%) / RANGING. Feeds `regime_fit` factor in scoring. Thresholds are defined in `lib/cohort-engine.ts:detectRegime`.

### KV Cache Keys

| Key | Content | TTL |
|-----|---------|-----|
| `cohort:active` | Main cohort snapshot (scores + signals) | 600s |
| `cohort:active:fallback` | Backup stale snapshot | 24h |
| `cohort:cycle_offset` | Rotating window offset for partial cron cycles | persistent |
| `market-ticker:v4` | Live price/change data | short |
| `contrarian:latest` | Contrarian signal cache | ~120s |

Fallback chain on cache miss: primary key → fallback key → Supabase query.

### GitHub Actions

Four workflows:

- **`freshness-check.yml`**: every 15 min. Calls `/api/telegram/watchdog`, which owns all five check definitions and sends a Telegram message only when a check changes state. A failed curl means the app itself is unreachable, and GitHub's default failure email covers that case.
- **`keepalive.yml`**: monthly. Commits a heartbeat file so GitHub's 60-day inactivity rule can never silently disable the scheduled workflows again (it did on 2026-06-22; see docs/audit/2026-08-08-full-audit.md).
- **`daily-wallet-scan.yml`** — `0 0 * * *` UTC. Discovery, Streams A/C/D, backtests, full scoring for ~500 active wallets (up to 5,000 candidates). Writes Supabase + uploads `scan-summary.json` artifact (7d retention). 50-minute timeout.
- **`signal-learning.yml`** — `0 1 * * *` UTC (after scan finishes). Runs `scripts/signal-learning.ts` to update outcome stats. 20-minute timeout. Uploads `learning-summary.json` (14d retention).

- **`rank-ic.yml`** runs `scripts/rank-ic.ts` to compute Rank IC history from `wallet_score_history`.

All support `workflow_dispatch` for manual runs.

### Tests

Tests live in `lib/__tests__/*.test.ts`. The setup file (`lib/__tests__/setup.ts`) injects placeholder env vars — no real Supabase or KV credentials needed. Coverage exists for: `cohort-engine`, `utils`, `recipe-config`, `signal-learning`, `outcome-helpers`, `token-tiers`, `radar-utils`, `hypurrscan-api-client`. API routes and React components are not unit-tested.

Mocking pattern uses `vi.mock()` for `@vercel/kv`, `@supabase/supabase-js`, and `@/lib/env`.

### API Auth

No OAuth on data routes. Auth relies on:
- `SUPABASE_SERVICE_ROLE_KEY` for all server-side reads/writes (backend only — never sent to browser)
- `CRON_SECRET` header check in `refresh-cohort` and `measure-outcomes` (required in production). Restricts these endpoints to Vercel's scheduler using a timing-safe Bearer token compare.

### Adding Signal Recipes

Add to `lib/signal-lab.ts` following the `(pair: SnapshotPair) => SignalEvent[]` pattern. All 6 existing recipes are registered in the `runSignalLab` function. Add the display label + description to `lib/recipe-meta.ts` (keyed by the recipe ID string).

### Nav Structure

The nav is defined in `components/nav.tsx` in the `NAV` array. Sections (Wallets, Signals) always show their children — no expand/collapse state.

## UI Work

**Before writing any JSX, TSX, HTML, PDF, or any other visual output, invoke the `ui-design-enforcer` skill.** This includes whitepapers, print documents, prototypes, and mockups — not just .tsx files. Mandatory, no exceptions, no "small" changes exemption. The skill forces reading `lib/design-tokens.ts` live (which contains the brand identity rules) before any style value is written.

## Copy Rules

- **No em dashes (—) or en dashes (–) in any user-facing copy.** This applies to all JSX/TSX string literals, template strings, and rendered text across every page and component. Use a comma, period, or rewrite the sentence instead. Dashes in code comments are fine. A PreToolUse hook in `.claude/settings.json` will block writes that violate this.

## Color Rules

- **Always use design token colors for semantic states.** Import from `@/lib/design-tokens` — never use arbitrary hex values like `#4ade80` or `#f87171`. Key tokens:
  - `color.green` = `#6aaa7a` (positive/bullish)
  - `color.red` = `#c92435` (negative/bearish)
  - `color.accent` = `#50d2c1` (active states, nav, live indicators; replaces color.mint)
  - `color.amber` = `#c4925a` (warning; warm ochre)
  - `color.blue` and `color.purple` have been removed from the token file
  - `color.textMuted` = `rgba(255,255,255,0.38)`
- This applies to inline styles, API route verdict colors, and any hardcoded color strings anywhere in the codebase.

## UI Conventions

- Styling uses inline style objects (e.g. `const S = { card: {...} }`) rather than className strings — this is intentional for type safety and tree-shaking.
- Financial numbers use `fontVariantNumeric: "tabular-nums"` for column alignment.
- Color palette: greens for bullish, reds for bearish, template-grey scale for neutrals.
- Frosted glass cards: `backdropFilter: "blur(...) saturate(...)"`.
- Bottom-right corner aura + procedural grain overlay for visual texture.

## Environment Variables

Required in `.env.local`:
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz/info
NEXT_PUBLIC_POLL_INTERVAL_MS=60000
CRON_SECRET=                    # required in production; restricts cron endpoint to Vercel scheduler
TELEGRAM_BOT_TOKEN=             # BotFather token, required in production
TELEGRAM_CHAT_ID=               # the single authorized chat, all others ignored
TELEGRAM_WEBHOOK_SECRET=        # registered at setWebhook time
```

Backend routes use `SUPABASE_SERVICE_ROLE_KEY` (full access). Client uses anon key.
