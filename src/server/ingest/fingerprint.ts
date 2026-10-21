import { createHash } from "node:crypto";

/**
 * Collapses variable parts of an error message (ids, numbers, emails, urls, quoted values)
 * so that "Order 8812 failed: timeout after 3021ms" and "Order 91 failed: timeout after 15ms"
 * become the same group.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{24,64}\b/gi, "<hex>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>")
    .replace(/(["'`]).*?\1/g, "<str>")
    .replace(/\b\d+(?:\.\d+)?(ms|s|kb|mb|gb|%)?\b/gi, (_m, unit) => `<n${unit ? unit.toLowerCase() : ""}>`)
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(service: string, message: string): string {
  return createHash("sha1").update(`${service}::${normalizeMessage(message)}`).digest("hex");
}

export type GroupSummary = {
  fingerprint: string;
  service: string;
  title: string;
  level: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
};

export function groupErrors(
  logs: { service: string; message: string; level: string; timestamp: Date }[],
): GroupSummary[] {
  const groups = new Map<string, GroupSummary>();
  for (const log of logs) {
    if (log.level !== "error" && log.level !== "fatal") continue;
    const fp = fingerprint(log.service, log.message);
    const g = groups.get(fp);
    if (g) {
      g.count++;
      if (log.timestamp < g.firstSeen) g.firstSeen = log.timestamp;
      if (log.timestamp > g.lastSeen) g.lastSeen = log.timestamp;
    } else {
      groups.set(fp, {
        fingerprint: fp,
        service: log.service,
        title: normalizeMessage(log.message).slice(0, 200),
        level: log.level,
        count: 1,
        firstSeen: log.timestamp,
        lastSeen: log.timestamp,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
