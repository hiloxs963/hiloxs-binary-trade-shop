CREATE SEQUENCE "public"."products_sort_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 44 CACHE 1;--> statement-breakpoint
CREATE TABLE "product_inventory" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"quantity_available" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_inventory_quantity_check" CHECK ("product_inventory"."quantity_available" >= 0 and "product_inventory"."quantity_available" <= 1000000)
);
--> statement-breakpoint
CREATE TABLE "product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_seller_media_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_sort_order_check" CHECK ("product_media"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_media_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_media_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_variants_variant_check" CHECK ("product_media_variants"."variant" in ('THUMBNAIL', 'MEDIUM', 'LARGE')),
	CONSTRAINT "product_media_variants_mime_check" CHECK ("product_media_variants"."mime" = 'image/webp'),
	CONSTRAINT "product_media_variants_dimensions_check" CHECK ("product_media_variants"."width" > 0 and "product_media_variants"."height" > 0),
	CONSTRAINT "product_media_variants_size_check" CHECK ("product_media_variants"."byte_size" > 0),
	CONSTRAINT "product_media_variants_sha256_check" CHECK (char_length("product_media_variants"."sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "seller_product_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_product_submission_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"activated_by_staff_user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_product_inventory" (
	"seller_product_submission_id" uuid PRIMARY KEY NOT NULL,
	"quantity_available" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"configured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_product_inventory_quantity_check" CHECK ("seller_product_inventory"."quantity_available" >= 0 and "seller_product_inventory"."quantity_available" <= 1000000),
	CONSTRAINT "seller_product_inventory_version_check" CHECK ("seller_product_inventory"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "seller_product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_product_submission_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"quarantine_object_key" text NOT NULL,
	"quarantine_etag" text,
	"canonical_object_key" text,
	"declared_mime" text NOT NULL,
	"detected_mime" text,
	"canonical_mime" text,
	"declared_byte_size" bigint NOT NULL,
	"input_byte_size" bigint,
	"canonical_byte_size" bigint,
	"width" integer,
	"height" integer,
	"sha256" text,
	"sort_order" integer NOT NULL,
	"selected_for_activation" boolean DEFAULT false NOT NULL,
	"rights_terms_version" text NOT NULL,
	"rights_accepted_at" timestamp with time zone NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"processing_lease_until" timestamp with time zone,
	"last_processing_error_code" text,
	"quarantine_delete_pending" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_product_media_status_check" CHECK ("seller_product_media"."status" in ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSING_FAILED', 'ABANDONED')),
	CONSTRAINT "seller_product_media_declared_mime_check" CHECK ("seller_product_media"."declared_mime" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "seller_product_media_declared_size_check" CHECK ("seller_product_media"."declared_byte_size" > 0 and "seller_product_media"."declared_byte_size" <= 8388608),
	CONSTRAINT "seller_product_media_sort_order_check" CHECK ("seller_product_media"."sort_order" >= 0),
	CONSTRAINT "seller_product_media_processing_attempts_check" CHECK ("seller_product_media"."processing_attempts" >= 0 and "seller_product_media"."processing_attempts" <= 3),
	CONSTRAINT "seller_product_media_sha256_check" CHECK ("seller_product_media"."sha256" is null or char_length("seller_product_media"."sha256") = 64),
	CONSTRAINT "seller_product_media_selection_check" CHECK ("seller_product_media"."selected_for_activation" = false or "seller_product_media"."status" = 'APPROVED'),
	CONSTRAINT "seller_product_media_review_check" CHECK (("seller_product_media"."status" = 'REJECTED' and "seller_product_media"."reviewed_at" is not null and "seller_product_media"."review_reason" is not null) or
        ("seller_product_media"."status" = 'APPROVED' and "seller_product_media"."reviewed_at" is not null and "seller_product_media"."review_reason" is null) or
        ("seller_product_media"."status" not in ('APPROVED', 'REJECTED') and "seller_product_media"."reviewed_at" is null and "seller_product_media"."review_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "seller_product_media_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_media_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_product_media_variants_variant_check" CHECK ("seller_product_media_variants"."variant" in ('MASTER', 'THUMBNAIL', 'MEDIUM', 'LARGE')),
	CONSTRAINT "seller_product_media_variants_mime_check" CHECK ("seller_product_media_variants"."mime" = 'image/webp'),
	CONSTRAINT "seller_product_media_variants_dimensions_check" CHECK ("seller_product_media_variants"."width" > 0 and "seller_product_media_variants"."height" > 0),
	CONSTRAINT "seller_product_media_variants_size_check" CHECK ("seller_product_media_variants"."byte_size" > 0),
	CONSTRAINT "seller_product_media_variants_sha256_check" CHECK (char_length("seller_product_media_variants"."sha256") = 64)
);
--> statement-breakpoint
ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_events_permission_check";--> statement-breakpoint
ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_events_review_target_check";--> statement-breakpoint
ALTER TABLE "staff_permission_grants" DROP CONSTRAINT "staff_permission_grants_permission_check";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "is_active" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "sort_order" SET DEFAULT nextval('products_sort_order_seq');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source" text DEFAULT 'PLATFORM' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_purchasable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seller_application_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seller_product_submission_id" uuid;--> statement-breakpoint
UPDATE "products" SET "is_purchasable" = true WHERE "source" = 'PLATFORM';--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD COLUMN "seller_product_media_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "product_inventory" ADD CONSTRAINT "product_inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_source_seller_media_id_seller_product_media_id_fk" FOREIGN KEY ("source_seller_media_id") REFERENCES "public"."seller_product_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_variants" ADD CONSTRAINT "product_media_variants_product_media_id_product_media_id_fk" FOREIGN KEY ("product_media_id") REFERENCES "public"."product_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_product_activations" ADD CONSTRAINT "seller_product_activations_seller_product_submission_id_seller_product_submissions_id_fk" FOREIGN KEY ("seller_product_submission_id") REFERENCES "public"."seller_product_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_product_activations" ADD CONSTRAINT "seller_product_activations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_product_activations" ADD CONSTRAINT "seller_product_activations_activated_by_staff_user_id_user_id_fk" FOREIGN KEY ("activated_by_staff_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_product_inventory" ADD CONSTRAINT "seller_product_inventory_seller_product_submission_id_seller_product_submissions_id_fk" FOREIGN KEY ("seller_product_submission_id") REFERENCES "public"."seller_product_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_product_media" ADD CONSTRAINT "seller_product_media_seller_product_submission_id_seller_product_submissions_id_fk" FOREIGN KEY ("seller_product_submission_id") REFERENCES "public"."seller_product_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_product_media_variants" ADD CONSTRAINT "seller_product_media_variants_seller_media_id_seller_product_media_id_fk" FOREIGN KEY ("seller_media_id") REFERENCES "public"."seller_product_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_product_sort_uidx" ON "product_media" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_source_seller_media_uidx" ON "product_media" USING btree ("source_seller_media_id");--> statement-breakpoint
CREATE INDEX "product_media_product_idx" ON "product_media" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_variants_media_variant_uidx" ON "product_media_variants" USING btree ("product_media_id","variant");--> statement-breakpoint
CREATE INDEX "product_media_variants_object_key_idx" ON "product_media_variants" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_activations_submission_uidx" ON "seller_product_activations" USING btree ("seller_product_submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_activations_product_uidx" ON "seller_product_activations" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_activations_request_uidx" ON "seller_product_activations" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_media_quarantine_key_uidx" ON "seller_product_media" USING btree ("quarantine_object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_media_canonical_key_uidx" ON "seller_product_media" USING btree ("canonical_object_key") WHERE "seller_product_media"."canonical_object_key" is not null;--> statement-breakpoint
CREATE INDEX "seller_product_media_submission_sort_idx" ON "seller_product_media" USING btree ("seller_product_submission_id","sort_order");--> statement-breakpoint
CREATE INDEX "seller_product_media_processing_idx" ON "seller_product_media" USING btree ("status","processing_lease_until","processing_attempts");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_media_variants_media_variant_uidx" ON "seller_product_media_variants" USING btree ("seller_media_id","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_media_variants_object_key_uidx" ON "seller_product_media_variants" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_product_submissions_application_id_id_uidx" ON "seller_product_submissions" USING btree ("seller_application_id","id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_application_id_seller_applications_id_fk" FOREIGN KEY ("seller_application_id") REFERENCES "public"."seller_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_submission_owner_fk" FOREIGN KEY ("seller_application_id","seller_product_submission_id") REFERENCES "public"."seller_product_submissions"("seller_application_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_seller_product_media_id_seller_product_media_id_fk" FOREIGN KEY ("seller_product_media_id") REFERENCES "public"."seller_product_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_seller_submission_uidx" ON "products" USING btree ("seller_product_submission_id") WHERE "products"."seller_product_submission_id" is not null;--> statement-breakpoint
CREATE INDEX "products_active_purchasable_idx" ON "products" USING btree ("is_active","is_purchasable");--> statement-breakpoint
CREATE INDEX "staff_audit_events_media_created_idx" ON "staff_audit_events" USING btree ("seller_product_media_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_audit_events_public_product_created_idx" ON "staff_audit_events" USING btree ("product_id","created_at");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_check" CHECK ("products"."source" in ('PLATFORM', 'SELLER'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_linkage_check" CHECK (("products"."source" = 'PLATFORM' and "products"."seller_application_id" is null and "products"."seller_product_submission_id" is null) or
        ("products"."source" = 'SELLER' and "products"."seller_application_id" is not null and "products"."seller_product_submission_id" is not null));--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_permission_action_check" CHECK ("staff_audit_events"."actor_type" = 'SYSTEM_BOOTSTRAP' or
        ("staff_audit_events"."permission" = 'SELLER_REVIEW' and "staff_audit_events"."action" in ('SELLER_APPLICATION_REVIEW_STARTED', 'SELLER_APPLICATION_APPROVED', 'SELLER_APPLICATION_REJECTED')) or
        ("staff_audit_events"."permission" = 'PRODUCT_REVIEW' and "staff_audit_events"."action" in ('SELLER_PRODUCT_REVIEW_STARTED', 'SELLER_PRODUCT_APPROVED', 'SELLER_PRODUCT_REJECTED', 'SELLER_PRODUCT_MEDIA_APPROVED', 'SELLER_PRODUCT_MEDIA_REJECTED')) or
        ("staff_audit_events"."permission" = 'CATALOG_ACTIVATE' and "staff_audit_events"."action" in ('CATALOG_ACTIVATED', 'CATALOG_DEACTIVATED')));--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_permission_check" CHECK ("staff_audit_events"."permission" is null or "staff_audit_events"."permission" in ('SELLER_REVIEW', 'PRODUCT_REVIEW', 'CATALOG_ACTIVATE'));--> statement-breakpoint
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
        ("staff_audit_events"."action" in ('STAFF_BOOTSTRAPPED', 'STAFF_PERMISSION_GRANTED') and
        num_nonnulls("staff_audit_events"."seller_application_id", "staff_audit_events"."seller_product_submission_id", "staff_audit_events"."seller_product_media_id", "staff_audit_events"."product_id") = 0 and
        "staff_audit_events"."previous_status" is null and "staff_audit_events"."resulting_status" is null));--> statement-breakpoint
ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_permission_check" CHECK ("staff_permission_grants"."permission" in ('SELLER_REVIEW', 'PRODUCT_REVIEW', 'CATALOG_ACTIVATE'));
