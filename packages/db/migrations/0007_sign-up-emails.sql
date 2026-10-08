ALTER TABLE "auth"."account_emails" DROP CONSTRAINT "account_emails_kind";--> statement-breakpoint
ALTER TABLE "auth"."verifications" DROP CONSTRAINT "verifications_purpose";--> statement-breakpoint
ALTER TABLE "auth"."account_emails" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."account_emails" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "auth"."account_emails" ADD CONSTRAINT "account_emails_recipient" CHECK (("auth"."account_emails"."kind" = 'sign-up' and "auth"."account_emails"."account_id" is null and "auth"."account_emails"."email" is not null)
        or ("auth"."account_emails"."kind" <> 'sign-up' and "auth"."account_emails"."account_id" is not null and "auth"."account_emails"."email" is null));--> statement-breakpoint
ALTER TABLE "auth"."account_emails" ADD CONSTRAINT "account_emails_kind" CHECK ("auth"."account_emails"."kind" in ('sign-up', 'password-reset', 'password-changed', 'passkey-added', 'passkey-removed'));--> statement-breakpoint
ALTER TABLE "auth"."verifications" ADD CONSTRAINT "verifications_purpose" CHECK ("auth"."verifications"."purpose" in ('password-reset', 'sign-up'));