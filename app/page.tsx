"use client";
// app/page.tsx — Overview page
// Shows: regime banner, cohort health metrics, top 5 signals, quick stats.

import { useQuery } from "@tanstack/react-query";
import { formatUsd, formatPct, timeAgo, truncateAddress } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { QueryProvider } from "@/components/query-provider";

// ── Regime colours (template-grey palette) ────────────────────────────────────
const REGIME_STYLES = {
  BULL:    { color: "#6aaa7a", bg: "rgba(106,170,122,0.07)", label: "BULLISH" },
  BEAR:    { color: "#b06868", bg: "rgba(176,104,104,0.07)", label: "BEARISH" },
  RANGING: { color: "#9ca3af", bg: "rgba(156,163,175,0.07)", label: "RANGING" },
};

const RECIPE_LABELS: Record<string, string> = {
  momentum_stack:       "Momentum Stack",
  divergence_squeeze:   "Divergence Squeeze",
  accumulation_reentry: "Accumulation Re-Entry",
  rotation_carry:       "Rotation Carry",
  liq_rebound:          "Liq Rebound",
  streak_continuation:  "Streak Continuation",
  funding_divergence:   "Funding Divergence",
  whale_validated:      "Whale Validated",
  anti_whale_trap:      "Anti-Whale Trap",
};

// ── Styles (mirror template-grey tokens) ─────────────────────────────────────
const S = {
  page:    { padding: "28px", maxWidth: "1400px", margin: "0 auto" },
  card:    { background: "rgba(14,14,14,0.65)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", overflow: "hidden" as const, boxShadow: "0 4px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)" },
  hdr:     { borderBottom: "1px solid rgba(180,180,180,0.06)", padding: "16px 20px", display: "flex", alignItems: "center", gap: "8px" },
  label:   { fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.44)" },
  val:     { fontSize: "22px", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const },
  small:   { fontSize: "11px", color: "rgba(255,255,255,0.69)" },
  muted:   { color: "rgba(255,255,255,0.44)", fontSize: "11px" },
  mono:    { fontFamily: "var(--font-mono)", fontSize: "11px" },
};

function OverviewInner() {
  const { data, isLoading, error } = useQuery<CohortCachePayload>({
    queryKey: ["cohort-state"],
    queryFn: () => fetch("/api/cohort-state").then((r) => r.json()),
    refetchInterval: parseInt(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "60000"),
    staleTime: 55_000,
  });

  const regime = data?.regime ?? "RANGING";
  const rs = REGIME_STYLES[regime];

  if (isLoading) return <LoadingState />;
  if (error)     return <ErrorState message={String(error)} />;
  if (!data)     return null;

  const totalAv = data.top_wallets.reduce((s, w) => s + w.account_value, 0);
  const totalPnl = data.top_wallets.reduce((s, w) => s + w.unrealized_pnl, 0);
  const avgScore = data.top_wallets.length > 0
    ? data.top_wallets.reduce((s, w) => s + w.overall_score, 0) / data.top_wallets.length
    : 0;

  return (
    <div style={S.page}>
      {/* ── Regime Banner ── */}
      <div style={{
        ...S.card,
        background: rs.bg,
        border: `1px solid ${rs.color}22`,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: rs.color, boxShadow: `0 0 8px ${rs.color}` }} />
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: rs.color }}>{rs.label}</div>
            <div style={S.muted}>Market regime · BTC 24h: {data.btc_return_24h >= 0 ? "+" : ""}{formatPct(data.btc_return_24h)}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={S.small}>Updated {timeAgo(data.updated_at)}</div>
          <div style={S.muted}>{data.wallet_count} wallets active</div>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
        {[
          { label: "Active Cohort",     value: `${data.wallet_count}`,           sub: "wallets tracked" },
          { label: "Total Book Value",  value: formatUsd(totalAv),               sub: "across cohort" },
          { label: "Unrealised PnL",    value: formatUsd(totalPnl), color: totalPnl >= 0 ? "#6aaa7a" : "#b06868", sub: "open positions" },
          { label: "Avg Cohort Score",  value: avgScore.toFixed(2),              sub: "out of 1.00" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{ ...S.card, padding: "20px" }}>
            <div style={S.label}>{label}</div>
            <div style={{ ...S.val, color: color ?? "#f0f0f0", marginTop: "8px" }}>{value}</div>
            <div style={{ ...S.muted, marginTop: "4px" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Two-column: signals + top wallets ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Recent Signals */}
        <div style={S.card}>
          <div style={S.hdr}>
            <span style={S.label}>Recent Signals</span>
            <a href="/signals" style={{ marginLeft: "auto", fontSize: "11px", color: "rgba(255,255,255,0.44)", textDecoration: "none" }}>View all →</a>
          </div>
          <div>
            {data.recent_signals.slice(0, 6).map((sig, i) => (
              <div key={i} style={{
                padding: "12px 20px",
                borderBottom: "1px solid rgba(180,180,180,0.06)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}>
                <DirectionDot direction={sig.direction} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#f0f0f0" }}>
                    {RECIPE_LABELS[sig.recipe_id] ?? sig.recipe_id} · {sig.coin}
                  </div>
                  <div style={S.muted}>{timeAgo(sig.detected_at)}</div>
                </div>
                {sig.ev_score != null && (
                  <div style={{ fontSize: "11px", color: "#606060", fontWeight: 600 }}>
                    EV {(sig.ev_score * 100).toFixed(0)}
                  </div>
                )}
              </div>
            ))}
            {data.recent_signals.length === 0 && (
              <div style={{ padding: "32px 20px", textAlign: "center", ...S.muted }}>
                No signals yet — waiting for next refresh cycle
              </div>
            )}
          </div>
        </div>

        {/* Top Wallets */}
        <div style={S.card}>
          <div style={S.hdr}>
            <span style={S.label}>Top Wallets by Score</span>
            <a href="/wallets" style={{ marginLeft: "auto", fontSize: "11px", color: "rgba(255,255,255,0.44)", textDecoration: "none" }}>Full report →</a>
          </div>
          <div>
            {data.top_wallets.slice(0, 6).map((w, i) => (
              <div key={w.wallet_id} style={{
                padding: "12px 20px",
                borderBottom: "1px solid rgba(180,180,180,0.06)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.32)", width: "16px", flexShrink: 0 }}>{i + 1}</span>
                <a href={`/stalker?address=${w.address}`} style={{ ...S.mono, color: "#9ca3af", textDecoration: "none", flex: 1 }}>
                  {truncateAddress(w.address)}
                </a>
                <ScoreBar score={w.overall_score} />
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#f0f0f0", width: "36px", textAlign: "right" }}>
                  {w.overall_score.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DirectionDot({ direction }: { direction: string | null }) {
  const color = direction === "LONG" ? "#6aaa7a" : direction === "SHORT" ? "#b06868" : "#6b7280";
  return <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div style={{ width: "60px", height: "3px", background: "rgba(180,180,180,0.1)", borderRadius: "2px", flexShrink: 0 }}>
      <div style={{
        width: `${score * 100}%`,
        height: "100%",
        background: score >= 0.7 ? "#6aaa7a" : score >= 0.5 ? "#606060" : "#b06868",
        borderRadius: "2px",
        transition: "width 0.3s",
      }} />
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ ...S.page, display: "flex", flexDirection: "column", gap: "12px" }}>
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ ...S.card, height: "80px", opacity: 0.4 }} />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ ...S.page }}>
      <div style={{ ...S.card, padding: "32px", textAlign: "center", color: "#b06868" }}>
        Failed to load data: {message}
      </div>
    </div>
  );
}

// ── Export with provider ──────────────────────────────────────────────────────
export default function OverviewPage() {
  return (
    <QueryProvider>
      <OverviewInner />
    </QueryProvider>
  );
}
