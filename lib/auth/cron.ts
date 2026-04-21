// lib/auth/cron.ts
import { timingSafeEqual } from "node:crypto";
import { CRON_SECRET } from "@/lib/env";

/**
 * Verify a cron-endpoint request. Returns true in non-production (dev/test
 * convenience); in production, does a timing-safe compare of the Authorization
 * header against `Bearer ${CRON_SECRET}`.
 */
export function verifyCronAuth(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
