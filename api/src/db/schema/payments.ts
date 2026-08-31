import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { orders } from "./commerce.js";
import type { PaymentAttemptStatus } from "../../payments/state.js";

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    status: text("status").$type<PaymentAttemptStatus>().notNull(),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    phoneE164: text("phone_e164").notNull(),
    initiationIdempotencyKey: text("initiation_idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    callbackTokenHash: text("callback_token_hash").notNull(),
    providerMerchantRequestId: text("provider_merchant_request_id"),
    providerCheckoutRequestId: text("provider_checkout_request_id"),
    providerResponseCode: text("provider_response_code"),
    providerResponseDescription: text("provider_response_description"),
    providerResultCode: text("provider_result_code"),
    providerResultDescription: text("provider_result_description"),
    mpesaReceiptNumber: text("mpesa_receipt_number"),
    providerTransactionDate: timestamp("provider_transaction_date", { withTimezone: true }),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }),
    callbackReceivedAt: timestamp("callback_received_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastQueryAt: timestamp("last_query_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_attempts_order_id_idempotency_uidx").on(
      table.orderId,
      table.initiationIdempotencyKey,
    ),
    uniqueIndex("payment_attempts_callback_token_hash_uidx").on(table.callbackTokenHash),
    uniqueIndex("payment_attempts_checkout_request_id_uidx")
      .on(table.providerCheckoutRequestId)
      .where(sql`${table.providerCheckoutRequestId} is not null`),
    uniqueIndex("payment_attempts_receipt_number_uidx")
      .on(table.mpesaReceiptNumber)
      .where(sql`${table.mpesaReceiptNumber} is not null`),
    uniqueIndex("payment_attempts_one_active_per_order_uidx")
      .on(table.orderId)
      .where(
        sql`${table.status} in ('INITIATING', 'PENDING', 'CONFIRMING', 'UNKNOWN', 'REVIEW_REQUIRED')`,
      ),
    index("payment_attempts_order_created_idx").on(table.orderId, table.createdAt),
    check("payment_attempts_provider_check", sql`${table.provider} = 'MPESA'`),
    check("payment_attempts_currency_check", sql`${table.currency} = 'KES'`),
    check("payment_attempts_amount_minor_check", sql`${table.amountMinor} > 0`),
    check(
      "payment_attempts_status_check",
      sql`${table.status} in ('INITIATING', 'PENDING', 'CONFIRMING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'REVIEW_REQUIRED')`,
    ),
    check(
      "payment_attempts_request_fingerprint_check",
      sql`char_length(${table.requestFingerprint}) = 64`,
    ),
    check(
      "payment_attempts_callback_token_hash_check",
      sql`char_length(${table.callbackTokenHash}) = 64`,
    ),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentAttemptId: uuid("payment_attempt_id")
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    providerResultCode: text("provider_result_code"),
    providerResultDescription: text("provider_result_description"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_events_attempt_type_payload_uidx").on(
      table.paymentAttemptId,
      table.eventType,
      table.payloadHash,
    ),
    index("payment_events_attempt_received_idx").on(table.paymentAttemptId, table.receivedAt),
    check("payment_events_payload_hash_check", sql`char_length(${table.payloadHash}) = 64`),
  ],
);
