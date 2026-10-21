import { getOrgContextForApi } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { handleApiError, jsonError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { getProjectInOrg } from "@/server/projects";
import { enqueue } from "@/server/jobs/queue";

const MAX_BYTES = 20 * 1024 * 1024;

/** Accepts a log file upload, stores the original, and hands parsing to a background job. */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; project: string }> }) {
  try {
    const { org: orgSlug, project: projectSlug } = await ctx.params;
    const auth = await getOrgContextForApi(orgSlug);
    if (!auth) return jsonError(401, "Unauthorized");
    assertCan(auth.role, "logs.ingest");
    const project = await getProjectInOrg(auth.org.id, projectSlug);
    if (!project) return jsonError(404, "Project not found");

    const rl = await rateLimit(`ingest:${auth.org.id}`, 30, 60_000);
    if (!rl.allowed) return jsonError(429, "Ingestion rate limit exceeded.");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "Missing file");
    if (file.size > MAX_BYTES) return jsonError(413, "File too large (20 MB max)");

    const key = await storage.put(`logs/${project.id}`, file.name, Buffer.from(await file.arrayBuffer()));
    const service = (form.get("service") as string | null) ?? undefined;
    const jobId = await enqueue("ingest-logs", { projectId: project.id, storageKey: key, service });

    await audit({
      orgId: auth.org.id,
      actorId: auth.user.id,
      action: "logs.upload",
      targetType: "project",
      targetId: project.id,
      metadata: { file: file.name, bytes: file.size, jobId },
    });
    return Response.json({ jobId, storageKey: key }, { status: 202 });
  } catch (err) {
    return handleApiError(err);
  }
}
