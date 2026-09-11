import { buildApp } from "./app.js";
import { createAuthService } from "./auth/auth.js";
import { createRuntimeEmailSender } from "./auth/email.js";
import {
  parseEnv,
  requireDatabaseUrl,
  requireRateLimitHmacKey,
  resolveAuthRuntimeConfig,
  resolveMediaRuntimeConfig,
  resolveMpesaRuntimeConfig,
} from "./config/env.js";
import { createDatabaseClient } from "./db/client.js";
import { createLoggerOptions, writeFatalLog } from "./lib/logger.js";
import { safeErrorForLog } from "./lib/redact.js";
import { DarajaClient } from "./payments/daraja-client.js";
import { S3MediaStorage } from "./media/s3-storage.js";
import { installGracefulShutdown } from "./lib/graceful-shutdown.js";

async function start(): Promise<void> {
  const env = parseEnv(process.env);
  const database = createDatabaseClient(requireDatabaseUrl(env), {
    applicationName: "hiloxs-api",
    statementTimeoutMs: env.PG_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.PG_LOCK_TIMEOUT_MS,
    idleInTransactionTimeoutMs: env.PG_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  const authRuntime = resolveAuthRuntimeConfig(env);
  const mpesaConfig = resolveMpesaRuntimeConfig(env);
  const mediaRuntime = resolveMediaRuntimeConfig(env);
  const mediaStorage = mediaRuntime.storage ? new S3MediaStorage(mediaRuntime.storage) : undefined;
  const auth = createAuthService({
    database,
    emailSender: createRuntimeEmailSender(env),
    runtime: authRuntime,
  });
  const app = await buildApp({
    database,
    auth,
    authRuntime,
    allowedOrigins: authRuntime.trustedOrigins,
    logger: createLoggerOptions(env.LOG_LEVEL),
    rateLimitHmacKey: requireRateLimitHmacKey(env),
    staffReviewEnabled: env.STAFF_REVIEW_ENABLED,
    sellerCommerceEnabled: env.SELLER_COMMERCE_ENABLED,
    sellerOrderActionsEnabled: env.SELLER_ORDER_ACTIONS_ENABLED,
    media: {
      ...(mediaStorage ? { storage: mediaStorage } : {}),
      uploadEnabled: mediaRuntime.uploadEnabled,
      catalogActivationEnabled: mediaRuntime.catalogActivationEnabled,
    },
    ...(mpesaConfig
      ? { mpesa: { provider: new DarajaClient(mpesaConfig), config: mpesaConfig } }
      : {}),
  });
  installGracefulShutdown({
    shutdown: async () => app.close(),
    onStart: (signal) => app.log.info({ signal }, "Shutdown signal received"),
    onComplete: (signal) => app.log.info({ signal }, "Graceful shutdown complete"),
    onFailure: (signal, error) =>
      app.log.error({ signal, error: safeErrorForLog(error) }, "Graceful shutdown failed"),
  });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (error) {
    await app.close();
    throw error;
  }
}

void start().catch((error: unknown) => {
  writeFatalLog("API startup failed", error);
  process.exitCode = 1;
});
