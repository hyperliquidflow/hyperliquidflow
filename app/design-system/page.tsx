"use client";
// app/design-system/page.tsx
// Visual reference for all design-tokens.ts values.
// Hidden from nav -- access at /design-system

import React, { useState } from "react";
import {
  color,
  card as C,
  type as T,
  space,
  radius,
  shadow,
  effect,
  layout,
  anim,
  row as R,
} from "@/lib/design-tokens";
import { PageHeader } from "@/components/page-header";

// Section wrapper
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...C.base, marginBottom: space.cardGap }}>
      <div style={{ ...C.header }}>
        <span style={{ ...T.cardTitle }}>{title}</span>
      </div>
      <div style={{ padding: space.cardBodyPadding }}>{children}</div>
    </div>
  );
}

// Color swatch -- click to copy token name
function Swatch({ name, value }: { name: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(name);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        width: "100%",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "44px",
          background: value,
          borderRadius: radius.tag,
          border: `1px solid ${color.border}`,
          transition: anim.card,
        }}
      />
      <div
        style={{
          fontFamily: T.mono,
          fontSize: "11px",
          color: copied ? color.green : color.textMuted,
          letterSpacing: "0.02em",
        }}
      >
        {copied ? "copied" : name}
      </div>
      <div
        style={{
          fontFamily: T.mono,
          fontSize: "10px",
          color: color.textFaint,
          letterSpacing: "0.01em",
          wordBreak: "break-all",
        }}
      >
        {value.length > 26 ? value.slice(0, 26) + "..." : value}
      </div>
    </button>
  );
}

// Typography row
function TypeRow({ name, styles }: { name: string; styles: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "24px",
        padding: "10px 0",
        borderBottom: `1px solid ${color.divider}`,
      }}
    >
      <div
        style={{
          width: "220px",
          flexShrink: 0,
          fontFamily: T.mono,
          fontSize: "11px",
          color: color.textMuted,
          letterSpacing: "0.02em",
        }}
      >
        {name}
      </div>
      <div style={{ ...styles, marginLeft: undefined, marginTop: undefined, padding: undefined }}>
        The quick brown fox
      </div>
    </div>
  );
}

// Spacing bar
function SpaceRow({ name, value }: { name: string; value: string }) {
  const px = /^\d+px$/.test(value) ? parseInt(value, 10) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "7px 0",
        borderBottom: `1px solid ${color.divider}`,
      }}
    >
      <div
        style={{
          width: "220px",
          flexShrink: 0,
          fontFamily: T.mono,
          fontSize: "11px",
          color: color.textMuted,
        }}
      >
        {name}
      </div>
      {px !== null && (
        <div
          style={{
            height: "6px",
            width: Math.min(px, 280),
            background: color.green,
            borderRadius: radius.barFill,
            opacity: 0.55,
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ fontFamily: T.mono, fontSize: "11px", color: color.textDim }}>
        {value}
      </div>
    </div>
  );
}

// Radius demo box
function RadiusBox({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", flexShrink: 0 }}>
      <div
        style={{
          width: "60px",
          height: "60px",
          background: color.card,
          border: `1px solid ${color.borderHover}`,
          borderRadius: value,
        }}
      />
      <div style={{ fontFamily: T.mono, fontSize: "10px", color: color.textMuted, textAlign: "center" }}>
        {name}
      </div>
      <div style={{ fontFamily: T.mono, fontSize: "10px", color: color.textFaint, textAlign: "center" }}>
        {value}
      </div>
    </div>
  );
}

// Color groups
const COLOR_GROUPS = [
  {
    group: "Base",
    tokens: [
      { name: "color.bg",        value: color.bg },
      { name: "color.text",      value: color.text },
      { name: "color.textMuted", value: color.textMuted },
      { name: "color.textDim",   value: color.textDim },
      { name: "color.textFaint", value: color.textFaint },
    ],
  },
  {
    group: "Semantic",
    tokens: [
      { name: "color.green",  value: color.green },
      { name: "color.red",    value: color.red },
      { name: "color.amber",  value: color.amber },
      { name: "color.accent", value: color.accent },
    ],
  },
  {
    group: "Surface",
    tokens: [
      { name: "color.card",        value: color.card },
      { name: "color.cardHover",   value: color.cardHover },
      { name: "color.nav",         value: color.nav },
      { name: "color.navActivebg", value: color.navActivebg },
      { name: "color.strip",       value: color.strip },
    ],
  },
  {
    group: "Border",
    tokens: [
      { name: "color.border",      value: color.border },
      { name: "color.borderFaint", value: color.borderFaint },
      { name: "color.borderHover", value: color.borderHover },
      { name: "color.navActive",   value: color.navActive },
    ],
  },
  {
    group: "Signal Pills",
    tokens: [
      { name: "color.longBg",     value: color.longBg },
      { name: "color.longBorder", value: color.longBorder },
      { name: "color.shortBg",    value: color.shortBg },
      { name: "color.shortBorder",value: color.shortBorder },
      { name: "color.hmLong",     value: color.hmLong },
      { name: "color.hmShort",    value: color.hmShort },
      { name: "color.hmQuiet",    value: color.hmQuiet },
    ],
  },
  {
    group: "Misc",
    tokens: [
      { name: "color.tagBg",       value: color.tagBg },
      { name: "color.tagText",     value: color.tagText },
      { name: "color.barBg",       value: color.barBg },
      { name: "color.divider",     value: color.divider },
      { name: "color.regimeBg",    value: color.regimeBg },
      { name: "color.regimeBorder",value: color.regimeBorder },
    ],
  },
];

export default function DesignSystemPage() {
  return (
    <>
      <PageHeader
        title="Design System"
        subtitle="Token reference for HyperliquidFLOW. Click any color swatch to copy the token name."
      />
      <div
        style={{
          padding: `${space.contentPaddingTop} ${space.pagePaddingX} ${space.contentPaddingBot}`,
        }}
      >

        {/* Colors */}
        {COLOR_GROUPS.map((group) => (
          <Section key={group.group} title={`Colors: ${group.group}`}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                gap: space.cardGap,
              }}
            >
              {group.tokens.map((tok) => (
                <Swatch key={tok.name} name={tok.name} value={tok.value} />
              ))}
            </div>
          </Section>
        ))}

        {/* Typography */}
        <Section title="Typography">
          {[
            { name: "type.pageTitle",       styles: T.pageTitle },
            { name: "type.pageSubtitle",    styles: T.pageSubtitle },
            { name: "type.cardTitle",       styles: T.cardTitle },
            { name: "type.statLabel",       styles: T.statLabel },
            { name: "type.statValue",       styles: T.statValue },
            { name: "type.statSub",         styles: T.statSub },
            { name: "type.sigName",         styles: T.sigName },
            { name: "type.sigSub",          styles: T.sigSub },
            { name: "type.sigNum",          styles: { ...T.sigNum,  textAlign: "left" as const } },
            { name: "type.sigEv",           styles: { ...T.sigEv,   textAlign: "left" as const } },
            { name: "type.sigDir",          styles: T.sigDir },
            { name: "type.walletRank",      styles: T.walletRank },
            { name: "type.walletScore",     styles: T.walletScore },
            { name: "type.walletAddr",      styles: T.walletAddr },
            { name: "type.navSectionLabel", styles: { ...T.navSectionLabel, padding: undefined } },
            { name: "type.navItem",         styles: T.navItem },
            { name: "type.coinName",        styles: T.coinName },
            { name: "type.coinPrice",       styles: T.coinPrice },
            { name: "type.coinChange",      styles: T.coinChange },
            { name: "type.liveText",        styles: T.liveText },
            { name: "type.liveTime",        styles: T.liveTime },
            { name: "type.heatmapLabel",    styles: T.heatmapLabel },
          ].map(({ name, styles }) => (
            <TypeRow key={name} name={name} styles={styles} />
          ))}
        </Section>

        {/* Spacing */}
        <Section title="Spacing">
          {[
            ["space.pagePaddingTop",    space.pagePaddingTop],
            ["space.pagePaddingX",      space.pagePaddingX],
            ["space.contentPaddingTop", space.contentPaddingTop],
            ["space.contentPaddingBot", space.contentPaddingBot],
            ["space.cardHeaderPadding", space.cardHeaderPadding],
            ["space.cardBodyPadding",   space.cardBodyPadding],
            ["space.cardGap",           space.cardGap],
            ["space.rowGap",            space.rowGap],
            ["space.statGap",           space.statGap],
            ["space.sigRowPadding",     space.sigRowPadding],
            ["space.walletItemPadding", space.walletItemPadding],
            ["space.stripMarginTop",    space.stripMarginTop],
            ["space.coinPadding",       space.coinPadding],
            ["space.coinGap",           space.coinGap],
            ["space.navPaddingTop",     space.navPaddingTop],
            ["space.navItemPadding",    space.navItemPadding],
            ["space.heatmapBarHeight",  space.heatmapBarHeight],
            ["space.heatmapBarGap",     space.heatmapBarGap],
          ].map(([name, value]) => (
            <SpaceRow key={name} name={name} value={value} />
          ))}
        </Section>

        {/* Border Radius */}
        <Section title="Border Radius">
          <div style={{ display: "flex", gap: "32px", flexWrap: "wrap", alignItems: "flex-start" }}>
            {Object.entries(radius).map(([name, value]) => (
              <RadiusBox key={name} name={`radius.${name}`} value={value} />
            ))}
          </div>
        </Section>

        {/* Shadows and Effects */}
        <Section title="Shadows and Effects">
          <div style={{ display: "flex", gap: space.cardGap, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div
                style={{
                  width: "180px",
                  height: "80px",
                  background: color.card,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.card,
                  ...shadow.card,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ ...T.cardTitle }}>shadow.card</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
              <div
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: radius.dot,
                  background: color.green,
                  ...shadow.liveDot,
                  animation: anim.glowPulse,
                }}
              />
              <div style={{ fontFamily: T.mono, fontSize: "10px", color: color.textMuted }}>shadow.liveDot</div>
            </div>
          </div>

          <div
            style={{
              marginTop: space.cardGap,
              padding: "24px",
              background: `linear-gradient(135deg, ${color.regimeBg}, ${color.shortBg})`,
              borderRadius: radius.card,
            }}
          >
            <div style={{ display: "flex", gap: space.cardGap, flexWrap: "wrap" }}>
              <div
                style={{
                  padding: "16px 20px",
                  background: color.card,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.card,
                  ...effect.glass,
                }}
              >
                <div style={{ ...T.cardTitle, marginBottom: "4px" }}>effect.glass</div>
                <div style={{ ...T.liveText }}>backdropFilter: blur(16px)</div>
              </div>
              <div
                style={{
                  padding: "16px 20px",
                  background: color.nav,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.card,
                  ...effect.glassNav,
                }}
              >
                <div style={{ ...T.cardTitle, marginBottom: "4px" }}>effect.glassNav</div>
                <div style={{ ...T.liveText }}>backdropFilter: blur(12px)</div>
              </div>
            </div>
          </div>
        </Section>

        {/* Composite: card */}
        <Section title="Composite: card.base + card.header">
          <div style={{ ...C.base }}>
            <div style={{ ...C.header }}>
              <span style={{ ...T.cardTitle }}>Card Header</span>
              <a href="#" style={{ ...T.cardLink }}>View all</a>
            </div>
            <div style={{ padding: space.cardBodyPadding }}>
              <p style={{ ...T.liveText }}>
                card.base wraps background, border, borderRadius, overflow, backdropFilter, and boxShadow.
                card.header adds padding, borderBottom, display flex, and alignItems center.
              </p>
            </div>
          </div>
        </Section>

        {/* Composite: row.sig */}
        <Section title="Composite: row.sig">
          <div>
            {[
              { num: "1", name: "Divergence Signal", sub: "3 wallets vs market", coin: "BTC", dir: "LONG",  ev: "4.2" },
              { num: "2", name: "Momentum Breakout",  sub: "7 wallets piling in",  coin: "ETH", dir: "SHORT", ev: "2.8" },
            ].map((item) => (
              <div key={item.num} style={{ ...R.sig }}>
                <span style={{ ...T.sigNum }}>{item.num}</span>
                <div>
                  <div style={{ ...T.sigName }}>{item.name}</div>
                  <div style={{ ...T.sigSub }}>{item.sub}</div>
                </div>
                <span style={{ ...T.sigCoinTag }}>{item.coin}</span>
                <span
                  style={{
                    ...T.sigDir,
                    background: item.dir === "LONG" ? color.longBg    : color.shortBg,
                    border:    `1px solid ${item.dir === "LONG" ? color.longBorder : color.shortBorder}`,
                    color:      item.dir === "LONG" ? color.green      : color.red,
                  }}
                >
                  {item.dir}
                </span>
                <span style={{ ...T.sigEv }}>{item.ev}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Composite: row.wallet */}
        <Section title="Composite: row.wallet">
          <div>
            {[
              { rank: "1", addr: "0x1a2b...3c4d", score: "94.2", pnl: "+$12,400" },
              { rank: "2", addr: "0x5e6f...7a8b", score: "88.7", pnl: "-$1,200" },
            ].map((item) => (
              <div
                key={item.rank}
                style={{ ...R.wallet, display: "flex", alignItems: "center", gap: "16px" }}
              >
                <span style={{ ...T.walletRank }}>{item.rank}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ ...T.walletScore }}>{item.score}</span>
                  <div style={{ ...T.walletAddr }}>{item.addr}</div>
                </div>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: item.pnl.startsWith("+") ? color.green : color.red,
                  }}
                >
                  {item.pnl}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Stat cards */}
        <Section title="Stat Card Pattern">
          <div style={{ display: "grid", gridTemplateColumns: layout.statCols, gap: space.statGap }}>
            {[
              { label: "Total Wallets", value: "1,247", sub: "+12 this week" },
              { label: "Avg Score",     value: "61.4",  sub: "cohort avg" },
              { label: "In Profit",     value: "68%",   sub: "last 30d" },
              { label: "Live Signals",  value: "9",     sub: "active now" },
            ].map((stat) => (
              <div key={stat.label} style={{ ...C.base, padding: space.cardBodyPadding }}>
                <div style={{ ...T.statLabel }}>{stat.label}</div>
                <div style={{ ...T.statValue, color: color.text }}>{stat.value}</div>
                <div style={{ ...T.statSub }}>{stat.sub}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Layout tokens */}
        <Section title="Layout Tokens">
          <div style={{ display: "flex", flexDirection: "column" }}>
            {Object.entries(layout).map(([name, value]) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  gap: "16px",
                  padding: "7px 0",
                  borderBottom: `1px solid ${color.divider}`,
                }}
              >
                <div style={{ width: "220px", fontFamily: T.mono, fontSize: "11px", color: color.textMuted }}>
                  layout.{name}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: "11px", color: color.textDim }}>
                  {String(value)}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Animation tokens */}
        <Section title="Animation Tokens">
          <div style={{ display: "flex", flexDirection: "column" }}>
            {Object.entries(anim)
              .filter(([, v]) => typeof v === "string")
              .map(([name, value]) => (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    gap: "16px",
                    padding: "7px 0",
                    borderBottom: `1px solid ${color.divider}`,
                  }}
                >
                  <div style={{ width: "220px", fontFamily: T.mono, fontSize: "11px", color: color.textMuted }}>
                    anim.{name}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: "11px", color: color.textDim }}>
                    {String(value)}
                  </div>
                </div>
              ))}
          </div>
        </Section>

      </div>
    </>
  );
}
