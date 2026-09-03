import { setTimeout as delay } from "node:timers/promises";
import { parseEnv, requireDatabaseUrl, resolveMediaRuntimeConfig } from "../config/env.js";
import { createDatabaseClient } from "../db/client.js";
import { ConfigurationError } from "../lib/errors.js";
import { writeFatalLog } from "../lib/logger.js";
import { S3MediaStorage } from "./s3-storage.js";
import { processNextMedia } from "./worker-service.js";

async function run(): Promise<void> {
  const env = parseEnv(process.env);
  const runtime = resolveMediaRuntimeConfig(env);
  if (!runtime.storage) throw new ConfigurationError("Media worker requires S3 configuration");
  const database = createDatabaseClient(requireDatabaseUrl(env), { maxConnections: 2 });
  const storage = new S3MediaStorage(runtime.storage);
  let stopping = false;
  process.once("SIGTERM", () => {
    stopping = true;
  });
  process.once("SIGINT", () => {
    stopping = true;
  });
  try {
    while (!stopping) {
      const processed = await processNextMedia(database, storage);
      if (!processed) await delay(2_000);
    }
  } finally {
    await database.close();
  }
}

void run().catch((error: unknown) => {
  writeFatalLog("Media worker failed", error);
  process.exitCode = 1;
});
