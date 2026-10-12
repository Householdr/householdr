CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"week" date NOT NULL,
	"change" double precision NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_entries_kind" CHECK ("ledger_entries"."kind" in ('settlement'))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_week" FOREIGN KEY ("household_id","week") REFERENCES "public"."plans"("household_id","week_start") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_settled_once" ON "ledger_entries" USING btree ("household_id","week","member_id") WHERE "ledger_entries"."kind" = 'settlement';--> statement-breakpoint
CREATE INDEX "ledger_entries_member_week" ON "ledger_entries" USING btree ("household_id","member_id","week");--> statement-breakpoint
CREATE POLICY "household_only" ON "ledger_entries" AS PERMISSIVE FOR ALL TO public USING ("ledger_entries"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("ledger_entries"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);