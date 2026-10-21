import {
  convertToModelMessages,
  createUIMessageStream,
  hasToolCall,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiConfigured, chatModel, chatModelId } from "./models";
import { runTriage } from "./triage";
import { INVESTIGATOR_SYSTEM_PROMPT } from "./prompts";
import { createInvestigationTools } from "./tools";
import { InvestigationReportSchema, overallConfidence, verifyCitations, type InvestigationReport } from "./report";

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
      model: aiConfigured ? chatModelId : "deterministic-triage",
    })
    .returning();

  const seen = new Set<string>();
  let ordinal = 0;

  if (!aiConfigured) {
    return { investigationId: investigation.id, stream: triageStream(investigation.id, input, seen) };
  }

  const tools = {
    ...createInvestigationTools(input.projectId, seen),
    submit_report: tool({
      description: "Submit the final structured investigation report. Call exactly once, last.",
      inputSchema: InvestigationReportSchema,
      execute: async (raw) => {
        const { report, dropped } = await persistReport(investigation.id, input, raw, seen);
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

  return { investigationId: investigation.id, stream: result.toUIMessageStream() };
}

/**
 * Verifies citations, stores the report, queues remediations for human approval and
 * appends an AI finding to the incident timeline. Shared by the LLM agent and triage.
 */
export async function persistReport(
  investigationId: string,
  input: Pick<RunInvestigationInput, "projectId" | "userId" | "incidentId">,
  raw: InvestigationReport,
  seen: Set<string>,
) {
  const { report, dropped } = verifyCitations(raw, seen);
  await db
    .update(schema.investigations)
    .set({ report, status: "completed", confidence: overallConfidence(report) })
    .where(eq(schema.investigations.id, investigationId));
  if (report.remediations.length) {
    await db.insert(schema.remediations).values(
      report.remediations.map((r) => ({
        projectId: input.projectId,
        investigationId,
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
  return { report, dropped };
}

/** Streams the deterministic triage run with the same UI message protocol as the agent. */
function triageStream(investigationId: string, input: RunInvestigationInput, seen: Set<string>) {
  let ordinal = 0;
  return createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start-step" });
      const raw = await runTriage({
        projectId: input.projectId,
        question: input.question,
        incidentId: input.incidentId,
        seen,
        onStep: async ({ toolName, input: toolInput, output }) => {
          const toolCallId = `triage-${ordinal}`;
          writer.write({ type: "tool-input-available", toolCallId, toolName, input: toolInput });
          writer.write({ type: "tool-output-available", toolCallId, output });
          await db.insert(schema.investigationSteps).values({
            investigationId,
            ordinal: ordinal++,
            toolName,
            input: toolInput,
            output: output as object,
          });
        },
      });
      const { report, dropped } = await persistReport(investigationId, input, raw, seen);
      const toolCallId = `triage-${ordinal}`;
      writer.write({ type: "tool-input-available", toolCallId, toolName: "submit_report", input: raw });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: { saved: true, investigationId, droppedCitations: dropped.length, report },
      });
      writer.write({ type: "finish-step" });
    },
    onError: (err) => {
      void db.update(schema.investigations).set({ status: "failed" }).where(eq(schema.investigations.id, investigationId));
      console.error(err);
      return "The investigation failed. Check the server logs.";
    },
  });
}
