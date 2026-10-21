import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { randomToken, sha256 } from "./utils";
import { assertCan, type Permission, type Role } from "./rbac";

const SESSION_COOKIE = "opslens_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Opaque token in an httpOnly cookie; only its SHA-256 is stored, so a DB leak can't hijack sessions. */
export async function createSession(userId: string, userAgent?: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt, userAgent });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = { id: string; email: string; name: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type OrgContext = {
  user: CurrentUser;
  org: typeof schema.organizations.$inferSelect;
  role: Role;
};

/** Resolves the org by slug and the caller's membership. Non-members get a 404, never a hint the org exists. */
export async function requireOrg(orgSlug: string, permission: Permission = "workspace.read"): Promise<OrgContext> {
  const user = await requireUser();
  const [row] = await db
    .select({ org: schema.organizations, role: schema.memberships.role })
    .from(schema.organizations)
    .innerJoin(
      schema.memberships,
      and(eq(schema.memberships.orgId, schema.organizations.id), eq(schema.memberships.userId, user.id)),
    )
    .where(eq(schema.organizations.slug, orgSlug))
    .limit(1);
  if (!row) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  assertCan(row.role, permission);
  return { user, org: row.org, role: row.role };
}

/** API-route flavour: returns null instead of redirecting so handlers can answer 401/403 JSON. */
export async function getOrgContextForApi(orgSlug: string): Promise<OrgContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const [row] = await db
    .select({ org: schema.organizations, role: schema.memberships.role })
    .from(schema.organizations)
    .innerJoin(
      schema.memberships,
      and(eq(schema.memberships.orgId, schema.organizations.id), eq(schema.memberships.userId, user.id)),
    )
    .where(eq(schema.organizations.slug, orgSlug))
    .limit(1);
  return row ? { user, org: row.org, role: row.role } : null;
}
