import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { parseEnv, requireDatabaseUrl } from "../config/env.js";
import { writeFatalLog } from "../lib/logger.js";
import { createDatabaseClient } from "./client.js";

async function run(): Promise<void> {
  const env = parseEnv(process.env);
  const database = createDatabaseClient(requireDatabaseUrl(env));
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
    });
  } finally {
    await database.close();
  }
}

void run().catch((error: unknown) => {
  writeFatalLog("Database migration failed", error);
  process.exitCode = 1;
});
