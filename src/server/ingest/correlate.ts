export type DeploymentLite = { id: string; version: string; deployedAt: Date };

/**
 * Picks the deployment most likely to have introduced an error spike:
 * the latest deployment that happened before the spike started, within a lookback window.
 * Returns the gap so the UI/AI can express how strong the temporal signal is.
 */
export function suspectDeployment(
  firstErrorAt: Date,
  deployments: DeploymentLite[],
  lookbackMs = 1000 * 60 * 60 * 6,
): { deployment: DeploymentLite; gapMs: number } | null {
  let best: { deployment: DeploymentLite; gapMs: number } | null = null;
  for (const d of deployments) {
    const gap = firstErrorAt.getTime() - d.deployedAt.getTime();
    if (gap < 0 || gap > lookbackMs) continue;
    if (!best || gap < best.gapMs) best = { deployment: d, gapMs: gap };
  }
  return best;
}

/** Simple severity heuristic: volume, rate and fatal-ness. A human can always override it. */
export function inferSeverity(input: { count: number; durationMs: number; hasFatal: boolean }) {
  const perMinute = input.count / Math.max(1, input.durationMs / 60_000);
  if (input.hasFatal || perMinute >= 50) return "sev1" as const;
  if (perMinute >= 10 || input.count >= 200) return "sev2" as const;
  if (input.count >= 20) return "sev3" as const;
  return "sev4" as const;
}

/** Buckets events into fixed windows for timeline charts. */
export function bucketTimeline(timestamps: Date[], bucketMs = 60_000) {
  const buckets = new Map<number, number>();
  for (const t of timestamps) {
    const k = Math.floor(t.getTime() / bucketMs) * bucketMs;
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, count]) => ({ t: new Date(t), count }));
}
