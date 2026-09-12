import { afterEach, describe, expect, it, vi } from "vitest";
import { installGracefulShutdown } from "../../src/lib/graceful-shutdown.js";

let removeHandlers: (() => void) | undefined;

afterEach(() => {
  removeHandlers?.();
  removeHandlers = undefined;
});

describe("graceful shutdown", () => {
  it("runs shutdown once and removes signal handlers cleanly", async () => {
    const initialListenerCount = process.listenerCount("SIGTERM");
    const shutdown = vi.fn(() => Promise.resolve());
    const onStart = vi.fn();
    const onComplete = vi.fn();
    const onFailure = vi.fn();
    const exit = vi.fn((code: number): never => {
      throw new Error(`Unexpected exit ${code}`);
    });

    removeHandlers = installGracefulShutdown({
      shutdown,
      onStart,
      onComplete,
      onFailure,
      timeoutMs: 1_000,
      exit,
    });

    process.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith("SIGTERM"));

    expect(shutdown).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledWith("SIGTERM");
    expect(onFailure).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    removeHandlers();
    removeHandlers = undefined;
    expect(process.listenerCount("SIGTERM")).toBe(initialListenerCount);
  });
});
