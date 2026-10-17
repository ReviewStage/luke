-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
ALTER TABLE "inbox_attachment" DROP CONSTRAINT IF EXISTS "inbox_attachment_bytes_bound";--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD COLUMN IF NOT EXISTS "name" text;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD COLUMN IF NOT EXISTS "position" integer;--> statement-breakpoint
ALTER TABLE "inbox_attachment" DROP CONSTRAINT IF EXISTS "inbox_attachment_kind_bound";--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_kind_bound" CHECK (("kind" = 'image' and octet_length("bytes") <= 1500000 and "name" is null and "position" is null) or ("kind" = 'answer' and octet_length("bytes") <= 3000000 and "name" is not null and "position" is not null));
