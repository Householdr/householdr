CREATE TABLE "auth"."passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"browser" text,
	"system" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aaguid" text,
	CONSTRAINT "passkeys_credentialID_unique" UNIQUE("credential_id"),
	CONSTRAINT "passkeys_no_name" CHECK ("auth"."passkeys"."name" is null)
);
--> statement-breakpoint
ALTER TABLE "auth"."account_emails" DROP CONSTRAINT "account_emails_kind";--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD CONSTRAINT "passkeys_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkeys_user" ON "auth"."passkeys" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "auth"."account_emails" ADD CONSTRAINT "account_emails_kind" CHECK ("auth"."account_emails"."kind" in ('password-reset', 'password-changed', 'passkey-added', 'passkey-removed'));