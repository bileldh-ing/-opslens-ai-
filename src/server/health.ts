import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getRedis, redisConfigured } from "@/lib/redis";

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.npm_package_version ?? "dev";

export type CheckResult = { ok: boolean; latencyMs: number; error?: string };

async function timed(fn: () => Promise<unknown>, timeoutMs: number): Promise<CheckResult> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return { ok: false, latencyMs: Math.round(performance.now() - start), error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Readiness: can we serve traffic? The database must answer; Redis too when configured. */
export async function readiness(timeoutMs = 3000) {
  const checks: Record<string, CheckResult> = {
    database: await timed(() => db.execute(sql`select 1`), timeoutMs),
  };
  if (redisConfigured) checks.redis = await timed(() => getRedis().ping(), timeoutMs);
  const ok = Object.values(checks).every((c) => c.ok);
  return { status: ok ? ("ready" as const) : ("unavailable" as const), version: APP_VERSION, checks };
}

export function liveness() {
  return { status: "ok" as const, version: APP_VERSION, uptimeSec: Math.round(process.uptime()) };
}
