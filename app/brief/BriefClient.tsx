"use client";
// app/brief/BriefClient.tsx

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { color, card as C, type as T, space, radius } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header, gap: "12px" },
  label: { ...T.cardTitle },
  muted: { color: color.textMuted, fontSize: "13px" },
  body:  { fontSize: "13px", color: "rgba(255,255,255,0.82)", lineHeight: 1.7 },
};

const bone = (w: string | number, h = 9): React.CSSProperties => ({
  height: h, width: w, borderRadius: 3, background: "rgba(255,255,255,0.07)", flexShrink: 0,
});
const ghost = (delay = 0): React.CSSProperties => ({
  animation: `slide-up-ghost 2.4s ease-in-out ${delay}s infinite`,
});

interface MorningScan {
  generated_at: string;
  regime: string;
  btc_return_24h: number;
  top_movers: Array<{ coin: string; notional: string; direction: string }>;
  top_signals: Array<{ recipe: string; coin: string; direction: string; ev: number | null }>;
  cohort_health: { active_wallets: number; avg_score: number; wallets_in_profit: number };
  top_wallets: Array<{ address: string; score: number; pnl: string }>;
  summary: string;
  watch_list: string[];
}

export function BriefClient({ initialData }: { initialData: unknown }) {
  const { data } = useQuery<MorningScan>({
    queryKey:        ["daily-scan"],
    queryFn:         () => fetch("/api/daily-scan").then((r) => r.json()),
    initialData:     initialData as MorningScan ?? undefined,
    placeholderData: keepPreviousData,
    staleTime:       5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  return (
    <>
      <PageHeader
        title="Daily Brief"
        subtitle={data ? `Generated daily at 00:00 UTC · ${timeAgo(data.generated_at)}` : "Generated daily at 00:00 UTC"}
      />
      <div style={{ ...S.page, paddingTop: "20px" }}>

        {/* Summary card */}
        <div style={{ ...S.card, padding: "20px 24px", marginBottom: "16px" }}>
          <div style={{ ...S.label, marginBottom: "12px" }}>Daily Briefing</div>
          {data ? (
            <p style={S.body}>{data.summary}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, ...ghost() }}>
              {["95%", "88%", "78%", "55%"].map((w, i) => (
                <div key={i} style={bone(w, 10)} />
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
          {/* Smart Money Health */}
          <div style={S.card}>
            <div style={S.hdr}><span style={S.label}>Smart Money Health</span></div>
            <div style={{ padding: "16px 20px" }}>
              {["Active Wallets", "Avg Score", "Wallets in Profit"].map((label, i) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={S.muted}>{label}</span>
                  {data ? (
                    <span style={{ fontSize: "13px", fontWeight: 600 }}>
                      {i === 0 ? data.cohort_health.active_wallets : i === 1 ? data.cohort_health.avg_score.toFixed(2) : data.cohort_health.wallets_in_profit}
                    </span>
                  ) : (
                    <div style={bone(40, 11)} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Watch List */}
          <div style={S.card}>
            <div style={S.hdr}><span style={S.label}>Today&apos;s Watch List</span></div>
            <div style={{ padding: "16px 20px", display: "flex", flexWrap: "wrap" as const, gap: "8px" }}>
              {data ? (
                data.watch_list.map((coin) => (
                  <span key={coin} className="ios-pill" style={{ padding: "5px 12px", fontSize: "11px" }}>
                    {coin}
                  </span>
                ))
              ) : (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ height: 28, width: 44 + (i % 3) * 10, borderRadius: 7, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Top Signals */}
        <div style={{ ...S.card, marginBottom: "16px" }}>
          <div style={S.hdr}><span style={S.label}>Top Signals Yesterday</span></div>
          {!data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ ...ghost(i * 0.14), padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                <div style={bone(90, 10)} />
                <div style={bone(36, 10)} />
                <div style={bone(32, 8)} />
                <div style={{ ...bone(28), marginLeft: "auto" }} />
              </div>
            ))
          ) : data.top_signals.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", ...S.muted }}>No signals in the last 24h</div>
          ) : (
            data.top_signals.map((sig, i) => {
              const dirColor = sig.direction === "LONG" ? color.green : sig.direction === "SHORT" ? color.red : color.neutral;
              return (
                <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "7px", height: "7px", borderRadius: radius.dot, background: dirColor, flexShrink: 0 }} />
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>{sig.recipe}</span>
                  <span style={{ ...T.sigCoinTag }}>{sig.coin}</span>
                  <span style={{ ...T.sigDir,
                    background: sig.direction === "LONG" ? color.longBg : sig.direction === "SHORT" ? color.shortBg : color.neutralBg,
                    color: dirColor,
                    border: `1px solid ${sig.direction === "LONG" ? color.longBorder : sig.direction === "SHORT" ? color.shortBorder : color.neutralBorder}`,
                  }}>{sig.direction}</span>
                  {sig.ev != null && (
                    <span style={{ marginLeft: "auto", fontSize: "11px", color: color.textMuted, fontWeight: 600 }}>EV {(sig.ev * 100).toFixed(0)}</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Top Movers */}
        <div style={S.card}>
          <div style={S.hdr}><span style={S.label}>Top Smart Money Movers (24h)</span></div>
          {!data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ ...ghost(i * 0.14), padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={bone(44, 12)} />
                <div style={{ height: 20, width: 52, borderRadius: 5, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                <div style={{ ...bone(60), marginLeft: "auto" }} />
              </div>
            ))
          ) : (
            data.top_movers.map((m, i) => {
              const dirColor = m.direction === "LONG" ? color.green : color.red;
              return (
                <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700 }}>{m.coin}</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: "4px",
                    background: m.direction === "LONG" ? color.longBg : color.shortBg,
                    color: dirColor,
                    border: `1px solid ${m.direction === "LONG" ? color.longBorder : color.shortBorder}` }}>
                    {m.direction}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "13px", fontVariantNumeric: "tabular-nums" }}>{m.notional}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
