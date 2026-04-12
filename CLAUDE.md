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
Vercel Cron (60s)            GitHub Actions (daily 2AM UTC)
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

### API Routes (`app/api/`)

- `refresh-cohort` — Vercel Cron endpoint; triggers background scoring + signal detection via Next.js `after()`
- `cohort-state` — Client polls this; reads KV, fires background refresh if stale >5 min
- `morning-scan`, `contrarian` (powers the Divergence tab in `/signals`; reads KV, fires background refresh if stale), `wallet-profile`, `scanner-stats`, `recipe-performance`, `top-markets`, `deep-dive`

### Key Data Separation

- **Historical PnL** → `user_pnl_backtest` Supabase table (realized trades, used for scoring)
- **Live positions** → `cohort_snapshots` Supabase table (open positions, used for signals)
- Never conflate realized PnL with unrealized position changes.

### Regime Detection

BTC 24h return → BULL (>2%) / BEAR (<-2%) / RANGING. Feeds `regime_fit` factor in scoring.

### Adding Signal Recipes

Add to `lib/signal-lab.ts` following the `(pair: SnapshotPair) => SignalEvent[]` pattern. All nine existing recipes are registered in the `runAllRecipes` function.

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
```

Backend routes use `SUPABASE_SERVICE_ROLE_KEY` (full access). Client uses anon key.
