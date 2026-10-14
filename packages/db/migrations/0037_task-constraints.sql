CREATE TABLE "task_constraints" (
	"household_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"constraint" text NOT NULL,
	CONSTRAINT "task_constraints_task_id_member_id_pk" PRIMARY KEY("task_id","member_id"),
	CONSTRAINT "task_constraints_constraint" CHECK ("task_constraints"."constraint" in ('bound', 'excluded', 'allowed'))
);
--> statement-breakpoint
ALTER TABLE "task_constraints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "minimum_age" smallint;--> statement-breakpoint
ALTER TABLE "task_constraints" ADD CONSTRAINT "task_constraints_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_constraints" ADD CONSTRAINT "task_constraints_task_household" FOREIGN KEY ("household_id","task_id") REFERENCES "public"."tasks"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_constraints" ADD CONSTRAINT "task_constraints_member_household" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_constraints_member" ON "task_constraints" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_minimum_age" CHECK ("tasks"."minimum_age" is null or "tasks"."minimum_age" between 1 and 17);--> statement-breakpoint
CREATE POLICY "household_only" ON "task_constraints" AS PERMISSIVE FOR ALL TO public USING ("task_constraints"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("task_constraints"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);