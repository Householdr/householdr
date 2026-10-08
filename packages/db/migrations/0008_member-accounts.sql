ALTER TABLE "members" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "auth"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_account" ON "members" USING btree ("household_id","account_id");