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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="mt-1 text-sm text-muted">{org.name} · activity in the 24 hours up to {o.windowEnd.toLocaleString()}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/${slug}/sources`} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:bg-panel-2">Upload logs</Link>
          <Link href={`/${slug}/investigate`} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium hover:bg-blue-500">New investigation</Link>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="Active incidents" value={o.openIncidents} tone={o.openIncidents > 0 ? "text-red-300" : "text-emerald-300"} href={`/${slug}/incidents`} />
        <Kpi label="Remediations awaiting approval" value={o.pendingApprovals} tone={o.pendingApprovals > 0 ? "text-amber-300" : "text-slate-100"} href={`/${slug}/remediations`} />
        <Kpi label="Errors in window" value={o.errorSeries.reduce((n, d) => n + d.errors, 0)} tone="text-slate-100" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardTitle>Errors per hour</CardTitle><ErrorChart data={o.errorSeries} /></Card>
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

function Kpi({ label, value, tone, href }: { label: string; value: number; tone: string; href?: string }) {
  const body = (
    <Card className="transition hover:border-accent/40">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString()}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
