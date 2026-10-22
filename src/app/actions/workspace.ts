"use server";

import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireOrg } from "@/lib/auth";
import { assertWithinLimit, PlanLimitError } from "@/lib/plans";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { incidentPayloads, notify } from "@/server/integrations/webhooks";

const NewProject = z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().max(200).optional() });

export type ActionState = { error?: string; ok?: string } | null;

export async function createProject(orgSlug: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { org, user } = await requireOrg(orgSlug, "project.manage");
  const parsed = NewProject.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Give the project a name of 2 to 60 characters." };

  const [{ value: existing }] = await db.select({ value: count() }).from(schema.projects).where(eq(schema.projects.orgId, org.id));
  try {
    assertWithinLimit(org.plan, "projects", existing);
  } catch (e) {
    if (e instanceof PlanLimitError) return { error: e.message };
    throw e;
  }
  const slug = slugify(parsed.data.name);
  const [taken] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, org.id), eq(schema.projects.slug, slug)));
  if (taken) return { error: "A project with that name already exists." };

  const [project] = await db
    .insert(schema.projects)
    .values({ orgId: org.id, name: parsed.data.name, slug, description: parsed.data.description || null })
    .returning();
  await audit({ orgId: org.id, actorId: user.id, action: "project.create", targetType: "project", targetId: project.id, metadata: { name: project.name } });
  revalidatePath(`/${orgSlug}/settings`);
  return { ok: `Created ${project.name}.` };
}

const STATUS_FLOW = {
  investigating: "Investigation started",
  mitigated: "Marked mitigated",
  resolved: "Resolved",
  open: "Reopened",
} as const;

export async function setIncidentStatus(orgSlug: string, incidentId: string, status: keyof typeof STATUS_FLOW) {
  const { org, user } = await requireOrg(orgSlug, "incident.write");
  const [row] = await db
    .select({ id: schema.incidents.id, status: schema.incidents.status })
    .from(schema.incidents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.incidents.projectId))
    .where(and(eq(schema.incidents.id, incidentId), eq(schema.projects.orgId, org.id)));
  if (!row) throw new Error("Incident not found");

  await db
    .update(schema.incidents)
    .set({ status, resolvedAt: status === "resolved" ? new Date() : null })
    .where(eq(schema.incidents.id, incidentId));
  await db.insert(schema.incidentEvents).values({
    incidentId,
    kind: "status_change",
    body: `${STATUS_FLOW[status]} by ${user.name}`,
    actorId: user.id,
  });
  await audit({
    orgId: org.id,
    actorId: user.id,
    action: `incident.${status}`,
    targetType: "incident",
    targetId: incidentId,
    metadata: { from: row.status, to: status },
  });
  if (row.status !== status) {
    const [p] = await incidentPayloads([incidentId]);
    if (p) await notify(org.id, "incident.status_changed", { ...p.payload, previousStatus: row.status, changedBy: user.name });
  }
  revalidatePath(`/${orgSlug}/incidents/${incidentId}`);
  revalidatePath(`/${orgSlug}/incidents`);
}
