import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export async function getOverview(orgId: string) {
  const projectIds = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.orgId, orgId));
  // Anchor the 24h window at the newest event, so a quiet workspace still shows its last activity.
  const [{ latest }] = await db
    .select({ latest: sql<string | null>`max(${schema.logEvents.timestamp})` })
    .from(schema.logEvents)
    .where(inArray(schema.logEvents.projectId, projectIds));
  const end = latest ? new Date(latest) : new Date();
  const since = new Date(end.getTime() - 24 * 3600 * 1000);

  const [openIncidents, pending, errorSeries, topGroups, recentIncidents] = await Promise.all([
    db.select({ value: count() }).from(schema.incidents)
      .where(and(inArray(schema.incidents.projectId, projectIds), inArray(schema.incidents.status, ["open", "investigating"]))),
    db.select({ value: count() }).from(schema.remediations)
      .where(and(inArray(schema.remediations.projectId, projectIds), eq(schema.remediations.status, "pending_approval"))),
    db.select({
        bucket: sql<string>`date_trunc('hour', ${schema.logEvents.timestamp})`.as("bucket"),
        errors: count(),
      })
      .from(schema.logEvents)
      .where(and(
        inArray(schema.logEvents.projectId, projectIds),
        inArray(schema.logEvents.level, ["error", "fatal"]),
        gte(schema.logEvents.timestamp, since),
      ))
      .groupBy(sql`bucket`).orderBy(sql`bucket`),
    db.select({ id: schema.errorGroups.id, title: schema.errorGroups.title, occurrences: schema.errorGroups.occurrences, lastSeen: schema.errorGroups.lastSeen })
      .from(schema.errorGroups).where(inArray(schema.errorGroups.projectId, projectIds))
      .orderBy(desc(schema.errorGroups.occurrences)).limit(6),
    db.select().from(schema.incidents).where(inArray(schema.incidents.projectId, projectIds))
      .orderBy(desc(schema.incidents.startedAt)).limit(5),
  ]);

  return {
    windowEnd: end,
    openIncidents: openIncidents[0].value,
    pendingApprovals: pending[0].value,
    errorSeries,
    topGroups,
    recentIncidents,
  };
}

export async function listIncidents(orgId: string) {
  return db
    .select({ incident: schema.incidents, service: schema.services.name, project: schema.projects.name })
    .from(schema.incidents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.incidents.projectId))
    .leftJoin(schema.services, eq(schema.services.id, schema.incidents.serviceId))
    .where(eq(schema.projects.orgId, orgId))
    .orderBy(desc(schema.incidents.startedAt))
    .limit(100);
}

export async function getIncident(orgId: string, id: string) {
  const [row] = await db
    .select({ incident: schema.incidents, service: schema.services.name, project: schema.projects })
    .from(schema.incidents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.incidents.projectId))
    .leftJoin(schema.services, eq(schema.services.id, schema.incidents.serviceId))
    .where(and(eq(schema.incidents.id, id), eq(schema.projects.orgId, orgId)))
    .limit(1);
  if (!row) return null;
  const [events, groups, deployment, investigations] = await Promise.all([
    db.select().from(schema.incidentEvents).where(eq(schema.incidentEvents.incidentId, id)).orderBy(schema.incidentEvents.occurredAt),
    db.select({ group: schema.errorGroups }).from(schema.incidentErrorGroups)
      .innerJoin(schema.errorGroups, eq(schema.errorGroups.id, schema.incidentErrorGroups.errorGroupId))
      .where(eq(schema.incidentErrorGroups.incidentId, id)),
    row.incident.suspectedDeploymentId
      ? db.select().from(schema.deployments).where(eq(schema.deployments.id, row.incident.suspectedDeploymentId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db.select().from(schema.investigations).where(eq(schema.investigations.incidentId, id)).orderBy(desc(schema.investigations.createdAt)),
  ]);
  return { ...row, events, groups: groups.map((g) => g.group), deployment, investigations };
}

export async function listRemediations(orgId: string) {
  return db
    .select({ remediation: schema.remediations, requester: schema.users.name })
    .from(schema.remediations)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.remediations.projectId))
    .leftJoin(schema.users, eq(schema.users.id, schema.remediations.requestedBy))
    .where(eq(schema.projects.orgId, orgId))
    .orderBy(desc(schema.remediations.createdAt))
    .limit(100);
}

export async function listAudit(orgId: string) {
  return db
    .select({ log: schema.auditLogs, actor: schema.users.name })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
    .where(eq(schema.auditLogs.orgId, orgId))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(200);
}

export async function listProjects(orgId: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.orgId, orgId)).orderBy(schema.projects.name);
}

/** Kept outside components so render stays pure (react-hooks/purity). */
export function hoursAgo(hours: number, now = Date.now()): Date {
  return new Date(now - hours * 3600 * 1000);
}
