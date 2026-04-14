-- supabase/migrations/005_entity_type.sql
-- Adds entity identity columns to the wallets table.
-- entity_type: classification of the wallet (cex, deployer, protocol, gambling, fund, known, unknown)
-- entity_label: raw label string from Hypurrscan /globalAliases or /tags
-- Populated by scripts/daily-wallet-scan.ts and scripts/bootstrap-hypurrscan-index.ts.

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS entity_type  TEXT NOT NULL DEFAULT 'unknown'
    CHECK (entity_type IN ('cex','deployer','protocol','gambling','fund','known','unknown')),
  ADD COLUMN IF NOT EXISTS entity_label TEXT;

-- Index: daily scan queries wallets WHERE entity_type IN ('cex','deployer') to deactivate them.
CREATE INDEX IF NOT EXISTS idx_wallets_entity_type ON wallets (entity_type);

COMMENT ON COLUMN wallets.entity_type  IS 'Hypurrscan-derived entity classification';
COMMENT ON COLUMN wallets.entity_label IS 'Raw label from Hypurrscan globalAliases';
