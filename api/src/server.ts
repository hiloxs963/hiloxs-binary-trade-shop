import { buildApp } from "./app.js";
import { createAuthService } from "./auth/auth.js";
import { createRuntimeEmailSender } from "./auth/email.js";
import {
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
  resolveMediaRuntimeConfig,
  resolveMpesaRuntimeConfig,
} from "./config/env.js";
import { createDatabaseClient } from "./db/client.js";
import { createLoggerOptions, writeFatalLog } from "./lib/logger.js";
import { safeErrorForLog } from "./lib/redact.js";
import { DarajaClient } from "./payments/daraja-client.js";
import { S3MediaStorage } from "./media/s3-storage.js";

async function start(): Promise<void> {
  const env = parseEnv(process.env);
  const database = createDatabaseClient(requireDatabaseUrl(env));
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
    staffReviewEnabled: env.STAFF_REVIEW_ENABLED,
    media: {
      ...(mediaStorage ? { storage: mediaStorage } : {}),
      uploadEnabled: mediaRuntime.uploadEnabled,
      catalogActivationEnabled: mediaRuntime.catalogActivationEnabled,
    },
    ...(mpesaConfig
      ? { mpesa: { provider: new DarajaClient(mpesaConfig), config: mpesaConfig } }
      : {}),
  });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutdown signal received");
    try {
      await app.close();
      app.log.info({ signal }, "Graceful shutdown complete");
    } catch (error) {
      app.log.error({ signal, error: safeErrorForLog(error) }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

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
