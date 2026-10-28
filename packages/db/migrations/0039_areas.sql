CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "areas_household_area" UNIQUE("household_id","id"),
	CONSTRAINT "areas_name" CHECK ("areas"."name" <> '' and char_length("areas"."name") <= 50)
);
--> statement-breakpoint
ALTER TABLE "areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_household_name" ON "areas" USING btree ("household_id",lower("name"));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_area" FOREIGN KEY ("household_id","area_id") REFERENCES "public"."areas"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "household_only" ON "areas" AS PERMISSIVE FOR ALL TO public USING ("areas"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("areas"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);