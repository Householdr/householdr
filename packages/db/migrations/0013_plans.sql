CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"member_id" uuid,
	"cost" double precision,
	"reason" text,
	"unassigned_cause" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "assignments_plan_occurrence" UNIQUE("plan_id","occurrence_id"),
	CONSTRAINT "assignments_window" CHECK ("assignments"."window_start" < "assignments"."window_end"),
	CONSTRAINT "assignments_assigned" CHECK (("assignments"."member_id" is not null and "assignments"."cost" is not null and "assignments"."reason" is not null
          and "assignments"."unassigned_cause" is null)
        or ("assignments"."member_id" is null and "assignments"."cost" is null and "assignments"."reason" is null
          and "assignments"."unassigned_cause" is not null)),
	CONSTRAINT "assignments_cost" CHECK ("assignments"."cost" >= 0),
	CONSTRAINT "assignments_reason" CHECK ("assignments"."reason" in ('bound', 'assigned by head', 'linked', 'only eligible member',
        'lowest relative load', 'catching up')),
	CONSTRAINT "assignments_unassigned_cause" CHECK ("assignments"."unassigned_cause" in ('nobody eligible', 'bound member not eligible',
        'linked member not eligible'))
);
--> statement-breakpoint
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"date" date NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by_plan" uuid,
	CONSTRAINT "occurrences_household_id" UNIQUE("household_id","id"),
	CONSTRAINT "occurrences_task_date" UNIQUE("household_id","task_id","date"),
	CONSTRAINT "occurrences_window" CHECK ("occurrences"."window_start" < "occurrences"."window_end"),
	CONSTRAINT "occurrences_status" CHECK ("occurrences"."status" in ('open', 'done', 'missed', 'away')),
	CONSTRAINT "occurrences_closed" CHECK (("occurrences"."status" in ('missed', 'away')) = ("occurrences"."closed_by_plan" is not null))
);
--> statement-breakpoint
ALTER TABLE "occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"status" text NOT NULL,
	"drafted_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plans_household_id" UNIQUE("household_id","id"),
	CONSTRAINT "plans_week" UNIQUE("household_id","week_start"),
	CONSTRAINT "plans_week_length" CHECK ("plans"."week_end" - "plans"."week_start" between 4 and 10),
	CONSTRAINT "plans_status" CHECK ("plans"."status" in ('draft', 'published')),
	CONSTRAINT "plans_published" CHECK (("plans"."status" = 'published') = ("plans"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "first_plan_week" date;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "draft_hours" smallint DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "publish_hours" smallint DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "rebalance" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_household_id" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_id" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_plan" FOREIGN KEY ("household_id","plan_id") REFERENCES "public"."plans"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_occurrence" FOREIGN KEY ("household_id","occurrence_id") REFERENCES "public"."occurrences"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_task" FOREIGN KEY ("household_id","task_id") REFERENCES "public"."tasks"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_closed_by_plan" FOREIGN KEY ("household_id","closed_by_plan") REFERENCES "public"."plans"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_occurrence_plans" ON "assignments" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "occurrences_household_status" ON "occurrences" USING btree ("household_id","status");--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_plan_timings" CHECK ("households"."publish_hours" >= 0 and "households"."draft_hours" > "households"."publish_hours");--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_rebalance" CHECK ("households"."rebalance" in ('fast', 'normal', 'slow'));--> statement-breakpoint
CREATE POLICY "household_only" ON "assignments" AS PERMISSIVE FOR ALL TO public USING ("assignments"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("assignments"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "occurrences" AS PERMISSIVE FOR ALL TO public USING ("occurrences"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("occurrences"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "plans" AS PERMISSIVE FOR ALL TO public USING ("plans"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("plans"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);