/**
 * Minimal structured logger: one JSON object per line on stdout/stderr, ready for any log
 * pipeline (including OpsLens's own ingest endpoint). No dependencies.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, unknown>;
export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return err;
}

export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

function defaultLevel(): LogLevel | "silent" {
  const fromEnv = process.env.LOG_LEVEL as LogLevel | "silent" | undefined;
  if (fromEnv && fromEnv in ORDER) return fromEnv;
  return process.env.NODE_ENV === "test" ? "silent" : "info";
}

export function createLogger(opts: { level?: LogLevel | "silent"; base?: LogFields; sink?: LogSink } = {}): Logger {
  const level = opts.level ?? defaultLevel();
  const threshold = ORDER[level];
  const base = { service: "opslens", ...opts.base };
  const sink = opts.sink ?? defaultSink;
  const write = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[lvl] < threshold) return;
    const entry: LogFields = { timestamp: new Date().toISOString(), level: lvl, msg, ...base, ...fields };
    if ("err" in entry) entry.err = serializeError(entry.err);
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ timestamp: entry.timestamp, level: lvl, msg, note: "unserializable fields" });
    }
    sink(line, lvl);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ level, base: { ...base, ...fields }, sink }),
  };
}

export const logger = createLogger();

export const REQUEST_ID_HEADER = "x-request-id";

/** Logger bound to the request id that src/proxy.ts stamps on every request. */
export function requestLogger(req: Request, fields: LogFields = {}): Logger {
  const url = new URL(req.url);
  return logger.child({ requestId: req.headers.get(REQUEST_ID_HEADER) ?? undefined, method: req.method, path: url.pathname, ...fields });
}

/** Client IP from the first X-Forwarded-For hop (set by the reverse proxy), else X-Real-IP. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}
