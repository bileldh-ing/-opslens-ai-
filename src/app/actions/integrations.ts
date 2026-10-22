"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { getProjectInOrg } from "@/server/projects";
import { createApiKey, revokeApiKey } from "@/server/integrations/api-keys";
import { assertSafeWebhookUrl, deliver, generateWebhookSecret, WEBHOOK_EVENTS, WebhookUrlError } from "@/server/integrations/webhooks";
import { runEvalSuite } from "@/server/evals/run";

export type KeyState = { error?: string; key?: string; name?: string } | null;
export type HookState = { error?: string; ok?: string; secret?: string } | null;

const ip = async () => clientIp(await headers());

/* ---------------- Ingest API keys ---------------- */

const NewKey = z.object({ name: z.string().trim().min(2).max(60), project: z.string().min(1) });

export async function createApiKeyAction(orgSlug: string, _: KeyState, form: FormData): Promise<KeyState> {
  const { org, user } = await requireOrg(orgSlug, "integrations.manage");
  const parsed = NewKey.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Name the key (2 to 60 characters) and pick a project." };
  const project = await getProjectInOrg(org.id, parsed.data.project);
  if (!project) return { error: "Project not found." };
  const created = await createApiKey({ orgId: org.id, projectId: project.id, name: parsed.data.name, createdBy: user.id });
  await audit({
    orgId: org.id,
    actorId: user.id,
    action: "api_key.create",
    targetType: "api_key",
    targetId: created.id,
    metadata: { name: created.name, prefix: created.prefix, project: project.slug },
    ip: await ip(),
  });
  revalidatePath(`/${orgSlug}/settings`);
  return { key: created.key, name: created.name };
}

export async function revokeApiKeyAction(orgSlug: string, keyId: string) {
  const { org, user } = await requireOrg(orgSlug, "integrations.manage");
  const row = await revokeApiKey(org.id, keyId);
  if (row) {
    await audit({ orgId: org.id, actorId: user.id, action: "api_key.revoke", targetType: "api_key", targetId: row.id, metadata: { name: row.name, prefix: row.prefix }, ip: await ip() });
  }
  revalidatePath(`/${orgSlug}/settings`);
}

/* ---------------- Webhooks ---------------- */

const NewHook = z.object({
  name: z.string().trim().min(2).max(60),
  url: z.string().trim().max(2000),
  format: z.enum(["json", "slack"]),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event."),
});

export async function createWebhookAction(orgSlug: string, _: HookState, form: FormData): Promise<HookState> {
  const { org, user } = await requireOrg(orgSlug, "integrations.manage");
  const parsed = NewHook.safeParse({ ...Object.fromEntries(form), events: form.getAll("events") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await assertSafeWebhookUrl(parsed.data.url);
  } catch (e) {
    if (e instanceof WebhookUrlError) return { error: e.message };
    throw e;
  }
  const secret = generateWebhookSecret();
  const [hook] = await db
    .insert(schema.webhooks)
    .values({ orgId: org.id, name: parsed.data.name, url: parsed.data.url, format: parsed.data.format, events: parsed.data.events, secret, createdBy: user.id })
    .returning();
  await audit({
    orgId: org.id,
    actorId: user.id,
    action: "webhook.create",
    targetType: "webhook",
    targetId: hook.id,
    metadata: { name: hook.name, host: new URL(hook.url).host, format: hook.format, events: hook.events },
    ip: await ip(),
  });
  revalidatePath(`/${orgSlug}/settings`);
  return { ok: `Webhook "${hook.name}" created.`, secret };
}

async function ownedHook(orgId: string, id: string) {
  const [hook] = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId)));
  return hook ?? null;
}

export async function deleteWebhookAction(orgSlug: string, id: string) {
  const { org, user } = await requireOrg(orgSlug, "integrations.manage");
  const hook = await ownedHook(org.id, id);
  if (!hook) return;
  await db.delete(schema.webhooks).where(eq(schema.webhooks.id, hook.id));
  await audit({ orgId: org.id, actorId: user.id, action: "webhook.delete", targetType: "webhook", targetId: hook.id, metadata: { name: hook.name }, ip: await ip() });
  revalidatePath(`/${orgSlug}/settings`);
}

export async function toggleWebhookAction(orgSlug: string, id: string) {
  const { org, user } = await requireOrg(orgSlug, "integrations.manage");
  const hook = await ownedHook(org.id, id);
  if (!hook) return;
  await db.update(schema.webhooks).set({ enabled: !hook.enabled }).where(eq(schema.webhooks.id, hook.id));
  await audit({ orgId: org.id, actorId: user.id, action: hook.enabled ? "webhook.disable" : "webhook.enable", targetType: "webhook", targetId: hook.id, ip: await ip() });
  revalidatePath(`/${orgSlug}/settings`);
}

export async function testWebhookAction(orgSlug: string, id: string): Promise<{ ok: boolean; message: string }> {
  const { org, user } = await requireOrg(orgSlug, "integrations.manage");
  const hook = await ownedHook(org.id, id);
  if (!hook) return { ok: false, message: "Webhook not found." };
  const rl = await rateLimit(`webhook-test:${hook.id}`, 10, 60_000);
  if (!rl.allowed) return { ok: false, message: "Slow down: 10 test deliveries per minute." };
  const d = await deliver(hook, "webhook.test", { message: `Test delivery from ${org.name}, sent by ${user.name}.` });
  await audit({ orgId: org.id, actorId: user.id, action: "webhook.test", targetType: "webhook", targetId: hook.id, metadata: { ok: d.ok, statusCode: d.statusCode } });
  revalidatePath(`/${orgSlug}/settings`);
  return d.ok ? { ok: true, message: `Delivered (HTTP ${d.statusCode}, ${d.durationMs} ms).` } : { ok: false, message: `Failed: ${d.error}` };
}

/* ---------------- Evals ---------------- */

export async function runEvalsAction(orgSlug: string): Promise<{ ok: boolean; message: string }> {
  const { org, user } = await requireOrg(orgSlug, "evals.run");
  const rl = await rateLimit(`evals:${org.id}`, 3, 10 * 60_000);
  if (!rl.allowed) return { ok: false, message: "Eval runs are limited to 3 per 10 minutes." };
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.orgId, org.id)).limit(1);
  if (!project) return { ok: false, message: "Create a project first." };
  const run = await runEvalSuite({ projectId: project.id, userId: user.id, orgId: org.id, trigger: "ui" });
  await audit({ orgId: org.id, actorId: user.id, action: "evals.run", targetType: "eval_run", targetId: run.id, metadata: { passed: run.passed, total: run.total } });
  revalidatePath(`/${orgSlug}/quality`);
  return { ok: run.passed === run.total, message: `${run.passed}/${run.total} cases passed.` };
}
