alter table wallets
  add column if not exists wash_score       numeric(5,3),
  add column if not exists sybil_cluster_id text;

create index if not exists idx_wallets_sybil_cluster
  on wallets(sybil_cluster_id)
  where sybil_cluster_id is not null;
