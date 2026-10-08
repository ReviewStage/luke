DROP INDEX IF EXISTS "plan_user_opened";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_user_created" ON "plan" USING btree ("user_id","created_at");
