// scripts/daily-wallet-scan.ts
// Daily wallet discovery and scoring pipeline.
// Run via: npx tsx scripts/daily-wallet-scan.ts
//
// Called by .github/workflows/daily-wallet-scan.yml at 02:00 UTC.
// Does NOT import Next.js or Vercel KV — writes directly to Supabase.
//
// Flow:
//   1. Discover wallet addresses from Hyperliquid leaderboard API (with scrape fallback)
//   2. Upsert addresses into wallets table
//   3. Score each wallet: fetch fills → compute win_rate, trade_count_30d, realized_pnl_30d
//   4. Activate wallets passing the qualification filter
//   5. Write scan-summary.json for GitHub Actions artifact upload

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";

// ── Environment validation ────────────────────────────────────────────────────
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

// ── Qualification thresholds ──────────────────────────────────────────────────
const WIN_RATE_THRESHOLD = 0.52;
const MIN_TRADES_30D     = 30;
const MAX_WALLETS_TO_SCAN = 2000;
const CONCURRENCY         = 8;  // max parallel Hyperliquid API calls
const DELAY_BETWEEN_MS    = 125; // ms between each API call

// ── In-process semaphore (valid here — long-running Node.js process, not serverless) ──
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

// ── HTTP helper ───────────────────────────────────────────────────────────────

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

// ── Discovery: primary path (leaderboard API) ─────────────────────────────────

const ADDRESS_CANDIDATES = ["ethAddress", "address", "user", "wallet", "account"];

async function fetchLeaderboardAddresses(): Promise<string[]> {
  // UNVERIFIED endpoint — log raw response for operator inspection
  const raw = await hlPost<unknown>({ type: "leaderboard" }, 30_000);

  console.log(
    "[discovery] leaderboard raw (first 1000 chars):",
    JSON.stringify(raw).slice(0, 1000)
  );

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `LeaderboardShapeError: expected non-empty Array, got ${typeof raw}. ` +
        `Raw: ${JSON.stringify(raw).slice(0, 300)}`
    );
  }

  const sample = raw[0] as Record<string, unknown>;
  const addressField = ADDRESS_CANDIDATES.find(
    (k) =>
      typeof sample[k] === "string" &&
      /^0x[a-fA-F0-9]{40}$/.test(sample[k] as string)
  );

  if (!addressField) {
    throw new Error(
      `LeaderboardShapeError: no address field found in entry keys [${Object.keys(sample).join(", ")}]. ` +
        `Update ADDRESS_CANDIDATES in scripts/daily-wallet-scan.ts.`
    );
  }

  console.log(`[discovery] address field: "${addressField}"`);

  return (raw as Record<string, unknown>[])
    .map((e) => e[addressField] as string)
    .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
}

// ── Discovery: fallback path (HTML scrape) ────────────────────────────────────

// FRAGILE: update if Hyperliquid changes frontend structure
async function scrapeLeaderboardAddresses(): Promise<string[]> {
  // FRAGILE: update if Hyperliquid changes frontend structure
  console.warn("[discovery] falling back to HTML scrape — results may be incomplete");

  const html = await fetch("https://app.hyperliquid.xyz/leaderboard", {
    headers: { "User-Agent": "HyperliquidFLOW/1.0 (research tool)" },
  }).then((r) => r.text());

  const found = new Set<string>();

  // Strategy 1: addresses in script tag JSON blobs
  // FRAGILE: update if Hyperliquid changes frontend structure
  for (const match of html.matchAll(/0x[a-fA-F0-9]{40}/g)) {
    found.add(match[0]);
  }

  const results = [...found];

  if (results.length < 10) {
    throw new Error(
      `ScrapeFallbackError: extracted only ${results.length} addresses. ` +
        `Hyperliquid frontend structure has likely changed. Manual intervention required.`
    );
  }

  console.log(`[discovery] scrape found ${results.length} addresses`);
  return results;
}

// ── Scoring: fetch fills and compute metrics ──────────────────────────────────

interface FillRecord {
  closedPnl: string;
  time: number;
}

interface ScoringResult {
  address: string;
  win_rate: number;
  trade_count_30d: number;
  realized_pnl_30d: number;
  qualifies: boolean;
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
  const winCount = closingFills.filter((f) => parseFloat(f.closedPnl) > 0).length;
  const win_rate = trade_count_30d > 0 ? winCount / trade_count_30d : 0;
  const realized_pnl_30d = closingFills.reduce(
    (s, f) => s + parseFloat(f.closedPnl),
    0
  );

  const qualifies = win_rate >= WIN_RATE_THRESHOLD && trade_count_30d >= MIN_TRADES_30D;

  return { address, win_rate, trade_count_30d, realized_pnl_30d, qualifies };
}

// ── Supabase upsert helpers ───────────────────────────────────────────────────

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
      console.error(`[upsert] chunk ${i}–${i + CHUNK} error:`, error.message);
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

// ── Main ──────────────────────────────────────────────────────────────────────

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

  // ── Step 1: Discover addresses ─────────────────────────────────────────────
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

    try {
      addresses = await scrapeLeaderboardAddresses();
      source = "leaderboard_scrape";
    } catch (scrapeErr) {
      const scrapeMsg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
      summary.errors.push(`fallback_path: ${scrapeMsg}`);
      console.error("[discovery] both paths failed — aborting");
      summary.duration_ms = Date.now() - startMs;
      await fs.writeFile("scan-summary.json", JSON.stringify(summary, null, 2));
      process.exit(1);
    }
  }

  const targetAddresses = addresses.slice(0, MAX_WALLETS_TO_SCAN);
  summary.discovered = targetAddresses.length;
  summary.discovery_source = source;

  // ── Step 2: Upsert addresses into wallets table ────────────────────────────
  summary.new_wallets = await upsertAddresses(targetAddresses, source);

  // ── Step 3: Score each wallet ──────────────────────────────────────────────
  console.log(`[scan] scoring ${targetAddresses.length} wallets (concurrency: ${CONCURRENCY})`);

  const results = await Promise.allSettled(
    targetAddresses.map(async (address) => {
      await sem.acquire();
      try {
        const result = await scoreWallet(address);
        await updateWalletMetrics(result);

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

  summary.duration_ms = Date.now() - startMs;

  console.log("[scan] Complete:", JSON.stringify(summary, null, 2));
  await fs.writeFile("scan-summary.json", JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("[scan] Fatal:", err);
  process.exit(1);
});
