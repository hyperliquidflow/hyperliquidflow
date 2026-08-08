-- 2026-08-08 audit cleanup.
-- signal_events: writer deleted 2026-04-17, readers removed in the same change set.
-- rate_limit_tokens: seeded in R25, never read or written by any code.
DROP TABLE IF EXISTS signal_events;
DROP TABLE IF EXISTS rate_limit_tokens;

-- Extend retention from 30 to 180 days. The learning gate needs outcomes to
-- accumulate; 30-day retention capped the table at ~5 rows at current volume.
-- cron.schedule with an existing jobname replaces that job in place.
SELECT cron.schedule(
  'cleanup-old-signals',
  '5 3 * * *',
  $$
    DELETE FROM signals_history
    WHERE detected_at < NOW() - INTERVAL '180 days';
  $$
);

SELECT cron.schedule(
  'cleanup-old-signal-outcomes',
  '15 3 * * *',
  $$
    DELETE FROM signal_outcomes
    WHERE created_at < NOW() - INTERVAL '180 days';
  $$
);
