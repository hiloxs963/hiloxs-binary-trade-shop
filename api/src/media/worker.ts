import { setTimeout as delay } from "node:timers/promises";
import { parseEnv, requireDatabaseUrl, resolveMediaRuntimeConfig } from "../config/env.js";
import { createDatabaseClient } from "../db/client.js";
import { ConfigurationError } from "../lib/errors.js";
import { installGracefulShutdown } from "../lib/graceful-shutdown.js";
import { writeFatalLog, writeOperationalLog } from "../lib/logger.js";
import { S3MediaStorage } from "./s3-storage.js";
import { processNextMedia } from "./worker-service.js";

async function run(): Promise<void> {
  const env = parseEnv(process.env);
  const runtime = resolveMediaRuntimeConfig(env);
  if (!runtime.storage) throw new ConfigurationError("Media worker requires S3 configuration");
  const database = createDatabaseClient(requireDatabaseUrl(env), {
    maxConnections: 2,
    applicationName: "hiloxs-media-worker",
    statementTimeoutMs: env.PG_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.PG_LOCK_TIMEOUT_MS,
    idleInTransactionTimeoutMs: env.PG_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  const storage = new S3MediaStorage(runtime.storage);
  const controller = new AbortController();
  let markStopped: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    markStopped = resolve;
  });
  const removeShutdownHandlers = installGracefulShutdown({
    shutdown: async () => {
      controller.abort();
      await stopped;
    },
    onStart: (signal) => writeOperationalLog("info", "Media worker shutdown started", { signal }),
    onComplete: (signal) =>
      writeOperationalLog("info", "Media worker shutdown complete", { signal }),
    onFailure: (signal, error) =>
      writeOperationalLog("error", "Media worker shutdown failed", {
        signal,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
  });
  let handledCount = 0;
  let failureCount = 0;
  let lastHeartbeatAt = 0;
  writeOperationalLog("info", "Media worker started");
  try {
    while (!controller.signal.aborted) {
      try {
        const processed = await processNextMedia(database, storage);
        if (processed) handledCount += 1;
        else await abortableDelay(2_000, controller.signal);
      } catch (error) {
        failureCount += 1;
        writeOperationalLog("error", "Media worker iteration failed", {
          error: error instanceof Error ? error.name : "UnknownError",
          failureCount,
        });
        await abortableDelay(2_000, controller.signal);
      }
      if (Date.now() - lastHeartbeatAt >= 30_000) {
        lastHeartbeatAt = Date.now();
        writeOperationalLog("info", "Media worker heartbeat", { handledCount, failureCount });
      }
    }
  } finally {
    await database.close();
    removeShutdownHandlers();
    markStopped();
    writeOperationalLog("info", "Media worker stopped", { handledCount, failureCount });
  }
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(milliseconds, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

void run().catch((error: unknown) => {
  writeFatalLog("Media worker failed", error);
  process.exitCode = 1;
});
