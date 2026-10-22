import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

/** Consistent empty state for lists and panels that have nothing to show yet. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center" data-testid="empty-state">
      <Icon className="h-6 w-6 text-muted" aria-hidden />
      <p className="mt-3 text-sm font-medium text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
