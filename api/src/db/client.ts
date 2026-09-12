import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as authSchema from "./schema/auth.js";
import * as commerceSchema from "./schema/commerce.js";
import * as metadataSchema from "./schema/system-metadata.js";
import * as mediaSchema from "./schema/media.js";
import * as paymentSchema from "./schema/payments.js";
import * as sellerProductSchema from "./schema/seller-products.js";
import * as sellerSchema from "./schema/sellers.js";
import * as staffSchema from "./schema/staff.js";
import * as securitySchema from "./schema/security.js";
import { safeErrorForLog } from "../lib/redact.js";

const schema = {
  ...authSchema,
  ...commerceSchema,
  ...metadataSchema,
  ...mediaSchema,
  ...paymentSchema,
  ...sellerProductSchema,
  ...sellerSchema,
  ...staffSchema,
  ...securitySchema,
};

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseClient = {
  pool: Pool;
  db: Database;
  checkConnection: () => Promise<void>;
  close: () => Promise<void>;
};

type DatabaseClientOptions = {
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  applicationName?: string;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
};

export function createDatabaseClient(
  databaseUrl: string,
  options: DatabaseClientOptions = {},
): DatabaseClient {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    application_name: options.applicationName ?? "hiloxs-api",
    statement_timeout: options.statementTimeoutMs ?? 30_000,
    lock_timeout: options.lockTimeoutMs ?? 10_000,
    idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs ?? 60_000,
  });
  pool.on("error", (error) => {
    process.stderr.write(
      `${JSON.stringify({ level: "error", message: "PostgreSQL pool error", error: safeErrorForLog(error) })}\n`,
    );
  });
  const db = drizzle(pool, { schema });

  return {
    pool,
    db,
    async checkConnection() {
      await pool.query("select 1");
    },
    async close() {
      await pool.end();
    },
  };
}
