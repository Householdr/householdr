CREATE TABLE "invitations" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invitations_token_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_household" ON "invitations" USING btree ("household_id");--> statement-breakpoint
CREATE POLICY "household_only" ON "invitations" AS PERMISSIVE FOR ALL TO public USING ("invitations"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("invitations"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
-- The household of the invitation whose token hashes to `hash`, by id and nothing else, for the
-- person opening the link before any household is set (ADR-0008 §9, clarifications; ADR-0010 §5).
CREATE FUNCTION "invitation_household"("hash" text) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT "household_id" FROM "invitations" WHERE "token_hash" = "hash" $$;
--> statement-breakpoint
-- Only the app's role calls it, granted by the migration step.
REVOKE ALL ON FUNCTION "invitation_household"(text) FROM PUBLIC;
