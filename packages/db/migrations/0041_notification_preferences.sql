CREATE TABLE "auth"."notification_preferences" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"channels" jsonb NOT NULL,
	"quiet_start" time NOT NULL,
	"quiet_end" time NOT NULL,
	"email_fallback" boolean NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "notification_preferences_channels" CHECK (jsonb_typeof("auth"."notification_preferences"."channels") = 'object'
        and "auth"."notification_preferences"."channels" - array['plan.published', 'plan.drafted'] = '{}'::jsonb
        and not jsonb_path_exists("auth"."notification_preferences"."channels", '$.* ? (!(@ == "push-and-email" || @ == "push" || @ == "email" || @ == "app"))')),
	CONSTRAINT "notification_preferences_quiet_hours" CHECK ("auth"."notification_preferences"."quiet_start" <> "auth"."notification_preferences"."quiet_end"),
	CONSTRAINT "notification_preferences_version" CHECK ("auth"."notification_preferences"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "auth"."notification_preferences" ADD CONSTRAINT "notification_preferences_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "auth"."accounts"("id") ON DELETE cascade ON UPDATE no action;