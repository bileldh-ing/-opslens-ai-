"use server";

import { z } from "zod";
import { and, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireOrg, requireUser } from "@/lib/auth";
import { canAssignRole, type Role } from "@/lib/rbac";
import { assertWithinLimit } from "@/lib/plans";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/utils";

const Invite = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["admin", "member", "viewer"]),
});

export async function inviteMember(orgSlug: string, _: unknown, form: FormData) {
  const { org, user, role } = await requireOrg(orgSlug, "member.invite");
  const input = Invite.parse(Object.fromEntries(form));
  if (!canAssignRole(role, input.role as Role)) return { error: "You cannot grant that role." };

  const [{ value: members }] = await db
    .select({ value: count() })
    .from(schema.memberships)
    .where(eq(schema.memberships.orgId, org.id));
  assertWithinLimit(org.plan, "members", members);

  const token = randomToken();
  await db.insert(schema.invitations).values({
    orgId: org.id,
    email: input.email,
    role: input.role,
    tokenHash: sha256(token),
    invitedBy: user.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  });
  await audit({ orgId: org.id, actorId: user.id, action: "member.invite", targetType: "invitation", metadata: input });
  revalidatePath(`/${orgSlug}/settings`);
  // In production this link is emailed; returned here so the demo works without SMTP.
  return { inviteUrl: `${process.env.APP_URL ?? ""}/invite/${token}` };
}

export async function acceptInvitation(token: string) {
  const user = await requireUser();
  const [invite] = await db
    .select()
    .from(schema.invitations)
    .where(and(eq(schema.invitations.tokenHash, sha256(token)), isNull(schema.invitations.acceptedAt)));
  if (!invite || invite.expiresAt < new Date()) return { error: "This invitation is invalid or expired." };
  if (invite.email !== user.email) return { error: "This invitation was sent to a different email." };

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.memberships)
      .values({ orgId: invite.orgId, userId: user.id, role: invite.role })
      .onConflictDoNothing();
    await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, invite.id));
  });
  await audit({ orgId: invite.orgId, actorId: user.id, action: "member.join", targetType: "invitation", targetId: invite.id });
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, invite.orgId));
  redirect(`/${org.slug}`);
}
