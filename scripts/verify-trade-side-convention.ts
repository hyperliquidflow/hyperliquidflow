// scripts/verify-trade-side-convention.ts
//
// Does the WS trades feed's single `side` field belong to one of the two
// addresses in `users`, or to neither?
//
// Why this matters. `flow-collector.ts` credits a trade's side to BOTH
// counterparties, because a trade carries one `side` and a two-element `users`
// array. Every address therefore looks two-sided, which is why market makers
// could not be detected by two-sidedness
// (docs/research/2026-08-14-market-maker-separation.md) and why no signed
// per-address flow may be derived. If the convention turns out to be positional,
// signed flow becomes computable and the collector can be corrected.
//
// Method: listen to the live feed, then ask a participating address for its own
// fills and join on the transaction hash. A fill from `userFillsByTime` carries
// that address's OWN side, so the comparison is direct.
//
// Read only. Writes nothing, to Supabase or to disk.
//
//   npx tsx --env-file=.env.local scripts/verify-trade-side-convention.ts
//   npx tsx --env-file=.env.local scripts/verify-trade-side-convention.ts --seconds=60 --addresses=8

import { HYPERLIQUID_API_URL } from "@/lib/env";

const WS_URL = "wss://api.hyperliquid.xyz/ws";

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const SECONDS   = arg("seconds", 45);
const ADDRESSES = arg("addresses", 6);
const COINS     = (process.argv.find((a) => a.startsWith("--coins="))?.split("=")[1] ?? "BTC,ETH,SOL").split(",");

interface WsTrade {
  coin: string; side: string; px: string; sz: string;
  time: number; hash?: string; tid?: number; users?: string[];
}

interface Fill {
  coin: string; px: string; sz: string; side: string;
  time: number; hash?: string; tid?: number; dir?: string;
  /** True when this address crossed the spread, i.e. was the aggressor. */
  crossed?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hlPost<T>(body: unknown): Promise<T> {
  // Generous backoff on 429: this is meant to be run alongside a population
  // fetch that is already using most of the rate budget.
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(HYPERLIQUID_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json() as Promise<T>;
    if (res.status !== 429 && res.status < 500) throw new Error(`HL ${res.status}`);
    await sleep(3_000 * (attempt + 1));
  }
  throw new Error("HL retries exhausted");
}

function collect(seconds: number): Promise<WsTrade[]> {
  return new Promise((resolve) => {
    const out: WsTrade[] = [];
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      for (const coin of COINS) {
        ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin } }));
      }
    };
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(String(e.data)) as { channel?: string; data?: WsTrade[] };
        if (msg.channel !== "trades") return;
        out.push(...(msg.data ?? []));
      } catch { /* ignore unparsable frames */ }
    };
    setTimeout(() => { try { ws.close(); } catch { /* already closed */ } resolve(out); }, seconds * 1_000);
  });
}

async function main(): Promise<void> {
  console.log(`[side] listening ${SECONDS}s on ${COINS.join(", ")}`);
  const trades = await collect(SECONDS);
  const withUsers = trades.filter((t) => (t.users?.length ?? 0) === 2);
  console.log(`[side] ${trades.length} trades, ${withUsers.length} carrying two addresses`);
  if (withUsers.length === 0) {
    console.log("[side] nothing to verify. The feed may have stopped carrying `users`, which is itself a finding.");
    return;
  }
  console.log(`[side] hash present on ${withUsers.filter((t) => t.hash).length}, tid on ${withUsers.filter((t) => t.tid !== undefined).length}`);

  // Address frequency, so the sample is addresses we can actually join on.
  const freq = new Map<string, number>();
  for (const t of withUsers) for (const u of t.users ?? []) freq.set(u, (freq.get(u) ?? 0) + 1);
  const targets = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, ADDRESSES).map(([a]) => a);
  console.log(`[side] checking ${targets.length} addresses, busiest seen ${freq.get(targets[0])} times\n`);

  const since = Math.min(...withUsers.map((t) => t.time)) - 120_000;
  let idx0Match = 0, idx0Opp = 0, idx1Match = 0, idx1Opp = 0, joined = 0;
  // The decisive test. If `side` is the aggressor's, then a fill matches the
  // trade's side exactly when that address crossed the spread.
  let crossedAndMatch = 0, crossedAndOpp = 0, restingAndMatch = 0, restingAndOpp = 0, noCrossedField = 0;
  const perAddress: Array<{ addr: string; asIdx0: string; asIdx1: string }> = [];

  for (const addr of targets) {
    let fills: Fill[] = [];
    try {
      fills = await hlPost<Fill[]>({ type: "userFillsByTime", user: addr, startTime: since });
    } catch (err) {
      console.log(`  ${addr.slice(0, 10)} fills unavailable: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    // Join on `tid`, which is unique per trade. An earlier version joined on
    // (hash, coin, size); one hash can cover several fills when an order crosses
    // several resting orders, so that key collided and the last write won.
    const byTid = new Map<number, Fill>();
    for (const f of fills) {
      if (f.tid === undefined) continue;
      byTid.set(f.tid, f);
    }

    let m0 = 0, o0 = 0, m1 = 0, o1 = 0;
    for (const t of withUsers) {
      const i = (t.users ?? []).indexOf(addr);
      if (i < 0 || t.tid === undefined) continue;
      const f = byTid.get(t.tid);
      if (!f) continue;
      joined++;
      const same = f.side === t.side;
      if (i === 0) { if (same) m0++; else o0++; } else if (same) m1++; else o1++;
      if (f.crossed === undefined) noCrossedField++;
      else if (f.crossed) { if (same) crossedAndMatch++; else crossedAndOpp++; }
      else if (same) restingAndMatch++; else restingAndOpp++;
    }
    idx0Match += m0; idx0Opp += o0; idx1Match += m1; idx1Opp += o1;
    perAddress.push({
      addr,
      asIdx0: m0 + o0 > 0 ? `${m0}/${m0 + o0} match` : "none",
      asIdx1: m1 + o1 > 0 ? `${m1}/${m1 + o1} match` : "none",
    });
    await sleep(1_500);
  }

  console.log(`address     as users[0]        as users[1]`);
  for (const p of perAddress) {
    console.log(`${p.addr.slice(0, 10)}  ${p.asIdx0.padEnd(18)} ${p.asIdx1}`);
  }

  console.log(`\n=== Verdict ===`);
  console.log(`  joined trades           ${joined}`);
  console.log(`  users[0] side matches   ${idx0Match} of ${idx0Match + idx0Opp}`);
  console.log(`  users[1] side matches   ${idx1Match} of ${idx1Match + idx1Opp}`);

  if (joined === 0) {
    console.log(`\n  NO JOIN. Either the hash is not shared between the feed and userFillsByTime,`);
    console.log(`  or these addresses' fills are not retrievable. Nothing may be concluded.`);
    return;
  }
  console.log(`\n  aggressor test, using each fill's own \`crossed\` flag:`);
  console.log(`    crossed the spread, side matches   ${crossedAndMatch}`);
  console.log(`    crossed the spread, side opposite  ${crossedAndOpp}`);
  console.log(`    rested, side matches               ${restingAndMatch}`);
  console.log(`    rested, side opposite              ${restingAndOpp}`);
  if (noCrossedField > 0) console.log(`    no \`crossed\` field on ${noCrossedField} fills`);

  const clean = (m: number, o: number) => (m + o === 0 ? null : m / (m + o));
  const r0 = clean(idx0Match, idx0Opp), r1 = clean(idx1Match, idx1Opp);
  const aggressorExplains = crossedAndOpp === 0 && restingAndMatch === 0
    && crossedAndMatch + restingAndOpp > 0;

  if (aggressorExplains) {
    console.log(`\n  AGGRESSOR: \`side\` is the side of whoever crossed the spread, with no exceptions`);
    console.log(`  on this sample. The trade object does not say which of the two users that was,`);
    console.log(`  so signed PER-ADDRESS flow stays blocked. Signed PER-COIN flow is sound, because`);
    console.log(`  it is exactly aggressive buy notional against aggressive sell notional.`);
  } else if (r0 !== null && r1 !== null && r0 > 0.95 && r1 < 0.05) {
    console.log(`\n  POSITIONAL: \`side\` belongs to users[0]. Signed per-address flow is computable,`);
    console.log(`  and flow-collector.ts is crediting the wrong side to users[1].`);
  } else if (r0 !== null && r1 !== null && r0 < 0.05 && r1 > 0.95) {
    console.log(`\n  POSITIONAL: \`side\` belongs to users[1]. Same consequence, opposite index.`);
  } else {
    console.log(`\n  UNRESOLVED on this sample. Neither position nor the aggressor flag explains the`);
    console.log(`  pattern cleanly, so nothing may be derived from \`side\` at address level.`);
  }
  console.log(`\nNothing was written.`);
}

void main();
