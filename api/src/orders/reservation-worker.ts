import { setTimeout as delay } from "node:timers/promises";
import { parseEnv, requireDatabaseUrl } from "../config/env.js";
import { createDatabaseClient } from "../db/client.js";
import { installGracefulShutdown } from "../lib/graceful-shutdown.js";
import { writeFatalLog, writeOperationalLog } from "../lib/logger.js";
import { expirePendingReservations } from "./service.js";

async function run(): Promise<void> {
  const env = parseEnv(process.env);
  const database = createDatabaseClient(requireDatabaseUrl(env), {
    maxConnections: 2,
    applicationName: "hiloxs-reservation-worker",
    statementTimeoutMs: env.PG_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.PG_LOCK_TIMEOUT_MS,
    idleInTransactionTimeoutMs: env.PG_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
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
    onStart: (signal) =>
      writeOperationalLog("info", "Reservation worker shutdown started", { signal }),
    onComplete: (signal) =>
      writeOperationalLog("info", "Reservation worker shutdown complete", { signal }),
    onFailure: (signal, error) =>
      writeOperationalLog("error", "Reservation worker shutdown failed", {
        signal,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
  });
  let successCount = 0;
  let failureCount = 0;
  let lastHeartbeatAt = 0;
  writeOperationalLog("info", "Reservation worker started");
  try {
    while (!controller.signal.aborted) {
      const processed = await expirePendingReservations(database, new Date(), undefined, () => {
        failureCount += 1;
      });
      successCount += processed;
      if (!processed) await abortableDelay(2_000, controller.signal);
      if (Date.now() - lastHeartbeatAt >= 30_000) {
        lastHeartbeatAt = Date.now();
        writeOperationalLog("info", "Reservation worker heartbeat", {
          successCount,
          failureCount,
        });
      }
    }
  } finally {
    await database.close();
    removeShutdownHandlers();
    markStopped();
    writeOperationalLog("info", "Reservation worker stopped", { successCount, failureCount });
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
  writeFatalLog("Reservation worker failed", error);
  process.exitCode = 1;
});
