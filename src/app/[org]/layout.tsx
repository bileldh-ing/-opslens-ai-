import Link from "next/link";
import { Activity, Bot, LayoutDashboard, ScrollText, ShieldCheck } from "lucide-react";
import { requireOrg } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { signOut } from "@/app/actions/auth";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, user, role } = await requireOrg(slug);
  const nav = [
    { href: `/${slug}`, label: "Overview", icon: LayoutDashboard },
    { href: `/${slug}/incidents`, label: "Incidents", icon: Activity },
    { href: `/${slug}/investigate`, label: "Investigate", icon: Bot },
    { href: `/${slug}/remediations`, label: "Remediations", icon: ShieldCheck },
    ...(can(role, "audit.read") ? [{ href: `/${slug}/audit`, label: "Audit log", icon: ScrollText }] : []),
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-border bg-panel px-4 py-6">
        <div className="px-2">
          <p className="text-lg font-semibold">OpsLens <span className="text-accent">AI</span></p>
          <p className="mt-1 truncate text-xs text-muted">{org.name} · {org.plan}</p>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-300 hover:bg-panel-2">
              <n.icon className="h-4 w-4 text-muted" /> {n.label}
            </Link>
          ))}
        </nav>
        <form action={signOut} className="mt-10 border-t border-border px-2 pt-4 text-xs text-muted">
          <p className="truncate">{user.name}</p>
          <p className="capitalize">{role}</p>
          <button className="mt-2 text-accent">Sign out</button>
        </form>
      </aside>
      <main className="flex-1 overflow-x-hidden p-8">{children}</main>
    </div>
  );
}
