// lib/env.ts
// Validates all required environment variables at module load time.
// Import this at the top of any server-side module that needs env vars.
// Throws at startup if variables are missing so failures are loud and early.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // During `next build` (static analysis), env vars aren't available — skip the throw.
    // At runtime (actual requests), missing vars will still throw.
    if (process.env.NEXT_PHASE === "phase-production-build") return "";
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `Check your .env.local file or Vercel/GitHub project settings.`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// ── Server-only variables (never exposed to the browser) ──────────────────────

/** Supabase project URL, e.g. https://xxxx.supabase.co */
export const SUPABASE_URL = requireEnv("SUPABASE_URL");

/**
 * Supabase service-role key — bypasses RLS.
 * Used only in server routes and scripts. NEVER send to the client.
 */
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

/** Supabase anonymous key — safe for client-side queries with RLS. */
export const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");

/** Vercel KV REST API URL */
export const KV_REST_API_URL = requireEnv("KV_REST_API_URL");

/** Vercel KV REST API write token */
export const KV_REST_API_TOKEN = requireEnv("KV_REST_API_TOKEN");

/** Vercel KV REST API read-only token */
export const KV_REST_API_READ_ONLY_TOKEN = requireEnv("KV_REST_API_READ_ONLY_TOKEN");

// ── Configurable variables with safe defaults ────────────────────────────────

/** Hyperliquid info endpoint. Override in tests to point at a mock server. */
export const HYPERLIQUID_API_URL = optionalEnv(
  "HYPERLIQUID_API_URL",
  "https://api.hyperliquid.xyz/info"
);

/** Client-side polling interval in milliseconds. Default 60 seconds. */
export const POLL_INTERVAL_MS = parseInt(
  optionalEnv("NEXT_PUBLIC_POLL_INTERVAL_MS", "60000"),
  10
);

/** Vercel Cron secret (optional) – set if you want to restrict cron calls */
export const CRON_SECRET = process.env.CRON_SECRET ?? "";
