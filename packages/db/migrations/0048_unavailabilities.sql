CREATE TABLE "unavailabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "unavailabilities_times" CHECK ("unavailabilities"."starts_at" < "unavailabilities"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "unavailabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action";--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_subject";--> statement-breakpoint
ALTER TABLE "unavailabilities" ADD CONSTRAINT "unavailabilities_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailabilities" ADD CONSTRAINT "unavailabilities_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unavailabilities_household_ends" ON "unavailabilities" USING btree ("household_id","ends_at");--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action" CHECK ("activity_log"."action" in ('household.name', 'household.timeZone', 'household.language',
        'household.country', 'household.started', 'completion.logged', 'completion.undone',
        'completion.picked-up', 'share.changed', 'temporary-share.added',
        'temporary-share.removed', 'absence.added', 'absence.removed', 'unavailable.reported',
        'unavailable.ended', 'away.added', 'away.removed'));--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_subject" CHECK ("activity_log"."subject_id" is null or "activity_log"."action" in ('completion.logged', 'completion.undone', 'completion.picked-up',
  'share.changed', 'temporary-share.added', 'temporary-share.removed', 'absence.added',
  'absence.removed', 'unavailable.reported', 'unavailable.ended'));--> statement-breakpoint
CREATE POLICY "household_only" ON "unavailabilities" AS PERMISSIVE FOR ALL TO public USING ("unavailabilities"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("unavailabilities"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);