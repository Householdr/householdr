CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"time_zone" text NOT NULL,
	"week_start_day" smallint NOT NULL,
	"week_start_change_from" date,
	"week_start_previous_day" smallint,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "households_name" CHECK ("households"."name" <> ''),
	CONSTRAINT "households_country" CHECK ("households"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "households_language" CHECK ("households"."language" ~ '^[a-z]{2,3}$'),
	CONSTRAINT "households_time_zone" CHECK ("households"."time_zone" <> ''),
	CONSTRAINT "households_week_start_day" CHECK ("households"."week_start_day" between 1 and 7),
	CONSTRAINT "households_week_start_change" CHECK (("households"."week_start_change_from" is null and "households"."week_start_previous_day" is null)
        or ("households"."week_start_change_from" is not null and "households"."week_start_previous_day" is not null
          and "households"."week_start_previous_day" <> "households"."week_start_day"
          and extract(isodow from "households"."week_start_change_from") = "households"."week_start_previous_day"))
);
--> statement-breakpoint
ALTER TABLE "households" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"birth_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "members_name" CHECK ("members"."name" <> ''),
	CONSTRAINT "members_role" CHECK ("members"."role" in ('head', 'adult', 'child')),
	CONSTRAINT "members_birth_date" CHECK (("members"."role" = 'child') = ("members"."birth_date" is not null))
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_household" ON "members" USING btree ("household_id");--> statement-breakpoint
CREATE POLICY "household_only" ON "households" AS PERMISSIVE FOR ALL TO public USING ("households"."id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("households"."id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "members" AS PERMISSIVE FOR ALL TO public USING ("members"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("members"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
-- Row-level security also binds the tables' owner, which a single-role deployment connects as
-- (ADR-0008 §9, CODE-17). Every household-owned table's migration does the same.
ALTER TABLE "households" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;
