CREATE TABLE "auth_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"event_type" text NOT NULL,
	"challenge_id" uuid,
	"ip_digest" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_security_events_type_check" CHECK ("auth_security_events"."event_type" in ('EMAIL_OTP_SENT', 'EMAIL_OTP_SEND_FAILED', 'EMAIL_OTP_VERIFIED', 'EMAIL_OTP_FAILED', 'EMAIL_OTP_LOCKED', 'EMAIL_OTP_ENROLLED', 'EMAIL_OTP_ENROLL_REFUSED', 'EMAIL_OTP_DISABLED', 'EMAIL_OTP_DISABLED_BY_STAFF_MEMBERSHIP', 'EMAIL_OTP_BLOCKED_STAFF', 'EMAIL_OTP_BLOCKED_AFTER_RESET', 'EMAIL_OTP_RATE_LIMITED', 'BACKUP_CODE_LOGIN_SUCCEEDED', 'BACKUP_CODE_LOGIN_FAILED')),
	CONSTRAINT "auth_security_events_user_agent_check" CHECK ("auth_security_events"."user_agent" is null or char_length("auth_security_events"."user_agent") <= 200)
);
--> statement-breakpoint
CREATE TABLE "email_otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pending_digest" text NOT NULL,
	"code_hash" text NOT NULL,
	"ip_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "email_otp_challenges_attempts_check" CHECK ("email_otp_challenges"."attempts" between 0 and 5),
	CONSTRAINT "email_otp_challenges_pending_digest_check" CHECK (char_length("email_otp_challenges"."pending_digest") = 64),
	CONSTRAINT "email_otp_challenges_code_hash_check" CHECK (char_length("email_otp_challenges"."code_hash") = 64),
	CONSTRAINT "email_otp_challenges_expiry_check" CHECK ("email_otp_challenges"."expires_at" > "email_otp_challenges"."created_at")
);
--> statement-breakpoint
CREATE TABLE "email_otp_enrollments" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"require_totp_next_login" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "mfa_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_security_events" ADD CONSTRAINT "auth_security_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_otp_challenges" ADD CONSTRAINT "email_otp_challenges_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_otp_enrollments" ADD CONSTRAINT "email_otp_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_security_events_user_created_idx" ON "auth_security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_security_events_type_created_idx" ON "auth_security_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_otp_challenges_live_pending_uidx" ON "email_otp_challenges" USING btree ("pending_digest") WHERE "email_otp_challenges"."consumed_at" is null and "email_otp_challenges"."invalidated_at" is null;--> statement-breakpoint
CREATE INDEX "email_otp_challenges_user_created_idx" ON "email_otp_challenges" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_otp_challenges_ip_created_idx" ON "email_otp_challenges" USING btree ("ip_digest","created_at");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_mfa_method_check" CHECK ("session"."mfa_method" in ('none', 'totp', 'backup-code', 'email-otp'));