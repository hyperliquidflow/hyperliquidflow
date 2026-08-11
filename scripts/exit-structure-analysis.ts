// scripts/exit-structure-analysis.ts
//
// Is the 3 ATR target reachable at all?
//
// Grading exits at +3 ATR or -2 ATR within 24 hours. Across the project's whole
// history not one trade has ever hit the target: every exit has been a stop or a
// timeout. If the target is effectively unreachable then the reward side of the
// design is fiction, the assumed 3:2 payoff never pays, and the 40% breakeven
// win rate the stats engine measures against is wrong.
//
// This measures what the market actually delivers, sampling entry points across
// the coins the conviction gate lets through. Random entries carry no edge by
// construction, which is the point: the question here is what the price series
// can reach, not whether we can predict it.
//
//   npx tsx scripts/exit-structure-analysis.ts

import { computeExcursion, hitRateAtMultiple, type Excursion } from "../lib/excursion";
import {
  simulateExitFromCandles,
  slippageBpsForCoin,
  breakevenWinRate,
} from "../lib/signal-learning-utils";
import { computeATRAsOf } from "../lib/atr";
import { fetchCandleSnapshot } from "../lib/hyperliquid-api-client";

const HOUR_MS      = 3600_000;
const FOUR_H_MS    = 4 * HOUR_MS;
const LOOKBACK_MS  = 30 * 24 * HOUR_MS;
const MAX_HOLDS    = [6, 12, 24, 48];
const MULTIPLES    = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
// Coins currently clearing the conviction gate.
const COINS = ["BTC", "ETH", "HYPE", "PUMP", "NEAR", "DOGE", "ZEC", "TAO", "SOL", "kPEPE", "XPL", "MON"];
// Entry every N hours through the sample window, both directions.
const ENTRY_STRIDE_HOURS = 6;

const GRID_STOPS   = [1.0, 1.5, 2.0];
const GRID_TARGETS = [1.0, 1.5, 2.0, 3.0];

interface GridSample {
  direction:   "LONG" | "SHORT";
  entryPrice:  number;
  atr:         number;
  entryMs:     number;
  bars:        Awaited<ReturnType<typeof fetchCandleSnapshot>>;
  slippageBps: number;
}
const gridSamples: GridSample[] = [];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo  = Math.floor(pos);
  const hi  = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

async function main(): Promise<void> {
  const now  = Date.now();
  const from = now - LOOKBACK_MS;

  // maxHold -> direction -> excursions
  const byHold = new Map<number, Excursion[]>();
  for (const h of MAX_HOLDS) byHold.set(h, []);

  for (const coin of COINS) {
    let bars1h, bars4h;
    try {
      [bars1h, bars4h] = await Promise.all([
        fetchCandleSnapshot(coin, "1h", from, now),
        fetchCandleSnapshot(coin, "4h", from - LOOKBACK_MS, now),
      ]);
    } catch {
      console.warn(`[exit-analysis] ${coin}: fetch failed, skipping`);
      continue;
    }
    if (!bars1h?.length || !bars4h?.length) continue;
    await new Promise((r) => setTimeout(r, 200));

    let sampled = 0;
    for (let i = 0; i < bars1h.length; i += ENTRY_STRIDE_HOURS) {
      const entryBar = bars1h[i];
      const entryMs  = entryBar.t;
      const entryPx  = parseFloat(entryBar.c);
      if (!isFinite(entryPx) || entryPx <= 0) continue;

      const atr = computeATRAsOf(bars4h, entryMs, { intervalMs: FOUR_H_MS });
      if (atr === null || atr <= 0) continue;

      for (const direction of ["LONG", "SHORT"] as const) {
        for (const maxHoldHours of MAX_HOLDS) {
          const e = computeExcursion({ direction, entryPrice: entryPx, atr, entryMs, bars: bars1h, maxHoldHours });
          // Only count entries with a full window of bars, so short windows at
          // the end of the series do not understate what was reachable.
          if (e && e.bars_seen >= maxHoldHours) byHold.get(maxHoldHours)!.push(e);
          if (e && e.bars_seen >= 24 && maxHoldHours === 24) {
            gridSamples.push({
              direction, entryPrice: entryPx, atr, entryMs,
              bars: bars1h, slippageBps: slippageBpsForCoin(coin),
            });
          }
        }
      }
      sampled++;
    }
    console.log(`[exit-analysis] ${coin}: ${sampled} entry points`);
  }

  console.log("");
  console.log("Share of trades whose favourable travel reached N ATR");
  console.log("hold |" + MULTIPLES.map((m) => `  ${m.toFixed(1)}R`).join("") + "   |  median MFE  median MAE   n");
  console.log("-----+" + "-".repeat(MULTIPLES.length * 6) + "---+---------------------------------");

  for (const hold of MAX_HOLDS) {
    const list = byHold.get(hold)!;
    if (list.length === 0) { console.log(`${String(hold).padStart(4)}h |  no data`); continue; }
    const rates = MULTIPLES.map((m) => {
      const r = hitRateAtMultiple(list, m);
      return r === null ? "   n/a" : `${(r * 100).toFixed(0).padStart(5)}%`;
    }).join("");
    const mfe = [...list.map((e) => e.mfe_atr)].sort((a, b) => a - b);
    const mae = [...list.map((e) => e.mae_atr)].sort((a, b) => a - b);
    console.log(
      `${String(hold).padStart(4)}h |${rates}   |` +
      `${quantile(mfe, 0.5).toFixed(2).padStart(11)}` +
      `${quantile(mae, 0.5).toFixed(2).padStart(12)}` +
      `${String(list.length).padStart(7)}`
    );
  }

  // A target only means something if it fires often enough to shape the payoff.
  // Below roughly 1 in 5, nearly every exit is a timeout and the stated
  // reward-to-risk never materialises.
  console.log("");
  const h24 = byHold.get(24)!;
  const at3 = hitRateAtMultiple(h24, 3.0);
  const at2 = hitRateAtMultiple(h24, 2.0);
  const at15 = hitRateAtMultiple(h24, 1.5);
  if (at3 !== null && at2 !== null && at15 !== null) {
    console.log(`At the shipped 24h hold: 3.0R reached ${(at3 * 100).toFixed(1)}% of the time, ` +
                `2.0R ${(at2 * 100).toFixed(1)}%, 1.5R ${(at15 * 100).toFixed(1)}%.`);
  }

  // ── Grid: simulate the ACTUAL exit mechanism per (stop, target) pair ────────
  // MFE hit rates ignore sequencing: a trade can be stopped before it reaches
  // the target, so the marginal distribution overstates what a structure pays.
  // This runs the real path simulation over every sampled entry. Random entries
  // carry no edge, so expectancy lands near -costs for every structure; what a
  // structure is chosen ON is how informative it is as a measuring instrument:
  // both exits fire at meaningful rates, and outcome variance stays low enough
  // that a real edge shows up in fewer samples.
  console.log("");
  console.log("Exit-mechanism grid at 24h hold (path-simulated, costs included)");
  console.log("stop/target |  stop%  target%  time%  |  exp bps    sd bps  | breakeven wr");
  console.log("------------+-------------------------+---------------------+-------------");

  for (const stopAtr of GRID_STOPS) {
    for (const targetAtr of GRID_TARGETS) {
      let stops = 0, targets = 0, times = 0;
      const pnls: number[] = [];
      for (const s of gridSamples) {
        const r = simulateExitFromCandles({
          direction:   s.direction,
          entryPrice:  s.entryPrice,
          atr:         s.atr,
          entryMs:     s.entryMs,
          bars:        s.bars,
          maxHoldHours: 24,
          slippageBps: s.slippageBps,
          stopAtr,
          targetAtr,
        });
        if (!r) continue;
        if (r.exit_reason === "stop") stops++;
        else if (r.exit_reason === "target") targets++;
        else times++;
        pnls.push(r.net_pnl_bps);
      }
      const n = pnls.length;
      if (n === 0) continue;
      const mean = pnls.reduce((a, b) => a + b, 0) / n;
      const sd   = Math.sqrt(pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
      console.log(
        `  ${stopAtr.toFixed(1)} / ${targetAtr.toFixed(1)} |` +
        `  ${((stops / n) * 100).toFixed(0).padStart(4)}%` +
        `  ${((targets / n) * 100).toFixed(0).padStart(6)}%` +
        `  ${((times / n) * 100).toFixed(0).padStart(4)}%  |` +
        `  ${mean.toFixed(0).padStart(7)}  ${sd.toFixed(0).padStart(8)}  |` +
        `  ${(breakevenWinRate(stopAtr, targetAtr) * 100).toFixed(0).padStart(9)}%`
      );
    }
  }
}

main().catch((err) => {
  console.error("[exit-analysis] fatal:", err);
  process.exit(1);
});
