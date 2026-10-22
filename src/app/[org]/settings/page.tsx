import { and, count, eq, gte, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOrg } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PLAN_LIMITS } from "@/lib/plans";
import { inviteMember } from "@/app/actions/invitations";
import { createProject } from "@/app/actions/workspace";
import { hoursAgo, listProjects } from "@/server/queries";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InviteForm, ProjectForm } from "@/components/settings-forms";
import { ApiKeyForm, ConfirmSubmit, WebhookForm, WebhookTestButton } from "@/components/integrations-forms";
import { EmptyState } from "@/components/empty-state";
import { KeyRound, Webhook } from "lucide-react";
import { env } from "@/lib/env";
import { listApiKeys } from "@/server/integrations/api-keys";
import { listWebhooks } from "@/server/integrations/webhooks";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  revokeApiKeyAction,
  testWebhookAction,
  toggleWebhookAction,
} from "@/app/actions/integrations";

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Number.isFinite(limit) ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-slate-300">{used} / {Number.isFinite(limit) ? limit.toLocaleString() : "∞"}</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-panel-2">
        <div className={`h-full rounded-full ${pct > 85 ? "bg-red-400" : "bg-accent"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOrg(slug);
  const dayAgo = hoursAgo(24);

  const [members, invites, projects, [{ value: investigationsToday }]] = await Promise.all([
    db
      .select({ name: schema.users.name, email: schema.users.email, role: schema.memberships.role, since: schema.memberships.createdAt })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.orgId, org.id))
      .orderBy(schema.memberships.createdAt),
    db
      .select()
      .from(schema.invitations)
      .where(and(eq(schema.invitations.orgId, org.id), isNull(schema.invitations.acceptedAt), gte(schema.invitations.expiresAt, new Date()))),
    listProjects(org.id),
    db
      .select({ value: count() })
      .from(schema.investigations)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.investigations.projectId))
      .where(and(eq(schema.projects.orgId, org.id), gte(schema.investigations.createdAt, dayAgo))),
  ]);
  const limits = PLAN_LIMITS[org.plan];
  const manage = can(role, "integrations.manage");
  const [keys, { hooks, deliveries }] = manage ? await Promise.all([listApiKeys(org.id), listWebhooks(org.id)]) : [[], { hooks: [], deliveries: [] }];
  const hookNames = new Map(hooks.map((h) => [h.id, h.name]));
  const appUrl = env().APP_URL.replace(/\/$/, "");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">Workspace <span className="font-mono">/{org.slug}</span> · your role: {role}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Members</CardTitle>
          <ul className="mt-4 divide-y divide-border">
            {members.map((m) => (
              <li key={m.email} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{m.name}</p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>
                <Badge value={m.role} />
              </li>
            ))}
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 py-3 opacity-70">
                <div className="min-w-0">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-muted">Invitation pending · expires {i.expiresAt.toLocaleDateString()}</p>
                </div>
                <Badge value={i.role} />
              </li>
            ))}
          </ul>
          {can(role, "member.invite") && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Invite a teammate</p>
              <InviteForm action={inviteMember.bind(null, slug)} />
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Plan</CardTitle>
            <Badge value={org.plan} />
          </div>
          <div className="mt-5 space-y-4">
            <Meter label="Members" used={members.length} limit={limits.members} />
            <Meter label="Projects" used={projects.length} limit={limits.projects} />
            <Meter label="Investigations today" used={investigationsToday} limit={limits.investigationsPerDay} />
          </div>
          <p className="mt-5 text-xs text-muted">Limits are enforced server-side on every write path.</p>
        </Card>
      </div>

      <Card>
        <CardTitle>Projects</CardTitle>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id} className="rounded-lg border border-border bg-panel-2/50 p-3">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="font-mono text-xs text-muted">{p.slug}</p>
            </li>
          ))}
        </ul>
        {can(role, "project.manage") && (
          <div className="mt-5 border-t border-border pt-5">
            <ProjectForm action={createProject.bind(null, slug)} />
          </div>
        )}
      </Card>

      {manage && (
        <Card id="api-keys">
          <div className="flex items-center justify-between">
            <CardTitle>Ingest API keys</CardTitle>
            <span className="text-xs text-muted">POST {appUrl}/api/v1/logs</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Project-scoped keys for shipping logs over HTTP (JSON lines, JSON arrays or OTLP logs JSON). Keys are stored hashed and shown once.
          </p>
          <div className="mt-4">
            <ApiKeyForm action={createApiKeyAction.bind(null, slug)} projects={projects.map((p) => ({ slug: p.slug, name: p.name }))} />
          </div>
          {keys.length === 0 ? (
            <div className="mt-4"><EmptyState icon={KeyRound} title="No ingest keys yet" description="Create one to send logs from an OpenTelemetry Collector, Vector, Fluent Bit or plain curl." /></div>
          ) : (
            <ul className="mt-4 divide-y divide-border" data-testid="api-key-list">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{k.name} <span className="ml-1 font-mono text-xs text-muted">olk_{k.prefix}_…</span></p>
                    <p className="text-xs text-muted">
                      {k.project} · created {k.createdAt.toLocaleDateString()} · {k.lastUsedAt ? `last used ${k.lastUsedAt.toLocaleString()}` : "never used"}
                    </p>
                  </div>
                  {k.revokedAt ? (
                    <span className="text-xs text-red-300">Revoked</span>
                  ) : (
                    <form action={revokeApiKeyAction.bind(null, slug, k.id)}>
                      <ConfirmSubmit message={`Revoke "${k.name}"? Senders using it will get 401 immediately.`}>Revoke</ConfirmSubmit>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 rounded-lg bg-panel-2/60 p-3 text-xs">
            <summary className="cursor-pointer text-slate-300">Quick start</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre text-slate-300">{`curl -X POST ${appUrl}/api/v1/logs \\
  -H "Authorization: Bearer olk_..." \\
  -H "Content-Type: application/x-ndjson" \\
  --data-binary @app.log.jsonl`}</pre>
            <p className="mt-2 text-muted">OTLP: point an otlphttp exporter (encoding: json) at <span className="font-mono">{appUrl}/api/v1/logs</span> with the same header. Full reference in docs/ingest-api.md.</p>
          </details>
        </Card>
      )}

      {manage && (
        <Card id="webhooks">
          <CardTitle>Notifications &amp; webhooks</CardTitle>
          <p className="mt-1 text-xs text-muted">
            POSTed on new incidents and status changes. Generic JSON deliveries carry an HMAC-SHA256 signature in X-OpsLens-Signature; Slack format works with incoming webhooks.
          </p>
          <div className="mt-4"><WebhookForm action={createWebhookAction.bind(null, slug)} /></div>
          {hooks.length === 0 ? (
            <div className="mt-4"><EmptyState icon={Webhook} title="No webhooks yet" description="Add a Slack incoming webhook or any HTTPS endpoint to be told about incidents as they open." /></div>
          ) : (
            <ul className="mt-4 divide-y divide-border" data-testid="webhook-list">
              {hooks.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {h.name} <span className="ml-1 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] uppercase text-muted">{h.format}</span>
                      {!h.enabled && <span className="ml-1 text-xs text-amber-300">paused</span>}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">{h.url}</p>
                    <p className="text-xs text-muted">{h.events.join(", ")}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <WebhookTestButton action={testWebhookAction.bind(null, slug, h.id)} />
                    <form action={toggleWebhookAction.bind(null, slug, h.id)}>
                      <button className="text-xs text-muted hover:text-white">{h.enabled ? "Pause" : "Resume"}</button>
                    </form>
                    <form action={deleteWebhookAction.bind(null, slug, h.id)}>
                      <ConfirmSubmit message={`Delete webhook "${h.name}"?`}>Delete</ConfirmSubmit>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {deliveries.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Recent deliveries</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="delivery-log">
                  <thead className="text-muted">
                    <tr><th className="py-1.5 pr-3 font-normal">When</th><th className="pr-3 font-normal">Webhook</th><th className="pr-3 font-normal">Event</th><th className="pr-3 font-normal">Result</th><th className="font-normal">Time</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="py-1.5 pr-3 text-muted">{d.createdAt.toLocaleString()}</td>
                        <td className="pr-3">{hookNames.get(d.webhookId)}</td>
                        <td className="pr-3 font-mono">{d.event}</td>
                        <td className={`pr-3 ${d.ok ? "text-emerald-400" : "text-red-400"}`}>{d.ok ? `✓ ${d.statusCode}` : `✗ ${d.error}`}</td>
                        <td className="tabular-nums text-muted">{d.durationMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
