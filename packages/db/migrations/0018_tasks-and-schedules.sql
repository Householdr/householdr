CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"rules" jsonb NOT NULL,
	"extra_dates" date[] DEFAULT '{}' NOT NULL,
	"exception_dates" date[] DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "schedules_household_id" UNIQUE("household_id","id"),
	CONSTRAINT "schedules_rules" CHECK (jsonb_typeof("schedules"."rules") = 'array'
        and not jsonb_path_exists("schedules"."rules", '$[*] ? (
  @.type() != "object"
  || !exists(@.rrule ? (@.type() == "string" && @ != ""))
  || !exists(@.start ? (@ like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
  || (exists(@.season) && !(exists(@.season.from ? (@ like_regex "^[0-9]{2}-[0-9]{2}$"))
    && exists(@.season.to ? (@ like_regex "^[0-9]{2}-[0-9]{2}$"))))
)')),
	CONSTRAINT "schedules_dates" CHECK ("schedules"."rules" <> '[]'::jsonb or cardinality("schedules"."extra_dates") > 0)
);
--> statement-breakpoint
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration" integer NOT NULL,
	"schedule_id" uuid NOT NULL,
	"timing" text NOT NULL,
	"on_miss" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tasks_name" CHECK ("tasks"."name" <> ''),
	CONSTRAINT "tasks_duration" CHECK ("tasks"."duration" between 1 and 1440),
	CONSTRAINT "tasks_timing" CHECK ("tasks"."timing" in ('flexible', 'floating')),
	CONSTRAINT "tasks_on_miss" CHECK ("tasks"."on_miss" in ('roll over', 'lapse'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_schedule" FOREIGN KEY ("household_id","schedule_id") REFERENCES "public"."schedules"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_household_schedule" ON "tasks" USING btree ("household_id","schedule_id");--> statement-breakpoint
CREATE POLICY "household_only" ON "schedules" AS PERMISSIVE FOR ALL TO public USING ("schedules"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("schedules"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "tasks" AS PERMISSIVE FOR ALL TO public USING ("tasks"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("tasks"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);