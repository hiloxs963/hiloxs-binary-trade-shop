CREATE TABLE "security_rate_limit_windows" (
	"scope" text NOT NULL,
	"key_digest" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_rate_limit_windows_scope_key_digest_window_start_pk" PRIMARY KEY("scope","key_digest","window_start"),
	CONSTRAINT "security_rate_limit_windows_scope_check" CHECK (char_length("security_rate_limit_windows"."scope") between 1 and 80),
	CONSTRAINT "security_rate_limit_windows_digest_check" CHECK (char_length("security_rate_limit_windows"."key_digest") = 64),
	CONSTRAINT "security_rate_limit_windows_count_check" CHECK ("security_rate_limit_windows"."count" > 0),
	CONSTRAINT "security_rate_limit_windows_expiry_check" CHECK ("security_rate_limit_windows"."expires_at" > "security_rate_limit_windows"."window_start")
);
--> statement-breakpoint
CREATE INDEX "security_rate_limit_windows_expires_idx" ON "security_rate_limit_windows" USING btree ("expires_at");