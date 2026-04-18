alter table wallets
  add column if not exists deactivation_reason  text,
  add column if not exists deactivated_at        timestamptz,
  add column if not exists low_equity_cycles     smallint not null default 0,
  add column if not exists low_buffer_cycles     smallint not null default 0;

create index if not exists idx_wallets_deactivation_reason
  on wallets(deactivation_reason)
  where deactivation_reason is not null;
