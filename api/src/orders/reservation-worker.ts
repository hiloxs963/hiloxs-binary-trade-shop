import { setTimeout as delay } from "node:timers/promises";
import { parseEnv, requireDatabaseUrl } from "../config/env.js";
import { createDatabaseClient } from "../db/client.js";
import { writeFatalLog } from "../lib/logger.js";
import { expirePendingReservations } from "./service.js";

async function run(): Promise<void> {
  const env = parseEnv(process.env);
  const database = createDatabaseClient(requireDatabaseUrl(env), { maxConnections: 2 });
  let stopping = false;
  process.once("SIGTERM", () => {
    stopping = true;
  });
  process.once("SIGINT", () => {
    stopping = true;
  });
  try {
    while (!stopping) {
      const processed = await expirePendingReservations(database);
      if (!processed) await delay(2_000);
    }
  } finally {
    await database.close();
  }
}

void run().catch((error: unknown) => {
  writeFatalLog("Reservation worker failed", error);
  process.exitCode = 1;
});
