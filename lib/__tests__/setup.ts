// Placeholder env vars so modules can load in unit tests without real credentials.
// Pure function tests (e.g. getEquityTier) don't hit Supabase or KV at all —
// these values only need to be valid enough to satisfy the Supabase client constructor.
process.env.SUPABASE_URL = "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-role-key";
process.env.SUPABASE_ANON_KEY = "placeholder-anon-key";
process.env.KV_REST_API_URL = "https://placeholder.kv.vercel.com";
process.env.KV_REST_API_TOKEN = "placeholder-token";
process.env.KV_REST_API_READ_ONLY_TOKEN = "placeholder-readonly-token";
