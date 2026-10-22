/**
 * Runs golden cases against the seeded DB, prints a scorecard and records the run
 * (visible on the Quality page). Usage: npm run eval  (migrates and seeds if needed)
 */
import { eq } from "drizzle-orm";
import { db, closeDb, schema } from "../src/db";
import { aiConfigured } from "../src/server/ai/models";
import { runMigrations } from "../src/db/migrate";
import { seedDemo } from "../src/server/demo-seed";
import { runEvalSuite } from "../src/server/evals/run";
import { CASES } from "./cases";

async function main() {
  await runMigrations();
  await seedDemo(() => {}); // no-op when the demo workspace already exists
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.slug, "production")).limit(1);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, "demo@opslens.dev")).limit(1);
  if (!project || !user) throw new Error("Seed the database first (npm run db:seed).");

  console.log(`Running ${CASES.length} cases with ${aiConfigured ? "the LLM agent" : "deterministic triage (no model configured)"}\n`);
  const run = await runEvalSuite({ projectId: project.id, userId: user.id, orgId: project.orgId, trigger: process.env.CI ? "ci" : "cli" });
  for (const r of run.results) {
    console.log(`${r.passed ? "✓" : "✗"} ${r.name}${r.passed ? "" : `\n    ${r.failures.join("\n    ")}`}`);
  }
  console.log(`\n${run.passed}/${run.total} eval cases passed`);
  if (process.env.EVAL_OUTPUT) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.EVAL_OUTPUT, JSON.stringify(run, null, 2));
  }
  if (run.passed < run.total) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => closeDb());
