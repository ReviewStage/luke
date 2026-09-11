ALTER TABLE "devices" ALTER COLUMN "last_seen_at" SET DATA TYPE timestamp with time zone USING "last_seen_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "last_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "active_until" SET DATA TYPE timestamp with time zone USING "active_until" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "quiet_until" SET DATA TYPE timestamp with time zone USING "quiet_until" AT TIME ZONE 'UTC';
