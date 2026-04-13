"use client";
// components/nav.tsx — SideRail navigation with expandable sections

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";

const LOGO = "HyperliquidFLOW";

const DURATION = 220; // ms per collapse/expand segment

type NavChild = { href: string; label: string };
type NavSection = { section: string; label: string; base: string; children: NavChild[] };
type NavFlat    = { href: string; label: string };
type NavEntry   = NavFlat | NavSection;

const NAV: NavEntry[] = [
  { href: "/",      label: "Overview"    },
  { href: "/brief", label: "Daily Brief" },
  {
    section:  "wallets",
    label:    "Wallets",
    base:     "/wallets",
    children: [
      { href: "/wallets/discovery",   label: "Discovery"   },
      { href: "/wallets/leaderboard", label: "Leaderboard" },
      { href: "/wallets/inposition",  label: "In Position" },
    ],
  },
  {
    section:  "signals",
    label:    "Signals",
    base:     "/signals",
    children: [
      { href: "/signals/feed",        label: "Feed"        },
      { href: "/signals/divergence",  label: "Divergence"  },
    ],
  },
  { href: "/edge",  label: "Edge"        },
];

// Child item height in px (padding 7px top+bottom, 13px text ~20px = 34px per item)
const CHILD_HEIGHTS: Record<string, number> = { wallets: 102, signals: 68 };

function isSection(e: NavEntry): e is NavSection {
  return "section" in e;
}

function sectionForPath(pathname: string): string | null {
  for (const e of NAV) {
    if (isSection(e) && pathname.startsWith(e.base)) return e.section;
  }
  return null;
}

function firstChildHref(sec: string): string | null {
  const entry = NAV.find((e) => isSection(e) && e.section === sec) as NavSection | undefined;
  return entry?.children[0]?.href ?? null;
}

export function Nav() {
  const pathname  = usePathname();
  const router    = useRouter();
  const [open, setOpen]         = useState(false);   // mobile drawer
  const [openSec, setOpenSec]   = useState<string | null>(() => sectionForPath(pathname));
  const animating = useRef(false);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for the children containers (for imperative max-height)
  const chRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // On route change: close mobile drawer
  useEffect(() => { setOpen(false); }, [pathname]);

  // When pathname changes (e.g. back/forward), sync open section
  useEffect(() => {
    const sec = sectionForPath(pathname);
    if (sec !== openSec) {
      setOpenSec(sec);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Apply max-height whenever openSec changes
  useEffect(() => {
    for (const e of NAV) {
      if (!isSection(e)) continue;
      const el = chRefs.current[e.section];
      if (!el) continue;
      el.style.transition = `max-height ${DURATION}ms cubic-bezier(0.4,0,0.2,1)`;
      el.style.maxHeight  = openSec === e.section
        ? CHILD_HEIGHTS[e.section] + "px"
        : "0px";
    }
  }, [openSec]);

  function toggleSection(sec: string) {
    if (animating.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    const prev = openSec;

    if (prev === sec) {
      // Collapse and go nowhere (stay on current page)
      animating.current = true;
      setOpenSec(null);
      timerRef.current = setTimeout(() => { animating.current = false; }, DURATION);
      return;
    }

    if (prev && prev !== sec) {
      // Sequential: navigate immediately, collapse prev, then expand new
      const href = firstChildHref(sec);
      if (href) router.push(href);
      animating.current = true;
      setOpenSec(null);
      timerRef.current = setTimeout(() => {
        setOpenSec(sec);
        timerRef.current = setTimeout(() => { animating.current = false; }, DURATION);
      }, DURATION + 30);
      return;
    }

    // Nothing open — navigate immediately, then expand
    const href = firstChildHref(sec);
    if (href) router.push(href);
    animating.current = true;
    setOpenSec(sec);
    timerRef.current = setTimeout(() => { animating.current = false; }, DURATION);
  }

  const { data } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle navigation"
        className="sidenav-hamburger"
        style={{
          position: "fixed", top: "14px", left: "14px", zIndex: 200,
          background: "rgba(12,12,12,0.9)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "7px", color: "#f0f0f0", fontSize: "18px", lineHeight: 1,
          padding: "7px 10px", cursor: "pointer",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        }}
      >☰</button>

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
          background: "rgba(8,8,8,0.85)",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          display: "flex", flexDirection: "column",
          position: "fixed", left: 0, top: 0, bottom: 0, zIndex: 100,
          paddingTop: "24px",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* Logo */}
        <div className="sidenav-logo-wrap" style={{ padding: "0 20px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: "16px" }}>
          <div style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "0.01em", display: "flex", cursor: "default" }}>
            {LOGO.split("").map((ch, i) => (
              <span key={i} className="logo-char" style={{
                display: "inline-block", color: "rgba(255,255,255,0.85)",
                transition: `transform 0.25s cubic-bezier(0.34,1.56,0.64,1) ${i * 18}ms, color 0.25s ${i * 18}ms`,
              }}>{ch}</span>
            ))}
          </div>
        </div>

        {/* Nav items */}
        <div style={{ paddingTop: "8px" }}>
          {NAV.map((entry) => {
            if (!isSection(entry)) {
              // Flat item
              const active = pathname === entry.href || (entry.href !== "/" && pathname.startsWith(entry.href));
              return (
                <Link key={entry.href} href={entry.href} className="glow-btn" style={{
                  display: "flex", alignItems: "center",
                  padding: "10px 20px", fontSize: "14px", fontWeight: 500,
                  color: active ? "#f0f0f0" : "rgba(255,255,255,0.44)",
                  textDecoration: "none",
                  borderLeft: active ? "2px solid rgba(151,253,229,0.7)" : "2px solid transparent",
                  background: active ? "rgba(151,253,229,0.05)" : "transparent",
                  transition: "color 0.15s, border-color 0.15s, background 0.15s",
                  userSelect: "none",
                }}>
                  {entry.label}
                </Link>
              );
            }

            // Expandable section
            const isOpen   = openSec === entry.section;
            const inSection = pathname.startsWith(entry.base);

            return (
              <div key={entry.section}>
                {/* Section header */}
                <button
                  onClick={() => toggleSection(entry.section)}
                  className="glow-btn"
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 20px", fontSize: "14px", fontWeight: 500,
                    color: inSection ? "#f0f0f0" : "rgba(255,255,255,0.44)",
                    background: "transparent",
                    border: "none", borderLeft: "2px solid transparent",
                    cursor: "pointer", userSelect: "none",
                    transition: "color 0.15s",
                  } as React.CSSProperties}
                >
                  <span>{entry.label}</span>
                  <span style={{
                    fontSize: "12px",
                    color: isOpen ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.22)",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: `transform ${DURATION}ms cubic-bezier(0.4,0,0.2,1), color ${DURATION}ms`,
                    display: "inline-block",
                    lineHeight: 1,
                  }}>›</span>
                </button>

                {/* Children */}
                <div
                  ref={(el) => { chRefs.current[entry.section] = el; }}
                  style={{ overflow: "hidden", maxHeight: isOpen ? CHILD_HEIGHTS[entry.section] + "px" : "0px" }}
                >
                  {entry.children.map((child) => {
                    const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                    return (
                      <Link key={child.href} href={child.href} className="glow-btn" style={{
                        display: "flex", alignItems: "center",
                        padding: "7px 20px 7px 32px",
                        fontSize: "13px", fontWeight: 400,
                        color: childActive ? "#f0f0f0" : "rgba(255,255,255,0.38)",
                        textDecoration: "none",
                        borderLeft: childActive ? "2px solid rgba(151,253,229,0.65)" : "2px solid transparent",
                        background: childActive ? "rgba(151,253,229,0.04)" : "transparent",
                        transition: "color 0.15s, border-color 0.15s, background 0.15s",
                        userSelect: "none",
                      }}>
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live footer */}
        <div style={{ marginTop: "auto", padding: "18px 0", borderTop: "1px solid rgba(255,255,255,0.05)", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: "#6aaa7a", boxShadow: "0 0 6px #6aaa7a",
              display: "inline-block", animation: "glow-pulse 2s ease-in-out infinite", flexShrink: 0,
            }} />
            <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", userSelect: "none" }}>Monitoring</span>
          </div>
          {data?.updated_at && (
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)", marginTop: "4px", userSelect: "none" }}>
              {timeAgo(data.updated_at)}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
