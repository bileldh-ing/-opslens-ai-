import { getOrgContextForApi } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { handleApiError, jsonError } from "@/lib/api";
import { storage } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { getProjectInOrg } from "@/server/projects";
import { enqueue } from "@/server/jobs/queue";

/** Upload a runbook / doc / postmortem for RAG indexing. */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; project: string }> }) {
  try {
    const { org: orgSlug, project: projectSlug } = await ctx.params;
    const auth = await getOrgContextForApi(orgSlug);
    if (!auth) return jsonError(401, "Unauthorized");
    assertCan(auth.role, "docs.upload");
    const project = await getProjectInOrg(auth.org.id, projectSlug);
    if (!project) return jsonError(404, "Project not found");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "Missing file");
    const sourceType = String(form.get("sourceType") ?? "doc");
    const key = await storage.put(`docs/${project.id}`, file.name, Buffer.from(await file.arrayBuffer()));
    const job = await enqueue("index-document", {
      projectId: project.id,
      storageKey: key,
      title: file.name,
      sourceType,
    });
    await audit({
      orgId: auth.org.id,
      actorId: auth.user.id,
      action: "document.upload",
      targetType: "project",
      targetId: project.id,
      metadata: { file: file.name, jobId: job.jobId },
    });
    return Response.json(job, { status: job.mode === "queued" ? 202 : 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
