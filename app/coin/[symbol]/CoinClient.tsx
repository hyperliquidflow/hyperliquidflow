"use client";
// app/coin/[symbol]/CoinClient.tsx
// One coin, one screen. Exchange facts first, then where the cohort sits in it.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { formatUsd, formatPct, truncateAddress } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { DeepDivePayload } from "@/app/api/deep-dive/route";
import { color, card as C, type as T, space, radius } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  title: { ...T.cardTitle },
  muted: { fontSize: "13px", color: color.textMuted },
  th: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase" as const, color: color.textMuted,
    padding: "10px 16px", textAlign: "left" as const, userSelect: "none" as const,
    whiteSpace: "nowrap" as const,
  },
  td: {
    fontSize: "13px", padding: "10px 16px",
    borderTop: `1px solid ${color.divider}`, whiteSpace: "nowrap" as const,
  },
  mono: { fontFamily: "'Geist Mono', monospace", fontSize: "13px" },
};

function num(v: string | undefined | null): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** One compact label and value, used for the exchange facts strip. */
function Fact({ label, value, clr }: { label: string; value: string; clr?: string }) {
  return (
    <div>
      <div style={{ ...T.statLabel }}>{label}</div>
      <div style={{
        fontSize: "16px", fontWeight: 700, marginTop: "5px",
        fontVariantNumeric: "tabular-nums", color: clr ?? color.text,
      }}>
        {value}
      </div>
    </div>
  );
}

export function CoinClient({ coin, initialData }: { coin: string; initialData: DeepDivePayload | null }) {
  const router = useRouter();

  const { data } = useQuery<DeepDivePayload>({
    queryKey:        ["deep-dive", coin],
    queryFn:         () => fetch(`/api/deep-dive?coin=${encodeURIComponent(coin)}`).then((r) => r.json()),
    initialData:     initialData ?? undefined,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const ctx      = data?.ctx ?? null;
  const exposure = data?.cohortExposure ?? null;
  const holders  = data?.holders ?? [];

  const mark    = num(ctx?.markPx);
  const prev    = num(ctx?.prevDayPx);
  const change  = prev > 0 ? (mark - prev) / prev : 0;
  const fundNow = num(ctx?.funding) * 100;

  const hist = data?.fundingHistory ?? [];
  const fundAvg = hist.length > 0
    ? (hist.reduce((s, f) => s + num(f.fundingRate), 0) / hist.length) * 100
    : null;

  const longN  = exposure?.long_notional  ?? 0;
  const shortN = exposure?.short_notional ?? 0;
  const sided  = longN + shortN;
  const longShare = sided > 0 ? (longN / sided) * 100 : 0;

  return (
    <div className="page-enter">
      <PageHeader
        title={coin}
        subtitle={ctx ? `Mark ${mark >= 1000 ? mark.toLocaleString("en-US", { maximumFractionDigits: 0 }) : mark.toFixed(mark >= 1 ? 2 : 4)} on Hyperliquid` : "Loading market data"}
      />

      <div style={{ ...S.page, paddingTop: space.contentPaddingTop, display: "flex", flexDirection: "column", gap: space.cardGap }}>

        {/* Exchange facts. Anyone can verify these against the exchange. */}
        <div style={{ ...S.card, padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "20px" }}>
          <Fact label="24h" value={ctx ? `${change >= 0 ? "+" : ""}${formatPct(change)}` : "--"}
                clr={ctx ? (change >= 0 ? color.green : color.red) : color.textMuted} />
          <Fact label="Open Interest" value={ctx ? formatUsd(num(ctx.openInterest) * mark) : "--"} />
          <Fact label="24h Volume"    value={ctx ? formatUsd(num(ctx.dayNtlVlm)) : "--"} />
          <Fact label="Funding 1h"    value={ctx ? `${fundNow >= 0 ? "+" : ""}${fundNow.toFixed(4)}%` : "--"}
                clr={ctx ? (fundNow >= 0 ? color.green : color.red) : color.textMuted} />
          <Fact label="Funding avg"   value={fundAvg != null ? `${fundAvg >= 0 ? "+" : ""}${fundAvg.toFixed(4)}%` : "--"}
                clr={fundAvg == null ? color.textMuted : fundAvg >= 0 ? color.green : color.red} />
        </div>

        {/* Where the tracked cohort sits. Descriptive, not a recommendation. */}
        <div style={S.card}>
          <div style={{ ...S.hdr }}>
            <span style={S.title}>Tracked Cohort</span>
            <span style={{ ...T.cardLink, marginLeft: "auto", cursor: "default" }}>
              {exposure ? `${exposure.wallet_count} wallets holding` : "none holding"}
            </span>
          </div>
          {exposure ? (
            <div style={{ padding: space.cardBodyPadding, display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                <span style={{
                  fontSize: "26px", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                  color: exposure.direction === "LONG" ? color.green : exposure.direction === "SHORT" ? color.red : color.text,
                }}>
                  {exposure.direction}
                </span>
                <span style={{ fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color.text }}>
                  {formatUsd(Math.abs(exposure.net_notional))}
                </span>
                <span style={S.muted}>net</span>
              </div>
              <div style={{ height: "6px", background: color.barBg, borderRadius: radius.bar, overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${longShare}%`,       background: color.green }} />
                <div style={{ width: `${100 - longShare}%`, background: color.red }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontSize: "13px", color: color.green }}>{formatUsd(longN)} long</span>
                <span style={{ fontSize: "13px", color: color.red }}>{formatUsd(shortN)} short</span>
              </div>
            </div>
          ) : (
            <div style={{ padding: space.cardBodyPadding, ...S.muted }}>No tracked wallet holds {coin} right now.</div>
          )}
        </div>

        {/* Who holds it, biggest first. */}
        {holders.length > 0 && (
          <div style={S.card}>
            <div style={S.hdr}><span style={S.title}>Holders</span></div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Wallet", "Score", "Side", "Notional", "Entry", "Open PnL"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holders.map((h, i) => (
                  <tr key={`${h.address}-${i}`}>
                    <td style={S.td}>
                      <button onClick={() => router.push(`/wallets/discovery?address=${h.address}`)}
                        style={{ ...S.mono, color: color.neutral, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        {truncateAddress(h.address)}
                      </button>
                    </td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{h.score.toFixed(2)}</td>
                    <td style={{ ...S.td, color: h.direction === "LONG" ? color.green : color.red, fontWeight: 700 }}>{h.direction}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{formatUsd(h.notional)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{h.entry_px >= 1 ? h.entry_px.toFixed(2) : h.entry_px.toFixed(4)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", color: h.unrealized_pnl >= 0 ? color.green : color.red }}>
                      {formatUsd(h.unrealized_pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
