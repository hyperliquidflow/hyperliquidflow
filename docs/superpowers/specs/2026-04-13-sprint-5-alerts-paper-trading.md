# Sprint 5 — Wallet Alerts + Paper Copy Trading

**Date:** 2026-04-13  
**Status:** Ready when Sprint 1 complete  
**Depends on:** Sprint 1 (wallet tier infrastructure, wallet profile pages)  
**Auth note:** localStorage-first. Data model designed for Sprint 6 auth migration.

---

## Goal

Let users follow specific wallets, get notified when those wallets open/close/resize positions, and optionally simulate copy-trading them with a virtual paper portfolio.

---

## Part A — Wallet Alerts

### What triggers an alert

On each `/api/cohort-state` poll (every 60s), the client compares incoming positions against the last-seen positions stored in localStorage.

Three event types:
- `POSITION_OPENED` — asset appears in new snapshot, not in previous
- `POSITION_CLOSED` — asset was in previous snapshot, gone from new
- `POSITION_RESIZED` — same asset, `szi` changed by more than 10%

Only fires for wallets in the user's `followed_wallets` list.

### localStorage schema

```ts
// Key: "hl_followed_wallets"
type FollowedWallet = {
  address: string
  label?: string           // user-set nickname
  followed_at: string      // ISO timestamp
  alert_on: ('open' | 'close' | 'resize')[]
  paper_copy: boolean      // whether to auto-log paper trades
}

// Key: "hl_alert_events"
type AlertEvent = {
  id: string               // uuid
  wallet_address: string
  event_type: 'POSITION_OPENED' | 'POSITION_CLOSED' | 'POSITION_RESIZED'
  asset: string
  side: 'long' | 'short'
  size_usd: number
  price: number
  detected_at: string      // ISO timestamp
  seen: boolean
}

// Key: "hl_wallet_snapshots"
// Previous snapshot per followed wallet for diffing
type WalletSnapshotCache = Record<string, PositionSnapshot[]>
```

### Alert detection logic

Lives in a client-side utility `lib/alert-engine.ts`:

```
diffPositions(prev: Position[], current: Position[], walletAddress: string): AlertEvent[]
```

Called inside the existing `useQuery` hook that polls `/api/cohort-state`. On each successful poll, diff positions for each followed wallet and store new events.

### UI — Alert Bell

- Bell icon in top nav (or sidebar) with red badge showing unseen event count
- Clicking opens an alert drawer (slide-in panel from right)
- Events listed newest-first, grouped by wallet
- Each event shows: wallet address/label, event type, asset, side, size, time ago
- "Mark all seen" button clears badge
- Events expire after 7 days (clean up on mount)

### UI — Wallet Profile "Follow" Button

- On each wallet profile page, add "Follow" button
- Opens a small modal: set nickname, choose alert types (open/close/resize), toggle paper copy
- Saves to localStorage
- Button changes to "Following" with unfollow option

### UI — `/wallets/following` Page

- List of followed wallets with their tier badge, current open positions, 24h PnL
- Alert preference toggles per wallet
- Paper copy toggle per wallet
- "Unfollow" button

---

## Part B — Paper Copy Trading

### How it works

When a followed wallet opens a position AND `paper_copy = true` for that wallet:
- Record a paper position at the detection price (current price at time of alert event)
- Track P&L in real time using live prices from `/api/market-ticker`
- When the followed wallet closes, close the paper position at detection price

### localStorage schema

```ts
// Key: "hl_paper_positions"
type PaperPosition = {
  id: string
  source_wallet: string       // address of followed wallet
  asset: string
  side: 'long' | 'short'
  size_usd: number            // virtual USD size (fixed $100 default, configurable)
  entry_price: number
  opened_at: string
  status: 'open' | 'closed'
  exit_price?: number
  closed_at?: string
  realized_pnl?: number
}

// Key: "hl_paper_settings"
type PaperSettings = {
  default_size_usd: number    // virtual size per trade, default $100
  size_mode: 'fixed' | 'proportional'  // fixed = same USD every trade
}
```

### P&L calculation

For open paper positions: `unrealized_pnl = (current_price - entry_price) / entry_price * size_usd * (side === 'long' ? 1 : -1)`

Current prices sourced from the existing market-ticker API response cached in the React Query store.

### UI — `/wallets/paper` Page

**Open Positions section:**
- Table: Asset, Side, Entry Price, Current Price, P&L ($), P&L (%), Source Wallet, Age
- Total unrealized P&L stat at top

**Closed Positions section:**
- Same table with exit price, realized P&L
- Total realized P&L stat

**Settings:**
- Default virtual trade size (e.g. $100)
- Size mode toggle (fixed vs proportional)

**Performance comparison:**
- For each source wallet, show: Paper P&L vs Actual wallet P&L over same period
- Simple two-column stat: "Your paper: +$42" / "Wallet reality: +$380"

---

## Sprint 6 Migration Path

When auth ships, these localStorage keys map directly to Supabase tables:

| localStorage key | Supabase table |
|---|---|
| `hl_followed_wallets` | `user_wallet_follows (user_id, address, settings jsonb)` |
| `hl_alert_events` | `user_alert_events (user_id, ...)` |
| `hl_paper_positions` | `user_paper_positions (user_id, ...)` |

The UI components (`useFollowedWallets`, `useAlertEvents`, `usePaperPositions`) are built as hooks that abstract the storage layer — swapping localStorage for Supabase calls in Sprint 6 requires changing only the hook internals, not the components.

---

## New Nav Entries

- "Following" under Wallets section
- "Paper Trading" under Wallets section
- Update `CHILD_HEIGHTS` for Wallets section

---

## Acceptance Criteria

- [ ] `diffPositions()` correctly detects open/close/resize events between two snapshots
- [ ] Alert events stored in localStorage on each poll for followed wallets
- [ ] Bell badge shows correct unseen count
- [ ] Alert drawer renders events correctly, mark-seen works
- [ ] Follow button on wallet profile saves to localStorage
- [ ] `/wallets/following` page shows followed wallets with positions and PnL
- [ ] Paper positions created on POSITION_OPENED for paper_copy wallets
- [ ] Paper P&L updates on each market-ticker price update
- [ ] Paper positions closed on POSITION_CLOSED event
- [ ] `/wallets/paper` page renders open and closed positions correctly
- [ ] Settings (trade size) persist in localStorage
- [ ] All hooks use abstracted storage interface (ready for Sprint 6 swap)
- [ ] No em dashes, all colors from design tokens
