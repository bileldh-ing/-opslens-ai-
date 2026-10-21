import { describe, expect, it } from "vitest";
import { normalizeLevel, parseLine, parseLogFile } from "@/server/ingest/parse";

describe("parseLine", () => {
  it("parses JSON logs and keeps extra fields as attributes", () => {
    const p = parseLine('{"timestamp":"2026-10-20T14:04:00Z","level":"ERROR","service":"pay","message":"boom","trace_id":"t1","pool_active":20}');
    expect(p).toMatchObject({ level: "error", service: "pay", message: "boom", traceId: "t1", attributes: { pool_active: 20 } });
  });
  it("parses plain-text logs", () => {
    const p = parseLine("2026-10-20T14:04:00Z WARN [checkout-api] slow upstream");
    expect(p).toMatchObject({ level: "warn", service: "checkout-api", message: "slow upstream" });
  });
  it("maps numeric pino levels", () => {
    expect(normalizeLevel(50)).toBe("error");
    expect(normalizeLevel(60)).toBe("fatal");
  });
  it("rejects garbage without throwing", () => {
    expect(parseLine("not a log line")).toBeNull();
    expect(parseLogFile("garbage\n{bad json\n").rejected).toBe(2);
  });
});
