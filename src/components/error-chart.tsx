/** Dependency-free SVG area chart for the hourly error series. */
export function ErrorChart({ data }: { data: { bucket: string; errors: number }[] }) {
  if (data.length === 0) return <p className="py-16 text-center text-sm text-muted">No errors in the last 24 hours.</p>;
  const w = 640, h = 180, pad = 8;
  const max = Math.max(...data.map((d) => d.errors), 1);
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.errors)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full" role="img" aria-label="Errors per hour">
      <defs>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${x(data.length - 1)},${h - pad} L${x(0)},${h - pad} Z`} fill="url(#g)" />
      <path d={line} fill="none" stroke="#60a5fa" strokeWidth="2" />
      {data.map((d, i) => <circle key={d.bucket} cx={x(i)} cy={y(d.errors)} r="2.5" fill="#93c5fd"><title>{`${new Date(d.bucket).toLocaleString()}: ${d.errors}`}</title></circle>)}
    </svg>
  );
}
