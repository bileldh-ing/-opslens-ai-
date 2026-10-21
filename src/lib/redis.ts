import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/** Redis is optional: without REDIS_URL, rate limiting is in-process and jobs run inline. */
export const redisConfigured = Boolean(process.env.REDIS_URL);

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return globalForRedis.redis;
}
