"use client";
import type React from "react";
import { useState } from "react";
import { useAlertEvents } from "@/lib/hooks/use-alert-events";
import { timeAgo } from "@/lib/utils";
import { color, card as C, type as T, space, layout, radius } from "@/lib/design-tokens";

const S = {
  btn: {
    position:       "relative" as const,
    background:     "none",
    border:         "none",
    cursor:         "pointer",
    padding:        "6px",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    color:          "rgba(255,255,255,0.44)",
    flexShrink:     0 as const,
  },
  badge: {
    position:       "absolute" as const,
    top:            "2px",
    right:          "2px",
    minWidth:       "16px",
    height:         "16px",
    borderRadius:   "8px",
    background:     color.red,
    color:          "#fff",
    fontSize:       "10px",
    fontWeight:     700,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    padding:        "0 4px",
    fontVariantNumeric: "tabular-nums",
    pointerEvents:  "none" as const,
  },
  overlay: {
    position: "fixed" as const,
    inset:    0,
    zIndex:   layout.zIndex.navBackdrop,
  },
  drawer: {
    position:             "fixed" as const,
    top:                  0,
    right:                0,
    bottom:               0,
    width:                "360px",
    zIndex:               layout.zIndex.popup,
    background:           color.nav,
    borderLeft:           `1px solid ${color.border}`,
    backdropFilter:       "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    display:              "flex",
    flexDirection:        "column" as const,
    overflowY:            "auto" as const,
  } as React.CSSProperties,
  drawerHdr: {
    ...C.header,
    padding:    space.cardHeaderPadding,
    flexShrink: 0 as const,
  },
  drawerTitle: { ...T.cardTitle, flexGrow: 1 },
  markBtn: {
    fontSize:   "11px",
    fontWeight: 600,
    color:      color.textDim,
    background: "none",
    border:     "none",
    cursor:     "pointer",
    padding:    "0 0 0 12px",
  },
  empty: {
    padding:   "40px 20px",
    textAlign: "center" as const,
    color:     color.textMuted,
    fontSize:  "13px",
  },
  row: {
    padding:      "12px 20px",
    borderBottom: `1px solid ${color.divider}`,
  },
  rowHdr: {
    display:        "flex",
    alignItems:     "center",
    gap:            "8px",
    justifyContent: "space-between",
  },
  pill: (type: string): React.CSSProperties => ({
    fontSize:      "10px",
    fontWeight:    700,
    letterSpacing: "0.05em",
    padding:       "2px 6px",
    borderRadius:  radius.dirPill,
    color:      type === "POSITION_OPENED" ? color.green : type === "POSITION_CLOSED" ? color.red : color.amber,
    background: type === "POSITION_OPENED" ? `${color.green}18` : type === "POSITION_CLOSED" ? `${color.red}18` : `${color.amber}18`,
    border:     `1px solid ${type === "POSITION_OPENED" ? `${color.green}30` : type === "POSITION_CLOSED" ? `${color.red}30` : `${color.amber}30`}`,
  }),
  asset:     { fontFamily: "'Geist Mono', monospace", fontSize: "13px", fontWeight: 600, color: color.text },
  meta:      { fontSize: "11px", color: color.textMuted, marginTop: "3px", fontVariantNumeric: "tabular-nums" },
  unseenDot: { width: "6px", height: "6px", borderRadius: "50%", background: color.accent, flexShrink: 0 as const },
};

const LABEL: Record<string, string> = {
  POSITION_OPENED:  "Opened",
  POSITION_CLOSED:  "Closed",
  POSITION_RESIZED: "Resized",
};

export function AlertBell() {
  const [open, setOpen] = useState(false);
  const { events, markAllSeen, unseenCount } = useAlertEvents();

  function handleOpen() {
    setOpen(true);
    if (unseenCount > 0) markAllSeen();
  }

  return (
    <>
      <button onClick={handleOpen} style={S.btn} aria-label="Alerts" draggable={false}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseenCount > 0 && (
          <span style={S.badge}>{unseenCount > 99 ? "99+" : unseenCount}</span>
        )}
      </button>

      {open && (
        <>
          <div style={S.overlay} onClick={() => setOpen(false)} />
          <div style={S.drawer}>
            <div style={S.drawerHdr}>
              <span style={S.drawerTitle}>Alerts</span>
              {events.length > 0 && (
                <button style={S.markBtn} onClick={markAllSeen}>Mark all seen</button>
              )}
              <button style={{ ...S.markBtn, marginLeft: "8px" }} onClick={() => setOpen(false)}>Close</button>
            </div>

            {events.length === 0 ? (
              <div style={S.empty}>No alerts yet. Follow a wallet to get started.</div>
            ) : (
              events.map(evt => (
                <div key={evt.id} style={S.row}>
                  <div style={S.rowHdr}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {!evt.seen && <span style={S.unseenDot} />}
                      <span style={S.asset}>{evt.asset}</span>
                      <span style={S.pill(evt.event_type)}>{LABEL[evt.event_type]}</span>
                    </div>
                    <span style={{ fontSize: "11px", color: color.textMuted, fontVariantNumeric: "tabular-nums" }}>
                      {timeAgo(evt.detected_at)}
                    </span>
                  </div>
                  <div style={S.meta}>
                    {evt.side.toUpperCase()} {evt.asset} at ${evt.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}
