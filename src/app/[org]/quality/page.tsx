import Link from "next/link";
import { and, avg, count, desc, eq, inArray } from "drizzle-orm";
import { FlaskConical } from "lucide-react";
import { db, schema } from "@/db";
import { requireOrg } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { runEvalsAction } from "@/app/actions/integrations";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { RunEvalsButton } from "@/components/integrations-forms";
import { CASES } from "@/server/evals/cases";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export default async function QualityPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOrg(slug);
  const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.orgId, org.id))).map((p) => p.id);
  const ids = projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"];

  const [runs, byStatus, [agg]] = await Promise.all([
    db.select().from(schema.evalRuns).where(eq(schema.evalRuns.orgId, org.id)).orderBy(desc(schema.evalRuns.createdAt)).limit(10),
    db
      .select({ status: schema.investigations.status, n: count() })
      .from(schema.investigations)
      .where(inArray(schema.investigations.projectId, ids))
      .groupBy(schema.investigations.status),
    db
      .select({ n: count(), conf: avg(schema.investigations.confidence) })
      .from(schema.investigations)
      .where(and(inArray(schema.investigations.projectId, ids), eq(schema.investigations.status, "completed"))),
  ]);
  const latest = runs[0];
  const total = byStatus.reduce((n, r) => n + r.n, 0);
  const failed = byStatus.find((r) => r.status === "failed")?.n ?? 0;
  const passRate = latest ? Math.round((latest.passed / latest.total) * 100) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Quality &amp; evals</h1>
          <p className="mt-1 text-sm text-muted">
            Golden investigation cases graded on grounding: right status, right top cause, required citation types, and no false confidence when there is no data.
          </p>
        </div>
        {can(role, "evals.run") && <RunEvalsButton action={runEvalsAction.bind(null, slug)} />}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Latest pass rate" value={passRate === null ? "—" : `${passRate}%`} hint={latest ? `${latest.passed}/${latest.total} cases` : "No runs yet"} />
        <Stat label="Analyst" value={latest?.analyst === "deterministic-triage" ? "Triage" : latest?.analyst ?? "—"} hint={latest?.analyst === "deterministic-triage" ? "deterministic, offline" : "LLM agent"} />
        <Stat label="Investigations" value={String(total)} hint={`${failed} failed`} />
        <Stat label="Avg. confidence" value={agg?.conf ? Number(agg.conf).toFixed(2) : "—"} hint="completed investigations, after citation checks" />
      </div>

      <Card>
        <CardTitle>Latest run</CardTitle>
        {!latest ? (
          <div className="mt-4">
            <EmptyState
              icon={FlaskConical}
              title="No eval runs recorded"
              description={`Run the ${CASES.length} golden cases here, or with \`npm run eval\` from the CLI / CI. Results are stored and charted on this page.`}
            />
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {latest.createdAt.toLocaleString()} · via {latest.trigger} · {(latest.durationMs / 1000).toFixed(1)} s
            </p>
            <ul className="mt-4 space-y-3" data-testid="eval-results">
              {latest.results.map((r) => (
                <li key={r.name} className="rounded-lg border border-border bg-panel-2/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      <span className={r.passed ? "text-emerald-400" : "text-red-400"}>{r.passed ? "✓" : "✗"}</span> {r.name}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {r.status && <Badge value={r.status} />}
                      <span>conf {r.confidence ?? "—"}</span>
                      <span>· {r.citations} citations</span>
                      <span>· {r.durationMs} ms</span>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">Q: {r.question}</p>
                  {r.topCause && <p className="mt-1 text-xs text-slate-300">Top cause: {r.topCause}</p>}
                  {r.failures.length > 0 && <p className="mt-1 text-xs text-red-300">{r.failures.join(" · ")}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {runs.length > 1 && (
        <Card>
          <CardTitle>History</CardTitle>
          <div className="mt-4 flex h-24 items-end gap-2" aria-label="Pass rate per run, oldest to newest">
            {[...runs].reverse().map((r) => {
              const pct = Math.round((r.passed / r.total) * 100);
              return (
                <div key={r.id} className="flex flex-1 flex-col items-center gap-1" title={`${r.createdAt.toLocaleString()}: ${r.passed}/${r.total}`}>
                  <div className={`w-full rounded-t ${pct === 100 ? "bg-emerald-500/70" : "bg-amber-500/70"}`} style={{ height: `${Math.max(pct, 4)}%` }} />
                  <span className="text-[10px] text-muted">{pct}%</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <p className="text-xs text-muted">
        Cases live in <span className="font-mono">src/server/evals/cases.ts</span>. Every eval run creates real investigations you can open from <Link className="underline" href={`/${slug}/investigate`}>Investigate</Link>.
      </p>
    </div>
  );
}
