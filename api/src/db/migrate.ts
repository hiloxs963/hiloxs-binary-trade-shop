import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { parseEnv, requireDatabaseUrl } from "../config/env.js";
import { writeFatalLog } from "../lib/logger.js";
import { createDatabaseClient } from "./client.js";

async function run(): Promise<void> {
  const env = parseEnv(process.env);
  const database = createDatabaseClient(requireDatabaseUrl(env));
  try {
    await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
  } finally {
    await database.close();
  }
}

void run().catch((error: unknown) => {
  writeFatalLog("Database migration failed", error);
  process.exitCode = 1;
});
