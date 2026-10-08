-- First the key the new tables refer to, which drizzle-kit would add after the foreign keys that
-- need it.
ALTER TABLE "members" ADD CONSTRAINT "members_household_member" UNIQUE("household_id","id");--> statement-breakpoint
CREATE TABLE "parental_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"given_by" uuid NOT NULL,
	"given_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"language" text NOT NULL,
	CONSTRAINT "parental_consents_text" CHECK ("parental_consents"."text" <> ''),
	CONSTRAINT "parental_consents_language" CHECK ("parental_consents"."language" ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
);
--> statement-breakpoint
ALTER TABLE "parental_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_guardians" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "parental_consents" ADD CONSTRAINT "parental_consents_given_by_accounts_id_fk" FOREIGN KEY ("given_by") REFERENCES "auth"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parental_consents" ADD CONSTRAINT "parental_consents_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_guardians" ADD CONSTRAINT "profile_guardians_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "auth"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_guardians" ADD CONSTRAINT "profile_guardians_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parental_consents_household_member" ON "parental_consents" USING btree ("household_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_guardians_account" ON "profile_guardians" USING btree ("household_id","member_id","account_id");--> statement-breakpoint
CREATE POLICY "household_only" ON "parental_consents" AS PERMISSIVE FOR ALL TO public USING ("parental_consents"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("parental_consents"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "household_only" ON "profile_guardians" AS PERMISSIVE FOR ALL TO public USING ("profile_guardians"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("profile_guardians"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);