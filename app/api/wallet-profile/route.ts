// app/api/wallet-profile/route.ts
// On-demand wallet lookup for the Stalker page.
// Fetches live state + 30d fills and computes verdict.

import { NextRequest, NextResponse } from "next/server";
import {
  fetchClearinghouseState,
  fetchUserFillsByTime,
  closingFills,
} from "@/lib/hyperliquid-api-client";
import { computeBacktest } from "@/lib/cohort-engine";
import { isValidAddress } from "@/lib/utils";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const address = req.nextUrl.searchParams.get("address") ?? "";

  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const [state, fills] = await Promise.all([
      fetchClearinghouseState(address),
      fetchUserFillsByTime(address, thirtyDaysAgo, Date.now()),
    ]);

    const bt = computeBacktest(fills);

    // Verdict logic
    let verdict = "Inconclusive";
    let verdict_color = "#9ca3af";
    if (bt.total_trades < 10) {
      verdict = "Insufficient Data (<10 trades)";
      verdict_color = "#9ca3af";
    } else if (bt.win_rate >= 0.65 && bt.profit_factor >= 2) {
      verdict = "Elite Trader, Strong Edge Detected";
      verdict_color = "#6aaa7a";
    } else if (bt.win_rate >= 0.52 && bt.total_pnl_usd > 0) {
      verdict = "Smart Money, Consistent Performer";
      verdict_color = "#60a5fa";
    } else if (bt.total_pnl_usd > 0 && bt.win_rate < 0.52) {
      verdict = "Risky but Profitable, High Avg Win";
      verdict_color = "#f59e0b";
    } else {
      verdict = "Underperformer, Exercise Caution";
      verdict_color = "#b06868";
    }

    const closing = closingFills(fills);

    return NextResponse.json({
      address,
      state: state.marginSummary,
      positions: state.assetPositions.map((ap) => ({ ...ap.position })),
      fills30d: fills.slice(0, 100).map((f) => ({
        coin: f.coin, side: f.side, px: f.px, sz: f.sz,
        closedPnl: f.closedPnl, time: f.time, dir: f.dir,
      })),
      stats: {
        win_rate:       bt.win_rate,
        trade_count:    bt.total_trades,
        total_pnl:      bt.total_pnl_usd,
        avg_win:        bt.avg_win_usd,
        avg_loss:       bt.avg_loss_usd,
        profit_factor:  bt.profit_factor > 999 ? 999 : bt.profit_factor,
        current_streak: bt.current_win_streak > 0 ? bt.current_win_streak : bt.current_loss_streak,
        is_win_streak:  bt.current_win_streak > 0,
      },
      verdict,
      verdict_color,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
