-- The households past setup, by id and nothing else, for the scheduler that drafts and publishes
-- their plans before one is set (ADR-0007 §2, ADR-0008 §9 and §10, clarifications). It runs with its
-- owner's rights, which row-level security doesn't bind; each household is then read in its own
-- transaction as usual.
CREATE FUNCTION "started_households"() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT "id" FROM "households" WHERE "first_plan_week" IS NOT NULL $$;
--> statement-breakpoint
-- Only the app's role calls it, granted by the migration step.
REVOKE ALL ON FUNCTION "started_households"() FROM PUBLIC;
