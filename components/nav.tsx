"use client";
// components/nav.tsx
// Sticky topbar navigation matching the template-grey aesthetic.
// Pure neutral greys, Inter font, #606060 active underline.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/",            label: "Overview"    },
  { href: "/wallets",     label: "Whale Report"   },
  { href: "/signals",     label: "Signals"     },
  { href: "/contrarian",  label: "Contrarian"  },
  { href: "/stalker",     label: "Wallet Stalker" },
  { href: "/morning",     label: "Morning Scan" },
  { href: "/recipes",     label: "Recipes"     },
  { href: "/scanner",     label: "Scanner"     },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 200,
        height: "52px",
        padding: "0 28px",
        background: "rgba(9,9,9,0.96)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(180,180,180,0.06)",
        display: "flex",
        alignItems: "center",
        gap: "16px",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "#f0f0f0" }}>
          HyperliquidFLOW
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: "1px", height: "20px", background: "rgba(180,180,180,0.06)", flexShrink: 0 }} />

      {/* Nav links */}
      <nav style={{ display: "flex", alignItems: "center", gap: "2px", overflowX: "auto" }}>
        {NAV_LINKS.map(({ href, label }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="glow-btn"
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: active ? "#f0f0f0" : "rgba(255,255,255,0.44)",
                textDecoration: "none",
                padding: "5px 10px",
                borderRadius: "5px",
                background: active ? "rgba(112,112,112,0.1)" : "transparent",
                border: active ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent",
                transition: "color 0.15s, background 0.15s, border-color 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>

    </header>
  );
}
