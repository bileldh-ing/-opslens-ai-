/**
 * Seeds a demo workspace: user demo@opslens.dev / opslens-demo-123,
 * the payment-service 500s scenario, a resolved past incident, and indexed docs.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { db, pool, schema } from "../src/db";
import { ingestLogs, indexDocument } from "../src/server/ingest/pipeline";
import { embedText } from "../src/server/ai/embeddings";

const hasAI = Boolean(process.env.OPENAI_API_KEY);

async function main() {
  const [user] = await db
    .insert(schema.users)
    .values({ email: "demo@opslens.dev", name: "Demo Engineer", passwordHash: await bcrypt.hash("opslens-demo-123", 12) })
    .onConflictDoNothing()
    .returning();
  if (!user) {
    console.log("Demo data already present. Drop the database to reseed.");
    return;
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
    summaryEmbedding: hasAI ? await embedText(pastSummary) : null,
  });

  const logs = await readFile("data/sample/payment-service.log.jsonl", "utf8");
  console.log("Ingest:", await ingestLogs(project.id, logs));

  if (hasAI) {
    const dir = "data/sample/docs";
    for (const f of await readdir(dir)) {
      const content = await readFile(path.join(dir, f), "utf8");
      console.log("Indexed", f, await indexDocument({ projectId: project.id, title: f, sourceType: f.startsWith("postmortem") ? "postmortem" : "runbook", content }));
    }
  } else {
    console.warn("OPENAI_API_KEY not set: skipped embeddings for docs and incidents.");
  }
  console.log("Seeded. Sign in as demo@opslens.dev / opslens-demo-123 → /acme");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
