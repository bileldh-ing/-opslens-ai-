import { convertToModelMessages, hasToolCall, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { chatModel, chatModelId } from "./models";
import { INVESTIGATOR_SYSTEM_PROMPT } from "./prompts";
import { createInvestigationTools } from "./tools";
import { InvestigationReportSchema, overallConfidence, verifyCitations } from "./report";

export type RunInvestigationInput = {
  projectId: string;
  userId: string;
  question: string;
  incidentId?: string;
  messages: UIMessage[];
};

/**
 * Streams an agentic investigation: tool calls are visible to the client as they happen,
 * every step is persisted for the investigation history, and the final report is
 * citation-verified before it is stored. Remediations land as `pending_approval`; nothing executes.
 */
export async function runInvestigation(input: RunInvestigationInput) {
  const [investigation] = await db
    .insert(schema.investigations)
    .values({
      projectId: input.projectId,
      incidentId: input.incidentId,
      createdBy: input.userId,
      question: input.question,
      model: chatModelId,
    })
    .returning();

  const seen = new Set<string>();
  let ordinal = 0;

  const tools = {
    ...createInvestigationTools(input.projectId, seen),
    submit_report: tool({
      description: "Submit the final structured investigation report. Call exactly once, last.",
      inputSchema: InvestigationReportSchema,
      execute: async (raw) => {
        const { report, dropped } = verifyCitations(raw, seen);
        await db
          .update(schema.investigations)
          .set({ report, status: "completed", confidence: overallConfidence(report) })
          .where(eq(schema.investigations.id, investigation.id));
        if (report.remediations.length) {
          await db.insert(schema.remediations).values(
            report.remediations.map((r) => ({
              projectId: input.projectId,
              investigationId: investigation.id,
              incidentId: input.incidentId,
              kind: r.kind,
              title: r.title,
              content: r.content,
              riskLevel: r.riskLevel,
              requiresApproval: true,
              status: "pending_approval" as const,
              requestedBy: input.userId,
            })),
          );
        }
        if (input.incidentId) {
          await db.insert(schema.incidentEvents).values({
            incidentId: input.incidentId,
            kind: "ai_finding",
            body: `AI investigation (${report.status}): ${report.summary}`,
          });
        }
        return { saved: true, investigationId: investigation.id, droppedCitations: dropped.length, report };
      },
    }),
  };

  const result = streamText({
    model: chatModel(),
    system: INVESTIGATOR_SYSTEM_PROMPT,
    messages: await convertToModelMessages(input.messages),
    tools,
    stopWhen: [stepCountIs(12), hasToolCall("submit_report")],
    temperature: 0.1,
    onStepFinish: async (step) => {
      const rows = [
        ...step.toolCalls.map((c) => ({
          investigationId: investigation.id,
          ordinal: ordinal++,
          toolName: c.toolName,
          input: c.input as object,
          output: (step.toolResults.find((r) => r.toolCallId === c.toolCallId)?.output ?? null) as object,
        })),
        ...(step.text ? [{ investigationId: investigation.id, ordinal: ordinal++, text: step.text }] : []),
      ];
      if (rows.length) await db.insert(schema.investigationSteps).values(rows);
    },
    onFinish: async ({ totalUsage }) => {
      await db
        .update(schema.investigations)
        .set({ inputTokens: totalUsage.inputTokens ?? null, outputTokens: totalUsage.outputTokens ?? null })
        .where(eq(schema.investigations.id, investigation.id));
    },
    onError: async () => {
      await db
        .update(schema.investigations)
        .set({ status: "failed" })
        .where(eq(schema.investigations.id, investigation.id));
    },
  });

  return { investigationId: investigation.id, result };
}
