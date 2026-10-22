import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseLogFile } from "./parse";
import { fingerprint, normalizeMessage } from "./fingerprint";
import { inferSeverity, suspectDeployment } from "./correlate";
import { chunkText, estimateTokens } from "./chunk";
import { embedText, embedTexts } from "../ai/embeddings";
import { sha256 } from "@/lib/utils";
import { incidentPayloads, notify } from "../integrations/webhooks";

type Service = typeof schema.services.$inferSelect;

async function ensureService(projectId: string, name: string): Promise<Service> {
  const [existing] = await db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.projectId, projectId), eq(schema.services.name, name)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(schema.services)
    .values({ projectId, name })
    .onConflictDoNothing()
    .returning();
  return created ?? (await ensureService(projectId, name));
}

/**
 * Ingests a raw log file: parse → upsert error groups → insert events (batched) →
 * open/attach incidents and link the suspected deployment.
 */
export async function ingestLogs(projectId: string, content: string, defaultService?: string) {
  const { parsed, rejected } = parseLogFile(content, defaultService);
  const serviceIds = new Map<string, string>();
  for (const name of new Set(parsed.map((p) => p.service))) {
    serviceIds.set(name, (await ensureService(projectId, name)).id);
  }

  const groupIds = new Map<string, string>();
  const errorLogs = parsed.filter((p) => p.level === "error" || p.level === "fatal");
  for (const log of errorLogs) {
    const fp = fingerprint(log.service, log.message);
    const [row] = await db
      .insert(schema.errorGroups)
      .values({
        projectId,
        serviceId: serviceIds.get(log.service),
        fingerprint: fp,
        title: normalizeMessage(log.message).slice(0, 200),
        level: log.level,
        occurrences: 1,
        firstSeen: log.timestamp,
        lastSeen: log.timestamp,
      })
      .onConflictDoUpdate({
        target: [schema.errorGroups.projectId, schema.errorGroups.fingerprint],
        set: {
          occurrences: sql`${schema.errorGroups.occurrences} + 1`,
          firstSeen: sql`least(${schema.errorGroups.firstSeen}, excluded.first_seen)`,
          lastSeen: sql`greatest(${schema.errorGroups.lastSeen}, excluded.last_seen)`,
        },
      })
      .returning({ id: schema.errorGroups.id });
    groupIds.set(fp, row.id);
  }

  const BATCH = 500;
  for (let i = 0; i < parsed.length; i += BATCH) {
    await db.insert(schema.logEvents).values(
      parsed.slice(i, i + BATCH).map((p) => ({
        projectId,
        serviceId: serviceIds.get(p.service),
        errorGroupId:
          p.level === "error" || p.level === "fatal" ? groupIds.get(fingerprint(p.service, p.message)) : null,
        timestamp: p.timestamp,
        level: p.level,
        message: p.message,
        attributes: p.attributes,
        traceId: p.traceId,
        sourceFile: p.sourceFile,
        lineNumber: p.lineNumber,
      })),
    );
  }

  const incidentIds = await detectIncidents(projectId, [...new Set(groupIds.values())]);
  return { accepted: parsed.length, rejected, errorGroups: groupIds.size, incidents: incidentIds };
}

/** Opens one incident per service whose error groups have no open incident yet. */
export async function detectIncidents(projectId: string, groupIds: string[]) {
  if (groupIds.length === 0) return [];
  const groups = await db.select().from(schema.errorGroups).where(inArray(schema.errorGroups.id, groupIds));
  const byService = Map.groupBy(groups, (g) => g.serviceId ?? "none");
  const created: string[] = [];

  for (const [serviceId, svcGroups] of byService) {
    const linked = await db
      .select({ incidentId: schema.incidentErrorGroups.incidentId })
      .from(schema.incidentErrorGroups)
      .innerJoin(schema.incidents, eq(schema.incidents.id, schema.incidentErrorGroups.incidentId))
      .where(
        and(
          inArray(schema.incidentErrorGroups.errorGroupId, svcGroups.map((g) => g.id)),
          inArray(schema.incidents.status, ["open", "investigating"]),
        ),
      )
      .limit(1);
    if (linked.length) continue;

    const total = svcGroups.reduce((n, g) => n + g.occurrences, 0);
    if (total < 5) continue; // noise floor

    const firstSeen = new Date(Math.min(...svcGroups.map((g) => g.firstSeen.getTime())));
    const lastSeen = new Date(Math.max(...svcGroups.map((g) => g.lastSeen.getTime())));
    const top = [...svcGroups].sort((a, b) => b.occurrences - a.occurrences)[0];

    let suspect: Awaited<ReturnType<typeof suspectDeployment>> = null;
    if (serviceId !== "none") {
      const deps = await db
        .select()
        .from(schema.deployments)
        .where(and(eq(schema.deployments.serviceId, serviceId), lte(schema.deployments.deployedAt, firstSeen)));
      suspect = suspectDeployment(firstSeen, deps);
    }

    const summary = `${total} errors across ${svcGroups.length} group(s); most frequent: "${top.title}".`;
    const [incident] = await db
      .insert(schema.incidents)
      .values({
        projectId,
        serviceId: serviceId === "none" ? null : serviceId,
        suspectedDeploymentId: suspect?.deployment.id ?? null,
        title: top.title.slice(0, 120),
        summary,
        severity: inferSeverity({
          count: total,
          durationMs: lastSeen.getTime() - firstSeen.getTime(),
          hasFatal: svcGroups.some((g) => g.level === "fatal"),
        }),
        startedAt: firstSeen,
        summaryEmbedding: await embedText(summary),
      })
      .returning();

    await db
      .insert(schema.incidentErrorGroups)
      .values(svcGroups.map((g) => ({ incidentId: incident.id, errorGroupId: g.id })));
    await db.insert(schema.incidentEvents).values([
      { incidentId: incident.id, kind: "status_change", body: "Incident opened automatically from log ingestion.", occurredAt: firstSeen },
      ...(suspect
        ? [{
            incidentId: incident.id,
            kind: "deployment",
            body: `Deployment ${suspect.deployment.version} shipped ${Math.round(suspect.gapMs / 60000)} min before the first error.`,
            occurredAt: suspect.deployment.deployedAt,
          }]
        : []),
    ]);
    created.push(incident.id);
  }
  for (const { orgId, payload } of await incidentPayloads(created)) await notify(orgId, "incident.created", payload);
  return created;
}

/** Chunks + embeds a document for retrieval. Idempotent on checksum. */
export async function indexDocument(input: {
  projectId: string;
  title: string;
  sourceType: string;
  content: string;
  storageKey?: string;
  uri?: string;
}) {
  const checksum = sha256(input.content);
  const [doc] = await db
    .insert(schema.documents)
    .values({ ...input, checksum })
    .returning();
  const chunks = chunkText(input.content);
  const embeddings = await embedTexts(chunks);
  if (chunks.length) {
    await db.insert(schema.documentChunks).values(
      chunks.map((content, ordinal) => ({
        documentId: doc.id,
        projectId: input.projectId,
        ordinal,
        content,
        tokenCount: estimateTokens(content),
        embedding: embeddings[ordinal],
      })),
    );
  }
  await db.update(schema.documents).set({ indexedAt: new Date() }).where(eq(schema.documents.id, doc.id));
  return { documentId: doc.id, chunks: chunks.length };
}

