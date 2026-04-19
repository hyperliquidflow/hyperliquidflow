"use client";
import { useState, useCallback, useEffect } from "react";
import type { PaperPosition, PaperSettings, AlertEvent } from "@/lib/alert-engine";

const POS_KEY = "hl_paper_positions";
const SET_KEY = "hl_paper_settings";
const POS_EVT = "hl:paper-positions-changed";

const DEFAULT_SETTINGS: PaperSettings = { default_size_usd: 100, size_mode: "fixed" };

function readPositions(): PaperPosition[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "[]"); }
  catch { return []; }
}

function readSettings(): PaperSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SET_KEY) ?? "{}") }; }
  catch { return DEFAULT_SETTINGS; }
}

function writePositions(positions: PaperPosition[]) {
  localStorage.setItem(POS_KEY, JSON.stringify(positions));
  window.dispatchEvent(new Event(POS_EVT));
}

export function usePaperPositions() {
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [settings,  setSettings]  = useState<PaperSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setPositions(readPositions());
    setSettings(readSettings());
    const handler = () => setPositions(readPositions());
    window.addEventListener(POS_EVT, handler);
    return () => window.removeEventListener(POS_EVT, handler);
  }, []);

  const openPosition = useCallback((event: AlertEvent) => {
    const s = readSettings();
    const pos: PaperPosition = {
      id: crypto.randomUUID(), source_wallet: event.wallet_address,
      asset: event.asset, side: event.side,
      size_usd:    s.size_mode === "fixed" ? s.default_size_usd : event.size_usd,
      entry_price: event.price, opened_at: event.detected_at, status: "open",
    };
    const next = [pos, ...readPositions()];
    writePositions(next); setPositions(next);
  }, []);

  const closePosition = useCallback((event: AlertEvent) => {
    const next = readPositions().map(p => {
      if (p.status !== "open" || p.source_wallet !== event.wallet_address || p.asset !== event.asset) return p;
      const pnl = (event.price - p.entry_price) / p.entry_price * p.size_usd * (p.side === "long" ? 1 : -1);
      return { ...p, status: "closed" as const, exit_price: event.price, closed_at: event.detected_at, realized_pnl: pnl };
    });
    writePositions(next); setPositions(next);
  }, []);

  const updateSettings = useCallback((patch: Partial<PaperSettings>) => {
    const next = { ...readSettings(), ...patch };
    localStorage.setItem(SET_KEY, JSON.stringify(next));
    setSettings(next);
  }, []);

  return { positions, settings, openPosition, closePosition, updateSettings };
}
