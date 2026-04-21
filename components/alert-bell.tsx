"use client";
import type React from "react";
import { useState } from "react";
import { useAlertEvents } from "@/lib/hooks/use-alert-events";
import { timeAgo } from "@/lib/utils";
import { color, card as C, type as T, space, layout, radius, anim } from "@/lib/design-tokens";

const S = {
  wrap: {
    borderTop: `1px solid ${color.borderFaint}`,
  } as React.CSSProperties,

  trigger: (hasUnseen: boolean): React.CSSProperties => ({
    display:    "flex",
    alignItems: "center",
    gap:        "10px",
    padding:    space.navItemPadding,
    width:      "100%",
    background: "none",
    border:     "none",
    cursor:     "pointer",
    fontSize:   "13px",
    fontWeight: 500,
    color:      hasUnseen ? color.text : "rgba(255,255,255,0.44)",
    transition: anim.nav,
    textAlign:  "left" as const,
    userSelect: "none" as const,
  }),

  count: {
    fontSize:           "11px",
    fontWeight:         700,
    padding:            "1px 6px",
    borderRadius:       radius.tag,
    background:         `${color.amber}26`,
    color:              color.amber,
    border:             `1px solid ${color.amber}4d`,
    fontVariantNumeric: "tabular-nums",
    marginLeft:         "auto",
    flexShrink:         0 as const,
  } as React.CSSProperties,

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

  row: (evtType: string): React.CSSProperties => ({
    paddingTop:    "12px",
    paddingBottom: "12px",
    paddingRight:  "20px",
    paddingLeft:   "18px",
    borderBottom:  `1px solid ${color.divider}`,
    borderLeft:    `2px solid ${
      evtType === "POSITION_OPENED" ? color.green :
      evtType === "POSITION_CLOSED" ? color.red :
      color.amber
    }`,
  }),

  rowHdr: {
    display:        "flex",
    alignItems:     "center",
    gap:            "8px",
    justifyContent: "space-between",
  },

  pill: (evtType: string): React.CSSProperties => ({
    fontSize:      "11px",
    fontWeight:    700,
    letterSpacing: "0.05em",
    padding:       "2px 6px",
    borderRadius:  radius.dirPill,
    color:      evtType === "POSITION_OPENED" ? color.green : evtType === "POSITION_CLOSED" ? color.red : color.amber,
    background: evtType === "POSITION_OPENED" ? `${color.green}18` : evtType === "POSITION_CLOSED" ? `${color.red}18` : `${color.amber}18`,
    border:     `1px solid ${evtType === "POSITION_OPENED" ? `${color.green}30` : evtType === "POSITION_CLOSED" ? `${color.red}30` : `${color.amber}30`}`,
  }),

  asset:     { fontFamily: T.mono, fontSize: "13px", fontWeight: 600, color: color.text } as React.CSSProperties,
  meta:      { fontSize: "11px", color: color.textMuted, marginTop: "3px", fontVariantNumeric: "tabular-nums" } as React.CSSProperties,
  unseenDot: { width: "6px", height: "6px", borderRadius: "50%", background: color.accent, flexShrink: 0 as const } as React.CSSProperties,
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
      <div style={S.wrap}>
        <button className="glow-btn" onClick={handleOpen} style={S.trigger(unseenCount > 0)} aria-label="Alerts" draggable={false}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={unseenCount > 0 ? color.amber : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span>Alerts</span>
          {unseenCount > 0 && (
            <span style={S.count}>{unseenCount > 99 ? "99+" : unseenCount}</span>
          )}
        </button>
      </div>

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
                <div key={evt.id} style={S.row(evt.event_type)}>
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
