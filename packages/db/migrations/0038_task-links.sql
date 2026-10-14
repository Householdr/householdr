ALTER TABLE "tasks" ADD COLUMN "linked_to" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linked_to" FOREIGN KEY ("household_id","linked_to") REFERENCES "public"."tasks"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linked_to_other" CHECK ("tasks"."linked_to" <> "tasks"."id");