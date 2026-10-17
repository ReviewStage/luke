ALTER TABLE "inbox_attachment" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'picture' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD COLUMN IF NOT EXISTS "file_name" text;--> statement-breakpoint
ALTER TABLE "inbox_attachment" DROP CONSTRAINT IF EXISTS "inbox_attachment_answer_file_named";--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_answer_file_named" CHECK (("kind" = 'picture') = ("file_name" is null));--> statement-breakpoint
ALTER TABLE "inbox_attachment" DROP CONSTRAINT IF EXISTS "inbox_attachment_bytes_bound";--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_bytes_bound" CHECK (octet_length("bytes") <= case when "kind" = 'picture' then 1500000 else 3000000 end);
