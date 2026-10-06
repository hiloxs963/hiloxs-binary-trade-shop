export const RECOVERY_CODES_FILENAME = "hiloxs-backup-codes.txt";

/**
 * The text saved by "Download". Plain text on purpose: it must open anywhere and be printable.
 * Nothing here identifies the account, so a stray file does not say whose codes they are.
 */
export function recoveryCodesFileContents(
  codes: readonly string[],
  now: Date = new Date(),
): string {
  return [
    "HILOXS backup codes",
    `Generated: ${now.toISOString().slice(0, 10)}`,
    "",
    "Each code works once. Store this file somewhere safe and offline.",
    "Anyone with these codes and your password can sign in as you.",
    "",
    ...codes,
    "",
  ].join("\n");
}

type ErrorLike = { status: number; code: string };

/** User-facing copy for the account-security actions. Never reveals which proof was wrong. */
export function describeAccountSecurityError(error: ErrorLike): string {
  if (error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (error.status === 403) return "The password or code is incorrect.";
  if (error.status === 401 && error.code === "INVALID_SECOND_FACTOR_CODE") {
    return "That code is incorrect. Check the code shown in your new authenticator app.";
  }
  if (error.status === 401) return "Your session expired. Log in again.";
  if (error.status === 409) return "This change expired or is no longer in progress. Start again.";
  return "That could not be completed. Try again.";
}
