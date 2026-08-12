-- 026_factor_shadow.sql
--
-- Forward out-of-sample record for the positioning factor.
--
-- Both external reviews of the 2026-08-12 audit made the same point: extending
-- the cached history backward is a bigger backtest, not an out-of-sample test.
-- Only data that did not exist when the hypothesis was formed can confirm it.
-- This table is that data, accumulated one day at a time from today forward.
--
-- One row per coin per measurement day. The lean and the entry price are
-- written when the day is recorded; the forward return and funding are written
-- roughly 24 hours later, so no row can ever be scored with information that
-- was unavailable when it was created.
--
-- Pre-registration: docs/research/2026-08-12-preregistration-leads.md
--   Lead 1 forward gate, 60 calendar days, legs fixed at 5 a side by
--   Amendment 1, judged on the day-clustered mean of the traded book net of
--   the full cost model.

create table if not exists factor_shadow (
  measurement_date  date        not null,
  coin              text        not null,
  snapshot_at       timestamptz not null,
  lean_notional     numeric     not null,   -- cohort net signed notional, USD
  wallets_in_coin   integer     not null,
  coins_in_day      integer     not null,
  leg               text,                   -- 'long' | 'short' | null when unheld
  entry_price       numeric     not null,
  exit_price        numeric,
  resolved_at       timestamptz,
  hours_held        numeric,
  raw_return        numeric,                -- exit/entry - 1, unsigned by leg
  funding_sum       numeric,                -- summed hourly rate over the hold
  created_at        timestamptz not null default now(),
  primary key (measurement_date, coin),
  constraint factor_shadow_leg_check check (leg is null or leg in ('long','short'))
);

comment on table factor_shadow is
  'Forward out-of-sample record for the positioning factor. Written daily, resolved the next day. Never backfilled: a row whose entry price was not observed live is worthless here.';
comment on column factor_shadow.lean_notional is
  'Cohort net signed notional in this coin at snapshot time, summed over active wallets from cohort_snapshots.positions (sign of szi times positionValue).';
comment on column factor_shadow.funding_sum is
  'Sum of hourly funding rates over the hold. Positive means longs paid. Charge a long leg +funding_sum and credit a short leg the same amount.';

create index if not exists idx_factor_shadow_unresolved
  on factor_shadow (measurement_date)
  where resolved_at is null;

alter table factor_shadow enable row level security;
