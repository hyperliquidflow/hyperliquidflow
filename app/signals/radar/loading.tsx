import { card, color, space, pageHeader as PH, radius } from "@/lib/design-tokens";

const bone = (w: string | number, h = 10): React.CSSProperties => ({
  height: h, width: w,
  borderRadius: 3,
  background: "rgba(255,255,255,0.07)",
  flexShrink: 0,
  animation: "slide-up-ghost 2.4s ease-in-out infinite",
});

export default function Loading() {
  return (
    <div>
      <div style={PH.container}>
        <div style={bone(160, 22)} />
        <div style={{ ...bone("220px", 10), marginTop: 8 }} />
      </div>
      <div style={{ padding: `${space.contentPaddingTop} ${space.pagePaddingX} ${space.contentPaddingBot}` }}>
        <div style={{ ...card.base, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={bone(120, 24)} />
            <div style={bone(140, 24)} />
          </div>
          <div style={{
            height: 480, borderRadius: radius.card,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${color.borderFaint}`,
          }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={bone("60%", 9)} />
                <div style={bone("80%", 16)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
