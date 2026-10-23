ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "rewound_revision" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "native_rewind" text;