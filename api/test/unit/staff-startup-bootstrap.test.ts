import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/config/env.js";
import type { DatabaseClient } from "../../src/db/client.js";
import { ConflictError, NotFoundError } from "../../src/lib/errors.js";
import {
  resolveStaffBootstrapConfig,
  runStaffBootstrapGrants,
} from "../../src/staff/startup-bootstrap.js";

const database = {} as unknown as DatabaseClient;
const USER_ID = "user_01HZX0000000000000000000";
const OTHER_USER_ID = "user_01HZX0000000000000000001";
const MEMBERSHIP_EXISTS = new ConflictError("A staff membership already exists");

// Every user already has a membership unless a test says otherwise.
const existingMembership = () => vi.fn().mockRejectedValue(MEMBERSHIP_EXISTS);

function envWith(values: Record<string, string>) {
  return parseEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/db", ...values });
}

describe("staff startup bootstrap", () => {
  const lines: string[] = [];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    lines.length = 0;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  const messages = () =>
    lines.map((line) => (JSON.parse(line.trim()) as { message: string }).message);
  const levels = () => lines.map((line) => (JSON.parse(line.trim()) as { level: string }).level);

  it("grants every configured permission when the membership already exists", async () => {
    const grant = vi.fn().mockResolvedValue(undefined);
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,PRODUCT_REVIEW,CATALOG_ACTIVATE",
    });

    await runStaffBootstrapGrants(database, env, { grant, createMembership: existingMembership() });

    expect(grant.mock.calls.map((call) => (call[1] as { permission: string }).permission)).toEqual([
      "SELLER_REVIEW",
      "PRODUCT_REVIEW",
      "CATALOG_ACTIVATE",
    ]);
    for (const call of grant.mock.calls) {
      const input = call[1] as { staffUserId: string; requestId: string };
      expect(input.staffUserId).toBe(USER_ID);
      expect(input.requestId).toMatch(/^startup-bootstrap:/);
    }
    expect(messages()).toEqual([
      `Staff bootstrap: granted SELLER_REVIEW to ${USER_ID}`,
      `Staff bootstrap: granted PRODUCT_REVIEW to ${USER_ID}`,
      `Staff bootstrap: granted CATALOG_ACTIVATE to ${USER_ID}`,
    ]);
  });

  it("creates the membership with every permission for a user who has none", async () => {
    const grant = vi.fn();
    const createMembership = vi.fn().mockResolvedValue(undefined);
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,PRODUCT_REVIEW",
    });

    await runStaffBootstrapGrants(database, env, { grant, createMembership });

    expect(createMembership).toHaveBeenCalledTimes(1);
    expect(createMembership.mock.calls[0]?.[1]).toMatchObject({
      userId: USER_ID,
      role: "STAFF",
      permissions: ["SELLER_REVIEW", "PRODUCT_REVIEW"],
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it("processes every user in a comma-separated list", async () => {
    const grant = vi.fn().mockResolvedValue(undefined);
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: ` ${USER_ID} , ${OTHER_USER_ID},${USER_ID}`,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW",
    });

    await runStaffBootstrapGrants(database, env, { grant, createMembership: existingMembership() });

    expect(
      grant.mock.calls.map((call) => (call[1] as { staffUserId: string }).staffUserId),
    ).toEqual([USER_ID, OTHER_USER_ID]);
  });

  it("is idempotent when every grant is already active", async () => {
    const grant = vi
      .fn()
      .mockRejectedValue(new ConflictError("The staff permission is already active"));
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,PRODUCT_REVIEW",
    });

    await expect(
      runStaffBootstrapGrants(database, env, { grant, createMembership: existingMembership() }),
    ).resolves.toBeUndefined();

    expect(grant).toHaveBeenCalledTimes(2);
    expect(messages()).toEqual([
      `Staff bootstrap: SELLER_REVIEW already active for ${USER_ID}`,
      `Staff bootstrap: PRODUCT_REVIEW already active for ${USER_ID}`,
    ]);
    expect(levels()).toEqual(["info", "info"]);
  });

  it("skips and logs when no bootstrap user is configured", async () => {
    const grant = vi.fn();

    await runStaffBootstrapGrants(database, envWith({}), { grant });

    expect(grant).not.toHaveBeenCalled();
    expect(messages()).toEqual(["Staff bootstrap: no STAFF_BOOTSTRAP_USER_ID set, skipping"]);
  });

  it("skips when only one of the two variables is set", async () => {
    const grant = vi.fn();
    const createMembership = vi.fn();

    await runStaffBootstrapGrants(database, envWith({ STAFF_BOOTSTRAP_USER_ID: USER_ID }), {
      grant,
      createMembership,
    });
    await runStaffBootstrapGrants(
      database,
      envWith({ STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW" }),
      { grant, createMembership },
    );

    expect(grant).not.toHaveBeenCalled();
    expect(createMembership).not.toHaveBeenCalled();
  });

  it("warns and skips a user that does not exist, without throwing", async () => {
    const grant = vi.fn();
    const createMembership = vi.fn().mockRejectedValue(new NotFoundError());
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: "no_such_user_id",
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW",
    });

    await expect(
      runStaffBootstrapGrants(database, env, { grant, createMembership }),
    ).resolves.toBeUndefined();

    expect(grant).not.toHaveBeenCalled();
    expect(levels()).toEqual(["warn"]);
    expect(messages()[0]).toContain("skipped no_such_user_id");
  });

  it("keeps processing later users after one fails", async () => {
    const grant = vi.fn().mockResolvedValue(undefined);
    const createMembership = vi
      .fn()
      .mockRejectedValueOnce(new NotFoundError())
      .mockRejectedValueOnce(MEMBERSHIP_EXISTS);
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: `missing_user,${OTHER_USER_ID}`,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW",
    });

    await runStaffBootstrapGrants(database, env, { grant, createMembership });

    expect(grant).toHaveBeenCalledTimes(1);
    expect((grant.mock.calls[0]?.[1] as { staffUserId: string }).staffUserId).toBe(OTHER_USER_ID);
  });

  it("skips an invalid id without touching the database", async () => {
    const grant = vi.fn();
    const createMembership = vi.fn();
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: "bad id; drop table",
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW",
    });

    await expect(
      runStaffBootstrapGrants(database, env, { grant, createMembership }),
    ).resolves.toBeUndefined();

    expect(grant).not.toHaveBeenCalled();
    expect(createMembership).not.toHaveBeenCalled();
    expect(levels()).toEqual(["warn"]);
  });

  it("warns instead of throwing for ineligible accounts and unexpected errors", async () => {
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: `${USER_ID},${OTHER_USER_ID}`,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW",
    });
    const createMembership = vi
      .fn()
      .mockRejectedValueOnce(new ConflictError("The account is not eligible for staff bootstrap"))
      .mockRejectedValueOnce(new Error('connection to "postgres://secret@host" failed'));

    await expect(
      runStaffBootstrapGrants(database, env, { createMembership, grant: vi.fn() }),
    ).resolves.toBeUndefined();

    expect(levels()).toEqual(["warn", "warn"]);
    expect(messages()[0]).toContain("not eligible");
    expect(messages().join("\n")).not.toContain("postgres://");
  });

  it("warns for a refused grant and still attempts the user's other permissions", async () => {
    const grant = vi
      .fn()
      .mockRejectedValueOnce(
        new ConflictError("The account is not eligible for a staff permission grant"),
      )
      .mockResolvedValueOnce(undefined);
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,PRODUCT_REVIEW",
    });

    await expect(
      runStaffBootstrapGrants(database, env, { grant, createMembership: existingMembership() }),
    ).resolves.toBeUndefined();

    expect(grant).toHaveBeenCalledTimes(2);
    expect(levels()).toEqual(["warn", "info"]);
  });

  it("ignores unknown permission names with a warning and grants the valid ones", async () => {
    const grant = vi.fn().mockResolvedValue(undefined);
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,NOT_A_PERMISSION",
    });

    await expect(
      runStaffBootstrapGrants(database, env, { grant, createMembership: existingMembership() }),
    ).resolves.toBeUndefined();

    expect(grant).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain("unknown permission");
    expect(levels()[0]).toBe("warn");
  });

  it("skips entirely when no valid permission remains", async () => {
    const grant = vi.fn();
    const createMembership = vi.fn();
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "NOT_A_PERMISSION",
    });

    await runStaffBootstrapGrants(database, env, { grant, createMembership });

    expect(grant).not.toHaveBeenCalled();
    expect(createMembership).not.toHaveBeenCalled();
    expect(levels()).toEqual(["warn", "warn"]);
  });

  it("trims, ignores blanks, and de-duplicates both lists", () => {
    const config = resolveStaffBootstrapConfig(
      envWith({
        STAFF_BOOTSTRAP_USER_ID: `  ${USER_ID}  , ,${OTHER_USER_ID}, ${USER_ID}`,
        STAFF_BOOTSTRAP_PERMISSIONS: " SELLER_REVIEW , ,PRODUCT_REVIEW, SELLER_REVIEW ",
      }),
    );

    expect(config).toEqual({
      userIds: [USER_ID, OTHER_USER_ID],
      invalidUserIds: [],
      permissions: ["SELLER_REVIEW", "PRODUCT_REVIEW"],
      unknownPermissions: [],
    });
  });

  it("treats lists that are only separators as unconfigured", () => {
    expect(
      resolveStaffBootstrapConfig(
        envWith({ STAFF_BOOTSTRAP_USER_ID: USER_ID, STAFF_BOOTSTRAP_PERMISSIONS: " , , " }),
      ),
    ).toBeNull();
    expect(
      resolveStaffBootstrapConfig(
        envWith({ STAFF_BOOTSTRAP_USER_ID: " , ", STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW" }),
      ),
    ).toBeNull();
  });
});
