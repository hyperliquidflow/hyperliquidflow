"use client";
// app/portfolio/journal/JournalClient.tsx
//
// The paper journal for the positioning factor. It shows what the book is
// holding today and how it has done on data that did not exist when the idea
// was formed, which is the only evidence that can settle the question.
//
// Two things this page refuses to do. It never shows a verdict before the
// pre-registered horizon, and it always prints the return that would be
// expected at this many days if the backtest effect were real, so an early
// reading below one is understood as a short record rather than a failure.

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { color, card as C, type as T, space, radius } from "@/lib/design-tokens";

interface Holding {
  coin:          string;
  leg:           "long" | "short";
  lean_notional: number;
  entry_price:   number;
  resolved:      boolean;
  return_pct:    number | null;
}

interface HistoryDay {
  date:         string;
  net_bps:      number;
  gross_bps:    number;
  replaced:     number;
  coins_ranked: number;
  equity_pct:   number;
}

interface Journal {
  as_of:           string | null;
  coins_ranked:    number;
  holding:         Holding[];
  days_scored:     number;
  checkpoint_days: number;
  confirm_days:    number;
  expected_t_now:  number | null;
  mean_bps:        number | null;
  trimmed_bps:     number | null;
  t_stat:          number | null;
  win_rate:        number | null;
  cumulative_pct:  number;
  history:         HistoryDay[];
}

const S = {
  page:     { padding: space.pagePaddingX, paddingBottom: space.contentPaddingBot },
  stats:    { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: space.statGap, marginBottom: space.cardGap },
  stat:     { ...C.base, padding: space.cardBodyPadding },
  statVal:  { ...T.statValue, fontFamily: T.mono },
  cols:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.cardGap, alignItems: "start" },
  card:     { ...C.base },
  head:     { ...C.header },
  title:    { ...T.cardTitle },
  body:     { padding: space.cardBodyPadding },
  row:      { display: "grid", gridTemplateColumns: "70px 1fr auto", alignItems: "center", gap: "12px", padding: space.sigRowPadding, borderBottom: `1px solid ${color.divider}` },
  pill:     { fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: radius.dirPill, letterSpacing: "0.04em", textAlign: "center" as const },
  coin:     { ...T.sigCoinTag },
  num:      { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" as const, fontSize: "13px" },
  lean:     { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" as const, fontSize: "11px", color: color.textMuted },
  note:     { fontSize: "13px", color: color.textMuted, lineHeight: 1.6, padding: space.cardBodyPadding, paddingTop: 0 },
  empty:    { fontSize: "13px", color: color.textMuted, padding: space.cardBodyPadding },
  hRow:     { display: "grid", gridTemplateColumns: "1fr auto auto", gap: "12px", padding: "9px 20px", borderBottom: `1px solid ${color.divider}`, alignItems: "center" },
  hDate:    { fontSize: "13px", color: color.textMuted, fontFamily: T.mono },
};

const bps = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
const usd = (v: number) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(Math.abs(v) / 1000)}k`;

export function JournalClient() {
  const { data, isLoading } = useQuery<Journal>({
    queryKey:        ["factor-journal"],
    queryFn:         () => fetch("/api/factor-journal").then((r) => r.json()),
    staleTime:       60_000,
    refetchInterval: 60_000,
  });

  const longs  = data?.holding.filter((h) => h.leg === "long")  ?? [];
  const shorts = data?.holding.filter((h) => h.leg === "short") ?? [];
  const scored = data?.days_scored ?? 0;
  const checkpoint = data?.checkpoint_days ?? 60;

  return (
    <div>
      <PageHeader
        title="Paper Journal"
        subtitle="What the positioning book holds each day, and how it has done on data it has never seen. Paper only."
      />

      <div style={S.page}>
        <div style={S.stats}>
          <div style={S.stat}>
            <div style={T.statLabel}>Days recorded</div>
            <div style={S.statVal}>{scored}</div>
            <div style={T.statSub}>first check at {checkpoint}</div>
          </div>
          <div style={S.stat}>
            <div style={T.statLabel}>Average day</div>
            <div style={{ ...S.statVal, color: (data?.mean_bps ?? 0) >= 0 ? color.green : color.red }}>
              {data?.mean_bps == null ? "--" : bps(data.mean_bps)}
            </div>
            <div style={T.statSub}>bps, after all costs</div>
          </div>
          <div style={S.stat}>
            <div style={T.statLabel}>Cumulative</div>
            <div style={{ ...S.statVal, color: (data?.cumulative_pct ?? 0) >= 0 ? color.green : color.red }}>
              {data ? `${data.cumulative_pct >= 0 ? "+" : ""}${data.cumulative_pct.toFixed(2)}%` : "--"}
            </div>
            <div style={T.statSub}>compounded, paper</div>
          </div>
          <div style={S.stat}>
            <div style={T.statLabel}>Days won</div>
            <div style={S.statVal}>
              {data?.win_rate == null ? "--" : `${Math.round(data.win_rate * 100)}%`}
            </div>
            <div style={T.statSub}>near half is normal here</div>
          </div>
        </div>

        {/* Reading guide. A short record looks like failure unless you know
            what a real effect would look like at this length. */}
        <div style={{ ...S.card, marginBottom: space.cardGap }}>
          <div style={S.head}><span style={S.title}>How to read this</span></div>
          <div style={S.note}>
            {scored === 0 ? (
              <>The record starts the day it starts. Nothing here is evidence yet, and
              the first real checkpoint is {checkpoint} days away.</>
            ) : (
              <>
                Signal strength so far is {data?.t_stat == null ? "--" : data.t_stat.toFixed(2)}
                {data?.expected_t_now != null && (
                  <> against {data.expected_t_now.toFixed(2)} expected at {scored} day
                  {scored === 1 ? "" : "s"} if the effect is real</>
                )}
                . A reading below the expectation this early means the record is short,
                not that the idea failed. The first honest check is at {checkpoint} days,
                and the traded book is not expected to look convincing before
                day {data?.confirm_days ?? 283}.
              </>
            )}
          </div>
        </div>

        <div style={S.cols}>
          <div style={S.card}>
            <div style={S.head}>
              <span style={S.title}>Holding now</span>
              <span style={{ ...T.cardLink, fontFamily: T.mono }}>
                {data?.as_of ?? (isLoading ? "" : "no record yet")}
              </span>
            </div>
            {longs.length === 0 && shorts.length === 0 ? (
              <div style={S.empty}>
                {isLoading ? "Loading." : "Nothing recorded yet. The book is written once a day."}
              </div>
            ) : (
              <div>
                {[...longs, ...shorts].map((h) => (
                  <div key={h.coin} style={S.row}>
                    <div style={{
                      ...S.pill,
                      background: h.leg === "long" ? color.longBg : color.shortBg,
                      border: `1px solid ${h.leg === "long" ? color.longBorder : color.shortBorder}`,
                      color: h.leg === "long" ? color.green : color.red,
                    }}>
                      {h.leg === "long" ? "LONG" : "SHORT"}
                    </div>
                    <div>
                      <span style={S.coin}>{h.coin}</span>
                      <div style={S.lean}>cohort lean {usd(h.lean_notional)}</div>
                    </div>
                    <div style={{
                      ...S.num,
                      color: h.return_pct == null
                        ? color.textMuted
                        : h.return_pct >= 0 ? color.green : color.red,
                    }}>
                      {h.return_pct == null ? "open" : `${h.return_pct >= 0 ? "+" : ""}${h.return_pct.toFixed(2)}%`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={S.head}><span style={S.title}>Day by day</span></div>
            {(data?.history.length ?? 0) === 0 ? (
              <div style={S.empty}>
                {isLoading ? "Loading." : "No completed days yet. Each day resolves the next."}
              </div>
            ) : (
              <div>
                {[...(data?.history ?? [])].reverse().slice(0, 30).map((d) => (
                  <div key={d.date} style={S.hRow}>
                    <span style={S.hDate}>{d.date}</span>
                    <span style={{ ...S.num, color: d.net_bps >= 0 ? color.green : color.red }}>
                      {bps(d.net_bps)} bps
                    </span>
                    <span style={{ ...S.num, color: color.textMuted, width: "62px", textAlign: "right" }}>
                      {d.equity_pct >= 0 ? "+" : ""}{d.equity_pct.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
