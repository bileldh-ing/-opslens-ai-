import { createInvestigationTools } from "./tools";
import { tokenize } from "./embeddings";
import { normalizeMessage } from "../ingest/fingerprint";
import type { InvestigationReport } from "./report";

/**
 * Deterministic triage analyst.
 *
 * Runs the same project-scoped tools as the LLM agent, in a fixed order, and assembles a
 * structured report from rule-based evidence (error dominance, deploy proximity, runbook
 * matches, similar past incidents). It is used:
 *   - when no model provider is configured (demo mode works end to end offline), and
 *   - as the baseline the LLM agent is compared against in the eval harness.
 *
 * Its output goes through the same citation verification as the LLM's.
 */

type Tools = ReturnType<typeof createInvestigationTools>;
type ToolName = keyof Tools;

export type TriageStep = { toolName: ToolName; input: Record<string, unknown>; output: unknown };

type ErrorGroup = {
  id: string;
  title: string;
  service: string | null;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  sampleLog: { id: string; message: string } | null;
};
type Deployment = { id: string; version: string; commitSha: string; changelog: string | null; deployedAt: Date; deployedBy: string | null };
type LogRow = { id: string; timestamp: Date; level: string; service: string | null; message: string };
type DocRow = { id: string; document: string; sourceType: string; content: string; similarity: number };
type PastIncident = { id: string; title: string; status: string; rootCause: string | null; similarity: number };

const DEPLOY_WINDOW_MIN = 60;
const clip = (s: string, n = 380) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const minutesBetween = (a: Date, b: Date) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

const GENERIC = new Set(
  "service services error errors failure failures failing started start returning return after before last deploy deployment deployments related why what when cause issue problem production prod".split(" "),
);

/**
 * Puts the error group the question is about first: the group whose title shares the most
 * specific words with the question, falling back to frequency order.
 */
export function focusOnQuestion<T extends { title: string; occurrences: number }>(
  groups: T[],
  question: string,
  exclude: Iterable<string> = [],
): T[] {
  const q = new Set(focusTerms(question, exclude));
  if (q.size === 0) return groups;
  const score = (g: T) => tokenize(g.title).filter((t) => q.has(t)).length;
  return [...groups].sort((a, b) => score(b) - score(a) || b.occurrences - a.occurrences);
}

/**
 * Moves downstream symptoms ("Upstream payment-service returned 500" logged by checkout-api)
 * behind the errors of the service they point at, so the analysis starts at the source.
 */
export function rootCauseFirst<T extends { title: string; service: string | null; occurrences: number }>(groups: T[]): T[] {
  const services = new Set(groups.map((g) => g.service).filter((s): s is string => Boolean(s)));
  const isSymptom = (g: T) => [...services].some((svc) => svc !== g.service && g.title.toLowerCase().includes(svc));
  return [...groups].sort((a, b) => Number(isSymptom(a)) - Number(isSymptom(b)) || b.occurrences - a.occurrences);
}

/** Specific words of the question (not "service", "error", "after"...), used to focus retrieval. */
export function focusTerms(question: string, exclude: Iterable<string> = []): string[] {
  const skip = new Set(exclude);
  return [...new Set(tokenize(question).filter((t) => t.length >= 4 && !GENERIC.has(t) && !skip.has(t)))];
}

export async function runTriage(opts: {
  projectId: string;
  question: string;
  incidentId?: string;
  seen: Set<string>;
  onStep?: (step: TriageStep) => void | Promise<void>;
}): Promise<InvestigationReport> {
  const tools = createInvestigationTools(opts.projectId, opts.seen);
  let callCount = 0;

  async function call<T>(toolName: ToolName, input: Record<string, unknown>): Promise<T> {
    const t = tools[toolName] as unknown as {
      execute: (input: unknown, options: { toolCallId: string; messages: [] }) => Promise<T>;
    };
    const output = await t.execute(input, { toolCallId: `triage-${callCount++}`, messages: [] });
    await opts.onStep?.({ toolName, input, output });
    return output;
  }

  // A service named in the question ("search-indexer") scopes the investigation to it.
  const namedService = opts.question.toLowerCase().match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/)?.[0];
  const { groups: found } = await call<{ groups: ErrorGroup[] }>("list_error_groups", {
    limit: 5,
    ...(namedService ? { service: namedService } : {}),
  });
  // "payment service" in plain words also scopes to payment-service.
  const q = opts.question.toLowerCase();
  const spokenService = namedService
    ? undefined
    : [...new Set(found.map((g) => g.service).filter(Boolean))].find((svc) => q.includes(svc!.replace(/-/g, " ")));
  const scoped = spokenService ? found.filter((g) => g.service === spokenService) : found;
  // Service names say where to look, not what went wrong: keep them out of the focus terms.
  const serviceWords = new Set(found.flatMap((g) => tokenize(g.service ?? "")).concat(namedService ? tokenize(namedService) : []));
  const groups = focusOnQuestion(rootCauseFirst(scoped), opts.question, serviceWords);

  if (groups.length === 0) {
    const keywords = tokenize(opts.question).slice(0, 5).join(" ") || "error";
    const { logs } = await call<{ logs: LogRow[] }>("search_logs", { query: keywords, limit: 10 });
    return {
      summary: namedService
        ? `No recurring errors were found for ${namedService}, so there is not enough evidence to name a cause.`
        : "No recurring error groups were found in this project, so there is not enough evidence to name a cause.",
      status: "insufficient_data",
      hypotheses: [],
      unknowns: [
        logs.length ? `${logs.length} log line(s) matched the question, but none form a recurring error pattern.` : "No log lines matched the question.",
        "Ingest logs covering the time window of the problem, plus recent deployments, then re-run the investigation.",
      ],
      nextSteps: ["Upload logs for the affected service and time window.", "Record recent deployments for the service."],
      remediations: [],
    };
  }

  const total = groups.reduce((n, g) => n + g.occurrences, 0);
  const top = groups[0];
  const share = top.occurrences / total;
  const service = top.service ?? "unknown-service";

  const { deployments } = await call<{ deployments: Deployment[] }>("get_deployments", { service, limit: 5 });
  const before = deployments
    .filter((d) => new Date(d.deployedAt) <= new Date(top.firstSeen))
    .sort((a, b) => +new Date(b.deployedAt) - +new Date(a.deployedAt));
  const suspect = before[0] && minutesBetween(before[0].deployedAt, top.firstSeen) <= DEPLOY_WINDOW_MIN ? before[0] : undefined;
  const previous = suspect ? before[1] : undefined;
  const gap = suspect ? minutesBetween(suspect.deployedAt, top.firstSeen) : undefined;

  const keywords = tokenize(top.title).filter((t) => !/^\d+$/.test(t)).slice(0, 4).join(" ");
  const { logs } = await call<{ logs: LogRow[] }>("search_logs", { query: keywords || top.title, service: top.service ?? undefined, limit: 5 });
  const { results: docs } = await call<{ results: DocRow[] }>("search_docs", { query: `${top.title} ${opts.question}`, limit: 3 });
  const { incidents: past } = await call<{ incidents: PastIncident[] }>("search_past_incidents", {
    query: top.title,
    excludeIncidentId: opts.incidentId,
  });
  const similarPast = past.find((p) => p.similarity >= 0.35 && p.status === "resolved");

  const sampleEvidence = top.sampleLog
    ? [{ type: "log" as const, id: top.sampleLog.id, excerpt: clip(top.sampleLog.message) }]
    : [];
  const logEvidence = logs
    .filter((l) => l.id !== top.sampleLog?.id)
    .slice(0, 2)
    .map((l) => ({ type: "log" as const, id: l.id, excerpt: clip(`${l.level.toUpperCase()} ${l.message}`) }));
  const docEvidence = docs.slice(0, 1).map((d) => ({ type: "doc" as const, id: d.id, excerpt: clip(d.content) }));
  const pastEvidence = similarPast
    ? [{ type: "incident" as const, id: similarPast.id, excerpt: clip(`${similarPast.title}. Root cause: ${similarPast.rootCause ?? "not recorded"}`) }]
    : [];

  // When the question is about something the top error group does not cover ("the connection pool"),
  // look for that signal in all log levels: warnings often explain errors.
  const terms = focusTerms(opts.question, serviceWords);
  const topCoversFocus = tokenize(top.title).some((t) => terms.includes(t));
  let signal: { pattern: string; logs: LogRow[]; matched: number } | undefined;
  if (terms.length && !topCoversFocus) {
    const patterns = new Map<string, { logs: LogRow[]; terms: Set<string> }>();
    for (const term of terms.slice(0, 3)) {
      const { logs: hits } = await call<{ logs: LogRow[] }>("search_logs", { query: term, limit: 20 });
      for (const log of hits) {
        const key = normalizeMessage(log.message);
        const entry = patterns.get(key) ?? { logs: [], terms: new Set<string>() };
        if (!entry.logs.some((l) => l.id === log.id)) entry.logs.push(log);
        entry.terms.add(term);
        patterns.set(key, entry);
      }
    }
    const best = [...patterns.entries()].sort(
      ([, a], [, b]) => b.terms.size - a.terms.size || b.logs.length - a.logs.length,
    )[0];
    if (best) signal = { pattern: best[0], logs: best[1].logs, matched: best[1].terms.size };
  }

  const hypotheses: InvestigationReport["hypotheses"] = [];

  if (suspect && gap !== undefined) {
    const confidence = Math.min(0.9, 0.45 + (gap <= 15 ? 0.2 : 0.08) + 0.15 * share + (similarPast ? 0.1 : 0));
    hypotheses.push({
      cause: `Regression introduced by ${service} ${suspect.version} (${suspect.commitSha.slice(0, 7)}), deployed ${gap} min before "${clip(top.title, 80)}" started`,
      confidence: Number(confidence.toFixed(2)),
      reasoning: `The dominant error group (${top.occurrences} of ${total} errors, ${Math.round(share * 100)}%) first appeared ${gap} minutes after this deployment and was not seen before it.${suspect.changelog ? ` The changelog reads: "${clip(suspect.changelog, 160)}".` : ""}${similarPast ? " A resolved incident with a similar signature exists." : ""}`,
      evidence: [
        { type: "deployment", id: suspect.id, excerpt: clip(`${suspect.version} ${suspect.commitSha.slice(0, 7)}: ${suspect.changelog ?? "no changelog"}`) },
        ...sampleEvidence,
        ...logEvidence,
        ...pastEvidence,
      ],
      counterEvidence: [
        "Timing correlation alone does not prove causation; a dependency or traffic change in the same window would look identical.",
      ],
    });
  }

  hypotheses.push({
    cause: suspect
      ? `Downstream dependency or capacity problem surfacing as "${clip(top.title, 80)}", independent of the deploy`
      : `Recurring failure "${clip(top.title, 80)}" in ${service} with no deployment in the preceding ${DEPLOY_WINDOW_MIN} minutes`,
    confidence: Number((suspect ? 0.2 : 0.3 + 0.2 * share).toFixed(2)),
    reasoning: suspect
      ? "Kept as an alternative: the logs show the failing call but not why the dependency slowed down."
      : `This group accounts for ${Math.round(share * 100)}% of errors, but no deployment explains its start, so a dependency, configuration or capacity change is more likely.`,
    evidence: [...sampleEvidence, ...logEvidence.slice(0, 1), ...docEvidence],
    counterEvidence: [],
  });

  if (signal) {
    const changelog = suspect?.changelog?.toLowerCase() ?? "";
    const linked = Boolean(suspect && terms.some((t) => changelog.includes(t)));
    const level = signal.logs[0].level;
    hypotheses.unshift({
      cause: `Contributing factor: "${clip(signal.pattern, 90)}" (${signal.logs.length} ${level} lines)${linked ? `, made worse by ${suspect!.version}` : ""}`,
      confidence: linked ? 0.6 : 0.3,
      reasoning: linked
        ? `${signal.logs.length} log lines match the question, and ${suspect!.version}'s changelog changes the same component: "${clip(suspect!.changelog!, 160)}". This likely amplifies the primary failure "${clip(top.title, 80)}".`
        : `${signal.logs.length} log lines match the question, but nothing links them to a change, so their role is unproven.`,
      evidence: [
        ...signal.logs.slice(0, 2).map((l) => ({ type: "log" as const, id: l.id, excerpt: clip(`${l.level.toUpperCase()} ${l.message}`) })),
        ...(linked ? [{ type: "deployment" as const, id: suspect!.id, excerpt: clip(`${suspect!.version}: ${suspect!.changelog}`) }] : []),
      ],
      counterEvidence: [`"${clip(top.title, 80)}" remains the dominant error; this signal may be a consequence rather than a cause.`],
    });
  }

  const second = groups[1];
  if (second && second.occurrences / total >= 0.2 && second.sampleLog) {
    hypotheses.push({
      cause: `Secondary failure "${clip(second.title, 80)}" (${second.service ?? "unknown"}) may be a cascade of the primary error`,
      confidence: 0.15,
      reasoning: `${second.occurrences} occurrences, first seen ${minutesBetween(top.firstSeen, second.firstSeen)} min after the primary group.`,
      evidence: [{ type: "log", id: second.sampleLog.id, excerpt: clip(second.sampleLog.message) }],
      counterEvidence: [],
    });
  }

  const remediations: InvestigationReport["remediations"] = [];
  if (suspect && previous) {
    remediations.push({
      kind: "suggested_fix",
      title: `Roll back ${service} to ${previous.version}`,
      content: `Reversible mitigation.\n\n1. Roll back ${service} from ${suspect.version} (${suspect.commitSha.slice(0, 7)}) to ${previous.version} (${previous.commitSha.slice(0, 7)}).\n2. Watch the "${clip(top.title, 80)}" rate for 15 minutes.\n3. If the rate returns to baseline, open a fix for the change in ${suspect.version}.`,
      riskLevel: "medium",
    });
  }
  if (docs[0]) {
    remediations.push({
      kind: "runbook",
      title: `Follow runbook: ${docs[0].document}`,
      content: clip(docs[0].content, 1200),
      riskLevel: "low",
    });
  }
  remediations.push({
    kind: "test_query",
    title: "Confirm the error rate per minute (read-only)",
    content: `SELECT date_trunc('minute', timestamp) AS minute, count(*)\nFROM log_events\nWHERE error_group_id = '${top.id}'\nGROUP BY 1 ORDER BY 1;`,
    riskLevel: "low",
  });

  const status: InvestigationReport["status"] = suspect && hypotheses[0].confidence >= 0.5 ? "likely_cause_found" : "inconclusive";

  return {
    summary: suspect
      ? `"${clip(top.title, 100)}" in ${service} began ${gap} min after ${suspect.version} was deployed and makes up ${Math.round(share * 100)}% of errors. The deployment is the most likely cause.`
      : `"${clip(top.title, 100)}" in ${service} dominates the errors (${Math.round(share * 100)}%), but no recent deployment explains it. The cause is not established.`,
    status,
    hypotheses,
    unknowns: [
      "Produced by deterministic triage (no language model configured): reasoning is rule-based on timing, frequency and retrieval.",
      ...(docs.length ? [] : ["No runbook or architecture doc matched this error."]),
      ...(suspect ? [`The code diff of ${suspect.commitSha.slice(0, 7)} was not inspected.`] : []),
    ],
    nextSteps: [
      ...(suspect ? [`Review the diff of ${suspect.commitSha.slice(0, 7)} for changes touching this code path.`] : []),
      "Check the health and latency of downstream dependencies in the same window.",
      "Run the read-only query to confirm when the error rate started and whether it is still elevated.",
    ],
    remediations,
  };
}
