CREATE INDEX "turns_conversation_queued" ON "turns" USING btree ("conversation_id", "queued_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX "conversations_user_kind" ON "conversations" USING btree ("user_id", "kind");--> statement-breakpoint
CREATE INDEX "conversations_undelivered_children" ON "conversations" USING btree ("user_id") WHERE "conversations"."kind" = 'child' and "conversations"."completion_delivered_at" is null and "conversations"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "expects_completion" SET NOT NULL;