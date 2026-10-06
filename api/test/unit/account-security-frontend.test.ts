import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAccountSecurityStatus } from "../../../src/lib/account-security-status.js";
import {
  RECOVERY_CODES_FILENAME,
  describeAccountSecurityError,
  recoveryCodesFileContents,
} from "../../../src/lib/recovery-codes.js";
import { manualSetupKey } from "../../../src/lib/totp-uri.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account security status degrades against an older API", () => {
  it("returns null when the endpoint does not exist yet (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));

    await expect(
      loadAccountSecurityStatus(() => fetch("/api/v1/account/security")),
    ).resolves.toBeNull();
  });

  it.each([401, 403, 500, 503])("returns null on %i so no new control appears", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));

    await expect(
      loadAccountSecurityStatus(() => fetch("/api/v1/account/security")),
    ).resolves.toBeNull();
  });

  it("returns null when the request cannot be made at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(
      loadAccountSecurityStatus(() => fetch("/api/v1/account/security")),
    ).resolves.toBeNull();
  });

  it("returns the status when the API supports it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ enrolled: true, backupCodesRemaining: 7 }), {
          status: 200,
        }),
      ),
    );

    await expect(
      loadAccountSecurityStatus(() => fetch("/api/v1/account/security")),
    ).resolves.toEqual({
      enrolled: true,
      backupCodesRemaining: 7,
    });
  });
});

describe("recovery code download", () => {
  it("lists every code in a plain-text file without identifying the account", () => {
    const text = recoveryCodesFileContents(["aaaaa-11111", "bbbbb-22222"], new Date("2026-10-06"));

    expect(RECOVERY_CODES_FILENAME).toBe("hiloxs-backup-codes.txt");
    expect(text).toContain("aaaaa-11111\nbbbbb-22222\n");
    expect(text).toContain("Generated: 2026-10-06");
    expect(text).not.toMatch(/@/);
  });
});

describe("account security error copy", () => {
  it("does not reveal which proof was wrong", () => {
    expect(describeAccountSecurityError({ status: 403, code: "REAUTHENTICATION_FAILED" })).toBe(
      "The password or code is incorrect.",
    );
  });

  it("explains throttling, expiry, and a wrong new-app code", () => {
    expect(describeAccountSecurityError({ status: 429, code: "RATE_LIMITED" })).toMatch(
      /Too many attempts/,
    );
    expect(describeAccountSecurityError({ status: 409, code: "CONFLICT" })).toMatch(/Start again/);
    expect(
      describeAccountSecurityError({ status: 401, code: "INVALID_SECOND_FACTOR_CODE" }),
    ).toMatch(/new authenticator app/);
  });
});

describe("manual setup key", () => {
  it("extracts the secret from a totp URI and rejects anything else", () => {
    expect(
      manualSetupKey("otpauth://totp/HILOXS:a@b.c?secret=JBSWY3DPEHPK3PXP&issuer=HILOXS"),
    ).toBe("JBSWY3DPEHPK3PXP");
    expect(manualSetupKey("otpauth://hotp/x?secret=JBSWY3DP")).toBeNull();
    expect(manualSetupKey("https://example.com?secret=JBSWY3DP")).toBeNull();
    expect(manualSetupKey("not a uri")).toBeNull();
  });
});
