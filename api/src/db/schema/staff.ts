import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { products } from "./commerce.js";
import { sellerProductMedia } from "./media.js";
import { sellerProductSubmissions } from "./seller-products.js";
import { sellerApplications } from "./sellers.js";

export const STAFF_ROLES = ["STAFF", "ADMIN"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_MEMBERSHIP_STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type StaffMembershipStatus = (typeof STAFF_MEMBERSHIP_STATUSES)[number];
export const STAFF_PERMISSIONS = [
  "SELLER_REVIEW",
  "PRODUCT_REVIEW",
  "CATALOG_ACTIVATE",
  "SELLER_COMMERCE_ACTIVATE",
  "ORDER_SUPPORT",
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export const STAFF_GRANT_SOURCES = ["BOOTSTRAP", "STAFF"] as const;
export type StaffGrantSource = (typeof STAFF_GRANT_SOURCES)[number];
export const STAFF_AUDIT_ACTOR_TYPES = ["STAFF", "SYSTEM_BOOTSTRAP"] as const;
export type StaffAuditActorType = (typeof STAFF_AUDIT_ACTOR_TYPES)[number];
export const STAFF_AUDIT_ACTIONS = [
  "STAFF_BOOTSTRAPPED",
  "STAFF_PERMISSION_GRANTED",
  "SELLER_APPLICATION_REVIEW_STARTED",
  "SELLER_APPLICATION_APPROVED",
  "SELLER_APPLICATION_REJECTED",
  "SELLER_PRODUCT_REVIEW_STARTED",
  "SELLER_PRODUCT_APPROVED",
  "SELLER_PRODUCT_REJECTED",
  "SELLER_PRODUCT_MEDIA_APPROVED",
  "SELLER_PRODUCT_MEDIA_REJECTED",
  "CATALOG_ACTIVATED",
  "CATALOG_DEACTIVATED",
  "SELLER_COMMERCE_ENABLED",
  "SELLER_COMMERCE_DISABLED",
] as const;
export type StaffAuditAction = (typeof STAFF_AUDIT_ACTIONS)[number];

export const staffMemberships = pgTable(
  "staff_memberships",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "restrict" }),
    role: text("role").$type<StaffRole>().notNull(),
    status: text("status").$type<StaffMembershipStatus>().notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check("staff_memberships_role_check", sql`${table.role} in ('STAFF', 'ADMIN')`),
    check(
      "staff_memberships_status_check",
      sql`${table.status} in ('ACTIVE', 'SUSPENDED', 'REVOKED')`,
    ),
    check(
      "staff_memberships_revoked_check",
      sql`(${table.status} = 'REVOKED') = (${table.revokedAt} is not null)`,
    ),
  ],
);

export const staffPermissionGrants = pgTable(
  "staff_permission_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    staffUserId: text("staff_user_id")
      .notNull()
      .references(() => staffMemberships.userId, { onDelete: "restrict" }),
    permission: text("permission").$type<StaffPermission>().notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantSource: text("grant_source").$type<StaffGrantSource>().notNull(),
    grantedByUserId: text("granted_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("staff_permission_grants_staff_user_idx").on(table.staffUserId),
    uniqueIndex("staff_permission_grants_active_uidx")
      .on(table.staffUserId, table.permission)
      .where(sql`${table.revokedAt} is null`),
    check(
      "staff_permission_grants_permission_check",
      sql`${table.permission} in ('SELLER_REVIEW', 'PRODUCT_REVIEW', 'CATALOG_ACTIVATE', 'SELLER_COMMERCE_ACTIVATE', 'ORDER_SUPPORT')`,
    ),
    check(
      "staff_permission_grants_source_check",
      sql`${table.grantSource} in ('BOOTSTRAP', 'STAFF')`,
    ),
    check(
      "staff_permission_grants_actor_check",
      sql`(${table.grantSource} = 'BOOTSTRAP' and ${table.grantedByUserId} is null) or
        (${table.grantSource} = 'STAFF' and ${table.grantedByUserId} is not null)`,
    ),
    check(
      "staff_permission_grants_revocation_check",
      sql`(${table.revokedAt} is null) = (${table.revokedByUserId} is null)`,
    ),
  ],
);

export const staffAuditEvents = pgTable(
  "staff_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorType: text("actor_type").$type<StaffAuditActorType>().notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "restrict" }),
    actorRole: text("actor_role").$type<StaffRole>(),
    permission: text("permission").$type<StaffPermission>(),
    action: text("action").$type<StaffAuditAction>().notNull(),
    sellerApplicationId: uuid("seller_application_id").references(() => sellerApplications.id, {
      onDelete: "restrict",
    }),
    sellerProductSubmissionId: uuid("seller_product_submission_id").references(
      () => sellerProductSubmissions.id,
      { onDelete: "restrict" },
    ),
    sellerProductMediaId: uuid("seller_product_media_id").references(() => sellerProductMedia.id, {
      onDelete: "restrict",
    }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "restrict" }),
    previousStatus: text("previous_status"),
    resultingStatus: text("resulting_status"),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("staff_audit_events_application_created_idx").on(
      table.sellerApplicationId,
      table.createdAt,
    ),
    index("staff_audit_events_product_created_idx").on(
      table.sellerProductSubmissionId,
      table.createdAt,
    ),
    index("staff_audit_events_media_created_idx").on(table.sellerProductMediaId, table.createdAt),
    index("staff_audit_events_public_product_created_idx").on(table.productId, table.createdAt),
    check(
      "staff_audit_events_actor_type_check",
      sql`${table.actorType} in ('STAFF', 'SYSTEM_BOOTSTRAP')`,
    ),
    check(
      "staff_audit_events_role_check",
      sql`${table.actorRole} is null or ${table.actorRole} in ('STAFF', 'ADMIN')`,
    ),
    check(
      "staff_audit_events_permission_check",
      sql`${table.permission} is null or ${table.permission} in ('SELLER_REVIEW', 'PRODUCT_REVIEW', 'CATALOG_ACTIVATE', 'SELLER_COMMERCE_ACTIVATE', 'ORDER_SUPPORT')`,
    ),
    check(
      "staff_audit_events_actor_check",
      sql`(${table.actorType} = 'STAFF' and ${table.actorUserId} is not null and ${table.actorRole} is not null and ${table.permission} is not null) or
        (${table.actorType} = 'SYSTEM_BOOTSTRAP' and ${table.actorUserId} is null)`,
    ),
    check(
      "staff_audit_events_review_target_check",
      sql`(${table.action} in (
        'SELLER_APPLICATION_REVIEW_STARTED', 'SELLER_APPLICATION_APPROVED', 'SELLER_APPLICATION_REJECTED',
        'SELLER_PRODUCT_REVIEW_STARTED', 'SELLER_PRODUCT_APPROVED', 'SELLER_PRODUCT_REJECTED'
      ) and num_nonnulls(${table.sellerApplicationId}, ${table.sellerProductSubmissionId}) = 1 and
        ${table.sellerProductMediaId} is null and ${table.productId} is null and
        ${table.previousStatus} is not null and ${table.resultingStatus} is not null) or
        (${table.action} in ('SELLER_PRODUCT_MEDIA_APPROVED', 'SELLER_PRODUCT_MEDIA_REJECTED') and
        ${table.sellerProductMediaId} is not null and
        ${table.sellerApplicationId} is null and ${table.sellerProductSubmissionId} is null and ${table.productId} is null and
        ${table.previousStatus} is not null and ${table.resultingStatus} is not null) or
        (${table.action} in ('CATALOG_ACTIVATED', 'CATALOG_DEACTIVATED') and
        ${table.sellerProductSubmissionId} is not null and ${table.productId} is not null and
        ${table.sellerApplicationId} is null and ${table.sellerProductMediaId} is null and
        ${table.previousStatus} is not null and ${table.resultingStatus} is not null) or
        (${table.action} in ('SELLER_COMMERCE_ENABLED', 'SELLER_COMMERCE_DISABLED') and
        ${table.productId} is not null and
        ${table.sellerApplicationId} is null and ${table.sellerProductSubmissionId} is null and ${table.sellerProductMediaId} is null and
        ${table.previousStatus} is not null and ${table.resultingStatus} is not null) or
        (${table.action} in ('STAFF_BOOTSTRAPPED', 'STAFF_PERMISSION_GRANTED') and
        num_nonnulls(${table.sellerApplicationId}, ${table.sellerProductSubmissionId}, ${table.sellerProductMediaId}, ${table.productId}) = 0 and
        ${table.previousStatus} is null and ${table.resultingStatus} is null)`,
    ),
    check(
      "staff_audit_events_permission_action_check",
      sql`${table.actorType} = 'SYSTEM_BOOTSTRAP' or
        (${table.permission} = 'SELLER_REVIEW' and ${table.action} in ('SELLER_APPLICATION_REVIEW_STARTED', 'SELLER_APPLICATION_APPROVED', 'SELLER_APPLICATION_REJECTED')) or
        (${table.permission} = 'PRODUCT_REVIEW' and ${table.action} in ('SELLER_PRODUCT_REVIEW_STARTED', 'SELLER_PRODUCT_APPROVED', 'SELLER_PRODUCT_REJECTED', 'SELLER_PRODUCT_MEDIA_APPROVED', 'SELLER_PRODUCT_MEDIA_REJECTED')) or
        (${table.permission} = 'CATALOG_ACTIVATE' and ${table.action} in ('CATALOG_ACTIVATED', 'CATALOG_DEACTIVATED')) or
        (${table.permission} = 'SELLER_COMMERCE_ACTIVATE' and ${table.action} in ('SELLER_COMMERCE_ENABLED', 'SELLER_COMMERCE_DISABLED'))`,
    ),
  ],
);
