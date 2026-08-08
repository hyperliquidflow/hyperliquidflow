"use client";
// components/data-freshness.tsx
// One shared indicator for how old the data on a page actually is.
// Quiet while fresh, amber past an hour, red past a day. Never claims
// "live" on data that is not.

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/utils";
import { color, radius } from "@/lib/design-tokens";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

/** Token colour for a given data age. Shared with the nav status dot. */
export function freshnessColor(ageMs: number): string {
  if (ageMs >= DAY_MS)  return color.red;
  if (ageMs >= HOUR_MS) return color.amber;
  return color.textMuted;
}

interface Props {
  /** ISO string or epoch ms of when the data on screen was produced. */
  updatedAt?: string | number | null;
  /** Word in front of the age. Defaults to "Updated". */
  label?: string;
}

export function DataFreshness({ updatedAt, label = "Updated" }: Props) {
  // Re-render every 30s so the age stays truthful without a page refresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (updatedAt == null) return null;
  const ms = typeof updatedAt === "string" ? new Date(updatedAt).getTime() : updatedAt;
  if (!Number.isFinite(ms)) return null;

  const ageMs = Math.max(0, Date.now() - ms);
  const clr   = freshnessColor(ageMs);

  return (
    <span
      style={{
        display:            "inline-flex",
        alignItems:         "center",
        gap:                "6px",
        flexShrink:         0,
        fontSize:           "11px",
        fontWeight:         600,
        letterSpacing:      "0.04em",
        color:              clr,
        fontVariantNumeric: "tabular-nums",
        userSelect:         "none",
      }}
    >
      <span style={{
        width:        "5px",
        height:       "5px",
        borderRadius: radius.dot,
        background:   clr,
        flexShrink:   0,
        display:      "inline-block",
      }} />
      {label} {timeAgo(ms)}
    </span>
  );
}
