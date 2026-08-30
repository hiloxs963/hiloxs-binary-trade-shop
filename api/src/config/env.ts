import { z } from "zod";
import { ConfigurationError } from "../lib/errors.js";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .trim()
    .refine((value) => /^postgres(?:ql)?:\/\//i.test(value), "must be a PostgreSQL URL")
    .optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppEnv = z.infer<typeof EnvironmentSchema>;

export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  const result = EnvironmentSchema.safeParse(input);
  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new ConfigurationError(`Invalid environment configuration: ${summary}`);
  }
  return result.data;
}

export function requireDatabaseUrl(env: AppEnv): string {
  if (!env.DATABASE_URL) {
    throw new ConfigurationError("DATABASE_URL is required for database functionality");
  }
  return env.DATABASE_URL;
}

export function assertSafeTestDatabaseUrl(databaseUrl: string, nodeEnv: string): void {
  if (nodeEnv !== "test") {
    throw new ConfigurationError("Integration tests require NODE_ENV=test");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new ConfigurationError("The integration test DATABASE_URL is invalid", error);
  }

  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres", "postgres-test"]);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!allowedHosts.has(parsed.hostname) || !databaseName.endsWith("_test")) {
    throw new ConfigurationError(
      "Integration tests require an explicitly local or CI PostgreSQL host and a database ending in _test",
    );
  }
}
