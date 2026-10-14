ALTER TABLE "tasks" ALTER COLUMN "schedule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "every_count" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "every_unit" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence" CHECK (("tasks"."schedule_id" is not null and "tasks"."every_count" is null and "tasks"."every_unit" is null
          and "tasks"."start" is null)
        or ("tasks"."schedule_id" is null and "tasks"."timing" = 'flexible' and "tasks"."on_miss" = 'roll over'
          and "tasks"."start" is not null and ("tasks"."every_unit" = 'days' and "tasks"."every_count" between 1 and 365
            or "tasks"."every_unit" = 'weeks' and "tasks"."every_count" between 1 and 52
            or "tasks"."every_unit" = 'months' and "tasks"."every_count" between 1 and 12)));