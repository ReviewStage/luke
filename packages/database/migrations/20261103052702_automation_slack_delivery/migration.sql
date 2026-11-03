ALTER TABLE "automation" ADD COLUMN "slack_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "slack_delivered_at" timestamp with time zone;