import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export async function getProjectInOrg(orgId: string, projectSlug: string) {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, orgId), eq(schema.projects.slug, projectSlug)))
    .limit(1);
  return project ?? null;
}
