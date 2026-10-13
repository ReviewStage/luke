ALTER TABLE "coding_agent" ADD COLUMN "context_window" text DEFAULT 'long' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_preference" ADD COLUMN "coding_agent_context_window" text;
