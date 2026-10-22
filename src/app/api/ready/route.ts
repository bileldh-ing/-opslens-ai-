import { readiness } from "@/server/health";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Readiness probe: 200 when the database (and Redis, if configured) respond, else 503. */
export async function GET(req: Request) {
  const result = await readiness();
  if (result.status !== "ready") {
    logger.warn("readiness check failed", { checks: result.checks, requestId: req.headers.get("x-request-id") ?? undefined });
  }
  // Driver error strings stay in the logs, not in the unauthenticated response.
  const checks = Object.fromEntries(Object.entries(result.checks).map(([k, v]) => [k, { ok: v.ok, latencyMs: v.latencyMs }]));
  return Response.json({ ...result, checks }, { status: result.status === "ready" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
