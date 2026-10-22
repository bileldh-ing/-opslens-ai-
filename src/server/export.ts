import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIncident } from "./queries";

/**
 * Incident report export (post-mortem input / ticket attachment).
 * JSON is the complete structured record; CSV is a flat, spreadsheet-friendly timeline.
 */
export async function buildIncidentReport(orgId: string, incidentId: string) {
  const data = await getIncident(orgId, incidentId);
  if (!data) return null;
  const remediations = await db
    .select()
    .from(schema.remediations)
    .where(and(eq(schema.remediations.incidentId, incidentId), eq(schema.remediations.projectId, data.project.id)));
  const { incident } = data;
  return {
    exportedAt: new Date().toISOString(),
    incident: {
      id: incident.id,
      title: incident.title,
      summary: incident.summary,
      severity: incident.severity,
      status: incident.status,
      rootCause: incident.rootCause,
      service: data.service,
      project: data.project.name,
      startedAt: incident.startedAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    },
    suspectedDeployment: data.deployment
      ? {
          version: data.deployment.version,
          commitSha: data.deployment.commitSha,
          deployedBy: data.deployment.deployedBy,
          deployedAt: data.deployment.deployedAt.toISOString(),
          changelog: data.deployment.changelog,
        }
      : null,
    errorGroups: data.groups.map((g) => ({
      title: g.title,
      level: g.level,
      occurrences: g.occurrences,
      firstSeen: g.firstSeen.toISOString(),
      lastSeen: g.lastSeen.toISOString(),
    })),
    timeline: data.events.map((e) => ({ at: e.occurredAt.toISOString(), kind: e.kind, body: e.body })),
    investigations: data.investigations.map((i) => ({
      id: i.id,
      question: i.question,
      status: i.status,
      confidence: i.confidence,
      model: i.model,
      createdAt: i.createdAt.toISOString(),
      report: i.report,
    })),
    remediations: remediations.map((r) => ({
      title: r.title,
      kind: r.kind,
      riskLevel: r.riskLevel,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    })),
  };
}

export type IncidentReport = NonNullable<Awaited<ReturnType<typeof buildIncidentReport>>>;

/** RFC 4180 field quoting; also neutralises spreadsheet formula injection (=, +, -, @). */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function incidentReportToCsv(r: IncidentReport): string {
  const rows: unknown[][] = [["section", "timestamp", "kind", "detail", "value"]];
  const i = r.incident;
  rows.push(["incident", i.startedAt, "summary", i.title, `${i.severity} / ${i.status}`]);
  if (i.rootCause) rows.push(["incident", i.resolvedAt ?? "", "root_cause", i.rootCause, ""]);
  if (r.suspectedDeployment) {
    const d = r.suspectedDeployment;
    rows.push(["deployment", d.deployedAt, "suspected", `${d.version} (${d.commitSha ?? "?"}) by ${d.deployedBy ?? "?"}`, d.changelog ?? ""]);
  }
  for (const g of r.errorGroups) rows.push(["error_group", g.firstSeen, g.level, g.title, g.occurrences]);
  for (const t of r.timeline) rows.push(["timeline", t.at, t.kind, t.body, ""]);
  for (const inv of r.investigations) rows.push(["investigation", inv.createdAt, inv.status, inv.question, inv.confidence ?? ""]);
  for (const m of r.remediations) rows.push(["remediation", m.createdAt, m.kind, m.title, `${m.status} (${m.riskLevel} risk)`]);
  return toCsv(rows);
}
