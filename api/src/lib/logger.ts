import { LOG_REDACT_PATHS, redactRequestUrl, safeErrorForLog } from "./redact.js";

export function createLoggerOptions(level: string) {
  return {
    level,
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: "[REDACTED]",
    },
    serializers: {
      req(request: { method?: string; url?: string }) {
        return {
          method: request.method ?? "UNKNOWN",
          url: request.url ? redactRequestUrl(request.url) : "",
        };
      },
    },
  };
}

export function writeFatalLog(message: string, error: unknown): void {
  process.stderr.write(
    `${JSON.stringify({ level: "fatal", message, error: safeErrorForLog(error) })}\n`,
  );
}
