/**
 * Integration over real SQL (embedded Postgres + pgvector): ingest API keys + HTTP ingestion
 * route (NDJSON and OTLP), webhook delivery with HMAC verification and delivery log,
 * incident export, readiness probe and the eval suite recorder.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite://memory";
process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS = "true";
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "opslens-uploads-"));
process.env.APP_URL = "http://opslens.test";
delete process.env.OPENAI_API_KEY;
delete process.env.AI_BASE_URL;
delete process.env.REDIS_URL;

const { db, closeDb, schema } = await import("@/db");
const { runMigrations } = await import("@/db/migrate");
const { seedDemo } = await import("@/server/demo-seed");
const { createApiKey, revokeApiKey, resolveApiKey } = await import("@/server/integrations/api-keys");
const { generateWebhookSecret, verifySignature } = await import("@/server/integrations/webhooks");
const { buildIncidentReport, incidentReportToCsv } = await import("@/server/export");
const { readiness } = await import("@/server/health");
const { runEvalSuite } = await import("@/server/evals/run");
const { POST: ingestRoute } = await import("@/app/api/v1/logs/route");
const { and, eq } = await import("drizzle-orm");

type Received = { headers: IncomingMessage["headers"]; body: string };
const received: Received[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ headers: req.headers, body });
    res.writeHead(req.url === "/fail" ? 500 : 204).end();
  });
});

let orgId: string;
let projectId: string;
let userId: string;
let hookUrl: string;
const secret = generateWebhookSecret();

beforeAll(async () => {
  await runMigrations();
  const seeded = await seedDemo(() => {});
  projectId = seeded!.project.id;
  orgId = seeded!.project.orgId;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "demo@opslens.dev"));
  userId = u.id;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
}, 180_000);

afterAll(async () => {
  server.close();
  await closeDb();
});

const post = (body: string, key: string | null, contentType = "application/x-ndjson", query = "") =>
  ingestRoute(
    new Request(`http://opslens.test/api/v1/logs${query}`, {
      method: "POST",
      headers: { "content-type": contentType, ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body,
    }),
  );

describe("ingest API keys + HTTP ingestion", () => {
  let key: string;
  let keyId: string;

  beforeAll(async () => {
    const created = await createApiKey({ orgId, projectId, name: "test key", createdBy: userId });
    key = created.key;
    keyId = created.id;
  });

  it("stores only the hash", async () => {
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, keyId));
    expect(row.keyHash).not.toContain(key);
    expect(JSON.stringify(row)).not.toContain(key.split("_")[2]);
    expect((await resolveApiKey(key))?.projectId).toBe(projectId);
  });

  it("rejects missing and wrong keys with 401", async () => {
    expect((await post('{"message":"x"}', null)).status).toBe(401);
    expect((await post('{"message":"x"}', "olk_AAAAAAAA_" + "x".repeat(43))).status).toBe(401);
  });

  it("ingests NDJSON into the key's project and opens an incident", async () => {
    // A new service, so incident detection has no open incident to attach to.
    const lines = Array.from({ length: 6 }, (_, i) =>
      JSON.stringify({ timestamp: new Date(Date.UTC(2026, 9, 1, 12, i)).toISOString(), level: "error", service: "inventory-api", message: `StockReservationError: sku ${1000 + i} lock timeout` }),
    ).join("\n");
    const res = await post(lines + "\nnot a log line", key);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mode: "inline", format: "ndjson", accepted: 6, rejected: 1 });
    expect(body.incidents).toHaveLength(1);
    const events = await db.select().from(schema.logEvents).innerJoin(schema.services, eq(schema.services.id, schema.logEvents.serviceId)).where(and(eq(schema.logEvents.projectId, projectId), eq(schema.services.name, "inventory-api")));
    expect(events).toHaveLength(6);
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, keyId));
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("ingests OTLP logs JSON", async () => {
    const otlp = {
      resourceLogs: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "otel-svc" } }] },
        scopeLogs: [{ logRecords: [
          { timeUnixNano: "1760000000000000000", severityNumber: 9, body: { stringValue: "started" } },
          { timeUnixNano: "1760000001000000000", severityText: "ERROR", body: { stringValue: "db unreachable" }, traceId: "t-1" },
        ] }],
      }],
    };
    const res = await post(JSON.stringify(otlp), key, "application/json");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ format: "otlp", accepted: 2, rejected: 0 });
    const [ev] = await db.select().from(schema.logEvents).where(eq(schema.logEvents.traceId, "t-1"));
    expect(ev.message).toBe("db unreachable");
  });

  it("revoked keys stop working immediately", async () => {
    expect(await revokeApiKey(orgId, keyId)).not.toBeNull();
    expect((await post('{"message":"x","level":"info"}', key)).status).toBe(401);
  });
});

describe("webhooks", () => {
  it("delivers a signed incident.created notification and logs the delivery", async () => {
    const [hook] = await db.insert(schema.webhooks).values({ orgId, name: "test", url: hookUrl, format: "json", secret, events: ["incident.created", "incident.status_changed"] }).returning();
    const { key } = await createApiKey({ orgId, projectId, name: "hook key", createdBy: userId });
    received.length = 0;
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ timestamp: new Date(Date.UTC(2026, 9, 2, 9, i)).toISOString(), level: "fatal", service: "ledger", message: "LedgerWriteFailed: disk full" }),
    ).join("\n");
    const res = await post(lines, key);
    expect((await res.json()).incidents).toHaveLength(1);

    expect(received).toHaveLength(1);
    const r = received[0];
    expect(r.headers["x-opslens-event"]).toBe("incident.created");
    const ts = Number(r.headers["x-opslens-timestamp"]);
    expect(verifySignature(secret, ts, r.body, String(r.headers["x-opslens-signature"]))).toBe(true);
    const payload = JSON.parse(r.body);
    expect(payload.data).toMatchObject({ service: "ledger", status: "open" });
    expect(payload.data.url).toMatch(/^http:\/\/opslens\.test\/acme\/incidents\//);

    const deliveries = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, hook.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ ok: true, statusCode: 204, event: "incident.created" });
  });

  it("records failed deliveries without throwing", async () => {
    const { deliver } = await import("@/server/integrations/webhooks");
    const [hook] = await db.insert(schema.webhooks).values({ orgId, name: "failing", url: hookUrl.replace("/hook", "/fail"), format: "slack", secret, events: ["incident.created"] }).returning();
    const d = await deliver(hook, "webhook.test", { message: "ping" });
    expect(d).toMatchObject({ ok: false, statusCode: 500, error: "HTTP 500" });
  });
});

describe("incident export", () => {
  it("builds a complete report and a CSV timeline, scoped to the org", async () => {
    const [incident] = await db.select().from(schema.incidents).where(and(eq(schema.incidents.projectId, projectId), eq(schema.incidents.status, "open"))).limit(1);
    const report = await buildIncidentReport(orgId, incident.id);
    expect(report?.incident.id).toBe(incident.id);
    expect(report?.timeline.length).toBeGreaterThan(0);
    expect(report?.errorGroups.length).toBeGreaterThan(0);
    const csv = incidentReportToCsv(report!);
    expect(csv.split("\r\n")[0]).toBe("section,timestamp,kind,detail,value");
    expect(csv).toContain("timeline,");
    expect(await buildIncidentReport("00000000-0000-0000-0000-000000000000", incident.id)).toBeNull();
  });
});

describe("readiness + evals", () => {
  it("reports the database as ready", async () => {
    const r = await readiness();
    expect(r.status).toBe("ready");
    expect(r.checks.database.ok).toBe(true);
  });

  it("runs the golden cases and records the run", async () => {
    const run = await runEvalSuite({ projectId, userId, orgId, trigger: "ci" });
    expect(run.total).toBeGreaterThanOrEqual(3);
    expect(run.passed).toBe(run.total);
    const [stored] = await db.select().from(schema.evalRuns).where(eq(schema.evalRuns.id, run.id));
    expect(stored.results.every((r) => r.investigationId)).toBe(true);
  }, 120_000);
});
