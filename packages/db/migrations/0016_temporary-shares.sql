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
ALTER TABLE "temporary_shares" ADD CONSTRAINT "temporary_shares_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_shares" ADD CONSTRAINT "temporary_shares_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "temporary_shares_member" ON "temporary_shares" USING btree ("household_id","member_id","first_day");--> statement-breakpoint
CREATE POLICY "household_only" ON "temporary_shares" AS PERMISSIVE FOR ALL TO public USING ("temporary_shares"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("temporary_shares"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);