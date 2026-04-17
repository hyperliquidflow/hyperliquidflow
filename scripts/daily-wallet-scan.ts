// scripts/daily-wallet-scan.ts
// Daily wallet discovery and scoring pipeline.
// Run via: npx tsx scripts/daily-wallet-scan.ts
//
// Called by .github/workflows/daily-wallet-scan.yml at 00:00 UTC.
// Does NOT import Next.js or Vercel KV -- writes directly to Supabase.
//
// Flow:
//   1. Discover wallet addresses from Hyperliquid leaderboard API (with scrape fallback)
//   2. Upsert addresses into wallets table
//   3. Score each wallet: fetch fills -> compute win_rate, daily_pnls, full backtest metrics
//   4. Activate wallets passing the qualification filter, save backtest to user_pnl_backtest
//   5. Write scan-summary.json for GitHub Actions artifact upload

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";

// -- Environment validation ----------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HYPERLIQUID_API_URL =
  process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info";
const HYPURRSCAN_API_URL = process.env.HYPURRSCAN_API_URL ?? "https://api.hypurrscan.io";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -- Qualification thresholds --------------------------------------------------
// Window widened from 30d to 60d: halves variance on win_rate / Sharpe, lets
// profit_factor carry the quality gate instead of relying on a thin-sample
// win rate cutoff. Column names keep "_30d" suffix as a legacy label; treat
// them as "scoring window" going forward.
const SCORING_WINDOW_DAYS     = 60;
const WIN_RATE_THRESHOLD      = 0.50; // was 0.52 -- tiny edge + high profit_factor > luck floor
const MIN_TRADES_30D          = 60;   // scaled with window: >=1 closing trade/day equivalent
const MAX_WALLETS_TO_SCORE    = 5000; // up from 3000 -- prior run used 18m of 65m budget
const RESCORE_STALE_DAYS      = 2;    // only re-score inactive wallets not scanned in the last N days
const MIN_CANDIDATE_PNL_30D   = 1_000; // absolute USD floor, not time-normalised
const CONCURRENCY             = 3;    // 3 concurrent -> ~3.3 req/s, within Hyperliquid public limits
const DELAY_BETWEEN_MS        = 600;  // ms delay per slot before firing -- keeps bursts smooth

// -- Smart-money quality gates (applied at activation, not pre-filter) ---------
const MIN_EQUITY_FOR_ACTIVATION    = 10_000; // $10k minimum live equity (smart money has capital)
const MIN_PROFIT_FACTOR            = 1.3;    // gross wins / gross losses -- excludes barely-profitable
const MAX_DRAWDOWN_FOR_ACTIVATION  = 0.40;   // reject wallets with >40% 30d drawdown
const MAX_TRADES_30D               = 1000;   // scaled to 60d window (>1000 = ~17 trades/day = wash/farm)
const MIN_HISTORY_VOLUME_RATIO     = 0.95;   // monthVlm/allTimeVlm <= this => >=5% volume predates this month

// -- Leaderboard pre-filter ----------------------------------------------------
// Applied to leaderboard data before any fills API calls. Collapses 33k wallets
// to high-signal candidates using data already present in the leaderboard response.
const PRE_QUALIFY_MIN_MONTH_PNL   = 10_000; // >=$10k monthly realized PnL (absolute size filter)
const PRE_QUALIFY_MIN_ALLTIME_PNL = 0;      // >=$0 all-time PnL (no net-losers -- kills survivorship bias)

// -- In-process semaphore (valid here -- long-running Node.js process, not serverless) --
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}

const sem = new Semaphore(CONCURRENCY);

// ── Hypurrscan entity classification (inline — no lib/ import in scripts) ──

type EntityType =
  | "cex" | "deployer" | "protocol" | "gambling" | "fund" | "known" | "unknown";

function classifyEntityLabel(label: string): EntityType {
  const l = label.toLowerCase();
  if (/bybit|binance|kucoin|gate\.io|okx|coinbase|kraken|bitfinex|huobi|mexc|bitget|deribit/.test(l))
    return "cex";
  if (/deployer|dev wallet|\bdev\b/.test(l))
    return "deployer";
  if (/burn|liquidat|hip-2|airdrop/.test(l))
    return "protocol";
  if (/gambl/.test(l))
    return "gambling";
  if (/fund|treasury|capital|trading firm|research/.test(l))
    return "fund";
  return "known";
}

function resolveEntityType(
  address: string,
  aliases: Record<string, string>
): { entity_type: EntityType; entity_label: string | null } {
  const label = aliases[address.toLowerCase()] ?? aliases[address];
  if (!label) return { entity_type: "unknown", entity_label: null };
  return { entity_type: classifyEntityLabel(label), entity_label: label };
}

const EXCLUDED_ENTITY_TYPES: readonly EntityType[] = ["cex", "deployer", "protocol", "gambling"];

function isExcludedEntity(address: string, aliasMap: Record<string, string>): boolean {
  const { entity_type } = resolveEntityType(address, aliasMap);
  return (EXCLUDED_ENTITY_TYPES as readonly string[]).includes(entity_type);
}

async function fetchHypurrscanAliases(): Promise<Record<string, string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${HYPURRSCAN_API_URL}/globalAliases`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<Record<string, string>>;
  } catch (err) {
    clearTimeout(timer);
    console.warn("[identity] fetchHypurrscanAliases failed, skipping enrichment:", err);
    return {};
  }
}

// -- HTTP helper ---------------------------------------------------------------

async function hlPost<T>(body: unknown, timeoutMs = 15_000): Promise<T> {
  // One retry on 429 with 5s backoff, then give up — ~30% of scored wallets hit 429s
  // at 3 req/s in the previous run; a single retry after a brief pause recovers most
  // without killing the budget.
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(HYPERLIQUID_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return res.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("hlPost: exhausted retries");
}

// -- Leaderboard pre-qualification ---------------------------------------------

function leaderboardPreQualifies(row: Record<string, unknown>): boolean {
  const perfs = row.windowPerformances as Array<[string, Record<string, string>]> | undefined;
  if (!perfs) return false;
  const month   = perfs.find(([w]) => w === "month")?.[1];
  const allTime = perfs.find(([w]) => w === "allTime")?.[1];
  if (!month || !allTime) return false;
  return (
    parseFloat(month.pnl ?? "0")   >= PRE_QUALIFY_MIN_MONTH_PNL &&
    parseFloat(allTime.pnl ?? "0") >= PRE_QUALIFY_MIN_ALLTIME_PNL
  );
}

// -- Discovery: primary path (stats-data leaderboard GET) ----------------------
// Hyperliquid leaderboard is NOT on the info POST API -- it's a separate GET endpoint.
// Response shape: { leaderboardRows: [{ ethAddress: "0x...", ... }, ...] }

const STATS_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

interface LeaderboardEntry {
  address:      string;
  accountValue: number;
  monthPnl:     number;
  allTimePnl:   number;
  monthVlm:     number;
  allTimeVlm:   number;
}

async function fetchLeaderboardAddresses(): Promise<Map<string, LeaderboardEntry>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let raw: unknown;
  try {
    const res = await fetch(STATS_LEADERBOARD_URL, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    raw = await res.json();
    console.log(
      `[discovery] leaderboard raw (first 500 chars):`,
      JSON.stringify(raw).slice(0, 500)
    );
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`LeaderboardAPIError: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Handle both array response and {leaderboardRows: [...]} envelope
  let rows: unknown[];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const key = ["leaderboardRows", "rows", "data", "result"].find(k => Array.isArray(obj[k]));
    if (key) {
      rows = obj[key] as unknown[];
    } else {
      throw new Error(
        `LeaderboardShapeError: unexpected response shape. Keys: [${Object.keys(obj).join(", ")}]. Raw: ${JSON.stringify(raw).slice(0, 300)}`
      );
    }
  } else {
    throw new Error(`LeaderboardShapeError: expected Array or Object, got ${typeof raw}`);
  }

  if (rows.length === 0) throw new Error("LeaderboardShapeError: empty rows array");

  const sample = rows[0] as Record<string, unknown>;

  // Address may be nested or directly on the row
  const ADDRESS_CANDIDATES = ["ethAddress", "address", "user", "wallet", "account"];
  const addressField = ADDRESS_CANDIDATES.find(
    (k) =>
      typeof sample[k] === "string" &&
      /^0x[a-fA-F0-9]{40}$/.test(sample[k] as string)
  );

  if (!addressField) {
    throw new Error(
      `LeaderboardShapeError: no address field found. Keys: [${Object.keys(sample).join(", ")}]. ` +
        `Sample: ${JSON.stringify(sample).slice(0, 300)}`
    );
  }

  console.log(`[discovery] address field: "${addressField}", ${rows.length} rows`);

  // Sort by monthly ROI descending so the best traders get upserted and scored first
  const typedRows = rows as Record<string, unknown>[];
  typedRows.sort((a, b) => {
    const monthRoi = (row: Record<string, unknown>): number => {
      const perfs = row.windowPerformances as Array<[string, Record<string, string>]> | undefined;
      if (!perfs) return 0;
      const month = perfs.find(([w]) => w === "month");
      return month ? parseFloat(month[1].roi ?? "0") : 0;
    };
    return monthRoi(b) - monthRoi(a);
  });

  // Pre-filter: drop low-signal wallets using leaderboard data already in hand.
  // This collapses 33k wallets to ~1-3k candidates without any extra API calls.
  const preQualified = typedRows.filter(leaderboardPreQualifies);
  console.log(
    `[discovery] pre-filter: ${preQualified.length}/${typedRows.length} wallets pass ` +
    `(monthPnl>=$${PRE_QUALIFY_MIN_MONTH_PNL}, allTimePnl>=$${PRE_QUALIFY_MIN_ALLTIME_PNL})`
  );

  const map = new Map<string, LeaderboardEntry>();
  for (const row of preQualified) {
    const raw = row[addressField] as string;
    if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) continue;
    const address = raw.toLowerCase();
    const perfs   = row.windowPerformances as Array<[string, Record<string, string>]>;
    const month   = perfs.find(([w]) => w === "month")?.[1]   ?? {};
    const allTime = perfs.find(([w]) => w === "allTime")?.[1] ?? {};
    map.set(address, {
      address,
      accountValue: parseFloat((row.accountValue as string) ?? "0"),
      monthPnl:     parseFloat(month.pnl ?? "0"),
      allTimePnl:   parseFloat(allTime.pnl ?? "0"),
      monthVlm:     parseFloat(month.vlm ?? "0"),
      allTimeVlm:   parseFloat(allTime.vlm ?? "0"),
    });
  }
  return map;
}

// -- Backtest helpers (inlined from cohort-engine to avoid Next.js path aliases) --

function buildDailyPnls(fills: FillRecord[]): number[] {
  const byDay = new Map<string, number>();
  for (const f of fills) {
    const day = new Date(f.time).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + parseFloat(f.closedPnl));
  }

  const daily_pnls: number[] = new Array(SCORING_WINDOW_DAYS).fill(0);
  const today = new Date();
  for (const [day, pnl] of byDay) {
    const daysAgo = Math.floor(
      (today.getTime() - new Date(day).getTime()) / 86_400_000
    );
    if (daysAgo >= 0 && daysAgo < SCORING_WINDOW_DAYS) {
      daily_pnls[SCORING_WINDOW_DAYS - 1 - daysAgo] = pnl;
    }
  }
  return daily_pnls;
}

function computeSharpeProxy(dailyPnls: number[]): number {
  if (dailyPnls.length === 0) return 0;
  const n = dailyPnls.length;
  const m = dailyPnls.reduce((a, b) => a + b, 0) / n;
  const variance = dailyPnls.reduce((a, v) => a + (v - m) ** 2, 0) / n;
  const s = Math.sqrt(variance);
  const raw = m / (s + 0.0001);
  return Math.min(1, Math.max(0, raw / 3.0));
}

function computeDrawdownScore(dailyPnls: number[]): number {
  if (dailyPnls.length === 0) return 0;
  let running = 0;
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const pnl of dailyPnls) {
    running += pnl;
    if (running > peak) peak = running;
    if (peak <= 0) continue;
    const dd = (peak - running) / (Math.abs(peak) + 0.0001);
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  return Math.min(1, Math.max(0, 1 - maxDrawdown));
}

// -- Scoring: fetch fills and compute metrics ----------------------------------

interface FillRecord {
  closedPnl: string;
  time:      number;
  fee:       string;
}

interface ScoringResult {
  address:                string;
  win_rate:               number;
  trade_count_30d:        number;
  realized_pnl_30d:       number;
  realized_pnl_30d_gross: number;
  total_fees_30d:         number;
  qualifies:              boolean;
  rejection_reason:       string | null;
  daily_pnls:             number[];
  avg_win_usd:            number;
  avg_loss_usd:           number;
  profit_factor:          number;
  max_drawdown_pct:       number;
  sharpe_ratio:           number;
  current_win_streak:     number;
  current_loss_streak:    number;
  max_win_streak:         number;
  error?: string;
}

async function scoreWallet(
  address:          string,
  leaderboardEntry: LeaderboardEntry | null,
  fetchLiveEquity:  boolean,
): Promise<ScoringResult> {
  const windowStart = Date.now() - SCORING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const fills = await hlPost<FillRecord[]>({
    type: "userFillsByTime",
    user: address,
    startTime: windowStart,
    endTime: Date.now(),
  });

  // Leaderboard entries already carry accountValue. For tier2 active wallets missing
  // it, fetch clearinghouseState to gate equity. Tier3 stale-DB re-scores skip this —
  // the cron dust-deactivation path handles their equity check and the extra API call
  // roughly doubled the scoring budget, causing the 50-min timeout.
  let liveEquity: number | null = leaderboardEntry?.accountValue ?? null;
  if (liveEquity === null && fetchLiveEquity) {
    try {
      const cs = await hlPost<{ marginSummary?: { accountValue?: string } }>({
        type: "clearinghouseState",
        user: address,
      });
      liveEquity = parseFloat(cs?.marginSummary?.accountValue ?? "0");
    } catch {
      liveEquity = null;
    }
  }

  // Only closing fills carry realized PnL (opening fills have closedPnl = "0")
  const closingFills = fills.filter((f) => parseFloat(f.closedPnl) !== 0);

  const trade_count_30d = closingFills.length;
  const winFills        = closingFills.filter((f) => parseFloat(f.closedPnl) > 0);
  const lossFills       = closingFills.filter((f) => parseFloat(f.closedPnl) < 0);

  const win_rate = trade_count_30d > 0 ? winFills.length / trade_count_30d : 0;

  const total_fees_30d         = fills.reduce((s, f) => s + parseFloat(f.fee ?? "0"), 0);
  const realized_pnl_30d_gross = closingFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0);
  // Hyperliquid returns fee as positive USD paid by trader; subtract to get net
  const realized_pnl_30d       = realized_pnl_30d_gross - total_fees_30d;

  const avg_win_usd  = winFills.length > 0
    ? winFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0) / winFills.length
    : 0;
  const avg_loss_usd = lossFills.length > 0
    ? Math.abs(lossFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0) / lossFills.length)
    : 0;

  const totalWin  = winFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0);
  const totalLoss = Math.abs(lossFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0));
  const profit_factor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0;

  // Build 30-day daily PnL series for scoring
  const daily_pnls      = buildDailyPnls(closingFills);
  const sharpe_ratio     = computeSharpeProxy(daily_pnls);
  const max_drawdown_pct = 1 - computeDrawdownScore(daily_pnls); // stored as fraction [0,1]

  // Streak tracking (chronological order)
  const chronological = [...closingFills].sort((a, b) => a.time - b.time);
  let curWin = 0, curLoss = 0, maxWin = 0;
  for (const f of chronological) {
    if (parseFloat(f.closedPnl) > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    } else {
      curLoss++;
      curWin = 0;
    }
  }

  // Quality gate: cheap checks first, leaderboard-dependent checks last so DB-only
  // re-scores (no leaderboard entry today) can still activate on performance alone —
  // their equity is gated by the cron dust-deactivation path instead.
  let rejection_reason: string | null = null;

  if      (win_rate < WIN_RATE_THRESHOLD)                 rejection_reason = "low_win_rate";
  else if (trade_count_30d < MIN_TRADES_30D)              rejection_reason = "low_trade_count";
  else if (trade_count_30d > MAX_TRADES_30D)              rejection_reason = "too_many_trades";
  else if (realized_pnl_30d < MIN_CANDIDATE_PNL_30D)      rejection_reason = "low_net_pnl";
  else if (profit_factor < MIN_PROFIT_FACTOR)             rejection_reason = "low_profit_factor";
  else if (max_drawdown_pct > MAX_DRAWDOWN_FOR_ACTIVATION) rejection_reason = "high_drawdown";
  else if (liveEquity !== null && liveEquity < MIN_EQUITY_FOR_ACTIVATION)
                                                          rejection_reason = "low_equity";
  else if (leaderboardEntry && leaderboardEntry.allTimePnl < PRE_QUALIFY_MIN_ALLTIME_PNL)
                                                          rejection_reason = "negative_alltime";
  else if (
    leaderboardEntry &&
    leaderboardEntry.allTimeVlm > 0 &&
    (leaderboardEntry.monthVlm / leaderboardEntry.allTimeVlm) > MIN_HISTORY_VOLUME_RATIO
  )                                                        rejection_reason = "suspiciously_fresh";

  const qualifies = rejection_reason === null;

  return {
    address,
    win_rate,
    trade_count_30d,
    realized_pnl_30d,
    realized_pnl_30d_gross,
    total_fees_30d,
    qualifies,
    rejection_reason,
    daily_pnls,
    avg_win_usd,
    avg_loss_usd,
    profit_factor,
    max_drawdown_pct,
    sharpe_ratio,
    current_win_streak:  curWin,
    current_loss_streak: curLoss,
    max_win_streak:      maxWin,
  };
}

// -- Supabase upsert helpers ---------------------------------------------------

async function upsertAddresses(
  addresses: string[],
  source: "leaderboard_api"
): Promise<number> {
  const CHUNK = 100;
  let newCount = 0;

  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK).map((address) => ({
      address,
      is_active: false,
      discovery_source: source,
    }));

    const { error, count } = await supabase
      .from("wallets")
      .upsert(chunk, { onConflict: "address", ignoreDuplicates: true })
      .select("id");

    if (error) {
      console.error(`[upsert] chunk ${i} to ${i + CHUNK} error:`, error.message);
    } else {
      newCount += count ?? 0;
    }
  }

  return newCount;
}

async function updateWalletMetrics(result: ScoringResult): Promise<void> {
  const { error } = await supabase
    .from("wallets")
    .update({
      win_rate:         result.win_rate,
      trade_count_30d:  result.trade_count_30d,
      realized_pnl_30d: result.realized_pnl_30d,
      last_scanned_at:  new Date().toISOString(),
      is_active:        result.qualifies,
    })
    .eq("address", result.address);

  if (error) {
    console.error(`[update] ${result.address} error:`, error.message);
  }
}

async function saveBacktestRow(
  walletId: string,
  result: ScoringResult
): Promise<void> {
  const { error } = await supabase.from("user_pnl_backtest").upsert({
    wallet_id:           walletId,
    computed_at:         new Date().toISOString(),
    win_rate:            result.win_rate,
    avg_win_usd:         result.avg_win_usd,
    avg_loss_usd:        result.avg_loss_usd,
    profit_factor:       Math.min(9999, isFinite(result.profit_factor) ? result.profit_factor : 9999),
    total_trades:        result.trade_count_30d,
    total_pnl_usd:       result.realized_pnl_30d,
    max_drawdown_pct:    result.max_drawdown_pct,
    sharpe_ratio:        result.sharpe_ratio,
    current_win_streak:  result.current_win_streak,
    current_loss_streak: result.current_loss_streak,
    max_win_streak:      result.max_win_streak,
    daily_pnls:          result.daily_pnls,
  }, { onConflict: "wallet_id" });

  if (error) {
    console.error(`[backtest] ${result.address} error:`, error.message);
  }
}

// -- Recipe performance computation -------------------------------------------
// Queries the last 30 days of signals_history and upserts aggregate stats per
// recipe into recipe_performance. This is what populates the Edge page and
// enables Recipe 4's historical win-rate gate.
//
// Win-rate proxy: signals with ev_score > 0 are treated as "true positive" —
// imperfect but self-contained (no extra price fetches required).

async function computeAndSaveRecipePerformance(): Promise<void> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("signals_history")
    .select("recipe_id, ev_score")
    .gte("detected_at", since);

  if (error || !rows || rows.length === 0) {
    console.log("[recipe-perf] no signal history to aggregate, skipping");
    return;
  }

  // Group by recipe_id
  const byRecipe = new Map<string, { evScores: number[]; withScore: number; total: number }>();
  for (const row of rows) {
    const id = row.recipe_id as string;
    if (!byRecipe.has(id)) byRecipe.set(id, { evScores: [], withScore: 0, total: 0 });
    const entry = byRecipe.get(id)!;
    entry.total++;
    if (row.ev_score != null) {
      entry.evScores.push(row.ev_score as number);
      if ((row.ev_score as number) > 0) entry.withScore++;
    }
  }

  const upsertRows = [...byRecipe.entries()].map(([recipe_id, { evScores, withScore, total }]) => {
    const avg_ev_score = evScores.length > 0
      ? evScores.reduce((a, b) => a + b, 0) / evScores.length
      : null;
    const true_positive  = withScore;
    const false_positive = total - withScore;
    const win_rate       = total > 0 ? withScore / total : 0;
    return {
      recipe_id,
      signal_count:  total,
      true_positive,
      false_positive,
      avg_ev_score,
      win_rate,
      measured_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await supabase
    .from("recipe_performance")
    .insert(upsertRows);

  if (upsertError) {
    console.error("[recipe-perf] insert error:", upsertError.message);
  } else {
    console.log(`[recipe-perf] wrote ${upsertRows.length} recipe performance rows`);
  }
}

// -- Wallet outcome resolution -------------------------------------------------

async function resolveWalletOutcomes(): Promise<void> {
  console.log("[wallet-outcomes] resolving open signal outcomes...");

  const { data: openOutcomes, error } = await supabase
    .from("signal_outcomes")
    .select("signal_id, price_win, signal_events!inner(wallet_ids, coin, direction)")
    .eq("wallet_outcome", "OPEN")
    .limit(500);

  if (error || !openOutcomes || openOutcomes.length === 0) {
    console.log("[wallet-outcomes] no open outcomes to resolve");
    return;
  }

  const allWalletIds = new Set<string>();
  for (const row of openOutcomes) {
    const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
    for (const wid of (event?.wallet_ids ?? [])) allWalletIds.add(wid);
  }

  const { data: backtestRows } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, win_rate, avg_win_usd, avg_loss_usd, profit_factor")
    .in("wallet_id", [...allWalletIds]);

  const backtestByWallet = new Map(
    (backtestRows ?? []).map((r) => [r.wallet_id, r])
  );

  let resolved = 0;
  for (const row of openOutcomes) {
    const event = Array.isArray(row.signal_events) ? row.signal_events[0] : row.signal_events;
    if (!event?.wallet_ids?.length) continue;

    const walletReturns = event.wallet_ids
      .map((wid: string) => backtestByWallet.get(wid))
      .filter(Boolean)
      .map((bt: { win_rate: number; avg_win_usd: number; avg_loss_usd: number }) =>
        bt.win_rate > 0.5
          ? bt.avg_win_usd / Math.max(1, bt.avg_win_usd + Math.abs(bt.avg_loss_usd))
          : -(Math.abs(bt.avg_loss_usd) / Math.max(1, bt.avg_win_usd + Math.abs(bt.avg_loss_usd)))
      );

    if (walletReturns.length === 0) continue;

    const walletReturnAvg = walletReturns.reduce((a: number, b: number) => a + b, 0) / walletReturns.length;
    const walletOutcome   = walletReturnAvg > 0 ? "WIN" : "LOSS";

    const { error: updateError } = await supabase
      .from("signal_outcomes")
      .update({
        wallet_return_avg: walletReturnAvg,
        wallet_outcome:    walletOutcome,
        is_win:            walletOutcome === "WIN" && row.price_win === true,
      })
      .eq("signal_id", row.signal_id);

    if (!updateError) resolved++;
  }

  console.log(`[wallet-outcomes] resolved ${resolved} of ${openOutcomes.length} open outcomes`);
}

// -- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  const startMs = Date.now();
  const summary = {
    discovered:   0,
    new_wallets:  0,
    activated:    0,
    deactivated:  0,
    top_win_rate: 0,
    scan_errors:  0,
    duration_ms:  0,
    discovery_source: "" as string,
    errors:       [] as string[],
    rejection_breakdown: {
      low_win_rate:        0,
      low_trade_count:     0,
      too_many_trades:     0,
      low_net_pnl:         0,
      low_profit_factor:   0,
      high_drawdown:       0,
      low_equity:          0,
      negative_alltime:    0,
      suspiciously_fresh:  0,
      entity_excluded:     0,
    } as Record<string, number>,
  };

  // Phase 0: Pre-fetch Hypurrscan aliases — used both for pre-filter and end-of-scan enrichment
  console.log("[Phase 0] Pre-fetching Hypurrscan aliases...");
  const aliases = await fetchHypurrscanAliases();
  console.log(`[identity] loaded ${Object.keys(aliases).length} aliases`);

  // Step 1: Discover addresses
  let leaderboardMap: Map<string, LeaderboardEntry> = new Map();
  let addresses: string[] = [];
  const source: "leaderboard_api" = "leaderboard_api";

  try {
    leaderboardMap = await fetchLeaderboardAddresses();
    addresses      = Array.from(leaderboardMap.keys());
    console.log(`[discovery] primary path: ${addresses.length} addresses`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`primary_path: ${msg}`);
    console.warn("[discovery] primary path failed:", msg);
  }

  // Step 2: Upsert ALL discovered addresses into DB
  // (fast -- just writes, no Hyperliquid calls)
  if (addresses.length > 0) {
    summary.discovered = addresses.length;
    summary.discovery_source = source;
    summary.new_wallets = await upsertAddresses(addresses, source);
    console.log(`[discovery] upserted ${addresses.length} addresses (${summary.new_wallets} new)`);
  } else {
    console.warn("[discovery] no new addresses, will rescore from database");
    summary.discovery_source = "database_rescore";
  }

  // Step 3: Build the score batch with tiered priority.
  //   Tier 1 -- today's leaderboard candidates (fresh, pre-filtered smart money)
  //   Tier 2 -- currently-active wallets (keep recommendations fresh)
  //   Tier 3 -- stale DB re-scores (stalest first, with prior PnL above dust floor)
  const { data: activeRows } = await supabase
    .from("wallets")
    .select("address")
    .eq("is_active", true);

  const activeAddresses      = new Set((activeRows ?? []).map((w) => w.address));
  const leaderboardAddresses = Array.from(leaderboardMap.keys());

  const staleCutoff  = new Date(Date.now() - RESCORE_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Tier 3 candidates: not active today, either never-scanned or stale+non-dust.
  // Limit fills only the remaining cap after tiers 1+2.
  const tier12Count  = new Set([
    ...leaderboardAddresses.map((a) => a.toLowerCase()),
    ...Array.from(activeAddresses).map((a) => a.toLowerCase()),
  ]).size;
  const remainingCap = Math.max(0, MAX_WALLETS_TO_SCORE - tier12Count);
  const { data: candidateRows } = await supabase
    .from("wallets")
    .select("address")
    .eq("is_active", false)
    .or(
      `last_scanned_at.is.null,` +
      `and(last_scanned_at.lt.${staleCutoff},realized_pnl_30d.gte.${MIN_CANDIDATE_PNL_30D})`
    )
    .order("last_scanned_at", { ascending: true, nullsFirst: true })
    .limit(remainingCap);

  // Dedupe while preserving tier order: leaderboard > active > stale-DB.
  // Track tier3 addresses separately so scoreWallet can skip the clearinghouseState
  // equity fetch for them (cron dust-check covers their equity gate).
  const seen = new Set<string>();
  const rawScoreAddresses: string[] = [];
  const tier3StaleAddresses = new Set<string>();
  const pushUnique = (addr: string, tier3 = false) => {
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rawScoreAddresses.push(addr);
    if (tier3) tier3StaleAddresses.add(key);
  };
  for (const a of leaderboardAddresses)        pushUnique(a);
  for (const a of activeAddresses)             pushUnique(a);
  for (const r of candidateRows ?? [])         pushUnique(r.address, true);
  const excludedByEntity = rawScoreAddresses.filter((a) => isExcludedEntity(a, aliases));
  const scoreAddresses   = rawScoreAddresses.filter((a) => !isExcludedEntity(a, aliases));
  summary.rejection_breakdown.entity_excluded = excludedByEntity.length;
  console.log(
    `[scan] entity pre-filter: excluded ${excludedByEntity.length} non-trader addresses ` +
    `(cex/deployer/protocol/gambling)`
  );
  console.log(
    `[scan] scoring ${scoreAddresses.length} wallets ` +
    `(tier1 leaderboard: ${leaderboardAddresses.length}, ` +
    `tier2 active: ${activeAddresses.size}, ` +
    `tier3 stale-DB: ${(candidateRows ?? []).length}, ` +
    `concurrency: ${CONCURRENCY})`
  );

  // Step 4: Fetch address->UUID map for backtest saves
  // One batch select instead of N individual queries during the scoring loop.
  const addressToId = new Map<string, string>();
  const CHUNK = 200;
  for (let i = 0; i < scoreAddresses.length; i += CHUNK) {
    const chunk = scoreAddresses.slice(i, i + CHUNK);
    const { data: walletRows } = await supabase
      .from("wallets")
      .select("id, address")
      .in("address", chunk);
    for (const w of walletRows ?? []) {
      addressToId.set(w.address, w.id);
    }
  }

  const results = await Promise.allSettled(
    scoreAddresses.map(async (address) => {
      await sem.acquire();
      try {
        const leaderboardEntry = leaderboardMap.get(address.toLowerCase()) ?? null;
        const fetchLiveEquity  = !tier3StaleAddresses.has(address.toLowerCase());
        const result           = await scoreWallet(address, leaderboardEntry, fetchLiveEquity);
        await updateWalletMetrics(result);

        // Save full backtest including daily_pnls for real-time scoring
        const walletId = addressToId.get(address);
        if (walletId) {
          await saveBacktestRow(walletId, result);
        }

        if (result.qualifies) summary.activated++;
        if (result.win_rate > summary.top_win_rate) summary.top_win_rate = result.win_rate;

        return result;
      } finally {
        sem.release();
      }
    })
  );

  for (const r of results) {
    if (r.status === "rejected") {
      summary.scan_errors++;
      if (summary.errors.length < 20) {
        summary.errors.push(String(r.reason).slice(0, 200));
      }
    } else if (r.value.rejection_reason) {
      const reason = r.value.rejection_reason;
      if (summary.rejection_breakdown[reason] !== undefined) {
        summary.rejection_breakdown[reason]++;
      }
    }
  }

  // Compute and persist recipe performance metrics from the last 30 days of signals
  await computeAndSaveRecipePerformance();

  summary.duration_ms = Date.now() - startMs;

  const total_rejected = Object.values(summary.rejection_breakdown).reduce((a, b) => a + b, 0);
  console.log("\n[cohort-quality] Activation results:");
  console.log(`  activated:   ${summary.activated}`);
  console.log(`  rejected:    ${total_rejected}`);
  console.log(`  scan errors: ${summary.scan_errors}`);
  console.log("[cohort-quality] Rejection breakdown:");
  for (const [reason, count] of Object.entries(summary.rejection_breakdown)) {
    if (count > 0) console.log(`    ${reason.padEnd(22)} ${count}`);
  }

  console.log("[scan] Complete:", JSON.stringify(summary, null, 2));
  await fs.writeFile("scan-summary.json", JSON.stringify(summary, null, 2));

  // ── Phase 6: Identity enrichment using aliases pre-fetched in Phase 0 ─────
  console.log("\n[Phase 6] Enrichment pass using pre-fetched aliases...");
  const aliasCount = Object.keys(aliases).length;

  if (aliasCount > 0) {
    const { data: allWallets, error: walletFetchErr } = await supabase
      .from("wallets")
      .select("id, address, is_active");

    if (walletFetchErr) {
      console.error("[identity] Could not fetch wallets:", walletFetchErr.message);
    } else if (allWallets && allWallets.length > 0) {
      let labeled = 0;
      let deactivated = 0;

      // Collect updates, then batch upsert to avoid N individual DB roundtrips
      const toUpdate: Array<{
        id: string;
        entity_type: EntityType;
        entity_label: string | null;
        is_active?: boolean;
      }> = [];

      for (const wallet of allWallets) {
        const { entity_type, entity_label } = resolveEntityType(wallet.address, aliases);
        if (entity_type === "unknown") continue;
        labeled++;
        const entry: (typeof toUpdate)[number] = { id: wallet.id, entity_type, entity_label };
        if (wallet.is_active && (entity_type === "cex" || entity_type === "deployer")) {
          entry.is_active = false;
          deactivated++;
        }
        toUpdate.push(entry);
      }

      // .upsert with onConflict:"id" sends INSERT-on-miss, which fails NOT NULL
      // on the "address" column. These are known-existing rows, so use .update
      // keyed on id. Runs per-row but the row count here is tiny (~17) so the
      // N roundtrips are cheap.
      for (const entry of toUpdate) {
        const { id, ...patch } = entry;
        const { error: updateErr } = await supabase
          .from("wallets")
          .update(patch)
          .eq("id", id);
        if (updateErr) {
          console.warn(`[identity] update error for ${id}:`, updateErr.message);
        }
      }

      summary.deactivated = deactivated;
      console.log(
        `[identity] Labeled: ${labeled} wallets. Deactivated (CEX/deployer): ${deactivated} wallets.`
      );
    }
  }

  await resolveWalletOutcomes();
}

main().catch((err) => {
  console.error("[scan] Fatal:", err);
  process.exit(1);
});
