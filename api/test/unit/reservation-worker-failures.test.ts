import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeOperationalLog } from "../../src/lib/logger.js";

describe("reservation worker failure logging", () => {
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

  it("emits a warn log with the error class name when a reservation expiry fails", () => {
    writeOperationalLog("warn", "Reservation expiry failed for an order", {
      error: new Error("ConnectionTimeout").name,
    });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!.trim()) as {
      level: string;
      message: string;
      error?: string;
      tickFailureCount?: number;
    };
    expect(entry.level).toBe("warn");
    expect(entry.message).toBe("Reservation expiry failed for an order");
    expect(entry.error).toBe("Error");
  });

  it("uses UnknownError for non-Error failures", () => {
    writeOperationalLog("warn", "Reservation expiry failed for an order", {
      error: "UnknownError",
    });

    const entry = JSON.parse(lines[0]!.trim()) as {
      level: string;
      message: string;
      error?: string;
      tickFailureCount?: number;
    };
    expect(entry.error).toBe("UnknownError");
  });

  it("emits an error log when multiple failures occur in one tick", () => {
    writeOperationalLog("error", "Multiple reservation expiry failures in one tick", {
      tickFailureCount: 3,
    });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!.trim()) as {
      level: string;
      message: string;
      error?: string;
      tickFailureCount?: number;
    };
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("Multiple reservation expiry failures in one tick");
    expect(entry.tickFailureCount).toBe(3);
  });
});
