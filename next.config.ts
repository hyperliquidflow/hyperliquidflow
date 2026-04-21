import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Vercel cron jobs call this route – allow unauthenticated GET/POST from Vercel infra
  async headers() {
    return [
      {
        source: "/api/refresh-cohort",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/api/cohort-state",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/api/market-ticker",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/api/signals-feed",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
