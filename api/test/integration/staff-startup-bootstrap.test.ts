import { resolve } from "node:path";
import { and, count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl, parseEnv, requireDatabaseUrl } from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { session, twoFactor, user } from "../../src/db/schema/auth.js";
import {
  staffAuditEvents,
  staffMemberships,
  staffPermissionGrants,
} from "../../src/db/schema/staff.js";
import { runStaffBootstrapGrants } from "../../src/staff/startup-bootstrap.js";

const baseEnv = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(baseEnv);
assertSafeTestDatabaseUrl(databaseUrl, baseEnv.NODE_ENV);

let database: DatabaseClient;

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
});

beforeEach(async () => {
  await database.pool.query(
    'truncate table "staff_audit_events", "staff_permission_grants", "staff_memberships", "verification", "two_factor", "session", "account", "user" cascade',
  );
});

afterAll(async () => {
  await database.pool.end();
});

function bootstrapEnv(userIds: string, permissions: string) {
  return parseEnv({
    ...process.env,
    STAFF_BOOTSTRAP_USER_ID: userIds,
    STAFF_BOOTSTRAP_PERMISSIONS: permissions,
  });
}

async function insertUser(
  id: string,
  options: { twoFactor?: boolean; status?: "ACTIVE" | "SUSPENDED" } = {},
): Promise<void> {
  const enrolled = options.twoFactor ?? true;
  await database.db.insert(user).values({
    id,
    name: "Bootstrap Test",
    email: `${id}@example.com`,
    emailVerified: true,
    phone: "0712345678",
    status: options.status ?? "ACTIVE",
    twoFactorEnabled: enrolled,
  });
  if (enrolled) {
    await database.db
      .insert(twoFactor)
      .values({ id: `tf_${id}`, secret: "s", backupCodes: "b", userId: id, verified: true });
  }
}

async function insertSession(userId: string): Promise<void> {
  await database.db.insert(session).values({
    id: `sess_${userId}`,
    token: `token_${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

async function grantsFor(userId: string): Promise<string[]> {
  const rows = await database.db
    .select({ permission: staffPermissionGrants.permission })
    .from(staffPermissionGrants)
    .where(eq(staffPermissionGrants.staffUserId, userId));
  return rows.map((row) => row.permission).sort();
}

async function auditCount(action: "STAFF_BOOTSTRAPPED" | "STAFF_PERMISSION_GRANTED") {
  const [row] = await database.db
    .select({ value: count() })
    .from(staffAuditEvents)
    .where(
      and(eq(staffAuditEvents.action, action), eq(staffAuditEvents.actorType, "SYSTEM_BOOTSTRAP")),
    );
  return row?.value ?? 0;
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await database.db
    .select({ value: count() })
    .from(session)
    .where(eq(session.userId, userId));
  return row?.value ?? 0;
}

describe("staff startup bootstrap against PostgreSQL", () => {
  it("creates memberships and grants for several users and audits each change", async () => {
    await insertUser("ceo");
    await insertUser("cofounder");
    await insertSession("ceo");

    await runStaffBootstrapGrants(
      database,
      bootstrapEnv("ceo,cofounder", "SELLER_REVIEW,PRODUCT_REVIEW"),
    );

    expect(await grantsFor("ceo")).toEqual(["PRODUCT_REVIEW", "SELLER_REVIEW"]);
    expect(await grantsFor("cofounder")).toEqual(["PRODUCT_REVIEW", "SELLER_REVIEW"]);
    const memberships = await database.db.select().from(staffMemberships);
    expect(memberships.map((row) => row.userId).sort()).toEqual(["ceo", "cofounder"]);
    expect(await auditCount("STAFF_BOOTSTRAPPED")).toBe(2);
    expect(await auditCount("STAFF_PERMISSION_GRANTED")).toBe(4);
    // A new membership signs the user out so the next login postdates it.
    expect(await sessionCount("ceo")).toBe(0);
  });

  it("is idempotent: a second run changes nothing and keeps existing sessions", async () => {
    await insertUser("ceo");
    const env = bootstrapEnv("ceo", "SELLER_REVIEW,PRODUCT_REVIEW");
    await runStaffBootstrapGrants(database, env);
    await insertSession("ceo");

    await runStaffBootstrapGrants(database, env);

    expect(await grantsFor("ceo")).toEqual(["PRODUCT_REVIEW", "SELLER_REVIEW"]);
    expect(await auditCount("STAFF_BOOTSTRAPPED")).toBe(1);
    expect(await auditCount("STAFF_PERMISSION_GRANTED")).toBe(2);
    expect(await sessionCount("ceo")).toBe(1);
  });

  it("adds newly configured permissions to an existing member", async () => {
    await insertUser("ceo");
    await runStaffBootstrapGrants(database, bootstrapEnv("ceo", "SELLER_REVIEW"));

    await runStaffBootstrapGrants(database, bootstrapEnv("ceo", "SELLER_REVIEW,CATALOG_ACTIVATE"));

    expect(await grantsFor("ceo")).toEqual(["CATALOG_ACTIVATE", "SELLER_REVIEW"]);
    expect(await auditCount("STAFF_BOOTSTRAPPED")).toBe(1);
    expect(await auditCount("STAFF_PERMISSION_GRANTED")).toBe(2);
  });

  it("does not throw for a non-existent id and still bootstraps the valid user", async () => {
    await insertUser("ceo");

    await expect(
      runStaffBootstrapGrants(
        database,
        bootstrapEnv("does-not-exist,ceo,not a valid id", "SELLER_REVIEW"),
      ),
    ).resolves.toBeUndefined();

    expect(await grantsFor("ceo")).toEqual(["SELLER_REVIEW"]);
    expect(await grantsFor("does-not-exist")).toEqual([]);
    const [members] = await database.db.select({ value: count() }).from(staffMemberships);
    expect(members?.value).toBe(1);
  });

  it("skips accounts without two-factor or that are not active, without throwing", async () => {
    await insertUser("no-mfa", { twoFactor: false });
    await insertUser("suspended", { status: "SUSPENDED" });

    await expect(
      runStaffBootstrapGrants(database, bootstrapEnv("no-mfa,suspended", "SELLER_REVIEW")),
    ).resolves.toBeUndefined();

    const [members] = await database.db.select({ value: count() }).from(staffMemberships);
    expect(members?.value).toBe(0);
    expect(await auditCount("STAFF_BOOTSTRAPPED")).toBe(0);
  });
});
