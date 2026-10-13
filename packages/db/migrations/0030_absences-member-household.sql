ALTER TABLE "absences" DROP CONSTRAINT "absences_member_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_member_household" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."members"("household_id","id") ON DELETE cascade ON UPDATE no action;