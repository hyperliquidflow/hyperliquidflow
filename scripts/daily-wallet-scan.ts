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
import { computeFeeRatio, findSybilClusters } from "../lib/wash-sybil";
import {
  classifyTradingStyle,
  computeConsistency,
  computeRegimeStats,
  extractTopCoins,
} from "../lib/wallet-profile";
import { computeCohortScoresV2 } from "../lib/cohort-engine";
import { SHADOW_FORMULA_VERSION } from "../lib/leverage-risk";

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
const MAX_TIER1_LEADERBOARD   = 2000; // cap fresh leaderboard tier; sorted by monthly ROI, top N kept.
                                      // Top 2000 wallets are where signal concentrates; deeper ranks
                                      // are dominated by smaller accounts with higher noise.
const MIN_CANDIDATE_PNL_30D   = 1_000; // absolute USD floor, not time-normalised
const CONCURRENCY             = 2;    // 2 concurrent -> ~2 req/s, under HL 429 threshold
const DELAY_BETWEEN_MS        = 1000; // ms delay per slot before firing -- keeps bursts smooth

// -- Smart-money quality gates (applied at activation, not pre-filter) ---------
const MIN_EQUITY_FOR_ACTIVATION    = 10_000; // $10k minimum live equity (smart money has capital)
const MIN_PROFIT_FACTOR            = 1.3;    // gross wins / gross losses -- excludes barely-profitable
const MAX_DRAWDOWN_FOR_ACTIVATION  = 0.40;   // reject wallets with >40% 30d drawdown
const MAX_TRADES_30D               = 1000;   // scaled to 60d window (>1000 = ~17 trades/day = wash/farm)
const MIN_HISTORY_VOLUME_RATIO     = 0.95;   // monthVlm/allTimeVlm <= this => >=5% volume predates this month
const MAX_FEE_RATIO                = 0.60;   // fees / |gross_pnl| > 0.60 = fee economics of wash, not alpha
const SYBIL_CORRELATION_THRESHOLD  = 0.95;   // Pearson r > 0.95 on 60d daily PnL = same operator
const MIN_NONZERO_DAYS_FOR_SYBIL   = 30;     // min active trading days before sybil correlation is trusted
const SCALPER_THRESHOLD            = 300;    // >300 trades/60d = 5+/day
// Stream A gate G10 (Sprint 8). Threshold re-fit empirically in Sprint 13 from cohort_attrition data.
const MAX_LEVERAGE_G10             = 15;     // deactivate wallets whose max observed leverage exceeds this
const TREND_THRESHOLD              = 60;     // <60 trades/60d = <1/day
const MIN_REGIME_DAYS              = 5;      // min days in a regime to compute a meaningful average
const MAX_PROFILE_COINS            = 5;      // top N coins by notional from latest snapshot

// -- Multi-window gates (G11/G12/G13, Sprint R11) ------------------------------
// Fetch 180d fills only for wallets that already passed G1-G10 (controls API cost).
const SCORE_STABILITY_THRESHOLD    = 0.25;   // G11 -- reject if max-min score across three windows > this
const MIN_REGIME_DAYS_G12          = 10;     // G12 -- require >=10 active trading days per regime bucket (180d)
const MULTI_WINDOW_DAYS            = 180;    // G13 -- fills window to fetch for G11/G12
const MULTI_WINDOW_CONCURRENCY     = 4;      // higher throughput is safe here (secondary, post-activation pass)
const OOCV_TARGET_SIZE             = 400;    // target held-out OOCV sample: stratified random from rejected-but-prequalified

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

// -- Multi-window helpers (Sprint R11) -----------------------------------------

// Parameterised version of buildDailyPnls; builds an array of `windowDays` length
// with index 0 = oldest day and index N-1 = today.
function buildDailyPnlsForWindow(fills: FillRecord[], windowDays: number): number[] {
  const byDay = new Map<string, number>();
  for (const f of fills) {
    const day = new Date(f.time).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + parseFloat(f.closedPnl));
  }
  const pnls = new Array<number>(windowDays).fill(0);
  const today = new Date();
  for (const [day, pnl] of byDay) {
    const daysAgo = Math.floor(
      (today.getTime() - new Date(day).getTime()) / 86_400_000
    );
    if (daysAgo >= 0 && daysAgo < windowDays) {
      pnls[windowDays - 1 - daysAgo] = pnl;
    }
  }
  return pnls;
}

// Composite 4-factor score for any daily-PnL window.
// Uses the same formula as app-side cohort scoring but substitutes
// regime_edge (historical) for regime_fit (live position bias).
function computeWindowScore(dailyPnls: number[], regimeLabels: string[]): number {
  const sharpe      = computeSharpeProxy(dailyPnls);
  const drawdown    = computeDrawdownScore(dailyPnls);
  const consistency = computeConsistency(dailyPnls);
  const rStats      = computeRegimeStats(dailyPnls, regimeLabels, MIN_REGIME_DAYS);
  const regimeEdge  = rStats.regime_edge !== null ? Math.max(0, rStats.regime_edge) : 0;
  return 0.35 * sharpe + 0.25 * consistency + 0.25 * drawdown + 0.15 * regimeEdge;
}

// Fetch closing fills for the 180d multi-window pass.
async function fetchFills180d(address: string): Promise<FillRecord[]> {
  const windowStart = Date.now() - MULTI_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return hlPost<FillRecord[]>({
    type: "userFillsByTime",
    user: address,
    startTime: windowStart,
    endTime: Date.now(),
  });
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
  wash_score:             number | null;
  error?: string;
}

async function scoreWallet(
  address:          string,
  leaderboardEntry: LeaderboardEntry | null,
): Promise<ScoringResult> {
  const windowStart = Date.now() - SCORING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const fills = await hlPost<FillRecord[]>({
    type: "userFillsByTime",
    user: address,
    startTime: windowStart,
    endTime: Date.now(),
  });

  // Live equity comes from the leaderboard snapshot for tier1. For tier2/tier3
  // (not on today's leaderboard) we defer equity gating to the cron dust-check —
  // firing clearinghouseState here roughly doubled API calls and pushed the scan
  // past its 50-min budget.
  const liveEquity: number | null = leaderboardEntry?.accountValue ?? null;

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

  // Wash detection: compute fee_ratio for all wallets that passed prior gates.
  // Store regardless of outcome so the distribution is tunable post-scan.
  let wash_score: number | null = null;
  if (rejection_reason === null) {
    wash_score = computeFeeRatio(total_fees_30d, realized_pnl_30d_gross);
    if (wash_score > MAX_FEE_RATIO) rejection_reason = "wash_detected";
  }

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
    wash_score,
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
      ...(result.wash_score !== null && { wash_score: result.wash_score }),
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

// -- Sybil cluster detection ---------------------------------------------------

async function detectSybilClusters(
  qualifiedWallets: Map<string, number>,  // walletId -> profit_factor
): Promise<{ clustersFound: number; walletsDeactivated: number }> {
  const walletIds = [...qualifiedWallets.keys()];

  const { data: backtestRows, error } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, daily_pnls")
    .in("wallet_id", walletIds);

  if (error) {
    console.error("[sybil] backtest fetch error:", error.message);
    return { clustersFound: 0, walletsDeactivated: 0 };
  }

  const seriesMap = new Map<string, number[]>();
  for (const row of backtestRows ?? []) {
    if (Array.isArray(row.daily_pnls)) {
      seriesMap.set(row.wallet_id, row.daily_pnls as number[]);
    }
  }

  const clusters = findSybilClusters(seriesMap, SYBIL_CORRELATION_THRESHOLD, MIN_NONZERO_DAYS_FOR_SYBIL);

  if (clusters.size === 0) return { clustersFound: 0, walletsDeactivated: 0 };

  let walletsDeactivated = 0;
  const now = new Date().toISOString();

  for (const [clusterId, members] of clusters) {
    // Keep the wallet with the highest profit_factor; deactivate the rest
    let primaryId = members[0];
    let bestPf    = qualifiedWallets.get(primaryId) ?? 0;
    for (const id of members) {
      const pf = qualifiedWallets.get(id) ?? 0;
      if (pf > bestPf) { bestPf = pf; primaryId = id; }
    }

    const duplicates = members.filter((id) => id !== primaryId);

    // Label primary with cluster ID (stays active)
    await supabase.from("wallets").update({ sybil_cluster_id: clusterId }).eq("id", primaryId);

    // Deactivate duplicates
    if (duplicates.length > 0) {
      const { error: deactErr } = await supabase
        .from("wallets")
        .update({ is_active: false, deactivation_reason: "sybil_duplicate", deactivated_at: now, sybil_cluster_id: clusterId })
        .in("id", duplicates);

      if (deactErr) {
        console.error(`[sybil] deactivate error for cluster ${clusterId}:`, deactErr.message);
      } else {
        walletsDeactivated += duplicates.length;
      }
    }
  }

  return { clustersFound: clusters.size, walletsDeactivated };
}

// -- Wallet behavior profiles --------------------------------------------------

interface HlCandle {
  t: number; T: number; s: string; i: string;
  o: string; c: string; h: string; l: string; v: string; n: number;
}

async function computeWalletProfiles(): Promise<{ computed: number; skipped: number }> {
  let computed = 0;
  let skipped  = 0;

  // Fetch 60 BTC 1d candles aligned to the same window origin as buildDailyPnls
  const windowStart = Date.now() - SCORING_WINDOW_DAYS * 86400 * 1000;
  let btcCandles: HlCandle[] = [];
  try {
    btcCandles = await hlPost<HlCandle[]>({
      type: "candleSnapshot",
      req: { coin: "BTC", interval: "1d", startTime: windowStart, endTime: Date.now() },
    });
  } catch (err) {
    console.warn("[profiles] BTC candle fetch failed, skipping profile run:", err);
    return { computed, skipped };
  }

  // Build parallel regime label array aligned with daily_pnls index
  const regimeLabels: string[] = btcCandles.map((c) => {
    const ret = (parseFloat(c.c) - parseFloat(c.o)) / parseFloat(c.o);
    if (ret > 0.01)  return "BULL";
    if (ret < -0.01) return "BEAR";
    return "RANGING";
  });

  // Fetch all active wallets
  const { data: activeWallets, error: walletErr } = await supabase
    .from("wallets")
    .select("id")
    .eq("is_active", true);
  if (walletErr || !activeWallets?.length) {
    console.warn("[profiles] could not fetch active wallets:", walletErr?.message);
    return { computed, skipped };
  }
  const activeWalletIds = activeWallets.map((w) => w.id);

  // Fetch user_pnl_backtest rows for all active wallets
  const { data: backtestRows } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, total_trades, daily_pnls")
    .in("wallet_id", activeWalletIds);
  const backtestMap = new Map(
    (backtestRows ?? []).map((r) => [r.wallet_id, r])
  );

  // Fetch cohort_snapshots -- dedup to latest per wallet in JS
  const { data: snapshotRows } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, positions, created_at")
    .in("wallet_id", activeWalletIds);
  const latestSnapshot = new Map<string, { positions: unknown[]; created_at: string }>();
  for (const row of snapshotRows ?? []) {
    const existing = latestSnapshot.get(row.wallet_id);
    if (!existing || row.created_at > existing.created_at) {
      latestSnapshot.set(row.wallet_id, { positions: row.positions ?? [], created_at: row.created_at });
    }
  }

  // Compute profile per wallet
  type ProfileRow = {
    wallet_id:         string;
    computed_at:       string;
    trading_style:     string;
    pnl_consistency:   number;
    bull_daily_pnl:    number | null;
    bear_daily_pnl:    number | null;
    ranging_daily_pnl: number | null;
    regime_edge:       number | null;
    current_coins:     string[];
    regime_day_counts: { BULL: number; BEAR: number; RANGING: number };
  };
  const batch: ProfileRow[] = [];

  for (const walletId of activeWalletIds) {
    const bt = backtestMap.get(walletId);
    if (!bt) { skipped++; continue; }

    const trading_style   = classifyTradingStyle(bt.total_trades);
    const pnl_consistency = computeConsistency(bt.daily_pnls ?? []);
    const regimeStats     = computeRegimeStats(bt.daily_pnls ?? [], regimeLabels, MIN_REGIME_DAYS);

    const snap          = latestSnapshot.get(walletId);
    const current_coins = snap ? extractTopCoins(snap.positions, MAX_PROFILE_COINS) : [];

    batch.push({
      wallet_id:         walletId,
      computed_at:       new Date().toISOString(),
      trading_style,
      pnl_consistency,
      bull_daily_pnl:    regimeStats.bull_daily_pnl,
      bear_daily_pnl:    regimeStats.bear_daily_pnl,
      ranging_daily_pnl: regimeStats.ranging_daily_pnl,
      regime_edge:       regimeStats.regime_edge,
      current_coins,
      regime_day_counts: regimeStats.regime_day_counts,
    });
    computed++;
  }

  if (batch.length > 0) {
    const { error: upsertErr } = await supabase
      .from("wallet_profiles")
      .upsert(batch, { onConflict: "wallet_id" });
    if (upsertErr) {
      console.warn("[profiles] upsert error:", upsertErr.message);
    }
  }

  return { computed, skipped };
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

// -- Leverage stats + G10 gate ------------------------------------------------

async function computeLeverageStats(): Promise<{ computed: number; g10_deactivated: number }> {
  const { data: activeWallets, error: walletErr } = await supabase
    .from("wallets")
    .select("id, address")
    .eq("is_active", true);

  if (walletErr || !activeWallets?.length) {
    console.warn("[leverage] could not fetch active wallets:", walletErr?.message);
    return { computed: 0, g10_deactivated: 0 };
  }

  const walletIds = activeWallets.map((w) => w.id);

  // Fetch available snapshots (cleanup job keeps 2 per wallet)
  const { data: snapshots } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, positions, account_value")
    .in("wallet_id", walletIds);

  // Fetch PnL for leverage_adj_return
  const { data: backtestRows } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, total_pnl_usd")
    .in("wallet_id", walletIds);

  const pnlMap = new Map(
    (backtestRows ?? []).map((r) => [r.wallet_id as string, Number(r.total_pnl_usd ?? 0)])
  );

  // Group snapshots by wallet
  type SnapRow = { positions: unknown[]; account_value: number };
  const snapsByWallet = new Map<string, SnapRow[]>();
  for (const snap of snapshots ?? []) {
    const rows = snapsByWallet.get(snap.wallet_id) ?? [];
    rows.push({ positions: (snap.positions ?? []) as unknown[], account_value: Number(snap.account_value) });
    snapsByWallet.set(snap.wallet_id, rows);
  }

  type LeverageUpdate = {
    id: string;
    max_leverage_60d: number;
    avg_leverage_60d: number;
    leverage_adj_return: number;
    blow_up_distance: number;
  };
  const leverageUpdates: LeverageUpdate[] = [];
  const backtestUpdates: Array<{ wallet_id: string; max_leverage_day: number; avg_leverage_day: number }> = [];

  for (const wallet of activeWallets) {
    const snaps = snapsByWallet.get(wallet.id);
    if (!snaps?.length) continue;

    const allLeverages: number[] = [];
    for (const snap of snaps) {
      for (const ap of snap.positions as Record<string, unknown>[]) {
        const pos = ap?.position as Record<string, unknown> | undefined;
        const lev = pos?.leverage as Record<string, unknown> | undefined;
        const val = lev?.value;
        if (typeof val === "number" && val > 0) allLeverages.push(val);
      }
    }

    if (allLeverages.length === 0) continue;

    const max_leverage = Math.max(...allLeverages);
    const avg_leverage = allLeverages.reduce((a, b) => a + b, 0) / allLeverages.length;
    const total_pnl    = pnlMap.get(wallet.id) ?? 0;

    leverageUpdates.push({
      id:                  wallet.id,
      max_leverage_60d:    max_leverage,
      avg_leverage_60d:    avg_leverage,
      leverage_adj_return: avg_leverage > 0 ? total_pnl / (1 + avg_leverage) : total_pnl,
      blow_up_distance:    Math.max(0, Math.min(1, 1 - max_leverage / MAX_LEVERAGE_G10)),
    });

    backtestUpdates.push({
      wallet_id:        wallet.id,
      max_leverage_day: max_leverage,
      avg_leverage_day: avg_leverage,
    });
  }

  // Update wallets table individually (can't bulk-upsert due to NOT NULL address constraint)
  let computed = 0;
  for (const { id, ...patch } of leverageUpdates) {
    const { error } = await supabase.from("wallets").update(patch).eq("id", id);
    if (!error) computed++;
  }

  // Bulk upsert user_pnl_backtest leverage fields
  if (backtestUpdates.length > 0) {
    const { error } = await supabase.from("user_pnl_backtest").upsert(backtestUpdates, { onConflict: "wallet_id" });
    if (error) console.warn("[leverage] backtest upsert error:", error.message);
  }

  // G10 gate: deactivate wallets exceeding the leverage ceiling
  const toDeactivate = leverageUpdates
    .filter((u) => u.max_leverage_60d > MAX_LEVERAGE_G10)
    .map((u) => u.id);

  let g10_deactivated = 0;
  if (toDeactivate.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("wallets")
      .update({ is_active: false, deactivation_reason: "high_leverage", deactivated_at: now })
      .in("id", toDeactivate);
    if (!error) {
      g10_deactivated = toDeactivate.length;
      console.log(`[leverage] G10 gate deactivated ${g10_deactivated} high-leverage wallets`);
    }
  }

  return { computed, g10_deactivated };
}

// Phase 10b: Shadow scoring (Sprint R13 canary)

async function computeShadowScores(): Promise<{ computed: number }> {
  const { data: activeWallets, error: walletErr } = await supabase
    .from("wallets")
    .select("id, avg_leverage_60d, max_leverage_60d")
    .eq("is_active", true)
    .not("max_leverage_60d", "is", null);

  if (walletErr || !activeWallets?.length) {
    console.warn("[shadow] could not fetch wallets:", walletErr?.message);
    return { computed: 0 };
  }

  const walletIds = activeWallets.map((w) => w.id);

  const { data: backtests } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, daily_pnls")
    .in("wallet_id", walletIds);

  const pnlMap = new Map<string, number[]>(
    (backtests ?? []).map((b) => [
      b.wallet_id as string,
      Array.isArray(b.daily_pnls) ? (b.daily_pnls as number[]) : [],
    ])
  );

  let computed = 0;

  for (const wallet of activeWallets) {
    const dailyPnls   = pnlMap.get(wallet.id) ?? [];
    const avgLeverage = Number(wallet.avg_leverage_60d ?? 0);
    const maxLeverage = Number(wallet.max_leverage_60d ?? 0);

    const v2 = computeCohortScoresV2(dailyPnls, avgLeverage, maxLeverage);
    // regime_fit defaults to 0.5 since clearinghouse state is not available in the daily scan

    const { error } = await supabase
      .from("wallets")
      .update({
        overall_score_shadow:   v2.overall_score_v2,
        shadow_formula_version: SHADOW_FORMULA_VERSION,
      })
      .eq("id", wallet.id);

    if (!error) computed++;
  }

  console.log(`[shadow] computed shadow scores for ${computed} wallets`);
  return { computed };
}

// -- Cohort attrition ----------------------------------------------------------

function deactivationReasonToState(reason: string | null | undefined): string {
  if (!reason) return "active";
  if (reason === "high_leverage" || reason === "liquidation_imminent") return "blown_up";
  if (reason === "max_drawdown" || reason === "drawdown_threshold" || reason === "drawdown_7d") return "deactivated_drawdown";
  if (reason === "low_equity" || reason === "low_equity_cycles" || reason === "liq_imminent") return "deactivated_drawdown";
  if (reason === "wash_detected" || reason === "sybil_duplicate") return "deactivated_wash";
  return "deactivated_inactivity";
}

async function upsertAttritionStates(): Promise<{ upserted: number }> {
  // Include wallets that are currently active OR have ever been deactivated for a known reason
  const { data: wallets, error: walletErr } = await supabase
    .from("wallets")
    .select("address, id, is_active, deactivation_reason, deactivated_at")
    .or("is_active.eq.true,deactivation_reason.not.is.null");

  if (walletErr || !wallets?.length) {
    console.warn("[attrition] could not fetch wallet list:", walletErr?.message);
    return { upserted: 0 };
  }

  // Preserve first_active_date for existing rows
  const { data: existing } = await supabase
    .from("cohort_attrition")
    .select("wallet_address, first_active_date")
    .in("wallet_address", wallets.map((w) => w.address));

  const existingMap = new Map(
    (existing ?? []).map((r) => [r.wallet_address as string, r.first_active_date as string])
  );

  const today = new Date().toISOString().slice(0, 10);
  const now   = new Date();

  function stateAtDays(
    firstActive: Date,
    deactivatedAt: Date | null,
    isActive: boolean,
    reason: string | null | undefined,
    days: number,
  ): string {
    const milestone = new Date(firstActive);
    milestone.setDate(milestone.getDate() + days);
    if (now < milestone) return "never_reached";
    if (isActive) return "active";
    if (deactivatedAt && deactivatedAt <= milestone) return deactivationReasonToState(reason);
    return "active"; // deactivated after this milestone
  }

  const rows = wallets.map((w) => {
    const first_active_date = existingMap.get(w.address) ?? today;
    const firstActiveDate   = new Date(first_active_date);
    const deactivatedAt     = w.deactivated_at ? new Date(w.deactivated_at) : null;
    const last_seen_active  = w.is_active ? today : (deactivatedAt?.toISOString().slice(0, 10) ?? null);

    return {
      wallet_address:   w.address,
      wallet_id:        w.id,
      first_active_date,
      last_seen_active,
      state_30d:        stateAtDays(firstActiveDate, deactivatedAt, w.is_active, w.deactivation_reason, 30),
      state_90d:        stateAtDays(firstActiveDate, deactivatedAt, w.is_active, w.deactivation_reason, 90),
      state_180d:       stateAtDays(firstActiveDate, deactivatedAt, w.is_active, w.deactivation_reason, 180),
      state_360d:       stateAtDays(firstActiveDate, deactivatedAt, w.is_active, w.deactivation_reason, 360),
      updated_at:       new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("cohort_attrition")
    .upsert(rows, { onConflict: "wallet_address" });

  if (error) {
    console.error("[attrition] upsert error:", error.message);
    return { upserted: 0 };
  }

  return { upserted: rows.length };
}

// -- Multi-window gates (G11/G12/G13, Sprint R11) ------------------------------

// Phase 12: For every currently-active wallet, fetch 180d fills (G13 condition),
// compute score_30d/score_90d/score_180d + regime day counts, then apply:
//   G11 (score_stability > 0.25) -> deactivate as "score_unstable"
//   G12 (< 10 active days in any regime bucket) -> deactivate as "low_regime_coverage"
// Stores multi-window score columns and regime_at_day on user_pnl_backtest.
async function computeMultiWindowGates(): Promise<{
  computed: number;
  g11_deactivated: number;
  g12_deactivated: number;
}> {
  // Fetch 180d BTC candles for regime label alignment.
  const windowStart = Date.now() - MULTI_WINDOW_DAYS * 86_400_000;
  let btcCandles: HlCandle[] = [];
  try {
    btcCandles = await hlPost<HlCandle[]>({
      type: "candleSnapshot",
      req: { coin: "BTC", interval: "1d", startTime: windowStart, endTime: Date.now() },
    });
  } catch (err) {
    console.warn("[multi-window] BTC candle fetch failed, skipping Phase 12:", err);
    return { computed: 0, g11_deactivated: 0, g12_deactivated: 0 };
  }

  // Build regime label array aligned oldest-first (matches buildDailyPnlsForWindow index).
  // Defensive sort: candleSnapshot is always ascending but make it explicit.
  btcCandles.sort((a, b) => a.t - b.t);
  const regimeLabels180: string[] = btcCandles.map((c) => {
    const ret = (parseFloat(c.c) - parseFloat(c.o)) / parseFloat(c.o);
    if (ret > 0.01)  return "BULL";
    if (ret < -0.01) return "BEAR";
    return "RANGING";
  });

  const { data: activeWallets } = await supabase
    .from("wallets")
    .select("id, address")
    .eq("is_active", true);

  if (!activeWallets?.length) return { computed: 0, g11_deactivated: 0, g12_deactivated: 0 };

  const mwSem = new Semaphore(MULTI_WINDOW_CONCURRENCY);
  let computed = 0, g11_deactivated = 0, g12_deactivated = 0;

  await Promise.allSettled(
    activeWallets.map(async (wallet) => {
      await mwSem.acquire();
      try {
        let fills180: FillRecord[];
        try {
          fills180 = await fetchFills180d(wallet.address);
        } catch {
          return; // G13: skip G11/G12 if 180d fetch unavailable
        }

        const closingFills = fills180.filter((f) => parseFloat(f.closedPnl) !== 0);

        const pnls30  = buildDailyPnlsForWindow(closingFills, 30);
        const pnls90  = buildDailyPnlsForWindow(closingFills, 90);
        const pnls180 = buildDailyPnlsForWindow(closingFills, MULTI_WINDOW_DAYS);

        // Use last N regime labels aligned to each window
        const rl30  = regimeLabels180.slice(-30);
        const rl90  = regimeLabels180.slice(-90);
        const rl180 = regimeLabels180;

        const score30  = computeWindowScore(pnls30,  rl30);
        const score90  = computeWindowScore(pnls90,  rl90);
        const score180 = computeWindowScore(pnls180, rl180);
        const stability = Math.max(score30, score90, score180) - Math.min(score30, score90, score180);

        // Count active (non-zero PnL) trading days per regime bucket over 180d window.
        const len = Math.min(pnls180.length, rl180.length);
        let bull_days = 0, bear_days = 0, ranging_days = 0;
        for (let i = 0; i < len; i++) {
          if (pnls180[i] === 0) continue;
          if (rl180[i] === "BULL")    bull_days++;
          else if (rl180[i] === "BEAR")    bear_days++;
          else if (rl180[i] === "RANGING") ranging_days++;
        }

        computed++;

        let deactivationReason: string | null = null;
        if (stability > SCORE_STABILITY_THRESHOLD) {
          deactivationReason = "score_unstable";
        } else if (
          bull_days    < MIN_REGIME_DAYS_G12 ||
          bear_days    < MIN_REGIME_DAYS_G12 ||
          ranging_days < MIN_REGIME_DAYS_G12
        ) {
          deactivationReason = "low_regime_coverage";
        }

        const now = new Date().toISOString();
        const walletPatch: Record<string, unknown> = {
          score_30d:       score30,
          score_90d:       score90,
          score_180d:      score180,
          bull_days,
          bear_days,
          ranging_days,
          score_stability: stability,
        };
        if (deactivationReason) {
          walletPatch.is_active           = false;
          walletPatch.deactivation_reason = deactivationReason;
          walletPatch.deactivated_at      = now;
          if (deactivationReason === "score_unstable") g11_deactivated++;
          else                                         g12_deactivated++;
        }

        await supabase.from("wallets").update(walletPatch).eq("id", wallet.id);

        // Persist regime_at_day alongside the backtest row for downstream consumers.
        // Sliced to SCORING_WINDOW_DAYS so it aligns index-for-index with daily_pnls.
        await supabase
          .from("user_pnl_backtest")
          .update({ regime_at_day: regimeLabels180.slice(-SCORING_WINDOW_DAYS) })
          .eq("wallet_id", wallet.id);

      } catch (err) {
        console.warn(`[multi-window] ${wallet.address} error:`, err);
      } finally {
        mwSem.release();
      }
    })
  );

  return { computed, g11_deactivated, g12_deactivated };
}

// Phase 13: Stratified random sample from wallets that passed the leaderboard
// pre-filter but failed activation gates. Upserts into out_of_cohort_tracking.
// Existing OOCV rows are left untouched (ignoreDuplicates); wallets that have
// since activated are marked is_active_in_oocv = false.
async function sampleOocvWallets(
  prequalifiedRejected: Map<string, string>, // address -> rejection_reason
  addressToId: Map<string, string>,          // address -> DB UUID
): Promise<{ sampled: number }> {
  if (prequalifiedRejected.size === 0) return { sampled: 0 };

  // Mark any OOCV wallets that graduated to active cohort as inactive in OOCV.
  const { data: nowActive } = await supabase
    .from("wallets")
    .select("address")
    .eq("is_active", true);
  const activeAddrs = new Set((nowActive ?? []).map((w: { address: string }) => w.address.toLowerCase()));
  const { data: oocvRows } = await supabase
    .from("out_of_cohort_tracking")
    .select("wallet_address")
    .eq("is_active_in_oocv", true);
  const toDegrade = (oocvRows ?? [])
    .filter((r: { wallet_address: string }) => activeAddrs.has(r.wallet_address.toLowerCase()))
    .map((r: { wallet_address: string }) => r.wallet_address);
  if (toDegrade.length > 0) {
    await supabase
      .from("out_of_cohort_tracking")
      .update({ is_active_in_oocv: false, removed_at: new Date().toISOString() })
      .in("wallet_address", toDegrade);
  }

  // Stratify by rejection reason: take up to (target / buckets) per reason.
  const byReason = new Map<string, string[]>();
  for (const [addr, reason] of prequalifiedRejected) {
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason)!.push(addr);
  }

  const perBucket = Math.ceil(OOCV_TARGET_SIZE / byReason.size);
  const sample: Array<{ wallet_address: string; wallet_id: string | null; basis: string }> = [];

  for (const [reason, addresses] of byReason) {
    const shuffled = [...addresses].sort(() => Math.random() - 0.5).slice(0, perBucket);
    for (const addr of shuffled) {
      sample.push({
        wallet_address: addr,
        wallet_id:      addressToId.get(addr) ?? null,
        basis:          `stratified_random:${reason}`,
      });
    }
  }

  const final = sample.slice(0, OOCV_TARGET_SIZE);
  if (final.length === 0) return { sampled: 0 };

  const now = new Date().toISOString();
  const rows = final.map((r) => ({
    wallet_address:    r.wallet_address,
    wallet_id:         r.wallet_id,
    added_at:          now,
    basis:             r.basis,
    is_active_in_oocv: true,
  }));

  // oocv_sampled = candidates identified this run (not net-new inserts).
  // ignoreDuplicates means existing rows are silently skipped; count from
  // the upsert response is unreliable across Supabase client versions.
  const CHUNK = 100;
  let errors = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("out_of_cohort_tracking")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "wallet_address", ignoreDuplicates: true });
    if (error) errors++;
  }

  return { sampled: errors === 0 ? final.length : 0 };
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
      wash_detected:       0,
      score_unstable:      0,
      low_regime_coverage: 0,
    } as Record<string, number>,
    sybil_clusters_found:      0,
    sybil_wallets_deactivated: 0,
    profiles_computed:         0,
    profiles_skipped:          0,
    leverage_computed:         0,
    g10_deactivated:           0,
    attrition_upserted:        0,
    score_history_written:     0,
    g11_deactivated:           0,
    g12_deactivated:           0,
    oocv_sampled:              0,
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
  // Cap tier1 at top N by monthly ROI (leaderboardMap is already sorted). Prevents
  // a permissive market day from pushing the scoring set past the 50-min budget.
  const leaderboardAddresses = Array.from(leaderboardMap.keys()).slice(0, MAX_TIER1_LEADERBOARD);

  // Tier 3 (stale-DB rescores) dropped: lowest-value tier, 25% of scan time for
  // wallets that were previously rejected and will be picked up again via tier1
  // if they re-enter the leaderboard. Observed per-slot cost ~2.6s means the
  // 50-min budget only fits tier1+tier2 (~2200 wallets).
  const seen = new Set<string>();
  const rawScoreAddresses: string[] = [];
  const pushUnique = (addr: string) => {
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rawScoreAddresses.push(addr);
  };
  for (const a of leaderboardAddresses) pushUnique(a);
  for (const a of activeAddresses)      pushUnique(a);
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

  // Tracks wallets that qualify in this run for post-scan sybil analysis.
  // Keyed by wallet DB ID -> profit_factor (used to pick cluster primary).
  const qualifiedForSybil = new Map<string, number>();

  const scoringStart = Date.now();
  let completed = 0;
  let errors    = 0;
  const PROGRESS_EVERY = 250;

  const results = await Promise.allSettled(
    scoreAddresses.map(async (address) => {
      await sem.acquire();
      try {
        const leaderboardEntry = leaderboardMap.get(address.toLowerCase()) ?? null;
        const result           = await scoreWallet(address, leaderboardEntry);
        await updateWalletMetrics(result);

        // Save backtest only for qualifying wallets -- the cron's real-time scoring
        // only reads daily_pnls for active wallets. Rejected wallets get re-scored
        // from fresh fills on the next scan anyway. Cuts ~70% of DB writes.
        if (result.qualifies) {
          const walletId = addressToId.get(address);
          if (walletId) {
            await saveBacktestRow(walletId, result);
          }
        }

        if (result.qualifies) {
          summary.activated++;
          // Track qualifying wallet IDs for post-scan sybil analysis
          const walletId = addressToId.get(address);
          if (walletId) qualifiedForSybil.set(walletId, result.profit_factor);
        }
        if (result.win_rate > summary.top_win_rate) summary.top_win_rate = result.win_rate;

        return result;
      } catch (err) {
        errors++;
        throw err;
      } finally {
        completed++;
        if (completed % PROGRESS_EVERY === 0 || completed === scoreAddresses.length) {
          const elapsedMin = (Date.now() - scoringStart) / 60_000;
          const rate       = completed / Math.max(elapsedMin, 0.01);
          const remaining  = scoreAddresses.length - completed;
          const etaMin     = remaining / Math.max(rate, 0.01);
          console.log(
            `[scoring] ${completed}/${scoreAddresses.length} done, ` +
            `elapsed ${elapsedMin.toFixed(1)}m, rate ${rate.toFixed(1)}/min, ` +
            `errors ${errors}, eta ${etaMin.toFixed(1)}m`
          );
        }
        sem.release();
      }
    })
  );

  // Wallets that passed the leaderboard pre-filter but failed activation gates.
  // Sampled in Phase 13 to build the OOCV held-out set.
  const prequalifiedRejected = new Map<string, string>(); // address -> rejection_reason

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
      // OOCV candidate: failed activation but passed the pre-filter quality bar.
      // Entity-excluded wallets are not interesting controls -- skip them.
      const entry = leaderboardMap.get(r.value.address.toLowerCase());
      if (
        reason !== "entity_excluded" &&
        entry &&
        entry.monthPnl >= PRE_QUALIFY_MIN_MONTH_PNL &&
        entry.allTimePnl >= PRE_QUALIFY_MIN_ALLTIME_PNL
      ) {
        prequalifiedRejected.set(r.value.address, reason);
      }
    }
  }

  // Compute and persist recipe performance metrics from the last 30 days of signals
  await computeAndSaveRecipePerformance();

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

  // ── Phase 7: Sybil detection ───────────────────────────────────────────────
  if (qualifiedForSybil.size >= 2) {
    console.log(`\n[sybil] Running cluster detection on ${qualifiedForSybil.size} qualified wallets...`);
    const sybilResult = await detectSybilClusters(qualifiedForSybil);
    summary.sybil_clusters_found      = sybilResult.clustersFound;
    summary.sybil_wallets_deactivated = sybilResult.walletsDeactivated;
    console.log(`[sybil] clusters: ${sybilResult.clustersFound}, deactivated: ${sybilResult.walletsDeactivated}`);
  }

  // ── Phase 8: Per-wallet behavior profiles ─────────────────────────────────
  console.log("\n[Phase 8] Computing wallet behavior profiles...");
  const profileResult = await computeWalletProfiles();
  summary.profiles_computed = profileResult.computed;
  summary.profiles_skipped  = profileResult.skipped;
  console.log(`[profiles] computed: ${profileResult.computed}, skipped: ${profileResult.skipped}`);

  // ── Phase 9: Leverage stats + G10 gate ────────────────────────────────────
  console.log("\n[Phase 9] Computing leverage stats and applying G10 gate...");
  const leverageResult = await computeLeverageStats();
  summary.leverage_computed = leverageResult.computed;
  summary.g10_deactivated   = leverageResult.g10_deactivated;
  console.log(`[leverage] computed: ${leverageResult.computed}, G10 deactivated: ${leverageResult.g10_deactivated}`);
  const shadowResult = await computeShadowScores();
  console.log(`[phase-10b] shadow scores: ${shadowResult.computed} computed`);

  // ── Phase 10: Cohort attrition upsert ─────────────────────────────────────
  console.log("\n[Phase 10] Upserting cohort attrition states...");
  const attritionResult = await upsertAttritionStates();
  summary.attrition_upserted = attritionResult.upserted;
  console.log(`[attrition] upserted: ${attritionResult.upserted} rows`);

  // ── Phase 11: Write daily score history for rank IC ───────────────────────
  console.log("\n[Phase 11] Writing score history for rank IC...");
  const scoreHistoryResult = await writeScoreHistory();
  summary.score_history_written = scoreHistoryResult.written;
  console.log(`[score-history] written: ${scoreHistoryResult.written} rows`);

  // ── Phase 12: Multi-window scoring + G11/G12 gates ────────────────────────
  // Fetches 180d fills (G13) for active wallets, computes score_30d/90d/180d,
  // bull/bear/ranging day counts, and applies G11 (score_stability) and G12
  // (regime_coverage) gates.
  console.log("\n[Phase 12] Multi-window scoring and G11/G12 gates...");
  const mwResult = await computeMultiWindowGates();
  summary.g11_deactivated = mwResult.g11_deactivated;
  summary.g12_deactivated = mwResult.g12_deactivated;
  summary.rejection_breakdown.score_unstable      += mwResult.g11_deactivated;
  summary.rejection_breakdown.low_regime_coverage += mwResult.g12_deactivated;
  console.log(
    `[multi-window] computed: ${mwResult.computed}, ` +
    `G11 deactivated: ${mwResult.g11_deactivated}, G12 deactivated: ${mwResult.g12_deactivated}`
  );

  // ── Phase 13: OOCV sample ─────────────────────────────────────────────────
  // Stratified random sample of wallets that passed the leaderboard pre-filter
  // but failed activation gates. These form the held-out control group for
  // recipe base-rate comparison (signals measured but never served).
  console.log("\n[Phase 13] Sampling out-of-cohort validation set...");
  const oocvResult = await sampleOocvWallets(prequalifiedRejected, addressToId);
  summary.oocv_sampled = oocvResult.sampled;
  console.log(`[oocv] sampled: ${oocvResult.sampled} new wallets into out_of_cohort_tracking`);

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
}

// ── Phase 11: Write score history for rank IC ─────────────────────────────────
// Snapshots every active wallet's overall_score and today's daily PnL (the most
// recent element of user_pnl_backtest.daily_pnls) into wallet_score_history.
// After 31+ days of history, scripts/rank-ic.ts can compute rank IC.
async function writeScoreHistory(): Promise<{ written: number }> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: activeWallets, error: walletErr } = await supabase
    .from("wallets")
    .select("id, overall_score")
    .eq("is_active", true)
    .not("overall_score", "is", null);

  if (walletErr) {
    console.error("[score-history] fetch error:", walletErr.message);
    return { written: 0 };
  }
  if (!activeWallets || activeWallets.length === 0) return { written: 0 };

  const walletIds = activeWallets.map((w) => w.id);

  // Fetch daily_pnls for each active wallet; index [SCORING_WINDOW_DAYS-1] = most recent day
  const { data: backtests } = await supabase
    .from("user_pnl_backtest")
    .select("wallet_id, daily_pnls")
    .in("wallet_id", walletIds);

  const pnlMap = new Map<string, number>();
  for (const bt of backtests ?? []) {
    const arr = bt.daily_pnls as number[] | null;
    if (Array.isArray(arr) && arr.length > 0) {
      pnlMap.set(bt.wallet_id, arr[arr.length - 1] ?? 0);
    }
  }

  const rows = activeWallets.map((w) => ({
    date:          today,
    wallet_id:     w.id,
    overall_score: w.overall_score,
    daily_pnl_usd: pnlMap.get(w.id) ?? 0,
  }));

  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("wallet_score_history")
      .upsert(chunk, { onConflict: "date,wallet_id" });
    if (error) {
      console.error("[score-history] upsert error:", error.message);
    } else {
      written += chunk.length;
    }
  }
  return { written };
}

main().catch((err) => {
  console.error("[scan] Fatal:", err);
  process.exit(1);
});
