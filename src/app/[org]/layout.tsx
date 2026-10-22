import { Activity, Bot, Database, FlaskConical, LayoutDashboard, ScrollText, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { requireOrg } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { signOut } from "@/app/actions/auth";
import { NavLink } from "@/components/nav-link";
import { aiConfigured } from "@/server/ai/models";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, user, role } = await requireOrg(slug);
  const nav = [
    { href: `/${slug}`, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `/${slug}/incidents`, label: "Incidents", icon: Activity },
    { href: `/${slug}/investigate`, label: "Investigate", icon: Bot },
    { href: `/${slug}/remediations`, label: "Remediations", icon: ShieldCheck },
    { href: `/${slug}/sources`, label: "Data sources", icon: Database },
    { href: `/${slug}/quality`, label: "Quality", icon: FlaskConical },
    ...(can(role, "audit.read") ? [{ href: `/${slug}/audit`, label: "Audit log", icon: ScrollText }] : []),
    { href: `/${slug}/settings`, label: "Settings", icon: Settings },
  ];
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-panel/80 px-4 py-6 backdrop-blur md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-sm font-bold">O</span>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">OpsLens <span className="text-accent">AI</span></p>
            <p className="truncate text-xs text-muted">{org.name}</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.exact}>
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-4">
          {!aiConfigured && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/90">
              <p className="flex items-center gap-1.5 font-medium"><Sparkles className="h-3.5 w-3.5" /> Demo mode</p>
              <p className="mt-1 text-amber-200/70">No model key set. Investigations use the deterministic triage analyst.</p>
            </div>
          )}
          <form action={signOut} className="flex items-center gap-3 border-t border-border px-1 pt-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel-2 text-xs font-medium">{initials}</span>
            <div className="min-w-0 flex-1 text-xs">
              <p className="truncate text-slate-200">{user.name}</p>
              <p className="capitalize text-muted">{role} · {org.plan} plan</p>
            </div>
            <button className="text-xs text-muted hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-8 md:px-10">{children}</main>
    </div>
  );
}
