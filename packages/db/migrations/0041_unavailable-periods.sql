CREATE TABLE "unavailable_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	CONSTRAINT "unavailable_periods_window" CHECK ("unavailable_periods"."start" < "unavailable_periods"."end")
);
--> statement-breakpoint
ALTER TABLE "unavailable_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action";--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_subject";--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_reason";--> statement-breakpoint
ALTER TABLE "unavailable_periods" ADD CONSTRAINT "unavailable_periods_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailable_periods" ADD CONSTRAINT "unavailable_periods_member_household" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unavailable_periods_household_end" ON "unavailable_periods" USING btree ("household_id","end");--> statement-breakpoint
CREATE INDEX "unavailable_periods_member" ON "unavailable_periods" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action" CHECK ("activity_log"."action" in ('household.name', 'household.timeZone', 'household.language',
        'household.country', 'household.started', 'completion.logged', 'completion.undone',
        'completion.picked-up', 'share.changed', 'temporary-share.added',
        'temporary-share.removed', 'absence.added', 'absence.removed', 'away.added',
        'away.removed', 'one-off.added', 'one-off.removed', 'assignment.given',
        'assignment.taken', 'unavailable.reported', 'unavailable.ended'));--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_subject" CHECK ("activity_log"."subject_id" is null or "activity_log"."action" in ('completion.logged', 'completion.undone', 'completion.picked-up',
  'share.changed', 'temporary-share.added', 'temporary-share.removed', 'absence.added',
  'absence.removed', 'assignment.given', 'assignment.taken', 'unavailable.reported',
  'unavailable.ended'));--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_reason" CHECK ("assignments"."reason" in ('bound', 'assigned by head', 'linked', 'only eligible member',
        'lowest relative load', 'catching up', 're-allocated: member unavailable'));--> statement-breakpoint
CREATE POLICY "household_only" ON "unavailable_periods" AS PERMISSIVE FOR ALL TO public USING ("unavailable_periods"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("unavailable_periods"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);