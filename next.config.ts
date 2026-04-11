import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel cron jobs call this route – allow unauthenticated GET/POST from Vercel infra
  async headers() {
    return [
      {
        source: "/api/refresh-cohort",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
