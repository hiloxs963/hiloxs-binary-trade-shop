CREATE TABLE "user_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"policy" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "user_consents_policy_check" CHECK ("user_consents"."policy" in ('privacy-policy', 'terms-of-use')),
	CONSTRAINT "user_consents_version_check" CHECK (char_length("user_consents"."version") between 3 and 80)
);
--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_consents_user_policy_version_uidx" ON "user_consents" USING btree ("user_id","policy","version");