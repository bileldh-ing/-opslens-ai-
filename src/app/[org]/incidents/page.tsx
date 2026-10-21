import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { listIncidents } from "@/server/queries";
import { Badge } from "@/components/ui/badge";

export default async function Incidents({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org } = await requireOrg(slug, "incident.read");
  const rows = await listIncidents(org.id);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Incidents</h1>
      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-panel-2 text-left text-muted">
            <tr><th className="px-4 py-3">Incident</th><th>Service</th><th>Severity</th><th>Status</th><th>Started</th></tr>
          </thead>
          <tbody className="divide-y divide-border bg-panel">
            {rows.map(({ incident, service }) => (
              <tr key={incident.id}>
                <td className="px-4 py-3"><Link href={`/${slug}/incidents/${incident.id}`} className="hover:text-accent">{incident.title}</Link></td>
                <td className="text-muted">{service ?? "—"}</td>
                <td><Badge value={incident.severity} /></td>
                <td><Badge value={incident.status} /></td>
                <td className="text-muted">{incident.startedAt.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-muted">No incidents yet. Upload logs to get started.</p>}
      </div>
    </div>
  );
}
