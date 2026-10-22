/**
 * Runs once when the server boots. Validates configuration so a bad deployment fails at
 * startup with a readable message instead of on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { parseEnv, EnvError } = await import("./lib/env");
  const { logger } = await import("./lib/logger");
  try {
    const env = parseEnv(process.env);
    logger.info("opslens starting", {
      version: process.env.NEXT_PUBLIC_APP_VERSION,
      database: env.DATABASE_URL.startsWith("pglite://") ? "pglite" : "postgres",
      redis: Boolean(env.REDIS_URL),
      ai: Boolean(env.OPENAI_API_KEY || env.AI_BASE_URL),
    });
  } catch (e) {
    if (e instanceof EnvError) {
      logger.error("invalid configuration", { issues: e.issues });
      console.error(`\n${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}
