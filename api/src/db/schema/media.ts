import { sql } from "drizzle-orm";
import {
  bigint,
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
import type { MediaStatus, MediaVariant } from "../../media/model.js";
import { user } from "./auth.js";
import { products } from "./commerce.js";
import { sellerProductSubmissions } from "./seller-products.js";

export const sellerProductMedia = pgTable(
  "seller_product_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerProductSubmissionId: uuid("seller_product_submission_id")
      .notNull()
      .references(() => sellerProductSubmissions.id, { onDelete: "restrict" }),
    status: text("status").$type<MediaStatus>().notNull().default("PENDING_UPLOAD"),
    quarantineObjectKey: text("quarantine_object_key").notNull(),
    quarantineEtag: text("quarantine_etag"),
    canonicalObjectKey: text("canonical_object_key"),
    declaredMime: text("declared_mime").notNull(),
    detectedMime: text("detected_mime"),
    canonicalMime: text("canonical_mime"),
    declaredByteSize: bigint("declared_byte_size", { mode: "number" }).notNull(),
    inputByteSize: bigint("input_byte_size", { mode: "number" }),
    canonicalByteSize: bigint("canonical_byte_size", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256"),
    sortOrder: integer("sort_order").notNull(),
    selectedForActivation: boolean("selected_for_activation").notNull().default(false),
    rightsTermsVersion: text("rights_terms_version").notNull(),
    rightsAcceptedAt: timestamp("rights_accepted_at", { withTimezone: true }).notNull(),
    uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    processingLeaseUntil: timestamp("processing_lease_until", { withTimezone: true }),
    lastProcessingErrorCode: text("last_processing_error_code"),
    quarantineDeletePending: boolean("quarantine_delete_pending").notNull().default(false),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_product_media_quarantine_key_uidx").on(table.quarantineObjectKey),
    uniqueIndex("seller_product_media_canonical_key_uidx")
      .on(table.canonicalObjectKey)
      .where(sql`${table.canonicalObjectKey} is not null`),
    index("seller_product_media_submission_sort_idx").on(
      table.sellerProductSubmissionId,
      table.sortOrder,
    ),
    index("seller_product_media_processing_idx").on(
      table.status,
      table.processingLeaseUntil,
      table.processingAttempts,
    ),
    check(
      "seller_product_media_status_check",
      sql`${table.status} in ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSING_FAILED', 'ABANDONED')`,
    ),
    check(
      "seller_product_media_declared_mime_check",
      sql`${table.declaredMime} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      "seller_product_media_declared_size_check",
      sql`${table.declaredByteSize} > 0 and ${table.declaredByteSize} <= 8388608`,
    ),
    check("seller_product_media_sort_order_check", sql`${table.sortOrder} >= 0`),
    check(
      "seller_product_media_processing_attempts_check",
      sql`${table.processingAttempts} >= 0 and ${table.processingAttempts} <= 3`,
    ),
    check(
      "seller_product_media_sha256_check",
      sql`${table.sha256} is null or char_length(${table.sha256}) = 64`,
    ),
    check(
      "seller_product_media_selection_check",
      sql`${table.selectedForActivation} = false or ${table.status} = 'APPROVED'`,
    ),
    check(
      "seller_product_media_review_check",
      sql`(${table.status} = 'REJECTED' and ${table.reviewedAt} is not null and ${table.reviewReason} is not null) or
        (${table.status} = 'APPROVED' and ${table.reviewedAt} is not null and ${table.reviewReason} is null) or
        (${table.status} not in ('APPROVED', 'REJECTED') and ${table.reviewedAt} is null and ${table.reviewReason} is null)`,
    ),
  ],
);

export const sellerProductMediaVariants = pgTable(
  "seller_product_media_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerMediaId: uuid("seller_media_id")
      .notNull()
      .references(() => sellerProductMedia.id, { onDelete: "restrict" }),
    variant: text("variant").$type<MediaVariant>().notNull(),
    objectKey: text("object_key").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_product_media_variants_media_variant_uidx").on(
      table.sellerMediaId,
      table.variant,
    ),
    uniqueIndex("seller_product_media_variants_object_key_uidx").on(table.objectKey),
    check(
      "seller_product_media_variants_variant_check",
      sql`${table.variant} in ('MASTER', 'THUMBNAIL', 'MEDIUM', 'LARGE')`,
    ),
    check("seller_product_media_variants_mime_check", sql`${table.mime} = 'image/webp'`),
    check(
      "seller_product_media_variants_dimensions_check",
      sql`${table.width} > 0 and ${table.height} > 0`,
    ),
    check("seller_product_media_variants_size_check", sql`${table.byteSize} > 0`),
    check("seller_product_media_variants_sha256_check", sql`char_length(${table.sha256}) = 64`),
  ],
);

export const sellerProductInventory = pgTable(
  "seller_product_inventory",
  {
    sellerProductSubmissionId: uuid("seller_product_submission_id")
      .primaryKey()
      .references(() => sellerProductSubmissions.id, { onDelete: "restrict" }),
    quantityAvailable: integer("quantity_available").notNull(),
    version: integer("version").notNull().default(1),
    configuredAt: timestamp("configured_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "seller_product_inventory_quantity_check",
      sql`${table.quantityAvailable} >= 0 and ${table.quantityAvailable} <= 1000000`,
    ),
    check("seller_product_inventory_version_check", sql`${table.version} > 0`),
  ],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    sourceSellerMediaId: uuid("source_seller_media_id")
      .notNull()
      .references(() => sellerProductMedia.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_media_product_sort_uidx").on(table.productId, table.sortOrder),
    uniqueIndex("product_media_source_seller_media_uidx").on(table.sourceSellerMediaId),
    index("product_media_product_idx").on(table.productId),
    check("product_media_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const productMediaVariants = pgTable(
  "product_media_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productMediaId: uuid("product_media_id")
      .notNull()
      .references(() => productMedia.id, { onDelete: "restrict" }),
    variant: text("variant").$type<MediaVariant>().notNull(),
    objectKey: text("object_key").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_media_variants_media_variant_uidx").on(
      table.productMediaId,
      table.variant,
    ),
    index("product_media_variants_object_key_idx").on(table.objectKey),
    check(
      "product_media_variants_variant_check",
      sql`${table.variant} in ('THUMBNAIL', 'MEDIUM', 'LARGE')`,
    ),
    check("product_media_variants_mime_check", sql`${table.mime} = 'image/webp'`),
    check(
      "product_media_variants_dimensions_check",
      sql`${table.width} > 0 and ${table.height} > 0`,
    ),
    check("product_media_variants_size_check", sql`${table.byteSize} > 0`),
    check("product_media_variants_sha256_check", sql`char_length(${table.sha256}) = 64`),
  ],
);

export const productInventory = pgTable(
  "product_inventory",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "restrict" }),
    quantityAvailable: integer("quantity_available").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "product_inventory_quantity_check",
      sql`${table.quantityAvailable} >= 0 and ${table.quantityAvailable} <= 1000000`,
    ),
  ],
);

export const sellerProductActivations = pgTable(
  "seller_product_activations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerProductSubmissionId: uuid("seller_product_submission_id")
      .notNull()
      .references(() => sellerProductSubmissions.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    activatedByStaffUserId: text("activated_by_staff_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    requestId: text("request_id").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_product_activations_submission_uidx").on(table.sellerProductSubmissionId),
    uniqueIndex("seller_product_activations_product_uidx").on(table.productId),
    uniqueIndex("seller_product_activations_request_uidx").on(table.requestId),
  ],
);
