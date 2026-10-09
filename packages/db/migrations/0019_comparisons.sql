CREATE TABLE "comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"harder_task_id" uuid NOT NULL,
	"easier_task_id" uuid NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comparisons_two_tasks" CHECK ("comparisons"."harder_task_id" <> "comparisons"."easier_task_id")
);
--> statement-breakpoint
ALTER TABLE "comparisons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The key the foreign keys below refer to comes first, by hand: drizzle-kit adds it last.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_task" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_harder_task" FOREIGN KEY ("household_id","harder_task_id") REFERENCES "public"."tasks"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_easier_task" FOREIGN KEY ("household_id","easier_task_id") REFERENCES "public"."tasks"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comparisons_household_member" ON "comparisons" USING btree ("household_id","member_id");--> statement-breakpoint
CREATE INDEX "comparisons_household_harder_task" ON "comparisons" USING btree ("household_id","harder_task_id");--> statement-breakpoint
CREATE INDEX "comparisons_household_easier_task" ON "comparisons" USING btree ("household_id","easier_task_id");--> statement-breakpoint
CREATE POLICY "household_only" ON "comparisons" AS PERMISSIVE FOR ALL TO public USING ("comparisons"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("comparisons"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);