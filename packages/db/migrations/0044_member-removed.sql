ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action";--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_subject";--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action" CHECK ("activity_log"."action" in ('household.name', 'household.timeZone', 'household.language',
        'household.country', 'household.started', 'completion.logged', 'completion.undone',
        'completion.picked-up', 'share.changed', 'temporary-share.added',
        'temporary-share.removed', 'absence.added', 'absence.removed', 'unavailable.reported',
        'unavailable.ended', 'away.added', 'away.removed', 'member.removed'));--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_subject" CHECK ("activity_log"."subject_id" is null or "activity_log"."action" in ('completion.logged', 'completion.undone', 'completion.picked-up',
  'share.changed', 'temporary-share.added', 'temporary-share.removed', 'absence.added',
  'absence.removed', 'unavailable.reported', 'unavailable.ended', 'member.removed'));