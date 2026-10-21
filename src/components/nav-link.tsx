"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition",
        active ? "bg-accent/10 text-white ring-1 ring-inset ring-accent/30" : "text-slate-400 hover:bg-panel-2 hover:text-slate-200",
      )}
    >
      {children}
    </Link>
  );
}
