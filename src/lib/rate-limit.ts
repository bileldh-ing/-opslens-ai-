import { getRedis, redisConfigured } from "./redis";

export type RateLimitResult = { allowed: boolean; remaining: number; resetMs: number };

/**
 * Sliding-window rate limiter backed by a Redis sorted set.
 * Atomic via MULTI so concurrent requests cannot both slip through.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  if (!redisConfigured) return memoryRateLimit(key, limit, windowMs, now);
  const redis = getRedis();
  const redisKey = `rl:${key}`;
  const member = `${now}-${Math.random().toString(36).slice(2)}`;
  const res = await redis
    .multi()
    .zremrangebyscore(redisKey, 0, now - windowMs)
    .zadd(redisKey, now, member)
    .zcard(redisKey)
    .pexpire(redisKey, windowMs)
    .exec();
  const count = Number(res?.[2]?.[1] ?? 0);
  if (count > limit) {
    await redis.zrem(redisKey, member);
    return { allowed: false, remaining: 0, resetMs: windowMs };
  }
  return { allowed: true, remaining: Math.max(0, limit - count), resetMs: windowMs };
}

// Shared across Next.js server bundles in one process (route handlers and actions are separate module graphs).
const g = globalThis as unknown as { __opslensRateWindows?: Map<string, number[]> };
const windows = (g.__opslensRateWindows ??= new Map<string, number[]>());

/** Same sliding-window semantics, in process memory. For single-instance local runs only. */
export function memoryRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const hits = (windows.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return { allowed: false, remaining: 0, resetMs: hits[0] + windowMs - now };
  }
  hits.push(now);
  windows.set(key, hits);
  return { allowed: true, remaining: limit - hits.length, resetMs: windowMs };
}

/** Counts hits in the window without recording a new one. */
export async function peekRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  if (!redisConfigured) {
    const hits = (windows.get(key) ?? []).filter((t) => t > now - windowMs);
    windows.set(key, hits);
    return hits.length >= limit
      ? { allowed: false, remaining: 0, resetMs: hits[0] + windowMs - now }
      : { allowed: true, remaining: limit - hits.length, resetMs: windowMs };
  }
  const redis = getRedis();
  const redisKey = `rl:${key}`;
  await redis.zremrangebyscore(redisKey, 0, now - windowMs);
  const count = await redis.zcard(redisKey);
  return count >= limit ? { allowed: false, remaining: 0, resetMs: windowMs } : { allowed: true, remaining: limit - count, resetMs: windowMs };
}

/** Clears a window (e.g. after a successful login). */
export async function resetRateLimit(key: string): Promise<void> {
  if (!redisConfigured) {
    windows.delete(key);
    return;
  }
  await getRedis().del(`rl:${key}`);
}
