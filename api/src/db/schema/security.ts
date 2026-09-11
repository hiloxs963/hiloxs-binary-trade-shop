import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const securityRateLimitWindows = pgTable(
  "security_rate_limit_windows",
  {
    scope: text("scope").notNull(),
    keyDigest: text("key_digest").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyDigest, table.windowStart] }),
    index("security_rate_limit_windows_expires_idx").on(table.expiresAt),
    check(
      "security_rate_limit_windows_scope_check",
      sql`char_length(${table.scope}) between 1 and 80`,
    ),
    check("security_rate_limit_windows_digest_check", sql`char_length(${table.keyDigest}) = 64`),
    check("security_rate_limit_windows_count_check", sql`${table.count} > 0`),
    check(
      "security_rate_limit_windows_expiry_check",
      sql`${table.expiresAt} > ${table.windowStart}`,
    ),
  ],
);
