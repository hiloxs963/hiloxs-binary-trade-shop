import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/config/env.js";
import type { DatabaseClient } from "../../src/db/client.js";
import { ConfigurationError, ConflictError, NotFoundError } from "../../src/lib/errors.js";
import {
  resolveStaffBootstrapConfig,
  runStaffBootstrapGrants,
} from "../../src/staff/startup-bootstrap.js";

const database = {} as unknown as DatabaseClient;
const USER_ID = "user_01HZX0000000000000000000";

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

  it("grants every configured permission when none exist yet", async () => {
    const grant = vi.fn().mockResolvedValue(undefined);
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,PRODUCT_REVIEW,CATALOG_ACTIVATE",
    });

    await runStaffBootstrapGrants(database, env, grant);

    expect(grant).toHaveBeenCalledTimes(3);
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

  it("is idempotent when every grant is already active", async () => {
    const grant = vi
      .fn()
      .mockRejectedValue(new ConflictError("The staff permission is already active"));
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,PRODUCT_REVIEW",
    });

    await expect(runStaffBootstrapGrants(database, env, grant)).resolves.toBeUndefined();

    expect(grant).toHaveBeenCalledTimes(2);
    expect(messages()).toEqual([
      `Staff bootstrap: SELLER_REVIEW already active for ${USER_ID}`,
      `Staff bootstrap: PRODUCT_REVIEW already active for ${USER_ID}`,
    ]);
  });

  it("skips and logs when no bootstrap user is configured", async () => {
    const grant = vi.fn();

    await runStaffBootstrapGrants(database, envWith({}), grant);

    expect(grant).not.toHaveBeenCalled();
    expect(messages()).toEqual(["Staff bootstrap: no STAFF_BOOTSTRAP_USER_ID set, skipping"]);
  });

  it("skips when only one of the two variables is set", async () => {
    const grant = vi.fn();

    await runStaffBootstrapGrants(database, envWith({ STAFF_BOOTSTRAP_USER_ID: USER_ID }), grant);
    await runStaffBootstrapGrants(
      database,
      envWith({ STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW" }),
      grant,
    );

    expect(grant).not.toHaveBeenCalled();
  });

  it("rejects an unknown permission name with ConfigurationError", async () => {
    const grant = vi.fn();
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW,NOT_A_PERMISSION",
    });

    await expect(runStaffBootstrapGrants(database, env, grant)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(grant).not.toHaveBeenCalled();
  });

  it("propagates eligibility failures instead of swallowing them", async () => {
    const env = envWith({
      STAFF_BOOTSTRAP_USER_ID: USER_ID,
      STAFF_BOOTSTRAP_PERMISSIONS: "SELLER_REVIEW",
    });

    await expect(
      runStaffBootstrapGrants(database, env, vi.fn().mockRejectedValue(new NotFoundError())),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      runStaffBootstrapGrants(
        database,
        env,
        vi
          .fn()
          .mockRejectedValue(
            new ConflictError("The account is not eligible for a staff permission grant"),
          ),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("trims, ignores blanks, and de-duplicates the permission list", () => {
    const config = resolveStaffBootstrapConfig(
      envWith({
        STAFF_BOOTSTRAP_USER_ID: `  ${USER_ID}  `,
        STAFF_BOOTSTRAP_PERMISSIONS: " SELLER_REVIEW , ,PRODUCT_REVIEW, SELLER_REVIEW ",
      }),
    );

    expect(config).toEqual({ userId: USER_ID, permissions: ["SELLER_REVIEW", "PRODUCT_REVIEW"] });
  });

  it("rejects a permission list that is only separators", () => {
    expect(() =>
      resolveStaffBootstrapConfig(
        envWith({ STAFF_BOOTSTRAP_USER_ID: USER_ID, STAFF_BOOTSTRAP_PERMISSIONS: " , , " }),
      ),
    ).toThrow(ConfigurationError);
  });
});
