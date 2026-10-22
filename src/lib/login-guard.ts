import { peekRateLimit, rateLimit, resetRateLimit } from "./rate-limit";

/**
 * Brute-force protection for sign-in. Only FAILED attempts count, in three independent windows:
 *  - per IP + account: one attacker hammering one account (5 failures / 15 min)
 *  - per IP: credential stuffing across many accounts from one address (30 failures / 15 min)
 *  - per account: a distributed attack on one account from many IPs (20 failures / hour)
 * Any exhausted window blocks further attempts until it slides. Redis-backed when REDIS_URL is set.
 */
export const LOGIN_LIMITS = {
  ipAccount: { limit: 5, windowMs: 15 * 60_000 },
  ip: { limit: 30, windowMs: 15 * 60_000 },
  account: { limit: 20, windowMs: 60 * 60_000 },
  signupIp: { limit: 5, windowMs: 60 * 60_000 },
} as const;

export type GuardReason = "ip_account" | "ip" | "account";
export type GuardResult = { allowed: boolean; retryAfterSec: number; reason?: GuardReason };

function keys(ip: string, email: string): Array<[GuardReason, string, { limit: number; windowMs: number }]> {
  const e = email.trim().toLowerCase();
  return [
    ["ip_account", `login:ipacct:${ip}:${e}`, LOGIN_LIMITS.ipAccount],
    ["ip", `login:ip:${ip}`, LOGIN_LIMITS.ip],
    ["account", `login:acct:${e}`, LOGIN_LIMITS.account],
  ];
}

export async function checkLoginAllowed(ip: string, email: string, now = Date.now()): Promise<GuardResult> {
  for (const [reason, key, l] of keys(ip, email)) {
    const r = await peekRateLimit(key, l.limit, l.windowMs, now);
    if (!r.allowed) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(r.resetMs / 1000)), reason };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function recordLoginFailure(ip: string, email: string, now = Date.now()): Promise<void> {
  for (const [, key, l] of keys(ip, email)) await rateLimit(key, Number.MAX_SAFE_INTEGER, l.windowMs, now);
}

/** A successful login clears the per-IP+account window (not the account-wide one). */
export async function recordLoginSuccess(ip: string, email: string): Promise<void> {
  await resetRateLimit(keys(ip, email)[0][1]);
}

export async function checkSignupAllowed(ip: string, now = Date.now()): Promise<GuardResult> {
  const r = await rateLimit(`signup:ip:${ip}`, LOGIN_LIMITS.signupIp.limit, LOGIN_LIMITS.signupIp.windowMs, now);
  return r.allowed ? { allowed: true, retryAfterSec: 0 } : { allowed: false, retryAfterSec: Math.ceil(r.resetMs / 1000), reason: "ip" };
}
