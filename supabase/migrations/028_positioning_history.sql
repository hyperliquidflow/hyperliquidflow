-- 028_positioning_history.sql
--
-- Daily record of which side the tracked cohort is on, so a history exists to
-- chart later.
--
-- Written because the chart was asked for and could not honestly be drawn.
-- cohort_snapshots holds only nine days with usable rows, gaps of five and
-- twenty days, and per-day wallet coverage swinging from 16 to 222. A line
-- through that moves because the sample changed, not because positioning did.
--
-- Hence wallets and positions are stored on every row and are not optional. A
-- reader must be able to see that a point came from 16 wallets before trusting
-- where it sits, and the chart must be able to drop thin days rather than
-- silently drawing them.

create table if not exists positioning_history (
  day                date        primary key,
  long_notional      numeric     not null,
  short_notional     numeric     not null,
  pct_short          numeric,          -- share of notional on the short side
  top100_pct_short   numeric,          -- same, for the 100 positions with the most open profit
  wallets            integer     not null,
  positions          integer     not null,
  recorded_at        timestamptz not null default now()
);

comment on table positioning_history is
  'One row per UTC day, upserted through the day by refresh-cohort. Last write of the day wins, and recorded_at says when that was.';

comment on column positioning_history.wallets is
  'Wallet count behind this row. A point built from few wallets is not comparable to one built from many; do not chart a day below the threshold the reader is told about.';

comment on column positioning_history.top100_pct_short is
  'Positions ranked by unrealised PnL, top 100. Winning now, which in a falling market mostly means short, so read it against pct_short rather than alone.';

alter table positioning_history enable row level security;
