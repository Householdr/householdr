-- The households an account is a member of, by id and nothing else, for the code that has to find
-- them before one is set (ADR-0008 §9, clarifications). It runs with its owner's rights, which
-- row-level security doesn't bind; each household is then read in its own transaction as usual.
CREATE FUNCTION "account_households"("account" uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT "household_id" FROM "members" WHERE "account_id" = "account" $$;
--> statement-breakpoint
-- Only the app's role calls it, granted by the migration step.
REVOKE ALL ON FUNCTION "account_households"(uuid) FROM PUBLIC;
