// scripts/bootstrap-hypurrscan-index.ts
// One-time: register all wallets in the Hypurrscan tracking index.
// Run via: npx tsx scripts/bootstrap-hypurrscan-index.ts
//
// Rate limit: /addAddress costs weight 1. Budget: 1000/min.
// With 1200 wallets and a 70ms delay between calls, the full run takes ~90s.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL             = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HYPURRSCAN_API_URL       = process.env.HYPURRSCAN_API_URL ?? "https://api.hypurrscan.io";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 70ms between calls = ~857 req/min, well under the 1000 weight/min budget.
const DELAY_MS = 70;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function addAddress(address: string): Promise<string> {
  const res = await fetch(`${HYPURRSCAN_API_URL}/addAddress/${address}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${address}: ${await res.text()}`);
  }
  const body = await res.text();
  return body.replace(/^"|"$/g, ""); // strip JSON string quotes if present
}

async function main(): Promise<void> {
  const { data: wallets, error } = await supabase
    .from("wallets")
    .select("address");

  if (error) throw new Error(`Supabase error: ${error.message}`);
  if (!wallets || wallets.length === 0) {
    console.log("No wallets found, nothing to register.");
    return;
  }

  console.log(`Registering ${wallets.length} wallets with Hypurrscan...`);

  let added = 0;
  let alreadyThere = 0;
  let failed = 0;

  for (let i = 0; i < wallets.length; i++) {
    const { address } = wallets[i];
    try {
      const result = await addAddress(address);
      if (result === "Added") {
        added++;
      } else {
        alreadyThere++;
      }
    } catch (err) {
      console.error(`[${i + 1}/${wallets.length}] FAILED ${address}: ${err}`);
      failed++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`[${i + 1}/${wallets.length}] added=${added} already=${alreadyThere} failed=${failed}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(
    `Done. Total: ${wallets.length}, Added: ${added}, Already indexed: ${alreadyThere}, Failed: ${failed}`
  );
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
