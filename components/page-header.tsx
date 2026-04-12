// components/page-header.tsx
"use client";

const REGIME_STYLES = {
  BULL:    { color: "#6aaa7a", bg: "rgba(106,170,122,0.08)", border: "rgba(106,170,122,0.2)",  label: "BULLISH"  },
  BEAR:    { color: "#b06868", bg: "rgba(176,104,104,0.08)", border: "rgba(176,104,104,0.2)",  label: "BEARISH"  },
  RANGING: { color: "#9ca3af", bg: "rgba(156,163,175,0.08)", border: "rgba(156,163,175,0.2)",  label: "RANGING"  },
};

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  regime?: "BULL" | "BEAR" | "RANGING";
}

export function PageHeader({ title, subtitle, regime }: PageHeaderProps) {
  const rs = regime ? REGIME_STYLES[regime] : null;

  return (
    <div style={{
      padding: "28px 32px 0",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
    }}>
      <div>
        <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#f0f0f0", margin: 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.38)", marginTop: "4px", margin: 0 }}>
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
          </div>
        </div>
      )}
    </div>
  );
}
