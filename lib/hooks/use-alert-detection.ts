"use client";
import { useEffect, useRef } from "react";
import { diffPositions } from "@/lib/alert-engine";
import type { AlertEvent, FollowedWallet, PositionSnapshot } from "@/lib/alert-engine";

const FOLLOWED_KEY  = "hl_followed_wallets";
const ALERT_KEY     = "hl_alert_events";
const PAPER_POS_KEY = "hl_paper_positions";
const PAPER_SET_KEY = "hl_paper_settings";
const ALERT_EVT     = "hl:alert-events-changed";
const PAPER_EVT     = "hl:paper-positions-changed";
const POLL_MS       = 60_000;
const EXPIRE_MS     = 7 * 86_400_000;

function readFollowed(): FollowedWallet[] {
  try { return JSON.parse(localStorage.getItem(FOLLOWED_KEY) ?? "[]"); }
  catch { return []; }
}

function appendAlerts(incoming: AlertEvent[]) {
  if (incoming.length === 0) return;
  try {
    const all: AlertEvent[] = JSON.parse(localStorage.getItem(ALERT_KEY) ?? "[]");
    const pruned = all.filter(e => Date.now() - new Date(e.detected_at).getTime() < EXPIRE_MS);
    localStorage.setItem(ALERT_KEY, JSON.stringify([...incoming, ...pruned]));
    window.dispatchEvent(new Event(ALERT_EVT));
  } catch { /* silent */ }
}

function handlePaperTrade(event: AlertEvent, type: "open" | "close") {
  try {
    const settings = { default_size_usd: 100, size_mode: "fixed",
      ...JSON.parse(localStorage.getItem(PAPER_SET_KEY) ?? "{}") };
    const all: object[] = JSON.parse(localStorage.getItem(PAPER_POS_KEY) ?? "[]");
    if (type === "open") {
      all.unshift({
        id: crypto.randomUUID(), source_wallet: event.wallet_address,
        asset: event.asset, side: event.side,
        size_usd: settings.size_mode === "fixed" ? settings.default_size_usd : event.size_usd,
        entry_price: event.price, opened_at: event.detected_at, status: "open",
      });
    } else {
      for (const p of all as Array<Record<string, unknown>>) {
        if (p.status === "open" && p.source_wallet === event.wallet_address && p.asset === event.asset) {
          const pnl = (event.price - (p.entry_price as number)) / (p.entry_price as number)
            * (p.size_usd as number) * (p.side === "long" ? 1 : -1);
          Object.assign(p, { status: "closed", exit_price: event.price, closed_at: event.detected_at, realized_pnl: pnl });
        }
      }
    }
    localStorage.setItem(PAPER_POS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(PAPER_EVT));
  } catch { /* silent */ }
}

export function useAlertDetection() {
  const cache = useRef<Record<string, PositionSnapshot[]>>({});

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      const followed = readFollowed();
      if (followed.length === 0) return;

      try {
        const res = await fetch("/api/wallet-positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: followed.map(w => w.address) }),
        });
        if (!res.ok || cancelled) return;

        const { wallets } = await res.json() as { wallets: { address: string; positions: PositionSnapshot[] }[] };
        const wMap = new Map(followed.map(w => [w.address, w]));
        const newAlerts: AlertEvent[] = [];

        for (const { address, positions } of wallets) {
          const fw = wMap.get(address);
          if (!fw) continue;
          const prev = cache.current[address];
          cache.current[address] = positions;
          if (!prev) continue; // first poll: seed cache only

          for (const e of diffPositions(prev, positions, address)) {
            const allowed =
              (e.event_type === "POSITION_OPENED"  && fw.alert_on.includes("open"))   ||
              (e.event_type === "POSITION_CLOSED"   && fw.alert_on.includes("close"))  ||
              (e.event_type === "POSITION_RESIZED"  && fw.alert_on.includes("resize"));
            if (!allowed) continue;

            const full: AlertEvent = { ...e, id: crypto.randomUUID(), seen: false };
            newAlerts.push(full);

            if (fw.paper_copy) {
              if (e.event_type === "POSITION_OPENED") handlePaperTrade(full, "open");
              if (e.event_type === "POSITION_CLOSED") handlePaperTrade(full, "close");
            }
          }
        }

        appendAlerts(newAlerts);
      } catch { /* silent */ }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
}
