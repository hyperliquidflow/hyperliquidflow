// components/page-header.tsx
"use client";

import { color } from "@/lib/design-tokens";

const REGIME_STYLES = {
  BULL:    { color: color.green,   bg: color.regimeBg,   border: color.regimeBorder, label: "BULLISH"  },
  BEAR:    { color: color.red,     bg: "rgba(201,36,53,0.08)", border: "rgba(201,36,53,0.2)", label: "BEARISH"  },
  RANGING: { color: color.neutral, bg: color.neutralBg,  border: color.neutralBorder, label: "RANGING"  },
};

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  regime?: "BULL" | "BEAR" | "RANGING";
  btcReturn?: number;
}

export function PageHeader({ title, subtitle, regime, btcReturn }: PageHeaderProps) {
  const rs = regime ? REGIME_STYLES[regime] : null;

  return (
    <div style={{
      padding: "28px 32px 0",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
    }}>
      <div>
        <h1 style={{ fontSize: "26px", fontWeight: 700, color: color.text, margin: 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.38)", marginTop: "4px" }}>
            {subtitle}
          </p>
        )}
      </div>

      {rs && (
        <div
          className="glow-btn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 28px",
            borderRadius: "10px",
            background: rs.bg,
            border: `1px solid ${rs.border}`,
            cursor: "default",
          }}
        >
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: rs.color,
            boxShadow: `0 0 8px ${rs.color}`,
            display: "inline-block",
            animation: "glow-pulse 2s ease-in-out infinite",
            flexShrink: 0,
          }} />
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: rs.color }}>
              {rs.label}
            </div>
            {btcReturn !== undefined && (
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.36)", marginTop: "1px" }}>
                BTC {btcReturn >= 0 ? "+" : ""}{(btcReturn * 100).toFixed(2)}%
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
