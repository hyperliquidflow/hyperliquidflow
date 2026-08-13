-- 027_flow_capture.sql
--
-- Minute-level capture of the public WS trades feed, which carries both
-- counterparty addresses on every trade (docs say otherwise; measured on 732
-- trades, see docs/research/2026-08-13-websocket-coverage.md).
--
-- Raw is 0.50 GB/day for the full 177-coin universe, which is affordable to
-- collect and not to keep, so the collector aggregates to the minute before it
-- writes. Cardinality was measured rather than guessed:
--   coin-minute rows            ~22k/day
--   address-minute at $10k floor ~62k/day
--   address-minute at $50k floor ~23k/day
--
-- IMPORTANT, and the reason this schema records sides rather than signed flow:
-- the trade object carries `side` (B or A) and a two-element `users` array. Which
-- of the two addresses is the aggressor is NOT verified. Deriving signed
-- per-address flow before confirming that convention against userFillsByTime for
-- a known address would bake a coin-flip into every downstream number. The
-- columns below are convention-free: they record what was observed, and signed
-- flow becomes derivable once the convention is confirmed.

create table if not exists flow_coin_minute (
  minute             timestamptz not null,
  coin               text        not null,
  side_b_notional    numeric     not null default 0,
  side_a_notional    numeric     not null default 0,
  trade_count        integer     not null default 0,
  distinct_addresses integer     not null default 0,
  primary key (minute, coin)
);

comment on table flow_coin_minute is
  'Per coin per minute totals from the public WS trades feed. side_b/side_a are the exchange-reported trade side, not a resolved buyer and seller.';

create table if not exists flow_address_minute (
  minute          timestamptz not null,
  coin            text        not null,
  address         text        not null,
  side_b_notional numeric     not null default 0,
  side_a_notional numeric     not null default 0,
  trade_count     integer     not null default 0,
  primary key (minute, coin, address)
);

comment on table flow_address_minute is
  'Per counterparty per coin per minute. Written only above the collector notional floor, so absence means below floor, never zero activity.';

comment on column flow_address_minute.side_b_notional is
  'Notional of trades tagged side B in which this address was a counterparty. Aggressor identity is unverified; do not read this as buying.';

create index if not exists idx_flow_coin_minute_coin
  on flow_coin_minute (coin, minute desc);

create index if not exists idx_flow_address_minute_addr
  on flow_address_minute (address, minute desc);

create index if not exists idx_flow_address_minute_coin
  on flow_address_minute (coin, minute desc);

alter table flow_coin_minute    enable row level security;
alter table flow_address_minute enable row level security;
