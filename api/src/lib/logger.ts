import { LOG_REDACT_PATHS, safeErrorForLog } from "./redact.js";

export function createLoggerOptions(level: string) {
  return {
    level,
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: "[REDACTED]",
    },
  };
}

export function writeFatalLog(message: string, error: unknown): void {
  process.stderr.write(
    `${JSON.stringify({ level: "fatal", message, error: safeErrorForLog(error) })}\n`,
  );
}
