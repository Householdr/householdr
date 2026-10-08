ALTER TABLE "members" ADD COLUMN "share_percent" smallint;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_share_percent" CHECK ("members"."share_percent" between 0 and 100);