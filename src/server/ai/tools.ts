import { tool } from "ai";
import { z } from "zod";
import { and, cosineDistance, desc, eq, gte, ilike, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { embedText } from "./embeddings";

/**
 * Tools are scoped to one project at construction time, so the model can never
 * query another tenant's data regardless of what it asks for.
 * Every returned id is recorded in `seen` for citation verification.
 */
export function createInvestigationTools(projectId: string, seen: Set<string>) {
  const mark = (type: string, ids: string[]) => ids.forEach((id) => seen.add(`${type}:${id}`));

  return {
    search_logs: tool({
      description:
        "Full-text search over application logs in this project. Use for concrete error messages, status codes, exception names.",
      inputSchema: z.object({
        query: z.string().describe("Keywords, e.g. 'payment 500 timeout'"),
        service: z.string().optional(),
        level: z.enum(["debug", "info", "warn", "error", "fatal"]).optional(),
        from: z.string().optional().describe("ISO-8601 start time"),
        to: z.string().optional().describe("ISO-8601 end time"),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ query, service, level, from, to, limit }) => {
        const conds = [
          eq(schema.logEvents.projectId, projectId),
          sql`to_tsvector('english', ${schema.logEvents.message}) @@ plainto_tsquery('english', ${query})`,
        ];
        if (level) conds.push(eq(schema.logEvents.level, level));
        if (from) conds.push(gte(schema.logEvents.timestamp, new Date(from)));
        if (to) conds.push(lte(schema.logEvents.timestamp, new Date(to)));
        if (service) conds.push(eq(schema.services.name, service));
        const rows = await db
          .select({
            id: schema.logEvents.id,
            timestamp: schema.logEvents.timestamp,
            level: schema.logEvents.level,
            service: schema.services.name,
            message: schema.logEvents.message,
            attributes: schema.logEvents.attributes,
          })
          .from(schema.logEvents)
          .leftJoin(schema.services, eq(schema.services.id, schema.logEvents.serviceId))
          .where(and(...conds))
          .orderBy(desc(schema.logEvents.timestamp))
          .limit(limit);
        mark("log", rows.map((r) => r.id));
        return { count: rows.length, logs: rows };
      },
    }),

    list_error_groups: tool({
      description: "List recurring error groups (deduplicated by fingerprint) ordered by frequency.",
      inputSchema: z.object({ service: z.string().optional(), limit: z.number().int().max(30).default(10) }),
      execute: async ({ service, limit }) => {
        const conds = [eq(schema.errorGroups.projectId, projectId)];
        if (service) conds.push(eq(schema.services.name, service));
        const rows = await db
          .select({
            id: schema.errorGroups.id,
            title: schema.errorGroups.title,
            service: schema.services.name,
            occurrences: schema.errorGroups.occurrences,
            firstSeen: schema.errorGroups.firstSeen,
            lastSeen: schema.errorGroups.lastSeen,
          })
          .from(schema.errorGroups)
          .leftJoin(schema.services, eq(schema.services.id, schema.errorGroups.serviceId))
          .where(and(...conds))
          .orderBy(desc(schema.errorGroups.occurrences))
          .limit(limit);
        // Error groups are cited through their first sample log.
        const withSamples = await Promise.all(
          rows.map(async (g) => {
            const [sample] = await db
              .select({ id: schema.logEvents.id, message: schema.logEvents.message })
              .from(schema.logEvents)
              .where(eq(schema.logEvents.errorGroupId, g.id))
              .orderBy(schema.logEvents.timestamp)
              .limit(1);
            if (sample) mark("log", [sample.id]);
            return { ...g, sampleLog: sample ?? null };
          }),
        );
        return { groups: withSamples };
      },
    }),

    get_deployments: tool({
      description: "Recent deployments for a service, with version, commit and changelog.",
      inputSchema: z.object({ service: z.string(), limit: z.number().int().max(20).default(5) }),
      execute: async ({ service, limit }) => {
        const rows = await db
          .select({
            id: schema.deployments.id,
            version: schema.deployments.version,
            commitSha: schema.deployments.commitSha,
            changelog: schema.deployments.changelog,
            deployedAt: schema.deployments.deployedAt,
            deployedBy: schema.deployments.deployedBy,
          })
          .from(schema.deployments)
          .innerJoin(schema.services, eq(schema.services.id, schema.deployments.serviceId))
          .where(and(eq(schema.services.projectId, projectId), ilike(schema.services.name, service)))
          .orderBy(desc(schema.deployments.deployedAt))
          .limit(limit);
        mark("deployment", rows.map((r) => r.id));
        return { deployments: rows };
      },
    }),

    search_docs: tool({
      description: "Semantic search over runbooks, architecture docs, code and postmortems (vector search).",
      inputSchema: z.object({ query: z.string(), limit: z.number().int().max(10).default(5) }),
      execute: async ({ query, limit }) => {
        const vec = await embedText(query);
        const similarity = sql<number>`1 - (${cosineDistance(schema.documentChunks.embedding, vec)})`;
        const rows = await db
          .select({
            id: schema.documentChunks.id,
            document: schema.documents.title,
            sourceType: schema.documents.sourceType,
            content: schema.documentChunks.content,
            similarity,
          })
          .from(schema.documentChunks)
          .innerJoin(schema.documents, eq(schema.documents.id, schema.documentChunks.documentId))
          .where(eq(schema.documentChunks.projectId, projectId))
          .orderBy(desc(similarity))
          .limit(limit);
        const relevant = rows.filter((r) => r.similarity > 0.25);
        mark("doc", relevant.map((r) => r.id));
        return { results: relevant, note: relevant.length ? undefined : "No sufficiently relevant documents found." };
      },
    }),

    search_past_incidents: tool({
      description: "Find similar resolved incidents and their root causes (vector search over incident summaries).",
      inputSchema: z.object({ query: z.string(), excludeIncidentId: z.string().optional() }),
      execute: async ({ query, excludeIncidentId }) => {
        const vec = await embedText(query);
        const similarity = sql<number>`1 - (${cosineDistance(schema.incidents.summaryEmbedding, vec)})`;
        const conds = [eq(schema.incidents.projectId, projectId), sql`${schema.incidents.summaryEmbedding} is not null`];
        if (excludeIncidentId) conds.push(ne(schema.incidents.id, excludeIncidentId));
        const rows = await db
          .select({
            id: schema.incidents.id,
            title: schema.incidents.title,
            status: schema.incidents.status,
            rootCause: schema.incidents.rootCause,
            startedAt: schema.incidents.startedAt,
            similarity,
          })
          .from(schema.incidents)
          .where(and(...conds))
          .orderBy(desc(similarity))
          .limit(5);
        mark("incident", rows.map((r) => r.id));
        return { incidents: rows };
      },
    }),
  };
}
