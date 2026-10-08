CREATE TABLE "auth"."two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "two_factors_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "two_factors_secret_encrypted" CHECK ("auth"."two_factors"."secret" like '$ba$%'),
	CONSTRAINT "two_factors_backup_codes_encrypted" CHECK ("auth"."two_factors"."backup_codes" like '$ba$%')
);
--> statement-breakpoint
ALTER TABLE "auth"."account_emails" DROP CONSTRAINT "account_emails_kind";--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."two_factors" ADD CONSTRAINT "two_factors_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."account_emails" ADD CONSTRAINT "account_emails_kind" CHECK ("auth"."account_emails"."kind" in ('sign-up', 'password-reset', 'password-changed', 'passkey-added', 'passkey-removed', 'two-factor-on', 'two-factor-off', 'recovery-codes-changed'));