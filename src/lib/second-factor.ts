export type SecondFactorMethod = "totp" | "email-otp" | "backup-code";

/**
 * The methods the login screen may offer after a correct password. The server advertises
 * "totp" and, only when this account may use it, "email-otp". A backup code is always an
 * option for an account that has two-factor enabled, so it is never hidden.
 */
export function availableSecondFactorMethods(advertised: unknown): SecondFactorMethod[] {
  const listed: unknown[] = Array.isArray(advertised) ? advertised : [];
  const methods: SecondFactorMethod[] = ["totp"];
  if (listed.includes("email-otp")) methods.push("email-otp");
  methods.push("backup-code");
  return methods;
}

export const SECOND_FACTOR_LABELS: Record<SecondFactorMethod, string> = {
  totp: "Authenticator app",
  "email-otp": "Email code",
  "backup-code": "Backup code",
};

export function normalizeSecondFactorCode(method: SecondFactorMethod, value: string): string {
  if (method === "backup-code") return value.trim().slice(0, 128);
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isValidSecondFactorCode(method: SecondFactorMethod, value: string): boolean {
  if (method === "backup-code") return value.trim().length > 0 && value.trim().length <= 128;
  return /^\d{6}$/.test(value);
}

export function secondFactorPrompt(method: SecondFactorMethod): string {
  switch (method) {
    case "totp":
      return "Enter the six-digit code from your authenticator app.";
    case "email-otp":
      return "Enter the six-digit code we emailed you.";
    case "backup-code":
      return "Enter one of your unused backup codes.";
  }
}

/** Whole seconds left until `iso`, never negative, tolerant of a missing or invalid timestamp. */
export function secondsUntil(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

type ErrorLike = { status: number; code: string };

/** User-facing copy for a failed send. Always points at the authenticator as the way forward. */
export function describeEmailOtpSendError(error: ErrorLike): string {
  if (error.code === "EMAIL_OTP_SEND_FAILED" || error.status === 503) {
    return "We couldn't send the code. Use your authenticator app instead, or try again shortly.";
  }
  if (error.status === 429) {
    return "A code was sent recently or too many were requested. Wait a minute, or use your authenticator app.";
  }
  if (error.code === "INVALID_TWO_FACTOR_COOKIE" || error.status === 401) {
    return "Your sign-in session expired. Log in again.";
  }
  if (error.code === "EMAIL_OTP_UNAVAILABLE" || error.status === 403 || error.status === 404) {
    return "Email codes aren't available for this sign-in. Use your authenticator app.";
  }
  return "We couldn't send the code. Use your authenticator app instead.";
}

export function describeSecondFactorError(method: SecondFactorMethod, error: ErrorLike): string {
  if (error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") {
    return "Your sign-in session expired. Log in again.";
  }
  switch (method) {
    case "totp":
      return "The authentication code could not be verified.";
    case "email-otp":
      return "That code is incorrect or has expired. Request a new code, or use your authenticator app.";
    case "backup-code":
      return "That backup code could not be verified. Each code works once.";
  }
}
