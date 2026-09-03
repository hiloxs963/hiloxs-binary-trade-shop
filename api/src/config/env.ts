import { z } from "zod";
import { ConfigurationError } from "../lib/errors.js";

const BooleanEnvironmentSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const FailSafeBooleanEnvironmentSchema = z
  .string()
  .optional()
  .transform((value) => value === "true");

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
  MPESA_ENV: z.enum(["sandbox", "production"]).optional(),
  MPESA_PUBLIC_ENABLED: BooleanEnvironmentSchema,
  STAFF_REVIEW_ENABLED: FailSafeBooleanEnvironmentSchema,
  MEDIA_UPLOAD_ENABLED: BooleanEnvironmentSchema,
  CATALOG_ACTIVATION_ENABLED: BooleanEnvironmentSchema,
  MEDIA_S3_ENDPOINT: z.url().optional(),
  MEDIA_S3_REGION: z.string().trim().min(1).optional(),
  MEDIA_S3_BUCKET: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "must be a valid S3 bucket name")
    .optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
  MEDIA_S3_SESSION_TOKEN: z.string().trim().min(1).optional(),
  MEDIA_S3_FORCE_PATH_STYLE: BooleanEnvironmentSchema,
  MPESA_CONSUMER_KEY: z.string().trim().min(1).optional(),
  MPESA_CONSUMER_SECRET: z.string().trim().min(1).optional(),
  MPESA_SHORTCODE: z.string().trim().regex(/^\d+$/).optional(),
  MPESA_PASSKEY: z.string().trim().min(1).optional(),
  MPESA_TRANSACTION_TYPE: z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]).optional(),
  MPESA_PARTY_B: z.string().trim().regex(/^\d+$/).optional(),
  MPESA_CALLBACK_BASE_URL: z.url().optional(),
  MPESA_MAX_AMOUNT_KES: z.coerce.bigint().positive().optional(),
  MPESA_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
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

export type MpesaRuntimeConfig = {
  environment: "sandbox" | "production";
  publicEnabled: boolean;
  baseURL: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  partyB: string;
  callbackBaseURL: string;
  maxAmountKes: bigint;
  requestTimeoutMs: number;
};

export type MediaRuntimeConfig = {
  uploadEnabled: boolean;
  catalogActivationEnabled: boolean;
  storage?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    forcePathStyle: boolean;
  };
};

const PRODUCTION_FRONTEND_ORIGIN = "https://hiloxs.co.ke";
const PRODUCTION_API_ORIGIN = "https://api.hiloxs.co.ke";
const LOCAL_FRONTEND_ORIGIN = "http://localhost:8080";
const DEVELOPMENT_AUTH_SECRET = "development-only-hiloxs-auth-secret-change-me";
const PRODUCTION_AUTH_EMAIL_FROM = "HILOXS <auth@mail.hiloxs.co.ke>";
const MPESA_BASE_URLS = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
} as const;

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

export function resolveMpesaRuntimeConfig(env: AppEnv): MpesaRuntimeConfig | undefined {
  const values = [
    env.MPESA_ENV,
    env.MPESA_CONSUMER_KEY,
    env.MPESA_CONSUMER_SECRET,
    env.MPESA_SHORTCODE,
    env.MPESA_PASSKEY,
    env.MPESA_TRANSACTION_TYPE,
    env.MPESA_PARTY_B,
    env.MPESA_CALLBACK_BASE_URL,
    env.MPESA_MAX_AMOUNT_KES,
  ];
  const configured = values.some((value) => value !== undefined);
  if (!configured && env.NODE_ENV !== "production") return undefined;
  if (values.some((value) => value === undefined)) {
    throw new ConfigurationError("All M-Pesa environment variables are required together");
  }

  const callbackBaseURL = new URL(env.MPESA_CALLBACK_BASE_URL as string);
  if (env.NODE_ENV === "production" && callbackBaseURL.protocol !== "https:") {
    throw new ConfigurationError("Production MPESA_CALLBACK_BASE_URL must use HTTPS");
  }
  if (callbackBaseURL.search || callbackBaseURL.hash) {
    throw new ConfigurationError("MPESA_CALLBACK_BASE_URL cannot include a query or fragment");
  }

  const environment = env.MPESA_ENV as MpesaRuntimeConfig["environment"];
  return {
    environment,
    publicEnabled: env.MPESA_PUBLIC_ENABLED,
    baseURL: MPESA_BASE_URLS[environment],
    consumerKey: env.MPESA_CONSUMER_KEY as string,
    consumerSecret: env.MPESA_CONSUMER_SECRET as string,
    shortcode: env.MPESA_SHORTCODE as string,
    passkey: env.MPESA_PASSKEY as string,
    transactionType: env.MPESA_TRANSACTION_TYPE as MpesaRuntimeConfig["transactionType"],
    partyB: env.MPESA_PARTY_B as string,
    callbackBaseURL: callbackBaseURL.origin,
    maxAmountKes: env.MPESA_MAX_AMOUNT_KES as bigint,
    requestTimeoutMs: env.MPESA_REQUEST_TIMEOUT_MS,
  };
}

export function resolveMediaRuntimeConfig(env: AppEnv): MediaRuntimeConfig {
  const values = [
    env.MEDIA_S3_ENDPOINT,
    env.MEDIA_S3_REGION,
    env.MEDIA_S3_BUCKET,
    env.MEDIA_S3_ACCESS_KEY_ID,
    env.MEDIA_S3_SECRET_ACCESS_KEY,
  ];
  const configured =
    values.some((value) => value !== undefined) ||
    env.MEDIA_S3_SESSION_TOKEN !== undefined ||
    env.MEDIA_S3_FORCE_PATH_STYLE;
  const complete = values.every((value) => value !== undefined);
  if (configured && !complete) {
    throw new ConfigurationError(
      "All required media S3 environment variables must be set together",
    );
  }
  if ((env.MEDIA_UPLOAD_ENABLED || env.CATALOG_ACTIVATION_ENABLED) && !complete) {
    throw new ConfigurationError(
      "Media S3 configuration is required when Phase 8 writes are enabled",
    );
  }

  let storage: MediaRuntimeConfig["storage"];
  if (complete) {
    const endpoint = new URL(env.MEDIA_S3_ENDPOINT as string);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new ConfigurationError(
        "MEDIA_S3_ENDPOINT cannot include credentials, a query, or a fragment",
      );
    }
    storage = {
      endpoint: endpoint.origin + endpoint.pathname.replace(/\/$/, ""),
      region: env.MEDIA_S3_REGION as string,
      bucket: env.MEDIA_S3_BUCKET as string,
      accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY as string,
      ...(env.MEDIA_S3_SESSION_TOKEN ? { sessionToken: env.MEDIA_S3_SESSION_TOKEN } : {}),
      forcePathStyle: env.MEDIA_S3_FORCE_PATH_STYLE,
    };
  }

  return {
    uploadEnabled: env.MEDIA_UPLOAD_ENABLED,
    catalogActivationEnabled: env.CATALOG_ACTIVATION_ENABLED,
    ...(storage ? { storage } : {}),
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
