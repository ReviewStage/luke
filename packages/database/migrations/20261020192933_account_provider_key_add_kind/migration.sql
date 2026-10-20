ALTER TABLE "account_provider_key" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'api_key' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_key_user_provider_kind_idx" ON "account_provider_key" ("user_id","provider","kind");
