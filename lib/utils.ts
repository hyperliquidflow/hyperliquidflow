// lib/utils.ts
// Shared utility helpers used across components and lib modules.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicts correctly. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Truncate a hex wallet address to the format 0x1234...abcd.
 * @param address Full 42-char Ethereum address
 * @param leading Number of chars after 0x to show (default 4)
 * @param trailing Number of chars at the end to show (default 4)
 */
export function truncateAddress(
  address: string,
  leading = 4,
  trailing = 4
): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 2 + leading)}...${address.slice(-trailing)}`;
}

/**
 * Format a USD number with compact notation (e.g. $1.2M, $850K).
 * @param value Numeric USD value
 * @param decimals Decimal places (default 2)
 */
export function formatUsd(value: number, decimals = 2): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(decimals)}B`;
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000)         return `${sign}$${(abs / 1_000).toFixed(decimals)}K`;
  return `${sign}$${abs.toFixed(decimals)}`;
}

/**
 * Format a percentage, e.g. 0.523 → "52.3%".
 * @param value Decimal fraction (0–1)
 * @param decimals Decimal places (default 1)
 */
export function formatPct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Return a human-readable "time ago" string (e.g. "3m ago", "2h ago").
 * @param isoOrMs ISO string or unix millisecond timestamp
 */
export function timeAgo(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "string" ? new Date(isoOrMs).getTime() : isoOrMs;
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Format a signal timestamp for the feed.
 * Under 2 hours: relative ("2m ago", "1h ago").
 * 2 hours or older: absolute ("Apr 16, 14:32").
 */
export function formatSignalTime(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "string" ? new Date(isoOrMs).getTime() : isoOrMs;
  const ageMs = Date.now() - ms;
  if (ageMs < 2 * 60 * 60 * 1000) return timeAgo(ms);
  const d = new Date(ms);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day   = d.getDate();
  const hh    = String(d.getHours()).padStart(2, "0");
  const mm    = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}`;
}

/**
 * Clamp a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute population standard deviation of a numeric array.
 * Returns 0 for arrays shorter than 2 elements.
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute the mean of a numeric array. Returns 0 for empty arrays.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Validate an Ethereum address (0x-prefixed, 40 hex chars).
 */
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Group an array of items by a string key derived from each item.
 */
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

/** Sleep for N milliseconds. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
