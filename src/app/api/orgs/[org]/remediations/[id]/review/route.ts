import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getOrgContextForApi } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { handleApiError, jsonError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { canReview, canTransition } from "@/server/remediation";

const Body = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(2000).optional() });

/** Human-in-the-loop gate: admins approve or reject AI-proposed remediations. Fully audited. */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; id: string }> }) {
  try {
    const { org: orgSlug, id } = await ctx.params;
    const auth = await getOrgContextForApi(orgSlug);
    if (!auth) return jsonError(401, "Unauthorized");
    assertCan(auth.role, "remediation.approve");
    const { decision, note } = Body.parse(await req.json());

    const [row] = await db
      .select({ remediation: schema.remediations })
      .from(schema.remediations)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.remediations.projectId))
      .where(and(eq(schema.remediations.id, id), eq(schema.projects.orgId, auth.org.id)))
      .limit(1);
    if (!row) return jsonError(404, "Remediation not found");
    const r = row.remediation;

    if (!canTransition(r.status, decision)) return jsonError(409, `Cannot move from ${r.status} to ${decision}`);
    const check = canReview({ requestedBy: r.requestedBy, reviewerId: auth.user.id, riskLevel: r.riskLevel });
    if (!check.ok) return jsonError(403, check.reason);

    const [updated] = await db
      .update(schema.remediations)
      .set({ status: decision, reviewedBy: auth.user.id, reviewedAt: new Date(), reviewNote: note })
      .where(and(eq(schema.remediations.id, id), eq(schema.remediations.status, "pending_approval")))
      .returning();
    if (!updated) return jsonError(409, "Remediation was reviewed concurrently");

    if (r.incidentId) {
      await db.insert(schema.incidentEvents).values({
        incidentId: r.incidentId,
        kind: "remediation",
        body: `${auth.user.name} ${decision} "${r.title}"${note ? `: ${note}` : ""}`,
        actorId: auth.user.id,
      });
    }
    await audit({
      orgId: auth.org.id,
      actorId: auth.user.id,
      action: `remediation.${decision === "approved" ? "approve" : "reject"}`,
      targetType: "remediation",
      targetId: id,
      metadata: { riskLevel: r.riskLevel, kind: r.kind, note },
    });
    return Response.json({ remediation: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
