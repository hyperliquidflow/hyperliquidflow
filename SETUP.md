# HyperliquidFLOW — Setup Guide

## Prerequisites
- Node.js 20+
- A free Supabase account (supabase.com)
- A free Vercel account (vercel.com)
- A GitHub account (repo must be PUBLIC for free Actions minutes)

---

## Step 1 — Install dependencies

```bash
cd /Users/ahimsa/Documents/Lakshmi
npm install
```

---

## Step 2 — Supabase setup

1. Create a new Supabase project at supabase.com
2. Go to **SQL Editor** and run the two migration files IN ORDER:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_wallet_metrics.sql`
3. Go to **Settings → API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 3 — Vercel setup

1. Push this repo to GitHub (make it **public**)
2. Import the project at vercel.com
3. In Vercel dashboard → **Storage** → Create a KV store → Link it to your project
   - Vercel auto-populates `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`
4. Add environment variables in Vercel → Settings → Environment Variables:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   HYPERLIQUID_API_URL=https://api.hyperliquid.xyz/info
   NEXT_PUBLIC_POLL_INTERVAL_MS=60000
   ```
5. Deploy. The `vercel.json` cron job runs `/api/refresh-cohort` every 60 seconds automatically.

---

## Step 4 — GitHub Actions setup (daily wallet scan)

1. In your GitHub repo → **Settings → Secrets and variables → Actions**
2. Add these secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `HYPERLIQUID_API_URL` (= `https://api.hyperliquid.xyz/info`)
3. The workflow at `.github/workflows/daily-wallet-scan.yml` runs at **02:00 UTC daily**
4. To test manually: **Actions → Daily Wallet Scan → Run workflow**

---

## Step 5 — Local development

Create `.env.local` (copy from `.env.example` and fill in your values):

```bash
cp .env.example .env.local
# edit .env.local with your credentials
npm run dev
```

Open http://localhost:3000

---

## Free Tier Limits (as of build date)

| Service       | Usage              | Free Limit          | Status    |
|---------------|--------------------|---------------------|-----------|
| GitHub Actions| ~180 min/month     | 2,000 min (public)  | ✅ Safe   |
| Supabase DB   | ~50-100 MB         | 500 MB              | ✅ Safe   |
| Vercel KV     | ~2,880 cmds/day    | 3,000/day           | ✅ Safe   |
| Vercel Cron   | 1 job, 60s         | 1 job free          | ✅ Safe   |
| Vercel Serverless | ~2s/invocation | 10s timeout         | ✅ Safe   |

**Important:** Supabase pauses after 7 days of inactivity. The daily GitHub Actions scan counts as activity — keep it enabled.

---

## Dashboard Pages

| URL           | Description                                    |
|---------------|------------------------------------------------|
| `/`           | Overview: regime, cohort health, top signals   |
| `/wallets`    | Full Whale Report: top 500 wallets by score    |
| `/signals`    | Signal Feed: all 9 recipes, live, filterable   |
| `/contrarian` | Smart Money vs. Rekt Money + Smart Trade Plan  |
| `/deep-dive`  | Single Token Deep Dive: candles, funding, OI   |
| `/stalker`    | Wallet Stalker: any address → full history     |
| `/morning`    | Morning Alpha Scan: daily briefing             |
| `/recipes`    | Recipe Lab: performance stats for all 9 recipes|
| `/scanner`    | Discovery status, scan pipeline, top wallets   |

---

## First Run Checklist

- [ ] Migrations 001 + 002 run in Supabase
- [ ] Env vars set in Vercel
- [ ] KV store linked in Vercel
- [ ] GitHub secrets set
- [ ] Deployed to Vercel
- [ ] Manually trigger GitHub Actions scan (to seed wallet data)
- [ ] Visit `/scanner` to verify pipeline status
- [ ] Visit `/` and wait up to 60s for first cron refresh

---

## Notes

- The leaderboard endpoint `{ "type": "leaderboard" }` is unverified. Check the scan logs in GitHub Actions → Artifacts → `scan-summary.json` after the first run.
- If the leaderboard API fails, the scrape fallback activates. Check `/scanner` for discovery source.
- "Smart Trade Plan" on the Contrarian page is rule-based (ATR levels + Kelly sizing) — not an LLM.
