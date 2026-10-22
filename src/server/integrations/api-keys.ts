import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { randomToken, sha256 } from "@/lib/utils";

/**
 * Ingest API keys: `olk_<8-char prefix>_<43-char secret>`.
 * The full key is shown exactly once at creation; only its SHA-256 is stored, so a database
 * leak does not leak usable keys. Keys are scoped to one project and revocable instantly.
 */
export const KEY_PATTERN = /^olk_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{32,64})$/;

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomToken(12).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).padEnd(8, "0");
  const key = `olk_${prefix}_${randomToken(32)}`;
  return { key, prefix, hash: sha256(key) };
}

export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

export async function createApiKey(input: { orgId: string; projectId: string; name: string; createdBy: string }) {
  const { key, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(schema.apiKeys)
    .values({ orgId: input.orgId, projectId: input.projectId, name: input.name, prefix, keyHash: hash, createdBy: input.createdBy })
    .returning({ id: schema.apiKeys.id, prefix: schema.apiKeys.prefix, name: schema.apiKeys.name });
  return { ...row, key };
}

export async function revokeApiKey(orgId: string, id: string) {
  const [row] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt)))
    .returning({ id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix });
  return row ?? null;
}

export type ResolvedKey = { keyId: string; orgId: string; projectId: string; scopes: string[] };

/** Looks a presented key up by hash. Revoked or malformed keys resolve to null. */
export async function resolveApiKey(presented: string | null): Promise<ResolvedKey | null> {
  if (!presented || !KEY_PATTERN.test(presented)) return null;
  const [row] = await db
    .select({ id: schema.apiKeys.id, orgId: schema.apiKeys.orgId, projectId: schema.apiKeys.projectId, scopes: schema.apiKeys.scopes })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.keyHash, sha256(presented)), isNull(schema.apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.id));
  return { keyId: row.id, orgId: row.orgId, projectId: row.projectId, scopes: row.scopes };
}

export async function listApiKeys(orgId: string) {
  return db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      project: schema.projects.name,
      projectSlug: schema.projects.slug,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      revokedAt: schema.apiKeys.revokedAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.apiKeys.projectId))
    .where(eq(schema.apiKeys.orgId, orgId))
    .orderBy(desc(schema.apiKeys.createdAt));
}
