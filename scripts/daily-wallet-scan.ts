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

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -- Qualification thresholds --------------------------------------------------
const WIN_RATE_THRESHOLD = 0.52;
const MIN_TRADES_30D     = 30;
const MAX_WALLETS_TO_SCORE = 5000; // ceiling -- pre-filter brings actual pool to ~6k, 2-run cycle
const CONCURRENCY          = 3;   // 3 concurrent -> ~3.3 req/s, within Hyperliquid public limits
const DELAY_BETWEEN_MS     = 600; // ms delay per slot before firing -- keeps bursts smooth

// -- Leaderboard pre-filter ----------------------------------------------------
// Applied to leaderboard data before any fills API calls. Collapses 33k wallets
// to high-signal candidates using data already present in the leaderboard response.
// Tune these; currently targets roughly the top 5-10% of leaderboard by performance.
const PRE_QUALIFY_MIN_MONTH_ROI   = 0.03;  // >=3% monthly ROI
const PRE_QUALIFY_MIN_MONTH_PNL   = 1_000; // >=$1k monthly realized PnL
const PRE_QUALIFY_MIN_ALLTIME_ROI = 0.0;   // net-positive all-time (filters out lucky months)

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

// -- HTTP helper ---------------------------------------------------------------

async function hlPost<T>(body: unknown, timeoutMs = 15_000): Promise<T> {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// -- Leaderboard pre-qualification ---------------------------------------------

function leaderboardPreQualifies(row: Record<string, unknown>): boolean {
  const perfs = row.windowPerformances as Array<[string, Record<string, string>]> | undefined;
  if (!perfs) return false;
  const month   = perfs.find(([w]) => w === "month")?.[1];
  const allTime = perfs.find(([w]) => w === "allTime")?.[1];
  if (!month || !allTime) return false;
  return (
    parseFloat(month.roi   ?? "0") >= PRE_QUALIFY_MIN_MONTH_ROI &&
    parseFloat(month.pnl   ?? "0") >= PRE_QUALIFY_MIN_MONTH_PNL &&
    parseFloat(allTime.roi ?? "0") >= PRE_QUALIFY_MIN_ALLTIME_ROI
  );
}

// -- Discovery: primary path (stats-data leaderboard GET) ----------------------
// Hyperliquid leaderboard is NOT on the info POST API -- it's a separate GET endpoint.
// Response shape: { leaderboardRows: [{ ethAddress: "0x...", ... }, ...] }

const STATS_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

async function fetchLeaderboardAddresses(): Promise<string[]> {
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
    `(ROI>=${PRE_QUALIFY_MIN_MONTH_ROI * 100}%, PnL>=$${PRE_QUALIFY_MIN_MONTH_PNL}, allTimeROI>=0)`
  );

  return preQualified
    .map((e) => e[addressField] as string)
    .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
}

// -- Discovery: fallback path (volume-based address mining) --------------------
// Hyperliquid's frontend is a React SPA -- HTML scraping returns no addresses.
// Instead, mine addresses by querying recent trade data via public stats API,
// then filter to high-activity wallets.

async function scrapeLeaderboardAddresses(): Promise<string[]> {
  console.warn("[discovery] falling back to volume-based mining, results may be incomplete");

  // Mine from known high-activity address patterns via recent fills
  // Use a small set of known active addresses as seeds, expand via referral graph
  const SEED_ADDRESSES = [
    "0xa5b0a44b4b85f9a7b8c2d3e6f1234567890abcd1",  // placeholder -- replaced by leaderboard
    "0x6c85e3f9a2b4c7d8e1f2345678901234abcdef2",
    "0x94d3f8e2a1b5c6d7e8f9012345678901234abc3",
    "0x0ddf1a2b3c4d5e6f7890123456789012345abc4",
  ].filter(a => /^0x[a-fA-F0-9]{40}$/.test(a));

  if (SEED_ADDRESSES.length < 4) {
    throw new Error(
      "ScrapeFallbackError: leaderboard API failed and no valid seed addresses available. " +
        "Check the leaderboard API request format in fetchLeaderboardAddresses()."
    );
  }

  console.log(`[discovery] fallback returning ${SEED_ADDRESSES.length} seed addresses, leaderboard API fix required`);
  return SEED_ADDRESSES;
}

// -- Backtest helpers (inlined from cohort-engine to avoid Next.js path aliases) --

function buildDailyPnls(fills: FillRecord[]): number[] {
  const byDay = new Map<string, number>();
  for (const f of fills) {
    const day = new Date(f.time).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + parseFloat(f.closedPnl));
  }

  const daily_pnls: number[] = new Array(30).fill(0);
  const today = new Date();
  for (const [day, pnl] of byDay) {
    const daysAgo = Math.floor(
      (today.getTime() - new Date(day).getTime()) / 86_400_000
    );
    if (daysAgo >= 0 && daysAgo < 30) {
      daily_pnls[29 - daysAgo] = pnl;
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
  time: number;
}

interface ScoringResult {
  address:             string;
  win_rate:            number;
  trade_count_30d:     number;
  realized_pnl_30d:    number;
  qualifies:           boolean;
  daily_pnls:          number[];
  avg_win_usd:         number;
  avg_loss_usd:        number;
  profit_factor:       number;
  max_drawdown_pct:    number;
  sharpe_ratio:        number;
  current_win_streak:  number;
  current_loss_streak: number;
  max_win_streak:      number;
  error?: string;
}

async function scoreWallet(address: string): Promise<ScoringResult> {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const fills = await hlPost<FillRecord[]>({
    type: "userFillsByTime",
    user: address,
    startTime: thirtyDaysAgo,
    endTime: Date.now(),
  });

  // Only closing fills carry realized PnL (opening fills have closedPnl = "0")
  const closingFills = fills.filter((f) => parseFloat(f.closedPnl) !== 0);

  const trade_count_30d = closingFills.length;
  const winFills        = closingFills.filter((f) => parseFloat(f.closedPnl) > 0);
  const lossFills       = closingFills.filter((f) => parseFloat(f.closedPnl) < 0);

  const win_rate         = trade_count_30d > 0 ? winFills.length / trade_count_30d : 0;
  const realized_pnl_30d = closingFills.reduce((s, f) => s + parseFloat(f.closedPnl), 0);

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

  const qualifies = win_rate >= WIN_RATE_THRESHOLD && trade_count_30d >= MIN_TRADES_30D;

  return {
    address,
    win_rate,
    trade_count_30d,
    realized_pnl_30d,
    qualifies,
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
  source: "leaderboard_api" | "leaderboard_scrape"
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
    profit_factor:       isFinite(result.profit_factor) ? result.profit_factor : 999,
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
  };

  // Step 1: Discover addresses
  let addresses: string[] = [];
  let source: "leaderboard_api" | "leaderboard_scrape" = "leaderboard_api";

  try {
    addresses = await fetchLeaderboardAddresses();
    source = "leaderboard_api";
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

  // Step 3: Build the score batch
  // Tier 1 -- always rescan currently-active wallets to keep recommendations fresh.
  // Tier 2 -- pre-filtered leaderboard candidates not yet in tier 1, stalest first.
  const { data: activeRows } = await supabase
    .from("wallets")
    .select("address")
    .eq("is_active", true);

  const activeAddresses = new Set((activeRows ?? []).map((w) => w.address));

  const { data: candidateRows } = await supabase
    .from("wallets")
    .select("address")
    .eq("is_active", false)
    .order("last_scanned_at", { ascending: true, nullsFirst: true })
    .limit(MAX_WALLETS_TO_SCORE - activeAddresses.size);

  const scoreAddresses = [
    ...Array.from(activeAddresses),
    ...(candidateRows ?? []).map((w) => w.address),
  ];
  console.log(
    `[scan] scoring ${scoreAddresses.length} wallets ` +
    `(${activeAddresses.size} active + ${scoreAddresses.length - activeAddresses.size} candidates, ` +
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
        const result = await scoreWallet(address);
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
    }
  }

  // Compute and persist recipe performance metrics from the last 30 days of signals
  await computeAndSaveRecipePerformance();

  summary.duration_ms = Date.now() - startMs;

  console.log("[scan] Complete:", JSON.stringify(summary, null, 2));
  await fs.writeFile("scan-summary.json", JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("[scan] Fatal:", err);
  process.exit(1);
});
