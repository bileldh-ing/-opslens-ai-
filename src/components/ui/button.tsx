import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-accent text-white hover:bg-blue-500",
  ghost: "bg-transparent text-slate-300 hover:bg-panel-2",
  outline: "border border-border text-slate-200 hover:bg-panel-2",
  danger: "bg-red-600/90 text-white hover:bg-red-500",
} as const;

export function Button({
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
