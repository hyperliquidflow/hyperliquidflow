"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFollowedWallets } from "@/lib/hooks/use-followed-wallets";
import { useAlertEvents } from "@/lib/hooks/use-alert-events";
import { FollowButton } from "@/components/follow-button";
import { PageHeader } from "@/components/page-header";
import { formatUsd, timeAgo } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space, radius, anim } from "@/lib/design-tokens";

const ALERT_LABEL: Record<string, string> = {
  open:   "Open",
  close:  "Close",
  resize: "Resize",
};

interface Position {
  coin:          string;
  szi:           string;
  positionValue: string;
  unrealizedPnl: string;
  entryPx:       string;
  leverage:      { type: string; value: number };
}

interface ProfileSummary { positions: Position[] }

type ProfileState = ProfileSummary | "loading" | "error";

const S = {
  page: { padding: space.pagePaddingX },
  card: { ...C.base },

  empty: {
    padding:   "48px 20px",
    textAlign: "center" as const,
    color:     color.textMuted,
    fontSize:  "13px",
  },

  // Outer item wrapper — holds row + optional panel
  item: {
    borderBottom: `1px solid ${color.divider}`,
    cursor:       "pointer",
    transition:   anim.row,
  },

  row: {
    padding:    space.walletItemPadding,
    display:    "flex",
    alignItems: "center",
    gap:        "16px",
  },

  identity: { flex: 1, minWidth: 0 },

  label: {
    fontSize:     "13px",
    fontWeight:   600,
    color:        color.text,
    marginBottom: "2px",
  },

  addrLink: {
    fontFamily:     T.mono,
    fontSize:       "13px",
    color:          color.neutral,
    textDecoration: "none",
    display:        "block",
    overflow:       "hidden" as const,
    textOverflow:   "ellipsis" as const,
    whiteSpace:     "nowrap" as const,
  },

  meta: {
    display:    "flex",
    alignItems: "center",
    flexWrap:   "wrap" as const,
    gap:        "4px",
    marginTop:  "8px",
  },

  alertPill: {
    fontSize:      "11px",
    fontWeight:    700,
    letterSpacing: "0.04em",
    padding:       "2px 6px",
    borderRadius:  radius.tag,
    background:    color.tagBg,
    border:        `1px solid ${color.border}`,
    color:         color.textMuted,
  },

  paperBadge: {
    fontSize:      "11px",
    fontWeight:    700,
    letterSpacing: "0.04em",
    padding:       "2px 6px",
    borderRadius:  radius.tag,
    background:    `${color.amber}18`,
    border:        `1px solid ${color.amber}30`,
    color:         color.amber,
  },

  metaDot: {
    width:       "3px",
    height:      "3px",
    borderRadius:"50%",
    background:  color.textFaint,
    flexShrink:  0 as const,
    margin:      "0 2px",
  },

  metaDate: { fontSize: "11px", color: color.textFaint },

  stats: {
    display:    "flex",
    alignItems: "center",
    gap:        "16px",
    flexShrink: 0 as const,
  },

  scoreWrap: {
    display:    "flex",
    alignItems: "center",
    gap:        "6px",
    flexShrink: 0 as const,
  },

  barTrack: {
    width:        "40px",
    height:       "3px",
    borderRadius: radius.bar,
    background:   color.barBg,
    overflow:     "hidden" as const,
  },

  barFill:  { height: "100%", borderRadius: radius.bar, background: color.neutral },
  scoreNum: { fontSize: "11px", fontWeight: 600, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  stat:     { fontSize: "13px", fontVariantNumeric: "tabular-nums", color: color.textMuted, flexShrink: 0 as const },
  statMiss: { fontSize: "11px", color: color.textFaint, flexShrink: 0 as const },

  chevron: (open: boolean): React.CSSProperties => ({
    width:      "16px",
    height:     "16px",
    flexShrink: 0,
    color:      color.textFaint,
    transition: "transform 0.18s",
    transform:  open ? "rotate(90deg)" : "rotate(0deg)",
  }),

  // Expanded panel
  panel: {
    padding:     "12px 20px 16px",
    borderTop:   `1px solid ${color.divider}`,
    background:  color.strip,
  },

  panelMuted: { fontSize: "13px", color: color.textMuted, padding: "4px 0" },

  // Position table
  posHeader: {
    display:  "grid",
    gridTemplateColumns: "1fr 76px 96px 96px 80px",
    gap:      "0",
    padding:  "0 0 6px",
    borderBottom: `1px solid ${color.divider}`,
    marginBottom: "4px",
  },

  posHeaderCell: {
    fontSize:      "11px",
    fontWeight:    700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color:         color.textFaint,
  },

  posRow: {
    display:  "grid",
    gridTemplateColumns: "1fr 76px 96px 96px 80px",
    gap:      "0",
    padding:  "7px 0",
    borderBottom: `1px solid ${color.divider}`,
    alignItems: "center",
  },

  coin: { fontFamily: T.mono, fontSize: "13px", fontWeight: 600, color: color.text },

  dirPill: (isLong: boolean): React.CSSProperties => ({
    fontSize:      "11px",
    fontWeight:    700,
    padding:       "2px 6px",
    borderRadius:  radius.dirPill,
    background:    isLong ? color.longBg   : color.shortBg,
    border:        `1px solid ${isLong ? color.longBorder : color.shortBorder}`,
    color:         isLong ? color.green    : color.red,
    whiteSpace:    "nowrap" as const,
    justifySelf:   "start" as const,
  }),

  posNum: { fontSize: "13px", fontVariantNumeric: "tabular-nums", color: color.textMuted, textAlign: "right" as const, paddingRight: "4px" },
  posLev: { fontSize: "11px", color: color.textFaint, textAlign: "right" as const, paddingRight: "4px" },
};

import type React from "react";

export function FollowingClient() {
  const { wallets } = useFollowedWallets();
  const { unseenCount } = useAlertEvents();
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [profileCache, setProfileCache] = useState<Map<string, ProfileState>>(new Map());

  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then(r => r.json()),
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const walletMap = new Map(data?.top_wallets.map(w => [w.address, w]) ?? []);

  async function toggle(address: string) {
    if (expanded === address) { setExpanded(null); return; }
    setExpanded(address);
    if (!profileCache.has(address)) {
      setProfileCache(m => new Map(m).set(address, "loading"));
      try {
        const res  = await fetch(`/api/wallet-profile?address=${address}`);
        const json = await res.json();
        setProfileCache(m => new Map(m).set(address, json as ProfileSummary));
      } catch {
        setProfileCache(m => new Map(m).set(address, "error"));
      }
    }
  }

  const subtitle = wallets.length === 0
    ? "Follow wallets to track their positions"
    : `${wallets.length} wallet${wallets.length === 1 ? "" : "s"} followed${unseenCount > 0 ? `, ${unseenCount} unseen alert${unseenCount === 1 ? "" : "s"}` : ""}`;

  return (
    <div className="page-enter">
      <PageHeader title="Following" subtitle={subtitle} />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={S.card}>
          {wallets.length === 0 ? (
            <div style={S.empty}>
              No wallets followed. Use the Follow button on the Leaderboard or In Position to get started.
            </div>
          ) : (
            wallets.map(fw => {
              const w       = walletMap.get(fw.address);
              const isOpen  = expanded === fw.address;
              const profile = profileCache.get(fw.address);

              return (
                <div
                  key={fw.address}
                  style={S.item}
                  onClick={() => toggle(fw.address)}
                  onMouseEnter={e => (e.currentTarget.style.background = color.rowHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {/* Main row */}
                  <div style={S.row}>
                    {/* Chevron */}
                    <svg style={S.chevron(isOpen)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 4l4 4-4 4" />
                    </svg>

                    {/* Identity */}
                    <div style={S.identity}>
                      {fw.label && <div style={S.label}>{fw.label}</div>}
                      <Link
                        href={`/wallets/discovery?address=${fw.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={S.addrLink}
                        draggable={false}
                        onClick={e => e.stopPropagation()}
                      >
                        {fw.address}
                      </Link>
                      <div style={S.meta}>
                        {fw.alert_on.map(t => (
                          <span key={t} style={S.alertPill}>{ALERT_LABEL[t] ?? t}</span>
                        ))}
                        {fw.paper_copy && <span style={S.paperBadge}>Copied</span>}
                        {fw.followed_at && (
                          <>
                            <div style={S.metaDot} />
                            <span style={S.metaDate}>followed {timeAgo(fw.followed_at)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Cohort stats */}
                    {w ? (
                      <div style={S.stats}>
                        <div style={S.scoreWrap}>
                          <div style={S.barTrack}>
                            <div style={{ ...S.barFill, width: `${w.overall_score * 100}%` }} />
                          </div>
                          <span style={S.scoreNum}>{w.overall_score.toFixed(2)}</span>
                        </div>
                        <span style={{ ...S.stat, color: w.unrealized_pnl >= 0 ? color.green : color.red }}>
                          {formatUsd(w.unrealized_pnl)}
                        </span>
                        <span style={S.stat}>{formatUsd(w.account_value)}</span>
                        <span style={S.stat}>{w.position_count} pos</span>
                      </div>
                    ) : (
                      <span style={S.statMiss}>not in cohort</span>
                    )}

                    <div onClick={e => e.stopPropagation()}>
                      <FollowButton address={fw.address} />
                    </div>
                  </div>

                  {/* Expanded positions panel */}
                  {isOpen && (
                    <div style={S.panel} onClick={e => e.stopPropagation()}>
                      {profile === "loading" ? (
                        <div style={S.panelMuted}>Loading positions...</div>
                      ) : profile === "error" ? (
                        <div style={{ ...S.panelMuted, color: color.red }}>Failed to load position data</div>
                      ) : !profile ? null : profile.positions.length === 0 ? (
                        <div style={S.panelMuted}>No open positions</div>
                      ) : (
                        <>
                          <div style={S.posHeader}>
                            <span style={S.posHeaderCell}>Asset</span>
                            <span style={S.posHeaderCell}>Direction</span>
                            <span style={{ ...S.posHeaderCell, textAlign: "right" }}>Size</span>
                            <span style={{ ...S.posHeaderCell, textAlign: "right" }}>uPnL</span>
                            <span style={{ ...S.posHeaderCell, textAlign: "right" }}>Leverage</span>
                          </div>
                          {profile.positions.map(p => {
                            const isLong = parseFloat(p.szi) > 0;
                            const pnl    = parseFloat(p.unrealizedPnl);
                            return (
                              <div key={p.coin} style={S.posRow}>
                                <span style={S.coin}>{p.coin}</span>
                                <span style={S.dirPill(isLong)}>{isLong ? "LONG" : "SHORT"}</span>
                                <span style={S.posNum}>{formatUsd(parseFloat(p.positionValue))}</span>
                                <span style={{ ...S.posNum, color: pnl >= 0 ? color.green : color.red }}>
                                  {pnl >= 0 ? "+" : ""}{formatUsd(pnl)}
                                </span>
                                <span style={S.posLev}>{p.leverage.value}x {p.leverage.type}</span>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
