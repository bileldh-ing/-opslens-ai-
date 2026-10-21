import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  sev1: "bg-red-500/15 text-red-300 ring-red-500/30",
  sev2: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  sev3: "bg-yellow-500/15 text-yellow-200 ring-yellow-500/30",
  sev4: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  open: "bg-red-500/15 text-red-300 ring-red-500/30",
  investigating: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  mitigated: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  resolved: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  pending_approval: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  rejected: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
  high: "bg-red-500/15 text-red-300 ring-red-500/30",
  medium: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

export function Badge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[value] ?? "bg-slate-500/15 text-slate-300 ring-slate-500/30",
        className,
      )}
    >
      {value.replace("_", " ")}
    </span>
  );
}
