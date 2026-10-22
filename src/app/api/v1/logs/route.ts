import { jsonError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { requestLogger } from "@/lib/logger";
import { storage } from "@/lib/storage";
import { parseBearer, resolveApiKey } from "@/server/integrations/api-keys";
import { bodyToLogText } from "@/server/ingest/otlp";
import { enqueue } from "@/server/jobs/queue";

export const dynamic = "force-dynamic";
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * HTTP log ingestion, authenticated with a project ingest key:
 *   Authorization: Bearer olk_xxxxxxxx_...
 * Accepts NDJSON / plain text lines, a JSON array (or { logs: [...] }), or OTLP logs JSON.
 * See docs/ingest-api.md.
 */
export async function POST(req: Request) {
  const log = requestLogger(req);
  const key = await resolveApiKey(parseBearer(req.headers.get("authorization")));
  if (!key) return jsonError(401, "Missing or invalid ingest key. Send `Authorization: Bearer olk_...`.");
  if (!key.scopes.includes("logs:write")) return jsonError(403, "This key cannot write logs.");

  const rl = await rateLimit(`ingest-key:${key.keyId}`, 120, 60_000);
  if (!rl.allowed) {
    return Response.json({ error: "Rate limit exceeded (120 requests/min per key)." }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } });
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return jsonError(413, "Payload too large (5 MB max per request).");
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) return jsonError(413, "Payload too large (5 MB max per request).");
  if (!raw.trim()) return jsonError(400, "Empty body.");

  let normalized: ReturnType<typeof bodyToLogText>;
  try {
    normalized = bodyToLogText(raw, req.headers.get("content-type") ?? "");
  } catch {
    return jsonError(400, "Body is not valid OTLP logs JSON.");
  }
  if (!normalized.text.trim()) return jsonError(400, "No log records found in body.");

  const service = new URL(req.url).searchParams.get("service") ?? undefined;
  const storageKey = await storage.put(`logs/${key.projectId}`, `http-${normalized.format}.jsonl`, Buffer.from(normalized.text));
  const job = await enqueue("ingest-logs", { projectId: key.projectId, storageKey, service });
  log.info("logs ingested over http", { keyId: key.keyId, projectId: key.projectId, format: normalized.format, bytes: raw.length, mode: job.mode });

  const result = (job.result ?? null) as { accepted: number; rejected: number; errorGroups: number; incidents: string[] } | null;
  return Response.json(
    { jobId: job.jobId, mode: job.mode, format: normalized.format, ...(result ?? {}) },
    { status: job.mode === "queued" ? 202 : 200 },
  );
}
