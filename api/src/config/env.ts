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
  RESEND_API_KEY: z
    .string()
    .trim()
    .regex(/^re_\S{16,}$/, "must use the Resend API key format")
    .optional(),
  AUTH_EMAIL_FROM: z.string().trim().min(1).optional(),
  FRONTEND_URL: z.url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppEnv = z.infer<typeof EnvironmentSchema>;

export type AuthRuntimeConfig = {
  baseURL: string;
  frontendURL: string;
  secret: string;
  trustedOrigins: string[];
  secureCookies: boolean;
};

export type ProductionEmailConfig = {
  apiKey: string;
  from: string;
};

const PRODUCTION_FRONTEND_ORIGIN = "https://hiloxs.co.ke";
const PRODUCTION_API_ORIGIN = "https://api.hiloxs.co.ke";
const LOCAL_FRONTEND_ORIGIN = "http://localhost:8080";
const DEVELOPMENT_AUTH_SECRET = "development-only-hiloxs-auth-secret-change-me";
const PRODUCTION_AUTH_EMAIL_FROM = "HILOXS <auth@mail.hiloxs.co.ke>";

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
  const frontendURL = env.FRONTEND_URL ?? (production ? undefined : LOCAL_FRONTEND_ORIGIN);
  const secret = env.BETTER_AUTH_SECRET ?? (production ? undefined : DEVELOPMENT_AUTH_SECRET);

  if (!baseURL) throw new ConfigurationError("BETTER_AUTH_URL is required in production");
  if (!frontendURL) throw new ConfigurationError("FRONTEND_URL is required in production");
  if (!secret) throw new ConfigurationError("BETTER_AUTH_SECRET is required in production");

  const parsedBaseURL = new URL(baseURL);
  const parsedFrontendURL = new URL(frontendURL);
  if (production && parsedBaseURL.origin !== PRODUCTION_API_ORIGIN) {
    throw new ConfigurationError(`Production BETTER_AUTH_URL must use ${PRODUCTION_API_ORIGIN}`);
  }
  if (production && parsedFrontendURL.origin !== PRODUCTION_FRONTEND_ORIGIN) {
    throw new ConfigurationError(`Production FRONTEND_URL must use ${PRODUCTION_FRONTEND_ORIGIN}`);
  }

  const trustedOrigins = production
    ? [parsedFrontendURL.origin]
    : [...new Set([parsedFrontendURL.origin, PRODUCTION_FRONTEND_ORIGIN])];

  return {
    baseURL: parsedBaseURL.origin,
    frontendURL: parsedFrontendURL.origin,
    secret,
    trustedOrigins,
    secureCookies: production,
  };
}

export function resolveProductionEmailConfig(env: AppEnv): ProductionEmailConfig | undefined {
  if (env.NODE_ENV !== "production") return undefined;
  if (!env.RESEND_API_KEY) {
    throw new ConfigurationError("RESEND_API_KEY is required in production");
  }
  if (!env.AUTH_EMAIL_FROM) {
    throw new ConfigurationError("AUTH_EMAIL_FROM is required in production");
  }
  if (env.AUTH_EMAIL_FROM !== PRODUCTION_AUTH_EMAIL_FROM) {
    throw new ConfigurationError(
      `Production AUTH_EMAIL_FROM must use ${PRODUCTION_AUTH_EMAIL_FROM}`,
    );
  }

  return { apiKey: env.RESEND_API_KEY, from: env.AUTH_EMAIL_FROM };
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
