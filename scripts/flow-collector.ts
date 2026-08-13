// scripts/flow-collector.ts
//
// Persistent collector for the public Hyperliquid WS trades feed, which carries
// both counterparty addresses on every trade. See
// docs/research/2026-08-13-websocket-coverage.md for the measurement.
//
// Aggregates to the minute in memory and flushes once per minute, because raw is
// 0.50 GB/day for the full universe and the analysis wants minute buckets anyway.
//
// Run:
//   npx tsx --env-file=.env.local scripts/flow-collector.ts
//   npx tsx --env-file=.env.local scripts/flow-collector.ts --coins=20 --floor=10000
//   npx tsx --env-file=.env.local scripts/flow-collector.ts --dry-run   (no writes)
//
// This needs a persistent process. The GitHub Actions cron cannot hold a socket
// open and the daily scan pattern does not fit.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HYPERLIQUID_API_URL } from "@/lib/env";

const WS_URL = "wss://api.hyperliquid.xyz/ws";

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const COIN_COUNT = arg("coins", 30);
// Address rows below this notional are dropped. The top 30 coins carry 97.8% of
// volume, so a floor is what keeps address cardinality bounded, not coin count.
const FLOOR      = arg("floor", 10_000);
const DRY_RUN    = process.argv.includes("--dry-run");

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface WsTrade {
  coin:  string;
  side:  string;      // "B" or "A", exchange-reported. Aggressor identity unverified.
  px:    string;
  sz:    string;
  time:  number;
  users: string[];    // both counterparties
}

type CoinAgg = { b: number; a: number; n: number; addrs: Set<string> };
type AddrAgg = { b: number; a: number; n: number };

/** Bucket keyed by minute, so a flush never splits a minute across two writes. */
const coinBuckets = new Map<string, Map<string, CoinAgg>>();   // minuteIso -> coin -> agg
const addrBuckets = new Map<string, Map<string, AddrAgg>>();   // minuteIso -> "coin|addr" -> agg

let tradesSeen = 0;
let tradesDropped = 0;

function minuteIso(ms: number): string {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

function record(t: WsTrade): void {
  const px = parseFloat(t.px);
  const sz = parseFloat(t.sz);
  if (!Number.isFinite(px) || !Number.isFinite(sz)) { tradesDropped++; return; }
  const ntl = px * sz;
  const min = minuteIso(t.time);
  const isB = t.side === "B";

  const byCoin = coinBuckets.get(min) ?? new Map<string, CoinAgg>();
  const c = byCoin.get(t.coin) ?? { b: 0, a: 0, n: 0, addrs: new Set<string>() };
  if (isB) c.b += ntl; else c.a += ntl;
  c.n++;
  for (const u of t.users ?? []) c.addrs.add(u);
  byCoin.set(t.coin, c);
  coinBuckets.set(min, byCoin);

  const byAddr = addrBuckets.get(min) ?? new Map<string, AddrAgg>();
  for (const u of t.users ?? []) {
    const k = `${t.coin}|${u}`;
    const a = byAddr.get(k) ?? { b: 0, a: 0, n: 0 };
    if (isB) a.b += ntl; else a.a += ntl;
    a.n++;
    byAddr.set(k, a);
  }
  addrBuckets.set(min, byAddr);

  tradesSeen++;
}

/**
 * Flush every minute strictly older than the current one, so a bucket is only
 * written once it can no longer receive trades. Late trades for an already
 * flushed minute would upsert, which is why the primary keys exist.
 */
async function flush(): Promise<void> {
  const cutoff = minuteIso(Date.now());

  for (const [min, byCoin] of [...coinBuckets.entries()]) {
    if (min >= cutoff) continue;
    coinBuckets.delete(min);
    const rows = [...byCoin.entries()].map(([coin, c]) => ({
      minute: min, coin,
      side_b_notional: Math.round(c.b),
      side_a_notional: Math.round(c.a),
      trade_count: c.n,
      distinct_addresses: c.addrs.size,
    }));
    if (rows.length === 0) continue;
    if (DRY_RUN || !supabase) {
      console.log(`[flow] ${min} coin rows ${rows.length} (dry run)`);
    } else {
      const { error } = await supabase.from("flow_coin_minute").upsert(rows, { onConflict: "minute,coin" });
      if (error) console.error(`[flow] coin upsert failed for ${min}:`, error.message);
    }
  }

  for (const [min, byAddr] of [...addrBuckets.entries()]) {
    if (min >= cutoff) continue;
    addrBuckets.delete(min);
    const rows = [...byAddr.entries()]
      .filter(([, a]) => a.b + a.a >= FLOOR)
      .map(([k, a]) => {
        const [coin, address] = k.split("|");
        return {
          minute: min, coin, address,
          side_b_notional: Math.round(a.b),
          side_a_notional: Math.round(a.a),
          trade_count: a.n,
        };
      });
    const belowFloor = byAddr.size - rows.length;
    if (rows.length === 0) continue;
    if (DRY_RUN || !supabase) {
      console.log(`[flow] ${min} addr rows ${rows.length} kept, ${belowFloor} below $${FLOOR} floor (dry run)`);
    } else {
      const { error } = await supabase.from("flow_address_minute").upsert(rows, { onConflict: "minute,coin,address" });
      if (error) console.error(`[flow] address upsert failed for ${min}:`, error.message);
      else console.log(`[flow] ${min} wrote ${rows.length} address rows, dropped ${belowFloor} below floor`);
    }
  }
}

async function topCoins(limit: number): Promise<string[]> {
  const res = await fetch(HYPERLIQUID_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  const [meta, ctxs] = await res.json() as [{ universe: { name: string }[] }, { dayNtlVlm: string }[]];
  return meta.universe
    .map((a, i) => ({ coin: a.name, vlm: parseFloat(ctxs[i]?.dayNtlVlm ?? "0") }))
    .filter((x) => Number.isFinite(x.vlm) && x.vlm > 0)
    .sort((a, b) => b.vlm - a.vlm)
    .slice(0, limit)
    .map((x) => x.coin);
}

function connect(coins: string[]): void {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log(`[flow] connected, subscribing to ${coins.length} coins`);
    for (const coin of coins) {
      ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin } }));
    }
  };

  ws.onmessage = (e: MessageEvent) => {
    try {
      const msg = JSON.parse(String(e.data)) as { channel?: string; data?: WsTrade[] };
      if (msg.channel !== "trades") return;
      for (const t of msg.data ?? []) record(t);
    } catch {
      tradesDropped++;
    }
  };

  // Reconnect rather than exit. A dropped socket is a gap in the record, and a
  // gap that nobody notices is worse than one that is logged.
  ws.onclose = () => {
    console.error("[flow] socket closed, reconnecting in 5s");
    setTimeout(() => connect(coins), 5_000);
  };
  ws.onerror = () => {
    console.error("[flow] socket error");
  };
}

async function main(): Promise<void> {
  const coins = await topCoins(COIN_COUNT);
  console.log(`[flow] floor $${FLOOR.toLocaleString("en-US")}, dry run ${DRY_RUN}`);
  connect(coins);

  setInterval(() => { void flush(); }, 20_000);
  setInterval(() => {
    console.log(`[flow] ${tradesSeen} trades seen, ${tradesDropped} unparsed`);
  }, 300_000);

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`[flow] ${sig}, flushing before exit`);
      void flush().finally(() => process.exit(0));
    });
  }
}

void main();
