/** The base32 secret in an otpauth://totp URI, for manual entry; null for anything else. */
export function manualSetupKey(totpURI: string): string | null {
  try {
    const url = new URL(totpURI);
    if (url.protocol !== "otpauth:" || url.hostname !== "totp") return null;
    const secret = url.searchParams.get("secret")?.trim();
    return secret && /^[A-Z2-7]+=*$/i.test(secret) ? secret : null;
  } catch {
    return null;
  }
}
