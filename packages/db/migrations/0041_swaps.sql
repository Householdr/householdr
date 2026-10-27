CREATE TABLE "swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"from_member" uuid NOT NULL,
	"to_member" uuid NOT NULL,
	"give" uuid NOT NULL,
	"take" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "swaps_status" CHECK ("swaps"."status" in ('pending', 'accepted', 'declined', 'void')),
	CONSTRAINT "swaps_members" CHECK ("swaps"."from_member" <> "swaps"."to_member"),
	CONSTRAINT "swaps_answered" CHECK (("swaps"."status" = 'pending') = ("swaps"."answered_at" is null))
);
--> statement-breakpoint
ALTER TABLE "swaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action";--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_subject";--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_reason";--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_household_id" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_from_member" FOREIGN KEY ("household_id","from_member") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_to_member" FOREIGN KEY ("household_id","to_member") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_give" FOREIGN KEY ("household_id","give") REFERENCES "public"."assignments"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_take" FOREIGN KEY ("household_id","take") REFERENCES "public"."assignments"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swaps_pending_give" ON "swaps" USING btree ("household_id","give") WHERE "swaps"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "swaps_to_member" ON "swaps" USING btree ("household_id","to_member","status");--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action" CHECK ("activity_log"."action" in ('household.name', 'household.timeZone', 'household.language',
        'household.country', 'household.started', 'completion.logged', 'completion.undone',
        'completion.picked-up', 'share.changed', 'temporary-share.added',
        'temporary-share.removed', 'absence.added', 'absence.removed', 'away.added',
        'away.removed', 'one-off.added', 'one-off.removed', 'assignment.given',
        'assignment.taken', 'swap.proposed', 'swap.answered'));--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_subject" CHECK ("activity_log"."subject_id" is null or "activity_log"."action" in ('completion.logged', 'completion.undone', 'completion.picked-up',
  'share.changed', 'temporary-share.added', 'temporary-share.removed', 'absence.added',
  'absence.removed', 'assignment.given', 'assignment.taken', 'swap.proposed',
  'swap.answered'));--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_reason" CHECK ("assignments"."reason" in ('bound', 'assigned by head', 'linked', 'only eligible member',
        'lowest relative load', 'catching up', 'swapped'));--> statement-breakpoint
CREATE POLICY "household_only" ON "swaps" AS PERMISSIVE FOR ALL TO public USING ("swaps"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("swaps"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);