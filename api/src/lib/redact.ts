import { AppError } from "./errors.js";

const SENSITIVE_KEY = /authorization|cookie|password|passphrase|token|secret|databaseurl|apikey/i;

const API_KEY_FIELDS = ["apiKey", "api_key", "API_KEY", "xApiKey"] as const;
const HEADER_PATHS = ["req.headers", "request.headers", "headers"] as const;

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_KEY.test(normalizedKey);
}

export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "password",
  "token",
  "secret",
  "DATABASE_URL",
  "databaseUrl",
  ...API_KEY_FIELDS,
  ...HEADER_PATHS.map((path) => `${path}["x-api-key"]`),
] as const;

export function redactText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^\s@]+@/gi, "$1[REDACTED]@")
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(
      /((?:password|token|secret|database[_-]?url|(?:x[_-]?)?api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );
}

export function redactSensitive(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : redactSensitive(entry),
    ]),
  );
}

export function safeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return {
      name: error.name,
      code: error.code,
      message: redactText(error.message),
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactText(error.message),
    };
  }
  return { name: "UnknownError", detail: redactSensitive(error) };
}
