import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../db/client.js";
import { verification } from "../db/schema/auth.js";

const EMAIL_VERIFICATION_PREFIX = "email-verification:";

export class EmailVerificationTokenStore {
  readonly #database: DatabaseClient;

  constructor(database: DatabaseClient) {
    this.#database = database;
  }

  async issue(token: string, userId: string, expiresInSeconds: number): Promise<void> {
    await this.#database.db.insert(verification).values({
      id: randomUUID(),
      identifier: tokenIdentifier(token),
      value: userId,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
    });
  }

  async consumeAfter<T>(token: string, verify: () => Promise<T>): Promise<T | null> {
    return this.#database.db.transaction(async (transaction) => {
      const identifier = tokenIdentifier(token);
      const [record] = await transaction
        .select({ expiresAt: verification.expiresAt })
        .from(verification)
        .where(eq(verification.identifier, identifier))
        .for("update");

      if (!record) return null;
      if (record.expiresAt <= new Date()) {
        await transaction.delete(verification).where(eq(verification.identifier, identifier));
        return null;
      }

      const result = await verify();
      await transaction.delete(verification).where(eq(verification.identifier, identifier));
      return result;
    });
  }
}

function tokenIdentifier(token: string): string {
  return `${EMAIL_VERIFICATION_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}
