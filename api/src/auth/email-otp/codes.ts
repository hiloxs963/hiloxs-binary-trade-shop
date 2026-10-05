import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const EMAIL_OTP_DIGITS = 6;

export function formatEmailOtpCode(value: number): string {
  return value.toString().padStart(EMAIL_OTP_DIGITS, "0");
}

/** Uniform 6-digit code from the OS CSPRNG, zero-padded. */
export function generateEmailOtpCode(): string {
  return formatEmailOtpCode(randomInt(0, 10 ** EMAIL_OTP_DIGITS));
}

function hmacHex(key: string, purpose: string, ...parts: string[]): string {
  const hmac = createHmac("sha256", key).update(purpose);
  for (const part of parts) hmac.update("\0").update(part);
  return hmac.digest("hex");
}

/** Binds the code to its challenge and user, so a stored hash cannot be replayed elsewhere. */
export function hashEmailOtpCode(
  key: string,
  challengeId: string,
  userId: string,
  code: string,
): string {
  return hmacHex(key, "email-otp-code", challengeId, userId, code);
}

/** Keyed digest of the pending-login identifier; the raw cookie value is never stored. */
export function digestPendingLogin(key: string, pendingIdentifier: string): string {
  return hmacHex(key, "email-otp-pending", pendingIdentifier);
}

export function digestClientIp(key: string, ip: string): string {
  return hmacHex(key, "email-otp-ip", ip);
}

/** Constant-time comparison of two equal-length hex digests. */
export function digestsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
