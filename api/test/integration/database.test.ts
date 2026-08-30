import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { assertSafeTestDatabaseUrl, parseEnv, requireDatabaseUrl } from "../../src/config/env.js";
import { createDatabaseClient } from "../../src/db/client.js";

const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

let migrationsApplied = false;

beforeAll(async () => {
  const database = createDatabaseClient(databaseUrl);
  try {
    await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
    migrationsApplied = true;
  } finally {
    await database.close();
  }
});

afterAll(() => {
  migrationsApplied = false;
});

describe("PostgreSQL integration", () => {
  it("applies deterministic migrations", () => {
    expect(migrationsApplied).toBe(true);
  });

  it("connects to the disposable PostgreSQL database", async () => {
    const database = createDatabaseClient(databaseUrl);
    try {
      await expect(database.checkConnection()).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  });

  it("creates the system_metadata infrastructure table", async () => {
    const database = createDatabaseClient(databaseUrl);
    try {
      const result = await database.pool.query<{ table_name: string | null }>(
        "select to_regclass('public.system_metadata') as table_name",
      );
      expect(result.rows[0]?.table_name).toBe("system_metadata");
    } finally {
      await database.close();
    }
  });

  it("returns ready when PostgreSQL is available", async () => {
    const database = createDatabaseClient(databaseUrl);
    const app = await buildApp({ database });
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready", database: "up" });
    } finally {
      await app.close();
    }
  });

  it("returns a safe 503 when PostgreSQL is unavailable", async () => {
    const unavailable = createDatabaseClient(
      "postgresql://hiloxs:hiloxs_test@127.0.0.1:1/hiloxs_test",
      { connectionTimeoutMs: 250 },
    );
    const app = await buildApp({ database: unavailable });
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "not_ready", database: "down" });
      expect(response.body).not.toContain("ECONNREFUSED");
      expect(response.body).not.toContain("127.0.0.1");
    } finally {
      await app.close();
    }
  });
});
