import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DatabaseClient } from "../db/client.js";
import { securityRateLimitWindows } from "../db/schema/security.js";
import { RateLimitError } from "../lib/errors.js";

export type RateLimitInput = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
};

export interface RateLimiter {
  consume(input: RateLimitInput): Promise<void>;
}

const CLEANUP_INTERVAL_MS = 5 * 60_000;
const CLEANUP_BATCH_SIZE = 100;

export class PostgresRateLimiter implements RateLimiter {
  readonly #database: DatabaseClient;
  readonly #hmacKey: string;
  #nextCleanupAt = 0;

  constructor(database: DatabaseClient, hmacKey: string) {
    this.#database = database;
    this.#hmacKey = hmacKey;
  }

  async consume({ scope, key, limit, windowMs, now = new Date() }: RateLimitInput): Promise<void> {
    if (!scope || !key || !Number.isInteger(limit) || limit < 1 || windowMs < 1) {
      throw new TypeError("Invalid rate-limit policy");
    }

    if (now.getTime() >= this.#nextCleanupAt) {
      await this.#cleanup(now);
      this.#nextCleanupAt = now.getTime() + CLEANUP_INTERVAL_MS;
    }

    const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
    const windowStart = new Date(windowStartMs);
    const expiresAt = new Date(windowStartMs + windowMs);
    const keyDigest = digestLimiterKey(this.#hmacKey, scope, key);
    const [window] = await this.#database.db
      .insert(securityRateLimitWindows)
      .values({ scope, keyDigest, windowStart, count: 1, expiresAt, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          securityRateLimitWindows.scope,
          securityRateLimitWindows.keyDigest,
          securityRateLimitWindows.windowStart,
        ],
        set: {
          count: sql`least(${securityRateLimitWindows.count} + 1, ${limit + 1})`,
          expiresAt,
          updatedAt: now,
        },
      })
      .returning({ count: securityRateLimitWindows.count });

    if (!window || window.count > limit) throw new RateLimitError();
  }

  async #cleanup(now: Date): Promise<void> {
    await this.#database.db.execute(sql`
      delete from ${securityRateLimitWindows}
      where ctid in (
        select ctid
        from ${securityRateLimitWindows}
        where ${securityRateLimitWindows.expiresAt} <= ${now}
        order by ${securityRateLimitWindows.expiresAt}
        limit ${CLEANUP_BATCH_SIZE}
      )
    `);
  }
}

export function digestLimiterKey(hmacKey: string, scope: string, key: string): string {
  return createHmac("sha256", hmacKey).update(scope).update("\0").update(key).digest("hex");
}

export const RATE_LIMITS = {
  signUp: { limit: 5, windowMs: 15 * 60_000 },
  signIn: { limit: 5, windowMs: 60_000 },
  passwordResetRequest: { limit: 3, windowMs: 15 * 60_000 },
  verificationResend: { limit: 3, windowMs: 15 * 60_000 },
  security: { limit: 5, windowMs: 10 * 60_000 },
  quote: { limit: 30, windowMs: 60_000 },
  orderCreate: { limit: 10, windowMs: 60_000 },
  orderCancel: { limit: 20, windowMs: 60_000 },
  paymentInitiate: { limit: 5, windowMs: 60_000 },
  paymentRefresh: { limit: 6, windowMs: 60_000 },
  sellerMutation: { limit: 20, windowMs: 60_000 },
  staffMutation: { limit: 30, windowMs: 60_000 },
} as const;
