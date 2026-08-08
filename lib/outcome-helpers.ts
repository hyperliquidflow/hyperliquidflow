// lib/outcome-helpers.ts

export function computeOutcome(
  direction: string | null,
  priceAtSignal: number,
  priceNow: number
): boolean | null {
  if (direction === "LONG")  return priceNow > priceAtSignal;
  if (direction === "SHORT") return priceNow < priceAtSignal;
  return null; // FLAT or null — no directional call to grade
}

export function computeMovePct(priceAtSignal: number, priceNow: number): number {
  if (priceAtSignal <= 0) return 0;
  return ((priceNow - priceAtSignal) / priceAtSignal) * 100;
}

/** First candle whose open time is at or after targetMs, close price. Null when
 *  the target is beyond the series or the close is unusable.
 *  Used to price outcomes at true horizons instead of at job-run time. */
export function priceAt(
  candles: Array<{ t: number; c: string }>,
  targetMs: number
): number | null {
  for (const candle of candles) {
    if (candle.t >= targetMs) {
      const price = parseFloat(candle.c);
      return isFinite(price) && price > 0 ? price : null;
    }
  }
  return null;
}

export interface InsertedSignal {
  id:        string;
  recipe_id: string;
  coin:      string;
  direction: string | null;
}

export interface SignalOutcomeRow {
  signal_id:       string;
  recipe_id:       string;
  coin:            string;
  direction:       string | null;
  price_at_signal: number;
}

export function buildOutcomeRows(
  inserted: InsertedSignal[],
  allMids: Record<string, string>
): SignalOutcomeRow[] {
  const rows: SignalOutcomeRow[] = [];
  for (const sig of inserted) {
    const priceStr = allMids[sig.coin];
    if (!priceStr) {
      console.warn(`[outcome-helpers] coin ${sig.coin} missing from allMids, skipping signal ${sig.id}`);
      continue;
    }
    const price = parseFloat(priceStr);
    if (!isFinite(price) || price <= 0) continue;
    rows.push({
      signal_id:       sig.id,
      recipe_id:       sig.recipe_id,
      coin:            sig.coin,
      direction:       sig.direction,
      price_at_signal: price,
    });
  }
  return rows;
}
