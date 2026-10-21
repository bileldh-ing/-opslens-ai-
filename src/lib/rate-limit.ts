import { getRedis } from "./redis";

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
