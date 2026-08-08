# Phase 3 + 4: Claude Agent, /agent Page, and VSCode Skill

**Date:** 2026-05-18  
**Status:** Ready to build. Phase 2 conditions met.  
**Spec:** docs/superpowers/specs/2026-04-15-signal-intelligence-agent-design.md

---

## Readiness Check (automated, 2026-05-18 10:01 UTC)

| Condition | Required | Actual | Status |
|-----------|----------|--------|--------|
| signal_outcomes rows | >= 100 | 2,062 | PASS |
| Days since oldest signal | >= 30 | 30.7 days (oldest: 2026-04-17) | PASS |
| agent_config seeded | yes | 37 rows | PASS |
| agent_log entries | any | 34 (all OBSERVATION cold start) | PASS |
| agent_findings rows | any | 0 (cold start blocked until tonight) | PENDING |

**Cold start guard lifts tonight.** The nightly signal-learning.ts run at 01:00 UTC on May 19
will be the first run that passes `daysOld < 30` with ~31.35 days elapsed. agent_findings
will have data after that run. Phase 3 can begin building now; the findings data will
be ready before wiring is complete.

---

## What Already Exists (Phase 1 + Phase 2)

- All 6 agent tables in migration 006 (signal_events, signal_outcomes, agent_config,
  agent_config_history, agent_findings, agent_log)
- `/api/measure-outcomes` cron (hourly, Vercel free tier slot 2)
- `signal-learning.ts` stats engine: ATR backfill, win rate computation, agent_findings
  write, agent_log write, cold start guard
- `agent_config` seeded with 37 params from hardcoded recipe thresholds
- `lib/recipe-config.ts` exists: recipes read from agent_config via KV cache

**What does NOT exist yet:**
- Claude API calls anywhere in signal-learning.ts
- simulate_threshold_change logic
- Follow-up resolution (check PENDING log entries at 14-day mark)
- Calibration pass
- `/agent` page (app/agent/ does not exist)
- `/signal-expert` VSCode skill

---

## Phase 3: Claude Haiku Agent in signal-learning.ts

### Step 1: Add Anthropic dependency

```bash
npm install @anthropic-ai/sdk
```

Add `ANTHROPIC_API_KEY` to `.env.local` and Vercel env vars (GitHub Actions secret too;
signal-learning.ts runs in Actions).

### Step 2: Build simulate_threshold_change

Add to `lib/signal-learning-utils.ts`. Pure function, no DB calls at definition time
(queries happen at agent invocation via tool call).

```typescript
// Given a recipe, param, and proposed new_value, queries signal_outcomes joined to
// signal_events, splits signals into "kept" (match new threshold) and "filtered"
// (would be excluded), and returns win rates and net EV impact for both sets.
async function simulateThresholdChange(
  supabase: SupabaseClient,
  recipeId: string,
  param: string,
  newValue: number,
  lookbackDays: number
): Promise<SimulationResult>
```

The simulation queries `signal_events.active_config->>param` to find which signals
were fired under the current param value, then applies the hypothetical filter.

### Step 3: Build agent tool definitions

Five tools passed to the Haiku API call:

| Tool | Description |
|------|-------------|
| `get_findings` | Returns agent_findings rows for a recipe (last N days, all regimes) |
| `get_agent_log` | Returns agent_log rows for a recipe (last 30 entries, newest first) |
| `simulate_threshold_change` | Runs simulation and returns precision/recall/EV impact |
| `update_config` | Writes agent_config + agent_config_history + sets follow_up_due_at; enforces cooldown + one-change-per-run guards before writing |
| `write_log` | Writes an agent_log entry (OBSERVATION, RECOMMENDATION, or CONFIG_CHANGE) |

Guards enforced inside `update_config` (not by the agent):
- next_eligible_change not in the future
- last_change_run_id != current run ID (single-variable attribution)
- locked_by_human = false

### Step 4: Build system prompt + calibration addendum loader

System prompt encodes the identity and rules from the spec (conservative, EV > win rate,
regime awareness, past-decision weighting). Calibration addendum loaded from KV at
`agent:calibration_addendum` and appended at runtime.

### Step 5: Wire Haiku call into signal-learning.ts

After the stats engine writes agent_findings, add Phase 3 of the nightly script:

```
for each recipe with a new agent_findings row:
  call Haiku with: system prompt + calibration addendum
  pass: findings for this recipe, tool definitions
  allow up to 10 tool calls (agentic loop)
  Haiku decides: OBSERVATION, RECOMMENDATION, or CONFIG_CHANGE
```

Use `max_tokens: 1024`. Haiku output is structured tool calls and short log entries,
not long prose. Prompt caching on the base system prompt (identical every nightly run).

### Step 6: Follow-up resolution check

Runs at the start of each nightly script, before the stats engine:

```
query agent_log WHERE resolution = 'PENDING' AND follow_up_due_at <= now()
for each expired follow-up:
  fetch agent_findings for the recipe, segmented by before/after change_date
  compute: win_rate_before, win_rate_after
  write FOLLOW_UP log entry with resolution: IMPROVED | DEGRADED | NEUTRAL
  if DEGRADED: roll back agent_config to old_value (from agent_config_history),
               write CONFIG_CHANGE log entry noting rollback
```

### Step 7: Calibration pass (weekly, Sundays)

Groups all resolved agent_log entries (resolution != PENDING) by agent_confidence bucket
(0.70-0.79, 0.80-0.89, 0.90+). Computes actual improvement rate per bucket. Writes
CALIBRATION log entry. Writes new addendum to KV at `agent:calibration_addendum`.

### Step 8: Dry run flag

Add `--dry-run` flag to signal-learning.ts. When set, the agent can simulate and observe
but `update_config` tool returns "dry run mode: no changes written." Run with this flag
for the first 3 nightly cycles after wiring to validate the agent reasons correctly before
enabling real config changes.

---

## Phase 4: /agent Page

### Route: `app/agent/page.tsx`

Five panels per spec:

**Agent Log Feed** (left column, scrollable)
- Source: `agent_log` via new API route `/api/agent-log`
- Shows: log_type badge, recipe_id, summary, created_at, resolution badge
- Color: OBSERVATION = muted, RECOMMENDATION = amber, CONFIG_CHANGE = accent, FOLLOW_UP = green/red by resolution

**Recipe Performance Matrix** (top right)
- Source: latest `agent_findings` per recipe × regime
- Grid: recipes as rows, regimes (BULL/BEAR/RANGING/ALL) as columns
- Cell value: `vs_baseline_ev` (the real edge, not raw win rate)
- Color scale: green (positive edge) to red (negative edge), grey (insufficient data)

**Config Change History** (below matrix)
- Source: `agent_config_history` joined to agent_log for reasoning
- Shows: recipe, param, old to new value, changed_by, change_reason, resolution

**Calibration Panel** (bottom right)
- Source: agent_log WHERE log_type = 'CALIBRATION'
- Shows: confidence bucket vs actual improvement rate table
- Only meaningful after 30+ resolved decisions. Show placeholder until then.

**Lock Controls** (inline in Config Change History)
- Toggle `locked_by_human` per param
- Calls a new `/api/agent-config` PATCH route (requires CRON_SECRET in header)

### New API routes needed

- `GET /api/agent-log` -- paginated agent_log feed
- `GET /api/agent-findings` -- latest findings matrix
- `GET /api/agent-config` -- current params with lock status
- `PATCH /api/agent-config` -- toggle locked_by_human (protected)
- `GET /api/agent-config-history` -- paginated change history

### Nav entry

Add to `components/nav.tsx` NAV array:
```typescript
{ label: "Agent", href: "/agent" }
```

---

## Phase 4: /signal-expert VSCode Skill

Create at `~/.claude/skills/signal-expert.md`.

The skill invokes a Sonnet agent with five context pieces loaded from Supabase:
1. Current file contents (recipe being edited, passed by Claude Code)
2. agent_config values for recipes referenced in the file
3. agent_findings for those recipes (last 30 days, all regimes)
4. agent_log for those recipes (last 20 entries, newest first)
5. signal_outcomes sample (last 50 signals for those recipes, with is_win resolved)

Skill output format:
- Performance summary (win rate, vs_baseline_ev, trend)
- What each param does and why the current value was set (from agent_log history)
- Risk assessment for the specific change being considered
- Historical precedent (did we try something similar before?)
- Plain recommendation (change / don't change / observe more)

A `/api/signal-expert-context` route fetches the Supabase context (takes `recipe_ids`
query param, returns JSON). The skill calls this route and passes the JSON to the
Sonnet call, so the user does not need DB credentials in their shell.

---

## Build Order

1. **Tonight:** Verify agent_findings gets populated by the 2026-05-19 01:00 UTC run
2. **Phase 3 first:** Wire Claude agent into signal-learning.ts with --dry-run
3. **Run 3 dry-run cycles:** Validate agent reasoning in agent_log before enabling writes
4. **Enable live config changes:** Remove --dry-run after validation
5. **Phase 4 /agent page:** Once agent_log has real OBSERVATION/RECOMMENDATION entries to display
6. **Phase 4 VSCode skill:** After /agent page ships (reuses same API routes for context)

---

## Cost Estimate

Per spec: ~$2-3/month.

- Haiku nightly batch: ~13 recipes × ~10 tool calls × ~2K tokens = ~260K tokens/night = ~$0.03/night with prompt caching = ~$0.90/month
- Sonnet VSCode skill: on-demand, ~5K tokens per invocation, infrequent = ~$0.50/month
- Total: well under $5/month target
