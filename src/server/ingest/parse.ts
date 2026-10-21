import { z } from "zod";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type ParsedLog = {
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  traceId?: string;
  sourceFile?: string;
  lineNumber?: number;
  attributes: Record<string, unknown>;
};

const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  notice: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  err: "error",
  critical: "fatal",
  fatal: "fatal",
  panic: "fatal",
};

export function normalizeLevel(raw: unknown): LogLevel {
  if (typeof raw === "number") {
    // pino / bunyan numeric levels
    if (raw >= 60) return "fatal";
    if (raw >= 50) return "error";
    if (raw >= 40) return "warn";
    if (raw >= 30) return "info";
    return "debug";
  }
  return LEVEL_ALIASES[String(raw ?? "info").toLowerCase()] ?? "info";
}

const RESERVED = new Set([
  "timestamp", "time", "@timestamp", "level", "severity", "service",
  "msg", "message", "trace_id", "traceId", "file", "line",
]);

const JsonLine = z.looseObject({
  timestamp: z.union([z.string(), z.number()]).optional(),
  time: z.union([z.string(), z.number()]).optional(),
  "@timestamp": z.string().optional(),
  level: z.union([z.string(), z.number()]).optional(),
  severity: z.string().optional(),
  service: z.string().optional(),
  msg: z.string().optional(),
  message: z.string().optional(),
  trace_id: z.string().optional(),
  traceId: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
});

// e.g. "<ISO-8601 timestamp> ERROR [payment-service] message..."
const TEXT_LINE =
  /^(?<ts>\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)\s+(?<level>[A-Za-z]+)\s+\[(?<service>[^\]]+)\]\s+(?<msg>.*)$/;

export function parseLine(line: string, defaultService = "unknown"): ParsedLog | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return null;
    }
    const res = JsonLine.safeParse(raw);
    if (!res.success) return null;
    const obj = res.data;
    const ts = obj.timestamp ?? obj.time ?? obj["@timestamp"];
    const message = obj.message ?? obj.msg;
    if (!message) return null;
    const attributes = Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).filter(([k]) => !RESERVED.has(k)),
    );
    return {
      timestamp: ts !== undefined ? new Date(ts) : new Date(),
      level: normalizeLevel(obj.level ?? obj.severity),
      service: obj.service ?? defaultService,
      message,
      traceId: obj.trace_id ?? obj.traceId,
      sourceFile: obj.file,
      lineNumber: obj.line,
      attributes,
    };
  }

  const m = TEXT_LINE.exec(trimmed);
  if (m?.groups) {
    return {
      timestamp: new Date(m.groups.ts),
      level: normalizeLevel(m.groups.level),
      service: m.groups.service,
      message: m.groups.msg,
      attributes: {},
    };
  }
  return null;
}

export function parseLogFile(content: string, defaultService?: string) {
  const parsed: ParsedLog[] = [];
  let rejected = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = parseLine(line, defaultService);
    if (p && !Number.isNaN(p.timestamp.getTime())) parsed.push(p);
    else rejected++;
  }
  return { parsed, rejected };
}
