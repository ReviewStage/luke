-- The release serving beside the vocabulary migration wrote a few rows in the old shape while it drained; these repeat that migration's rewrites, each of which leaves a row in the new shape alone, so running them again changes nothing.
-- An agent message kept its sender's name in its metadata; the row's sender columns keep it now, so a row whose columns name none takes it from there first.
UPDATE "messages" SET "sender" = coalesce("sender", 'agent'), "sender_name" = "metadata"->>'from' WHERE "role" = 'user' AND "metadata"->>'channel' = 'agent_message' AND "sender_name" IS NULL AND "metadata"->>'from' IS NOT NULL;--> statement-breakpoint
-- Who sent an agent message is the row's sender columns, never its metadata.
UPDATE "messages" SET "metadata" = "metadata" - 'from' WHERE "role" = 'user' AND "metadata" ? 'from';--> statement-breakpoint
-- A user row's channel or source says what it is; only a spoken ask keeps who wrote it, the developer or the voice model.
UPDATE "messages" SET "metadata" = "metadata" - 'author' WHERE "role" = 'user' AND "metadata" ? 'author' AND "metadata"->>'channel' IS DISTINCT FROM 'voice';--> statement-breakpoint
-- An assistant row is the model's that answered the turn, whatever harness ran it, or the voice model's.
UPDATE "messages" SET "metadata" = jsonb_set("metadata", '{author}', '"model"') WHERE "role" = 'assistant' AND "metadata"->>'author' IN ('brain', 'child');
