CREATE TABLE "auth"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_count" CHECK ("auth"."rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "rate_limits_expires_at" ON "auth"."rate_limits" USING btree ("expires_at");--> statement-breakpoint
-- Counts needn't survive a crash, so they skip the write-ahead log (ADR-0017 §5).
ALTER TABLE "auth"."rate_limits" SET UNLOGGED;
