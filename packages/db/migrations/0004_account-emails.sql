CREATE TABLE "auth"."account_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_emails_kind" CHECK ("auth"."account_emails"."kind" in ('password-reset'))
);
--> statement-breakpoint
ALTER TABLE "auth"."verifications" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "auth"."account_emails" ADD CONSTRAINT "account_emails_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "auth"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verifications_purpose" ON "auth"."verifications" USING btree ("purpose","value");--> statement-breakpoint
ALTER TABLE "auth"."verifications" ADD CONSTRAINT "verifications_purpose" CHECK ("auth"."verifications"."purpose" in ('password-reset'));