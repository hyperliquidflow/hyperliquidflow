// components/loading-state.tsx
// Page-specific Ghost Slide Up skeletons -- each mirrors the real page layout.
// Animation keyframe `slide-up-ghost` lives in globals.css.

import { color } from "@/lib/design-tokens";

// Shared style helpers

const ghost = (delay: number): React.CSSProperties => ({
  animation: `slide-up-ghost 2.4s ease-in-out ${delay}s infinite`,
});

const bone = (w: string | number, h = 9, extra?: React.CSSProperties): React.CSSProperties => ({
  height: h, width: w, borderRadius: 3,
  background: "rgba(255,255,255,0.07)",
  flexShrink: 0, ...extra,
});

const boneDim = (w: string | number, h = 8): React.CSSProperties => ({
  height: h, width: w, borderRadius: 3,
  background: "rgba(255,255,255,0.05)", flexShrink: 0,
});

const pill = (w = 44, h = 20): React.CSSProperties => ({
  height: h, width: w, borderRadius: 5,
  background: "rgba(255,255,255,0.06)", flexShrink: 0,
});

const shell: React.CSSProperties = {
  background: "rgba(19,21,26,0.85)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12, overflow: "hidden",
};

const cardHdrStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "13px 18px",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

const divider = "1px solid rgba(255,255,255,0.04)";
const pagePad = "0 32px";

// Shared sub-components

function GhostPageHeader() {
  return (
    <div style={{ padding: "28px 32px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={bone(130, 22)} />
        <div style={boneDim("200px", 10)} />
      </div>
      <div style={{ width: 110, height: 48, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function GhostCardHdr() {
  return (
    <div style={cardHdrStyle}>
      <div style={bone(100, 10)} />
      <div style={boneDim(48, 9)} />
    </div>
  );
}

// OVERVIEW (app/page.tsx)

export function OverviewLoadingState() {
  return (
    <>
      <GhostPageHeader />

      {/* Ticker strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(6,1fr)",
        margin: "20px 32px 0",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12, overflow: "hidden", minHeight: 57,
      }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ ...ghost(i * 0.12), display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRight: i < 5 ? "1px solid rgba(255,255,255,0.05)" : undefined }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={boneDim(28, 7)} />
              <div style={bone(60, 14)} />
            </div>
            <div style={{ flex: 1, height: 20, borderRadius: 3, background: "rgba(255,255,255,0.04)" }} />
            <div style={boneDim(36, 9)} />
          </div>
        ))}
      </div>

      <div style={{ padding: "20px 32px 0" }}>

        {/* 4-col stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
          {[0, 0.15, 0.30, 0.45].map((d, i) => (
            <div key={i} style={{ ...shell, ...ghost(d), padding: 20 }}>
              <div style={boneDim("55%", 8)} />
              <div style={{ ...bone("75%", 28), marginTop: 10 }} />
              <div style={{ ...boneDim("45%", 8), marginTop: 7 }} />
            </div>
          ))}
        </div>

        {/* Signal activity heatmap */}
        <div style={{ ...shell, marginBottom: 16 }}>
          <GhostCardHdr />
          <div style={{ padding: "14px 20px 12px", ...ghost(0.1) }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} style={{ flex: 1, borderRadius: "2px 2px 0 0", minHeight: 4, background: "rgba(255,255,255,0.06)", height: `${20 + Math.abs(Math.sin(i * 0.8)) * 80}%` }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7 }}>
              {[0, 1, 2, 3, 4].map((j) => (
                <div key={j} style={boneDim(28, 7)} />
              ))}
            </div>
          </div>
        </div>

        {/* Recent Signals (3fr) / Top Wallets (2fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginBottom: 16 }}>
          <div style={shell}>
            <GhostCardHdr />
            {[0, 0.18, 0.36, 0.54, 0.72, 0.90].map((d, i) => (
              <div key={i} style={{ ...ghost(d), display: "grid", gridTemplateColumns: "28px 1fr auto auto auto", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: divider }}>
                <div style={boneDim(16, 9)} />
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={bone("65%", 10)} />
                  <div style={boneDim("40%", 8)} />
                </div>
                <div style={pill(38)} />
                <div style={pill(44)} />
                <div style={boneDim(36, 9)} />
              </div>
            ))}
          </div>

          <div style={shell}>
            <GhostCardHdr />
            {[0, 0.20, 0.40, 0.60, 0.80].map((d, i) => (
              <div key={i} style={{ ...ghost(d), padding: "14px 18px", borderBottom: divider }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={boneDim(20, 8)} />
                  <div style={bone(36, 16)} />
                </div>
                <div style={boneDim("70%", 9)} />
                <div style={{ height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 1, marginTop: 8 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Market Vibes / Smart Money Exposure */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={shell}>
            <GhostCardHdr />
            <div style={{ padding: "18px 20px 20px", display: "flex", ...ghost(0.1) }}>
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.07)", margin: "0 auto 7px" }} />
                  <div style={{ ...boneDim(24, 7), margin: "0 auto 4px" }} />
                  <div style={{ ...boneDim(20, 7), margin: "0 auto" }} />
                </div>
              ))}
            </div>
          </div>

          <div style={shell}>
            <GhostCardHdr />
            <div style={{ padding: "12px 20px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
              {[0, 0.16, 0.32, 0.48, 0.64].map((d, i) => (
                <div key={i} style={{ ...ghost(d), display: "grid", gridTemplateColumns: "38px 1fr 40px", alignItems: "center", gap: 10 }}>
                  <div style={boneDim(28, 9)} />
                  <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }} />
                  <div style={boneDim(24, 9)} />
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}

// FEED (app/signals/feed/page.tsx)

export function FeedLoadingState() {
  return (
    <>
      <GhostPageHeader />
      <div style={{ padding: pagePad, paddingTop: "20px" } as React.CSSProperties}>

        {/* Filter row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
          {[80, 90, 70].map((w, i) => (
            <div key={i} style={{ height: 30, width: w, borderRadius: 5, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }} />
          ))}
          <div style={boneDim(60, 9)} />
        </div>

        {/* Recipe cards 3-col */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} style={{ ...shell, ...ghost(i * 0.1), padding: "16px 18px" }}>
              <div style={{ ...bone("55%", 11), marginBottom: 8 }} />
              <div style={{ ...boneDim("90%", 8), marginBottom: 4 }} />
              <div style={boneDim("70%", 8)} />
            </div>
          ))}
        </div>

        {/* Signal list -- type badge / recipe+coin / EV */}
        <div style={shell}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ ...ghost(i * 0.14), padding: "14px 20px", borderBottom: divider, display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div style={{ ...pill(52, 18), marginTop: 1 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={bone("38%", 10)} />
                  <div style={bone("12%", 10)} />
                </div>
                <div style={boneDim("60%", 8)} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <div style={bone(28, 14)} />
                <div style={boneDim(18, 7)} />
              </div>
            </div>
          ))}
        </div>

      </div>
    </>
  );
}

// DIVERGENCE (app/signals/divergence/page.tsx)

export function DivergenceLoadingState() {
  return (
    <>
      <GhostPageHeader />
      <div style={{ padding: pagePad, paddingTop: "20px" } as React.CSSProperties}>
        <div style={shell}>
          <div style={cardHdrStyle}>
            <div style={bone(140, 10)} />
            <div style={boneDim(110, 9)} />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ ...ghost(i * 0.15), padding: "16px 20px", borderBottom: divider, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={bone(52, 14)} />
                <div style={pill(80, 20)} />
                <div style={boneDim(14, 8)} />
                <div style={pill(80, 20)} />
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 40, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }} />
                  <div style={boneDim(32, 9)} />
                </div>
              </div>
              <div style={boneDim("72%", 8)} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// LEADERBOARD + IN POSITION (shared table shape)

function TableLoadingState() {
  const cols = ["#", "Wallet", "Score", "AUM", "uPnL", "Win Rate", "Positions", "Liq Buffer"];
  const colWidths = [40, 140, 100, 90, 90, 80, 80, 90];

  return (
    <>
      <GhostPageHeader />
      <div style={{ padding: pagePad, paddingTop: "20px" } as React.CSSProperties}>
        <div style={shell}>
          <div style={{ display: "flex", background: color.bg, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            {cols.map((label, i) => (
              <div key={label} style={{ width: colWidths[i], padding: "12px 16px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", flexShrink: 0, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{ ...ghost(i * 0.12), display: "flex", alignItems: "center", borderBottom: divider }}>
              <div style={{ width: 40, padding: "12px 16px", flexShrink: 0 }}><div style={boneDim(14, 9)} /></div>
              <div style={{ width: 140, padding: "12px 16px", flexShrink: 0 }}><div style={boneDim(100, 9)} /></div>
              <div style={{ width: 100, padding: "12px 16px", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 48, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }} />
                <div style={boneDim(28, 9)} />
              </div>
              {[90, 90, 80, 80, 90].map((w, j) => (
                <div key={j} style={{ width: w, padding: "12px 16px", flexShrink: 0 }}><div style={boneDim("70%", 9)} /></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function LeaderboardLoadingState() { return <TableLoadingState />; }
export function InPositionLoadingState()  { return <TableLoadingState />; }

// EDGE (app/edge/page.tsx)

export function EdgeLoadingState() {
  return (
    <>
      <GhostPageHeader />
      <div style={{ padding: pagePad, paddingTop: "20px" } as React.CSSProperties}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} style={{ ...shell, ...ghost(i * 0.1) }}>
              <div style={cardHdrStyle}>
                <div style={bone(100, 10)} />
                <div style={pill(32, 18)} />
              </div>
              <div style={{ padding: "16px 20px 18px" }}>
                <div style={bone(64, 28)} />
                <div style={{ ...boneDim(48, 8), marginTop: 7 }} />
                <div style={{ ...boneDim("90%", 8), marginTop: 14 }} />
                <div style={{ ...boneDim("70%", 8), marginTop: 5 }} />
                <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 14 }}>
                  <div style={{ width: `${35 + (i * 7) % 45}%`, height: "100%", background: "rgba(255,255,255,0.12)", borderRadius: 2 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={boneDim(42, 7)} /><div style={boneDim(28, 9)} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <div style={boneDim(36, 7)} /><div style={boneDim(24, 9)} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Generic fallback

export function LoadingState() {
  return (
    <div style={{ padding: "28px 32px" }}>
      <div style={shell}>
        <GhostCardHdr />
        {[0, 0.22, 0.44, 0.66, 0.88].map((d) => (
          <div key={d} style={{ ...ghost(d), display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderBottom: divider }}>
            <div style={{ width: 30, height: 30, borderRadius: 7, background: "rgba(255,255,255,0.05)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={bone("55%")} />
              <div style={boneDim("35%")} />
            </div>
            <div style={pill()} />
          </div>
        ))}
      </div>
    </div>
  );
}
