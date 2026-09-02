import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SellerProductCategory, SellerProductStatus } from "../../seller-products/model.js";
import { sellerApplications } from "./sellers.js";

export const sellerProductSubmissions = pgTable(
  "seller_product_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerApplicationId: uuid("seller_application_id")
      .notNull()
      .references(() => sellerApplications.id, { onDelete: "restrict" }),
    status: text("status").$type<SellerProductStatus>().notNull().default("DRAFT"),
    name: text("name").notNull(),
    category: text("category").$type<SellerProductCategory>().notNull(),
    description: text("description").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("KES"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Applicant-facing rejection message only. Internal notes require separate storage.
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("seller_product_submissions_seller_created_idx").on(
      table.sellerApplicationId,
      table.createdAt,
    ),
    index("seller_product_submissions_status_submitted_idx").on(table.status, table.submittedAt),
    check(
      "seller_product_submissions_status_check",
      sql`${table.status} in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')`,
    ),
    check(
      "seller_product_submissions_category_check",
      sql`${table.category} in ('Laptops', 'Screens', 'Woofers', 'Accessories', 'Phones & Tablets', 'Home & Kitchen', 'Fashion', 'Beauty & Health', 'School & Office', 'Groceries', 'Sports & Outdoors')`,
    ),
    check(
      "seller_product_submissions_name_check",
      sql`char_length(${table.name}) between 3 and 160`,
    ),
    check(
      "seller_product_submissions_description_check",
      sql`char_length(${table.description}) between 20 and 5000`,
    ),
    check(
      "seller_product_submissions_price_minor_check",
      sql`${table.priceMinor} > 0 and ${table.priceMinor} <= 1000000000`,
    ),
    check("seller_product_submissions_currency_check", sql`${table.currency} = 'KES'`),
    check(
      "seller_product_submissions_terms_pair_check",
      sql`(${table.termsVersion} is null) = (${table.termsAcceptedAt} is null)`,
    ),
    check(
      "seller_product_submissions_submission_metadata_check",
      sql`(${table.submittedAt} is null) = (${table.termsVersion} is null)`,
    ),
    check(
      "seller_product_submissions_submitted_status_check",
      sql`${table.status} not in ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED') or ${table.submittedAt} is not null`,
    ),
    check(
      "seller_product_submissions_review_check",
      sql`(
        ${table.status} = 'UNDER_REVIEW' and
        ${table.reviewStartedAt} is not null and
        ${table.reviewedAt} is null and
        ${table.reviewReason} is null
      ) or (
        ${table.status} = 'APPROVED' and
        ${table.reviewStartedAt} is not null and
        ${table.reviewedAt} is not null and
        ${table.reviewReason} is null
      ) or (
        ${table.status} = 'REJECTED' and
        ${table.reviewStartedAt} is not null and
        ${table.reviewedAt} is not null and
        ${table.reviewReason} is not null
      ) or (
        ${table.status} in ('DRAFT', 'SUBMITTED', 'WITHDRAWN') and
        ${table.reviewStartedAt} is null and
        ${table.reviewedAt} is null and
        ${table.reviewReason} is null
      )`,
    ),
  ],
);
