"use client";
import type React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useFollowedWallets } from "@/lib/hooks/use-followed-wallets";
import { truncateAddress } from "@/lib/utils";
import { color, type as T, radius, layout, shadow, effect, anim, space, checkbox as CB } from "@/lib/design-tokens";

type AlertType = "open" | "close" | "resize";

const ALERT_LABELS: Record<AlertType, string> = {
  open:   "Open",
  close:  "Close",
  resize: "Resize",
};

const S = {
  btn: (following: boolean): React.CSSProperties => ({
    fontSize:      "11px",
    fontWeight:    600,
    letterSpacing: "0.04em",
    padding:       "3px 9px",
    borderRadius:  radius.tag,
    border:        `1px solid ${following ? color.borderHover : color.border}`,
    background:    following ? color.tagBg : "transparent",
    color:         following ? color.text : color.textMuted,
    cursor:        "pointer",
    flexShrink:    0 as const,
    transition:    anim.nav,
  }),

  overlay: {
    position:             "fixed" as const,
    inset:                0,
    background:           "rgba(0,0,0,0.6)",
    backdropFilter:       "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    zIndex:               layout.zIndex.popup,
    display:              "flex",
    alignItems:           "center",
    justifyContent:       "center",
  },

  modal: {
    background:    color.card,
    border:        `1px solid ${color.border}`,
    borderRadius:  radius.card,
    width:         "320px",
    overflow:      "hidden" as const,
    ...effect.glass,
    ...shadow.card,
  } as React.CSSProperties,

  body: {
    padding: space.cardBodyPadding,
  } as React.CSSProperties,

  title: {
    fontSize:     "16px",
    fontWeight:   600,
    color:        color.text,
    marginBottom: "4px",
  } as React.CSSProperties,

  addr: {
    ...T.walletAddr,
    fontSize:     "11px",
    marginBottom: "20px",
  } as React.CSSProperties,

  fieldLabel: {
    display:       "block",
    fontSize:      "11px",
    fontWeight:    700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color:         "rgba(255,255,255,0.4)",
    marginBottom:  "6px",
  } as React.CSSProperties,

  input: {
    width:        "100%",
    background:   color.inputBg,
    border:       `1px solid ${color.inputBorder}`,
    borderRadius: radius.input,
    color:        "rgba(255,255,255,0.85)",
    fontSize:     "13px",
    fontFamily:   T.sans,
    padding:      "8px 10px",
    boxSizing:    "border-box" as const,
    marginBottom: "20px",
    outline:      "none",
  } as React.CSSProperties,

  pillRow: {
    display:      "flex",
    gap:          "6px",
    flexWrap:     "wrap" as const,
    marginBottom: "16px",
  } as React.CSSProperties,

  pill: (on: boolean): React.CSSProperties => ({
    fontSize:      "11px",
    fontWeight:    700,
    letterSpacing: "0.05em",
    padding:       "4px 10px",
    borderRadius:  radius.tag,
    cursor:        "pointer",
    border:        `1px solid ${on ? color.borderHover : color.border}`,
    background:    on ? color.tagBg : "transparent",
    color:         on ? color.text : color.textMuted,
    transition:    anim.nav,
    userSelect:    "none" as const,
  }),

  divider: {
    height:       "1px",
    background:   color.divider,
    marginBottom: "14px",
  } as React.CSSProperties,

  actions: {
    display:        "flex",
    gap:            "8px",
    marginTop:      "20px",
    justifyContent: "flex-end",
  } as React.CSSProperties,

  actionsEdit: {
    display:         "flex",
    gap:             "8px",
    marginTop:       "20px",
    justifyContent:  "space-between",
    alignItems:      "center",
  } as React.CSSProperties,

  btnCancel: {
    fontSize:     "13px",
    padding:      "7px 14px",
    borderRadius: radius.input,
    border:       `1px solid ${color.border}`,
    background:   "transparent",
    color:        color.textMuted,
    cursor:       "pointer",
    fontFamily:   T.sans,
  } as React.CSSProperties,

  btnSave: {
    fontSize:     "13px",
    fontWeight:   600,
    padding:      "7px 14px",
    borderRadius: radius.input,
    border:       "none",
    background:   color.text,
    color:        color.bg,
    cursor:       "pointer",
    fontFamily:   T.sans,
  } as React.CSSProperties,

  btnUnfollow: {
    fontSize:     "13px",
    padding:      "7px 14px",
    borderRadius: radius.input,
    border:       `1px solid ${color.red}40`,
    background:   `${color.red}10`,
    color:        color.red,
    cursor:       "pointer",
    fontFamily:   T.sans,
  } as React.CSSProperties,
};

export function FollowButton({ address }: { address: string }) {
  const { wallets, isFollowing, follow, unfollow, update } = useFollowedWallets();
  const [open, setOpen] = useState(false);
  const following = isFollowing(address);

  const [label,   setLabel]   = useState("");
  const [alertOn, setAlertOn] = useState<AlertType[]>(["open", "close", "resize"]);
  const [copyTrades, setCopyTrades] = useState(false);

  function handleClick() {
    if (following) {
      const existing = wallets.find(w => w.address === address);
      setLabel(existing?.label ?? "");
      setAlertOn((existing?.alert_on ?? ["open", "close", "resize"]) as AlertType[]);
      setCopyTrades(existing?.paper_copy ?? false);
    } else {
      setLabel("");
      setAlertOn(["open", "close", "resize"]);
      setCopyTrades(false);
    }
    setOpen(true);
  }

  function toggleAlert(t: AlertType) {
    setAlertOn(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function save() {
    const payload = {
      address,
      label:       label || undefined,
      alert_on:    alertOn,
      paper_copy:  copyTrades,
    };
    if (following) {
      update(address, payload);
    } else {
      follow({ ...payload, followed_at: new Date().toISOString() });
    }
    setOpen(false);
  }

  function handleUnfollow() {
    unfollow(address);
    setOpen(false);
  }

  return (
    <>
      <button
        className="glow-btn"
        onClick={handleClick}
        style={S.btn(following)}
        draggable={false}
      >
        {following ? "Edit" : "Follow"}
      </button>

      {open && createPortal(
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.body}>
              <div style={S.title}>{following ? "Edit follow" : "Follow wallet"}</div>
              <div style={S.addr}>{truncateAddress(address, 8, 6)}</div>

              <label style={S.fieldLabel}>Nickname (optional)</label>
              <input
                style={S.input}
                value={label}
                onChange={e => setLabel(e.target.value)}
                maxLength={40}
              />

              <label style={S.fieldLabel}>Alert on</label>
              <div style={S.pillRow}>
                {(["open", "close", "resize"] as AlertType[]).map(t => (
                  <span
                    key={t}
                    style={S.pill(alertOn.includes(t))}
                    onClick={() => toggleAlert(t)}
                  >
                    {ALERT_LABELS[t]}
                  </span>
                ))}
              </div>

              <div style={S.divider} />

              <label style={CB.wrap}>
                <input
                  type="checkbox"
                  checked={copyTrades}
                  onChange={e => setCopyTrades(e.target.checked)}
                  style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                />
                <div style={copyTrades ? CB.boxChecked : CB.box}>
                  {copyTrades && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke={color.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span style={CB.label}>Copy trades</span>
              </label>

              {following ? (
                <div style={S.actionsEdit}>
                  <button
                    className="glow-btn"
                    style={S.btnUnfollow}
                    onClick={handleUnfollow}
                    draggable={false}
                  >
                    Unfollow
                  </button>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="glow-btn"
                      style={S.btnCancel}
                      onClick={() => setOpen(false)}
                      draggable={false}
                    >
                      Cancel
                    </button>
                    <button
                      className="glow-btn"
                      style={S.btnSave}
                      onClick={save}
                      disabled={alertOn.length === 0}
                      draggable={false}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div style={S.actions}>
                  <button
                    className="glow-btn"
                    style={S.btnCancel}
                    onClick={() => setOpen(false)}
                    draggable={false}
                  >
                    Cancel
                  </button>
                  <button
                    className="glow-btn"
                    style={S.btnSave}
                    onClick={save}
                    disabled={alertOn.length === 0}
                    draggable={false}
                  >
                    Follow
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
