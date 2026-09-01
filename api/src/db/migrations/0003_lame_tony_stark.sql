CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"phone_e164" text NOT NULL,
	"initiation_idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"callback_token_hash" text NOT NULL,
	"provider_merchant_request_id" text,
	"provider_checkout_request_id" text,
	"provider_response_code" text,
	"provider_response_description" text,
	"provider_result_code" text,
	"provider_result_description" text,
	"mpesa_receipt_number" text,
	"provider_transaction_date" timestamp with time zone,
	"initiated_at" timestamp with time zone,
	"callback_received_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"last_query_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_provider_check" CHECK ("payment_attempts"."provider" = 'MPESA'),
	CONSTRAINT "payment_attempts_currency_check" CHECK ("payment_attempts"."currency" = 'KES'),
	CONSTRAINT "payment_attempts_amount_minor_check" CHECK ("payment_attempts"."amount_minor" > 0),
	CONSTRAINT "payment_attempts_status_check" CHECK ("payment_attempts"."status" in ('INITIATING', 'PENDING', 'CONFIRMING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'REVIEW_REQUIRED')),
	CONSTRAINT "payment_attempts_request_fingerprint_check" CHECK (char_length("payment_attempts"."request_fingerprint") = 64),
	CONSTRAINT "payment_attempts_callback_token_hash_check" CHECK (char_length("payment_attempts"."callback_token_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"provider_result_code" text,
	"provider_result_description" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_payload_hash_check" CHECK (char_length("payment_events"."payload_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_order_id_idempotency_uidx" ON "payment_attempts" USING btree ("order_id","initiation_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_callback_token_hash_uidx" ON "payment_attempts" USING btree ("callback_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_checkout_request_id_uidx" ON "payment_attempts" USING btree ("provider_checkout_request_id") WHERE "payment_attempts"."provider_checkout_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_receipt_number_uidx" ON "payment_attempts" USING btree ("mpesa_receipt_number") WHERE "payment_attempts"."mpesa_receipt_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_active_per_order_uidx" ON "payment_attempts" USING btree ("order_id") WHERE "payment_attempts"."status" in ('INITIATING', 'PENDING', 'CONFIRMING', 'UNKNOWN', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE INDEX "payment_attempts_order_created_idx" ON "payment_attempts" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_attempt_type_payload_uidx" ON "payment_events" USING btree ("payment_attempt_id","event_type","payload_hash");--> statement-breakpoint
CREATE INDEX "payment_events_attempt_received_idx" ON "payment_events" USING btree ("payment_attempt_id","received_at");