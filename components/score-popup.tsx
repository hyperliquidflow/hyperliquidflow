"use client";
// components/score-popup.tsx
//
// Reusable hover-popup for the wallet "Score" column. Explains the 0 to 1
// composite score so the number has context everywhere it appears.
// Mirrors the EvPopup pattern from app/signals/feed/FeedClient.tsx.

import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { color, type as T, radius, layout } from "@/lib/design-tokens";

const POPUP_W = 280;

const TITLE = "Wallet Score";
const BODY  =
  "A 0 to 1 composite of four factors: Sharpe proxy, PnL consistency, drawdown resilience, and regime fit. Higher means more risk-adjusted edge over the last 30 days.";

function ScorePopup({ rect }: { rect: DOMRect }) {
  const bottom = window.innerHeight - rect.top + 8;
  let   left   = rect.left + rect.width / 2 - POPUP_W / 2;
  if (left + POPUP_W > window.innerWidth - 12) left = window.innerWidth - POPUP_W - 12;
  if (left < 12) left = 12;

  return (
    <div style={{
      position:     "fixed", bottom, left, width: POPUP_W,
      background:   "rgba(14,14,14,0.97)",
      border:       `1px solid ${color.borderHover}`,
      borderRadius: radius.card,
      padding:      "14px 16px",
      zIndex:       layout.zIndex.popup,
      boxShadow:    "0 12px 40px rgba(0,0,0,0.8)",
      pointerEvents: "none",
      fontFamily:   T.sans,
    }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: color.text, marginBottom: "6px" }}>{TITLE}</div>
      <div style={{ fontSize: "13px", color: color.textMuted, lineHeight: 1.45 }}>{BODY}</div>
    </div>
  );
}

/**
 * Hook form: returns handlers to spread onto the score-cell element, plus the
 * portal-rendered popup (or null). Use when the trigger already owns its layout
 * (e.g. a table cell or row-hover element).
 *
 *   const { triggerProps, popup } = useScoreHover();
 *   return (
 *     <div {...triggerProps} style={...}>
 *       <bar /><span>{score.toFixed(2)}</span>
 *       {popup}
 *     </div>
 *   );
 */
export function useScoreHover() {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const onMouseEnter = useCallback((e: React.MouseEvent) => {
    setRect((e.currentTarget as HTMLElement).getBoundingClientRect());
  }, []);
  const onMouseLeave = useCallback(() => setRect(null), []);

  const popup = rect && typeof document !== "undefined"
    ? createPortal(<ScorePopup rect={rect} />, document.body)
    : null;

  return { triggerProps: { onMouseEnter, onMouseLeave }, popup };
}

/**
 * Wrapper form: renders an inline-flex <span> with cursor: help that triggers
 * the popup. Use for simple cases like a single score number or a stat label.
 */
export function ScoreHover({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  const { triggerProps, popup } = useScoreHover();
  return (
    <span {...triggerProps} style={{ display: "inline-flex", alignItems: "center", ...style }}>
      {children}
      {popup}
    </span>
  );
}
