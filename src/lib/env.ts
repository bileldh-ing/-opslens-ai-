import { z } from "zod";

/**
 * Validated runtime configuration. Imported by the db client, instrumentation (startup check)
 * and scripts. Fails fast with a readable list of problems instead of an obscure runtime error.
 */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z
      .string()
      .default("pglite://.data/opslens")
      .refine((v) => /^(postgres(ql)?:\/\/|pglite:\/\/)/.test(v), {
        message: "must start with postgres://, postgresql:// or pglite://",
      }),
    REDIS_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((v) => /^rediss?:\/\//.test(v), { message: "must start with redis:// or rediss://" })
        .optional(),
    ),
    OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    AI_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    AI_CHAT_MODEL: z.string().default("gpt-4.1-mini"),
    AI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
    APP_URL: z.preprocess(emptyToUndefined, z.url().default("http://localhost:3000")),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
    /** Allow webhook targets on loopback/private networks (local demos and tests only). */
    ALLOW_PRIVATE_WEBHOOK_TARGETS: z
      .preprocess(emptyToUndefined, z.enum(["true", "false", "1", "0"]).optional())
      .transform((v) => v === "true" || v === "1"),
  })
  .superRefine((env, ctx) => {
    const publicUrl = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(env.APP_URL);
    if (env.NODE_ENV === "production" && env.ALLOW_PRIVATE_WEBHOOK_TARGETS && publicUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_PRIVATE_WEBHOOK_TARGETS"],
        message: "must not be enabled on a public production deployment (SSRF risk)",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  • ${i}`).join("\n")}\nSee .env.example for every supported variable.`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const res = EnvSchema.safeParse(source);
  if (!res.success) {
    throw new EnvError(res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return res.data;
}

let cached: Env | undefined;
/** Lazily parsed so tests and scripts can set process.env before first use. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
