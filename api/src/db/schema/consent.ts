import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ConsentPolicy } from "../../consent/model.js";
import { user } from "./auth.js";

export const userConsents = pgTable(
  "user_consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    policy: text("policy").$type<ConsentPolicy>().notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    // One row per user, policy and version: duplicates are rejected, but a new
    // policy version is still recordable as a fresh acceptance.
    uniqueIndex("user_consents_user_policy_version_uidx").on(
      table.userId,
      table.policy,
      table.version,
    ),
    check("user_consents_policy_check", sql`${table.policy} in ('privacy-policy', 'terms-of-use')`),
    check("user_consents_version_check", sql`char_length(${table.version}) between 3 and 80`),
  ],
);
