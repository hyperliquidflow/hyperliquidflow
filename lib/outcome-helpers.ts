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
  return ((priceNow - priceAtSignal) / priceAtSignal) * 100;
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
    if (!priceStr) continue; // coin not in allMids (delisted or unknown)
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
