type ShutdownOptions = {
  shutdown: (signal: NodeJS.Signals) => Promise<void>;
  onStart: (signal: NodeJS.Signals) => void;
  onComplete: (signal: NodeJS.Signals) => void;
  onFailure: (signal: NodeJS.Signals, error: unknown) => void;
  timeoutMs?: number;
  exit?: (code: number) => never;
};

export function installGracefulShutdown(options: ShutdownOptions): () => void {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  const handler = (signal: NodeJS.Signals): void => {
    if (shuttingDown) exit(1);
    shuttingDown = true;
    options.onStart(signal);
    const timeout = setTimeout(() => exit(1), timeoutMs);
    timeout.unref();
    void options
      .shutdown(signal)
      .then(() => options.onComplete(signal))
      .catch((error: unknown) => {
        options.onFailure(signal, error);
        process.exitCode = 1;
      })
      .finally(() => clearTimeout(timeout));
  };

  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
  return () => {
    process.off("SIGTERM", handler);
    process.off("SIGINT", handler);
  };
}
