"use client";
// components/nav.tsx - SideRail navigation with section subtitles (no expand/collapse)

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, type as T, shadow, anim, radius } from "@/lib/design-tokens";
import { useAlertDetection } from "@/lib/hooks/use-alert-detection";
import { useAlertEvents } from "@/lib/hooks/use-alert-events";

const LOGO = "HyperliquidFLOW";

type NavChild    = { href: string; label: string };
type NavSection  = { section: string; label: string; base: string; children: NavChild[] };
type NavFlat     = { href: string; label: string };
type NavEntry    = NavFlat | NavSection;

const NAV: NavEntry[] = [
  { href: "/",      label: "Overview"    },
  {
    section:  "wallets",
    label:    "Wallets",
    base:     "/wallets",
    children: [
      { href: "/wallets/discovery",   label: "Discovery"    },
      { href: "/wallets/leaderboard", label: "Leaderboard"  },
      { href: "/wallets/inposition",  label: "In Position"  },
      { href: "/performance/ranking", label: "Scoring"      },
    ],
  },
  {
    section:  "signals",
    label:    "Signals",
    base:     "/signals",
    children: [
      { href: "/signals/feed",        label: "Feed"        },
      { href: "/signals/divergence",  label: "Divergence"  },
      { href: "/signals/performance", label: "Signal Scores" },
    ],
  },
  {
    section:  "portfolio",
    label:    "Portfolio",
    base:     "/wallets",
    children: [
      { href: "/wallets/following",   label: "Following"    },
      { href: "/wallets/paper",       label: "Paper Trading"},
    ],
  },
];

function isSection(e: NavEntry): e is NavSection {
  return "section" in e;
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile drawer

  // On route change: close mobile drawer
  useEffect(() => { setOpen(false); }, [pathname]);

  const { data } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  useAlertDetection();
  const { unseenCount } = useAlertEvents();

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle navigation"
        className="sidenav-hamburger"
        draggable={false}
        style={{
          position: "fixed", top: "14px", left: "14px", zIndex: 200,
          background: color.card, border: `1px solid rgba(255,255,255,0.1)`,
          borderRadius: "7px", color: color.text, fontSize: "16px", lineHeight: 1,
          padding: "7px 10px", cursor: "pointer",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          userSelect: "none",
        }}
      >&#9776;</button>

      {/* Mobile backdrop */}
      <div
        onClick={() => setOpen(false)}
        className="sidenav-backdrop"
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 99,
          backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
          display: open ? "block" : "none",
        }}
      />

      {/* Rail */}
      <nav
        className={`sidenav${open ? " sidenav-open" : ""}`}
        style={{
          width: "200px", minHeight: "100vh",
          background: color.nav,
          borderRight: `1px solid ${color.borderFaint}`,
          display: "flex", flexDirection: "column",
          position: "fixed", left: 0, top: 0, bottom: 0, zIndex: 100,
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* Logo */}
        <div className="sidenav-logo-wrap" style={{ padding: "16px 20px", borderBottom: `1px solid ${color.borderFaint}`, marginBottom: "16px" }}>
          <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "0.01em", display: "flex", alignItems: "center", justifyContent: "center", cursor: "default", userSelect: "none" }}>
            {LOGO.split("").map((ch, i) => (
              <span key={i} className="logo-char" style={{
                display: "inline-block", color: "rgba(255,255,255,0.85)",
                transition: `transform 0.25s cubic-bezier(0.34,1.56,0.64,1) ${i * anim.logoStaggerMs}ms, color 0.25s ${i * anim.logoStaggerMs}ms`,
              }}>{ch}</span>
            ))}
          </div>
        </div>

        {/* Nav items */}
        <div style={{ paddingTop: "8px" }}>
          {NAV.map((entry) => {
            if (!isSection(entry)) {
              const active = pathname === entry.href || (entry.href !== "/" && pathname.startsWith(entry.href));
              return (
                <Link key={entry.href} href={entry.href} className="glow-btn" draggable={false} style={{
                  display: "flex", alignItems: "center",
                  padding: "10px 20px", fontSize: "13px", fontWeight: 500,
                  color: active ? color.text : "rgba(255,255,255,0.44)",
                  textDecoration: "none",
                  borderLeft: active ? `2px solid ${color.navActive}` : "2px solid transparent",
                  background: active ? color.navActivebg : "transparent",
                  transition: anim.nav,
                  userSelect: "none",
                }}>
                  {entry.label}
                </Link>
              );
            }

            // Section: subtitle label + children always visible
            return (
              <div key={entry.section}>
                {/* Section subtitle */}
                <div style={{
                  padding: "12px 20px 4px",
                  fontSize: "11px", fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "rgba(255,255,255,0.22)",
                  userSelect: "none",
                }}>
                  {entry.label}
                </div>

                {/* Children */}
                {entry.children.map((child) => {
                  const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                  const showBadge   = child.href === "/wallets/following" && unseenCount > 0;
                  return (
                    <Link key={child.href} href={child.href} className="glow-btn" draggable={false} style={{
                      display: "flex", alignItems: "center",
                      padding: "7px 20px 7px 28px",
                      fontSize: "13px", fontWeight: 500,
                      color: childActive ? color.text : "rgba(255,255,255,0.44)",
                      textDecoration: "none",
                      borderLeft: childActive ? `2px solid ${color.navActive}` : "2px solid transparent",
                      background: childActive ? color.navActivebg : "transparent",
                      transition: anim.nav,
                      userSelect: "none",
                    }}>
                      <span>{child.label}</span>
                      {showBadge && (
                        <span style={{
                          marginLeft:         "auto",
                          fontSize:           "11px",
                          fontWeight:         700,
                          padding:            "1px 6px",
                          borderRadius:       radius.tag,
                          background:         `${color.amber}26`,
                          color:              color.amber,
                          border:             `1px solid ${color.amber}4d`,
                          fontVariantNumeric: "tabular-nums",
                          flexShrink:         0,
                        }}>
                          {unseenCount > 99 ? "99+" : unseenCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Bottom section: live footer */}
        <div style={{ marginTop: "auto" }}>

        {/* Live footer */}
        <div style={{ padding: "18px 0", borderTop: `1px solid ${color.borderFaint}`, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: color.green, ...shadow.liveDot,
              display: "inline-block", animation: anim.glowPulse, flexShrink: 0,
            }} />
            <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", userSelect: "none" }}>Monitoring</span>
          </div>
          {/* Reserved space - shimmer until timestamp loads */}
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)", marginTop: "4px", minHeight: "14px", display: "flex", justifyContent: "center", alignItems: "center", userSelect: "none" }}>
            {data?.updated_at
              ? timeAgo(data.updated_at)
              : <span style={{ display: "inline-block", height: "9px", width: "34px", borderRadius: 2, background: "rgba(255,255,255,0.06)" }} />
            }
          </div>
        </div>
        </div>{/* end bottom section */}
      </nav>
    </>
  );
}
