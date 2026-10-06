import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

type SecretConfig = Parameters<typeof symmetricEncrypt>[0]["key"];

export const BACKUP_CODE_COUNT = 10;

/**
 * Backup codes in the exact shape better-auth's `verify-backup-code` reads: an encrypted JSON array
 * of `xxxxx-xxxxx` strings under the default `storeBackupCodes: "encrypted"`. The plugin's own
 * helpers are type-only exports at runtime, so the format is reproduced here and pinned by the
 * integration tests that sign in with generated codes.
 */
export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const code = generateRandomString(10, "a-z", "0-9", "A-Z");
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export function encodeBackupCodes(codes: string[], key: SecretConfig): Promise<string> {
  return symmetricEncrypt({ data: JSON.stringify(codes), key });
}

export async function decodeBackupCodes(stored: string, key: SecretConfig): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await symmetricDecrypt({ key, data: stored }));
    return Array.isArray(parsed) ? parsed.filter((code) => typeof code === "string") : [];
  } catch {
    return [];
  }
}
