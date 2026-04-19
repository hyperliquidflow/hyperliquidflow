export interface PositionSnapshot {
  coin:     string;
  szi:      number;
  entry_px: number;
  side:     "long" | "short";
}

export interface AlertEvent {
  id:             string;
  wallet_address: string;
  event_type:     "POSITION_OPENED" | "POSITION_CLOSED" | "POSITION_RESIZED";
  asset:          string;
  side:           "long" | "short";
  size_usd:       number;
  price:          number;
  detected_at:    string;
  seen:           boolean;
}

export interface FollowedWallet {
  address:     string;
  label?:      string;
  followed_at: string;
  alert_on:    ("open" | "close" | "resize")[];
  paper_copy:  boolean;
}

export interface PaperPosition {
  id:            string;
  source_wallet: string;
  asset:         string;
  side:          "long" | "short";
  size_usd:      number;
  entry_price:   number;
  opened_at:     string;
  status:        "open" | "closed";
  exit_price?:   number;
  closed_at?:    string;
  realized_pnl?: number;
}

export interface PaperSettings {
  default_size_usd: number;
  size_mode:        "fixed" | "proportional";
}

type NewAlertEvent = Omit<AlertEvent, "id" | "seen">;

const RESIZE_THRESHOLD = 0.10;

export function diffPositions(
  prev:          PositionSnapshot[],
  current:       PositionSnapshot[],
  walletAddress: string,
): NewAlertEvent[] {
  const prevMap = new Map(prev.map(p => [p.coin, p]));
  const currMap = new Map(current.map(p => [p.coin, p]));
  const now     = new Date().toISOString();
  const events: NewAlertEvent[] = [];

  for (const [coin, pos] of currMap) {
    if (!prevMap.has(coin)) {
      events.push({ wallet_address: walletAddress, event_type: "POSITION_OPENED",
        asset: coin, side: pos.side,
        size_usd: Math.abs(pos.szi) * pos.entry_px, price: pos.entry_px, detected_at: now });
    }
  }

  for (const [coin, pos] of prevMap) {
    if (!currMap.has(coin)) {
      events.push({ wallet_address: walletAddress, event_type: "POSITION_CLOSED",
        asset: coin, side: pos.side,
        size_usd: Math.abs(pos.szi) * pos.entry_px, price: pos.entry_px, detected_at: now });
    }
  }

  for (const [coin, curr] of currMap) {
    const p = prevMap.get(coin);
    if (!p) continue;
    if (Math.abs((curr.szi - p.szi) / p.szi) > RESIZE_THRESHOLD) {
      events.push({ wallet_address: walletAddress, event_type: "POSITION_RESIZED",
        asset: coin, side: curr.side,
        size_usd: Math.abs(curr.szi) * curr.entry_px, price: curr.entry_px, detected_at: now });
    }
  }

  return events;
}
