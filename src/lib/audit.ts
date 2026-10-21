import { db, schema } from "@/db";

export async function audit(entry: {
  orgId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  await db.insert(schema.auditLogs).values({
    orgId: entry.orgId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  });
}
