CREATE TABLE "auth"."unsubscribe_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "auth"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unsubscribe_tokens_expires" ON "auth"."unsubscribe_tokens" USING btree ("expires_at");