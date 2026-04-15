# Signal Intelligence Agent — Design Spec

**Date:** 2026-04-15
**Status:** Approved for implementation
**Scope:** Outcome measurement, learning pipeline, Claude agent reasoning layer, VSCode skill

---

## Overview

A quant intelligence layer built on top of HyperliquidFLOW that measures every signal's real outcome, learns which recipes work in which conditions, and gets better over time. Built with a conservative, evidence-first philosophy: the agent observes before it acts, and validates every change it makes.

**End goal:** signals the agent has validated become the foundation for paper trading (Sprint 5) and eventually live trade execution (Phase D). The track record produced here is what makes that transition trustworthy.

---

## Four-Layer Architecture

```
Layer 1: Data (Supabase)
  signal_events → signal_outcomes → agent_findings
  agent_config + agent_config_history → agent_log

Layer 2: Measurement Pipeline
  Vercel Cron (hourly)    → price outcome checks at T+1h, T+4h, T+24h
  GitHub Actions 00:00    → daily-wallet-scan.ts (existing) resolves wallet PnL outcomes
  GitHub Actions 01:00    → signal-learning.ts (new) stats engine + agent run

Layer 3: Intelligence
  Stats engine            → computes findings from signal_outcomes
  Claude Agent (Haiku)    → nightly: reads findings, reasons, acts on config
  Claude Agent (Sonnet)   → VSCode skill: on-demand expertise while coding

Layer 4: Output
  /agent page             → agent log feed, config history, outcome tracker, calibration
  agent_config table      → recipes read params at runtime (replaces hardcoded constants)
  /signal-expert skill    → VSCode skill for live recipe expertise
```

**Cost estimate:** ~$2–3/month. Haiku for nightly batch (structured input/output), Sonnet for VSCode skill (reasoning quality matters). Prompt caching on repeated recipe context reduces this further.

---

## Data Layer — Six Tables

### `signal_events`
Persistent signal store. Written at fire time in `refresh-cohort`. This replaces KV as the source of truth for signals — KV TTL eviction means outcomes cannot be measured reliably without this table.

```sql
id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY
signal_hash           TEXT UNIQUE NOT NULL  -- sha256(recipe_id||coin||direction||snapshot_time)
recipe_id             TEXT NOT NULL
coin                  TEXT NOT NULL
signal_type           TEXT NOT NULL         -- ENTRY|EXIT|SCALE_IN|SCALE_OUT|FLIP|ALERT
direction             TEXT                  -- LONG|SHORT|null
ev_score              FLOAT
wallet_ids            TEXT[]                -- all wallets that triggered this signal
snapshot_time         TIMESTAMPTZ NOT NULL
fired_at              TIMESTAMPTZ NOT NULL DEFAULT now()
regime_at_fire        TEXT NOT NULL         -- BULL|BEAR|RANGING
btc_price_at_fire     FLOAT NOT NULL
funding_rate_at_fire  FLOAT                 -- for the signal's coin
oi_at_fire            FLOAT                 -- open interest on coin
volume_24h_at_fire    FLOAT
active_config         JSONB NOT NULL        -- snapshot of agent_config at fire time
metadata              JSONB
```

**Key design decision:** `active_config` records the exact threshold values active when the signal fired. Without this, the stats engine cannot segment outcomes by which config produced them — making simulation and attribution impossible.

**Dedup:** `ON CONFLICT (signal_hash) DO NOTHING` on every write. Safe to retry.

**Write timing:** Signal writes happen via `after()` in `refresh-cohort` — fire-and-forget, same pattern as `pruneUnderperformers`. This keeps the cron response within the 10s Vercel free tier budget. Writes complete in the background after the response is served.

---

### `signal_outcomes`
One row per signal. Columns filled progressively as time windows pass.

```sql
signal_id             UUID PRIMARY KEY REFERENCES signal_events
price_at_fire         FLOAT NOT NULL
price_1h              FLOAT
price_4h              FLOAT
price_24h             FLOAT
move_pct_1h           FLOAT
move_pct_4h           FLOAT                -- primary evaluation window
move_pct_24h          FLOAT
direction_ok_4h       BOOLEAN              -- price moved >0.5% correct direction within 4h
price_win             BOOLEAN              -- set at 4h: direction_ok_4h AND move_pct_4h > win_threshold
is_win                BOOLEAN              -- set lazily: price_win = true AND wallet_outcome = WIN
wallet_return_avg     FLOAT                -- avg(realized_pnl / position_notional) across wallet_ids — normalized return, not raw PnL
wallet_outcome        TEXT                 -- WIN|LOSS|OPEN
confirming_recipe_ids TEXT[]               -- filled by measure-outcomes cron: other recipes that fired same coin/direction within ±10 min
confirmation_count    INT DEFAULT 0
measured_at           TIMESTAMPTZ
```

**Two-stage win tracking:**
- `price_win` is set immediately when the 4h window passes. Used by the stats engine for fast win rate calculations.
- `is_win` is set lazily once `wallet_outcome` resolves (wallet closes position). Used for EV calculation and the strongest true positive signal. May remain null for days if a wallet holds a position long-term.

**Why `wallet_return_avg` not raw PnL:** An Elite wallet making $50K on a $2M position has the same dollar figure as a Micro wallet making $50K on a $50K position. Normalized return (PnL / notional) makes wallet outcomes comparable across tiers and position sizes.

**confirming_recipe_ids population:** Filled by the measure-outcomes cron when writing the signal_outcomes row. Queries `signal_events WHERE coin = X AND direction = Y AND fired_at BETWEEN signal.fired_at - 10min AND signal.fired_at + 10min AND recipe_id != signal.recipe_id`.

---

### `agent_config`
Current recipe parameters. Recipes read from this table at runtime instead of using hardcoded constants. Fast reads via KV cache with Supabase as source of truth.

```sql
recipe_id             TEXT NOT NULL
param_name            TEXT NOT NULL
param_value           FLOAT NOT NULL
locked_by_human       BOOLEAN DEFAULT false   -- agent cannot override when true
next_eligible_change  TIMESTAMPTZ             -- 14-day cooldown after any change
last_change_run_id    TEXT                    -- GitHub Actions run ID, prevents double-change per run
updated_at            TIMESTAMPTZ
PRIMARY KEY (recipe_id, param_name)
```

**Cooldown rule:** After any config change, `next_eligible_change` is set to now + 14 days. The nightly script skips any param where this is in the future. This ensures each change has time to produce measurable outcomes before further tuning.

**One-change-per-run:** Before any change, the script checks `last_change_run_id`. If it matches the current GitHub Actions run ID for any param on this recipe, all further changes to this recipe are skipped. This guarantees single-variable attribution.

---

### `agent_config_history`
Append-only audit trail. Never mutated, only inserted.

```sql
id                    UUID DEFAULT gen_random_uuid()
recipe_id             TEXT NOT NULL
param_name            TEXT NOT NULL
old_value             FLOAT NOT NULL
new_value             FLOAT NOT NULL
changed_by            TEXT NOT NULL         -- agent|human
change_reason         TEXT NOT NULL
agent_log_id          UUID REFERENCES agent_log
changed_at            TIMESTAMPTZ DEFAULT now()
```

---

### `agent_findings`
Nightly stats engine output. One row per recipe × regime combination per run.

```sql
id                          UUID DEFAULT gen_random_uuid()
recipe_id                   TEXT NOT NULL
regime                      TEXT NOT NULL              -- BULL|BEAR|RANGING|ALL
period_days                 INT NOT NULL
sample_size                 INT NOT NULL
meets_min_sample            BOOLEAN NOT NULL           -- sample_size >= 30
confidence                  FLOAT NOT NULL             -- 0-1 statistical confidence
win_rate_7d                 FLOAT
win_rate_30d                FLOAT
win_rate_90d                FLOAT
trend                       TEXT NOT NULL              -- IMPROVING|DEGRADING|STABLE|INSUFFICIENT_DATA
avg_win_pct                 FLOAT
avg_loss_pct                FLOAT
measured_ev                 FLOAT                      -- win_rate × avg_win + (1-win_rate) × avg_loss
baseline_ev                 FLOAT                      -- coin's baseline directional drift
vs_baseline_ev              FLOAT                      -- measured_ev minus baseline_ev (true edge)
win_rate_by_regime          JSONB                      -- { BULL: x, BEAR: y, RANGING: z } last 30d
dominant_regime_last_30d    TEXT                       -- which regime dominated the period
finding_type                TEXT NOT NULL              -- UNDERPERFORMING|IMPROVING|STABLE|ANOMALY
recommendation              TEXT
rec_param                   TEXT
rec_value                   FLOAT
created_at                  TIMESTAMPTZ DEFAULT now()
```

**Baseline EV:** Computed as the average directional drift of the coin over the same period with no signal filter. `vs_baseline_ev` is the agent's real edge — a recipe with `measured_ev = 0.4%` but `baseline_ev = 0.5%` has negative edge in that regime.

**Minimum sample gate:** The agent must not recommend changes on findings where `meets_min_sample = false`. 80% win rate on 8 samples is noise.

**Regime shift detection:** If `win_rate_30d` is low but checking `win_rate_by_regime` shows the drop correlates with the `dominant_regime_last_30d`, the recipe may not be broken — it just needs regime-conditional logic. The agent distinguishes these two cases.

---

### `agent_log`
The agent's journal. Every observation, decision, and outcome lives here.

```sql
log_id                UUID DEFAULT gen_random_uuid()
created_at            TIMESTAMPTZ DEFAULT now()
log_type              TEXT NOT NULL        -- OBSERVATION|RECOMMENDATION|CONFIG_CHANGE|PR_OPENED|FOLLOW_UP|CALIBRATION
recipe_id             TEXT
content               TEXT NOT NULL        -- agent's full reasoning in plain language
summary               TEXT NOT NULL        -- one-line summary for UI feed
agent_confidence      FLOAT                -- 0-1, how confident was the agent in this decision
action_taken          TEXT
follow_up_due_at      TIMESTAMPTZ          -- set when action_taken = CONFIG_CHANGE
follow_up_finding_id  UUID REFERENCES agent_findings
resolution            TEXT                 -- IMPROVED|DEGRADED|NEUTRAL|PENDING
metadata              JSONB
```

**Follow-up loop:** When the agent makes a config change, `follow_up_due_at` is set to now + 14 days and `resolution = PENDING`. The nightly script checks for pending follow-ups, computes win rate before vs after the change date, writes a FOLLOW_UP log entry, and sets resolution. If `DEGRADED`, the script rolls back `agent_config` to the previous value and logs the rollback.

**Calibration:** Weekly, the nightly script groups resolved log entries by `agent_confidence` bucket and computes actual improvement rates. A CALIBRATION log entry is written: "Confidence 0.80–0.89 → actual improvement rate 61% (30 resolved decisions)."

The calibration addendum is stored in KV at key `agent:calibration_addendum` and appended to the base system prompt at runtime. The nightly script writes a fresh addendum after each calibration pass. This keeps the prompt dynamic without requiring code changes or PRs.

---

## Required Indexes

Must be created alongside table migrations. Without these, stats engine queries will full-scan as signal volume grows.

```sql
-- signal_events
CREATE INDEX ON signal_events (recipe_id, fired_at, regime_at_fire);
CREATE INDEX ON signal_events (coin, fired_at);

-- signal_outcomes: fast lookup for unfilled windows and pending wallet resolution
CREATE INDEX ON signal_outcomes (measured_at) WHERE price_4h IS NULL;
CREATE INDEX ON signal_outcomes (wallet_outcome) WHERE wallet_outcome = 'OPEN';

-- agent_log: recipe history lookups + pending follow-up checks
CREATE INDEX ON agent_log (recipe_id, created_at DESC);
CREATE INDEX ON agent_log (resolution) WHERE resolution = 'PENDING';
CREATE INDEX ON agent_log (follow_up_due_at) WHERE follow_up_due_at IS NOT NULL;

-- agent_findings: latest finding per recipe
CREATE INDEX ON agent_findings (recipe_id, created_at DESC);
```

---

## Measurement Pipeline

### Vercel Cron — `/api/measure-outcomes` (new, runs every hour)

Finds `signal_events` where the 1h/4h/24h outcome windows have passed but are not yet filled. Fetches current price from Hyperliquid API. Writes to `signal_outcomes`. Logic:

```
for each signal in signal_events with unfilled outcome windows:
  if fired_at + 1h <= now and price_1h is null:   fill price_1h, move_pct_1h
  if fired_at + 4h <= now and price_4h is null:   fill price_4h, move_pct_4h, direction_ok_4h, is_win
  if fired_at + 24h <= now and price_24h is null:  fill price_24h, move_pct_24h
```

**Batching:** Processes at most 50 signals per tick, `ORDER BY fired_at ASC` (oldest unfilled first). Prevents timeout on large backlogs and avoids hammering the Hyperliquid price API.

**Late measurement tolerance:** If the cron misses a run (Vercel free tier), it catches up on the next tick. A signal measured at T+1h20m instead of T+1h is still valid — the window is "at least 1h has passed," not exact.

**Vercel cron slots:** The free tier allows 2 cron functions. Slot 1 is `/api/refresh-cohort` (every 60s). Slot 2 is `/api/measure-outcomes` (every hour). Both slots are consumed — no further cron additions are possible without upgrading.

### GitHub Actions 00:00 — `daily-wallet-scan.ts` (modified)

Existing script. Add: for any signal in `signal_outcomes` where `wallet_outcome = OPEN`, check if the triggering wallets have closed their positions in the new scan data. If so, compute `wallet_pnl_avg` and set `wallet_outcome = WIN|LOSS`.

### GitHub Actions 01:00 — `signal-learning.ts` (new)

**Cold start guard:** If `signal_outcomes` total < 100 rows or oldest signal < 30 days ago, agent writes OBSERVATION: "Insufficient history. Monitoring only." No config changes permitted.

**Stats engine:**
1. Pull all `signal_outcomes` with `is_win` resolved from last 90 days
2. Join `signal_events` to get `active_config`, `regime_at_fire`, `confirming_recipe_ids`
3. Group by recipe × regime × active_config values
4. Compute: win_rate_7d/30d/90d, trend, avg_win_pct, avg_loss_pct, measured_ev, baseline_ev
5. Compute `win_rate_by_regime` and `dominant_regime_last_30d`
6. Write rows to `agent_findings`

**Claude Agent (Haiku):**

Receives structured findings. Runs through this sequence for each recipe with a finding:

1. Check `meets_min_sample` and `confidence` — skip if either fails
2. Query `agent_log WHERE recipe_id = X` — read all past decisions and their resolutions
3. Detect regime shift: does the underperformance correlate with regime, or is it recipe-wide?
4. If recommending a param change: run `simulate_threshold_change` first
5. Check `next_eligible_change` — skip if cooldown active
6. Check `last_change_run_id` — skip if another param already changed this recipe this run
7. If all gates pass and confidence > 0.80: write in this order — (a) `agent_log` entry first, capture `log_id`, (b) `agent_config_history` with that `log_id`, (c) update `agent_config`, (d) set `follow_up_due_at = now() + 14 days` and `last_change_run_id = current run ID`
8. If gates fail: write OBSERVATION to `agent_log` explaining why no action was taken

---

## The Learning Loop (end-to-end)

```
Signal fires
  └─ signal_events written: signal_hash (dedup), active_config, market context

Vercel Cron (hourly)
  └─ price outcomes filled at T+1h, T+4h, T+24h
  └─ is_win computed at 4h

GitHub Actions 00:00
  └─ wallet_outcome resolved when triggering wallet closes position

GitHub Actions 01:00
  └─ Stats engine: win rates, EV, trend per recipe × regime × config
  └─ Agent reads findings
  └─ Agent reads own history: past decisions + resolutions on this recipe
  └─ Agent checks: is this regime-driven or recipe-driven?
  └─ Agent simulates threshold change before committing
  └─ Agent applies conservative gates: confidence > 0.80, sample >= 30
  └─ If change made: config updated, follow_up_due_at set in 14 days

14 days later
  └─ Nightly script finds pending follow-ups
  └─ Compares win_rate before vs after change date
  └─ Writes resolution: IMPROVED | DEGRADED | NEUTRAL
  └─ If DEGRADED: rolls back config, logs rollback

Next time agent considers Recipe X
  └─ Reads: "14 days ago I raised MIN_WALLETS 3→4. Resolution: IMPROVED."
  └─ Uses this as evidence — similar pattern = higher confidence
  └─ Calibration: is my stated confidence matching actual improvement rates?
```

---

## Agent System Prompt (core principles)

The agent's prompt encodes expertise. Key rules:

**Identity:** Quantitative trading analyst specializing in on-chain perps. Conservative by default — a false positive signal (bad trade) costs more than a missed signal.

**Before any recommendation:**
- Check `agent_log` for all past decisions on this recipe
- Weight resolutions from last 60 days 3x over older resolutions
- Resolutions older than 6 months are historical context only

**Metric hierarchy:**
1. `vs_baseline_ev` (edge over coin drift) — primary
2. `measured_ev` (raw expected value) — secondary
3. `win_rate_30d` — tertiary only; never optimize win rate at cost of EV

**Conservative change rules:**
- Never change a param by more than 20% in one run
- Never act on confidence below 0.80
- Never act on sample_size below 30
- One change per recipe per run maximum
- When in doubt: write OBSERVATION, not RECOMMENDATION

**Regime awareness:** Always distinguish "recipe underperforming" from "regime shifted." If `win_rate_by_regime` shows underperformance concentrated in one regime, recommend a regime-conditional adjustment, not a global param change.

**Learning from mistakes:** When a past change shows `resolution = DEGRADED`, apply a 30-day self-imposed higher confidence bar (0.90 instead of 0.80) before touching that recipe's params again.

---

## Simulation Tool

Runs at agent query time against `signal_outcomes`. Not a table.

```
simulate_threshold_change(recipe_id, param, new_value, lookback_days)
  → filters historical signal_outcomes where active_config[param] matches current value
  → splits into: signals that would remain vs signals that would be filtered by new_value
  → computes: win_rate_kept, win_rate_filtered, sample_sizes
  → returns: precision impact, recall impact, net EV impact
```

Example output: "Raising MIN_WALLETS 3→4 on momentum_stack in BULL regime: filters 12 of 35 signals. Filtered signals: 9 losses, 3 wins. Remaining 23 signals: win rate 71% vs current 52%. Net EV improves from 0.3% to 0.9%. Confidence: 0.84. Recommend: yes."

---

## Recipe Config Migration

All hardcoded thresholds in `signal-lab.ts` are replaced with runtime reads from `agent_config` via KV cache.

```typescript
// lib/recipe-config.ts
export async function getRecipeConfig(
  recipeId: string
): Promise<Record<string, number>> {
  const cacheKey = `recipe:config:${recipeId}`;
  const cached = await kv.get<Record<string, number>>(cacheKey);
  if (cached) return cached;

  const { data } = await supabase
    .from("agent_config")
    .select("param_name, param_value")
    .eq("recipe_id", recipeId);

  const config = Object.fromEntries(
    (data ?? []).map((r) => [r.param_name, r.param_value])
  );
  await kv.set(cacheKey, config, { ex: 300 }); // 5-min TTL
  return config;
}
```

On first deploy: a migration seeds `agent_config` with the current hardcoded values as defaults.

---

## `/agent` Page

New route. Shows:

- **Agent log feed** — scrollable journal of observations, recommendations, changes
- **Recipe performance matrix** — win_rate × regime grid for all recipes, color-coded by edge
- **Config change history** — what was tuned, when, result
- **Calibration panel** — agent confidence vs actual improvement rate over time
- **Pending follow-ups** — changes waiting for resolution
- **Lock/unlock controls** — toggle `locked_by_human` per param without touching Supabase directly

---

## VSCode `/signal-expert` Skill

Invoked while editing recipes. Context passed to Sonnet agent:

1. Current file contents (the recipe being edited)
2. `agent_config` values for recipes in the file
3. `agent_findings` for those recipes (last 30 days)
4. `agent_log` for those recipes (last 20 entries, most recent first)
5. Recent `signal_outcomes` sample (last 50 signals for those recipes)

The agent responds with:
- Current performance summary for the recipe
- What each param is doing and why the current value was set
- Risk of the specific change being considered
- Historical precedent from `agent_log` (did we try this before?)
- Plain recommendation

---

## Rollout Phases

### Phase 1 — Foundation (Weeks 1–2)
- Supabase migrations for all 6 tables
- `signal_events` write in `refresh-cohort` (with dedup)
- `/api/measure-outcomes` Vercel cron
- `agent_config` seeded with current hardcoded values
- Recipes read from `agent_config` via KV cache

### Phase 2 — Stats Engine (Weeks 3–4)
- `signal-learning.ts` GitHub Actions workflow
- Stats computation: win rates, EV, trend, regime breakdown
- Cold start guard
- `agent_findings` populated nightly
- `signal_outcomes` wallet resolution in `daily-wallet-scan.ts`

### Phase 3 — Claude Agent (Weeks 5–6)
- Haiku agent integrated into `signal-learning.ts`
- Agent tools: get_findings, get_agent_log, simulate_threshold_change, update_config, write_log
- Follow-up resolution logic
- Calibration CRON

### Phase 4 — Output Layer (Week 7)
- `/agent` page with all panels
- `/signal-expert` VSCode skill

### Phase 5 — Validation (Week 8+)
- 30+ days of outcome data accumulated
- First real agent recommendations reviewed
- Cold start guard lifts
- First config changes made by agent (under your supervision)

---

## Success Criteria

- Every signal fired is persisted and measured (no KV eviction loss)
- Agent makes zero config changes in first 30 days (cold start guard)
- After 60 days: agent log shows coherent reasoning, calibration panel shows confidence tracks actual improvement rates within 15%
- After 90 days: at least one recipe has a measurable improvement in `vs_baseline_ev` attributable to an agent-made config change
- VSCode skill returns recipe-specific historical context within 10 seconds
- Total infrastructure cost stays under $5/month

---

## What This Is Not (Scope Limits)

- No autonomous trade execution in this spec (that is Phase D, future)
- No new recipe implementations (the agent tunes existing recipes, does not write new ones — PRs for structural changes require human review)
- No multi-regime config (recipes have one global config; regime-conditional logic is a future enhancement once single-regime tuning is validated)
- No user-facing signal quality scores in this sprint (the `/agent` page is internal only)
