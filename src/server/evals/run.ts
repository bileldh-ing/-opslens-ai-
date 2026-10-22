import { eq } from "drizzle-orm";
import { readUIMessageStream } from "ai";
import { db, schema } from "@/db";
import type { EvalCaseResult } from "@/db/schema";
import { aiConfigured, chatModelId } from "../ai/models";
import { runInvestigation } from "../ai/agent";
import type { InvestigationReport } from "../ai/report";
import { CASES, type EvalCase } from "./cases";
import { gradeReport } from "./grade";

/**
 * Runs the golden cases through the real investigation path (LLM agent when configured,
 * deterministic triage otherwise), grades them, and records the run in eval_runs.
 */
export async function runEvalSuite(input: {
  projectId: string;
  userId: string;
  orgId?: string | null;
  trigger: "cli" | "ui" | "ci";
  cases?: EvalCase[];
}) {
  const cases = input.cases ?? CASES;
  const started = performance.now();
  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    const t0 = performance.now();
    const { investigationId, stream } = await runInvestigation({
      projectId: input.projectId,
      userId: input.userId,
      question: c.question,
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: c.question }] }],
    });
    // Drain the stream: persistence happens as it is consumed.
    for await (const _ of readUIMessageStream({ stream })) void _;
    const [inv] = await db.select().from(schema.investigations).where(eq(schema.investigations.id, investigationId));
    const report = (inv?.report ?? null) as InvestigationReport | null;
    const failures = gradeReport(c, report);
    const top = report?.hypotheses[0];
    results.push({
      name: c.name,
      question: c.question,
      passed: failures.length === 0,
      failures,
      status: report?.status ?? null,
      topCause: top?.cause ?? null,
      confidence: top?.confidence ?? null,
      citations: report?.hypotheses.reduce((n, h) => n + h.evidence.length, 0) ?? 0,
      durationMs: Math.round(performance.now() - t0),
      investigationId,
    });
  }
  const passed = results.filter((r) => r.passed).length;
  const [run] = await db
    .insert(schema.evalRuns)
    .values({
      orgId: input.orgId ?? null,
      projectId: input.projectId,
      analyst: aiConfigured ? chatModelId : "deterministic-triage",
      trigger: input.trigger,
      passed,
      total: results.length,
      durationMs: Math.round(performance.now() - started),
      results,
    })
    .returning();
  return run;
}
