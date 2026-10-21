/**
 * Demo workspace: user demo@opslens.dev / opslens-demo-123, org "acme", the payment-service
 * 500s scenario (logs + deployments), a resolved past incident, and indexed runbooks/postmortems.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { db, schema } from "@/db";
import { ingestLogs, indexDocument } from "@/server/ingest/pipeline";
import { embedText } from "@/server/ai/embeddings";

export const DEMO_USER = { email: "demo@opslens.dev", password: "opslens-demo-123" };

/** Seeds the demo workspace. Returns null when it already exists. */
export async function seedDemo(log: (...args: unknown[]) => void = console.log) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: DEMO_USER.email, name: "Demo Engineer", passwordHash: await bcrypt.hash(DEMO_USER.password, 12) })
    .onConflictDoNothing()
    .returning();
  if (!user) {
    log("Demo data already present. Drop the database to reseed.");
    return null;
  }
  const [org] = await db.insert(schema.organizations).values({ name: "Acme Payments", slug: "acme", plan: "team" }).returning();
  await db.insert(schema.memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
  const [project] = await db.insert(schema.projects).values({ orgId: org.id, name: "Production", slug: "production" }).returning();

  const deps = JSON.parse(await readFile("data/sample/deployments.json", "utf8")) as Array<{
    service: string; version: string; commitSha: string; deployedBy: string; deployedAt: string; changelog: string;
  }>;
  const svcIds = new Map<string, string>();
  for (const d of deps) {
    if (!svcIds.has(d.service)) {
      const [s] = await db.insert(schema.services).values({ projectId: project.id, name: d.service }).returning();
      svcIds.set(d.service, s.id);
    }
    await db.insert(schema.deployments).values({ ...d, serviceId: svcIds.get(d.service)!, deployedAt: new Date(d.deployedAt) });
  }

  // A resolved incident from the past, so "similar incidents" retrieval has something to find.
  const pastSummary = "Payment charges returned 500 with PaymentGatewayTimeout after the gateway timeout was lowered to 1500ms.";
  await db.insert(schema.incidents).values({
    projectId: project.id,
    serviceId: svcIds.get("payment-service"),
    title: "PaymentGatewayTimeout spike on POST /v1/charges",
    summary: pastSummary,
    severity: "sev2",
    status: "resolved",
    rootCause: "Gateway timeout set below gateway p99 latency (1.5s vs 3.1s).",
    startedAt: new Date("2026-03-11T10:02:00Z"),
    resolvedAt: new Date("2026-03-11T11:40:00Z"),
    summaryEmbedding: await embedText(pastSummary),
  });

  const logs = await readFile("data/sample/payment-service.log.jsonl", "utf8");
  log("Ingest:", await ingestLogs(project.id, logs));

  {
    const dir = "data/sample/docs";
    for (const f of await readdir(dir)) {
      const content = await readFile(path.join(dir, f), "utf8");
      log("Indexed", f, await indexDocument({ projectId: project.id, title: f, sourceType: f.startsWith("postmortem") ? "postmortem" : "runbook", content }));
    }
  }
  log("Seeded. Sign in as demo@opslens.dev / opslens-demo-123 → /acme");
  return { user, org, project };
}

