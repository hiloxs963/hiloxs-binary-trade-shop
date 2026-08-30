import { describe, expect, it } from "vitest";
import { InternalError, serializeError, ValidationError } from "../../src/lib/errors.js";

describe("safe error serialization", () => {
  it("exposes validation messages and stable codes", () => {
    expect(serializeError(new ValidationError("Invalid payload"), "request-1")).toEqual({
      statusCode: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid payload",
          requestId: "request-1",
        },
      },
    });
  });

  it("hides internal messages, stacks, paths, and secrets", () => {
    const source = new Error(
      "password=hunter2 SQL failed at C:\\private\\server.ts using postgresql://admin:secret@db/hiloxs",
    );
    const serialized = serializeError(new InternalError(source), "request-2");
    const response = JSON.stringify(serialized.body);

    expect(serialized.statusCode).toBe(500);
    expect(response).toContain("INTERNAL_ERROR");
    expect(response).not.toContain("hunter2");
    expect(response).not.toContain("SQL");
    expect(response).not.toContain("server.ts");
    expect(response).not.toContain("postgresql");
  });
});
