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
ALTER TABLE "absences" ADD CONSTRAINT "absences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_household_days" ON "absences" USING btree ("household_id","last_day","first_day");--> statement-breakpoint
CREATE INDEX "absences_member" ON "absences" USING btree ("member_id");--> statement-breakpoint
CREATE POLICY "household_only" ON "absences" AS PERMISSIVE FOR ALL TO public USING ("absences"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("absences"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);