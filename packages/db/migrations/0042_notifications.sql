CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"week" date,
	CONSTRAINT "notifications_kind" CHECK ("notifications"."kind" in ('plan.drafted', 'plan.published')),
	CONSTRAINT "notifications_week" CHECK (("notifications"."kind" in ('plan.drafted', 'plan.published')) = ("notifications"."week" is not null))
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_plan" FOREIGN KEY ("household_id","week") REFERENCES "public"."plans"("household_id","week_start") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_member_at" ON "notifications" USING btree ("household_id","member_id","at");--> statement-breakpoint
CREATE POLICY "household_only" ON "notifications" AS PERMISSIVE FOR ALL TO public USING ("notifications"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("notifications"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);