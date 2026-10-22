import type { InvestigationReport } from "../ai/report";
import type { EvalCase } from "./cases";

/** Grades one report against a golden case. Pure, so it is unit-tested directly. */
export function gradeReport(c: EvalCase, report: InvestigationReport | null): string[] {
  const failures: string[] = [];
  if (!report) return ["no report submitted"];
  if (!c.expect.status.includes(report.status)) failures.push(`status=${report.status}`);
  const top = report.hypotheses[0];
  if (c.expect.topCauseMentions && !(top && c.expect.topCauseMentions.test(top.cause + top.reasoning))) {
    failures.push(`top cause "${top?.cause}" does not match ${c.expect.topCauseMentions}`);
  }
  const citedTypes = new Set(report.hypotheses.flatMap((h) => h.evidence.map((e) => e.type)));
  for (const t of c.expect.mustCite ?? []) if (!citedTypes.has(t)) failures.push(`missing ${t} citation`);
  if (c.expect.maxConfidence !== undefined && (top?.confidence ?? 0) > c.expect.maxConfidence) {
    failures.push(`overconfident (${top?.confidence})`);
  }
  return failures;
}
