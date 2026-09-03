CREATE TABLE "order_delivery_addresses" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"county" text NOT NULL,
	"town" text NOT NULL,
	"address_line" text NOT NULL,
	"landmark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_delivery_addresses_recipient_check" CHECK (char_length("order_delivery_addresses"."recipient_name") between 2 and 120),
	CONSTRAINT "order_delivery_addresses_phone_check" CHECK ("order_delivery_addresses"."phone" ~ '^\+254[17][0-9]{8}$'),
	CONSTRAINT "order_delivery_addresses_county_check" CHECK (char_length("order_delivery_addresses"."county") between 3 and 40),
	CONSTRAINT "order_delivery_addresses_town_check" CHECK (char_length("order_delivery_addresses"."town") between 2 and 100),
	CONSTRAINT "order_delivery_addresses_line_check" CHECK (char_length("order_delivery_addresses"."address_line") between 4 and 240),
	CONSTRAINT "order_delivery_addresses_landmark_check" CHECK ("order_delivery_addresses"."landmark" is null or char_length("order_delivery_addresses"."landmark") between 2 and 160)
);
--> statement-breakpoint
CREATE TABLE "order_fulfillment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"previous_status" text NOT NULL,
	"resulting_status" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_fulfillment_events_actor_check" CHECK (("order_fulfillment_events"."actor_type" = 'SYSTEM' and "order_fulfillment_events"."actor_user_id" is null) or
        ("order_fulfillment_events"."actor_type" in ('SELLER', 'CUSTOMER') and "order_fulfillment_events"."actor_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "seller_fulfillment_configs" (
	"seller_application_id" uuid PRIMARY KEY NOT NULL,
	"terms_version" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"configured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_fulfillment_configs_terms_check" CHECK ("seller_fulfillment_configs"."terms_version" = 'seller-fulfillment-terms-v1')
);
--> statement-breakpoint
CREATE TABLE "seller_order_fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_application_id" uuid NOT NULL,
	"status" text DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"accepted_at" timestamp with time zone,
	"preparing_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"issue_at" timestamp with time zone,
	"issue_reason" text,
	"issue_message" text,
	"cancelled_at" timestamp with time zone,
	"carrier" text,
	"tracking_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_order_fulfillments_status_check" CHECK ("seller_order_fulfillments"."status" in ('AWAITING_PAYMENT', 'READY_FOR_SELLER', 'ACCEPTED', 'PREPARING', 'DISPATCHED', 'DELIVERED', 'FULFILLMENT_ISSUE', 'CANCELLED')),
	CONSTRAINT "seller_order_fulfillments_carrier_check" CHECK ("seller_order_fulfillments"."carrier" is null or char_length("seller_order_fulfillments"."carrier") between 2 and 80),
	CONSTRAINT "seller_order_fulfillments_tracking_check" CHECK ("seller_order_fulfillments"."tracking_reference" is null or char_length("seller_order_fulfillments"."tracking_reference") between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "inventory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"reservation_id" uuid,
	"order_id" uuid,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"previous_on_hand" integer NOT NULL,
	"resulting_on_hand" integer NOT NULL,
	"previous_reserved" integer NOT NULL,
	"resulting_reserved" integer NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_events_actor_check" CHECK (("inventory_events"."actor_type" = 'SYSTEM' and "inventory_events"."actor_user_id" is null) or
        ("inventory_events"."actor_type" = 'SELLER' and "inventory_events"."actor_user_id" is not null)),
	CONSTRAINT "inventory_events_action_check" CHECK ("inventory_events"."action" in ('SELLER_ON_HAND_CHANGED', 'RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED')),
	CONSTRAINT "inventory_events_balances_check" CHECK ("inventory_events"."previous_on_hand" >= 0 and "inventory_events"."resulting_on_hand" >= 0 and
        "inventory_events"."previous_reserved" >= 0 and "inventory_events"."resulting_reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_quantity_check" CHECK ("inventory_reservations"."quantity" > 0),
	CONSTRAINT "inventory_reservations_status_check" CHECK ("inventory_reservations"."status" in ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
	CONSTRAINT "inventory_reservations_terminal_check" CHECK (("inventory_reservations"."status" = 'ACTIVE' and "inventory_reservations"."committed_at" is null and "inventory_reservations"."released_at" is null and "inventory_reservations"."release_reason" is null) or
        ("inventory_reservations"."status" = 'COMMITTED' and "inventory_reservations"."committed_at" is not null and "inventory_reservations"."released_at" is null and "inventory_reservations"."release_reason" is null) or
        ("inventory_reservations"."status" in ('RELEASED', 'EXPIRED') and "inventory_reservations"."committed_at" is null and "inventory_reservations"."released_at" is not null and "inventory_reservations"."release_reason" is not null)),
	CONSTRAINT "inventory_reservations_release_reason_check" CHECK ("inventory_reservations"."release_reason" is null or "inventory_reservations"."release_reason" in ('CUSTOMER_CANCELLED', 'RESERVATION_EXPIRED'))
);
--> statement-breakpoint
ALTER TABLE "product_inventory" RENAME COLUMN "quantity_available" TO "quantity_on_hand";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";--> statement-breakpoint
ALTER TABLE "product_inventory" DROP CONSTRAINT "product_inventory_quantity_check";--> statement-breakpoint
ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_events_permission_check";--> statement-breakpoint
ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_events_review_target_check";--> statement-breakpoint
ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_events_permission_action_check";--> statement-breakpoint
ALTER TABLE "staff_permission_grants" DROP CONSTRAINT "staff_permission_grants_permission_check";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_source" text DEFAULT 'PLATFORM' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "seller_application_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "seller_fulfillment_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reservation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "product_inventory" ADD COLUMN "quantity_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_inventory" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_delivery_addresses" ADD CONSTRAINT "order_delivery_addresses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fulfillment_events" ADD CONSTRAINT "order_fulfillment_events_fulfillment_id_seller_order_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."seller_order_fulfillments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fulfillment_events" ADD CONSTRAINT "order_fulfillment_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_fulfillment_configs" ADD CONSTRAINT "seller_fulfillment_configs_seller_application_id_seller_applications_id_fk" FOREIGN KEY ("seller_application_id") REFERENCES "public"."seller_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_order_fulfillments" ADD CONSTRAINT "seller_order_fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_order_fulfillments" ADD CONSTRAINT "seller_order_fulfillments_seller_application_id_seller_applications_id_fk" FOREIGN KEY ("seller_application_id") REFERENCES "public"."seller_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_reservation_id_inventory_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."inventory_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_reservation_identity_uidx" ON "order_items" USING btree ("id","order_id","product_id");--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_item_fk" FOREIGN KEY ("order_item_id","order_id","product_id") REFERENCES "public"."order_items"("id","order_id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_fulfillment_events_fulfillment_created_idx" ON "order_fulfillment_events" USING btree ("fulfillment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_fulfillment_events_request_uidx" ON "order_fulfillment_events" USING btree ("fulfillment_id","action","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_order_fulfillments_order_seller_uidx" ON "seller_order_fulfillments" USING btree ("order_id","seller_application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_order_fulfillments_identity_uidx" ON "seller_order_fulfillments" USING btree ("id","order_id","seller_application_id");--> statement-breakpoint
CREATE INDEX "seller_order_fulfillments_seller_status_created_idx" ON "seller_order_fulfillments" USING btree ("seller_application_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "seller_order_fulfillments_order_idx" ON "seller_order_fulfillments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_events_product_created_idx" ON "inventory_events" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_events_order_idx" ON "inventory_events" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reservations_order_item_uidx" ON "inventory_reservations" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_order_status_idx" ON "inventory_reservations" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_expiry_idx" ON "inventory_reservations" USING btree ("expires_at","order_id") WHERE "inventory_reservations"."status" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_application_id_seller_applications_id_fk" FOREIGN KEY ("seller_application_id") REFERENCES "public"."seller_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_fulfillment_owner_fk" FOREIGN KEY ("seller_fulfillment_id","order_id","seller_application_id") REFERENCES "public"."seller_order_fulfillments"("id","order_id","seller_application_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_source_check" CHECK ("order_items"."product_source" in ('PLATFORM', 'SELLER'));--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_linkage_check" CHECK (("order_items"."product_source" = 'PLATFORM' and "order_items"."seller_application_id" is null and "order_items"."seller_fulfillment_id" is null) or
        ("order_items"."product_source" = 'SELLER' and "order_items"."seller_application_id" is not null and "order_items"."seller_fulfillment_id" is not null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_minor_check" CHECK ("orders"."shipping_minor" = 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_components_check" CHECK ("orders"."total_minor" = "orders"."subtotal_minor" + "orders"."shipping_minor");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancellation_pair_check" CHECK (("orders"."cancelled_at" is null) = ("orders"."cancellation_reason" is null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancellation_reason_check" CHECK ("orders"."cancellation_reason" is null or "orders"."cancellation_reason" in ('CUSTOMER_CANCELLED', 'RESERVATION_EXPIRED'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('PENDING_PAYMENT', 'PAYMENT_REVIEW_REQUIRED', 'PAID', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'REFUNDED'));--> statement-breakpoint
ALTER TABLE "product_inventory" ADD CONSTRAINT "product_inventory_on_hand_check" CHECK ("product_inventory"."quantity_on_hand" >= 0 and "product_inventory"."quantity_on_hand" <= 1000000);--> statement-breakpoint
ALTER TABLE "product_inventory" ADD CONSTRAINT "product_inventory_reserved_check" CHECK ("product_inventory"."quantity_reserved" >= 0 and "product_inventory"."quantity_reserved" <= "product_inventory"."quantity_on_hand");--> statement-breakpoint
ALTER TABLE "product_inventory" ADD CONSTRAINT "product_inventory_version_check" CHECK ("product_inventory"."version" > 0);--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_permission_check" CHECK ("staff_audit_events"."permission" is null or "staff_audit_events"."permission" in ('SELLER_REVIEW', 'PRODUCT_REVIEW', 'CATALOG_ACTIVATE', 'SELLER_COMMERCE_ACTIVATE', 'ORDER_SUPPORT'));--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_review_target_check" CHECK (("staff_audit_events"."action" in (
        'SELLER_APPLICATION_REVIEW_STARTED', 'SELLER_APPLICATION_APPROVED', 'SELLER_APPLICATION_REJECTED',
        'SELLER_PRODUCT_REVIEW_STARTED', 'SELLER_PRODUCT_APPROVED', 'SELLER_PRODUCT_REJECTED'
      ) and num_nonnulls("staff_audit_events"."seller_application_id", "staff_audit_events"."seller_product_submission_id") = 1 and
        "staff_audit_events"."seller_product_media_id" is null and "staff_audit_events"."product_id" is null and
        "staff_audit_events"."previous_status" is not null and "staff_audit_events"."resulting_status" is not null) or
        ("staff_audit_events"."action" in ('SELLER_PRODUCT_MEDIA_APPROVED', 'SELLER_PRODUCT_MEDIA_REJECTED') and
        "staff_audit_events"."seller_product_media_id" is not null and
        "staff_audit_events"."seller_application_id" is null and "staff_audit_events"."seller_product_submission_id" is null and "staff_audit_events"."product_id" is null and
        "staff_audit_events"."previous_status" is not null and "staff_audit_events"."resulting_status" is not null) or
        ("staff_audit_events"."action" in ('CATALOG_ACTIVATED', 'CATALOG_DEACTIVATED') and
        "staff_audit_events"."seller_product_submission_id" is not null and "staff_audit_events"."product_id" is not null and
        "staff_audit_events"."seller_application_id" is null and "staff_audit_events"."seller_product_media_id" is null and
        "staff_audit_events"."previous_status" is not null and "staff_audit_events"."resulting_status" is not null) or
        ("staff_audit_events"."action" in ('SELLER_COMMERCE_ENABLED', 'SELLER_COMMERCE_DISABLED') and
        "staff_audit_events"."product_id" is not null and
        "staff_audit_events"."seller_application_id" is null and "staff_audit_events"."seller_product_submission_id" is null and "staff_audit_events"."seller_product_media_id" is null and
        "staff_audit_events"."previous_status" is not null and "staff_audit_events"."resulting_status" is not null) or
        ("staff_audit_events"."action" in ('STAFF_BOOTSTRAPPED', 'STAFF_PERMISSION_GRANTED') and
        num_nonnulls("staff_audit_events"."seller_application_id", "staff_audit_events"."seller_product_submission_id", "staff_audit_events"."seller_product_media_id", "staff_audit_events"."product_id") = 0 and
        "staff_audit_events"."previous_status" is null and "staff_audit_events"."resulting_status" is null));--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_permission_action_check" CHECK ("staff_audit_events"."actor_type" = 'SYSTEM_BOOTSTRAP' or
        ("staff_audit_events"."permission" = 'SELLER_REVIEW' and "staff_audit_events"."action" in ('SELLER_APPLICATION_REVIEW_STARTED', 'SELLER_APPLICATION_APPROVED', 'SELLER_APPLICATION_REJECTED')) or
        ("staff_audit_events"."permission" = 'PRODUCT_REVIEW' and "staff_audit_events"."action" in ('SELLER_PRODUCT_REVIEW_STARTED', 'SELLER_PRODUCT_APPROVED', 'SELLER_PRODUCT_REJECTED', 'SELLER_PRODUCT_MEDIA_APPROVED', 'SELLER_PRODUCT_MEDIA_REJECTED')) or
        ("staff_audit_events"."permission" = 'CATALOG_ACTIVATE' and "staff_audit_events"."action" in ('CATALOG_ACTIVATED', 'CATALOG_DEACTIVATED')) or
        ("staff_audit_events"."permission" = 'SELLER_COMMERCE_ACTIVATE' and "staff_audit_events"."action" in ('SELLER_COMMERCE_ENABLED', 'SELLER_COMMERCE_DISABLED')));--> statement-breakpoint
ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_permission_check" CHECK ("staff_permission_grants"."permission" in ('SELLER_REVIEW', 'PRODUCT_REVIEW', 'CATALOG_ACTIVATE', 'SELLER_COMMERCE_ACTIVATE', 'ORDER_SUPPORT'));
