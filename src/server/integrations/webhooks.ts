import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { randomToken } from "@/lib/utils";

/**
 * Outbound notifications. Each delivery is a POST with:
 *   X-OpsLens-Event, X-OpsLens-Delivery (uuid), X-OpsLens-Timestamp (unix seconds),
 *   X-OpsLens-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${body}`)>
 * Receivers verify the signature and reject stale timestamps (replay protection).
 * `format: "slack"` sends a Slack incoming-webhook compatible body ({ text, blocks }).
 */
export const WEBHOOK_EVENTS = ["incident.created", "incident.status_changed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "webhook.test";
export type WebhookFormat = "json" | "slack";

export type IncidentPayload = {
  id: string;
  title: string;
  severity: string;
  status: string;
  service: string | null;
  project: string;
  url: string;
  previousStatus?: string;
  changedBy?: string;
};

export function generateWebhookSecret() {
  return `whsec_${randomToken(24)}`;
}

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Reference verifier (also used by scripts/webhook-receiver.ts). Rejects signatures older than toleranceSec. */
export function verifySignature(secret: string, timestamp: number, body: string, signature: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(nowSec - timestamp) > toleranceSec) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const SEVERITY_EMOJI: Record<string, string> = { sev1: "🔴", sev2: "🟠", sev3: "🟡", sev4: "🔵" };

export function buildBody(format: WebhookFormat, event: WebhookEvent, data: IncidentPayload | { message: string }, deliveryId: string, occurredAt: Date) {
  if (format === "json") return { id: deliveryId, event, occurredAt: occurredAt.toISOString(), data };
  if (!("id" in data)) return { text: `OpsLens: ${data.message}` };
  const headline =
    event === "incident.created"
      ? `${SEVERITY_EMOJI[data.severity] ?? "⚪"} New ${data.severity.toUpperCase()} incident: ${data.title}`
      : `Incident ${data.previousStatus ?? ""} → ${data.status}: ${data.title}`;
  return {
    text: headline,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${headline}*` } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `${data.project} · ${data.service ?? "unknown service"}${data.changedBy ? ` · by ${data.changedBy}` : ""} · <${data.url}|Open in OpsLens>` }],
      },
    ],
  };
}

/* ---------------- SSRF guard ---------------- */

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export class WebhookUrlError extends Error {}

/** Only http(s) URLs whose host does not resolve to a loopback/private/link-local address. */
export async function assertSafeWebhookUrl(raw: string, allowPrivate = env().ALLOW_PRIVATE_WEBHOOK_TARGETS): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError("Enter a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new WebhookUrlError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new WebhookUrlError("Credentials in the URL are not allowed.");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new WebhookUrlError("Private or loopback hosts are not allowed.");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new WebhookUrlError("The host could not be resolved.");
  if (addresses.some(isPrivateAddress)) throw new WebhookUrlError("Private or loopback hosts are not allowed.");
  return url;
}

/* ---------------- Delivery ---------------- */

type Hook = typeof schema.webhooks.$inferSelect;

export async function deliver(hook: Hook, event: WebhookEvent, data: IncidentPayload | { message: string }, timeoutMs = 5000) {
  const deliveryId = randomUUID();
  const occurredAt = new Date();
  const payload = buildBody(hook.format as WebhookFormat, event, data, deliveryId, occurredAt);
  const body = JSON.stringify(payload);
  const ts = Math.floor(occurredAt.getTime() / 1000);
  const start = performance.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    await assertSafeWebhookUrl(hook.url); // re-check at send time: DNS can change after creation
    const res = await fetch(hook.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        "user-agent": "OpsLens-Webhooks/1.0",
        "x-opslens-event": event,
        "x-opslens-delivery": deliveryId,
        "x-opslens-timestamp": String(ts),
        "x-opslens-signature": signPayload(hook.secret, ts, body),
      },
      body,
    });
    statusCode = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
    await res.body?.cancel().catch(() => {});
  } catch (e) {
    error = e instanceof Error ? (e.name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : e.message) : String(e);
  }
  const durationMs = Math.round(performance.now() - start);
  const ok = error === null;
  const [row] = await db
    .insert(schema.webhookDeliveries)
    .values({ webhookId: hook.id, event, ok, statusCode, durationMs, error, payload: payload as Record<string, unknown> })
    .returning();
  if (!ok) logger.warn("webhook delivery failed", { webhookId: hook.id, event, statusCode, error });
  return row;
}

/** Fan out an event to every enabled webhook of the org subscribed to it. Never throws. */
export async function notify(orgId: string, event: (typeof WEBHOOK_EVENTS)[number], data: IncidentPayload) {
  try {
    const hooks = await db
      .select()
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.enabled, true)));
    const targets = hooks.filter((h) => h.events.includes(event));
    return await Promise.all(targets.map((h) => deliver(h, event, data)));
  } catch (e) {
    logger.error("webhook fan-out failed", { orgId, event, err: e });
    return [];
  }
}

/** Builds the incident payload (with deep link) for a set of incident ids. */
export async function incidentPayloads(ids: string[]): Promise<Array<{ orgId: string; payload: IncidentPayload }>> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: schema.incidents.id,
      title: schema.incidents.title,
      severity: schema.incidents.severity,
      status: schema.incidents.status,
      service: schema.services.name,
      project: schema.projects.name,
      orgId: schema.organizations.id,
      orgSlug: schema.organizations.slug,
    })
    .from(schema.incidents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.incidents.projectId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .leftJoin(schema.services, eq(schema.services.id, schema.incidents.serviceId))
    .where(inArray(schema.incidents.id, ids));
  const base = env().APP_URL.replace(/\/$/, "");
  return rows.map((r) => ({
    orgId: r.orgId,
    payload: { id: r.id, title: r.title, severity: r.severity, status: r.status, service: r.service, project: r.project, url: `${base}/${r.orgSlug}/incidents/${r.id}` },
  }));
}

export async function listWebhooks(orgId: string) {
  const hooks = await db.select().from(schema.webhooks).where(eq(schema.webhooks.orgId, orgId)).orderBy(desc(schema.webhooks.createdAt));
  const deliveries = hooks.length
    ? await db
        .select()
        .from(schema.webhookDeliveries)
        .where(inArray(schema.webhookDeliveries.webhookId, hooks.map((h) => h.id)))
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(25)
    : [];
  return { hooks, deliveries };
}
