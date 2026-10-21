/**
 * Runs golden cases against the seeded DB and prints a scorecard.
 * Usage: npm run db:seed && npm run eval
 */
import { eq } from "drizzle-orm";
import { db, pool, schema } from "../src/db";
import { runInvestigation } from "../src/server/ai/agent";
import type { InvestigationReport } from "../src/server/ai/report";
import { CASES } from "./cases";

async function main() {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.slug, "production")).limit(1);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, "demo@opslens.dev")).limit(1);
  if (!project || !user) throw new Error("Seed the database first (npm run db:seed).");

  let passed = 0;
  for (const c of CASES) {
    const { investigationId, result } = await runInvestigation({
      projectId: project.id,
      userId: user.id,
      question: c.question,
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: c.question }] }],
    });
    await result.consumeStream();
    await result.response; // wait for completion + persistence
    const [inv] = await db.select().from(schema.investigations).where(eq(schema.investigations.id, investigationId));
    const report = inv.report as InvestigationReport | null;

    const failures: string[] = [];
    if (!report) failures.push("no report submitted");
    else {
      if (!c.expect.status.includes(report.status)) failures.push(`status=${report.status}`);
      const top = report.hypotheses[0];
      if (c.expect.topCauseMentions && !(top && c.expect.topCauseMentions.test(top.cause + top.reasoning)))
        failures.push(`top cause "${top?.cause}" does not match ${c.expect.topCauseMentions}`);
      const citedTypes = new Set(report.hypotheses.flatMap((h) => h.evidence.map((e) => e.type)));
      for (const t of c.expect.mustCite ?? []) if (!citedTypes.has(t)) failures.push(`missing ${t} citation`);
      if (c.expect.maxConfidence !== undefined && (top?.confidence ?? 0) > c.expect.maxConfidence)
        failures.push(`overconfident (${top?.confidence})`);
    }
    if (failures.length === 0) passed++;
    console.log(`${failures.length ? "✗" : "✓"} ${c.name}${failures.length ? `\n    ${failures.join("\n    ")}` : ""}`);
  }
  console.log(`\n${passed}/${CASES.length} eval cases passed`);
  if (passed < CASES.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
