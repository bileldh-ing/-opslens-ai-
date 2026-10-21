import path from "node:path";
import { db, isEmbedded } from "./index";

/** Apply the committed SQL migrations in ./drizzle to whichever driver is configured. */
export async function runMigrations() {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (isEmbedded) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder });
  }
}
