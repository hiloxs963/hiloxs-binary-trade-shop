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

const schema = {
  ...authSchema,
  ...commerceSchema,
  ...metadataSchema,
  ...mediaSchema,
  ...paymentSchema,
  ...sellerProductSchema,
  ...sellerSchema,
  ...staffSchema,
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
