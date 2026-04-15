// Runtime recipe parameter reader. Recipes call getRecipeConfig() instead of
// using hardcoded constants. KV cache (5 min TTL) keeps reads fast.
// Supabase agent_config table is the source of truth.

import { kv } from "@vercel/kv";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const KV_TTL = 300; // 5 minutes

export async function getRecipeConfig(
  recipeId: string
): Promise<Record<string, number>> {
  const cacheKey = `recipe:config:${recipeId}`;

  const cached = await kv.get<Record<string, number>>(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("agent_config")
    .select("param_name, param_value")
    .eq("recipe_id", recipeId);

  if (error || !data) {
    console.error(`[recipe-config] failed to load ${recipeId}:`, error?.message);
    return {};
  }

  const config = Object.fromEntries(
    data.map((r) => [r.param_name, r.param_value] as const)
  );
  await kv.set(cacheKey, config, { ex: KV_TTL });
  return config;
}

/**
 * Snapshot all configs for a list of recipe IDs at signal-fire time.
 * Returns a plain object suitable for storing as signal_events.active_config.
 */
export async function snapshotAllConfigs(
  recipeIds: string[]
): Promise<Record<string, Record<string, number>>> {
  const entries = await Promise.all(
    recipeIds.map(async (id) => [id, await getRecipeConfig(id)] as const)
  );
  return Object.fromEntries(entries);
}

/**
 * Invalidate KV cache for a recipe. Call after agent_config is updated.
 */
export async function invalidateRecipeConfig(recipeId: string): Promise<void> {
  await kv.del(`recipe:config:${recipeId}`);
}
