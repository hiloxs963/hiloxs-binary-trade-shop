CREATE TABLE "seller_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"seller_type" text NOT NULL,
	"legal_name" text NOT NULL,
	"trading_name" text,
	"registration_number" text,
	"kra_pin" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"review_reason" text,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_applications_type_check" CHECK ("seller_applications"."seller_type" in ('COMPANY', 'REGISTERED_BUSINESS', 'SOLE_PROPRIETOR')),
	CONSTRAINT "seller_applications_status_check" CHECK ("seller_applications"."status" in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
	CONSTRAINT "seller_applications_legal_name_check" CHECK (char_length("seller_applications"."legal_name") between 2 and 160),
	CONSTRAINT "seller_applications_trading_name_check" CHECK ("seller_applications"."trading_name" is null or char_length("seller_applications"."trading_name") between 2 and 160),
	CONSTRAINT "seller_applications_registration_number_check" CHECK ("seller_applications"."registration_number" is null or char_length("seller_applications"."registration_number") between 2 and 80),
	CONSTRAINT "seller_applications_kra_pin_check" CHECK ("seller_applications"."kra_pin" is null or "seller_applications"."kra_pin" ~ '^[AP][0-9]{9}[A-Z]$'),
	CONSTRAINT "seller_applications_kra_pin_type_check" CHECK ("seller_applications"."kra_pin" is null or
        ("seller_applications"."seller_type" = 'COMPANY' and "seller_applications"."kra_pin" like 'P%') or
        ("seller_applications"."seller_type" = 'SOLE_PROPRIETOR' and "seller_applications"."kra_pin" like 'A%') or
        "seller_applications"."seller_type" = 'REGISTERED_BUSINESS'),
	CONSTRAINT "seller_applications_sole_registration_check" CHECK ("seller_applications"."seller_type" <> 'SOLE_PROPRIETOR' or "seller_applications"."registration_number" is null),
	CONSTRAINT "seller_applications_terms_pair_check" CHECK (("seller_applications"."terms_version" is null) = ("seller_applications"."terms_accepted_at" is null)),
	CONSTRAINT "seller_applications_submission_check" CHECK ("seller_applications"."status" not in ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED') or (
        "seller_applications"."submitted_at" is not null and
        "seller_applications"."terms_version" is not null and
        "seller_applications"."terms_accepted_at" is not null and
        "seller_applications"."kra_pin" is not null and
        (
          ("seller_applications"."seller_type" = 'SOLE_PROPRIETOR' and "seller_applications"."registration_number" is null) or
          ("seller_applications"."seller_type" in ('COMPANY', 'REGISTERED_BUSINESS') and "seller_applications"."registration_number" is not null)
        )
      )),
	CONSTRAINT "seller_applications_draft_check" CHECK ("seller_applications"."status" <> 'DRAFT' or (
        "seller_applications"."terms_version" is null and
        "seller_applications"."terms_accepted_at" is null and
        "seller_applications"."submitted_at" is null
      )),
	CONSTRAINT "seller_applications_review_check" CHECK ((
        "seller_applications"."status" = 'REJECTED' and "seller_applications"."reviewed_at" is not null and "seller_applications"."review_reason" is not null
      ) or (
        "seller_applications"."status" = 'APPROVED' and "seller_applications"."reviewed_at" is not null and "seller_applications"."review_reason" is null
      ) or (
        "seller_applications"."status" not in ('APPROVED', 'REJECTED') and "seller_applications"."reviewed_at" is null and "seller_applications"."review_reason" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_applications_user_id_uidx" ON "seller_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "seller_applications_status_submitted_idx" ON "seller_applications" USING btree ("status","submitted_at");