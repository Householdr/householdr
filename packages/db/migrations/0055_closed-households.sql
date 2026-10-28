ALTER TABLE "households" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
-- A closed household is found by none of the lookups that come before a household is set: not in
-- its members' lists, not by the scheduler, not through an invitation (ADR-0018 §2, clarification).
CREATE OR REPLACE FUNCTION "account_households"("account" uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT "members"."household_id" FROM "members"
    JOIN "households" ON "households"."id" = "members"."household_id"
    WHERE "members"."account_id" = "account" AND "households"."closed_at" IS NULL $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "started_households"() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT "id" FROM "households" WHERE "first_plan_week" IS NOT NULL AND "closed_at" IS NULL $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invitation_household"("hash" text) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT "invitations"."household_id" FROM "invitations"
    JOIN "households" ON "households"."id" = "invitations"."household_id"
    WHERE "invitations"."token_hash" = "hash" AND "households"."closed_at" IS NULL $$;
