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
import { user } from "./auth.js";

export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

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
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_catalog_key_uidx").on(table.catalogKey),
    uniqueIndex("products_slug_uidx").on(table.slug),
    uniqueIndex("products_sort_order_uidx").on(table.sortOrder),
    index("products_active_category_sort_idx").on(table.isActive, table.category, table.sortOrder),
    check("products_price_minor_check", sql`${table.priceMinor} >= 0`),
    check("products_currency_check", sql`${table.currency} = 'KES'`),
    check("products_sort_order_check", sql`${table.sortOrder} >= 0`),
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
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_order_number_uidx").on(table.orderNumber),
    uniqueIndex("orders_user_id_idempotency_key_uidx").on(table.userId, table.idempotencyKey),
    index("orders_user_id_created_at_idx").on(table.userId, table.createdAt),
    check(
      "orders_status_check",
      sql`${table.status} in ('PENDING_PAYMENT', 'PAID', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'REFUNDED')`,
    ),
    check("orders_currency_check", sql`${table.currency} = 'KES'`),
    check("orders_subtotal_minor_check", sql`${table.subtotalMinor} >= 0`),
    check("orders_total_minor_check", sql`${table.totalMinor} >= 0`),
    check("orders_request_fingerprint_check", sql`char_length(${table.requestFingerprint}) = 64`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("order_items_order_id_product_id_uidx").on(table.orderId, table.productId),
    index("order_items_order_id_idx").on(table.orderId),
    check("order_items_quantity_check", sql`${table.quantity} > 0 and ${table.quantity} <= 20`),
    check("order_items_unit_price_minor_check", sql`${table.unitPriceMinor} >= 0`),
    check("order_items_line_total_minor_check", sql`${table.lineTotalMinor} >= 0`),
  ],
);
