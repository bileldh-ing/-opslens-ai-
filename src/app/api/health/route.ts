export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Liveness probe: the process is up and serving. Deliberately imports nothing that touches
 * the database or Redis, so a slow dependency never gets a healthy container restarted.
 */
export function GET() {
  return Response.json(
    { status: "ok", version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev", uptimeSec: Math.round((Date.now() - startedAt) / 1000) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
