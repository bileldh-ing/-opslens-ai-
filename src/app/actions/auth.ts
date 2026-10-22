"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { checkLoginAllowed, checkSignupAllowed, recordLoginFailure, recordLoginSuccess } from "@/lib/login-guard";
import { clientIp, logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";

export type FormState = { error?: string } | undefined;

const SignUp = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(10, "Use at least 10 characters"),
  organization: z.string().min(2).max(80),
});

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const parsed = SignUp.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, password, organization } = parsed.data;
  const ip = clientIp(await headers());
  const guard = await checkSignupAllowed(ip);
  if (!guard.allowed) {
    logger.warn("auth.signup.rate_limited", { ip });
    return { error: "Too many sign-ups from this network. Try again later." };
  }

  const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (exists) return { error: "An account with this email already exists." };

  const slug = `${slugify(organization)}-${Math.random().toString(36).slice(2, 6)}`;
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ name, email, passwordHash: await hashPassword(password) })
      .returning();
    const [org] = await tx.insert(schema.organizations).values({ name: organization, slug }).returning();
    await tx.insert(schema.memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
    await tx.insert(schema.projects).values({ orgId: org.id, name: "Production", slug: "production" });
    await tx.insert(schema.auditLogs).values({
      orgId: org.id,
      actorId: user.id,
      action: "org.create",
      targetType: "organization",
      targetId: org.id,
      ip,
    });
    return user.id;
  });

  await createSession(userId, (await headers()).get("user-agent"));
  redirect(`/${slug}`);
}

const SignIn = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const parsed = SignIn.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };
  const h = await headers();
  const ip = clientIp(h);
  const email = parsed.data.email;
  const guard = await checkLoginAllowed(ip, email);
  if (!guard.allowed) {
    logger.warn("auth.login.blocked", { ip, reason: guard.reason, retryAfterSec: guard.retryAfterSec });
    const minutes = Math.max(1, Math.ceil(guard.retryAfterSec / 60));
    return { error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  // Same error for unknown email and wrong password: no account enumeration.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await recordLoginFailure(ip, email);
    logger.warn("auth.login.failed", { ip, knownUser: Boolean(user) });
    return { error: "Invalid email or password." };
  }
  await recordLoginSuccess(ip, email);
  await createSession(user.id, h.get("user-agent"));

  const [m] = await db
    .select({ slug: schema.organizations.slug, orgId: schema.organizations.id })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  if (m) await audit({ orgId: m.orgId, actorId: user.id, action: "auth.login", targetType: "user", targetId: user.id, ip });
  logger.info("auth.login.success", { userId: user.id });
  redirect(m ? `/${m.slug}` : "/");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
