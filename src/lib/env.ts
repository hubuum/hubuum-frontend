import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BACKEND_BASE_URL: z.string().url(),
  VALKEY_URL: z.string().url().optional().or(z.literal("")),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60),
  SESSION_PREFIX: z.string().min(1).default("hubuum:sess:"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Hubuum Console")
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${details}`);
  }

  cachedEnv = {
    ...parsed.data,
    VALKEY_URL: parsed.data.VALKEY_URL || undefined
  };
  return cachedEnv;
}
