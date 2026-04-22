"use client";
import { useState, useCallback, useEffect } from "react";
import type { PaperPosition, PaperSettings, AlertEvent } from "@/lib/alert-engine";
import { safeReadJson, safeWriteJson } from "./safe-local-storage";

const POS_KEY = "hl_paper_positions";
const SET_KEY = "hl_paper_settings";
const POS_EVT = "hl:paper-positions-changed";

const DEFAULT_SETTINGS: PaperSettings = { default_size_usd: 100, size_mode: "fixed" };

function readPositions(): PaperPosition[] {
  return safeReadJson<PaperPosition[]>(POS_KEY, []);
}

function readSettings(): PaperSettings {
  return { ...DEFAULT_SETTINGS, ...safeReadJson<Partial<PaperSettings>>(SET_KEY, {}) };
}

function writePositions(positions: PaperPosition[]) {
  safeWriteJson(POS_KEY, positions);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(POS_EVT));
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
    safeWriteJson(SET_KEY, next);
    setSettings(next);
  }, []);

  return { positions, settings, openPosition, closePosition, updateSettings };
}
