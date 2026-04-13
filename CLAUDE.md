# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm run typecheck    # tsc --noEmit

# Run daily wallet scan locally (requires env vars)
npx tsx scripts/daily-wallet-scan.ts
```

## Architecture

**HyperliquidFLOW** is a Next.js 15 App Router app that tracks the top ~1200 Hyperliquid wallets, scores them, and surfaces trading signals. All heavy computation is server-side; the client is a thin React Query poller.

### Data Flow

```
Vercel Cron (60s)            GitHub Actions (daily 00:00 UTC)
  /api/refresh-cohort          scripts/daily-wallet-scan.ts
  ├─ fetch up to 100 wallets   ├─ full 1200-wallet cohort
  ├─ score wallets             ├─ backtests + full scoring
  ├─ run 9 signal recipes      └─ writes Supabase + artifact
  ├─ write Supabase
  └─ cache snapshot → KV

Browser (React)
  useQuery("/api/cohort-state") every 60s
    ├─ read KV snapshot (fast path)
    └─ fallback to Supabase on KV miss
```

**Cron budget:** `/api/refresh-cohort` must complete in ≤10s on Vercel free tier — that's why full cohort scoring lives in GitHub Actions, not the cron.

### Core Engines (`lib/`)

| File | Purpose |
|------|---------|
| `cohort-engine.ts` | Four-factor wallet scoring: Sharpe proxy, PnL consistency, drawdown, regime fit |
| `signal-lab.ts` | 9 pluggable signal recipes — each takes `SnapshotPair → SignalEvent[]` |
| `risk-engine.ts` | EV calculation, liquidation price, margin ratio, Hyperliquid fee schedule |
| `hyperliquid-api-client.ts` | Raw Hyperliquid API: clearinghouse states, market data, fill history |
| `env.ts` | Central env var access — never read `process.env` directly elsewhere |
| `recipe-meta.ts` | Single source of truth for signal recipe `label` + `desc` strings (used by Overview, Signals, Edge) |
| `design-tokens.ts` | All visual design tokens: `color`, `type`, `space`, `radius`, `shadow`, `effect`, `layout`, `anim`, `card`, `row` |

### Pages (`app/`)

| Route | Purpose |
|-------|---------|
| `/` | Overview — stat cards, live signal feed, wallet leaderboard snapshot |
| `/brief` | Daily Brief — daily scan summary |
| `/wallets/discovery` | Wallet discovery stats + inline address lookup |
| `/wallets/leaderboard` | Full ranked wallet leaderboard |
| `/wallets/inposition` | Wallets with open positions right now |
| `/signals/feed` | Live signal event feed |
| `/signals/divergence` | Contrarian/divergence signals (formerly Imbalance) |
| `/edge` | Signal recipe performance analytics (formerly Recipes) |
| `/daily` | Daily scan redirect to /brief |

### API Routes (`app/api/`)

- `refresh-cohort` — Vercel Cron endpoint; triggers background scoring + signal detection via Next.js `after()`
- `cohort-state` — Client polls this; reads KV, fires background refresh if stale >5 min
- `contrarian` — Powers the Divergence tab; reads KV, fires background refresh if stale
- `market-ticker` — Live price/change data for the ticker strip
- `daily-scan`, `wallet-profile`, `scanner-stats`, `recipe-performance`, `top-markets`, `deep-dive`

### Key Data Separation

- **Historical PnL** → `user_pnl_backtest` Supabase table (realized trades, used for scoring)
- **Live positions** → `cohort_snapshots` Supabase table (open positions, used for signals)
- Never conflate realized PnL with unrealized position changes.

### Regime Detection

BTC 24h return → BULL (>2%) / BEAR (<-2%) / RANGING. Feeds `regime_fit` factor in scoring.

### Adding Signal Recipes

Add to `lib/signal-lab.ts` following the `(pair: SnapshotPair) => SignalEvent[]` pattern. All nine existing recipes are registered in the `runAllRecipes` function. Add the display label + description to `lib/recipe-meta.ts` (keyed by the recipe ID string).

### Nav Structure

The nav is defined in `components/nav.tsx` in the `NAV` array. Expandable sections (Wallets, Signals) also need their pixel height registered in `CHILD_HEIGHTS` so the CSS max-height animation works correctly.

## Copy Rules

- **No em dashes (—) or en dashes (–) in any user-facing copy.** This applies to all JSX/TSX string literals, template strings, and rendered text across every page and component. Use a comma, period, or rewrite the sentence instead. Dashes in code comments are fine. A PreToolUse hook in `.claude/settings.json` will block writes that violate this.

## Color Rules

- **Always use design token colors for semantic states.** Import from `@/lib/design-tokens` — never use arbitrary hex values like `#4ade80` or `#f87171`. Key tokens:
  - `color.green` = `#6aaa7a` (positive/bullish)
  - `color.red` = `#b06868` (negative/bearish)
  - `color.blue` = `#60a5fa` (neutral signal)
  - `color.amber` = `#f59e0b` (warning)
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
