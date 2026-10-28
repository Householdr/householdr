ALTER TABLE "tasks" DROP CONSTRAINT "tasks_recurrence";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "once" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deadline" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_added_by" FOREIGN KEY ("household_id","added_by") REFERENCES "public"."members"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deadline" CHECK ("tasks"."deadline" is null or "tasks"."once" <= "tasks"."deadline");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_off" CHECK ("tasks"."once" is not null or ("tasks"."deadline" is null and "tasks"."added_by" is null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence" CHECK (("tasks"."schedule_id" is not null and "tasks"."every_count" is null and "tasks"."every_unit" is null
          and "tasks"."start" is null and "tasks"."once" is null)
        or ("tasks"."schedule_id" is null and "tasks"."timing" = 'flexible' and "tasks"."on_miss" = 'roll over'
          and "tasks"."once" is null
          and "tasks"."start" is not null and ("tasks"."every_unit" = 'days' and "tasks"."every_count" between 1 and 365
            or "tasks"."every_unit" = 'weeks' and "tasks"."every_count" between 1 and 52
            or "tasks"."every_unit" = 'months' and "tasks"."every_count" between 1 and 12))
        or ("tasks"."schedule_id" is null and "tasks"."every_count" is null and "tasks"."every_unit" is null
          and "tasks"."start" is null and "tasks"."timing" = 'flexible' and "tasks"."once" is not null
          and "tasks"."added_by" is not null));