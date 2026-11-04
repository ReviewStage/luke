ALTER TABLE "slack_agent_thread" ADD COLUMN "active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "slack_agent_thread" SET "active_at" = "created_at";
