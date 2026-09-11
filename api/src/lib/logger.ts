import { LOG_REDACT_PATHS, redactRequestUrl, redactSensitive, safeErrorForLog } from "./redact.js";

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

export function writeOperationalLog(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const safeFields = redactSensitive(fields) as Record<string, unknown>;
  process.stdout.write(`${JSON.stringify({ level, message, ...safeFields })}\n`);
}
