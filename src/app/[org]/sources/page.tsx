import { count, desc, eq, inArray, max } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOrg } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { listProjects } from "@/server/queries";
import { Card, CardTitle } from "@/components/ui/card";
import { UploadPanel } from "@/components/upload-panel";

export default async function SourcesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOrg(slug);
  const projects = await listProjects(org.id);
  const projectIds = projects.map((p) => p.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const ids = projectIds.length ? projectIds : none;

  const [services, documents, deployments] = await Promise.all([
    db
      .select({
        id: schema.services.id,
        name: schema.services.name,
        events: count(schema.logEvents.id),
        lastEvent: max(schema.logEvents.timestamp),
      })
      .from(schema.services)
      .leftJoin(schema.logEvents, eq(schema.logEvents.serviceId, schema.services.id))
      .where(inArray(schema.services.projectId, ids))
      .groupBy(schema.services.id, schema.services.name)
      .orderBy(desc(count(schema.logEvents.id))),
    db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        sourceType: schema.documents.sourceType,
        indexedAt: schema.documents.indexedAt,
        chunks: count(schema.documentChunks.id),
      })
      .from(schema.documents)
      .leftJoin(schema.documentChunks, eq(schema.documentChunks.documentId, schema.documents.id))
      .where(inArray(schema.documents.projectId, ids))
      .groupBy(schema.documents.id)
      .orderBy(desc(schema.documents.createdAt)),
    db
      .select({
        id: schema.deployments.id,
        service: schema.services.name,
        version: schema.deployments.version,
        commitSha: schema.deployments.commitSha,
        deployedAt: schema.deployments.deployedAt,
      })
      .from(schema.deployments)
      .innerJoin(schema.services, eq(schema.services.id, schema.deployments.serviceId))
      .where(inArray(schema.services.projectId, ids))
      .orderBy(desc(schema.deployments.deployedAt))
      .limit(8),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Data sources</h1>
        <p className="mt-1 text-sm text-muted">Everything the investigation agent can read: logs, deployments and your knowledge base.</p>
      </div>

      {can(role, "logs.ingest") && projects.length > 0 && (
        <Card>
          <CardTitle>Upload</CardTitle>
          <div className="mt-4"><UploadPanel orgSlug={slug} projects={projects.map((p) => ({ slug: p.slug, name: p.name }))} /></div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Services</CardTitle>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2 font-normal">Service</th><th className="pb-2 font-normal">Events</th><th className="pb-2 font-normal">Last event</th></tr></thead>
            <tbody className="divide-y divide-border">
              {services.map((s) => (
                <tr key={s.id}><td className="py-2 font-mono text-xs">{s.name}</td><td className="py-2 tabular-nums">{s.events.toLocaleString()}</td><td className="py-2 text-xs text-muted">{s.lastEvent ? new Date(s.lastEvent).toLocaleString() : "—"}</td></tr>
              ))}
              {services.length === 0 && <tr><td colSpan={3} className="py-3 text-muted">No logs yet. Upload a log file to get started.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card>
          <CardTitle>Recent deployments</CardTitle>
          <ul className="mt-4 divide-y divide-border text-sm">
            {deployments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-xs">{d.service} <span className="text-accent">{d.version}</span> <span className="text-muted">{d.commitSha?.slice(0, 7)}</span></span>
                <span className="text-xs text-muted">{d.deployedAt.toLocaleString()}</span>
              </li>
            ))}
            {deployments.length === 0 && <li className="py-3 text-muted">No deployments recorded.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitle>Knowledge base</CardTitle>
        <ul className="mt-4 divide-y divide-border text-sm">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="truncate">{d.title}</span>
              <span className="shrink-0 text-xs text-muted">{d.sourceType} · {d.chunks} chunks{d.indexedAt ? "" : " · indexing"}</span>
            </li>
          ))}
          {documents.length === 0 && <li className="py-3 text-muted">No documents. Upload runbooks and postmortems so answers can cite them.</li>}
        </ul>
      </Card>
    </div>
  );
}
