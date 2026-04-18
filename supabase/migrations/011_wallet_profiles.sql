create table if not exists wallet_profiles (
  wallet_id         uuid primary key references wallets(id) on delete cascade,
  computed_at       timestamptz not null default now(),
  trading_style     text check (trading_style in ('SCALPER', 'SWING', 'TREND')),
  pnl_consistency   numeric(6, 4),
  bull_daily_pnl    numeric(12, 2),
  bear_daily_pnl    numeric(12, 2),
  ranging_daily_pnl numeric(12, 2),
  regime_edge       numeric(6, 4),
  current_coins     text[],
  regime_day_counts jsonb
);

create index if not exists idx_wallet_profiles_style
  on wallet_profiles(trading_style)
  where trading_style is not null;
