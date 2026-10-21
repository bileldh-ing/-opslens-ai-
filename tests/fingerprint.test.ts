import { describe, expect, it } from "vitest";
import { fingerprint, groupErrors, normalizeMessage } from "@/server/ingest/fingerprint";

describe("normalizeMessage", () => {
  it("collapses ids, numbers, durations and quoted values", () => {
    expect(normalizeMessage('Order 8812 failed after 3021ms for "alice@x.io"')).toBe("Order <n> failed after <nms> for <str>");
    expect(normalizeMessage("user 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found")).toBe("user <uuid> not found");
  });
});

describe("fingerprint", () => {
  it("is stable across variable parts and scoped per service", () => {
    const a = fingerprint("pay", "timeout after 2000ms (order 1)");
    const b = fingerprint("pay", "timeout after 2003ms (order 99812)");
    expect(a).toBe(b);
    expect(fingerprint("checkout", "timeout after 2000ms (order 1)")).not.toBe(a);
  });
});

describe("groupErrors", () => {
  it("groups only errors, counts and tracks first/last seen", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 9, 20, 14, m));
    const groups = groupErrors([
      { service: "pay", level: "error", message: "timeout 1ms", timestamp: t(5) },
      { service: "pay", level: "error", message: "timeout 9ms", timestamp: t(1) },
      { service: "pay", level: "info", message: "ok", timestamp: t(2) },
      { service: "pay", level: "fatal", message: "OOM killed", timestamp: t(3) },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(2);
    expect(groups[0].firstSeen).toEqual(t(1));
    expect(groups[0].lastSeen).toEqual(t(5));
  });
});
