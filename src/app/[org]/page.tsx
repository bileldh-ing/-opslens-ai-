import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { getOverview } from "@/server/queries";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorChart } from "@/components/error-chart";

export default async function Overview({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org } = await requireOrg(slug);
  const o = await getOverview(org.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm text-muted">Active incidents</p><p className="mt-2 text-3xl font-semibold">{o.openIncidents}</p></Card>
        <Card><p className="text-sm text-muted">Remediations awaiting approval</p><p className="mt-2 text-3xl font-semibold">{o.pendingApprovals}</p></Card>
        <Card><p className="text-sm text-muted">Errors (24h)</p><p className="mt-2 text-3xl font-semibold">{o.errorSeries.reduce((n, d) => n + d.errors, 0)}</p></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardTitle>Error rate, last 24 hours</CardTitle><ErrorChart data={o.errorSeries} /></Card>
        <Card>
          <CardTitle>Top recurring errors</CardTitle>
          <ul className="mt-4 space-y-3 text-sm">
            {o.topGroups.map((g) => (
              <li key={g.id} className="flex justify-between gap-3"><span className="truncate font-mono text-xs text-slate-300">{g.title}</span><span className="text-muted">{g.occurrences}</span></li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <CardTitle>Recent incidents</CardTitle>
        <ul className="mt-4 divide-y divide-border">
          {o.recentIncidents.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-3">
              <Link href={`/${slug}/incidents/${i.id}`} className="truncate text-sm hover:text-accent">{i.title}</Link>
              <span className="flex gap-2"><Badge value={i.severity} /><Badge value={i.status} /></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
