ALTER TABLE "tasks" DROP CONSTRAINT "tasks_timing";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "window_from_day" smallint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "window_from_time" time;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "window_to_day" smallint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "window_to_time" time;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_window" CHECK (("tasks"."timing" = 'fixed') = ("tasks"."window_from_day" is not null and "tasks"."window_from_time" is not null
          and "tasks"."window_to_day" is not null and "tasks"."window_to_time" is not null)
        and ("tasks"."window_from_day" is null or "tasks"."window_from_day" between -3 and 3)
        and ("tasks"."window_to_day" is null or "tasks"."window_to_day" between -3 and 3));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_timing" CHECK ("tasks"."timing" in ('flexible', 'floating', 'fixed'));