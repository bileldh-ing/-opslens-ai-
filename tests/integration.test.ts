/**
 * End-to-end over real SQL: embedded Postgres 17 + pgvector (PGlite), the committed migrations,
 * the demo seed, log ingestion, incident detection, retrieval and the triage analyst.
 * No external services or API keys required.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite://memory";
delete process.env.OPENAI_API_KEY;
delete process.env.AI_BASE_URL;

const { db, closeDb, schema } = await import("@/db");
const { runMigrations } = await import("@/db/migrate");
const { seedDemo } = await import("@/server/demo-seed");
const { runTriage } = await import("@/server/ai/triage");
const { verifyCitations } = await import("@/server/ai/report");
const { eq } = await import("drizzle-orm");

let projectId: string;

beforeAll(async () => {
  await runMigrations();
  const seeded = await seedDemo(() => {});
  projectId = seeded!.project.id;
}, 120_000);

afterAll(() => closeDb());

describe("ingestion", () => {
  it("groups recurring errors by fingerprint", async () => {
    const groups = await db.select().from(schema.errorGroups).where(eq(schema.errorGroups.projectId, projectId));
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const timeouts = groups.find((g) => /timeout/i.test(g.title));
    expect(timeouts?.occurrences).toBeGreaterThan(10);
  });

  it("opens an incident linked to the deployment that preceded the errors", async () => {
    const incidents = await db.select().from(schema.incidents).where(eq(schema.incidents.projectId, projectId));
    const open = incidents.find((i) => i.status !== "resolved");
    expect(open).toBeDefined();
    const [dep] = await db.select().from(schema.deployments).where(eq(schema.deployments.id, open!.suspectedDeploymentId!));
    expect(dep.version).toBe("v2.14.0");
  });

  it("indexes runbooks into vector chunks", async () => {
    const chunks = await db.select({ id: schema.documentChunks.id }).from(schema.documentChunks);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe("triage analyst", () => {
  it("attributes the payment 500s to v2.14.0 with verifiable citations", async () => {
    const seen = new Set<string>();
    const raw = await runTriage({ projectId, question: "Why did payment-service start returning 500s after the last deploy?", seen });
    const { report, dropped } = verifyCitations(raw, seen);
    expect(dropped).toEqual([]);
    expect(report.status).toBe("likely_cause_found");
    expect(report.hypotheses[0].cause).toMatch(/v2\.14\.0/);
    expect(report.hypotheses[0].evidence.map((e) => e.type)).toEqual(expect.arrayContaining(["deployment", "log"]));
    expect(report.remediations.some((r) => r.kind === "suggested_fix" && /v2\.13\.0/.test(r.title))).toBe(true);
  });

  it("admits it does not know when there is no data", async () => {
    const seen = new Set<string>();
    const report = await runTriage({ projectId, question: "Why is search-indexer leaking memory?", seen });
    expect(report.status).toBe("insufficient_data");
    expect(report.hypotheses).toHaveLength(0);
  });

  it("never reads another tenant's data", async () => {
    const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: "other" }).returning();
    const [other] = await db.insert(schema.projects).values({ orgId: otherOrg.id, name: "P", slug: "p" }).returning();
    const report = await runTriage({ projectId: other.id, question: "payment-service 500s", seen: new Set() });
    expect(report.status).toBe("insufficient_data");
  });
});
