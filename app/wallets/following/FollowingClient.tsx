"use client";
import { useQuery } from "@tanstack/react-query";
import { useFollowedWallets } from "@/lib/hooks/use-followed-wallets";
import { useAlertEvents } from "@/lib/hooks/use-alert-events";
import { FollowButton } from "@/components/follow-button";
import { PageHeader } from "@/components/page-header";
import { formatUsd, truncateAddress } from "@/lib/utils";
import type { CohortCachePayload } from "@/app/api/refresh-cohort/route";
import { color, card as C, type as T, space } from "@/lib/design-tokens";

const S = {
  page:  { padding: space.pagePaddingX },
  card:  { ...C.base },
  empty: { padding: "48px 20px", textAlign: "center" as const, color: color.textMuted, fontSize: "13px" },
  row: {
    padding:      "14px 20px",
    borderBottom: `1px solid ${color.divider}`,
    display:      "flex",
    alignItems:   "center",
    gap:          "12px",
    transition:   "background 0.12s",
  },
  addr: { ...T.walletAddr, flex: 1 },
  meta: { fontSize: "11px", color: color.textFaint, marginTop: "2px" },
  stat: { fontSize: "13px", fontVariantNumeric: "tabular-nums", color: color.textMuted, flexShrink: 0 as const },
};

export function FollowingClient() {
  const { wallets } = useFollowedWallets();
  const { unseenCount } = useAlertEvents();
  const { data } = useQuery<CohortCachePayload>({
    queryKey:        ["cohort-state"],
    queryFn:         () => fetch("/api/cohort-state").then(r => r.json()),
    staleTime:       55_000,
    refetchInterval: 60_000,
  });

  const walletMap = new Map(data?.top_wallets.map(w => [w.address, w]) ?? []);

  const subtitle = wallets.length === 0
    ? "Follow wallets to track their positions"
    : `${wallets.length} wallet${wallets.length === 1 ? "" : "s"} followed${unseenCount > 0 ? `, ${unseenCount} unseen alert${unseenCount === 1 ? "" : "s"}` : ""}`;

  return (
    <div className="page-enter">
      <PageHeader title="Following" subtitle={subtitle} />
      <div style={{ ...S.page, paddingTop: "20px" }}>
        <div style={S.card}>
          {wallets.length === 0 ? (
            <div style={S.empty}>
              No wallets followed. Use the Follow button on the Leaderboard to get started.
            </div>
          ) : (
            wallets.map(fw => {
              const w = walletMap.get(fw.address);
              return (
                <div key={fw.address} style={S.row}
                  onMouseEnter={e => (e.currentTarget.style.background = color.rowHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.addr}>
                      {fw.label ? `${fw.label} (${truncateAddress(fw.address)})` : truncateAddress(fw.address)}
                    </div>
                    <div style={S.meta}>
                      Alerts: {fw.alert_on.join(", ")}{fw.paper_copy ? ", paper copy on" : ""}
                    </div>
                  </div>
                  {w && (
                    <>
                      <span style={{ ...S.stat, color: w.unrealized_pnl >= 0 ? color.green : color.red }}>
                        {formatUsd(w.unrealized_pnl)}
                      </span>
                      <span style={S.stat}>{w.position_count} pos</span>
                    </>
                  )}
                  <FollowButton address={fw.address} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
