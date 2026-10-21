import { z } from "zod";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { getOrgContextForApi } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { handleApiError, jsonError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { getProjectInOrg } from "@/server/projects";
import { runInvestigation } from "@/server/ai/agent";

export const maxDuration = 120;

const Body = z.object({
  messages: z.array(z.custom<UIMessage>()).min(1),
  incidentId: z.string().uuid().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ org: string; project: string }> }) {
  try {
    const { org: orgSlug, project: projectSlug } = await ctx.params;
    const auth = await getOrgContextForApi(orgSlug);
    if (!auth) return jsonError(401, "Unauthorized");
    assertCan(auth.role, "investigation.run");

    const project = await getProjectInOrg(auth.org.id, projectSlug);
    if (!project) return jsonError(404, "Project not found");

    const rl = await rateLimit(`investigate:${auth.user.id}`, 10, 60_000);
    if (!rl.allowed) return jsonError(429, "Too many investigations, slow down.");

    const body = Body.parse(await req.json());
    const last = body.messages.at(-1)!;
    const question = last.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .trim();

    const { investigationId, stream } = await runInvestigation({
      projectId: project.id,
      userId: auth.user.id,
      question,
      incidentId: body.incidentId,
      messages: body.messages,
    });

    await audit({
      orgId: auth.org.id,
      actorId: auth.user.id,
      action: "investigation.start",
      targetType: "investigation",
      targetId: investigationId,
      metadata: { question },
    });

    return createUIMessageStreamResponse({ stream, headers: { "x-investigation-id": investigationId } });
  } catch (err) {
    return handleApiError(err);
  }
}
