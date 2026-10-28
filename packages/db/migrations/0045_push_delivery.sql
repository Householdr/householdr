CREATE TABLE "auth"."sent_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."sent_pushes" ADD CONSTRAINT "sent_pushes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "auth"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sent_pushes_account" ON "auth"."sent_pushes" USING btree ("account_id","sent_at");--> statement-breakpoint
CREATE INDEX "notifications_push_after" ON "notifications" USING btree ("household_id","push_after") WHERE "notifications"."push_after" is not null;