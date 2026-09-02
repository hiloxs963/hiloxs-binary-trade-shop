CREATE TABLE "seller_product_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_application_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_product_submissions_status_check" CHECK ("seller_product_submissions"."status" in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
	CONSTRAINT "seller_product_submissions_category_check" CHECK ("seller_product_submissions"."category" in ('Laptops', 'Screens', 'Woofers', 'Accessories', 'Phones & Tablets', 'Home & Kitchen', 'Fashion', 'Beauty & Health', 'School & Office', 'Groceries', 'Sports & Outdoors')),
	CONSTRAINT "seller_product_submissions_name_check" CHECK (char_length("seller_product_submissions"."name") between 3 and 160),
	CONSTRAINT "seller_product_submissions_description_check" CHECK (char_length("seller_product_submissions"."description") between 20 and 5000),
	CONSTRAINT "seller_product_submissions_price_minor_check" CHECK ("seller_product_submissions"."price_minor" > 0 and "seller_product_submissions"."price_minor" <= 1000000000),
	CONSTRAINT "seller_product_submissions_currency_check" CHECK ("seller_product_submissions"."currency" = 'KES'),
	CONSTRAINT "seller_product_submissions_terms_pair_check" CHECK (("seller_product_submissions"."terms_version" is null) = ("seller_product_submissions"."terms_accepted_at" is null)),
	CONSTRAINT "seller_product_submissions_submission_metadata_check" CHECK (("seller_product_submissions"."submitted_at" is null) = ("seller_product_submissions"."terms_version" is null)),
	CONSTRAINT "seller_product_submissions_submitted_status_check" CHECK ("seller_product_submissions"."status" not in ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED') or "seller_product_submissions"."submitted_at" is not null),
	CONSTRAINT "seller_product_submissions_review_check" CHECK ((
        "seller_product_submissions"."status" = 'UNDER_REVIEW' and
        "seller_product_submissions"."review_started_at" is not null and
        "seller_product_submissions"."reviewed_at" is null and
        "seller_product_submissions"."review_reason" is null
      ) or (
        "seller_product_submissions"."status" = 'APPROVED' and
        "seller_product_submissions"."review_started_at" is not null and
        "seller_product_submissions"."reviewed_at" is not null and
        "seller_product_submissions"."review_reason" is null
      ) or (
        "seller_product_submissions"."status" = 'REJECTED' and
        "seller_product_submissions"."review_started_at" is not null and
        "seller_product_submissions"."reviewed_at" is not null and
        "seller_product_submissions"."review_reason" is not null
      ) or (
        "seller_product_submissions"."status" in ('DRAFT', 'SUBMITTED', 'WITHDRAWN') and
        "seller_product_submissions"."review_started_at" is null and
        "seller_product_submissions"."reviewed_at" is null and
        "seller_product_submissions"."review_reason" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "seller_product_submissions" ADD CONSTRAINT "seller_product_submissions_seller_application_id_seller_applications_id_fk" FOREIGN KEY ("seller_application_id") REFERENCES "public"."seller_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_product_submissions_seller_created_idx" ON "seller_product_submissions" USING btree ("seller_application_id","created_at");--> statement-breakpoint
CREATE INDEX "seller_product_submissions_status_submitted_idx" ON "seller_product_submissions" USING btree ("status","submitted_at");