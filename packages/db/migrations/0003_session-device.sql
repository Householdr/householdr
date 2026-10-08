ALTER TABLE "auth"."sessions" ADD COLUMN "browser" text;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "system" text;--> statement-breakpoint
-- Sessions started before this kept an empty user agent, which the check below refuses.
UPDATE "auth"."sessions" SET "user_agent" = NULL;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_no_user_agent" CHECK ("auth"."sessions"."user_agent" is null);
