import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/lib/env";
import { createLogger, clientIp } from "@/lib/logger";
import { checkLoginAllowed, LOGIN_LIMITS, recordLoginFailure, recordLoginSuccess, checkSignupAllowed } from "@/lib/login-guard";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";
import { isPublicPath } from "@/proxy";

describe("env validation", () => {
  it("applies zero-config defaults", () => {
    const env = parseEnv({});
    expect(env.DATABASE_URL).toBe("pglite://.data/opslens");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.ALLOW_PRIVATE_WEBHOOK_TARGETS).toBe(false);
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ REDIS_URL: "", OPENAI_API_KEY: "" }).REDIS_URL).toBeUndefined();
  });

  it("reports every invalid variable in one readable error", () => {
    try {
      parseEnv({ DATABASE_URL: "mysql://x", REDIS_URL: "http://nope", APP_URL: "not a url" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const err = e as EnvError;
      expect(err.issues.join("\n")).toMatch(/DATABASE_URL/);
      expect(err.issues.join("\n")).toMatch(/REDIS_URL/);
      expect(err.issues.join("\n")).toMatch(/APP_URL/);
      expect(err.message).toMatch(/\.env\.example/);
    }
  });

  it("refuses private webhook targets on a public production deployment", () => {
    expect(() => parseEnv({ NODE_ENV: "production", APP_URL: "https://ops.example.com", ALLOW_PRIVATE_WEBHOOK_TARGETS: "true" })).toThrow(EnvError);
    expect(parseEnv({ NODE_ENV: "production", APP_URL: "http://localhost:3000", ALLOW_PRIVATE_WEBHOOK_TARGETS: "true" }).ALLOW_PRIVATE_WEBHOOK_TARGETS).toBe(true);
  });
});

describe("structured logger", () => {
  it("writes one JSON object per line with base and child fields", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "info", sink: (l) => lines.push(l) }).child({ requestId: "req-123" });
    log.debug("hidden");
    log.info("hello", { userId: "u1" });
    log.error("boom", { err: new Error("bad") });
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ level: "info", msg: "hello", service: "opslens", requestId: "req-123", userId: "u1" });
    expect(new Date(first.timestamp).getTime()).not.toBeNaN();
    expect(JSON.parse(lines[1]).err).toMatchObject({ name: "Error", message: "bad" });
  });

  it("takes the first X-Forwarded-For hop as client IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("login brute-force guard", () => {
  it("blocks one IP hammering one account after 5 failures, and only failures count", async () => {
    const ip = "198.51.100.1";
    const email = "victim@example.com";
    const now = Date.now();
    for (let i = 0; i < 10; i++) expect((await checkLoginAllowed(ip, email, now)).allowed).toBe(true); // checks alone don't count
    for (let i = 0; i < LOGIN_LIMITS.ipAccount.limit; i++) await recordLoginFailure(ip, email, now);
    const blocked = await checkLoginAllowed(ip, email, now);
    expect(blocked).toMatchObject({ allowed: false, reason: "ip_account" });
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    // Window slides.
    expect((await checkLoginAllowed(ip, email, now + LOGIN_LIMITS.ipAccount.windowMs + 1)).allowed).toBe(true);
  });

  it("blocks a distributed attack on one account across many IPs", async () => {
    const email = "target@example.com";
    const now = Date.now();
    for (let i = 0; i < LOGIN_LIMITS.account.limit; i++) await recordLoginFailure(`192.0.2.${i}`, email, now);
    expect(await checkLoginAllowed("192.0.2.250", email, now)).toMatchObject({ allowed: false, reason: "account" });
  });

  it("blocks credential stuffing from one IP across many accounts", async () => {
    const ip = "198.51.100.99";
    const now = Date.now();
    for (let i = 0; i < LOGIN_LIMITS.ip.limit; i++) await recordLoginFailure(ip, `user${i}@example.com`, now);
    expect(await checkLoginAllowed(ip, "fresh@example.com", now)).toMatchObject({ allowed: false, reason: "ip" });
  });

  it("a successful login clears the ip+account window", async () => {
    const ip = "198.51.100.2";
    const email = "me@example.com";
    for (let i = 0; i < 4; i++) await recordLoginFailure(ip, email);
    await recordLoginSuccess(ip, email);
    for (let i = 0; i < 4; i++) await recordLoginFailure(ip, email);
    expect((await checkLoginAllowed(ip, email)).allowed).toBe(true);
  });

  it("limits sign-ups per IP", async () => {
    const now = Date.now();
    for (let i = 0; i < LOGIN_LIMITS.signupIp.limit; i++) expect((await checkSignupAllowed("203.0.113.50", now)).allowed).toBe(true);
    expect((await checkSignupAllowed("203.0.113.50", now)).allowed).toBe(false);
  });
});

describe("security headers", () => {
  it("locks down framing, sniffing and origins", () => {
    const csp = contentSecurityPolicy({ dev: false });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ dev: true })).toContain("unsafe-eval");
    const headers = Object.fromEntries(securityHeaders({ dev: false, https: true }).map((h) => [h.key, h.value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(securityHeaders({ dev: false, https: false }).some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });

  it("proxy keeps PWA assets and health endpoints public, everything else gated", () => {
    for (const p of ["/", "/login", "/offline", "/sw.js", "/manifest.webmanifest", "/icons/icon-192.png", "/api/health"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/acme", "/acme/incidents", "/acme/settings"]) expect(isPublicPath(p)).toBe(false);
  });
});
