CREATE TABLE "completion_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"completion_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"points" double precision NOT NULL,
	CONSTRAINT "completion_credits_once" UNIQUE("completion_id","member_id"),
	CONSTRAINT "completion_credits_points" CHECK ("completion_credits"."points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "completion_credits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"logged_by" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "completions_household_id" UNIQUE("household_id","id"),
	CONSTRAINT "completions_once" UNIQUE("household_id","occurrence_id")
);
--> statement-breakpoint
ALTER TABLE "completions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action";--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "completion_credits" ADD CONSTRAINT "completion_credits_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_credits" ADD CONSTRAINT "completion_credits_completion" FOREIGN KEY ("household_id","completion_id") REFERENCES "public"."completions"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_credits" ADD CONSTRAINT "completion_credits_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_occurrence" FOREIGN KEY ("household_id","occurrence_id") REFERENCES "public"."occurrences"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_plan" FOREIGN KEY ("household_id","plan_id") REFERENCES "public"."plans"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_logged_by" FOREIGN KEY ("household_id","logged_by") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_subject_id_members_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_subject" CHECK ("activity_log"."subject_id" is null or "activity_log"."action" in ('completion.logged', 'completion.undone'));--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action" CHECK ("activity_log"."action" in ('household.name', 'household.timeZone', 'household.language',
        'household.country', 'household.started', 'completion.logged', 'completion.undone'));--> statement-breakpoint
CREATE POLICY "household_only" ON "completion_credits" AS PERMISSIVE FOR ALL TO public USING ("completion_credits"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("completion_credits"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "completions" AS PERMISSIVE FOR ALL TO public USING ("completions"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("completions"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);