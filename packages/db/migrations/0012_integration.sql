CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"first_day" date NOT NULL,
	"last_day" date NOT NULL,
	CONSTRAINT "absences_days" CHECK ("absences"."last_day" >= "absences"."first_day")
);
--> statement-breakpoint
ALTER TABLE "absences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	CONSTRAINT "activity_log_action" CHECK ("activity_log"."action" in ('household.name', 'household.timeZone', 'household.language', 'household.country'))
);
--> statement-breakpoint
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "away_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"first_day" date NOT NULL,
	"last_day" date NOT NULL,
	CONSTRAINT "away_periods_days" CHECK ("away_periods"."last_day" >= "away_periods"."first_day")
);
--> statement-breakpoint
ALTER TABLE "away_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "temporary_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"first_day" date NOT NULL,
	"last_day" date NOT NULL,
	"percent" smallint NOT NULL,
	CONSTRAINT "temporary_shares_days" CHECK ("temporary_shares"."first_day" <= "temporary_shares"."last_day"),
	CONSTRAINT "temporary_shares_percent" CHECK ("temporary_shares"."percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "temporary_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "share_percent" smallint;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_shares" ADD CONSTRAINT "temporary_shares_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_shares" ADD CONSTRAINT "temporary_shares_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_household_days" ON "absences" USING btree ("household_id","last_day","first_day");--> statement-breakpoint
CREATE INDEX "absences_member" ON "absences" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "activity_log_household_at" ON "activity_log" USING btree ("household_id","at");--> statement-breakpoint
CREATE INDEX "away_periods_household_days" ON "away_periods" USING btree ("household_id","last_day","first_day");--> statement-breakpoint
CREATE INDEX "temporary_shares_member" ON "temporary_shares" USING btree ("household_id","member_id","first_day");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_share_percent" CHECK ("members"."share_percent" between 0 and 100);--> statement-breakpoint
CREATE POLICY "household_only" ON "absences" AS PERMISSIVE FOR ALL TO public USING ("absences"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("absences"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "activity_log" AS PERMISSIVE FOR ALL TO public USING ("activity_log"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("activity_log"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "away_periods" AS PERMISSIVE FOR ALL TO public USING ("away_periods"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("away_periods"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "temporary_shares" AS PERMISSIVE FOR ALL TO public USING ("temporary_shares"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("temporary_shares"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);