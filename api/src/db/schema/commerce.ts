import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { sellerProductSubmissions } from "./seller-products.js";
import { sellerApplications } from "./sellers.js";

export const PRODUCT_SOURCES = ["PLATFORM", "SELLER"] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

export const productsSortOrderSequence = pgSequence("products_sort_order_seq", {
  startWith: 44,
});

export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAYMENT_REVIEW_REQUIRED",
  "PAID",
  "PROCESSING",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CANCELLATION_REASONS = ["CUSTOMER_CANCELLED", "RESERVATION_EXPIRED"] as const;
export type OrderCancellationReason = (typeof ORDER_CANCELLATION_REASONS)[number];

export const SELLER_FULFILLMENT_TERMS_VERSION = "seller-fulfillment-terms-v1";
export const SELLER_FULFILLMENT_STATUSES = [
  "AWAITING_PAYMENT",
  "READY_FOR_SELLER",
  "ACCEPTED",
  "PREPARING",
  "DISPATCHED",
  "DELIVERED",
  "FULFILLMENT_ISSUE",
  "CANCELLED",
] as const;
export type SellerFulfillmentStatus = (typeof SELLER_FULFILLMENT_STATUSES)[number];
export const FULFILLMENT_ACTOR_TYPES = ["SELLER", "CUSTOMER", "SYSTEM"] as const;
export type FulfillmentActorType = (typeof FULFILLMENT_ACTOR_TYPES)[number];
export const FULFILLMENT_EVENT_ACTIONS = [
  "PAYMENT_CONFIRMED",
  "ORDER_CANCELLED",
  "RESERVATION_EXPIRED",
  "ACCEPTED",
  "PREPARING",
  "DISPATCHED",
  "DELIVERED",
  "FULFILLMENT_ISSUE_REPORTED",
] as const;
export type FulfillmentEventAction = (typeof FULFILLMENT_EVENT_ACTIONS)[number];

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    catalogKey: text("catalog_key").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    source: text("source").$type<ProductSource>().notNull().default("PLATFORM"),
    isActive: boolean("is_active").notNull().default(false),
    isPurchasable: boolean("is_purchasable").notNull().default(false),
    sellerApplicationId: uuid("seller_application_id").references(() => sellerApplications.id, {
      onDelete: "restrict",
    }),
    sellerProductSubmissionId: uuid("seller_product_submission_id"),
    sortOrder: integer("sort_order")
      .notNull()
      .default(sql`nextval('products_sort_order_seq')`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_catalog_key_uidx").on(table.catalogKey),
    uniqueIndex("products_slug_uidx").on(table.slug),
    uniqueIndex("products_sort_order_uidx").on(table.sortOrder),
    uniqueIndex("products_seller_submission_uidx")
      .on(table.sellerProductSubmissionId)
      .where(sql`${table.sellerProductSubmissionId} is not null`),
    index("products_active_category_sort_idx").on(table.isActive, table.category, table.sortOrder),
    index("products_active_purchasable_idx").on(table.isActive, table.isPurchasable),
    check("products_price_minor_check", sql`${table.priceMinor} >= 0`),
    check("products_currency_check", sql`${table.currency} = 'KES'`),
    check("products_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("products_source_check", sql`${table.source} in ('PLATFORM', 'SELLER')`),
    check(
      "products_source_linkage_check",
      sql`(${table.source} = 'PLATFORM' and ${table.sellerApplicationId} is null and ${table.sellerProductSubmissionId} is null) or
        (${table.source} = 'SELLER' and ${table.sellerApplicationId} is not null and ${table.sellerProductSubmissionId} is not null)`,
    ),
    foreignKey({
      name: "products_seller_submission_owner_fk",
      columns: [table.sellerApplicationId, table.sellerProductSubmissionId],
      foreignColumns: [sellerProductSubmissions.sellerApplicationId, sellerProductSubmissions.id],
    }).onDelete("restrict"),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: text("order_number").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: text("status").$type<OrderStatus>().notNull().default("PENDING_PAYMENT"),
    currency: text("currency").notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
    shippingMinor: bigint("shipping_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason").$type<OrderCancellationReason>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_order_number_uidx").on(table.orderNumber),
    uniqueIndex("orders_user_id_idempotency_key_uidx").on(table.userId, table.idempotencyKey),
    index("orders_user_id_created_at_idx").on(table.userId, table.createdAt),
    check(
      "orders_status_check",
      sql`${table.status} in ('PENDING_PAYMENT', 'PAYMENT_REVIEW_REQUIRED', 'PAID', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'REFUNDED')`,
    ),
    check("orders_currency_check", sql`${table.currency} = 'KES'`),
    check("orders_subtotal_minor_check", sql`${table.subtotalMinor} >= 0`),
    check("orders_shipping_minor_check", sql`${table.shippingMinor} = 0`),
    check("orders_total_minor_check", sql`${table.totalMinor} >= 0`),
    check(
      "orders_total_components_check",
      sql`${table.totalMinor} = ${table.subtotalMinor} + ${table.shippingMinor}`,
    ),
    check(
      "orders_cancellation_pair_check",
      sql`(${table.cancelledAt} is null) = (${table.cancellationReason} is null)`,
    ),
    check(
      "orders_cancellation_reason_check",
      sql`${table.cancellationReason} is null or ${table.cancellationReason} in ('CUSTOMER_CANCELLED', 'RESERVATION_EXPIRED')`,
    ),
    check("orders_request_fingerprint_check", sql`char_length(${table.requestFingerprint}) = 64`),
  ],
);

export const sellerFulfillmentConfigs = pgTable(
  "seller_fulfillment_configs",
  {
    sellerApplicationId: uuid("seller_application_id")
      .primaryKey()
      .references(() => sellerApplications.id, { onDelete: "restrict" }),
    termsVersion: text("terms_version").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    configuredAt: timestamp("configured_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "seller_fulfillment_configs_terms_check",
      sql`${table.termsVersion} = 'seller-fulfillment-terms-v1'`,
    ),
  ],
);

export const orderDeliveryAddresses = pgTable(
  "order_delivery_addresses",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id, { onDelete: "restrict" }),
    recipientName: text("recipient_name").notNull(),
    phone: text("phone").notNull(),
    county: text("county").notNull(),
    town: text("town").notNull(),
    addressLine: text("address_line").notNull(),
    landmark: text("landmark"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "order_delivery_addresses_recipient_check",
      sql`char_length(${table.recipientName}) between 2 and 120`,
    ),
    check("order_delivery_addresses_phone_check", sql`${table.phone} ~ '^\\+254[17][0-9]{8}$'`),
    check(
      "order_delivery_addresses_county_check",
      sql`char_length(${table.county}) between 3 and 40`,
    ),
    check("order_delivery_addresses_town_check", sql`char_length(${table.town}) between 2 and 100`),
    check(
      "order_delivery_addresses_line_check",
      sql`char_length(${table.addressLine}) between 4 and 240`,
    ),
    check(
      "order_delivery_addresses_landmark_check",
      sql`${table.landmark} is null or char_length(${table.landmark}) between 2 and 160`,
    ),
  ],
);

export const sellerOrderFulfillments = pgTable(
  "seller_order_fulfillments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    sellerApplicationId: uuid("seller_application_id")
      .notNull()
      .references(() => sellerApplications.id, { onDelete: "restrict" }),
    status: text("status").$type<SellerFulfillmentStatus>().notNull().default("AWAITING_PAYMENT"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    preparingAt: timestamp("preparing_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    issueAt: timestamp("issue_at", { withTimezone: true }),
    issueReason: text("issue_reason"),
    issueMessage: text("issue_message"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    carrier: text("carrier"),
    trackingReference: text("tracking_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_order_fulfillments_order_seller_uidx").on(
      table.orderId,
      table.sellerApplicationId,
    ),
    uniqueIndex("seller_order_fulfillments_identity_uidx").on(
      table.id,
      table.orderId,
      table.sellerApplicationId,
    ),
    index("seller_order_fulfillments_seller_status_created_idx").on(
      table.sellerApplicationId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("seller_order_fulfillments_order_idx").on(table.orderId),
    check(
      "seller_order_fulfillments_status_check",
      sql`${table.status} in ('AWAITING_PAYMENT', 'READY_FOR_SELLER', 'ACCEPTED', 'PREPARING', 'DISPATCHED', 'DELIVERED', 'FULFILLMENT_ISSUE', 'CANCELLED')`,
    ),
    check(
      "seller_order_fulfillments_carrier_check",
      sql`${table.carrier} is null or char_length(${table.carrier}) between 2 and 80`,
    ),
    check(
      "seller_order_fulfillments_tracking_check",
      sql`${table.trackingReference} is null or char_length(${table.trackingReference}) between 2 and 120`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productName: text("product_name").notNull(),
    productSlug: text("product_slug").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalMinor: bigint("line_total_minor", { mode: "bigint" }).notNull(),
    productSource: text("product_source").$type<ProductSource>().notNull().default("PLATFORM"),
    sellerApplicationId: uuid("seller_application_id").references(() => sellerApplications.id, {
      onDelete: "restrict",
    }),
    sellerFulfillmentId: uuid("seller_fulfillment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("order_items_order_id_product_id_uidx").on(table.orderId, table.productId),
    index("order_items_order_id_idx").on(table.orderId),
    uniqueIndex("order_items_reservation_identity_uidx").on(
      table.id,
      table.orderId,
      table.productId,
    ),
    check("order_items_quantity_check", sql`${table.quantity} > 0 and ${table.quantity} <= 20`),
    check("order_items_unit_price_minor_check", sql`${table.unitPriceMinor} >= 0`),
    check("order_items_line_total_minor_check", sql`${table.lineTotalMinor} >= 0`),
    check("order_items_source_check", sql`${table.productSource} in ('PLATFORM', 'SELLER')`),
    check(
      "order_items_seller_linkage_check",
      sql`(${table.productSource} = 'PLATFORM' and ${table.sellerApplicationId} is null and ${table.sellerFulfillmentId} is null) or
        (${table.productSource} = 'SELLER' and ${table.sellerApplicationId} is not null and ${table.sellerFulfillmentId} is not null)`,
    ),
    foreignKey({
      name: "order_items_seller_fulfillment_owner_fk",
      columns: [table.sellerFulfillmentId, table.orderId, table.sellerApplicationId],
      foreignColumns: [
        sellerOrderFulfillments.id,
        sellerOrderFulfillments.orderId,
        sellerOrderFulfillments.sellerApplicationId,
      ],
    }).onDelete("restrict"),
  ],
);

export const orderFulfillmentEvents = pgTable(
  "order_fulfillment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fulfillmentId: uuid("fulfillment_id")
      .notNull()
      .references(() => sellerOrderFulfillments.id, { onDelete: "restrict" }),
    actorType: text("actor_type").$type<FulfillmentActorType>().notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "restrict" }),
    action: text("action").$type<FulfillmentEventAction>().notNull(),
    previousStatus: text("previous_status").$type<SellerFulfillmentStatus>().notNull(),
    resultingStatus: text("resulting_status").$type<SellerFulfillmentStatus>().notNull(),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_fulfillment_events_fulfillment_created_idx").on(
      table.fulfillmentId,
      table.createdAt,
    ),
    uniqueIndex("order_fulfillment_events_request_uidx").on(
      table.fulfillmentId,
      table.action,
      table.requestId,
    ),
    check(
      "order_fulfillment_events_actor_check",
      sql`(${table.actorType} = 'SYSTEM' and ${table.actorUserId} is null) or
        (${table.actorType} in ('SELLER', 'CUSTOMER') and ${table.actorUserId} is not null)`,
    ),
  ],
);
