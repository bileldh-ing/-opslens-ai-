import { z } from "zod";

/**
 * Converts the JSON encoding of OTLP logs (ExportLogsServiceRequest, as sent by the
 * OpenTelemetry Collector's otlphttp exporter with `encoding: json`) into the JSON-lines
 * shape the ingest pipeline already parses. Supported subset: resource `service.name`,
 * timeUnixNano / observedTimeUnixNano, severityText / severityNumber, string or structured
 * body, traceId/spanId and attributes. Unknown fields are ignored, never rejected.
 */
const AnyValue: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      stringValue: z.string().optional(),
      boolValue: z.boolean().optional(),
      intValue: z.union([z.string(), z.number()]).optional(),
      doubleValue: z.number().optional(),
      arrayValue: z.object({ values: z.array(AnyValue).optional() }).optional(),
      kvlistValue: z.object({ values: z.array(z.object({ key: z.string(), value: AnyValue.optional() })).optional() }).optional(),
    })
    .loose(),
);

const KeyValue = z.object({ key: z.string(), value: AnyValue.optional() });

const LogRecord = z
  .object({
    timeUnixNano: z.union([z.string(), z.number()]).optional(),
    observedTimeUnixNano: z.union([z.string(), z.number()]).optional(),
    severityNumber: z.number().optional(),
    severityText: z.string().optional(),
    body: AnyValue.optional(),
    attributes: z.array(KeyValue).optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
  })
  .loose();

export const OtlpLogsRequest = z.object({
  resourceLogs: z.array(
    z
      .object({
        resource: z.object({ attributes: z.array(KeyValue).optional() }).loose().optional(),
        scopeLogs: z.array(z.object({ logRecords: z.array(LogRecord).optional() }).loose()).optional(),
      })
      .loose(),
  ),
});

export function isOtlpLogs(body: unknown): boolean {
  // Any object carrying `resourceLogs` is treated as OTLP and validated strictly.
  return typeof body === "object" && body !== null && !Array.isArray(body) && "resourceLogs" in body;
}

export function anyValueToJs(v: unknown): unknown {
  if (!v || typeof v !== "object") return v ?? null;
  const o = v as Record<string, unknown>;
  if ("stringValue" in o) return o.stringValue;
  if ("boolValue" in o) return o.boolValue;
  if ("intValue" in o) return Number(o.intValue);
  if ("doubleValue" in o) return o.doubleValue;
  if ("arrayValue" in o) return ((o.arrayValue as { values?: unknown[] })?.values ?? []).map(anyValueToJs);
  if ("kvlistValue" in o) {
    const values = (o.kvlistValue as { values?: Array<{ key: string; value?: unknown }> })?.values ?? [];
    return Object.fromEntries(values.map((kv) => [kv.key, anyValueToJs(kv.value)]));
  }
  return null;
}

function attrs(list: Array<{ key: string; value?: unknown }> | undefined): Record<string, unknown> {
  return Object.fromEntries((list ?? []).map((kv) => [kv.key, anyValueToJs(kv.value)]));
}

/** OTLP SeverityNumber: 1-4 TRACE, 5-8 DEBUG, 9-12 INFO, 13-16 WARN, 17-20 ERROR, 21-24 FATAL. */
export function severityFromNumber(n: number | undefined): string | undefined {
  if (!n) return undefined;
  if (n >= 21) return "fatal";
  if (n >= 17) return "error";
  if (n >= 13) return "warn";
  if (n >= 9) return "info";
  return "debug";
}

function nanosToIso(n: string | number | undefined): string | undefined {
  if (n === undefined || n === "" || n === 0 || n === "0") return undefined;
  try {
    const ms = Number(BigInt(String(n).split(".")[0]) / BigInt(1_000_000));
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

export function otlpToJsonLines(body: unknown): string[] {
  const req = OtlpLogsRequest.parse(body);
  const lines: string[] = [];
  for (const rl of req.resourceLogs) {
    const resource = attrs(rl.resource?.attributes);
    const service = typeof resource["service.name"] === "string" ? (resource["service.name"] as string) : undefined;
    for (const sl of rl.scopeLogs ?? []) {
      for (const rec of sl.logRecords ?? []) {
        const bodyValue = anyValueToJs(rec.body);
        const message = typeof bodyValue === "string" ? bodyValue : bodyValue == null ? "" : JSON.stringify(bodyValue);
        if (!message) continue;
        const recordAttrs = attrs(rec.attributes);
        lines.push(
          JSON.stringify({
            ...recordAttrs,
            timestamp: nanosToIso(rec.timeUnixNano) ?? nanosToIso(rec.observedTimeUnixNano) ?? new Date().toISOString(),
            level: rec.severityText || severityFromNumber(rec.severityNumber) || "info",
            service,
            message,
            trace_id: rec.traceId || undefined,
            ...(rec.spanId ? { span_id: rec.spanId } : {}),
          }),
        );
      }
    }
  }
  return lines;
}

/**
 * Normalises any supported request body into JSON-lines text for the pipeline:
 *  - OTLP logs JSON ({ resourceLogs: [...] })
 *  - a JSON array of log objects, or { logs: [...] }
 *  - newline-delimited JSON / plain text lines (passed through)
 */
export function bodyToLogText(raw: string, contentType: string): { text: string; format: "otlp" | "json-array" | "ndjson" } {
  const ct = contentType.toLowerCase();
  const trimmed = raw.trim();
  const singleDoc = !trimmed.includes("\n");
  if (trimmed.startsWith("[") || (trimmed.startsWith("{") && (ct.includes("application/json") || singleDoc))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { text: raw, format: "ndjson" }; // NDJSON sent with a JSON content type
    }
    if (isOtlpLogs(parsed)) return { text: otlpToJsonLines(parsed).join("\n"), format: "otlp" };
    const logs = (parsed as { logs?: unknown })?.logs;
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(logs) ? logs : [parsed];
    return { text: arr.map((x) => JSON.stringify(x)).join("\n"), format: "json-array" };
  }
  return { text: raw, format: "ndjson" };
}
