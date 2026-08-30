import { describe, expect, it } from "vitest";
import { redactSensitive, redactText, safeErrorForLog } from "../../src/lib/redact.js";

describe("log redaction", () => {
  it("redacts database credentials and bearer tokens in text", () => {
    const text = redactText(
      "postgresql://admin:secret@database:5432/hiloxs Bearer top-secret password=hunter2 apiKey=client-key x-api-key: header-key",
    );

    expect(text).not.toContain("admin:secret");
    expect(text).not.toContain("top-secret");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("client-key");
    expect(text).not.toContain("header-key");
    expect(text).toContain("[REDACTED]");
  });

  it("redacts sensitive object keys recursively", () => {
    expect(
      redactSensitive({
        user: "safe",
        headers: { authorization: "Bearer secret", cookie: "session=secret" },
        databaseUrl: "postgresql://user:password@database/hiloxs",
        DATABASE_URL: "postgresql://user:password@database/hiloxs",
        password: "password-value",
        token: "token-value",
        secret: "secret-value",
        apiKey: "api-key-value",
        api_key: "api-key-value",
        API_KEY: "api-key-value",
        "x-api-key": "api-key-value",
        nested: { xApiKey: "api-key-value" },
      }),
    ).toEqual({
      user: "safe",
      headers: { authorization: "[REDACTED]", cookie: "[REDACTED]" },
      databaseUrl: "[REDACTED]",
      DATABASE_URL: "[REDACTED]",
      password: "[REDACTED]",
      token: "[REDACTED]",
      secret: "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      API_KEY: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      nested: { xApiKey: "[REDACTED]" },
    });
  });

  it("preserves benign structured values", () => {
    const value = {
      username: "safe-user",
      profile: { publicUrl: "https://example.com/profile" },
      apiVersion: "v1",
      keyLabel: "primary",
    };

    expect(redactSensitive(value)).toEqual(value);
  });

  it("creates safe structured error details", () => {
    expect(
      safeErrorForLog(new Error("connect postgresql://admin:secret@database/hiloxs failed")),
    ).toEqual({
      name: "Error",
      message: "connect postgresql://[REDACTED]@database/hiloxs failed",
    });
  });
});
