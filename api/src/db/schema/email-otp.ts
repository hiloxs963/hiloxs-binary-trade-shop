import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const EMAIL_OTP_MAX_ATTEMPTS = 5;

/** A row exists only while the user has email OTP enabled; disabling deletes it. */
export const emailOtpEnrollments = pgTable("email_otp_enrollments", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
  // Set by a password reset; cleared by the next successful TOTP or backup-code login.
  requireTotpNextLogin: boolean("require_totp_next_login").notNull().default(false),
});

export const emailOtpChallenges = pgTable(
  "email_otp_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // HMAC of the pending-login identifier; the raw cookie value is never stored.
    pendingDigest: text("pending_digest").notNull(),
    // HMAC-SHA256(key, challengeId | userId | code); the code itself is never stored.
    codeHash: text("code_hash").notNull(),
    ipDigest: text("ip_digest"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Null until the provider accepted the message; a failed send leaves it null.
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  },
  (table) => [
    // At most one live challenge per pending login.
    uniqueIndex("email_otp_challenges_live_pending_uidx")
      .on(table.pendingDigest)
      .where(sql`${table.consumedAt} is null and ${table.invalidatedAt} is null`),
    index("email_otp_challenges_user_created_idx").on(table.userId, table.createdAt),
    index("email_otp_challenges_ip_created_idx").on(table.ipDigest, table.createdAt),
    check(
      "email_otp_challenges_attempts_check",
      sql`${table.attempts} between 0 and ${sql.raw(String(EMAIL_OTP_MAX_ATTEMPTS))}`,
    ),
    check(
      "email_otp_challenges_pending_digest_check",
      sql`char_length(${table.pendingDigest}) = 64`,
    ),
    check("email_otp_challenges_code_hash_check", sql`char_length(${table.codeHash}) = 64`),
    check("email_otp_challenges_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const AUTH_SECURITY_EVENT_TYPES = [
  "EMAIL_OTP_SENT",
  "EMAIL_OTP_SEND_FAILED",
  "EMAIL_OTP_VERIFIED",
  "EMAIL_OTP_FAILED",
  "EMAIL_OTP_LOCKED",
  "EMAIL_OTP_ENROLLED",
  "EMAIL_OTP_ENROLL_REFUSED",
  "EMAIL_OTP_DISABLED",
  "EMAIL_OTP_DISABLED_BY_STAFF_MEMBERSHIP",
  "EMAIL_OTP_BLOCKED_STAFF",
  "EMAIL_OTP_BLOCKED_AFTER_RESET",
  "EMAIL_OTP_RATE_LIMITED",
  "BACKUP_CODE_LOGIN_SUCCEEDED",
  "BACKUP_CODE_LOGIN_FAILED",
  "STAFF_STEP_UP_SUCCEEDED",
  "STAFF_STEP_UP_FAILED",
  "STAFF_STEP_UP_SESSION_REVOKED",
  "STAFF_STEP_UP_REFUSED",
] as const;
export type AuthSecurityEventType = (typeof AUTH_SECURITY_EVENT_TYPES)[number];

/** Append-only. Never stores codes; IP addresses are keyed digests. */
export const authSecurityEvents = pgTable(
  "auth_security_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    eventType: text("event_type").$type<AuthSecurityEventType>().notNull(),
    challengeId: uuid("challenge_id"),
    ipDigest: text("ip_digest"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_security_events_user_created_idx").on(table.userId, table.createdAt),
    index("auth_security_events_type_created_idx").on(table.eventType, table.createdAt),
    check(
      "auth_security_events_type_check",
      sql`${table.eventType} in (${sql.raw(AUTH_SECURITY_EVENT_TYPES.map((type) => `'${type}'`).join(", "))})`,
    ),
    check(
      "auth_security_events_user_agent_check",
      sql`${table.userAgent} is null or char_length(${table.userAgent}) <= 200`,
    ),
  ],
);
