ALTER TABLE "auth"."accounts" ADD COLUMN "culture" text;--> statement-breakpoint
UPDATE "auth"."accounts" SET "culture" = 'en-BE';--> statement-breakpoint
ALTER TABLE "auth"."accounts" ALTER COLUMN "culture" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD CONSTRAINT "accounts_culture" CHECK ("auth"."accounts"."culture" ~ '^[a-z]{2,3}-[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD CONSTRAINT "accounts_terms" CHECK (("auth"."accounts"."terms_version" is null and "auth"."accounts"."terms_accepted_at" is null)
        or ("auth"."accounts"."terms_version" is not null and "auth"."accounts"."terms_accepted_at" is not null));