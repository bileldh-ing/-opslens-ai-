import { describe, expect, it } from "vitest";
import { bodyToLogText, otlpToJsonLines, severityFromNumber } from "@/server/ingest/otlp";
import { parseLogFile } from "@/server/ingest/parse";
import { gradeReport } from "@/server/evals/grade";
import { CASES } from "@/server/evals/cases";

// These modules import the db client; keep it in memory so unit tests never touch .data/.
process.env.DATABASE_URL = "pglite://memory";
process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS = "false";
const { csvField, toCsv } = await import("@/server/export");
const { generateApiKey, KEY_PATTERN, parseBearer } = await import("@/server/integrations/api-keys");
const { assertSafeWebhookUrl, buildBody, isPrivateAddress, signPayload, verifySignature } = await import("@/server/integrations/webhooks");

const otlp = {
  resourceLogs: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout" } }] },
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: "1760000000000000000",
              severityNumber: 17,
              body: { stringValue: "card declined: upstream 502" },
              traceId: "abc123",
              attributes: [{ key: "http.status_code", value: { intValue: "502" } }],
            },
            { timeUnixNano: "1760000001000000000", severityText: "WARN", body: { kvlistValue: { values: [{ key: "msg", value: { stringValue: "slow" } }] } } },
            { severityNumber: 9, body: { stringValue: "" } },
          ],
        },
      ],
    },
  ],
};

describe("OTLP logs conversion", () => {
  it("maps resource service, severity, time, trace id and attributes", () => {
    const lines = otlpToJsonLines(otlp);
    expect(lines).toHaveLength(2); // empty body dropped
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ service: "checkout", level: "error", message: "card declined: upstream 502", trace_id: "abc123", "http.status_code": 502 });
    expect(first.timestamp).toBe(new Date(1760000000000).toISOString());
    const { parsed } = parseLogFile(lines.join("\n"));
    expect(parsed[0]).toMatchObject({ service: "checkout", level: "error", traceId: "abc123" });
    expect(parsed[1]).toMatchObject({ level: "warn", message: '{"msg":"slow"}' });
  });

  it("maps OTLP severity numbers", () => {
    expect([1, 5, 9, 13, 17, 21].map(severityFromNumber)).toEqual(["debug", "debug", "info", "warn", "error", "fatal"]);
    expect(severityFromNumber(undefined)).toBeUndefined();
  });

  it("detects every supported body format", () => {
    expect(bodyToLogText(JSON.stringify(otlp), "application/json").format).toBe("otlp");
    const arr = bodyToLogText(JSON.stringify([{ message: "a" }, { message: "b" }]), "application/json");
    expect(arr).toMatchObject({ format: "json-array" });
    expect(arr.text.split("\n")).toHaveLength(2);
    expect(bodyToLogText(JSON.stringify({ logs: [{ message: "a" }] }), "application/json").format).toBe("json-array");
    const nd = '{"message":"a"}\n{"message":"b"}';
    expect(bodyToLogText(nd, "application/x-ndjson")).toEqual({ text: nd, format: "ndjson" });
    expect(bodyToLogText(nd, "application/json").format).toBe("ndjson");
    expect(bodyToLogText("2026-01-01T00:00:00Z ERROR [api] boom", "text/plain").format).toBe("ndjson");
  });

  it("rejects malformed OTLP", () => {
    expect(() => bodyToLogText(JSON.stringify({ resourceLogs: "nope" }), "application/json")).toThrow();
  });
});

describe("ingest API keys", () => {
  it("generates well-formed keys whose hash differs from the key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(KEY_PATTERN);
    expect(a.key.startsWith(`olk_${a.prefix}_`)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.key);
    expect(a.key).not.toBe(b.key);
  });
  it("parses bearer headers strictly", () => {
    expect(parseBearer("Bearer olk_x")).toBe("olk_x");
    expect(parseBearer("bearer   olk_x ")).toBe("olk_x");
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
});

describe("webhooks", () => {
  it("signs and verifies payloads, rejecting tampering and stale timestamps", () => {
    const now = 1_760_000_000;
    const sig = signPayload("whsec_test", now, '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature("whsec_test", now, '{"a":1}', sig, 300, now)).toBe(true);
    expect(verifySignature("whsec_test", now, '{"a":2}', sig, 300, now)).toBe(false);
    expect(verifySignature("other", now, '{"a":1}', sig, 300, now)).toBe(false);
    expect(verifySignature("whsec_test", now, '{"a":1}', sig, 300, now + 301)).toBe(false);
  });

  it("classifies private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("blocks SSRF targets unless explicitly allowed", async () => {
    await expect(assertSafeWebhookUrl("http://localhost:4000/hook", false)).rejects.toThrow(/Private/);
    await expect(assertSafeWebhookUrl("http://169.254.169.254/latest/meta-data", false)).rejects.toThrow(/Private/);
    await expect(assertSafeWebhookUrl("ftp://example.com", false)).rejects.toThrow(/http/);
    await expect(assertSafeWebhookUrl("https://user:pw@example.com", false)).rejects.toThrow(/Credentials/);
    await expect(assertSafeWebhookUrl("not a url", false)).rejects.toThrow(/valid URL/);
    expect((await assertSafeWebhookUrl("http://127.0.0.1:4000/hook", true)).port).toBe("4000");
    expect((await assertSafeWebhookUrl("https://93.184.215.14/hook", false)).hostname).toBe("93.184.215.14");
  });

  it("builds Slack-compatible and generic bodies", () => {
    const data = { id: "i1", title: "PaymentGatewayTimeout", severity: "sev2", status: "open", service: "payment-service", project: "Production", url: "http://x/acme/incidents/i1" };
    const slack = buildBody("slack", "incident.created", data, "d1", new Date(0)) as { text: string; blocks: unknown[] };
    expect(slack.text).toContain("SEV2");
    expect(slack.blocks).toHaveLength(2);
    const generic = buildBody("json", "incident.created", data, "d1", new Date(0));
    expect(generic).toMatchObject({ id: "d1", event: "incident.created", data: { id: "i1" } });
  });
});

describe("CSV export", () => {
  it("quotes per RFC 4180 and neutralises formula injection", () => {
    expect(csvField('he said "hi", ok')).toBe('"he said ""hi"", ok"');
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvField("-1")).toBe("'-1");
    expect(csvField(null)).toBe("");
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
    expect(toCsv([["a", "b"], [1, "x\ny"]])).toBe('a,b\r\n1,"x\ny"\r\n');
  });
});

describe("eval grading", () => {
  const payment = CASES[0];
  const ev = (type: "log" | "deployment") => ({ type, id: "1", excerpt: "x" });
  it("passes a grounded report and fails an ungrounded one", () => {
    const good = { summary: "", status: "likely_cause_found" as const, hypotheses: [{ cause: "v2.14.0 lowered timeout to 2000ms", confidence: 0.8, reasoning: "", evidence: [ev("log"), ev("deployment")], counterEvidence: [] }], unknowns: [], nextSteps: [], remediations: [] };
    expect(gradeReport(payment, good)).toEqual([]);
    const bad = { ...good, hypotheses: [{ ...good.hypotheses[0], evidence: [ev("log")] }] };
    expect(gradeReport(payment, bad)).toContain("missing deployment citation");
    expect(gradeReport(payment, null)).toEqual(["no report submitted"]);
  });
  it("flags overconfidence when the honest answer is 'no data'", () => {
    const noData = CASES.find((c) => c.expect.maxConfidence !== undefined)!;
    const r = { summary: "", status: "inconclusive" as const, hypotheses: [{ cause: "memory", confidence: 0.9, reasoning: "", evidence: [ev("log")], counterEvidence: [] }], unknowns: [], nextSteps: [], remediations: [] };
    expect(gradeReport(noData, r).join()).toMatch(/overconfident/);
  });
});
