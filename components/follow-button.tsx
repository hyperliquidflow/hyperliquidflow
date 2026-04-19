"use client";
import type React from "react";
import { useState } from "react";
import { useFollowedWallets } from "@/lib/hooks/use-followed-wallets";
import { color, radius, layout } from "@/lib/design-tokens";

const S = {
  btn: (following: boolean): React.CSSProperties => ({
    fontSize:      "11px",
    fontWeight:    600,
    letterSpacing: "0.04em",
    padding:       "3px 9px",
    borderRadius:  radius.tag,
    border:        `1px solid ${following ? color.borderHover : color.border}`,
    background:    following ? "rgba(255,255,255,0.06)" : "transparent",
    color:         following ? color.text : color.textMuted,
    cursor:        "pointer",
    flexShrink:    0 as const,
    transition:    "color 0.15s, border-color 0.15s",
  }),
  overlay: {
    position:             "fixed" as const,
    inset:                0,
    background:           "rgba(0,0,0,0.6)",
    backdropFilter:       "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    zIndex:               layout.zIndex.navBackdrop,
    display:              "flex",
    alignItems:           "center",
    justifyContent:       "center",
  },
  modal: {
    background:           "rgba(12,12,12,0.95)",
    border:               `1px solid rgba(255,255,255,0.1)`,
    borderRadius:         radius.card,
    padding:              "24px",
    width:                "320px",
    backdropFilter:       "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    boxShadow:            "0 8px 40px rgba(0,0,0,0.6)",
    zIndex:               layout.zIndex.popup,
  } as React.CSSProperties,
  label: {
    fontSize:        "11px",
    fontWeight:      700,
    letterSpacing:   "0.08em",
    textTransform:   "uppercase" as const,
    color:           "rgba(255,255,255,0.4)",
    display:         "block",
    marginBottom:    "6px",
  },
  input: {
    width:        "100%",
    background:   color.inputBg,
    border:       `1px solid ${color.inputBorder}`,
    borderRadius: radius.input,
    color:        "rgba(255,255,255,0.85)",
    fontSize:     "13px",
    padding:      "8px 10px",
    boxSizing:    "border-box" as const,
    marginBottom: "16px",
  },
  checkRow: {
    display:     "flex",
    alignItems:  "center",
    gap:         "8px",
    marginBottom:"8px",
    cursor:      "pointer",
    fontSize:    "13px",
    color:       "rgba(255,255,255,0.7)",
  },
  actions: {
    display:        "flex",
    gap:            "8px",
    marginTop:      "20px",
    justifyContent: "flex-end",
  },
  cancel: {
    fontSize:     "13px",
    padding:      "7px 14px",
    borderRadius: radius.input,
    border:       `1px solid ${color.border}`,
    background:   "transparent",
    color:        color.textMuted,
    cursor:       "pointer",
  },
  save: {
    fontSize:     "13px",
    fontWeight:   600,
    padding:      "7px 14px",
    borderRadius: radius.input,
    border:       "none",
    background:   color.accent,
    color:        "#000",
    cursor:       "pointer",
  },
  unfollow: {
    fontSize:     "13px",
    padding:      "7px 14px",
    borderRadius: radius.input,
    border:       `1px solid ${color.red}40`,
    background:   `${color.red}10`,
    color:        color.red,
    cursor:       "pointer",
  },
};

export function FollowButton({ address }: { address: string }) {
  const { isFollowing, follow, unfollow, wallets } = useFollowedWallets();
  const [open, setOpen] = useState(false);
  const following = isFollowing(address);
  const existing  = wallets.find(w => w.address === address);

  const [label,   setLabel]   = useState(existing?.label ?? "");
  const [alertOn, setAlertOn] = useState<("open" | "close" | "resize")[]>(
    existing?.alert_on ?? ["open", "close", "resize"]
  );
  const [papCopy, setPapCopy] = useState(existing?.paper_copy ?? false);

  function openModal() {
    setLabel(existing?.label ?? "");
    setAlertOn(existing?.alert_on ?? ["open", "close", "resize"]);
    setPapCopy(existing?.paper_copy ?? false);
    setOpen(true);
  }

  function toggleAlert(t: "open" | "close" | "resize") {
    setAlertOn(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function save() {
    follow({
      address, label: label || undefined,
      followed_at: existing?.followed_at ?? new Date().toISOString(),
      alert_on: alertOn, paper_copy: papCopy,
    });
    setOpen(false);
  }

  return (
    <>
      <button onClick={openModal} style={S.btn(following)} draggable={false}>
        {following ? "Following" : "Follow"}
      </button>

      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: "16px", fontWeight: 600, color: color.text, marginBottom: "20px" }}>
              {following ? "Edit follow" : "Follow wallet"}
            </div>

            <label style={S.label}>Nickname (optional)</label>
            <input
              style={S.input}
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Whale Alpha"
              maxLength={40}
            />

            <label style={S.label}>Alert on</label>
            {(["open", "close", "resize"] as const).map(t => (
              <label key={t} style={S.checkRow}>
                <input type="checkbox" checked={alertOn.includes(t)} onChange={() => toggleAlert(t)} />
                {t === "open" ? "Position opened" : t === "close" ? "Position closed" : "Position resized (>10%)"}
              </label>
            ))}

            <label style={{ ...S.checkRow, marginTop: "12px" }}>
              <input type="checkbox" checked={papCopy} onChange={e => setPapCopy(e.target.checked)} />
              Auto-create paper trades
            </label>

            <div style={S.actions}>
              {following && (
                <button style={S.unfollow} onClick={() => { unfollow(address); setOpen(false); }}>
                  Unfollow
                </button>
              )}
              <button style={S.cancel} onClick={() => setOpen(false)}>Cancel</button>
              <button style={S.save} onClick={save} disabled={alertOn.length === 0}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
