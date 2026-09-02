CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_role" text,
	"permission" text,
	"action" text NOT NULL,
	"seller_application_id" uuid,
	"seller_product_submission_id" uuid,
	"previous_status" text,
	"resulting_status" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_audit_events_actor_type_check" CHECK ("staff_audit_events"."actor_type" in ('STAFF', 'SYSTEM_BOOTSTRAP')),
	CONSTRAINT "staff_audit_events_role_check" CHECK ("staff_audit_events"."actor_role" is null or "staff_audit_events"."actor_role" in ('STAFF', 'ADMIN')),
	CONSTRAINT "staff_audit_events_permission_check" CHECK ("staff_audit_events"."permission" is null or "staff_audit_events"."permission" in ('SELLER_REVIEW', 'PRODUCT_REVIEW')),
	CONSTRAINT "staff_audit_events_actor_check" CHECK (("staff_audit_events"."actor_type" = 'STAFF' and "staff_audit_events"."actor_user_id" is not null and "staff_audit_events"."actor_role" is not null and "staff_audit_events"."permission" is not null) or
        ("staff_audit_events"."actor_type" = 'SYSTEM_BOOTSTRAP' and "staff_audit_events"."actor_user_id" is null)),
	CONSTRAINT "staff_audit_events_review_target_check" CHECK (("staff_audit_events"."action" in (
        'SELLER_APPLICATION_REVIEW_STARTED', 'SELLER_APPLICATION_APPROVED', 'SELLER_APPLICATION_REJECTED',
        'SELLER_PRODUCT_REVIEW_STARTED', 'SELLER_PRODUCT_APPROVED', 'SELLER_PRODUCT_REJECTED'
      ) and num_nonnulls("staff_audit_events"."seller_application_id", "staff_audit_events"."seller_product_submission_id") = 1 and
        "staff_audit_events"."previous_status" is not null and "staff_audit_events"."resulting_status" is not null) or
        ("staff_audit_events"."action" in ('STAFF_BOOTSTRAPPED', 'STAFF_PERMISSION_GRANTED') and
        num_nonnulls("staff_audit_events"."seller_application_id", "staff_audit_events"."seller_product_submission_id") = 0 and
        "staff_audit_events"."previous_status" is null and "staff_audit_events"."resulting_status" is null))
);
--> statement-breakpoint
CREATE TABLE "staff_memberships" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "staff_memberships_role_check" CHECK ("staff_memberships"."role" in ('STAFF', 'ADMIN')),
	CONSTRAINT "staff_memberships_status_check" CHECK ("staff_memberships"."status" in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
	CONSTRAINT "staff_memberships_revoked_check" CHECK (("staff_memberships"."status" = 'REVOKED') = ("staff_memberships"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "staff_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grant_source" text NOT NULL,
	"granted_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	CONSTRAINT "staff_permission_grants_permission_check" CHECK ("staff_permission_grants"."permission" in ('SELLER_REVIEW', 'PRODUCT_REVIEW')),
	CONSTRAINT "staff_permission_grants_source_check" CHECK ("staff_permission_grants"."grant_source" in ('BOOTSTRAP', 'STAFF')),
	CONSTRAINT "staff_permission_grants_actor_check" CHECK (("staff_permission_grants"."grant_source" = 'BOOTSTRAP' and "staff_permission_grants"."granted_by_user_id" is null) or
        ("staff_permission_grants"."grant_source" = 'STAFF' and "staff_permission_grants"."granted_by_user_id" is not null)),
	CONSTRAINT "staff_permission_grants_revocation_check" CHECK (("staff_permission_grants"."revoked_at" is null) = ("staff_permission_grants"."revoked_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_seller_application_id_seller_applications_id_fk" FOREIGN KEY ("seller_application_id") REFERENCES "public"."seller_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_seller_product_submission_id_seller_product_submissions_id_fk" FOREIGN KEY ("seller_product_submission_id") REFERENCES "public"."seller_product_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_staff_user_id_staff_memberships_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_memberships"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_id_uidx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_audit_events_application_created_idx" ON "staff_audit_events" USING btree ("seller_application_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_audit_events_product_created_idx" ON "staff_audit_events" USING btree ("seller_product_submission_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_permission_grants_staff_user_idx" ON "staff_permission_grants" USING btree ("staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_permission_grants_active_uidx" ON "staff_permission_grants" USING btree ("staff_user_id","permission") WHERE "staff_permission_grants"."revoked_at" is null;