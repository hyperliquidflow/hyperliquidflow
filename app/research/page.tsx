// app/research/page.tsx
// The honest record. What this project has established, what it has killed, and
// what is still open. Static by design: these are conclusions, not a live feed.

import { PageHeader } from "@/components/page-header";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  hdr:   { ...C.header },
  title: { ...T.cardTitle },
  muted: { fontSize: "13px", color: color.textMuted, lineHeight: 1.6 },
  th: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase" as const, color: color.textMuted,
    padding: "10px 16px", textAlign: "left" as const, whiteSpace: "nowrap" as const,
  },
  td: {
    fontSize: "13px", padding: "11px 16px",
    borderTop: `1px solid ${color.divider}`, verticalAlign: "top" as const,
  },
};

type State = "supported" | "dead" | "running";

const STATE_STYLE: Record<State, { label: string; clr: string; bg: string; border: string }> = {
  supported: { label: "SUPPORTED", clr: color.green,   bg: color.longBg,      border: color.longBorder },
  dead:      { label: "DEAD",      clr: color.red,     bg: color.shortBg,     border: color.shortBorder },
  running:   { label: "RUNNING",   clr: color.amber,   bg: color.neutralBg,   border: color.neutralBorder },
};

const FINDINGS: Array<{ claim: string; state: State; evidence: string }> = [
  {
    claim:    "Wallet ranking picks better wallets",
    state:    "supported",
    evidence: "Rank IC 0.0939, clean of lookahead. A wallet's score predicts its own forward returns.",
  },
  {
    claim:    "The forward positioning record",
    state:    "running",
    evidence: "Started 12 Aug 2026, resolves daily at 03:00 UTC, first powered checkpoint at day 60. No verdict is reported before then.",
  },
  {
    claim:    "Cohort positioning predicts next-day returns",
    state:    "dead",
    evidence: "Cross-sectional IC 0.0185, t 0.70 across 385 wallets. It read 0.0653 on a 112-wallet slice, and did not survive going deeper into the same band.",
  },
  {
    claim:    "Trading that positioning as a long-short book",
    state:    "dead",
    evidence: "29.6 bps a day at t 1.33 against a pre-registered bar of 2.5, full costs including funding.",
  },
  {
    claim:    "Copying entries and holding one to three days",
    state:    "dead",
    evidence: "9.2 bps at the 48h hold, t 0.4, negative trimmed mean, and split halves that disagree in sign at every long hold.",
  },
  {
    claim:    "Copying entries at short holds",
    state:    "dead",
    evidence: "Negative at every hold tested, including at zero latency. Lateness was never the problem.",
  },
  {
    claim:    "Copying exits",
    state:    "dead",
    evidence: "Negative at every hold and monotonically worse as the hold lengthens, reaching -48.8 bps at 48h.",
  },
  {
    claim:    "Higher-scored wallets pick better entries to copy",
    state:    "dead",
    evidence: "Pre-registered contrast of -30.6 bps a day, t -1.98. The spread is negative, not merely absent.",
  },
  {
    claim:    "Wallets acting together carry more signal",
    state:    "dead",
    evidence: "No dose-response across cluster sizes one to five.",
  },
];

export default function ResearchPage() {
  return (
    <div className="page-enter">
      <PageHeader
        title="What We Know"
        subtitle="Every claim this project has tested, including the ones that failed"
      />

      <div style={{ ...S.page, paddingTop: space.contentPaddingTop, display: "flex", flexDirection: "column", gap: space.cardGap }}>

        <div style={{ ...S.card, padding: space.cardBodyPadding }}>
          <div style={S.muted}>
            This product reports where tracked wallets are positioned. It does not claim that copying
            them makes money, because that was tested and it does not. Thresholds were written down
            before each run, and results are reported against the written bar rather than a reframed
            one. Negative results are kept here for the same reason the positive ones are.
          </div>
        </div>

        <div style={S.card}>
          <div style={S.hdr}><span style={S.title}>The Record</span></div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={S.th}>Claim</th>
                <th style={S.th}>State</th>
                <th style={S.th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {FINDINGS.map((f) => {
                const st = STATE_STYLE[f.state];
                return (
                  <tr key={f.claim}>
                    <td style={{ ...S.td, fontWeight: 600, color: color.text }}>{f.claim}</td>
                    <td style={S.td}>
                      <span style={{
                        fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em",
                        padding: "3px 9px", borderRadius: "4px",
                        background: st.bg, color: st.clr, border: `1px solid ${st.border}`,
                        whiteSpace: "nowrap" as const,
                      }}>
                        {st.label}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: color.textMuted, lineHeight: 1.6 }}>{f.evidence}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ ...S.card, padding: space.cardBodyPadding, marginBottom: space.contentPaddingBot }}>
          <div style={{ ...S.title, marginBottom: "10px" }}>How these were measured</div>
          <div style={S.muted}>
            Costs charged at the verified taker fee of 4.5 bps a side plus 5 bps slippage, with
            funding charged path-wise over the hold. Standard errors clustered by day, because thirty
            coins on one falling afternoon are close to one observation. Multi-day holds use
            non-overlapping windows. Wallet pools are frozen to each wallet&apos;s own post-discovery
            history, so no result uses a wallet before it was knowable.
          </div>
        </div>

      </div>
    </div>
  );
}
