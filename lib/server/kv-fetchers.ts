// lib/server/kv-fetchers.ts
// Server-only KV read helpers. Called from async server components so pages
// render with data on first paint — no client-side loading skeleton needed.

import { kv } from "@vercel/kv";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import type { MarketTickerEntry } from "@/app/api/market-ticker/route";

function parse<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T;
}

export async function fetchCohortState(): Promise<CohortCachePayload | null> {
  try {
    return parse<CohortCachePayload>(await kv.get("cohort:active"));
  } catch { return null; }
}

export async function fetchMarketTicker(): Promise<MarketTickerEntry[] | null> {
  try {
    return parse<MarketTickerEntry[]>(await kv.get("market-ticker:v4"));
  } catch { return null; }
}

export async function fetchDailyScan(): Promise<unknown> {
  try {
    return parse<unknown>(await kv.get("daily:scan"));
  } catch { return null; }
}

export async function fetchMorningScan(): Promise<unknown> {
  try {
    return parse<unknown>(await kv.get("morning:scan"));
  } catch { return null; }
}

export async function fetchContrarianState(): Promise<unknown> {
  try {
    return parse<unknown>(await kv.get("contrarian:latest"));
  } catch { return null; }
}
