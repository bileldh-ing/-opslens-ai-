import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getIncident } from "@/server/queries";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function IncidentPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org } = await requireOrg(slug, "incident.read");
  const data = await getIncident(org.id, id);
  if (!data) notFound();
  const { incident, service, events, groups, deployment, investigations, project } = data;
  const ask = encodeURIComponent(`Why did ${service ?? "this service"} start failing with "${incident.title}"?`);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm text-muted">{project.name} · {service ?? "unknown service"}</p>
          <h1 className="mt-1 text-2xl font-semibold">{incident.title}</h1>
          <div className="mt-3 flex gap-2"><Badge value={incident.severity} /><Badge value={incident.status} /></div>
        </div>
        <Link href={`/${slug}/investigate?project=${project.slug}&incident=${incident.id}&q=${ask}`} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium">
          Investigate with AI
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Timeline</CardTitle>
          <ol className="mt-4 space-y-4 border-l border-border pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                <p className="text-xs text-muted">{e.occurredAt.toLocaleString()} · {e.kind.replace("_", " ")}</p>
                <p className="mt-1 text-sm">{e.body}</p>
              </li>
            ))}
          </ol>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardTitle>Suspected deployment</CardTitle>
            {deployment ? (
              <div className="mt-3 text-sm">
                <p className="font-mono">{deployment.version} <span className="text-muted">({deployment.commitSha?.slice(0, 7)})</span></p>
                <p className="mt-1 text-muted">{deployment.deployedAt.toLocaleString()} by {deployment.deployedBy}</p>
                {deployment.changelog && <p className="mt-2 whitespace-pre-wrap text-slate-300">{deployment.changelog}</p>}
              </div>
            ) : <p className="mt-3 text-sm text-muted">No deployment within 6h before the first error.</p>}
          </Card>
          <Card>
            <CardTitle>Error groups</CardTitle>
            <ul className="mt-3 space-y-2 text-xs">
              {groups.map((g) => <li key={g.id} className="flex justify-between gap-2"><span className="truncate font-mono">{g.title}</span><span className="text-muted">{g.occurrences}×</span></li>)}
            </ul>
          </Card>
          <Card>
            <CardTitle>Investigations</CardTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {investigations.length === 0 && <li className="text-muted">None yet.</li>}
              {investigations.map((inv) => (
                <li key={inv.id}><p className="truncate">{inv.question}</p><p className="text-xs text-muted">{inv.status} · confidence {inv.confidence ?? "—"}</p></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
