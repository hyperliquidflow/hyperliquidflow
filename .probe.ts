import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: active } = await supabase.from("wallets").select("id").eq("is_active", true).limit(5000);
  const ids = (active ?? []).map((r) => r.id as string);

  const { data: snaps } = await supabase
    .from("cohort_snapshots")
    .select("wallet_id, account_value, position_count, snapshot_time")
    .in("wallet_id", ids)
    .gte("snapshot_time", new Date(Date.now() - 6 * 3600_000).toISOString())
    .order("snapshot_time", { ascending: false })
    .limit(30000);

  const latest = new Map<string, any>();
  for (const s of snaps ?? []) if (!latest.has(s.wallet_id)) latest.set(s.wallet_id, s);

  const vals = [...latest.values()];
  const funded = vals.filter((s) => (s.account_value ?? 0) >= 10_000);
  const fundedHolding = funded.filter((s) => (s.position_count ?? 0) > 0);
  const newest = (snaps ?? [])[0]?.snapshot_time;

  console.log(`active wallets:            ${ids.length}`);
  console.log(`  funded (>= $10k):        ${funded.length}`);
  console.log(`  funded AND holding:      ${fundedHolding.length}   <-- can emit a signal`);
  console.log(`  newest snapshot:         ${newest}`);

  const { data: since } = await supabase
    .from("wallets")
    .select("id, deactivation_reason, deactivated_at")
    .gte("deactivated_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .limit(1000);
  const byReason = new Map<string, number>();
  for (const r of since ?? []) byReason.set(r.deactivation_reason ?? "(null)", (byReason.get(r.deactivation_reason ?? "(null)") ?? 0) + 1);
  console.log(`\ndeactivations in the last 30 min: ${since?.length ?? 0}`, Object.fromEntries(byReason));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
