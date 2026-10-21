"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
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
  const ip = (await headers()).get("x-forwarded-for") ?? "local";
  const rl = await rateLimit(`login:${ip}:${parsed.data.email}`, 5, 15 * 60_000);
  if (!rl.allowed) return { error: "Too many attempts. Try again in 15 minutes." };

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email));
  // Same error for unknown email and wrong password: no account enumeration.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "Invalid email or password." };
  }
  await createSession(user.id, (await headers()).get("user-agent"));

  const [m] = await db
    .select({ slug: schema.organizations.slug })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  redirect(m ? `/${m.slug}` : "/");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
