import { liveness } from "@/server/health";

export const dynamic = "force-dynamic";

/** Liveness probe: the process is up and serving. Never touches dependencies. */
export function GET() {
  return Response.json(liveness(), { headers: { "Cache-Control": "no-store" } });
}
