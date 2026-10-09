ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action";--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "set_before_start" jsonb;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_set_before_start" CHECK (("activity_log"."action" = 'household.started') = ("activity_log"."set_before_start" is not null)
        and case
          when "activity_log"."set_before_start" is null then true
          when jsonb_typeof("activity_log"."set_before_start") <> 'object' then false
          else "activity_log"."set_before_start" ?& array['shares', 'daysAway']
            and not jsonb_path_exists("activity_log"."set_before_start", '$.keyvalue() ? ((@.key != "shares" && @.key != "daysAway")
  || @.value.type() != "array"
  || exists(@.value[*] ? (@.type() != "string"
    || !(@ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))))')
        end);--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action" CHECK ("activity_log"."action" in ('household.name', 'household.timeZone', 'household.language',
        'household.country', 'household.started'));--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "started_now" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_started_now" CHECK (not "households"."started_now" or "households"."first_plan_week" is not null);