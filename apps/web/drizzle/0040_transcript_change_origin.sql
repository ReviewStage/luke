UPDATE "turns" SET "origin" = 'transcript_change' WHERE "origin" = 'roster_diff';--> statement-breakpoint
UPDATE "messages" SET "metadata" = jsonb_set("metadata", '{source}', '"transcript_change"') WHERE "metadata"->>'source' = 'roster_look';
