import { z } from "zod";

export const CitationSchema = z.object({
  type: z.enum(["log", "doc", "incident", "deployment"]),
  id: z.string().describe("Exact id returned by a tool. Never invent ids."),
  excerpt: z.string().max(400).describe("Verbatim snippet from the tool result that supports the claim."),
});

export const HypothesisSchema = z.object({
  cause: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  evidence: z.array(CitationSchema).min(1),
  counterEvidence: z.array(z.string()).default([]),
});

export const RemediationDraftSchema = z.object({
  kind: z.enum(["runbook", "test_query", "suggested_fix", "draft_patch"]),
  title: z.string(),
  content: z.string().describe("Markdown steps, a read-only SQL/log query, or a unified diff."),
  riskLevel: z.enum(["low", "medium", "high"]),
});

export const InvestigationReportSchema = z.object({
  summary: z.string(),
  status: z
    .enum(["likely_cause_found", "inconclusive", "insufficient_data"])
    .describe("Use inconclusive/insufficient_data when evidence does not clearly support one cause."),
  hypotheses: z.array(HypothesisSchema).max(5),
  unknowns: z.array(z.string()).describe("What we could not verify and what data would settle it."),
  nextSteps: z.array(z.string()),
  remediations: z.array(RemediationDraftSchema).max(5),
});

export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;

/**
 * Guardrail: every citation must reference an id that a tool actually returned during this run.
 * Unverifiable citations are dropped; a hypothesis left with no evidence is removed, and the
 * report is downgraded to "inconclusive" rather than presenting an unsupported cause.
 */
export function verifyCitations(report: InvestigationReport, seenIds: Set<string>) {
  const dropped: string[] = [];
  const hypotheses = report.hypotheses
    .map((h) => {
      const evidence = h.evidence.filter((c) => {
        const ok = seenIds.has(`${c.type}:${c.id}`);
        if (!ok) dropped.push(`${c.type}:${c.id}`);
        return ok;
      });
      const ratio = h.evidence.length ? evidence.length / h.evidence.length : 0;
      return { ...h, evidence, confidence: Number((h.confidence * ratio).toFixed(2)) };
    })
    .filter((h) => h.evidence.length > 0)
    .sort((a, b) => b.confidence - a.confidence);

  let status = report.status;
  if (status === "likely_cause_found" && (hypotheses.length === 0 || hypotheses[0].confidence < 0.5)) {
    status = "inconclusive";
  }
  const unknowns = dropped.length
    ? [...report.unknowns, `${dropped.length} citation(s) could not be verified against retrieved data and were removed.`]
    : report.unknowns;

  return { report: { ...report, hypotheses, status, unknowns }, dropped };
}

export function overallConfidence(report: InvestigationReport) {
  return report.hypotheses[0]?.confidence ?? 0;
}
