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
    </div>
  );
}
