import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const roleEnum = pgEnum("role", ["owner", "admin", "member", "viewer"]);
export const planEnum = pgEnum("plan", ["free", "team", "enterprise"]);
export const severityEnum = pgEnum("severity", ["sev1", "sev2", "sev3", "sev4"]);
export const incidentStatusEnum = pgEnum("incident_status", [
  "open",
  "investigating",
  "mitigated",
  "resolved",
]);
export const logLevelEnum = pgEnum("log_level", ["debug", "info", "warn", "error", "fatal"]);
export const remediationKindEnum = pgEnum("remediation_kind", [
  "runbook",
  "test_query",
  "suggested_fix",
  "draft_patch",
]);
export const remediationStatusEnum = pgEnum("remediation_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "executed",
]);
export const investigationStatusEnum = pgEnum("investigation_status", [
  "running",
  "completed",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const EMBEDDING_DIMENSIONS = 1536;

/* ------------------------------------------------------------------ */
/* Identity & SaaS workspace                                           */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the opaque session token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").default("free").notNull(),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...timestamps,
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").default("member").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invitations_org_idx").on(t.orgId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [uniqueIndex("projects_org_slug_idx").on(t.orgId, t.slug)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // e.g. "remediation.approve"
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_org_created_idx").on(t.orgId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Incident intelligence                                               */
/* ------------------------------------------------------------------ */

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    repoUrl: text("repo_url"),
    ...timestamps,
  },
  (t) => [uniqueIndex("services_project_name_idx").on(t.projectId, t.name)],
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    commitSha: text("commit_sha"),
    changelog: text("changelog"),
    deployedBy: text("deployed_by"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("deployments_service_time_idx").on(t.serviceId, t.deployedAt)],
);

/** Recurring errors collapsed by a normalized fingerprint. */
export const errorGroups = pgTable(
  "error_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    level: logLevelEnum("level").notNull(),
    occurrences: integer("occurrences").default(0).notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("error_groups_project_fp_idx").on(t.projectId, t.fingerprint)],
);

export const logEvents = pgTable(
  "log_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    errorGroupId: uuid("error_group_id").references(() => errorGroups.id, { onDelete: "set null" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    level: logLevelEnum("level").notNull(),
    message: text("message").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}).notNull(),
    traceId: text("trace_id"),
    sourceFile: text("source_file"),
    lineNumber: integer("line_number"),
  },
  (t) => [
    index("log_events_project_time_idx").on(t.projectId, t.timestamp),
    index("log_events_group_idx").on(t.errorGroupId),
    index("log_events_message_fts_idx").using("gin", sql`to_tsvector('english', ${t.message})`),
  ],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    suspectedDeploymentId: uuid("suspected_deployment_id").references(() => deployments.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    summary: text("summary"),
    severity: severityEnum("severity").default("sev3").notNull(),
    status: incidentStatusEnum("status").default("open").notNull(),
    rootCause: text("root_cause"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    summaryEmbedding: vector("summary_embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    ...timestamps,
  },
  (t) => [
    index("incidents_project_status_idx").on(t.projectId, t.status),
    index("incidents_embedding_idx").using("hnsw", t.summaryEmbedding.op("vector_cosine_ops")),
  ],
);

export const incidentErrorGroups = pgTable(
  "incident_error_groups",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    errorGroupId: uuid("error_group_id")
      .notNull()
      .references(() => errorGroups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.errorGroupId] })],
);

/** Timeline entries: status changes, notes, deploys, AI findings. */
export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // status_change | note | deployment | ai_finding | remediation
    body: text("body").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("incident_events_incident_idx").on(t.incidentId, t.occurredAt)],
);

/* ------------------------------------------------------------------ */
/* Knowledge base (RAG)                                                */
/* ------------------------------------------------------------------ */

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(), // runbook | doc | code | postmortem
  storageKey: text("storage_key"), // object storage key for the original upload
  uri: text("uri"),
  checksum: text("checksum").notNull(),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
  ...timestamps,
});

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (t) => [
    index("chunks_project_idx").on(t.projectId),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/* ------------------------------------------------------------------ */
/* AI investigations & remediation                                     */
/* ------------------------------------------------------------------ */

export const investigations = pgTable(
  "investigations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    status: investigationStatusEnum("status").default("running").notNull(),
    report: jsonb("report").$type<Record<string, unknown>>(),
    confidence: real("confidence"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    ...timestamps,
  },
  (t) => [index("investigations_project_idx").on(t.projectId, t.createdAt)],
);

export const investigationSteps = pgTable(
  "investigation_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    toolName: text("tool_name"),
    input: jsonb("input"),
    output: jsonb("output"),
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("investigation_steps_idx").on(t.investigationId, t.ordinal)],
);

export const remediations = pgTable(
  "remediations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id").references(() => investigations.id, {
      onDelete: "set null",
    }),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    kind: remediationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(), // markdown runbook, SQL, or unified diff
    riskLevel: text("risk_level").default("medium").notNull(), // low | medium | high
    requiresApproval: boolean("requires_approval").default(true).notNull(),
    status: remediationStatusEnum("status").default("draft").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    ...timestamps,
  },
  (t) => [index("remediations_project_status_idx").on(t.projectId, t.status)],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  projects: many(projects),
  teams: many(teams),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  org: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(organizations, { fields: [projects.orgId], references: [organizations.id] }),
  services: many(services),
  incidents: many(incidents),
}));

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  project: one(projects, { fields: [incidents.projectId], references: [projects.id] }),
  service: one(services, { fields: [incidents.serviceId], references: [services.id] }),
  suspectedDeployment: one(deployments, {
    fields: [incidents.suspectedDeploymentId],
    references: [deployments.id],
  }),
  events: many(incidentEvents),
}));

export const incidentEventsRelations = relations(incidentEvents, ({ one }) => ({
  incident: one(incidents, { fields: [incidentEvents.incidentId], references: [incidents.id] }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  project: one(projects, { fields: [services.projectId], references: [projects.id] }),
  deployments: many(deployments),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  service: one(services, { fields: [deployments.serviceId], references: [services.id] }),
}));

/* ------------------------------------------------------------------ */
/* Integrations: ingest API keys, outbound webhooks, eval history      */
/* ------------------------------------------------------------------ */

/** Project-scoped ingest keys. Only a SHA-256 of the secret is stored; the prefix identifies it in UIs. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().default(sql`ARRAY['logs:write']::text[]`).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("api_keys_org_idx").on(t.orgId)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    format: text("format").default("json").notNull(), // json | slack
    secret: text("secret").notNull(), // HMAC signing secret (needed to sign, so kept server-side)
    events: text("events").array().notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("webhooks_org_idx").on(t.orgId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    ok: boolean("ok").notNull(),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms").notNull(),
    error: text("error"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
);

export type EvalCaseResult = {
  name: string;
  question: string;
  passed: boolean;
  failures: string[];
  status: string | null;
  topCause: string | null;
  confidence: number | null;
  citations: number;
  durationMs: number;
  investigationId: string;
};

/** Results of golden-case eval runs (CLI, CI or in-app), shown on the Quality page. */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    analyst: text("analyst").notNull(), // model id or "deterministic-triage"
    trigger: text("trigger").notNull(), // cli | ui | ci
    passed: integer("passed").notNull(),
    total: integer("total").notNull(),
    durationMs: integer("duration_ms").notNull(),
    results: jsonb("results").$type<EvalCaseResult[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("eval_runs_org_idx").on(t.orgId, t.createdAt)],
);
