import { describe, expect, it } from "vitest";
import { bucketTimeline, inferSeverity, suspectDeployment } from "@/server/ingest/correlate";

const d = (iso: string) => new Date(iso);

describe("suspectDeployment", () => {
  const deps = [
    { id: "old", version: "v1", deployedAt: d("2026-10-19T09:00:00Z") },
    { id: "new", version: "v2", deployedAt: d("2026-10-20T14:00:00Z") },
    { id: "future", version: "v3", deployedAt: d("2026-10-20T15:00:00Z") },
  ];
  it("picks the closest deployment before the first error", () => {
    expect(suspectDeployment(d("2026-10-20T14:04:00Z"), deps)?.deployment.id).toBe("new");
  });
  it("ignores deployments after the spike or outside the lookback", () => {
    expect(suspectDeployment(d("2026-10-20T13:00:00Z"), deps, 60 * 60_000)).toBeNull();
  });
});

describe("inferSeverity", () => {
  it("escalates on fatal or high rate", () => {
    expect(inferSeverity({ count: 3, durationMs: 60_000, hasFatal: true })).toBe("sev1");
    expect(inferSeverity({ count: 250, durationMs: 3_600_000, hasFatal: false })).toBe("sev2");
    expect(inferSeverity({ count: 2, durationMs: 60_000, hasFatal: false })).toBe("sev4");
  });
});

describe("bucketTimeline", () => {
  it("buckets per minute", () => {
    const b = bucketTimeline([d("2026-10-20T14:00:10Z"), d("2026-10-20T14:00:50Z"), d("2026-10-20T14:01:00Z")]);
    expect(b.map((x) => x.count)).toEqual([2, 1]);
  });
});
