// lib/auth/cron.ts
import { timingSafeEqual } from "node:crypto";
import { CRON_SECRET } from "@/lib/env";

export function verifyCronAuth(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
