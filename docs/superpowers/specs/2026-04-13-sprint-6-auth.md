# Sprint 6 — Auth System

**Date:** 2026-04-13  
**Status:** Planned — do not implement until Sprint 5 is complete  
**Depends on:** Sprint 5 (alerts + paper trading localStorage layer)

---

## Goal

Add user accounts so that followed wallets, alert history, and paper portfolios persist across devices and browsers.

---

## Approach

Supabase Auth (email/password). Wallet-connect login (sign message) as optional phase 2.

---

## What Gets Built

### Auth Layer
- Supabase Auth with email/password
- Login / signup pages
- Session management via Supabase client
- Protected routes for /wallets/following and /wallets/paper

### Database Tables

```sql
CREATE TABLE user_wallet_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  wallet_address text NOT NULL,
  label text,
  followed_at timestamptz DEFAULT now(),
  alert_on text[] DEFAULT '{"open","close","resize"}',
  paper_copy boolean DEFAULT false,
  UNIQUE(user_id, wallet_address)
);

CREATE TABLE user_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  wallet_address text NOT NULL,
  event_type text NOT NULL,
  asset text NOT NULL,
  side text NOT NULL,
  size_usd numeric,
  price numeric,
  detected_at timestamptz DEFAULT now(),
  seen boolean DEFAULT false
);

CREATE TABLE user_paper_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  source_wallet text NOT NULL,
  asset text NOT NULL,
  side text NOT NULL,
  size_usd numeric NOT NULL,
  entry_price numeric NOT NULL,
  opened_at timestamptz DEFAULT now(),
  status text DEFAULT 'open',
  exit_price numeric,
  closed_at timestamptz,
  realized_pnl numeric
);
```

### Hook Migration

The hooks built in Sprint 5 (`useFollowedWallets`, `useAlertEvents`, `usePaperPositions`) swap their storage backend from localStorage to Supabase queries. Component layer unchanged.

### localStorage Migration

On first login, import existing localStorage data into the user's Supabase tables. One-time migration on auth success.

---

## Spec Status

This spec is a placeholder. Full design session to be run when Sprint 5 ships.
