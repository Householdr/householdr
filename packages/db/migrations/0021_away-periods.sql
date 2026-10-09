CREATE TABLE "away_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"first_day" date NOT NULL,
	"last_day" date NOT NULL,
	CONSTRAINT "away_periods_days" CHECK ("away_periods"."last_day" >= "away_periods"."first_day")
);
--> statement-breakpoint
ALTER TABLE "away_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "away_periods_household_days" ON "away_periods" USING btree ("household_id","last_day","first_day");--> statement-breakpoint
CREATE POLICY "household_only" ON "away_periods" AS PERMISSIVE FOR ALL TO public USING ("away_periods"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("away_periods"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);