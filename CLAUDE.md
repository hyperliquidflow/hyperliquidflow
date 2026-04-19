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
```

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

GitHub Actions ping (24/7)      GitHub Actions (01:00 UTC daily)
  keeps signal detection live     scripts/signal-learning.ts
  by calling /api/refresh-cohort  updates signal_outcomes stats

Browser (React)
  useQuery("/api/cohort-state") every 60s
    ├─ read KV snapshot (fast path)
    ├─ fires background refresh if stale >5 min
    └─ fallback to Supabase on KV miss
```

**Cron budget:** `/api/refresh-cohort` must complete in ≤10s on Vercel free tier — that's why full cohort scoring lives in the daily GitHub Actions job, not the per-cron ping.

### Core Engines (`lib/`)

| File | Purpose |
|------|---------|
| `cohort-engine.ts` | Four-factor wallet scoring: Sharpe proxy, PnL consistency, drawdown, regime fit |
| `signal-lab.ts` | 13 pluggable signal recipes — each takes `SnapshotPair → SignalEvent[]` |
| `risk-engine.ts` | EV calculation, liquidation price, margin ratio, Hyperliquid fee schedule |
| `hyperliquid-api-client.ts` | Raw Hyperliquid API: clearinghouse states, market data, fill history |
| `cohort-hygiene.ts` | Stream B hygiene gates — deactivates wallets that go quiet, blow up, or stop trading |
| `wash-sybil.ts` | Stream C — wash-trading and Sybil cluster detection |
| `wallet-profile.ts` | Stream D — per-wallet behavior profiling (style, conviction, regime tendency) |
| `signal-learning-utils.ts` | Outcome tracking helpers for the daily learning loop |
| `recipe-config.ts` | Per-recipe tunable config (thresholds, window sizes) |
| `radar-utils.ts` | Aggregation helpers for the Market Radar view |
| `hypurrscan-api-client.ts` | Hypurrscan name/label index client |
| `hypurrscan-enrichment.ts` | Enriches wallet addresses with Hypurrscan labels |
| `env.ts` | Central env var access — never read `process.env` directly elsewhere |
| `recipe-meta.ts` | Single source of truth for signal recipe `label` + `desc` strings (used by Overview, Signals, Edge) |
| `design-tokens.ts` | All visual design tokens: `color`, `type`, `space`, `radius`, `shadow`, `effect`, `layout`, `anim`, `card`, `row` |

### Pages (`app/`)

| Route | Purpose |
|-------|---------|
| `/` | Overview — stat cards, live signal feed, wallet leaderboard snapshot |
| `/wallets/discovery` | Wallet discovery stats + inline address lookup |
| `/wallets/leaderboard` | Full ranked wallet leaderboard |
| `/wallets/inposition` | Wallets with open positions right now |
| `/signals/feed` | Live signal event feed |
| `/signals/divergence` | Contrarian/divergence signals |
| `/signals/radar` | Market Radar — per-token cohort positioning view (Sprint 4) |
| `/signals/performance` | Signal recipe performance analytics — 24h directional accuracy ranked |

Old routes (`/scanner`, `/stalker`, `/contrarian`, `/imbalance`, `/recipes`, `/edge`, `/performance`) redirect to their current equivalents.

### API Routes (`app/api/`)

- `refresh-cohort` — Vercel Cron endpoint (and manual trigger target); scores cohort, runs recipes, writes KV. Calls `pruneUnderperformers` in background via `after()`.
- `cohort-state` — Client polls this; reads KV, fires background refresh if stale >5 min
- `contrarian` — Powers the Divergence tab; reads KV, fires background refresh if stale
- `market-ticker` — Live price/change data for the ticker strip
- `wallet-profile`, `scanner-stats`, `recipe-performance`, `top-markets`, `deep-dive`, `signals-feed`, `market-radar`, `measure-outcomes`

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

### Key Data Separation

- **Historical PnL** → `user_pnl_backtest` Supabase table (realized trades, used for scoring)
- **Live positions** → `cohort_snapshots` Supabase table (open positions, used for signals)
- Never conflate realized PnL with unrealized position changes.

### Regime Detection

BTC 24h return → BULL (>1%) / BEAR (<-1%) / RANGING. Feeds `regime_fit` factor in scoring. Thresholds are defined in `lib/cohort-engine.ts:detectRegime`.

### KV Cache Keys

| Key | Content | TTL |
|-----|---------|-----|
| `cohort:active` | Main cohort snapshot (scores + signals) | ~120s |
| `cohort:active:fallback` | Backup stale snapshot | longer |
| `cohort:cycle_offset` | Rotating window offset for partial cron cycles | persistent |
| `market-ticker:v4` | Live price/change data | short |
| `contrarian:latest` | Contrarian signal cache | ~120s |

Fallback chain on cache miss: primary key → fallback key → Supabase query.

### GitHub Actions

Three workflows:

- **`freshness-check.yml`** — Every 15 min. Hits `/api/cohort-state` and fails if `updated_at` is >1200s stale. Catches silent cron outages; emails repo admins on failure.
- **`daily-wallet-scan.yml`** — `0 0 * * *` UTC. Discovery, Streams A/C/D, backtests, full scoring for ~500 active wallets (up to 5,000 candidates). Writes Supabase + uploads `scan-summary.json` artifact (7d retention). 50-minute timeout.
- **`signal-learning.yml`** — `0 1 * * *` UTC (after scan finishes). Runs `scripts/signal-learning.ts` to update outcome stats. 20-minute timeout. Uploads `learning-summary.json` (14d retention).

All three support `workflow_dispatch` for manual runs.

### Tests

Tests live in `lib/__tests__/*.test.ts`. The setup file (`lib/__tests__/setup.ts`) injects placeholder env vars — no real Supabase or KV credentials needed. Coverage exists for: `cohort-engine`, `utils`, `recipe-config`, `signal-learning`, `outcome-helpers`, `token-tiers`, `radar-utils`, `hypurrscan-api-client`, `hypurrscan-enrichment`. API routes and React components are not unit-tested.

Mocking pattern uses `vi.mock()` for `@vercel/kv`, `@supabase/supabase-js`, and `@/lib/env`.

### API Auth

No OAuth on data routes. Auth relies on:
- `SUPABASE_SERVICE_ROLE_KEY` for all server-side reads/writes (backend only — never sent to browser)
- Optional `CRON_SECRET` header check in `refresh-cohort` to restrict the cron endpoint to Vercel's scheduler

### Adding Signal Recipes

Add to `lib/signal-lab.ts` following the `(pair: SnapshotPair) => SignalEvent[]` pattern. All 13 existing recipes are registered in the `runSignalLab` function. Add the display label + description to `lib/recipe-meta.ts` (keyed by the recipe ID string).

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
CRON_SECRET=                    # optional; restricts cron endpoint to Vercel scheduler
```

Backend routes use `SUPABASE_SERVICE_ROLE_KEY` (full access). Client uses anon key.
