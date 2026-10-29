ALTER TABLE "assignments" DROP CONSTRAINT "assignments_reason";--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_reason" CHECK ("assignments"."reason" in ('bound', 'assigned by head', 'linked', 'only eligible member',
        'lowest relative load', 'catching up', 're-allocated: member unavailable'));