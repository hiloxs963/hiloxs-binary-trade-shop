import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { SellerApplicationStatus, SellerType } from "../../sellers/model.js";
import { user } from "./auth.js";

export const sellerApplications = pgTable(
  "seller_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    sellerType: text("seller_type").$type<SellerType>().notNull(),
    legalName: text("legal_name").notNull(),
    tradingName: text("trading_name"),
    registrationNumber: text("registration_number"),
    kraPin: text("kra_pin"),
    status: text("status").$type<SellerApplicationStatus>().notNull().default("DRAFT"),
    // Applicant-facing rejection message only. Internal review notes require separate storage.
    reviewReason: text("review_reason"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_applications_user_id_uidx").on(table.userId),
    index("seller_applications_status_submitted_idx").on(table.status, table.submittedAt),
    check(
      "seller_applications_type_check",
      sql`${table.sellerType} in ('COMPANY', 'REGISTERED_BUSINESS', 'SOLE_PROPRIETOR')`,
    ),
    check(
      "seller_applications_status_check",
      sql`${table.status} in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')`,
    ),
    check(
      "seller_applications_legal_name_check",
      sql`char_length(${table.legalName}) between 2 and 160`,
    ),
    check(
      "seller_applications_trading_name_check",
      sql`${table.tradingName} is null or char_length(${table.tradingName}) between 2 and 160`,
    ),
    check(
      "seller_applications_registration_number_check",
      sql`${table.registrationNumber} is null or char_length(${table.registrationNumber}) between 2 and 80`,
    ),
    check(
      "seller_applications_kra_pin_check",
      sql`${table.kraPin} is null or ${table.kraPin} ~ '^[AP][0-9]{9}[A-Z]$'`,
    ),
    check(
      "seller_applications_kra_pin_type_check",
      sql`${table.kraPin} is null or
        (${table.sellerType} = 'COMPANY' and ${table.kraPin} like 'P%') or
        (${table.sellerType} = 'SOLE_PROPRIETOR' and ${table.kraPin} like 'A%') or
        ${table.sellerType} = 'REGISTERED_BUSINESS'`,
    ),
    check(
      "seller_applications_sole_registration_check",
      sql`${table.sellerType} <> 'SOLE_PROPRIETOR' or ${table.registrationNumber} is null`,
    ),
    check(
      "seller_applications_terms_pair_check",
      sql`(${table.termsVersion} is null) = (${table.termsAcceptedAt} is null)`,
    ),
    check(
      "seller_applications_submission_check",
      sql`${table.status} not in ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED') or (
        ${table.submittedAt} is not null and
        ${table.termsVersion} is not null and
        ${table.termsAcceptedAt} is not null and
        ${table.kraPin} is not null and
        (
          (${table.sellerType} = 'SOLE_PROPRIETOR' and ${table.registrationNumber} is null) or
          (${table.sellerType} in ('COMPANY', 'REGISTERED_BUSINESS') and ${table.registrationNumber} is not null)
        )
      )`,
    ),
    check(
      "seller_applications_draft_check",
      sql`${table.status} <> 'DRAFT' or (
        ${table.termsVersion} is null and
        ${table.termsAcceptedAt} is null and
        ${table.submittedAt} is null
      )`,
    ),
    check(
      "seller_applications_review_check",
      sql`(
        ${table.status} = 'REJECTED' and ${table.reviewedAt} is not null and ${table.reviewReason} is not null
      ) or (
        ${table.status} = 'APPROVED' and ${table.reviewedAt} is not null and ${table.reviewReason} is null
      ) or (
        ${table.status} not in ('APPROVED', 'REJECTED') and ${table.reviewedAt} is null and ${table.reviewReason} is null
      )`,
    ),
  ],
);
