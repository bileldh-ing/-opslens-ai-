import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Database client.
 *
 * - `postgres://…`  → node-postgres pool (production, docker-compose).
 * - `pglite://<dir>` or `pglite://memory` → embedded Postgres 17 + pgvector running in WASM.
 *   Zero-setup local demo and real-SQL integration tests, same schema and migrations.
 */
export type DB = NodePgDatabase<typeof schema>;

const url = process.env.DATABASE_URL ?? "pglite://.data/opslens";

const globalForDb = globalThis as unknown as { db?: DB; pool?: Pool; close?: () => Promise<void> };

function createDb(): DB {
  if (url.startsWith("pglite://")) {
    // Loaded lazily so production images never pull the WASM runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { vector } = require("@electric-sql/pglite-pgvector") as typeof import("@electric-sql/pglite-pgvector");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
    const target = url.slice("pglite://".length);
    if (target !== "memory") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("node:fs") as typeof import("node:fs")).mkdirSync(target, { recursive: true });
    }
    const client = new PGlite({ dataDir: target === "memory" ? undefined : target, extensions: { vector } });
    globalForDb.close = () => client.close();
    return drizzle(client, { schema }) as unknown as DB;
  }
  const pool = globalForDb.pool ?? new Pool({ connectionString: url, max: 10 });
  globalForDb.pool = pool;
  globalForDb.close = () => pool.end();
  return drizzlePg(pool, { schema });
}

export const db: DB = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;

/** Close the underlying connection (scripts and tests). */
export async function closeDb() {
  await globalForDb.close?.();
}

export const isEmbedded = url.startsWith("pglite://");
export { schema };
