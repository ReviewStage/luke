DROP INDEX IF EXISTS "conversations_observed_session";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_observed_session" ON "conversations" USING btree ("user_id","provider_id","provider_session_id") WHERE "deleted_at" IS NULL;
