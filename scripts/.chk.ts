import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  console.log("now UTC:", new Date().toISOString());
  const { count: active } = await s.from("wallets").select("*", { count: "exact", head: true }).eq("is_active", true);
  const { data: scan } = await s.from("wallets").select("last_scanned_at")
    .not("last_scanned_at", "is", null).order("last_scanned_at", { ascending: false }).limit(1);
  console.log("active:", active, " last scan write:", scan?.[0]?.last_scanned_at);
  const { data: d } = await s.from("wallets").select("deactivation_reason")
    .gte("deactivated_at", new Date(Date.now() - 6 * 3600_000).toISOString()).limit(5000);
  const m = new Map<string, number>();
  for (const r of d ?? []) m.set(r.deactivation_reason ?? "(null)", (m.get(r.deactivation_reason ?? "(null)") ?? 0) + 1);
  console.log("deactivations last 6h:", d?.length ?? 0, Object.fromEntries(m));
  const { data: ids } = await s.from("wallets").select("id").eq("is_active", true).limit(5000);
  const { data: sn } = await s.from("cohort_snapshots")
    .select("wallet_id, account_value, position_count")
    .in("wallet_id", (ids ?? []).map(r => r.id))
    .gte("snapshot_time", new Date(Date.now() - 2 * 3600_000).toISOString())
    .order("snapshot_time", { ascending: false }).limit(40000);
  const latest = new Map<string, { account_value: number; position_count: number }>();
  for (const x of sn ?? []) if (!latest.has(x.wallet_id)) latest.set(x.wallet_id, x);
  const v = [...latest.values()];
  console.log(`funded AND holding: ${v.filter(x => (x.account_value ?? 0) >= 10000 && (x.position_count ?? 0) > 0).length}`);
  console.log(`zero equity:        ${v.filter(x => (x.account_value ?? 0) <= 0).length}`);
}
main().catch((e: Error) => { console.error(e.message); process.exit(1); });
