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

  async consume(token: string): Promise<boolean> {
    const [record] = await this.#database.db
      .delete(verification)
      .where(eq(verification.identifier, tokenIdentifier(token)))
      .returning({ expiresAt: verification.expiresAt });

    return Boolean(record && record.expiresAt > new Date());
  }
}

function tokenIdentifier(token: string): string {
  return `${EMAIL_VERIFICATION_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}
