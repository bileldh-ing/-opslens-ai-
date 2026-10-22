import Link from "next/link";
import { cn } from "@/lib/utils";

/** Shared full-page layout for 404 / error / offline screens so they match the app. */
export function StatusScreen({
  code,
  title,
  description,
  children,
  className,
}: {
  code?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("relative grid min-h-[70vh] place-items-center overflow-hidden px-6 py-16", className)}>
      <div className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.14),transparent_60%)]" />
      <div className="relative max-w-md text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-base font-bold">O</span>
        {code && <p className="mt-6 font-mono text-sm text-accent">{code}</p>}
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-muted">{description}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {children ?? (
            <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium hover:bg-blue-500">
              Back to home
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
