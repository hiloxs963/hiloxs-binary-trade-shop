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
  BETTER_AUTH_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppEnv = z.infer<typeof EnvironmentSchema>;

export type AuthRuntimeConfig = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  secureCookies: boolean;
};

const PRODUCTION_FRONTEND_ORIGIN = "https://hiloxs.co.ke";
const PRODUCTION_API_ORIGIN = "https://api.hiloxs.co.ke";
const LOCAL_FRONTEND_ORIGIN = "http://localhost:8080";
const DEVELOPMENT_AUTH_SECRET = "development-only-hiloxs-auth-secret-change-me";

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

export function resolveAuthRuntimeConfig(env: AppEnv): AuthRuntimeConfig {
  const production = env.NODE_ENV === "production";
  const baseURL = env.BETTER_AUTH_URL ?? (production ? undefined : `http://127.0.0.1:${env.PORT}`);
  const secret = env.BETTER_AUTH_SECRET ?? (production ? undefined : DEVELOPMENT_AUTH_SECRET);

  if (!baseURL) throw new ConfigurationError("BETTER_AUTH_URL is required in production");
  if (!secret) throw new ConfigurationError("BETTER_AUTH_SECRET is required in production");

  const parsedBaseURL = new URL(baseURL);
  if (production && parsedBaseURL.origin !== PRODUCTION_API_ORIGIN) {
    throw new ConfigurationError(`Production BETTER_AUTH_URL must use ${PRODUCTION_API_ORIGIN}`);
  }

  return {
    baseURL: parsedBaseURL.origin,
    secret,
    trustedOrigins: production
      ? [PRODUCTION_FRONTEND_ORIGIN]
      : [LOCAL_FRONTEND_ORIGIN, PRODUCTION_FRONTEND_ORIGIN],
    secureCookies: production,
  };
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
