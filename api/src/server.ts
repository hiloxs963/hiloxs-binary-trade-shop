import { buildApp } from "./app.js";
import { createAuthService } from "./auth/auth.js";
import { createRuntimeEmailSender } from "./auth/email.js";
import { parseEnv, requireDatabaseUrl, resolveAuthRuntimeConfig } from "./config/env.js";
import { createDatabaseClient } from "./db/client.js";
import { createLoggerOptions, writeFatalLog } from "./lib/logger.js";
import { safeErrorForLog } from "./lib/redact.js";

async function start(): Promise<void> {
  const env = parseEnv(process.env);
  const database = createDatabaseClient(requireDatabaseUrl(env));
  const authRuntime = resolveAuthRuntimeConfig(env);
  const auth = createAuthService({
    database,
    emailSender: createRuntimeEmailSender(env.NODE_ENV),
    runtime: authRuntime,
  });
  const app = await buildApp({
    database,
    auth,
    authRuntime,
    allowedOrigins: authRuntime.trustedOrigins,
    logger: createLoggerOptions(env.LOG_LEVEL),
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
