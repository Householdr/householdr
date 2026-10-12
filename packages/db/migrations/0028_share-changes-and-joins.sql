CREATE TABLE "share_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"from_week" date NOT NULL,
	"percent" smallint,
	CONSTRAINT "share_changes_percent" CHECK ("share_changes"."percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "share_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The members already there joined before join moments were kept: before any plan, as the epoch
-- says. Those added from now on get the moment they are added.
ALTER TABLE "members" ADD COLUMN "joined_at" timestamp with time zone DEFAULT '1970-01-01T00:00:00Z' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "joined_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "share_changes" ADD CONSTRAINT "share_changes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_changes" ADD CONSTRAINT "share_changes_member" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "share_changes_week" ON "share_changes" USING btree ("household_id","member_id","from_week");--> statement-breakpoint
CREATE POLICY "household_only" ON "share_changes" AS PERMISSIVE FOR ALL TO public USING ("share_changes"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid) WITH CHECK ("share_changes"."household_id" = nullif(current_setting('householdr.household_id', true), '')::uuid);